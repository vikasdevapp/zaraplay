"use client";

import { useEffect, useState } from "react";
import { useApi } from "@/context/AuthContext";
import { isPushSupported, urlBase64ToUint8Array } from "@/lib/push";

export default function NotificationCard() {
  const api = useApi();
  const [supported, setSupported] = useState(true);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isPushSupported()) {
      setSupported(false);
      return;
    }
    setPermission(Notification.permission);
    api<{ subscribed: boolean }>("/api/push/status")
      .then((res) => setSubscribed(res.subscribed))
      .catch(() => {});
  }, [api]);

  async function enable() {
    setError(null);
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") {
        setError("Notifications were blocked. Enable them in your browser's site settings to turn this on.");
        return;
      }

      const { publicKey } = await api<{ publicKey: string | null }>("/api/push/vapid-public-key");
      if (!publicKey) {
        setError("Notifications aren't configured on the server yet.");
        return;
      }

      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });

      const json = subscription.toJSON();
      await api("/api/push/subscribe", {
        method: "POST",
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
      });
      setSubscribed(true);
    } catch (err) {
      console.error(err);
      setError("Could not enable notifications. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration("/sw.js");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await api("/api/push/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint: subscription.endpoint }) });
        await subscription.unsubscribe();
      }
      setSubscribed(false);
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <p className="font-semibold mb-1">🔔 {subscribed ? "Notifications on" : "Allow notifications"}</p>
      <p className="text-sm text-muted mb-2">Never miss a bonus, payment or chat alert.</p>
      {!supported ? (
        <p className="text-xs text-muted">Not supported on this browser.</p>
      ) : subscribed ? (
        <button onClick={disable} disabled={busy} className="btn-ghost text-xs py-1.5 px-3 w-full">
          {busy ? "…" : "Disable"}
        </button>
      ) : (
        <button onClick={enable} disabled={busy || permission === "denied"} className="btn-primary text-xs py-1.5 px-3 w-full">
          {busy ? "Enabling…" : permission === "denied" ? "Blocked in browser" : "Enable"}
        </button>
      )}
      {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
    </div>
  );
}
