// Nullish coalescing, not ||: an empty string is a deliberate production value (same-origin,
// Nginx proxies /api/ to the API container) and must not fall through to the dev default —
// process.env values are either a real string or undefined, never null, so ?? is exact here.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function apiFetch<T>(path: string, options: RequestInit = {}, token?: string | null): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await res.json() : undefined;

  if (!res.ok) {
    throw new ApiError(res.status, body?.error || "Something went wrong. Please try again.");
  }
  return body as T;
}

// Separate from apiFetch because a file upload needs a multipart body — the browser must
// set its own Content-Type (with the multipart boundary), so we must NOT set it ourselves.
export async function apiUpload<T>(path: string, file: File, fieldName: string, token?: string | null): Promise<T> {
  const formData = new FormData();
  formData.append(fieldName, file);

  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: formData,
  });

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await res.json() : undefined;

  if (!res.ok) {
    throw new ApiError(res.status, body?.error || "Upload failed. Please try again.");
  }
  return body as T;
}
