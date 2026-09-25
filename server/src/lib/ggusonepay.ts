import crypto from "crypto";
import { isSecretBoxConfigured } from "./secretBox";

// GGUSOnePay gateway client: pay-in (deposits) via /api/pay/*, payouts via /api/transfer/*.
// Everything is driven by env so the same build runs against the test merchant and production.

const config = {
  baseUrl: (process.env.GGUSONEPAY_BASE_URL || "https://www.ggusonepay.com").replace(/\/+$/, ""),
  mchNo: process.env.GGUSONEPAY_MCH_NO || "",
  apiKey: process.env.GGUSONEPAY_API_KEY || "",
  currency: process.env.GGUSONEPAY_CURRENCY || "usd",
  // Public base URL of this API, used to build notifyUrl — must be reachable by the gateway.
  apiPublicUrl: (process.env.API_PUBLIC_URL || "").replace(/\/+$/, ""),
  // Public base URL of the website, used to build returnUrl after the cashier page.
  webPublicUrl: (process.env.WEB_PUBLIC_URL || "").replace(/\/+$/, ""),
  payWayCodes: list(process.env.GGUSONEPAY_PAY_WAY_CODES || "cashapp"),
  transferWayCodes: list(process.env.GGUSONEPAY_TRANSFER_WAY_CODES || ""),
  // Gateway's outbound IPs; callbacks from anywhere else are refused. Empty disables the check.
  notifyIps: list(process.env.GGUSONEPAY_NOTIFY_IPS || ""),
  // Test merchants only: "success"/"fail" in extParam makes the gateway auto-callback after ~1 min.
  sandboxAutoResult: process.env.GGUSONEPAY_SANDBOX_AUTO_RESULT || "",
  // Unpaid pay orders expire after this many seconds (gateway allows 1800–86400).
  orderExpireSeconds: Math.min(86400, Math.max(1800, Number(process.env.GGUSONEPAY_ORDER_EXPIRE_SECONDS) || 1800)),
};

function list(value: string) {
  return value.split(",").map((v) => v.trim()).filter(Boolean);
}

export const gateway = {
  get payEnabled() {
    return !!(config.mchNo && config.apiKey && config.apiPublicUrl && config.payWayCodes.length);
  },
  get transferEnabled() {
    return !!(config.mchNo && config.apiKey && config.apiPublicUrl && config.transferWayCodes.length);
  },
  payWayCodes: config.payWayCodes,
  // Only methods we can actually pay out; card also needs the encryption key for card numbers.
  get transferWayCodes() {
    return config.transferWayCodes.filter((w) => TRANSFER_METHODS.includes(w) && (w !== "card" || isSecretBoxConfigured()));
  },
  orderExpireSeconds: config.orderExpireSeconds,
};

// Order states shared by pay and transfer orders.
export const ORDER_STATE = {
  CREATED: 0,
  IN_PROGRESS: 1,
  SUCCESS: 2,
  FAILED: 3,
  CANCELLED: 4,
  REFUNDED: 5,
  CLOSED: 6,
  DISPUTED: 7,
} as const;

export const FINAL_FAILURE_STATES: number[] = [ORDER_STATE.FAILED, ORDER_STATE.CANCELLED, ORDER_STATE.CLOSED];

type Params = Record<string, unknown>;

function isEmpty(v: unknown) {
  return v === null || v === undefined || v === "";
}

// Plain code-unit ordering = ASCII order, as the protocol requires (localeCompare is not).
function asciiCompare(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

// Nested objects follow the same rules: keys sorted, empty values dropped.
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Params)
        .filter(([, v]) => !isEmpty(v))
        .sort(([a], [b]) => asciiCompare(a, b))
        .map(([k, v]) => [k, normalize(v)])
    );
  }
  return value;
}

export function signString(params: Params, key: string) {
  const pairs = Object.entries(params)
    .filter(([k, v]) => k !== "sign" && !isEmpty(v))
    .sort(([a], [b]) => asciiCompare(a, b))
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(normalize(v)) : String(v)}`);
  return `${pairs.join("&")}&key=${key}`;
}

function hash(str: string, signType: string) {
  const algo = { MD5: "md5", SHA1: "sha1", SHA256: "sha256" }[signType.toUpperCase()];
  if (!algo) throw new Error(`Unsupported signType: ${signType}`);
  return crypto.createHash(algo).update(str, "utf8").digest("hex").toUpperCase();
}

export function sign(params: Params, key = config.apiKey, signType = "MD5") {
  return hash(signString({ ...params, signType }, key), signType);
}

export function verifySign(params: Params, key = config.apiKey) {
  const provided = typeof params.sign === "string" ? params.sign.toUpperCase() : "";
  const signType = typeof params.signType === "string" && params.signType ? params.signType : "MD5";
  if (!provided) return false;
  let expected: string;
  try {
    expected = hash(signString(params, key), signType);
  } catch {
    return false;
  }
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function isAllowedNotifyIp(ip: string | undefined) {
  if (!config.notifyIps.length) return true;
  const normalized = (ip || "").replace(/^::ffff:/, "");
  return config.notifyIps.includes(normalized);
}

export class GatewayError extends Error {
  code: number | string;
  constructor(code: number | string, message: string) {
    super(message);
    this.code = code;
  }
}

interface GatewayResponse<T> {
  code: number;
  msg?: string;
  data?: T;
}

async function call<T>(path: string, body: Params): Promise<T> {
  const payload: Params = { ...body, mchNo: config.mchNo, timestamp: Date.now(), signType: "MD5" };
  payload.sign = sign(payload);

  const res = await fetch(`${config.baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new GatewayError(res.status, `Payment gateway HTTP ${res.status}`);

  const json = (await res.json()) as GatewayResponse<T>;
  if (json.code !== 0 || !json.data) {
    throw new GatewayError(json.code, json.msg || "Payment gateway rejected the request.");
  }
  return json.data;
}

