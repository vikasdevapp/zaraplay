// Stable per-browser id the gateway uses for fraud checks and payment success rate. Falls
// back to a fresh id each time if storage is unavailable (private mode, blocked storage).
export function getDeviceId() {
  try {
    let id = localStorage.getItem("zp_device_id");
    if (!id) {
      // randomUUID needs a secure context (HTTPS/localhost); the site may be served over plain HTTP.
      id = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
      localStorage.setItem("zp_device_id", id);
    }
    return id;
  } catch {
    return undefined;
  }
}
