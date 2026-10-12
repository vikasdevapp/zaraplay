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
    // Send the params both in the query string and as a form-urlencoded body: these .ashx panels
    // read some actions from the query and others (sensitive fields like account/passwd) from the
    // POST body, so covering both avoids action-specific failures. The sign isn't affected.
    const body = this.body(params);
    const url = `${this.config.baseUrl}/ws/service.ashx?${body.toString()}`;
    const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
    const cookie = this.cookieHeader();
    if (cookie) headers.Cookie = cookie;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers,
        body,
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

  // The docs' sign examples all use a 10-digit epoch in SECONDS (despite mentioning millis), so
  // send seconds for both the `time` param and the signature.
  private now() {
    return Math.floor(Date.now() / 1000);
  }

  /** Logs in to obtain the rotating agentKey used to sign later calls. */
  private lastLoginRaw = "";

  private async login(): Promise<MwEnvelope> {
    const { json, raw } = await this.post({ action: "agentLogin", agentName: this.config.agentId, agentPasswd: md5(this.config.secretKey), time: this.now() });
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

  /**
   * Runs a signed action. These panels are inconsistent about the signature: the docs say lowercase
   * everything, but some verify against the raw-case agentName/agentKey. So on a "Signature error"
   * we try the lowercased sign first, then the raw-case one, and finally a fresh login (stale key).
   */
  private async signed(action: string, params: Record<string, string | number>): Promise<{ json: MwEnvelope; raw: string }> {
    try {
      return await this.signedInner(action, params);
    } catch (err) {
      // Enrich a persistent signed-call failure with diagnostics (server clock, cookie, login
      // response) so clock-skew / session issues can be told apart.
      if (err instanceof JuwaError && !err.retryable) {
        const diag = `srvEpoch=${this.now()}, srvTime=${new Date().toISOString()}, cookie=${this.cookies.size > 0}, keyLen=${this.agentKey?.length || 0}, login=${this.lastLoginRaw.slice(0, 120)}`;
        throw new JuwaError(err.code, `${err.message} [${diag}]`, err.retryable);
      }
      throw err;
    }
  }

  private async signedInner(action: string, params: Record<string, string | number>): Promise<{ json: MwEnvelope; raw: string }> {
    const attempt = async (lower: boolean) => {
      const agentKey = await this.ensureKey();
      const time = this.now();
      const base = `${this.config.agentId}${time}${agentKey}`;
      const sign = md5(lower ? base.toLowerCase() : base);
      return this.post({ action, agentName: this.config.agentId, time, sign, ...params });
    };
    const isSignErr = (e: unknown) => e instanceof JuwaError && !e.retryable && /sign/i.test(e.message);

    try {
      return await attempt(true); // documented: lowercase
    } catch (err) {
      if (!isSignErr(err)) {
        // A stale/rotated key or other non-5xx failure: re-login once and retry (lowercase).
        if (err instanceof JuwaError && !err.retryable) {
          this.agentKey = null;
          return attempt(true);
        }
        throw err;
      }
    }
    // Signature was rejected — try the raw-case variant, then a fresh login.
    try {
      return await attempt(false);
    } catch (err) {
      if (!isSignErr(err)) throw err;
      this.agentKey = null;
      return attempt(false);
    }
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
