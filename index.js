import express from "express";
import cors from "cors";
import "dotenv/config";
import { connectToMongoDB } from "./lib/mongo.js";

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

app.use(express.json({ limit: "2mb" }));

// --- Health check ---
app.get("/", (req, res) => {
  res.json({
    message: "FixMate API is running fine!",
    service: "fixmate-server",
    time: new Date().toISOString(),
  });
});

await connectToMongoDB();

// On Vercel the platform owns the listener; locally we listen ourselves.
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`FixMate server running at http://localhost:${PORT}`);
  });
}

export default app;
