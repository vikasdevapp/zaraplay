import { prisma } from "./prisma";
import { openSecret } from "./secretBox";

/**
 * Game-platform automation providers and their credentials. Credentials live in the DB
 * (admin-managed, secret encrypted via lib/secretBox), with the server env as a fallback. Two
 * protocol families so far:
 *  - "JUWA"      : agent_id + secret_key, MD5-signed (Juwa, Juwa 2.0, Game Vault)
 *  - "CASHFRENZY": agent username + password -> Bearer token login (Cash Frenzy)
 */

export type ProviderStyle = "JUWA" | "CASHFRENZY" | "MILKYWAY";

export interface ProviderMeta {
  key: string; // matches a GameAutomationProvider value
  label: string;
  style: ProviderStyle;
  // The two credential inputs mean different things per family, so their labels differ.
  idLabel: string;
  secretLabel: string;
  showDivisor: boolean;
  // Known API base URL, pre-filled in the admin form (still editable in case it changes).
  defaultBaseUrl?: string;
}

export const PROVIDERS: ProviderMeta[] = [
  { key: "JUWA", label: "Juwa", style: "JUWA", idLabel: "Agent ID", secretLabel: "Secret Key", showDivisor: true, defaultBaseUrl: "https://external.juwa777.com" },
  { key: "JUWA2", label: "Juwa 2.0", style: "JUWA", idLabel: "Agent ID", secretLabel: "Secret Key", showDivisor: true, defaultBaseUrl: "https://apiinterface.juwa2.xin" },
  { key: "GAMEVAULT", label: "Game Vault", style: "JUWA", idLabel: "Agent ID", secretLabel: "Secret Key", showDivisor: true, defaultBaseUrl: "https://apius.gamevault999.com" },
  { key: "CASHFRENZY", label: "Cash Frenzy", style: "CASHFRENZY", idLabel: "Agent Username", secretLabel: "Agent Password", showDivisor: false, defaultBaseUrl: "https://agentserver.cashfrenzy777.com" },
  // Cash Frenzy-style (agent login + Bearer token) platforms.
  { key: "NOBLE", label: "Noble77", style: "CASHFRENZY", idLabel: "Agent Username", secretLabel: "Agent Password", showDivisor: false, defaultBaseUrl: "https://agentserver.noble777.com" },
  { key: "GAMEROOM", label: "Gameroom", style: "CASHFRENZY", idLabel: "Agent Username", secretLabel: "Agent Password", showDivisor: false, defaultBaseUrl: "https://agentserver.gameroom777.com" },
  { key: "MAFIA", label: "Mafia City", style: "CASHFRENZY", idLabel: "Agent Username", secretLabel: "Agent Password", showDivisor: false, defaultBaseUrl: "https://agentserver.mafia77777.com" },
  { key: "VEGASROLL", label: "Vegas Rolls", style: "CASHFRENZY", idLabel: "Agent Username", secretLabel: "Agent Password", showDivisor: false, defaultBaseUrl: "https://backend.vegas-roll.com" },
  { key: "CASHMACHINE", label: "Cash Machine", style: "CASHFRENZY", idLabel: "Agent Username", secretLabel: "Agent Password", showDivisor: false, defaultBaseUrl: "https://agentserver.cashmachine777.com" },
  { key: "MRALLINONE", label: "Mr All In One", style: "CASHFRENZY", idLabel: "Agent Username", secretLabel: "Agent Password", showDivisor: false, defaultBaseUrl: "https://agentserver.mrallinone777.com" },
  // MilkyWay-style (/ws/service.ashx + MD5 agentKey) platforms.
  { key: "MILKYWAY", label: "MilkyWay", style: "MILKYWAY", idLabel: "Agent Name", secretLabel: "Agent Password", showDivisor: false, defaultBaseUrl: "https://milkywayapp.xyz:8033" },
  { key: "ORIONSTARS", label: "Orion Stars", style: "MILKYWAY", idLabel: "Agent Name", secretLabel: "Agent Password", showDivisor: false, defaultBaseUrl: "https://orionstars.vip:8033" },
];

export function providerMeta(key: string): ProviderMeta | undefined {
  return PROVIDERS.find((p) => p.key === key);
}

export interface ResolvedConfig {
  baseUrl: string;
  agentId: string; // agent id OR username
  secret: string; // secret key OR password (decrypted)
  balanceDivisor: number;
}

// Env fallback: <PROVIDER>_BASE_URL + (_AGENT_ID|_USERNAME) + (_SECRET_KEY|_PASSWORD) [+ _BALANCE_DIVISOR].
function envConfig(provider: string): ResolvedConfig | null {
  const baseUrl = (process.env[`${provider}_BASE_URL`] || "").replace(/\/+$/, "");
  const agentId = process.env[`${provider}_AGENT_ID`] || process.env[`${provider}_USERNAME`] || "";
  const secret = process.env[`${provider}_SECRET_KEY`] || process.env[`${provider}_PASSWORD`] || "";
  if (!baseUrl || !agentId || !secret) return null;
  const divisor = Number(process.env[`${provider}_BALANCE_DIVISOR`]);
  return { baseUrl, agentId, secret, balanceDivisor: Number.isFinite(divisor) && divisor > 0 ? divisor : 1 };
}

/** A provider's live credentials: the admin-set DB row (decrypted) wins, else the env fallback. */
export async function resolvePlatformConfig(provider: string): Promise<ResolvedConfig | null> {
  const row = await prisma.platformCredential.findUnique({ where: { provider } });
  if (row && row.baseUrl && row.agentId && row.secret) {
    let secret = "";
    try {
      secret = openSecret(row.secret);
    } catch {
      secret = "";
    }
    if (secret) {
      return {
        baseUrl: row.baseUrl.replace(/\/+$/, ""),
        agentId: row.agentId,
        secret,
        balanceDivisor: Number(row.balanceDivisor) || 1,
      };
    }
  }
  return envConfig(provider);
}
