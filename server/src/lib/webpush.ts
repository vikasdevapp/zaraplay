import webpush from "web-push";
import { prisma } from "./prisma";

let configured = false;

function ensureConfigured() {
  if (configured) return true;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@zaraplays.local", publicKey, privateKey);
  configured = true;
  return true;
}

interface PushPayload {
  title: string;
  body: string;
}

async function sendToSubscription(sub: { id: string; endpoint: string; p256dh: string; auth: string }, payload: PushPayload) {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload)
    );
  } catch (err: unknown) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    // 404/410 means the browser subscription is gone (uninstalled, expired) — clean it up.
    if (statusCode === 404 || statusCode === 410) {
      await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
    }
  }
}

export async function sendPushToUser(userId: string, payload: PushPayload) {
  if (!ensureConfigured()) return;
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  await Promise.all(subs.map((sub) => sendToSubscription(sub, payload)));
}

export async function sendPushBroadcast(payload: PushPayload): Promise<number> {
  if (!ensureConfigured()) return 0;
  const subs = await prisma.pushSubscription.findMany();
  await Promise.all(subs.map((sub) => sendToSubscription(sub, payload)));
  return subs.length;
}

export function isPushConfigured() {
  return ensureConfigured();
}
