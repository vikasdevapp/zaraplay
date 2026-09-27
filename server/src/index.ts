import "dotenv/config";
// Routes errors thrown in async handlers to the error handler below instead of an unhandled
// rejection (which would crash the process).
import "express-async-errors";
import path from "path";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { authRouter } from "./routes/auth";
import { walletRouter } from "./routes/wallet";
import { gamesRouter } from "./routes/games";
import { profileRouter } from "./routes/profile";
import { referralRouter } from "./routes/referral";
import { supportRouter } from "./routes/support";
import { adminRouter } from "./routes/admin";
import { agentRouter } from "./routes/agent";
import { marketplaceRouter } from "./routes/marketplace";
import { vipRouter } from "./routes/vip";
import { rouletteRouter } from "./routes/roulette";
import { phoneRouter } from "./routes/phone";
import { pushRouter } from "./routes/push";
import { leaderboardRouter } from "./routes/leaderboard";
import { emailRouter } from "./routes/email";
import { paymentsRouter } from "./routes/payments";
import { startPaymentReconciler } from "./jobs/paymentReconciler";
import { startCashoutTimeoutSweeper } from "./jobs/cashoutTimeoutSweeper";

const app = express();

app.set("trust proxy", 1);

// Comma-separated so the three planned subdomains (website/admin/agent) can share one API
// once they exist — e.g. CORS_ORIGIN="https://website.example.com,https://admin.example.com".
const allowedOrigins = (process.env.CORS_ORIGIN || "http://localhost:3000").split(",").map((o) => o.trim());

// A page calling the API on its own host (e.g. the Agent Desk on backend.zaraplays.com, where
// nginx proxies /api) is same-origin, so it's always allowed without listing every host.
function isSameHost(origin: string, host: string | undefined) {
  try {
    return !!host && new URL(origin).host === host;
  } catch {
    return false;
  }
}

app.use(
  cors((req, callback) => {
    const origin = req.headers.origin;
    const allowed = !origin || allowedOrigins.includes(origin) || isSameHost(origin, req.headers.host);
    if (!allowed) return callback(new Error("Not allowed by CORS"));
    callback(null, { origin: true, credentials: true });
  })
);
app.use(express.json());

// Mounted ahead of the global throttle: gateway callbacks all arrive from one IP and a burst
// of retries must not be rate-limited into failure.
app.use("/api/payments", paymentsRouter);

// Coarse global throttle; per-route limits (e.g. signup IP cap) layer on top of this.
app.use(
  rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.get("/health", (_req, res) => res.json({ ok: true }));
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

app.use("/api/auth", authRouter);
app.use("/api/wallet", walletRouter);
app.use("/api/games", gamesRouter);
app.use("/api/profile", profileRouter);
app.use("/api/referral", referralRouter);
app.use("/api/support", supportRouter);
app.use("/api/admin", adminRouter);
app.use("/api/agent", agentRouter);
app.use("/api/marketplace", marketplaceRouter);
app.use("/api/vip", vipRouter);
app.use("/api/roulette", rouletteRouter);
app.use("/api/phone", phoneRouter);
app.use("/api/push", pushRouter);
app.use("/api/leaderboard", leaderboardRouter);
app.use("/api/email", emailRouter);

app.use((_req, res) => res.status(404).json({ error: "Not found." }));

// Catches multer errors (bad file type, too large) and anything else thrown in a route
// so the client always gets JSON back instead of Express's default HTML error page.
app.use((err: Error & { status?: number; statusCode?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  if (err.message === "Not allowed by CORS") return res.status(403).json({ error: "Not allowed." });
  // Upload validation (lib/upload.ts file filter, multer size limits) is the admin's input error.
  if (err.name === "MulterError" || err.message.startsWith("Only PNG")) return res.status(400).json({ error: err.message });
  // Client errors raised by middleware (e.g. malformed JSON) carry their own 4xx status.
  const status = err.status || err.statusCode;
  if (status && status >= 400 && status < 500) return res.status(status).json({ error: err.message || "Invalid request." });
  res.status(500).json({ error: "Something went wrong. Please try again." });
});

const port = Number(process.env.PORT || 4000);
app.listen(port, () => {
  console.log(`Zara Plays API listening on :${port}`);
  startPaymentReconciler();
  startCashoutTimeoutSweeper();
});
