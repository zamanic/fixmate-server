import { Router } from "express";
import { ObjectId } from "mongodb";
import { col } from "../lib/mongo.js";
import { sendError } from "../lib/errors.js";
import { verifyTechnician } from "../middleware/verifyToken.js";

/**
 * Service (repair listing) routes — CONTRACT §2 (`services`) and §6.
 *
 * Public reads only ever surface `approvalStatus: "approved"` + available
 * listings; technicians manage their own. Ownership is always taken from the
 * verified JWT (`req.user.email`), never from the body or params.
 */

const router = Router();

const CATEGORIES = [
  "Smartphone",
  "Laptop & PC",
  "AC",
  "Refrigerator",
  "TV",
  "Washing Machine",
  "Electrical",
];
const SERVICE_MODES = ["Home Visit", "Shop Drop-off"];

/** Escape regex metacharacters so user input can't bend a "contains" search. */
function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Public shape of a service document (CONTRACT §2 field order). */
export function shapeService(doc) {
  return {
    id: String(doc._id),
    title: doc.title,
    category: doc.category,
    description: doc.description,
    image: doc.image,
    basePrice: doc.basePrice,
    estimatedDuration: doc.estimatedDuration,
    serviceMode: doc.serviceMode,
    serviceArea: doc.serviceArea,
    technicianName: doc.technicianName,
    technicianEmail: doc.technicianEmail,
    approvalStatus: doc.approvalStatus,
    isAvailable: doc.isAvailable,
    ratingAverage: doc.ratingAverage ?? 0,
    ratingCount: doc.ratingCount ?? 0,
    createdAt: doc.createdAt,
  };
}

/**
 * Validate + normalise the editable service fields. Used by both POST and PATCH
 * so a value that was never whitelisted can never reach Mongo.
 * @returns {{ value: object } | { error: string }}
 */
function validateServicePayload(body = {}) {
  const title = String(body.title ?? "").trim();
  if (title.length < 2 || title.length > 120) {
    return { error: "Title must be between 2 and 120 characters." };
  }

  const category = String(body.category ?? "");
  if (!CATEGORIES.includes(category)) {
    return { error: "Please pick a valid category." };
  }

  const description = String(body.description ?? "").trim();
  if (description.length < 20 || description.length > 1200) {
    return { error: "Description must be between 20 and 1200 characters." };
  }

  const image = String(body.image ?? "").trim();
  if (!image || image.length > 500) {
    return { error: "Please provide an image URL (max 500 characters)." };
  }

  const basePrice = Number(body.basePrice);
  if (!Number.isFinite(basePrice) || basePrice <= 0) {
    return { error: "Base price must be a number greater than 0." };
  }

  const estimatedDuration = String(body.estimatedDuration ?? "").trim();
  if (!estimatedDuration || estimatedDuration.length > 60) {
    return { error: "Please provide an estimated duration (max 60 characters)." };
  }

  const serviceMode = String(body.serviceMode ?? "");
  if (!SERVICE_MODES.includes(serviceMode)) {
    return { error: "Please pick a valid service mode." };
  }

  const serviceArea = String(body.serviceArea ?? "").trim();
  if (serviceArea.length < 2 || serviceArea.length > 120) {
    return { error: "Service area must be between 2 and 120 characters." };
  }

  return {
    value: {
      title,
      category,
      description,
      image,
      basePrice,
      estimatedDuration,
      serviceMode,
      serviceArea,
    },
  };
}

/** GET /api/services/featured — public, newest approved + available. */
router.get("/featured", async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 6;
    const docs = await col("services")
      .find({ approvalStatus: "approved", isAvailable: true })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
    return res.json({ items: docs.map(shapeService) });
  } catch {
    return sendError(res, "SERVER_ERROR", "Could not load featured services.");
  }
});

/** GET /api/services/mine — technician's own listings (incl. pending/rejected). */
router.get("/mine", verifyTechnician, async (req, res) => {
  try {
    const docs = await col("services")
      .find({ technicianEmail: String(req.user.email).toLowerCase() })
      .sort({ createdAt: -1 })
      .toArray();
    return res.json({ items: docs.map(shapeService) });
  } catch {
    return sendError(res, "SERVER_ERROR", "Could not load your services.");
  }
});

/** GET /api/services — public search / filter / sort / pagination (Challenge 1). */
router.get("/", async (req, res) => {
  try {
    const { search, category, mode, area, minPrice, maxPrice, sort, page, limit } = req.query;

    // Never expose a pending or rejected listing.
    const filter = { approvalStatus: "approved", isAvailable: true };

    if (search && String(search).trim()) {
      const rx = new RegExp(escapeRegex(String(search).trim()), "i");
      filter.$or = [{ title: rx }, { description: rx }, { technicianName: rx }];
    }
    if (category && CATEGORIES.includes(String(category))) {
      filter.category = String(category);
    }
    if (mode) {
      filter.serviceMode = String(mode);
    }
    if (area && String(area).trim()) {
      filter.serviceArea = new RegExp(escapeRegex(String(area).trim()), "i");
    }

    const price = {};
    const min = Number(minPrice);
    const max = Number(maxPrice);
    if (minPrice !== undefined && minPrice !== "" && Number.isFinite(min)) price.$gte = min;
    if (maxPrice !== undefined && maxPrice !== "" && Number.isFinite(max)) price.$lte = max;
    if (Object.keys(price).length) filter.basePrice = price;

    const sortMap = {
      newest: { createdAt: -1 },
      "price-asc": { basePrice: 1 },
      "price-desc": { basePrice: -1 },
      "rating-desc": { ratingAverage: -1, createdAt: -1 },
    };
    const sortSpec = sortMap[String(sort)] || sortMap.newest;

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(24, Math.max(1, Number(limit) || 9));

    const services = col("services");
    const [docs, total] = await Promise.all([
      services
        .find(filter)
        .sort(sortSpec)
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .toArray(),
      services.countDocuments(filter),
    ]);

    return res.json({
      items: docs.map(shapeService),
      total,
      page: pageNum,
      pages: Math.max(1, Math.ceil(total / limitNum)),
      limit: limitNum,
    });
  } catch {
    return sendError(res, "SERVER_ERROR", "Could not load services.");
  }
});

