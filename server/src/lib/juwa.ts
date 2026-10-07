import crypto from "crypto";

/**
 * Juwa game-platform agent API (per the supplier's "API Documentation").
 *
 * Every call is multipart/form-data POST to {baseUrl}/api/external/<endpoint>, signed with the
 * agent's secret. Amounts we SEND (recharge/withdraw) are whole dollars. Balances we READ back
 * from the standalone userBalance / agentBalance endpoints are scaled by `balanceDivisor`
 * (the docs are inconsistent across endpoints, so it's configurable and must be calibrated with
 * a live $1 test before withdrawals are enabled — see JUWA_BALANCE_DIVISOR).
 *
 * The response envelope is always { code, msg, data, count }; code 0 is success, everything
 * else is an error from the Status Code Dictionary.
 */

export interface JuwaConfig {
  baseUrl: string;
  agentId: string;
  secretKey: string;
  balanceDivisor: number;
}

// Providers that speak this exact external API protocol. Each has its own BASE_URL / AGENT_ID /
// SECRET_KEY / BALANCE_DIVISOR env vars under its own prefix.
export type PlatformProvider = "JUWA" | "GAMEVAULT" | "JUWA2";

/** Reads one provider's config from the env (prefix = the provider name, e.g. JUWA_ / GAMEVAULT_). */
export function platformConfigFrom(provider: PlatformProvider, env: NodeJS.ProcessEnv = process.env): JuwaConfig | null {
  const baseUrl = (env[`${provider}_BASE_URL`] || "").replace(/\/+$/, "");
  const agentId = env[`${provider}_AGENT_ID`] || "";
  const secretKey = env[`${provider}_SECRET_KEY`] || "";
  if (!baseUrl || !agentId || !secretKey) return null;
  const divisor = Number(env[`${provider}_BALANCE_DIVISOR`]);
  return { baseUrl, agentId, secretKey, balanceDivisor: Number.isFinite(divisor) && divisor > 0 ? divisor : 1 };
}

export function juwaConfigFrom(env: NodeJS.ProcessEnv = process.env): JuwaConfig | null {
  return platformConfigFrom("JUWA", env);
}

// Error codes 1-23 / 400 from the dictionary, mapped to messages we can act on or show.
const STATUS_MESSAGES: Record<number, string> = {
  1: "Invalid agent ID",
  2: "Invalid request parameters",
  3: "Invalid token",
  4: "Token expired",
  5: "Server IP is not whitelisted",
  6: "Insufficient agent balance",
  7: "Insufficient user balance",
  8: "Invalid user ID",
  9: "User account frozen",
  10: "User is in the game",
  11: "Invalid amount",
  12: "Recharge failed, please try again later",
  13: "Recharge permission denied",
  14: "Withdrawal failed, please try again later",
  15: "Withdrawal amount exceeds daily limit",
  16: "Withdrawal under review",
  17: "Withdrawal permission denied",
  18: "Account name may only contain letters, numbers and underscores",
  19: "Agent has no permission to register users",
  20: "Account name already exists",
  21: "System failed",
  22: "Account registrations from this IP have hit the limit",
  23: "Password must be 6 to 32 characters",
  400: "Parameter error",
};

export class JuwaError extends Error {
  constructor(
    public code: number,
    message: string,
    public retryable = false
  ) {
    super(message);
  }
}

// Errors where retrying the same call later could succeed (vs. a permanent "bad input").
const RETRYABLE_CODES = new Set([12, 14, 21]);

export function signToken(agentId: string, timestamp: number, secretKey: string) {
  return crypto.createHash("md5").update(`${agentId}:${timestamp}:${secretKey}`).digest("hex");
}

interface Envelope<T> {
  code: number;
  msg?: string;
  data?: T;
  count?: number;
}

export class JuwaClient {
  constructor(private config: JuwaConfig) {}

  private async call<T>(endpoint: string, fields: Record<string, string | number>): Promise<T> {
    const timestamp = Math.floor(Date.now() / 1000);
    const form = new FormData();
    form.set("agent_id", this.config.agentId);
    form.set("timestamp", String(timestamp));
    form.set("token", signToken(this.config.agentId, timestamp, this.config.secretKey));
    for (const [k, v] of Object.entries(fields)) form.set(k, String(v));

    let res: Response;
    try {
      res = await fetch(`${this.config.baseUrl}/api/external/${endpoint}`, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      // Network/timeout: the operation can be retried (or fall back to a manual agent request).
      throw new JuwaError(-1, `Could not reach the game platform: ${err instanceof Error ? err.message : "network error"}`, true);
    }

    let json: Envelope<T>;
    try {
      json = (await res.json()) as Envelope<T>;
    } catch {
      throw new JuwaError(res.status, `Game platform returned a non-JSON response (HTTP ${res.status}).`, res.status >= 500);
    }
    if (json.code !== 0) {
      const message = STATUS_MESSAGES[json.code] || json.msg || `Game platform error (code ${json.code}).`;
      throw new JuwaError(json.code, message, RETRYABLE_CODES.has(json.code));
    }
    return json.data as T;
  }

  /** Create a player account. `account` must be letters/numbers/underscores; pwd 6-32 chars. */
  async addUser(account: string, loginPwd: string) {
    const data = await this.call<{ account_name: string; user_id: string }>("addUser", { account, login_pwd: loginPwd });
    return { accountName: data.account_name, userId: String(data.user_id) };
  }

  /** Load whole-dollar credits into a player account. orderId must be unique per recharge. */
  async recharge(userId: string, amount: number, orderId: string) {
    const data = await this.call<{ transaction_id: string; user_balance: string }>("recharge", { user_id: userId, amount, order_id: orderId });
    return { transactionId: String(data.transaction_id) };
  }

  /** Pull whole-dollar credits out of a player account (to the agent). orderId unique per withdraw. */
  async withdraw(userId: string, amount: number, orderId: string) {
    const data = await this.call<{ transaction_id: string; wdw_order_id: string; user_balance: string }>("withdraw", {
      user_id: userId,
      amount,
      order_id: orderId,
    });
    return { transactionId: String(data.transaction_id) };
  }

  /** Real player balance in dollars (raw value scaled by the configured divisor). */
  async userBalance(userId: string) {
    const data = await this.call<{ user_balance: string }>("userBalance", { user_id: userId });
    return Math.round((Number(data.user_balance) / this.config.balanceDivisor) * 100) / 100;
  }

  async agentBalance() {
    const data = await this.call<{ agent_balance: string }>("agentBalance", {});
    return Math.round((Number(data.agent_balance) / this.config.balanceDivisor) * 100) / 100;
  }

  async getUserId(accountName: string) {
    const data = await this.call<{ user_id: string }>("getUserID", { account_name: accountName });
    return String(data.user_id);
  }

  async resetPassword(userId: string, loginPwd: string) {
    await this.call<null>("resetPassword", { user_id: userId, login_pwd: loginPwd });
  }

  /** Kick a player out of the game (so a withdraw isn't blocked by code 10 "user in game"). */
  async playerOffline(userId: string) {
    await this.call<null>("playerOffline", { user_id: userId });
  }
}

export function getJuwaClient(env: NodeJS.ProcessEnv = process.env): JuwaClient | null {
  const config = juwaConfigFrom(env);
  return config ? new JuwaClient(config) : null;
}

/** A client for any supported platform provider, or null if its credentials aren't configured. */
export function getPlatformClient(provider: PlatformProvider, env: NodeJS.ProcessEnv = process.env): JuwaClient | null {
  const config = platformConfigFrom(provider, env);
  return config ? new JuwaClient(config) : null;
}
