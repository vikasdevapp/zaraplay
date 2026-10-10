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

interface MwEnvelope {
  code?: number;
  msg?: string;
  agentKey?: string;
  Balance?: number | string;
  agentBalance?: number | string;
  userbalance?: number | string;
  gameId?: number | string;
  status?: number;
}

export class MilkyWayClient implements GamePlatformClient {
  private agentKey: string | null = null;
  constructor(private config: JuwaConfig) {}

  private url(params: Record<string, string | number>) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
    return `${this.config.baseUrl}/ws/service.ashx?${qs.toString()}`;
  }

  private async post(params: Record<string, string | number>): Promise<MwEnvelope> {
    let res: Response;
    try {
      res = await fetch(this.url(params), { method: "POST", signal: AbortSignal.timeout(20_000) });
    } catch (err) {
      throw new JuwaError(-1, `Could not reach the game platform: ${err instanceof Error ? err.message : "network error"}`, true);
    }
    let json: MwEnvelope;
    try {
      json = (await res.json()) as MwEnvelope;
    } catch {
      throw new JuwaError(res.status, `Game platform returned a non-JSON response (HTTP ${res.status}).`, res.status >= 500);
    }
    if (json.code !== 200) {
      const code = json.code ?? res.status;
      throw new JuwaError(code, json.msg || `Game platform error (code ${code}).`, code >= 500);
    }
    return json;
  }

  /** Logs in to obtain the rotating agentKey used to sign later calls. */
  private async login(): Promise<MwEnvelope> {
    const data = await this.post({ action: "agentLogin", agentName: this.config.agentId, agentPasswd: md5(this.config.secretKey), time: Date.now() });
    if (!data.agentKey) throw new JuwaError(201, "Agent login did not return a key.", false);
    this.agentKey = data.agentKey;
    return data;
  }

  private async ensureKey(): Promise<string> {
    if (this.agentKey) return this.agentKey;
    await this.login();
    return this.agentKey!;
  }

  /** Runs a signed action; on an auth-style failure, re-logs in once and retries. */
  private async signed(action: string, params: Record<string, string | number>): Promise<MwEnvelope> {
    const run = async () => {
      const agentKey = await this.ensureKey();
      const time = Date.now();
      const sign = md5(`${this.config.agentId}${time}${agentKey}`.toLowerCase());
      return this.post({ action, agentName: this.config.agentId, time, sign, ...params });
    };
    try {
      return await run();
    } catch (err) {
      // A stale/rotated agentKey shows up as a non-5xx failure — re-login once and retry.
      if (err instanceof JuwaError && !err.retryable) {
        this.agentKey = null;
        return run();
      }
      throw err;
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
    const data = await this.signed("queryInfo", { account });
    return Math.round((Number(data.userbalance ?? 0) / this.config.balanceDivisor) * 100) / 100;
  }

  async agentBalance(): Promise<number> {
    const data = await this.login();
    return Math.round((Number(data.Balance ?? 0) / this.config.balanceDivisor) * 100) / 100;
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
