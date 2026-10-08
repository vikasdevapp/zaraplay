import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { AuthedRequest } from "../../middleware/auth";
import { logAudit } from "../../lib/audit";
import { sealSecret, isSecretBoxConfigured } from "../../lib/secretBox";
import { PROVIDERS, providerMeta, resolvePlatformConfig } from "../../lib/platformProviders";
import { JuwaClient, JuwaError, GamePlatformClient } from "../../lib/juwa";
import { CashFrenzyClient } from "../../lib/cashfrenzy";

// Admin-managed, encrypted credentials for the game-platform agent APIs (self-service, no .env).
export const adminPlatformsRouter = Router();

// Every provider with its field labels and current status (secret always masked).
adminPlatformsRouter.get("/", async (_req, res) => {
  const rows = await prisma.platformCredential.findMany();
  const byProvider = new Map(rows.map((r) => [r.provider, r]));
  const providers = await Promise.all(
    PROVIDERS.map(async (p) => {
      const row = byProvider.get(p.key);
      const resolved = await resolvePlatformConfig(p.key);
      return {
        key: p.key,
        label: p.label,
        style: p.style,
        idLabel: p.idLabel,
        secretLabel: p.secretLabel,
        showDivisor: p.showDivisor,
        baseUrl: row?.baseUrl || p.defaultBaseUrl || "",
        agentId: row?.agentId || "",
        hasSecret: !!(row?.secret || "").length,
        balanceDivisor: row ? Number(row.balanceDivisor) : 1,
        // Whether the automation can actually use this provider right now (DB or env), and from where.
        configured: !!resolved,
        source: row && row.baseUrl && row.agentId && row.secret ? "panel" : resolved ? "server" : "none",
      };
    })
  );
  res.json({ providers, encryptionReady: isSecretBoxConfigured() });
});

const saveSchema = z.object({
  baseUrl: z.string().trim().max(200),
  agentId: z.string().trim().max(120),
  // Omit/blank to keep the existing secret; otherwise it's encrypted on save.
  secret: z.string().max(400).optional(),
  balanceDivisor: z.number().positive().optional(),
});

adminPlatformsRouter.put("/:provider", async (req: AuthedRequest, res) => {
  const meta = providerMeta(req.params.provider);
  if (!meta) return res.status(404).json({ error: "Unknown provider." });
  const parsed = saveSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input." });
  const { baseUrl, agentId, secret, balanceDivisor } = parsed.data;

  if (secret && !isSecretBoxConfigured()) {
    return res.status(400).json({ error: "Secret encryption isn't configured on the server (PAYOUT_ENCRYPTION_KEY)." });
  }

  const existing = await prisma.platformCredential.findUnique({ where: { provider: meta.key } });
  const data = {
    baseUrl,
    agentId,
    // Keep the old secret if none was entered this time.
    secret: secret ? sealSecret(secret) : existing?.secret ?? "",
    balanceDivisor: meta.showDivisor && balanceDivisor ? balanceDivisor : 1,
  };
  await prisma.platformCredential.upsert({
    where: { provider: meta.key },
    create: { provider: meta.key, ...data },
    update: data,
  });
  await logAudit(req.userId!, "PLATFORM_CREDENTIALS_UPDATED", { targetType: "PlatformCredential", targetId: meta.key, meta: { baseUrl, agentId } });
  res.json({ ok: true });
});

// Checks the saved credentials by calling the platform (JUWA-family: agent balance).
adminPlatformsRouter.post("/:provider/test", async (req: AuthedRequest, res) => {
  const meta = providerMeta(req.params.provider);
  if (!meta) return res.status(404).json({ error: "Unknown provider." });
  const cfg = await resolvePlatformConfig(meta.key);
  if (!cfg) return res.status(400).json({ error: "No credentials saved for this provider yet." });

  const base = { baseUrl: cfg.baseUrl, agentId: cfg.agentId, secretKey: cfg.secret, balanceDivisor: cfg.balanceDivisor };
  const client: GamePlatformClient = meta.style === "CASHFRENZY" ? new CashFrenzyClient(base) : new JuwaClient(base);
  try {
    const balance = await client.agentBalance();
    res.json({ ok: true, agentBalance: balance });
  } catch (err) {
    const message = err instanceof JuwaError ? `code ${err.code}: ${err.message}` : err instanceof Error ? err.message : "Connection failed.";
    res.status(400).json({ error: message });
  }
});