/** GET /api/services/:id — public single service. */
router.get("/:id", async (req, res) => {
  const { id } = req.params;
  if (!ObjectId.isValid(id)) {
    return sendError(res, "INVALID_ID", "We couldn't find that service.");
  }
  try {
    const service = await col("services").findOne({ _id: new ObjectId(id) });
    if (!service) return sendError(res, "INVALID_ID", "We couldn't find that service.");
    return res.json({ service: shapeService(service) });
  } catch {
    return sendError(res, "SERVER_ERROR", "Could not load that service.");
  }
});

/** POST /api/services — create a listing; starts as "pending" for admin approval. */
router.post("/", verifyTechnician, async (req, res) => {
  const { error, value } = validateServicePayload(req.body);
  if (error) return sendError(res, "VALIDATION", error);

  try {
    const doc = {
      ...value,
      technicianName: req.user.name || "FixMate Technician",
      technicianEmail: String(req.user.email).toLowerCase(),
      approvalStatus: "pending",
      isAvailable: true,
      ratingAverage: 0,
      ratingCount: 0,
      createdAt: new Date(),
    };
    const result = await col("services").insertOne(doc);
    return res
      .status(201)
      .json({ message: "Service submitted for approval.", service: shapeService({ _id: result.insertedId, ...doc }) });
  } catch {
    return sendError(res, "SERVER_ERROR", "Could not create the service.");
  }
});

/** PATCH /api/services/:id — owner edit; any edit resets approval to "pending". */
router.patch("/:id", verifyTechnician, async (req, res) => {
  const { id } = req.params;
  if (!ObjectId.isValid(id)) return sendError(res, "INVALID_ID", "We couldn't find that service.");

  const { error, value } = validateServicePayload(req.body);
  if (error) return sendError(res, "VALIDATION", error);

  try {
    const _id = new ObjectId(id);
    const services = col("services");
    const existing = await services.findOne({ _id });
    if (!existing) return sendError(res, "INVALID_ID", "We couldn't find that service.");
    if (String(existing.technicianEmail).toLowerCase() !== String(req.user.email).toLowerCase()) {
      return sendError(res, "FORBIDDEN", "This isn't your service.");
    }

    const updated = await services.findOneAndUpdate(
      { _id },
      { $set: { ...value, approvalStatus: "pending", updatedAt: new Date() } },
      { returnDocument: "after" }
    );
    return res.json({
      message: "Service updated and sent for re-approval.",
      service: shapeService(updated),
    });
  } catch {
    return sendError(res, "SERVER_ERROR", "Could not update the service.");
  }
});

/** PATCH /api/services/:id/availability — owner show/hide toggle. */
router.patch("/:id/availability", verifyTechnician, async (req, res) => {
  const { id } = req.params;
  if (!ObjectId.isValid(id)) return sendError(res, "INVALID_ID", "We couldn't find that service.");

  const { isAvailable } = req.body ?? {};
  if (typeof isAvailable !== "boolean") {
    return sendError(res, "VALIDATION", "isAvailable must be true or false.");
  }

  try {
    const _id = new ObjectId(id);
    const services = col("services");
    const existing = await services.findOne({ _id });
    if (!existing) return sendError(res, "INVALID_ID", "We couldn't find that service.");
    if (String(existing.technicianEmail).toLowerCase() !== String(req.user.email).toLowerCase()) {
      return sendError(res, "FORBIDDEN", "This isn't your service.");
    }

    const updated = await services.findOneAndUpdate(
      { _id },
      { $set: { isAvailable } },
      { returnDocument: "after" }
    );
    return res.json({
      message: isAvailable ? "Service is now available." : "Service is now hidden.",
      service: shapeService(updated),
    });
  } catch {
    return sendError(res, "SERVER_ERROR", "Could not update availability.");
  }
});

/** DELETE /api/services/:id — owner removal. */
router.delete("/:id", verifyTechnician, async (req, res) => {
  const { id } = req.params;
  if (!ObjectId.isValid(id)) return sendError(res, "INVALID_ID", "We couldn't find that service.");

  try {
    const _id = new ObjectId(id);
    const services = col("services");
    const existing = await services.findOne({ _id });
    if (!existing) return sendError(res, "INVALID_ID", "We couldn't find that service.");
    if (String(existing.technicianEmail).toLowerCase() !== String(req.user.email).toLowerCase()) {
      return sendError(res, "FORBIDDEN", "This isn't your service.");
    }

    await services.deleteOne({ _id });
    return res.json({ message: "Service removed." });
  } catch {
    return sendError(res, "SERVER_ERROR", "Could not remove the service.");
  }
});

export default router;
