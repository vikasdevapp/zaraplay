import { GamePlatformClient, JuwaConfig, JuwaError } from "./juwa";

/**
 * Cash Frenzy agent API connector. Unlike the Juwa family (agent_id + secret, MD5-signed), this
 * platform logs in with an agent username + password to get a Bearer token (cached ~6h) used on
 * every call. Config reuses JuwaConfig: agentId = username, secretKey = password.
 *
 * Response envelope: { status_code, message, data, count }; status_code 200 = success.
 *
 * Note: insertPlayer does not return the platform player id, so after creating a player we look up
 * its id from playerList by the (unique) username we created.
 */

interface CfEnvelope<T> {
  status_code?: number;
  code?: number;
  message?: string;
  data?: T;
  count?: number;
}

interface PlayerRow {
  Account: string;
  id: number | string;
}

export class CashFrenzyClient implements GamePlatformClient {
  private token: string | null = null;
  private tokenExpiresAt = 0; // epoch seconds
  constructor(private config: JuwaConfig) {}

  private async request<T>(method: "GET" | "POST", path: string, opts: { form?: Record<string, string | number>; auth?: boolean } = {}): Promise<T> {
    const headers: Record<string, string> = {};
    if (opts.auth) headers.Authorization = `Bearer ${await this.ensureToken()}`;
    let body: FormData | undefined;
    if (opts.form) {
      body = new FormData();
      for (const [k, v] of Object.entries(opts.form)) body.set(k, String(v));
    }
    let res: Response;
    try {
      res = await fetch(`${this.config.baseUrl}${path}`, { method, headers, body, signal: AbortSignal.timeout(20_000) });
    } catch (err) {
      throw new JuwaError(-1, `Could not reach the game platform: ${err instanceof Error ? err.message : "network error"}`, true);
    }
    let json: CfEnvelope<T>;
    try {
      json = (await res.json()) as CfEnvelope<T>;
    } catch {
      throw new JuwaError(res.status, `Game platform returned a non-JSON response (HTTP ${res.status}).`, res.status >= 500);
    }
    if (json.status_code !== 200) {
      const code = json.code ?? json.status_code ?? res.status;
      throw new JuwaError(code, json.message || `Game platform error (code ${code}).`, code >= 500);
    }
    return json.data as T;
  }

  /** Logs in (if needed) and returns a valid token. */
  private async ensureToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.token && now < this.tokenExpiresAt - 60) return this.token;
    const data = await this.request<{ token: string; money?: string; expires_time?: number }>("POST", "/api/agent/login", {
      form: { username: this.config.agentId, password: this.config.secretKey },
    });
    this.token = data.token;
    this.tokenExpiresAt = Number(data.expires_time) || now + 3600;
    return this.token;
  }

  async addUser(account: string, loginPwd: string) {
    await this.request<unknown>("POST", "/api/player/insertPlayer", {
      auth: true,
      form: { username: account, nickname: account, password: loginPwd, money: "0" },
    });
    // insertPlayer doesn't return the id — look it up by the username we just created.
    const userId = await this.getUserId(account);
    return { accountName: account, userId };
  }

  async getUserId(accountName: string): Promise<string> {
    const target = accountName.toLowerCase();
    // Try a filtered query first (many panels accept it), then fall back to scanning recent pages.
    for (let page = 1; page <= 10; page++) {
      const rows = await this.request<PlayerRow[]>("GET", `/api/player/playerList?limit=100&page=${page}&username=${encodeURIComponent(accountName)}`, { auth: true });
      const list = Array.isArray(rows) ? rows : [];
      const match = list.find((r) => String(r.Account).toLowerCase() === target);
      if (match) return String(match.id);
      if (list.length < 100) break; // no further pages
    }
    throw new JuwaError(8, "Could not find the player on the platform after creating it.", true);
  }

  async recharge(userId: string, amount: number, orderId: string) {
    await this.request<unknown>("POST", "/api/player/playerRecharge", { auth: true, form: { id: userId, balance: amount, remark: orderId } });
    return { transactionId: orderId };
  }

  async withdraw(userId: string, amount: number, orderId: string) {
    await this.request<unknown>("POST", "/api/player/playerWithdraw", { auth: true, form: { id: userId, balance: amount, remark: orderId } });
    return { transactionId: orderId };
  }

  async userBalance(userId: string): Promise<number> {
    const data = await this.request<{ balance: number | string }>("GET", `/api/player/getScore?id=${encodeURIComponent(userId)}`, { auth: true });
    return Math.round((Number(data.balance) / this.config.balanceDivisor) * 100) / 100;
  }

  async agentBalance(): Promise<number> {
    const now = Math.floor(Date.now() / 1000);
    const data = await this.request<{ token: string; money?: string; expires_time?: number }>("POST", "/api/agent/login", {
      form: { username: this.config.agentId, password: this.config.secretKey },
    });
    this.token = data.token;
    this.tokenExpiresAt = Number(data.expires_time) || now + 3600;
    return Math.round((Number(data.money ?? 0) / this.config.balanceDivisor) * 100) / 100;
  }

  // Cash Frenzy has no password-reset endpoint — let the caller fall back to a manual agent request.
  async resetPassword(): Promise<void> {
    throw new JuwaError(-1, "Password reset isn't available for this platform.", false);
  }

  // No force-offline endpoint; it's a best-effort call in the withdraw flow, so this is a no-op.
  async playerOffline(): Promise<void> {
    return;
  }
}
