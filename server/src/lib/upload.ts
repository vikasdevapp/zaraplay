import fs from "fs";
import path from "path";
import crypto from "crypto";
import multer from "multer";

export const UPLOADS_DIR = path.join(__dirname, "..", "..", "uploads", "games");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomBytes(16).toString("hex")}${ext}`);
  },
});

const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export const uploadGameImage = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_TYPES.has(file.mimetype)) {
      cb(new Error("Only PNG, JPEG, WEBP or GIF images are allowed."));
      return;
    }
    cb(null, true);
  },
});
