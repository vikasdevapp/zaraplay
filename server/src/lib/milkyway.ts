import { createHash } from "crypto";
import { GamePlatformClient, JuwaConfig, JuwaError } from "./juwa";

/**
 * MilkyWay-family agent API connector (also Orion Stars). Protocol: a single endpoint
 * `/ws/service.ashx?action=...`, agent logs in with agentName + MD5(password) to get an `agentKey`
 * (rotates on every successful login), and every later call is signed with
 *   sign = md5((agentName + time + agentKey).toLowerCase())
 * using a fresh `time` (ms) each call. Players are addressed by their account name (not a numeric
 * id), so our `userId` === the account. Passwords are sent MD5-hashed; the player still logs in
 * with the plain password.
 *
 * Config reuses JuwaConfig: agentId = agentName, secretKey = agent password (plain; we MD5 it),
 * balanceDivisor scales platform balances to dollars on reads.
 *
 * Response envelope: { code, msg, agentKey?, Balance?, agentBalance?, userbalance?, gameId? }.
 * code 200 = success, 201 = failure.
 */

const md5 = (s: string) => createHash("md5").update(s).digest("hex");

// The working signature recipe per agent (timestamp unit, string case, hex case), learned on the
// first call and reused thereafter so we don't re-probe every time.
interface SignStrategy {
  ms: boolean;
  lowerInput: boolean;
  upperHex: boolean;
}
const SIGN_STRATEGY = new Map<string, SignStrategy>();

type MwEnvelope = Record<string, unknown>;

// These panels are inconsistent about field casing and sometimes nest the payload under `data`,
// so look a value up case-insensitively at the top level and inside `data`.
function pickField(json: MwEnvelope, ...names: string[]): unknown {
  const sources: Record<string, unknown>[] = [json];
  if (json.data && typeof json.data === "object") sources.push(json.data as Record<string, unknown>);
  for (const src of sources) {
    const lower = new Map(Object.entries(src).map(([k, v]) => [k.toLowerCase(), v]));
    for (const n of names) {
      const v = lower.get(n.toLowerCase());
      if (v !== undefined && v !== null && v !== "") return v;
    }
  }
  return undefined;
}

export class MilkyWayClient implements GamePlatformClient {
  private agentKey: string | null = null;
  constructor(private config: JuwaConfig) {}

