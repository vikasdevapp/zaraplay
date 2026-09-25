"use client";

import { useEffect, useState } from "react";
import Logo from "@/components/Logo";

// In-site checkout sheet shown before handing off to the gateway's hosted cashier page:
// order summary on the left, payment method picker on the right.

const METHODS: Record<string, { label: string; hint: string; badge: string; color: string }> = {
  cashapp: { label: "Cash App", hint: "Scan the QR code or open the Cash App on your phone.", badge: "$", color: "#00d632" },
  ecashapp: { label: "Cash App", hint: "Pay from your Cash App balance.", badge: "$", color: "#00d632" },
  btcpay: { label: "Cash App (BTC)", hint: "Pay with Bitcoin from your Cash App.", badge: "₿", color: "#f7931a" },
  zelle: { label: "Zelle", hint: "Send the payment from your bank's Zelle.", badge: "Z", color: "#6d1ed4" },
  chime: { label: "Chime", hint: "Pay from your Chime account.", badge: "C", color: "#1ec677" },
  paypal: { label: "PayPal", hint: "Log in to PayPal to complete the payment.", badge: "P", color: "#003087" },
  venmo: { label: "Venmo", hint: "Pay with your Venmo account.", badge: "V", color: "#008cff" },
  applepay: { label: "Apple Pay", hint: "Pay with Apple Pay on a supported device.", badge: "", color: "#000000" },
  googlepay: { label: "Google Pay", hint: "Pay with Google Pay.", badge: "G", color: "#4285f4" },
  card: { label: "Cards", hint: "Visa, Mastercard and other debit/credit cards.", badge: "▭", color: "#1a1f71" },
};

interface Props {
  amount: number;
  methods: string[];
  initialMethod?: string;
  payerName?: string;
  busy: boolean;
  error: string | null;
  onPay: (method: string) => void;
  onClose: () => void;
}

export default function CheckoutModal({ amount, methods, initialMethod, payerName, busy, error, onPay, onClose }: Props) {
  const [method, setMethod] = useState(initialMethod && methods.includes(initialMethod) ? initialMethod : methods[0]);
  const info = METHODS[method] || { label: method, hint: "", badge: "•", color: "#555" };

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

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 sm:p-4"
      onClick={() => !busy && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label="Payment options"
    >
      <div
        className="w-full sm:max-w-3xl max-h-[95vh] overflow-hidden rounded-t-2xl sm:rounded-2xl flex flex-col sm:flex-row shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Summary */}
        <div className="relative sm:w-[38%] bg-gradient-to-br from-primary to-primary-dark text-white p-5 sm:p-6 flex flex-col gap-4 overflow-hidden">
          <Logo size="sm" />
          <div className="rounded-xl bg-white/95 text-neutral-900 p-4">
            <p className="text-sm text-neutral-600">Price Summary</p>
            <p className="text-3xl font-extrabold mt-1">${amount.toFixed(2)}</p>
            <p className="text-xs text-neutral-500 mt-1">Deposit bonus is added once payment is confirmed.</p>
          </div>
          {payerName && (
            <div className="rounded-xl bg-white/95 text-neutral-900 px-4 py-3 text-sm flex items-center gap-2">
              <span aria-hidden>👤</span>
              Paying as <span className="font-semibold truncate">{payerName}</span>
            </div>
          )}
          <p className="hidden sm:block mt-auto text-xs text-white/80">🔒 Secured by GGUSOnePay</p>
          <div aria-hidden className="pointer-events-none absolute -right-16 -bottom-16 w-56 h-56 rounded-full bg-white/10" />
        </div>

        {/* Methods */}
        <div className="flex-1 bg-white text-neutral-900 flex flex-col min-h-0">
          <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-200">
            <h2 className="font-semibold">Payment Options</h2>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="w-8 h-8 rounded-full hover:bg-neutral-100 text-neutral-500 disabled:opacity-40"
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          <div className="flex flex-col sm:flex-row flex-1 min-h-0 overflow-y-auto">
            <ul className="sm:w-48 shrink-0 bg-neutral-50 sm:border-r border-neutral-200 flex sm:flex-col overflow-x-auto">
              {methods.map((m) => {
                const mi = METHODS[m] || { label: m, badge: "•", color: "#555" };
                const active = m === method;
                return (
                  <li key={m} className="shrink-0">
                    <button
                      type="button"
                      onClick={() => setMethod(m)}
                      disabled={busy}
                      className={`w-full flex items-center gap-3 px-4 py-4 text-left text-sm transition-colors ${
                        active ? "bg-white font-semibold sm:border-l-4 border-b-2 sm:border-b-0 border-primary" : "hover:bg-neutral-100"
                      }`}
                    >
                      <span
                        className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                        style={{ background: mi.color }}
                      >
                        {mi.badge}
                      </span>
                      <span className="whitespace-nowrap">{mi.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="flex-1 p-5 flex flex-col gap-4">
              <div className="rounded-xl bg-neutral-100 p-4 flex items-center gap-4">
                <span
                  className="w-12 h-12 rounded-full flex items-center justify-center text-white text-lg font-bold shrink-0"
                  style={{ background: info.color }}
                >
                  {info.badge}
                </span>
                <div>
                  <p className="font-semibold">{info.label}</p>
                  <p className="text-sm text-neutral-600">{info.hint}</p>
                </div>
              </div>
              <p className="text-xs text-neutral-500">
                You&apos;ll continue on the secure payment page to finish paying. Your balance updates automatically once the payment is confirmed.
              </p>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button
                type="button"
                onClick={() => onPay(method)}
                disabled={busy}
                className="mt-auto w-full rounded-xl bg-primary hover:bg-primary-dark text-white font-semibold py-3 disabled:opacity-60"
              >
                {busy ? "Opening secure payment…" : `Pay $${amount.toFixed(2)}`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
