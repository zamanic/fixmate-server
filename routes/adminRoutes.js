import { Router } from "express";
import { ObjectId } from "mongodb";
import { col } from "../lib/mongo.js";
import { sendError } from "../lib/errors.js";
import { verifyAdmin, userId } from "../middleware/verifyToken.js";
import { shapeUser } from "./userRoutes.js";
import { shapeService } from "./serviceRoutes.js";
import { shapeBooking } from "./bookingRoutes.js";
import { shapePayment } from "./paymentRoutes.js";

/**
 * Admin routes — CONTRACT §6. Every route is gated by `verifyAdmin`.
 */

const router = Router();

const ROLES = ["customer", "technician", "admin"];
const APPROVAL_STATUSES = ["pending", "approved", "rejected"];

/** GET /api/admin/users — no auth internals in the projection. */
router.get("/users", verifyAdmin, async (req, res) => {
  try {
    const docs = await col("user")
      .find({}, { projection: { password: 0 } })
      .sort({ createdAt: -1 })
      .toArray();
    return res.json({ items: docs.map(shapeUser) });
  } catch {
    return sendError(res, "SERVER_ERROR", "Could not load users.");
  }
});

/** PATCH /api/admin/users/:id/role — promote/demote a user; never your own role. */
router.patch("/users/:id/role", verifyAdmin, async (req, res) => {
  const { id } = req.params;
  if (!ObjectId.isValid(id)) return sendError(res, "INVALID_ID", "We couldn't find that user.");

  const { role } = req.body ?? {};
  if (!ROLES.includes(role)) return sendError(res, "VALIDATION", "Please pick a valid role.");
  if (id === userId(req)) return sendError(res, "FORBIDDEN", "You can't change your own role.");

  try {
    const updated = await col("user").findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: { role, updatedAt: new Date() } },
      { returnDocument: "after" }
    );
    if (!updated) return sendError(res, "INVALID_ID", "We couldn't find that user.");
    return res.json({ message: "Role updated.", user: shapeUser(updated) });
  } catch {
    return sendError(res, "SERVER_ERROR", "Could not update the role.");
  }
});

/** GET /api/admin/services — every service regardless of approval status. */
router.get("/services", verifyAdmin, async (req, res) => {
  try {
    const docs = await col("services").find({}).sort({ createdAt: -1 }).toArray();
    return res.json({ items: docs.map(shapeService) });
  } catch {
    return sendError(res, "SERVER_ERROR", "Could not load services.");
  }
});

/** PATCH /api/admin/services/:id/approval — approve / reject / revert a listing. */
router.patch("/services/:id/approval", verifyAdmin, async (req, res) => {
  const { id } = req.params;
  if (!ObjectId.isValid(id)) return sendError(res, "INVALID_ID", "We couldn't find that service.");

  const { approvalStatus } = req.body ?? {};
  if (!APPROVAL_STATUSES.includes(approvalStatus)) {
    return sendError(res, "VALIDATION", "Please pick a valid approval status.");
  }

  try {
    const updated = await col("services").findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: { approvalStatus, updatedAt: new Date() } },
      { returnDocument: "after" }
    );
    if (!updated) return sendError(res, "INVALID_ID", "We couldn't find that service.");
    return res.json({ message: `Service ${approvalStatus}.`, service: shapeService(updated) });
  } catch {
    return sendError(res, "SERVER_ERROR", "Could not update the service.");
  }
});

/** GET /api/admin/bookings — every booking. */
router.get("/bookings", verifyAdmin, async (req, res) => {
  try {
    const docs = await col("bookings").find({}).sort({ createdAt: -1 }).toArray();
    return res.json({ items: docs.map(shapeBooking) });
  } catch {
    return sendError(res, "SERVER_ERROR", "Could not load bookings.");
  }
});

/** GET /api/admin/payments — every payment. */
router.get("/payments", verifyAdmin, async (req, res) => {
  try {
    const docs = await col("payments").find({}).sort({ paidAt: -1 }).toArray();
    return res.json({ items: docs.map(shapePayment) });
  } catch {
    return sendError(res, "SERVER_ERROR", "Could not load payments.");
  }
});

/**
 * GET /api/admin/stats — one dashboard aggregation.
 *
 * `$facet` runs every sub-pipeline in a single round-trip; each facet seeds one
 * document (`$limit: 1`) and `$lookup`s the collection it needs, so users,
 * services, bookings and payments are all summarised in one call.
 */