// Amounts cross the wire as integer cents.
export function toCents(amount: number) {
  return Math.round(amount * 100);
}

export function publicIpv4(ip: string | undefined) {
  const v = (ip || "").replace(/^::ffff:/, "");
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(v) ? v : undefined;
}

export interface PayOrder {
  payOrderNo: string;
  mchOrderNo: string;
  state: number;
  cashierUrl: string;
  expireTimestamp: number;
  errCode?: string | null;
  errMsg?: string | null;
}

export function createPayOrder(input: {
  mchOrderNo: string;
  amount: number;
  wayCode: string;
  userId: string;
  clientIp?: string;
  deviceId?: string;
}) {
  return call<PayOrder>("/api/pay/create", {
    mchOrderNo: input.mchOrderNo,
    amount: toCents(input.amount),
    currency: config.currency,
    wayCode: input.wayCode,
    clientIp: input.clientIp,
    notifyUrl: `${config.apiPublicUrl}/api/payments/ggusonepay/notify/pay`,
    returnUrl: config.webPublicUrl ? `${config.webPublicUrl}/wallet` : undefined,
    expiredTime: config.orderExpireSeconds,
    extParam: config.sandboxAutoResult || undefined,
    wayParam: { clientId: input.userId, deviceId: input.deviceId },
  });
}

export interface PayOrderDetail {
  payOrderNo: string;
  mchOrderNo: string;
  amount: number;
  realAmount?: number | null;
  currency: string;
  state: number;
  wayCode?: string | null;
}

export function queryPayOrder(mchOrderNo: string) {
  return call<PayOrderDetail>("/api/pay/query", { mchOrderNo });
}

// wayParam field holding the account handle for each handle-based payout method. Card payouts
// send { cardNumber, cardValid } instead (see admin cashout approval).
export const TRANSFER_ACCOUNT_FIELD: Record<string, string> = {
  ecashapp: "cashtag",
  paypal: "email",
  venmo: "email",
  zelle: "zelleSign",
  chime: "chimeSign",
};
export const TRANSFER_METHODS = [...Object.keys(TRANSFER_ACCOUNT_FIELD), "card"];

export interface TransferOrder {
  transferOrderNo: string;
  mchOrderNo: string;
  state: number;
  errCode?: string | null;
  errMsg?: string | null;
}

export function createTransfer(input: { mchOrderNo: string; amount: number; wayCode: string; wayParam: Record<string, string> }) {
  if (!TRANSFER_METHODS.includes(input.wayCode)) throw new GatewayError("UNSUPPORTED", `Unsupported payout method: ${input.wayCode}`);
  return call<TransferOrder>("/api/transfer/create", {
    mchOrderNo: input.mchOrderNo,
    amount: toCents(input.amount),
    currency: config.currency,
    wayCode: input.wayCode,
    reason: "Withdrawal",
    notifyUrl: `${config.apiPublicUrl}/api/payments/ggusonepay/notify/transfer`,
    extParam: config.sandboxAutoResult || undefined,
    wayParam: input.wayParam,
  });
}

export interface TransferOrderDetail {
  transferOrderNo: string;
  mchOrderNo: string;
  amount: number;
  state: number;
}

export function queryTransfer(mchOrderNo: string) {
  return call<TransferOrderDetail>("/api/transfer/query", { mchOrderNo });
}

export function closePayOrder(mchOrderNo: string) {
  return call<{ errCode?: string | null; errMsg?: string | null }>("/api/pay/close", { mchOrderNo });
}

export interface BalanceAccount {
  currency: string;
  balance: number;
  availableBalance: number;
  transferPendingAmount: number;
  delayAmount: number;
}

// The gateway allows one balance query per 5s, so results are cached briefly.
let balanceCache: { at: number; accounts: BalanceAccount[] } | null = null;
export async function queryBalance() {
  if (balanceCache && Date.now() - balanceCache.at < 6_000) return balanceCache.accounts;
  const data = await call<{ mchNo: string; accounts: BalanceAccount[] }>("/api/balance/query", {});
  balanceCache = { at: Date.now(), accounts: data.accounts };
  return data.accounts;
}

export async function checkHealth() {
  try {
    const res = await fetch(`${config.baseUrl}/api/health`, { signal: AbortSignal.timeout(10_000) });
    const json = (await res.json()) as { code?: number };
    return json.code === 0;
  } catch {
    return false;
  }
}
