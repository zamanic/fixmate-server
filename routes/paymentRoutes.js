import { Router } from "express";
import { ObjectId } from "mongodb";
import { col } from "../lib/mongo.js";
import { sendError } from "../lib/errors.js";
import { verifyCustomer } from "../middleware/verifyToken.js";
import { stripe } from "../lib/stripe.js";

/**
 * Payment routes — CONTRACT §2 (`payments`), §7.
 *
 * Pay-after-completion in Stripe test mode. The amount always comes from the
 * stored booking (never the client). `recordPayment` is the single idempotent
 * writer shared by `GET /verify` and the Stripe webhook.
 */

const router = Router();

const CLIENT_URL = (process.env.CLIENT_URL || "http://localhost:3000").replace(/\/+$/, "");

/** Public shape of a payment document (CONTRACT §2). */
export function shapePayment(doc) {
  return {
    id: String(doc._id),
    bookingId: doc.bookingId != null ? String(doc.bookingId) : null,
    serviceTitle: doc.serviceTitle,
    customerName: doc.customerName,
    customerEmail: doc.customerEmail,
    technicianName: doc.technicianName,
    technicianEmail: doc.technicianEmail,
    amount: doc.amount,
    currency: doc.currency,
    transactionId: doc.transactionId,
    stripeSessionId: doc.stripeSessionId,
    paymentStatus: doc.paymentStatus,
    paidAt: doc.paidAt instanceof Date ? doc.paidAt.toISOString() : doc.paidAt,
  };
}

/**
 * Idempotent writer: exactly one `payments` row per Stripe session. The unique
 * indexes on `stripeSessionId` + `bookingId` are the real guarantee — the
 * lookup and the 11000 catch just keep a webhook/verify race from erroring.
 */
export async function recordPayment(session) {
  const payments = col("payments");

  const existing = await payments.findOne({ stripeSessionId: session.id });
  if (existing) return existing;

  const bookingIdRaw = session.metadata?.bookingId;
  const _id = ObjectId.isValid(String(bookingIdRaw ?? "")) ? new ObjectId(bookingIdRaw) : null;
  const bookings = col("bookings");
  const booking = _id ? await bookings.findOne({ _id }) : null;
  if (!booking) throw new Error(`Booking not found for Stripe session ${session.id}`);

  const paymentIntent =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id ?? null;

  const doc = {
    bookingId: booking._id,
    serviceTitle: booking.serviceTitle,
    customerName: booking.customerName,
    customerEmail: booking.customerEmail,
    technicianName: booking.technicianName,
    technicianEmail: booking.technicianEmail,
    amount: booking.finalAmount,
    currency: "usd",
    transactionId: paymentIntent,
    stripeSessionId: session.id,
    paymentStatus: "paid",
    paidAt: new Date(),
  };

  let insertedId;
  try {
    const result = await payments.insertOne(doc);
    insertedId = result.insertedId;
  } catch (err) {
    if (err?.code === 11000) {
      const raced =
        (await payments.findOne({ stripeSessionId: session.id })) ||
        (await payments.findOne({ bookingId: booking._id }));
      if (raced) return raced;
    }
    throw err;
  }

  await bookings.updateOne({ _id: booking._id }, { $set: { paymentStatus: "paid" } });
  return { _id: insertedId, ...doc };
}

/** POST /api/payments/create-checkout-session — start a Stripe session for a completed, unpaid booking. */
router.post("/create-checkout-session", verifyCustomer, async (req, res) => {
  const bookingIdRaw = String(req.body?.bookingId ?? "");
  if (!ObjectId.isValid(bookingIdRaw)) {
    return sendError(res, "INVALID_ID", "We couldn't find that booking.");
  }

  try {
    const booking = await col("bookings").findOne({ _id: new ObjectId(bookingIdRaw) });
    if (!booking) return sendError(res, "INVALID_ID", "We couldn't find that booking.");

    if (String(booking.customerEmail).toLowerCase() !== String(req.user.email).toLowerCase()) {
      return sendError(res, "FORBIDDEN", "This isn't your booking.");
    }
    if (booking.paymentStatus === "paid") {
      return sendError(res, "ALREADY_PAID", "This booking has already been paid.");
    }
    if (booking.status !== "completed" || booking.paymentStatus !== "unpaid") {
      return sendError(res, "VALIDATION", "This job isn't ready to pay yet.");
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: Math.round(Number(booking.finalAmount) * 100),
            product_data: { name: booking.serviceTitle },
          },
          quantity: 1,
        },
      ],
      metadata: {
        bookingId: String(booking._id),
        customerEmail: String(req.user.email),
        integrationIdentifier: process.env.INTEGRATION_IDENTIFIER || "fixmate_web_001",
      },
      success_url: `${CLIENT_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${CLIENT_URL}/payment/cancel?bookingId=${booking._id}`,
    });

    return res.json({ url: session.url, sessionId: session.id });
  } catch {
    return sendError(res, "SERVER_ERROR", "Could not start the payment. Please try again.");
  }
});

/** GET /api/payments/verify?session_id= — confirm a returned checkout and record it once. */
router.get("/verify", verifyCustomer, async (req, res) => {
  const { session_id: sessionId } = req.query;
  if (!sessionId || typeof sessionId !== "string") {
    return sendError(res, "VALIDATION", "Missing Stripe session id.");
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== "paid") {
      return sendError(res, "VALIDATION", "That payment isn't completed yet.");
    }
    if (
      String(session.metadata?.customerEmail ?? "").toLowerCase() !==
      String(req.user.email).toLowerCase()
    ) {
      return sendError(res, "FORBIDDEN", "This payment doesn't belong to your account.");
    }

    const payment = await recordPayment(session);
    return res.json({ message: "Payment recorded.", payment: shapePayment(payment) });
  } catch (err) {
    if (err?.type === "StripeInvalidRequestError") {
      return sendError(res, "VALIDATION", "We couldn't find that payment session.");
    }
    return sendError(res, "SERVER_ERROR", "Could not verify the payment.");
  }
});

/**
 * GET /api/payments/my — the signed-in customer's own payment history, newest
 * first. Scoped by the JWT's email, never by a client-supplied filter.
 */
router.get("/my", verifyCustomer, async (req, res) => {
  try {
    const docs = await col("payments")
      .find({ customerEmail: String(req.user.email).toLowerCase() })
      .sort({ paidAt: -1 })
      .toArray();
    return res.json({ items: docs.map(shapePayment) });
  } catch {
    return sendError(res, "SERVER_ERROR", "Could not load your payments.");
  }
});

/**
 * POST /api/payments/webhook — Stripe-owned signature is the proof, so no auth
 * middleware. `index.js` mounts this with `express.raw()` BEFORE `express.json()`
 * so `req.body` is the untouched raw payload Stripe signed.
 */
export async function webhookHandler(req, res) {
  const signature = req.headers["stripe-signature"];
  if (!signature) {
    return sendError(res, "VALIDATION", "Missing Stripe signature.");
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return sendError(res, "VALIDATION", "Invalid Stripe signature.");
  }

  try {
    if (event.type === "checkout.session.completed") {
      await recordPayment(event.data.object);
    }
    return res.status(200).json({ received: true });
  } catch {
    return sendError(res, "SERVER_ERROR", "Webhook handler failed.");
  }
}

export default router;
