import crypto from "crypto";
import express from "express";
import multer from "multer";

/**
 * Mock Juwa agent API for local testing — implements the documented endpoints, signature check
 * and status-code dictionary so the connector and automation flow can be tested end to end
 * without the real platform. Balances are kept in whole dollars (divisor 1).
 *
 *   JUWA_AGENT_ID=1 JUWA_SECRET_KEY=test tsx scripts/mock-juwa.ts   (listens on :4901)
 */

const PORT = Number(process.env.MOCK_JUWA_PORT || 4901);
const AGENT_ID = process.env.JUWA_AGENT_ID || "1";
const SECRET = process.env.JUWA_SECRET_KEY || "test";

interface Player {
  userId: string;
  account: string;
  pwd: string;
  balance: number; // dollars
  online: boolean;
}

const players = new Map<string, Player>(); // userId -> player
const byAccount = new Map<string, string>(); // lowercased account -> userId
let agentBalance = 100000;
let nextId = 88880000;

const app = express();
const upload = multer();

const ok = (res: express.Response, data: unknown) => res.json({ code: 0, msg: "Success", data, count: 0 });
const err = (res: express.Response, code: number, msg: string) => res.json({ code, msg, data: null, count: 0 });

// Every endpoint is signed; this mirrors the real server's auth so bad tokens are rejected.
app.use("/api/external", upload.none(), (req, res, next) => {
  const { agent_id, timestamp, token } = req.body as Record<string, string>;
  if (agent_id !== AGENT_ID) return err(res, 1, "Invalid agent ID");
  if (!timestamp || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return err(res, 4, "Token expired");
  const expected = crypto.createHash("md5").update(`${agent_id}:${timestamp}:${SECRET}`).digest("hex");
  if (token !== expected) return err(res, 3, "Invalid token");
  next();
});

app.post("/api/external/addUser", (req, res) => {
  const { account, login_pwd } = req.body as Record<string, string>;
  if (!account || !/^[A-Za-z0-9_]+$/.test(account)) return err(res, 18, "Account name format error");
  if (!login_pwd || login_pwd.length < 6 || login_pwd.length > 32) return err(res, 23, "Password digits 6 to 32 characters");
  if (byAccount.has(account.toLowerCase())) return err(res, 20, "Account name already exists");
  const userId = String(nextId++);
  players.set(userId, { userId, account, pwd: login_pwd, balance: 0, online: false });
  byAccount.set(account.toLowerCase(), userId);
  ok(res, { account_name: account, user_id: userId });
});

app.post("/api/external/recharge", (req, res) => {
  const { user_id, amount } = req.body as Record<string, string>;
  const p = players.get(user_id);
  if (!p) return err(res, 8, "Invalid user ID");
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return err(res, 11, "Invalid amount");
  if (agentBalance < amt) return err(res, 6, "Insufficient agent balance");
  agentBalance -= amt;
  p.balance += amt;
  ok(res, { agent_balance: String(agentBalance), amount: String(amt), user_balance: String(p.balance), transaction_id: `pay:${user_id}:${req.body.order_id}` });
});

app.post("/api/external/withdraw", (req, res) => {
  const { user_id, amount } = req.body as Record<string, string>;
  const p = players.get(user_id);
  if (!p) return err(res, 8, "Invalid user ID");
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return err(res, 11, "Invalid amount");
  if (p.online) return err(res, 10, "User is in game");
  if (p.balance < amt) return err(res, 7, "Insufficient user balance");
  p.balance -= amt;
  agentBalance += amt;
  ok(res, { agent_balance: String(agentBalance), amount: String(amt), user_balance: String(p.balance), transaction_id: `wdw:${user_id}:${req.body.order_id}`, wdw_order_id: `wdw:${user_id}:${req.body.order_id}` });
});

app.post("/api/external/userBalance", (req, res) => {
  const p = players.get((req.body as Record<string, string>).user_id);
  if (!p) return err(res, 8, "Invalid user ID");
  ok(res, { user_balance: String(p.balance) });
});

app.post("/api/external/agentBalance", (_req, res) => ok(res, { agent_balance: String(agentBalance) }));

app.post("/api/external/getUserID", (req, res) => {
  const id = byAccount.get(((req.body as Record<string, string>).account_name || "").toLowerCase());
  if (!id) return err(res, 8, "Invalid user ID");
  ok(res, { user_id: id });
});

app.post("/api/external/resetPassword", (req, res) => {
  const { user_id, login_pwd } = req.body as Record<string, string>;
  const p = players.get(user_id);
  if (!p) return err(res, 8, "Invalid user ID");
  if (!login_pwd || login_pwd.length < 6 || login_pwd.length > 32) return err(res, 23, "Password digits 6 to 32 characters");
  p.pwd = login_pwd;
  ok(res, null);
});

app.post("/api/external/playerOffline", (req, res) => {
  const p = players.get((req.body as Record<string, string>).user_id);
  if (!p) return err(res, 8, "Invalid user ID");
  p.online = false;
  ok(res, null);
});

// Test-only controls (not part of the real API): set a player's balance / online state to
// simulate winning or being mid-game.
app.post("/mock/set", upload.none(), (req, res) => {
  const { user_id, balance, online } = req.body as Record<string, string>;
  const p = players.get(user_id);
  if (!p) return res.status(404).json({ error: "no player" });
  if (balance !== undefined) p.balance = Number(balance);
  if (online !== undefined) p.online = online === "true" || online === "1";
  res.json({ ok: true, balance: p.balance, online: p.online });
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`[mock-juwa] listening on :${PORT} (agent ${AGENT_ID})`));
