"use client";

import { useEffect, useState, useCallback, useRef, FormEvent } from "react";
import Image from "next/image";
import AdminShell from "@/components/AdminShell";
import { useApi, useApiUpload } from "@/context/AuthContext";
import { ApiError } from "@/lib/api";

interface Game {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  playUrl: string | null;
  isActive: boolean;
  sortOrder: number;
  _count: { userGames: number };
}

const emptyForm = { name: "", imageUrl: "", playUrl: "", isActive: true };

export default function AdminGamesPage() {
  const api = useApi();
  const apiUpload = useApiUpload();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [games, setGames] = useState<Game[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await api<{ games: Game[] }>("/api/admin/games");
    setGames(res.games);
  }, [api]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const res = await apiUpload<{ url: string }>("/api/admin/games/upload-image", file, "image");
      setForm((f) => ({ ...f, imageUrl: res.url }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Image upload failed.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function startEdit(game: Game) {
    setEditingId(game.id);
    setForm({ name: game.name, imageUrl: game.imageUrl || "", playUrl: game.playUrl || "", isActive: game.isActive });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const payload = {
        name: form.name,
        imageUrl: form.imageUrl || undefined,
        playUrl: form.playUrl || undefined,
        isActive: form.isActive,
      };
      if (editingId) {
        await api(`/api/admin/games/${editingId}`, { method: "PATCH", body: JSON.stringify(payload) });
      } else {
        await api("/api/admin/games", { method: "POST", body: JSON.stringify(payload) });
      }
      cancelEdit();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save game.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(game: Game) {
    await api(`/api/admin/games/${game.id}`, { method: "PATCH", body: JSON.stringify({ isActive: !game.isActive }) });
    await load();
  }

  async function remove(game: Game) {
    setError(null);
    try {
      await api(`/api/admin/games/${game.id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete game.");
    }
  }

  return (
    <AdminShell>
      <h1 className="text-2xl font-bold mb-6">Games</h1>

      <form onSubmit={handleSubmit} className="card mb-6 space-y-3">
        <h2 className="font-bold">{editingId ? "Edit Game" : "Add Game"}</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input
            className="input"
            placeholder="Game name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            required
          />
          <input
            className="input"
            placeholder="Download / Play link (optional, admin reference only)"
            value={form.playUrl}
            onChange={(e) => setForm((f) => ({ ...f, playUrl: e.target.value }))}
          />
        </div>

        <div>
          <label className="text-xs text-muted block mb-1">Logo image</label>
          <div className="flex items-center gap-3">
            {form.imageUrl ? (
              <div className="relative w-16 h-16 rounded-lg overflow-hidden bg-surface2 shrink-0">
                <Image src={form.imageUrl} alt="Game logo" fill className="object-cover" unoptimized />
              </div>
            ) : (
              <div className="w-16 h-16 rounded-lg bg-surface2 shrink-0 flex items-center justify-center text-muted text-xs">
                No image
              </div>
            )}
            <div className="flex-1">
              <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={handleFileChange} className="text-sm" />
              {uploading && <p className="text-xs text-muted mt-1">Uploading…</p>}
            </div>
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
          Active (visible in the customer catalog)
        </label>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex gap-2">
          <button type="submit" className="btn-primary" disabled={busy || uploading}>
            {busy ? "Saving…" : editingId ? "Save Changes" : "+ Add Game"}
          </button>
          {editingId && (
            <button type="button" onClick={cancelEdit} className="btn-ghost">
              Cancel
            </button>
          )}
        </div>
      </form>

      <div className="card p-0 divide-y divide-border overflow-hidden">
        {games.map((g) => (
          <div key={g.id} className="flex items-center justify-between px-4 py-3 gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {g.imageUrl ? (
                <div className="relative w-10 h-10 rounded-lg overflow-hidden bg-surface2 shrink-0">
                  <Image src={g.imageUrl} alt={g.name} fill className="object-cover" unoptimized />
                </div>
              ) : (
                <div className="w-10 h-10 rounded-lg bg-surface2 shrink-0" />
              )}
              <div className="min-w-0">
                <p className="font-medium truncate">{g.name}</p>
                <p className="text-xs text-muted">
                  {g._count.userGames} player{g._count.userGames === 1 ? "" : "s"} added
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className={`text-xs px-2 py-1 rounded ${g.isActive ? "bg-green-500/20 text-green-400" : "bg-surface2 text-muted"}`}>
                {g.isActive ? "Active" : "Inactive"}
              </span>
              <button onClick={() => startEdit(g)} className="btn-ghost text-xs py-1.5 px-3">
                Edit
              </button>
              <button onClick={() => toggleActive(g)} className="btn-ghost text-xs py-1.5 px-3">
                {g.isActive ? "Deactivate" : "Activate"}
              </button>
              <button
                onClick={() => remove(g)}
                disabled={g._count.userGames > 0}
                className="text-xs py-1.5 px-3 rounded-xl text-red-400 hover:bg-red-500/10 disabled:opacity-30 disabled:cursor-not-allowed"
                title={g._count.userGames > 0 ? "Can't delete — players have added this game" : "Delete"}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
        {games.length === 0 && <p className="text-muted text-sm text-center py-8">No games yet.</p>}
      </div>
    </AdminShell>
  );
}
