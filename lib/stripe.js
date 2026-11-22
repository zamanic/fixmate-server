import Stripe from "stripe";

/**
 * Stripe client (test mode).
 *
 * If STRIPE_SECRET_KEY is missing we still hand back a client instead of
 * throwing at import time — the payment routes turn a missing/invalid key into
 * a clean `500 SERVER_ERROR` rather than taking the whole server down.
 */
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "sk_test_placeholder");