router.get("/stats", verifyAdmin, async (req, res) => {
  try {
    const [facet = {}] = await col("user")
      .aggregate([
        {
          $facet: {
            users: [{ $group: { _id: "$role", count: { $sum: 1 } } }],
            services: [
              { $limit: 1 },
              {
                $lookup: {
                  from: "services",
                  pipeline: [{ $group: { _id: "$approvalStatus", count: { $sum: 1 } } }],
                  as: "rows",
                },
              },
              { $project: { _id: 0, rows: 1 } },
            ],
            available: [
              { $limit: 1 },
              {
                $lookup: {
                  from: "services",
                  pipeline: [{ $match: { isAvailable: true } }, { $count: "count" }],
                  as: "rows",
                },
              },
              { $project: { _id: 0, rows: 1 } },
            ],
            bookings: [
              { $limit: 1 },
              {
                $lookup: {
                  from: "bookings",
                  pipeline: [{ $group: { _id: "$status", count: { $sum: 1 } } }],
                  as: "rows",
                },
              },
              { $project: { _id: 0, rows: 1 } },
            ],
            monthlyBookings: [
              { $limit: 1 },
              {
                $lookup: {
                  from: "bookings",
                  pipeline: [
                    { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } }, count: { $sum: 1 } } },
                    { $sort: { _id: -1 } },
                    { $limit: 12 },
                    { $sort: { _id: 1 } },
                  ],
                  as: "months",
                },
              },
              { $project: { _id: 0, months: 1 } },
            ],
            topCategories: [
              { $limit: 1 },
              {
                $lookup: {
                  from: "bookings",
                  pipeline: [
                    { $group: { _id: "$category", count: { $sum: 1 } } },
                    { $sort: { count: -1 } },
                    { $limit: 6 },
                  ],
                  as: "categories",
                },
              },
              { $project: { _id: 0, categories: 1 } },
            ],
            revenue: [
              { $limit: 1 },
              {
                $lookup: {
                  from: "payments",
                  pipeline: [{ $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } }],
                  as: "paid",
                },
              },
              {
                $lookup: {
                  from: "bookings",
                  pipeline: [{ $match: { paymentStatus: "unpaid" } }, { $count: "count" }],
                  as: "unpaid",
                },
              },
              { $project: { _id: 0, paid: 1, unpaid: 1 } },
            ],
          },
        },
      ])
      .toArray();

    const sumCounts = (rows) => rows.reduce((acc, row) => acc + (row.count || 0), 0);
    const countFor = (rows, key) => rows.find((row) => row._id === key)?.count ?? 0;

    const roleRows = facet.users ?? [];
    const serviceRows = facet.services?.[0]?.rows ?? [];
    const statusRows = facet.bookings?.[0]?.rows ?? [];
    const months = facet.monthlyBookings?.[0]?.months ?? [];
    const categories = facet.topCategories?.[0]?.categories ?? [];
    const paidRow = facet.revenue?.[0]?.paid?.[0] ?? { total: 0, count: 0 };
    const unpaidRow = facet.revenue?.[0]?.unpaid?.[0] ?? { count: 0 };

    const byStatus = {
      requested: countFor(statusRows, "requested"),
      accepted: countFor(statusRows, "accepted"),
      "in-progress": countFor(statusRows, "in-progress"),
      completed: countFor(statusRows, "completed"),
      rejected: countFor(statusRows, "rejected"),
      cancelled: countFor(statusRows, "cancelled"),
    };

    return res.json({
      users: {
        total: sumCounts(roleRows),
        customers: countFor(roleRows, "customer"),
        technicians: countFor(roleRows, "technician"),
        admins: countFor(roleRows, "admin"),
      },
      services: {
        total: sumCounts(serviceRows),
        pending: countFor(serviceRows, "pending"),
        approved: countFor(serviceRows, "approved"),
        rejected: countFor(serviceRows, "rejected"),
        available: facet.available?.[0]?.rows?.[0]?.count ?? 0,
      },
      bookings: {
        total: sumCounts(statusRows),
        byStatus,
        active: byStatus.requested + byStatus.accepted + byStatus["in-progress"],
        completed: byStatus.completed,
      },
      revenue: {
        paidTotal: paidRow.total ?? 0,
        paidCount: paidRow.count ?? 0,
        unpaidCount: unpaidRow.count ?? 0,
      },
      charts: {
        monthlyBookings: months.map((row) => ({ month: row._id, count: row.count })),
        topCategories: categories.map((row) => ({ category: row._id, count: row.count })),
      },
    });
  } catch {
    return sendError(res, "SERVER_ERROR", "Could not load stats.");
  }
});

export default router;
