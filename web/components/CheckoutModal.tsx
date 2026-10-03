"use client";

import { useEffect, useState } from "react";
import Logo from "@/components/Logo";

const METHOD_INFO: Record<string, { name: string; icon: string; desc: string }> = {
  cashapp: { name: "Cash App", icon: "$", desc: "Pay with Cash App" },
  ecashapp: { name: "Cash App", icon: "$", desc: "Pay with your Cash App handle" },
  btcpay: { name: "Cash App (BTC)", icon: "₿", desc: "Pay with Bitcoin via Cash App" },
  zelle: { name: "Zelle", icon: "Z", desc: "Send via your Zelle banking app" },
  chime: { name: "Chime", icon: "C", desc: "Pay using Chime" },
  paypal: { name: "PayPal", icon: "P", desc: "Pay with PayPal" },
  venmo: { name: "Venmo", icon: "V", desc: "Pay using Venmo" },
  applepay: { name: "Apple Pay", icon: "🍎", desc: "Pay using Apple Pay" },
  googlepay: { name: "Google Pay", icon: "G", desc: "Pay using Google Pay" },
  card: { name: "Credit / Debit Card", icon: "💳", desc: "Visa, MasterCard, Amex" },
};

const money = (v: number) => `$${v.toFixed(2)}`;

interface Props {
  methods: string[];
  // Fixed amounts allowed per method; a method mapped to null (or missing) takes any amount.
  amounts?: Record<string, number[] | null>;
  min?: number;
  max?: number;
  payerName?: string;
  busy: boolean;
  error: string | null;
  onPay: (method: string, amount: number) => void;
  onClose: () => void;
}

export default function CheckoutModal({ methods, amounts = {}, min = 1, max = 10000, payerName, busy, error, onPay, onClose }: Props) {
  const [method, setMethod] = useState<string | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [freeAmount, setFreeAmount] = useState("");

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

  const fixedList = method ? amounts[method] ?? null : null;
  const chosen = amount ?? (freeAmount ? Number(freeAmount) : null);

  function pickMethod(m: string) {
    setMethod(m);
    setAmount(null);
    setFreeAmount("");
  }

  function confirm() {
    if (!method || busy) return;
    const amt = fixedList ? amount : chosen;
    if (!amt || !Number.isFinite(amt)) return;
    onPay(method, amt);
  }

  const info = (m: string) => METHOD_INFO[m] || { name: m.toUpperCase(), icon: "💳", desc: `Pay using ${m}` };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-6" onClick={() => !busy && onClose()} role="dialog" aria-modal="true">
      <div
        className="w-full max-w-3xl bg-white text-neutral-900 rounded-2xl shadow-2xl overflow-hidden flex flex-col md:flex-row min-h-[460px] max-h-[90vh] border border-neutral-200 animate-in fade-in zoom-in duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left summary */}
        <div className="md:w-72 bg-slate-900 text-white p-6 flex flex-col justify-between shrink-0 relative overflow-hidden">
          <div className="relative z-10 space-y-6">
            <div className="flex items-center gap-3">
              <Logo size="sm" />
              <div>
                <p className="font-bold text-base leading-tight">Zara Plays</p>
                <p className="text-[11px] text-emerald-400 font-medium">Secure deposit</p>
              </div>
            </div>
            <div className="bg-slate-800/90 backdrop-blur border border-slate-700/80 rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Amount</span>
                <span className="bg-emerald-500/20 text-emerald-300 text-[10px] px-2 py-0.5 rounded-full font-semibold">256-Bit</span>
              </div>
              <div className="text-3xl font-black text-white tracking-tight">{chosen ? money(chosen) : "—"}</div>
              {method && <p className="text-xs text-slate-300">via {info(method).name}</p>}
              {payerName && (
                <div className="pt-2 text-xs text-slate-300 flex items-center gap-1.5 border-t border-slate-700/60">
                  <span className="text-slate-400">User:</span>
                  <span className="font-medium text-amber-300 truncate">@{payerName}</span>
                </div>
              )}
            </div>
          </div>
          <p className="relative z-10 text-[11px] text-slate-500 pt-6 border-t border-slate-800">🔒 Processed by GGUSOnePay</p>
          <div aria-hidden className="absolute -left-20 -bottom-20 w-60 h-60 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
        </div>

        {/* Right content */}
        <div className="flex-1 flex flex-col bg-white min-w-0">
          <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200 shrink-0">
            <div>
              <h3 className="font-bold text-neutral-800 text-lg">{method ? `Choose amount` : "Select payment method"}</h3>
              <p className="text-xs text-neutral-500">{method ? info(method).name : "Pick how you want to pay"}</p>
            </div>
            <button type="button" onClick={onClose} disabled={busy} className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center disabled:opacity-40" aria-label="Close">
              ✕
            </button>
          </div>

          <div className="flex-1 p-6 overflow-y-auto">
            {!method ? (
              methods.length === 0 ? (
                <p className="text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-xl p-4">No payment methods are available right now. Please try again shortly.</p>
              ) : (
                <div className="grid grid-cols-1 gap-2.5">
                  {methods.map((m) => (
                    <button key={m} type="button" onClick={() => pickMethod(m)} className="w-full p-4 rounded-xl border border-slate-200 bg-slate-50 text-left flex items-center gap-4 hover:bg-emerald-50/60 hover:border-emerald-400">
                      <span className="w-10 h-10 rounded-full bg-slate-900 text-white font-bold flex items-center justify-center shrink-0">{info(m).icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-sm text-slate-900">{info(m).name}</p>
                        <p className="text-xs text-slate-500 truncate">{info(m).desc}</p>
                      </div>
                      <span className="text-emerald-600 font-bold">→</span>
                    </button>
                  ))}
                </div>
              )
            ) : (
              <div className="space-y-4">
                <button type="button" className="text-xs text-slate-500 hover:text-slate-800" onClick={() => setMethod(null)} disabled={busy}>
                  ← Change method
                </button>
                {fixedList && fixedList.length > 0 ? (
                  <>
                    <p className="text-xs text-slate-500">Choose a deposit amount:</p>
                    <div className="grid grid-cols-3 gap-2">
                      {fixedList.map((a) => (
                        <button
                          key={a}
                          type="button"
                          onClick={() => setAmount(a)}
                          disabled={busy}
                          className={`py-3 rounded-xl border text-sm font-bold ${amount === a ? "bg-emerald-500 border-emerald-500 text-white" : "bg-slate-50 border-slate-200 text-slate-800 hover:border-emerald-400"}`}
                        >
                          {money(a)}
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <label className="block text-xs text-slate-500">
                    Enter amount ({money(min)} – {money(max)})
                    <input
                      className="w-full mt-1 border border-slate-300 rounded-xl px-3 py-3 text-lg font-semibold text-slate-900"
                      type="number"
                      inputMode="decimal"
                      min={min}
                      max={max}
                      step="0.01"
                      placeholder="0.00"
                      value={freeAmount}
                      onChange={(e) => setFreeAmount(e.target.value)}
                    />
                  </label>
                )}
              </div>
            )}
          </div>

          {method && (
            <div className="px-6 py-4 border-t border-slate-100 space-y-2 shrink-0">
              {error && <p className="text-xs font-medium text-red-600 bg-red-50 p-2.5 rounded-lg">{error}</p>}
              <button
                type="button"
                onClick={confirm}
                disabled={busy || !chosen}
                className="w-full bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white font-bold py-3 rounded-xl"
              >
                {busy ? "Opening GGUSOnePay…" : chosen ? `Pay ${money(chosen)}` : "Choose an amount"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
