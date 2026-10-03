"use client";

import { useEffect } from "react";

interface Props {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  onConfirm,
  onCancel,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm();
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, onCancel, onConfirm]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="w-full max-w-sm bg-surface border border-border rounded-2xl shadow-2xl p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold text-lg">{title}</h3>
        {message && <p className="text-sm text-muted mt-1.5">{message}</p>}
        <div className="flex gap-2 justify-end mt-5">
          <button type="button" onClick={onCancel} className="px-4 py-2 rounded-xl text-sm font-medium border border-border text-muted hover:text-white">
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            autoFocus
            className={`px-4 py-2 rounded-xl text-sm font-semibold text-white ${danger ? "bg-red-500 hover:bg-red-600" : "bg-primary hover:bg-primary/90"}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
