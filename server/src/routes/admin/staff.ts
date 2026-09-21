import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { AuthedRequest } from "../../middleware/auth";
import { logAudit } from "../../lib/audit";
import { customAlphabet } from "../../lib/nanoid";

export const adminStaffRouter = Router();

const referralCode = customAlphabet();

adminStaffRouter.get("/", async (_req, res) => {
  const staff = await prisma.user.findMany({
    where: { role: { in: ["ADMIN", "MASTER_ADMIN"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true, fullName: true, username: true, email: true, role: true, createdAt: true },
  });
  res.json({ staff });
});

const createSchema = z.object({
  fullName: z.string().min(1).max(80),
  username: z
    .string()
    .min(4)
    .max(24)
    .regex(/^[a-zA-Z0-9_]+$/),
  email: z.string().email(),
  password: z.string().min(8).max(72),
  role: z.enum(["ADMIN", "MASTER_ADMIN"]).default("ADMIN"),
});

adminStaffRouter.post("/", async (req: AuthedRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input." });
  const { fullName, username, email, password, role } = parsed.data;

  const existing = await prisma.user.findFirst({ where: { OR: [{ email }, { username }] } });
  if (existing) return res.status(409).json({ error: "An account with that email or username already exists." });

  const passwordHash = await bcrypt.hash(password, 10);
  const staff = await prisma.user.create({
    data: {
      fullName,
      username,
      email,
      passwordHash,
      role,
      signupIp: "admin-created",
      referralCode: referralCode(),
    },
    select: { id: true, fullName: true, username: true, email: true, role: true, createdAt: true },
  });

  await logAudit(req.userId!, "STAFF_CREATED", { targetType: "User", targetId: staff.id, meta: { role } });
  res.status(201).json({ staff });
});

adminStaffRouter.delete("/:id", async (req: AuthedRequest, res) => {
  if (req.params.id === req.userId) {
    return res.status(400).json({ error: "You can't remove your own account." });
  }
  const staff = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!staff || !["ADMIN", "MASTER_ADMIN"].includes(staff.role)) {
    return res.status(404).json({ error: "Staff account not found." });
  }

  await prisma.user.update({ where: { id: staff.id }, data: { role: "USER" } });
  await logAudit(req.userId!, "STAFF_REMOVED", { targetType: "User", targetId: staff.id });
  res.json({ ok: true });
});
