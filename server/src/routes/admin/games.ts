import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { AuthedRequest } from "../../middleware/auth";
import { logAudit } from "../../lib/audit";
import { uploadGameImage } from "../../lib/upload";
import { optimizeImageInPlace } from "../../lib/imageOptimize";

export const adminGamesRouter = Router();

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

adminGamesRouter.post("/upload-image", uploadGameImage.single("image"), async (req: AuthedRequest, res) => {
  if (!req.file) return res.status(400).json({ error: "No image uploaded." });
  // Shrink the logo so it loads fast on the catalog (resized/compressed in place).
  await optimizeImageInPlace(req.file.path, 512);
  // Site-relative so the link survives domain / http->https changes.
  const url = `/uploads/games/${req.file.filename}`;
  res.status(201).json({ url });
});

adminGamesRouter.get("/", async (_req, res) => {
  const [games, agents] = await Promise.all([
    prisma.game.findMany({
      orderBy: { sortOrder: "asc" },
      include: {
        _count: { select: { userGames: true } },
        agent: { select: { id: true, username: true, fullName: true } },
      },
    }),
    // Staff agents (role AGENT) a game can be assigned to; the agent runs the game's support staff.
    prisma.user.findMany({ where: { role: "AGENT" }, orderBy: { username: "asc" }, select: { id: true, username: true, fullName: true } }),
  ]);
  res.json({ games, agents });
});

// Shown to players as a clickable link, so only http(s) — never javascript: or data: URLs.
const webUrl = z
  .string()
  .trim()
  .url()
  .refine((u) => /^https?:\/\//i.test(u), "Play link must start with http:// or https://");

// Our own uploads are stored site-relative (/uploads/...); external images need a full http(s) URL.
const imageUrl = z
  .string()
  .trim()
  .refine((u) => /^\/uploads\/[\w./-]+$/.test(u) || /^https?:\/\/\S+$/i.test(u), "Image must be an uploaded file or an http(s) URL");

const automation = z.enum(["JUWA", "GAMEVAULT", "JUWA2"]).nullable();
// The owning staff agent (User id, role AGENT). null/"" clears it.
const agentId = z.string().max(40).nullable();
// Short code used in auto-generated usernames (letters/numbers, e.g. "jw").
const shortCode = z.string().trim().max(10).regex(/^[a-zA-Z0-9]*$/, "Short code: letters and numbers only.");

const createSchema = z.object({
  name: z.string().min(1).max(60),
  imageUrl: imageUrl.optional().or(z.literal("")),
  // Admin reference only — never surfaced as a live link on the customer site.
  playUrl: webUrl.optional().or(z.literal("")),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  automationProvider: automation.optional(),
  agentId: agentId.optional(),
  shortCode: shortCode.optional(),
});

// Rejects an agentId that isn't a real AGENT account; returns the normalized value (null to clear).
async function resolveAgentId(value: string | null | undefined): Promise<string | null | undefined> {
  if (value === undefined) return undefined;
  if (!value) return null;
  const agent = await prisma.user.findFirst({ where: { id: value, role: "AGENT" }, select: { id: true } });
  if (!agent) throw new Error("Chosen agent is not an AGENT account.");
  return agent.id;
}

adminGamesRouter.post("/", async (req: AuthedRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input." });

  const slug = slugify(parsed.data.name);
  const existing = await prisma.game.findUnique({ where: { slug } });
  if (existing) return res.status(409).json({ error: "A game with that name already exists." });

  let resolvedAgentId: string | null | undefined;
  try {
    resolvedAgentId = await resolveAgentId(parsed.data.agentId);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : "Invalid agent." });
  }

  const game = await prisma.game.create({
    data: {
      name: parsed.data.name,
      slug,
      imageUrl: parsed.data.imageUrl || null,
      playUrl: parsed.data.playUrl || null,
      isActive: parsed.data.isActive ?? true,
      sortOrder: parsed.data.sortOrder ?? 0,
      automationProvider: parsed.data.automationProvider ?? null,
      agentId: resolvedAgentId ?? null,
      shortCode: parsed.data.shortCode || null,
    },
  });
  await logAudit(req.userId!, "GAME_CREATED", { targetType: "Game", targetId: game.id, meta: { name: game.name } });
  res.status(201).json({ game });
});

const updateSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  imageUrl: imageUrl.optional().or(z.literal("")),
  playUrl: webUrl.optional().or(z.literal("")),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  automationProvider: automation.optional(),
  agentId: agentId.optional(),
  shortCode: shortCode.optional(),
});

adminGamesRouter.patch("/:id", async (req: AuthedRequest, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input." });

  const game = await prisma.game.findUnique({ where: { id: req.params.id } });
  if (!game) return res.status(404).json({ error: "Game not found." });

  let resolvedAgentId: string | null | undefined;
  try {
    resolvedAgentId = await resolveAgentId(parsed.data.agentId);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : "Invalid agent." });
  }

  const game_ = await prisma.game.update({
    where: { id: game.id },
    data: {
      ...(parsed.data.name ? { name: parsed.data.name, slug: slugify(parsed.data.name) } : {}),
      ...(parsed.data.imageUrl !== undefined ? { imageUrl: parsed.data.imageUrl || null } : {}),
      ...(parsed.data.playUrl !== undefined ? { playUrl: parsed.data.playUrl || null } : {}),
      ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
      ...(parsed.data.sortOrder !== undefined ? { sortOrder: parsed.data.sortOrder } : {}),
      ...(parsed.data.automationProvider !== undefined ? { automationProvider: parsed.data.automationProvider } : {}),
      ...(resolvedAgentId !== undefined ? { agentId: resolvedAgentId } : {}),
      ...(parsed.data.shortCode !== undefined ? { shortCode: parsed.data.shortCode || null } : {}),
    },
  });
  await logAudit(req.userId!, "GAME_UPDATED", { targetType: "Game", targetId: game.id, meta: parsed.data });
  res.json({ game: game_ });
});

adminGamesRouter.delete("/:id", async (req: AuthedRequest, res) => {
  const inUse = await prisma.userGame.count({ where: { gameId: req.params.id } });
  if (inUse > 0) {
    return res.status(409).json({ error: "This game has been added by players and can't be deleted — deactivate it instead." });
  }
  const game = await prisma.game.findUnique({ where: { id: req.params.id } });
  await prisma.game.delete({ where: { id: req.params.id } }).catch(() => null);
  if (game) await logAudit(req.userId!, "GAME_DELETED", { targetType: "Game", targetId: game.id, meta: { name: game.name } });
  res.json({ ok: true });
});
