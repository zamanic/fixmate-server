import "dotenv/config";
import express from "express";
import cors from "cors";
import { connectToMongoDB } from "./lib/mongo.js";
import { sendError } from "./lib/errors.js";
import userRoutes from "./routes/userRoutes.js";
import serviceRoutes from "./routes/serviceRoutes.js";
import bookingRoutes from "./routes/bookingRoutes.js";
import paymentRoutes, { webhookHandler } from "./routes/paymentRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";

const app = express();
const PORT = process.env.PORT || 8000;

// --- CORS: explicit allow-list (never a wide-open `cors()`) ---
const allowedOrigins = (process.env.CLIENT_URL || "http://localhost:3000")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      // allow same-origin / server-to-server calls with no Origin header
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
  })
);

// --- Stripe webhook: needs the RAW body, so it must precede express.json() ---
app.post("/api/payments/webhook", express.raw({ type: "application/json" }), webhookHandler);

app.use(express.json({ limit: "2mb" }));

// --- Health check ---
app.get("/", (req, res) => {
  res.json({
    message: "FixMate API is running fine!",
    service: "fixmate-server",
    time: new Date().toISOString(),
  });
});

// --- Routes ---
app.use("/api/users", userRoutes);
app.use("/api/services", serviceRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/admin", adminRoutes);

// --- 404: unknown API route, same error envelope ---
app.use((req, res) => {
  sendError(res, "INVALID_ID", `No route matches ${req.method} ${req.originalUrl}.`);
});

// --- Central error handler: Express 5 forwards async rejections here ---
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("[fixmate] unhandled error:", err);
  if (res.headersSent) return;
  sendError(res, "SERVER_ERROR", "Something went wrong on our side. Please try again.");
});

await connectToMongoDB();

// On Vercel the platform owns the listener; locally we listen ourselves.
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`FixMate server running at http://localhost:${PORT}`);
  });
}

export default app;
