import { createRemoteJWKSet, jwtVerify } from "jose";
import { sendError } from "../lib/errors.js";

/**
 * Reusable auth middleware (Challenge 2).
 *
 * BetterAuth signs the JWTs on the Next.js side and publishes the public keys
 * at `${CLIENT_URL}/api/auth/jwks`; this server never holds a shared secret —
 * it only ever verifies. See `.project/CONTRACT.md` §5.
 */

const CLIENT_URL = (process.env.CLIENT_URL || "http://localhost:3000").replace(/\/+$/, "");

const JWKS = createRemoteJWKSet(new URL(`${CLIENT_URL}/api/auth/jwks`));

/** Pull `Bearer <jwt>` out of the Authorization header (or ""). */
function readBearer(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

/**
 * Verify the bearer token and attach its payload to `req.user`.
 * 401 for a missing, malformed, expired or wrongly-signed token.
 */
export async function verifyToken(req, res, next) {
  const token = readBearer(req);

  if (!token) {
    return sendError(res, "UNAUTHORIZED", "You need to sign in to continue.");
  }

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: CLIENT_URL,
      audience: CLIENT_URL,
    });
    req.user = payload;
    return next();
  } catch {
    return sendError(res, "UNAUTHORIZED", "Your session has expired. Please sign in again.");
  }
}

/**
 * `verifyToken` plus a role gate — wrong role gets 403, never 401.
 * @param {"customer"|"technician"|"admin"} role
 * @param {string} label used in the error message
 */
function roleGate(role, label) {
  return async function (req, res, next) {
    await verifyToken(req, res, () => {
      if (req.user?.role !== role) {
        return sendError(res, "FORBIDDEN", `Only ${label} accounts can perform this action.`);
      }
      return next();
    });
  };
}

export const verifyCustomer = roleGate("customer", "customer");
export const verifyTechnician = roleGate("technician", "technician");
export const verifyAdmin = roleGate("admin", "admin");

/** The signed-in user's id as a string (JWT `sub` = session user id). */
export function userId(req) {
  return String(req.user?.sub ?? req.user?.id ?? "");
}
