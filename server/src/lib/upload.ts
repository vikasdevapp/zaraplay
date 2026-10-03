import fs from "fs";
import path from "path";
import crypto from "crypto";
import multer from "multer";

export const UPLOADS_DIR = path.join(__dirname, "..", "..", "uploads", "games");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

export const CHAT_UPLOADS_DIR = path.join(__dirname, "..", "..", "uploads", "chat");
fs.mkdirSync(CHAT_UPLOADS_DIR, { recursive: true });

const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

function diskStorageIn(dir: string) {
  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, dir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${crypto.randomBytes(16).toString("hex")}${ext}`);
    },
  });
}

function imageFilter(_req: unknown, file: Express.Multer.File, cb: multer.FileFilterCallback) {
  if (!ALLOWED_TYPES.has(file.mimetype)) {
    cb(new Error("Only PNG, JPEG, WEBP or GIF images are allowed."));
    return;
  }
  cb(null, true);
}

export const uploadGameImage = multer({
  storage: diskStorageIn(UPLOADS_DIR),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: imageFilter,
});

// Proof photos players/staff attach in support chat.
export const uploadChatImage = multer({
  storage: diskStorageIn(CHAT_UPLOADS_DIR),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: imageFilter,
});
