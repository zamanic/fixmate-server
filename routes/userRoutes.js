import { Router } from "express";
import { ObjectId } from "mongodb";
import { col } from "../lib/mongo.js";
import { sendError } from "../lib/errors.js";
import { verifyToken, userId } from "../middleware/verifyToken.js";

/**
 * User profile routes. Users live in BetterAuth's `user` collection (plus the
 * `role` / `phone` / `area` / `bio` additional fields) — see CONTRACT §2.
 */

const router = Router();

/** Public shape of a user document. Never leaks auth internals. */
export function shapeUser(doc) {
  return {
    id: String(doc._id),
    name: doc.name ?? "",
    email: doc.email ?? "",
    image: doc.image ?? "",
    role: doc.role ?? "customer",
    phone: doc.phone ?? "",
    area: doc.area ?? "",
    bio: doc.bio ?? "",
    createdAt: doc.createdAt ?? null,
  };
}

/** Fields a user may edit on their own profile. Email and role are read-only. */
const EDITABLE_FIELDS = ["name", "phone", "area", "bio", "image"];
const MAX_LENGTHS = { name: 80, phone: 30, area: 80, bio: 280, image: 500 };

/** GET /api/users/me — the signed-in user's own profile. */
router.get("/me", verifyToken, async (req, res) => {
  try {
    const user = await col("user").findOne({ _id: new ObjectId(userId(req)) });
    if (!user) return sendError(res, "INVALID_ID", "Account not found.");
    return res.json({ user: shapeUser(user) });
  } catch {
    return sendError(res, "SERVER_ERROR", "Could not load your profile.");
  }
});

/** PATCH /api/users/profile — whitelisted update of the signed-in user. */
router.patch("/profile", verifyToken, async (req, res) => {
  const body = req.body ?? {};
  const updates = {};

  for (const field of EDITABLE_FIELDS) {
    if (body[field] === undefined || body[field] === null) continue;
    const value = String(body[field]).trim();
    if (value.length > MAX_LENGTHS[field]) {
      return sendError(res, "VALIDATION", `${field} must be ${MAX_LENGTHS[field]} characters or fewer.`);
    }
    updates[field] = value;
  }

  if (Object.keys(updates).length === 0) {
    return sendError(res, "VALIDATION", "Nothing to update.");
  }
  if (updates.name !== undefined && updates.name.length < 2) {
    return sendError(res, "VALIDATION", "Name must be at least 2 characters.");
  }
  if (updates.phone !== undefined && updates.phone && !/^[0-9+\-() ]{6,20}$/.test(updates.phone)) {
    return sendError(res, "VALIDATION", "Phone number looks invalid.");
  }

  try {
    const users = col("user");
    const result = await users.findOneAndUpdate(
      { _id: new ObjectId(userId(req)) },
      { $set: { ...updates, updatedAt: new Date() } },
      { returnDocument: "after" }
    );

    if (!result) return sendError(res, "INVALID_ID", "Account not found.");
    return res.json({ message: "Profile updated.", user: shapeUser(result) });
  } catch {
    return sendError(res, "SERVER_ERROR", "Could not update your profile.");
  }
});

export default router;
