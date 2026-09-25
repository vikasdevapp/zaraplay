import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { AuthedRequest } from "../../middleware/auth";
import { logAudit } from "../../lib/audit";
import { uploadGameImage } from "../../lib/upload";

export const adminGamesRouter = Router();

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

adminGamesRouter.post("/upload-image", uploadGameImage.single("image"), (req: AuthedRequest, res) => {
  if (!req.file) return res.status(400).json({ error: "No image uploaded." });
  const url = `${req.protocol}://${req.get("host")}/uploads/games/${req.file.filename}`;
  res.status(201).json({ url });
});

adminGamesRouter.get("/", async (_req, res) => {
  const games = await prisma.game.findMany({
    orderBy: { sortOrder: "asc" },
    include: { _count: { select: { userGames: true } } },
  });
  res.json({ games });
});

// Shown to players as a clickable link, so only http(s) — never javascript: or data: URLs.
const webUrl = z
  .string()
  .trim()
  .url()
  .refine((u) => /^https?:\/\//i.test(u), "Play link must start with http:// or https://");

const createSchema = z.object({
  name: z.string().min(1).max(60),
  imageUrl: z.string().url().optional().or(z.literal("")),
  // Admin reference only — never surfaced as a live link on the customer site.
  playUrl: webUrl.optional().or(z.literal("")),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

adminGamesRouter.post("/", async (req: AuthedRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input." });

  const slug = slugify(parsed.data.name);
  const existing = await prisma.game.findUnique({ where: { slug } });
  if (existing) return res.status(409).json({ error: "A game with that name already exists." });

  const game = await prisma.game.create({
    data: {
      name: parsed.data.name,
      slug,
      imageUrl: parsed.data.imageUrl || null,
      playUrl: parsed.data.playUrl || null,
      isActive: parsed.data.isActive ?? true,
      sortOrder: parsed.data.sortOrder ?? 0,
    },
  });
  await logAudit(req.userId!, "GAME_CREATED", { targetType: "Game", targetId: game.id, meta: { name: game.name } });
  res.status(201).json({ game });
});

const updateSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  imageUrl: z.string().url().optional().or(z.literal("")),
  playUrl: webUrl.optional().or(z.literal("")),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

adminGamesRouter.patch("/:id", async (req: AuthedRequest, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input." });

  const game = await prisma.game.findUnique({ where: { id: req.params.id } });
  if (!game) return res.status(404).json({ error: "Game not found." });

  const game_ = await prisma.game.update({
    where: { id: game.id },
    data: {
      ...(parsed.data.name ? { name: parsed.data.name, slug: slugify(parsed.data.name) } : {}),
      ...(parsed.data.imageUrl !== undefined ? { imageUrl: parsed.data.imageUrl || null } : {}),
      ...(parsed.data.playUrl !== undefined ? { playUrl: parsed.data.playUrl || null } : {}),
      ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
      ...(parsed.data.sortOrder !== undefined ? { sortOrder: parsed.data.sortOrder } : {}),
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
