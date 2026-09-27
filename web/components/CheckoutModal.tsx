"use client";

import { useEffect, useState } from "react";
import Logo from "@/components/Logo";

// Razorpay-style interactive payment checkout modal.
// Features clean side-nav category tabs, method detail input forms (UPI ID / App, Card # / Expiry / CVV, Net Banking Banks, Wallets),
// and a prominent "Pay Now" trigger button.

const METHOD_INFO: Record<string, { name: string; icon: string; desc: string; category: string }> = {
  cashapp: { name: "Cash App", icon: "$", desc: "Pay with Cash App balance or QR code", category: "Cash App" },
  ecashapp: { name: "Cash App", icon: "$", desc: "Pay with Cash App handle", category: "Cash App" },
  btcpay: { name: "Cash App (BTC)", icon: "₿", desc: "Pay with Bitcoin via Cash App", category: "Crypto" },
  zelle: { name: "Zelle", icon: "Z", desc: "Send via Zelle banking app", category: "Bank Transfer" },
  chime: { name: "Chime", icon: "C", desc: "Pay using Chime account", category: "Chime" },
  paypal: { name: "PayPal", icon: "P", desc: "Pay with PayPal wallet", category: "PayPal" },
  venmo: { name: "Venmo", icon: "V", desc: "Pay using Venmo app", category: "Venmo" },
  applepay: { name: "Apple Pay", icon: "🍎", desc: "Pay using Apple Pay", category: "Apple Pay" },
  googlepay: { name: "Google Pay", icon: "G", desc: "Pay using Google Pay", category: "Google Pay" },
  card: { name: "Credit / Debit Card", icon: "💳", desc: "Visa, MasterCard, Amex cards", category: "Card" },
};

interface Props {
  amount: number;
  methods: string[];
  payerName?: string;
  busy: boolean;
  error: string | null;
  onPay: (method: string) => void;
  onClose: () => void;
}

export default function CheckoutModal({
  amount,
  methods,
  payerName,
  busy,
  error,
  onPay,
  onClose,
}: Props) {
  // Only the methods the backend reports as working right now; nothing is preselected —
  // tapping a method opens the GGUSOnePay page for it straight away.
  const [pendingMethod, setPendingMethod] = useState<string | null>(null);
  useEffect(() => {
    if (!busy) setPendingMethod(null);
  }, [busy]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [busy, onClose]);

  function pay(wayCode: string) {
    if (busy) return;
    setPendingMethod(wayCode);
    onPay(wayCode);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-6"
      onClick={() => !busy && onClose()}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-3xl bg-white text-neutral-900 rounded-2xl shadow-2xl overflow-hidden flex flex-col md:flex-row min-h-[460px] max-h-[90vh] border border-neutral-200 animate-in fade-in zoom-in duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left Sidebar: Merchant & Summary */}
        <div className="md:w-72 bg-slate-900 text-white p-6 flex flex-col justify-between shrink-0 relative overflow-hidden">
          <div className="relative z-10 space-y-6">
            <div className="flex items-center gap-3">
              <Logo size="sm" />
              <div>
                <p className="font-bold text-base leading-tight">Zara Plays</p>
                <p className="text-[11px] text-emerald-400 font-medium">GGUSOnePay Verified Merchant ✓</p>
              </div>
            </div>

            <div className="bg-slate-800/90 backdrop-blur border border-slate-700/80 rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Amount Payable</span>
                <span className="bg-emerald-500/20 text-emerald-300 text-[10px] px-2 py-0.5 rounded-full font-semibold">
                  Secured 256-Bit
                </span>
              </div>
              <div className="text-3xl font-black text-white tracking-tight">
                ${amount.toFixed(2)}
              </div>
              {payerName && (
                <div className="pt-2 text-xs text-slate-300 flex items-center gap-1.5 border-t border-slate-700/60">
                  <span className="text-slate-400">User:</span>
                  <span className="font-medium text-amber-300 truncate">@{payerName}</span>
                </div>
              )}
            </div>
          </div>

          <div className="relative z-10 pt-6 border-t border-slate-800 space-y-3">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              <span>Instant Confirmation & Bonus Credit</span>
            </div>
            <p className="text-[11px] text-slate-500">Powered by GGUSOnePay Gateway</p>
          </div>

          {/* Decorative background gradient glow */}
          <div aria-hidden className="absolute -left-20 -bottom-20 w-60 h-60 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
        </div>

        {/* Right Main Checkout Area */}
        <div className="flex-1 flex flex-col bg-slate-50 min-w-0">
          {/* Top Bar */}
          <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-neutral-200 shrink-0">
            <div>
              <h3 className="font-bold text-neutral-800 text-lg">Choose how to pay</h3>
              <p className="text-xs text-neutral-500">Tap a method to continue on the secure GGUSOnePay page</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center transition-colors disabled:opacity-40"
              aria-label="Close modal"
            >
              ✕
            </button>
          </div>

          <div className="flex-1 p-6 flex flex-col justify-between bg-white min-w-0 space-y-6 overflow-y-auto">
            <div className="space-y-3">
              {methods.length === 0 ? (
                <p className="text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-xl p-4">
                  No payment methods are available right now. Please try again in a little while.
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-2.5">
                  {methods.map((wayCode) => {
                    const info = METHOD_INFO[wayCode] || {
                      name: wayCode.toUpperCase(),
                      icon: "💳",
                      desc: `Pay using ${wayCode}`,
                    };
                    const isPending = busy && pendingMethod === wayCode;

                    return (
                      <button
                        key={wayCode}
                        type="button"
                        onClick={() => pay(wayCode)}
                        disabled={busy}
                        className={`w-full p-4 rounded-xl border text-left flex items-center gap-4 transition-all disabled:cursor-not-allowed ${
                          isPending
                            ? "bg-emerald-50/80 border-emerald-500 ring-1 ring-emerald-500"
                            : "bg-slate-50 border-slate-200 hover:bg-emerald-50/60 hover:border-emerald-400 disabled:opacity-60"
                        }`}
                      >
                        <span className="w-10 h-10 rounded-full bg-slate-900 text-white font-bold text-base flex items-center justify-center shrink-0">
                          {info.icon}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-sm text-slate-900 leading-snug">{info.name}</p>
                          <p className="text-xs text-slate-500 truncate">{isPending ? "Opening GGUSOnePay…" : info.desc}</p>
                        </div>
                        <span className="text-emerald-600 font-bold shrink-0">{isPending ? "…" : "→"}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-slate-100 space-y-3">
              {error && <p className="text-xs font-medium text-red-600 bg-red-50 p-2.5 rounded-lg">{error}</p>}
              <p className="text-[11px] text-center text-slate-400">🔒 You&apos;ll finish paying ${amount.toFixed(2)} on the GGUSOnePay page</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

