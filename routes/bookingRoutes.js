import { Router } from "express";
import { ObjectId } from "mongodb";
import { col } from "../lib/mongo.js";
import { sendError } from "../lib/errors.js";
import { verifyToken, verifyCustomer, verifyTechnician } from "../middleware/verifyToken.js";

/**
 * Booking routes — CONTRACT §2 (`bookings`), §3 (status machine), §6.
 *
 * Ownership is always read from the verified JWT: customers only ever see and
 * cancel their own requests, technicians only their own incoming ones.
 */

const router = Router();

/** Statuses that count as an outstanding request (CONTRACT §3). */
const ACTIVE_STATUSES = ["requested", "accepted", "in-progress"];

/** Allowed status moves, technician-driven (CONTRACT §3 table). */
const TRANSITIONS = {
  requested: ["accepted", "rejected"],
  accepted: ["in-progress"],
  "in-progress": ["completed"],
};

/** Public shape of a booking document (CONTRACT §2 field order). */
export function shapeBooking(doc) {
  return {
    id: String(doc._id),
    serviceId: doc.serviceId != null ? String(doc.serviceId) : null,
    serviceTitle: doc.serviceTitle,
    serviceImage: doc.serviceImage,
    category: doc.category,
    basePrice: doc.basePrice,
    technicianName: doc.technicianName,
    technicianEmail: doc.technicianEmail,
    customerName: doc.customerName,
    customerEmail: doc.customerEmail,
    customerPhone: doc.customerPhone,
    address: doc.address,
    preferredDate:
      doc.preferredDate instanceof Date ? doc.preferredDate.toISOString() : doc.preferredDate,
    problemDescription: doc.problemDescription,
    status: doc.status,
    finalAmount: doc.finalAmount,
    paymentStatus: doc.paymentStatus,
    statusHistory: Array.isArray(doc.statusHistory)
      ? doc.statusHistory.map((entry) => ({
          status: entry.status,
          changedAt: entry.changedAt instanceof Date ? entry.changedAt.toISOString() : entry.changedAt,
        }))
      : [],
    createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : doc.createdAt,
  };
}

/**
 * CONTRACT §3: status moves are technician-owned, but an admin may override.
 * `verifyTechnician` alone would 403 an admin, so this guard allows both.
 */
async function verifyTechnicianOrAdmin(req, res, next) {
  await verifyToken(req, res, () => {
    if (req.user?.role !== "technician" && req.user?.role !== "admin") {
      return sendError(res, "FORBIDDEN", "Only technicians can perform this action.");
    }
    return next();
  });
}

/** POST /api/bookings — customer creates a repair request. */
router.post("/", verifyCustomer, async (req, res) => {
  const body = req.body ?? {};

  const serviceIdRaw = String(body.serviceId ?? "");
  if (!ObjectId.isValid(serviceIdRaw)) {
    return sendError(res, "VALIDATION", "Please pick a valid service.");
  }

  const customerPhone = String(body.customerPhone ?? "").trim();
  if (!/^[0-9+\-() ]{6,20}$/.test(customerPhone)) {
    return sendError(res, "VALIDATION", "Phone number looks invalid.");
  }

  const address = String(body.address ?? "").trim();
  if (address.length < 5 || address.length > 200) {
    return sendError(res, "VALIDATION", "Address must be between 5 and 200 characters.");
  }

  const preferredDate = new Date(body.preferredDate);
  if (!body.preferredDate || Number.isNaN(preferredDate.getTime())) {
    return sendError(res, "VALIDATION", "Please pick a valid preferred date.");
  }
  if (preferredDate.getTime() < Date.now()) {
    return sendError(res, "VALIDATION", "Preferred date can't be in the past.");
  }

  const problemDescription = String(body.problemDescription ?? "").trim();
  if (problemDescription.length < 20 || problemDescription.length > 1000) {
    return sendError(res, "VALIDATION", "Please describe the problem in at least 20 characters.");
  }

  try {
    const serviceId = new ObjectId(serviceIdRaw);
    const service = await col("services").findOne({ _id: serviceId });
    if (!service || service.approvalStatus !== "approved" || !service.isAvailable) {
      return sendError(res, "INVALID_ID", "We couldn't find that service.");
    }

    const customerEmail = String(req.user.email).toLowerCase();
    if (String(service.technicianEmail).toLowerCase() === customerEmail) {
      return sendError(res, "FORBIDDEN", "You can't request your own service.");
    }

    const bookings = col("bookings");
    const duplicate = await bookings.findOne({
      customerEmail,
      serviceId,
      status: { $in: ACTIVE_STATUSES },
    });
    if (duplicate) {
      return sendError(res, "ACTIVE_REQUEST_EXISTS", "You already have an active request for this service.");
    }

    const now = new Date();
    const doc = {
      serviceId,
      serviceTitle: service.title,
      serviceImage: service.image,
      category: service.category,
      basePrice: service.basePrice,
      technicianName: service.technicianName,
      technicianEmail: service.technicianEmail,
      customerName: req.user.name || "",
      customerEmail,
      customerPhone,
      address,
      preferredDate,
      problemDescription,
      status: "requested",
      finalAmount: service.basePrice,
      paymentStatus: "unpaid",
      statusHistory: [{ status: "requested", changedAt: now }],
      createdAt: now,
    };
    const result = await bookings.insertOne(doc);
    return res
      .status(201)
      .json({ message: "Request sent to the technician.", booking: shapeBooking({ _id: result.insertedId, ...doc }) });
  } catch {
    return sendError(res, "SERVER_ERROR", "Could not create the booking.");
  }
});

