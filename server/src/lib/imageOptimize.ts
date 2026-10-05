import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import { UPLOADS_DIR, CHAT_UPLOADS_DIR } from "./upload";

/**
 * Shrinks an uploaded image in place: resizes it to fit within maxDim and re-compresses, keeping
 * the same file name/format (so stored URLs keep working). This is the source-side optimization
 * that keeps pages fast — a 3000px, multi-MB upload becomes a small file sized for how it's shown.
 * Best-effort: any failure leaves the original untouched.
 */
export async function optimizeImageInPlace(filePath: string, maxDim: number): Promise<void> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".gif") return; // animated GIFs would be flattened — leave them alone
  try {
    const input = await fs.readFile(filePath);
    let pipeline = sharp(input, { failOn: "none" })
      .rotate() // apply EXIF orientation (phone photos) before stripping metadata
      .resize({ width: maxDim, height: maxDim, fit: "inside", withoutEnlargement: true });
    if (ext === ".png") pipeline = pipeline.png({ compressionLevel: 9, palette: true });
    else if (ext === ".webp") pipeline = pipeline.webp({ quality: 80 });
    else pipeline = pipeline.jpeg({ quality: 80, mozjpeg: true });
    const out = await pipeline.toBuffer();
    // Only overwrite if we actually made it smaller.
    if (out.length < input.length) await fs.writeFile(filePath, out);
  } catch (err) {
    console.warn(`[image] optimize failed for ${path.basename(filePath)}:`, err instanceof Error ? err.message : err);
  }
}

// Files below this are already small enough to skip on the one-time pass.
const SKIP_UNDER_BYTES = 200 * 1024;

async function optimizeDir(dir: string, maxDim: number): Promise<{ done: number; saved: number }> {
  let done = 0;
  let saved = 0;
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return { done, saved };
  }
  for (const name of entries) {
    const filePath = path.join(dir, name);
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile() || stat.size < SKIP_UNDER_BYTES) continue;
      await optimizeImageInPlace(filePath, maxDim);
      const after = (await fs.stat(filePath)).size;
      if (after < stat.size) {
        done += 1;
        saved += stat.size - after;
      }
    } catch {
      // skip this file
    }
  }
  return { done, saved };
}

/**
 * One-time pass over already-uploaded images that are still large (run in the background on boot).
 * Idempotent: once a file is small it's skipped, so it costs almost nothing after the first run.
 */
export async function optimizeExistingUploads(): Promise<void> {
  try {
    const games = await optimizeDir(UPLOADS_DIR, 512);
    const chat = await optimizeDir(CHAT_UPLOADS_DIR, 1280);
    const total = games.done + chat.done;
    if (total > 0) {
      const mb = ((games.saved + chat.saved) / (1024 * 1024)).toFixed(1);
      console.log(`[image] optimized ${total} existing upload(s), saved ~${mb} MB`);
    }
  } catch (err) {
    console.warn("[image] existing-uploads pass failed:", err instanceof Error ? err.message : err);
  }
}