  private body(params: Record<string, string | number>) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
    return qs;
  }

  // Remembers the session cookie the panel sets at login (ASP.NET .ashx session), so signed calls
  // that follow are recognised as part of the same session (otherwise they fail "Session timeout").
  private cookies = new Map<string, string>();
  // Seconds to add to our clock to get the platform's (from its Date response header).
  private serverSkew = 0;

  private cookieHeader(): string | undefined {
    if (!this.cookies.size) return undefined;
    return Array.from(this.cookies, ([k, v]) => `${k}=${v}`).join("; ");
  }

  private storeCookies(res: Response) {
    const getSetCookie = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
    const list = getSetCookie ? getSetCookie.call(res.headers) : (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")!] : []);
    for (const c of list) {
      const pair = c.split(";", 1)[0];
      const eq = pair.indexOf("=");
      if (eq > 0) this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  private async post(params: Record<string, string | number>): Promise<{ json: MwEnvelope; raw: string }> {
    // Params go in the query string ONLY (as the docs' reference URLs show). Sending them in both
    // the query and a form body makes ASP.NET's Request.Params join the duplicates with a comma
    // ("time=1591..,1591.."), which corrupts the value the server rebuilds the signature from.
    const url = `${this.config.baseUrl}/ws/service.ashx?${this.body(params).toString()}`;
    const headers: Record<string, string> = {};
    const cookie = this.cookieHeader();
    if (cookie) headers.Cookie = cookie;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers,
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      // Node's fetch surfaces only "fetch failed"; the real reason (TLS cert, ECONNREFUSED,
      // ETIMEDOUT, DNS) is on err.cause — include it so connectivity/whitelist issues are clear.
      const cause = (err as { cause?: { code?: string; message?: string } })?.cause;
      const detail = cause?.code || cause?.message || (err instanceof Error ? err.message : "network error");
      throw new JuwaError(-1, `Could not reach the game platform (${detail}). Check the base URL/port and that this server's IP is whitelisted on the game panel.`, true);
    }
    this.storeCookies(res);
    // The server's Date header reveals its clock, so we can detect skew vs ours (these panels may
    // validate the signature against their own clock rather than the time we send).
    const dateHeader = res.headers.get("date");
    if (dateHeader) {
      const serverSec = Math.floor(new Date(dateHeader).getTime() / 1000);
      if (Number.isFinite(serverSec)) this.serverSkew = serverSec - Math.floor(Date.now() / 1000);
    }
    const raw = await res.text();
    let json: MwEnvelope;
    try {
      json = JSON.parse(raw) as MwEnvelope;
    } catch {
      throw new JuwaError(res.status, `Game platform returned a non-JSON response (HTTP ${res.status}): ${raw.slice(0, 180)}`, res.status >= 500);
    }
    // `code` comes back as a number on some actions and a string ("200") on others, so compare
    // numerically. On failure include the raw body so the real reason is visible.
    const code = pickField(json, "code", "status_code");
    if (Number(code) !== 200) {
      const c = Number.isFinite(Number(code)) ? Number(code) : res.status;
      const msg = pickField(json, "msg", "message");
      throw new JuwaError(c, (typeof msg === "string" && msg) || `Game platform error: ${raw.slice(0, 180)}`, c >= 500);
    }
    return { json, raw };
  }

  // Timestamps are a 10-digit epoch in SECONDS. Two constraints together:
  //  - The signature must use the platform's *current* second (it recomputes the sign against its
  //    own clock, so a value even 1s ahead fails "Signature error").
  //  - Each `time` is single-use ("expires after being used successfully once"), so a login and the
  //    signed call after it must not share a second, or it fails "Session timeout".
  // So return the real current second, but if it was already used, WAIT for the real clock to tick
  // to the next second (never guess a future value, which would drift ahead of the platform).
  private lastTime = 0;
  private async freshTime(): Promise<number> {
    let t = Math.floor(Date.now() / 1000);
    while (t <= this.lastTime) {
      await new Promise((r) => setTimeout(r, 300));
      t = Math.floor(Date.now() / 1000);
    }
    this.lastTime = t;
    return t;
  }

  /** Logs in to obtain the rotating agentKey used to sign later calls. */
  private lastLoginRaw = "";

  private async login(): Promise<MwEnvelope> {
    const { json, raw } = await this.post({ action: "agentLogin", agentName: this.config.agentId, agentPasswd: md5(this.config.secretKey), time: await this.freshTime() });
    this.lastLoginRaw = raw;
    const key = pickField(json, "agentKey", "agentkey", "key");
    if (!key) throw new JuwaError(201, `Agent login did not return a key. Response: ${raw.slice(0, 200)}`, false);
    this.agentKey = String(key);
    return json;
  }

  private async ensureKey(): Promise<string> {
    if (this.agentKey) return this.agentKey;
    await this.login();
    return this.agentKey!;
  }

  // Builds the (time, sign) pair for a given strategy. `ms` => time in milliseconds (the docs say
  // System.currentTimeMillis()), else seconds. `lowerInput` lowercases the pre-hash string (docs),
  // `upperHex` uppercases the md5 output (the key comes back uppercase).
  private async makeSign(strat: SignStrategy): Promise<{ time: number; sign: string }> {
    const time = strat.ms ? Date.now() : await this.freshTime();
    const s = `${this.config.agentId}${time}${this.agentKey}`;
    let sign = md5(strat.lowerInput ? s.toLowerCase() : s);
    if (strat.upperHex) sign = sign.toUpperCase();
    return { time, sign };
  }

  /**
   * Runs a signed action. The panels are inconsistent about timestamp unit, string case and hex
   * case, so the first time we probe the combinations and remember the one that works; after that
   * every call uses it directly.
   */
  private async signed(action: string, params: Record<string, string | number>): Promise<{ json: MwEnvelope; raw: string }> {
    const name = this.config.agentId;
    const sk = `${this.config.baseUrl}|${name}`;

    // Fast path: a known-good strategy — reuse the logged-in key, re-login if needed.
    const known = SIGN_STRATEGY.get(sk);
    if (known) {
      await this.ensureKey();
      const { time, sign } = await this.makeSign(known);
      try {
        return await this.post({ action, agentName: name, time, sign, ...params });
      } catch (err) {
        // A rotated/expired key shows up as a non-5xx error — re-login once and retry.
        if (err instanceof JuwaError && !err.retryable) {
          this.agentKey = null;
          await this.ensureKey();
          const r = await this.makeSign(known);
          return await this.post({ action, agentName: name, time: r.time, sign: r.sign, ...params });
        }
        throw err;
      }
    }

    // Probe: one fresh login, then try the combinations (millis first, per the docs).
    this.agentKey = null;
    await this.login();
    const keyLen = (this.agentKey as string | null)?.length ?? 0;
    const combos: (SignStrategy & { label: string })[] = [
      { label: "lc/lcHex/ms", ms: true, lowerInput: true, upperHex: false },
      { label: "raw/lcHex/ms", ms: true, lowerInput: false, upperHex: false },
      { label: "lc/UCHex/ms", ms: true, lowerInput: true, upperHex: true },
      { label: "raw/UCHex/ms", ms: true, lowerInput: false, upperHex: true },
      { label: "lc/lcHex/sec", ms: false, lowerInput: true, upperHex: false },
      { label: "raw/lcHex/sec", ms: false, lowerInput: false, upperHex: false },
    ];
    const trace: string[] = [];
    for (const c of combos) {
      const { time, sign } = await this.makeSign(c);
      try {
        const res = await this.post({ action, agentName: name, time, sign, ...params });
        SIGN_STRATEGY.set(sk, { ms: c.ms, lowerInput: c.lowerInput, upperHex: c.upperHex });
        return res;
      } catch (err) {
        const msg = err instanceof JuwaError ? `${err.code}:${err.message}` : err instanceof Error ? err.message : String(err);
        trace.push(`${c.label} t=${time}->${msg}`);
      }
    }
    const diag = `name="${name}", keyLen=${keyLen}, skew=${this.serverSkew}s`;
    throw new JuwaError(201, `all sign variants failed: ${trace.join(" | ")} [${diag}]`, false);
  }

  async addUser(account: string, loginPwd: string) {
    await this.signed("registerUser", { account, passwd: md5(loginPwd) });
    // Operations address the player by account name; there's no separate numeric id.
    return { accountName: account, userId: account };
  }

  async getUserId(accountName: string): Promise<string> {
    // The account name is the platform handle used by every call, so it's its own id.
    return accountName;
  }

  async recharge(account: string, amount: number, orderId: string) {
    // Send the exact amount (not rounded) so cents aren't silently dropped; if the platform
    // rejects a non-integer it errors and the action falls back to the agent queue.
    await this.signed("recharge", { account, amount });
    return { transactionId: orderId };
  }

  async withdraw(account: string, amount: number, orderId: string) {
    await this.signed("redeem", { account, amount });
    return { transactionId: orderId };
  }

  async userBalance(account: string): Promise<number> {
    const { json } = await this.signed("queryInfo", { account });
    const bal = pickField(json, "userbalance", "userBalance", "balance");
    return Math.round((Number(bal ?? 0) / this.config.balanceDivisor) * 100) / 100;
  }

  async agentBalance(): Promise<number> {
    const json = await this.login();
    const bal = pickField(json, "Balance", "balance", "agentBalance", "money");
    return Math.round((Number(bal ?? 0) / this.config.balanceDivisor) * 100) / 100;
  }

  async resetPassword(account: string, loginPwd: string): Promise<void> {
    // passwd (the old one) is optional on this family, so we only send the new password.
    await this.signed("changePasswd", { account, passwdNew: md5(loginPwd) });
  }

  // No force-offline action in the core protocol; it's best-effort in the withdraw flow, so no-op.
  async playerOffline(): Promise<void> {
    return;
  }
}

// One shared client per unique credential set. These panels rotate the agentKey on every login and
// invalidate the previous one, so if each operation (and Test Connection) built its own client and
// logged in separately, they'd invalidate each other's key — the next signed call then fails
// "Session timeout". Reusing one instance keeps a single logged-in session whose key is shared.
const clients = new Map<string, MilkyWayClient>();
export function getMilkyWayClient(config: JuwaConfig): MilkyWayClient {
  const sig = `${config.baseUrl}|${config.agentId}|${config.secretKey}|${config.balanceDivisor}`;
  let c = clients.get(sig);
  if (!c) {
    c = new MilkyWayClient(config);
    clients.set(sig, c);
  }
  return c;
}