/** GET /api/bookings/my — the signed-in customer's own bookings. */
router.get("/my", verifyCustomer, async (req, res) => {
  try {
    const docs = await col("bookings")
      .find({ customerEmail: String(req.user.email).toLowerCase() })
      .sort({ createdAt: -1 })
      .toArray();
    return res.json({ items: docs.map(shapeBooking) });
  } catch {
    return sendError(res, "SERVER_ERROR", "Could not load your bookings.");
  }
});

/** GET /api/bookings/technician — the signed-in technician's incoming bookings. */
router.get("/technician", verifyTechnician, async (req, res) => {
  try {
    const docs = await col("bookings")
      .find({ technicianEmail: String(req.user.email).toLowerCase() })
      .sort({ createdAt: -1 })
      .toArray();
    return res.json({ items: docs.map(shapeBooking) });
  } catch {
    return sendError(res, "SERVER_ERROR", "Could not load your requests.");
  }
});

/** PATCH /api/bookings/:id/status — technician (or admin) advances the state machine. */
router.patch("/:id/status", verifyTechnicianOrAdmin, async (req, res) => {
  const { id } = req.params;
  if (!ObjectId.isValid(id)) return sendError(res, "INVALID_ID", "We couldn't find that request.");

  const { status, finalAmount } = req.body ?? {};
  if (typeof status !== "string" || !status) {
    return sendError(res, "VALIDATION", "Please provide a status.");
  }

  try {
    const _id = new ObjectId(id);
    const bookings = col("bookings");
    const booking = await bookings.findOne({ _id });
    if (!booking) return sendError(res, "INVALID_ID", "We couldn't find that request.");

    const isOwner =
      String(booking.technicianEmail).toLowerCase() === String(req.user.email).toLowerCase();
    const isAdmin = req.user.role === "admin";
    if (!isOwner && !isAdmin) {
      return sendError(res, "FORBIDDEN", "This isn't your request.");
    }

    const allowed = TRANSITIONS[booking.status] || [];
    if (!allowed.includes(status)) {
      return sendError(
        res,
        "INVALID_TRANSITION",
        `A request that is ${booking.status} can't move to ${status}.`
      );
    }

    const update = { status };
    if (status === "completed") {
      const amount = Number(finalAmount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return sendError(res, "VALIDATION", "Please provide a final amount greater than 0.");
      }
      update.finalAmount = amount;
    }

    const updated = await bookings.findOneAndUpdate(
      { _id },
      { $set: update, $push: { statusHistory: { status, changedAt: new Date() } } },
      { returnDocument: "after" }
    );
    return res.json({ message: `Request marked as ${status}.`, booking: shapeBooking(updated) });
  } catch {
    return sendError(res, "SERVER_ERROR", "Could not update the request.");
  }
});

/** PATCH /api/bookings/:id/cancel — customer cancels while still "requested". */
router.patch("/:id/cancel", verifyCustomer, async (req, res) => {
  const { id } = req.params;
  if (!ObjectId.isValid(id)) return sendError(res, "INVALID_ID", "We couldn't find that request.");

  try {
    const _id = new ObjectId(id);
    const bookings = col("bookings");
    const booking = await bookings.findOne({ _id });
    if (!booking) return sendError(res, "INVALID_ID", "We couldn't find that request.");

    if (String(booking.customerEmail).toLowerCase() !== String(req.user.email).toLowerCase()) {
      return sendError(res, "FORBIDDEN", "This isn't your request.");
    }
    if (booking.status !== "requested") {
      return sendError(res, "INVALID_TRANSITION", "Only a pending request can be cancelled.");
    }

    const updated = await bookings.findOneAndUpdate(
      { _id },
      {
        $set: { status: "cancelled" },
        $push: { statusHistory: { status: "cancelled", changedAt: new Date() } },
      },
      { returnDocument: "after" }
    );
    return res.json({ message: "Request cancelled.", booking: shapeBooking(updated) });
  } catch {
    return sendError(res, "SERVER_ERROR", "Could not cancel the request.");
  }
});

export default router;
