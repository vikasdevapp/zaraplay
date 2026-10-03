"use client";

import { useEffect } from "react";

export interface CashoutRules {
  tierBoundary: number;
  tier1Min: number;
  tier1Max: number;
  tier2Min: number;
  minWithdrawal: number;
  maxWithdrawal: number;
}

interface Props {
  amounts?: Record<string, number[] | null>;
  labels: Record<string, string>;
  minDeposit?: number;
  maxDeposit?: number;
  cashoutRules?: CashoutRules;
  onClose: () => void;
}

const money = (v: number) => (Number.isInteger(v) ? `$${v}` : `$${v.toFixed(2)}`);

export default function RulesModal({ amounts = {}, labels, minDeposit, maxDeposit, cashoutRules, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  // De-duplicate methods that share a label (cashapp/ecashapp both show "Cash App").
  const seen = new Set<string>();
  const depositRows = Object.entries(amounts)
    .map(([method, list]) => ({ label: labels[method] || method, list }))
    .filter((r) => {
      if (seen.has(r.label)) return false;
      seen.add(r.label);
      return true;
    });

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="w-full sm:max-w-lg bg-surface border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h3 className="font-bold text-lg">💡 Deposit &amp; Cashout Rules</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-surface2 text-muted hover:text-white flex items-center justify-center" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6 text-sm">
          {depositRows.length > 0 && (
            <section className="space-y-2">
              <h4 className="font-semibold text-primary">Deposit amounts</h4>
              <p className="text-xs text-muted">
                Pick one of the amounts below for each method{minDeposit != null && maxDeposit != null ? ` (limits $${minDeposit}–$${maxDeposit})` : ""}.
              </p>
              <div className="space-y-3">
                {depositRows.map((r) => (
                  <div key={r.label} className="rounded-xl border border-border bg-surface2/50 p-3">
                    <p className="font-medium mb-1.5">{r.label}</p>
                    {r.list && r.list.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {r.list.map((a) => (
                          <span key={a} className="px-2 py-0.5 rounded-md bg-surface border border-border text-xs font-medium">
                            {money(a)}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted">Any amount within the deposit limits.</p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {cashoutRules && (
            <section className="space-y-2">
              <h4 className="font-semibold text-gold">Cashout (playthrough) rules</h4>
              <p className="text-xs text-muted">How much you can withdraw depends on how much you recharged:</p>
              <ul className="space-y-2">
                <li className="rounded-xl border border-border bg-surface2/50 p-3">
                  <p className="font-medium">Recharge up to {money(cashoutRules.tierBoundary)}</p>
                  <p className="text-xs text-muted">
                    Withdraw between <b>{cashoutRules.tier1Min}×</b> and <b>{cashoutRules.tier1Max}×</b> of what you loaded.
                    Winnings above {cashoutRules.tier1Max}× are forfeited.
                  </p>
                </li>
                <li className="rounded-xl border border-border bg-surface2/50 p-3">
                  <p className="font-medium">Recharge above {money(cashoutRules.tierBoundary)}</p>
                  <p className="text-xs text-muted">
                    Withdraw from <b>{cashoutRules.tier2Min}×</b> of what you loaded — <b>no upper limit</b>.
                  </p>
                </li>
              </ul>
              <p className="text-xs text-muted">
                Wallet cashouts to your bank/Cash App are {money(cashoutRules.minWithdrawal)}–{money(cashoutRules.maxWithdrawal)} and need admin approval.
              </p>
            </section>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border shrink-0">
          <button onClick={onClose} className="btn-primary w-full">
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
