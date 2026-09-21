import "dotenv/config";
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

const app = express();

app.set("trust proxy", 1);

// Comma-separated so the three planned subdomains (website/admin/agent) can share one API
// once they exist — e.g. CORS_ORIGIN="https://website.example.com,https://admin.example.com".
const allowedOrigins = (process.env.CORS_ORIGIN || "http://localhost:3000").split(",").map((o) => o.trim());
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);
app.use(express.json());

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

app.use((_req, res) => res.status(404).json({ error: "Not found." }));

// Catches multer errors (bad file type, too large) and anything else thrown in a route
// so the client always gets JSON back instead of Express's default HTML error page.
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(400).json({ error: err.message || "Something went wrong." });
});

const port = Number(process.env.PORT || 4000);
app.listen(port, () => {
  console.log(`Zara Plays API listening on :${port}`);
});
