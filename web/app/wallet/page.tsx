"use client";

import { useEffect, useState, useCallback, FormEvent } from "react";
import AppShell from "@/components/AppShell";
import { useApi } from "@/context/AuthContext";
import { ApiError } from "@/lib/api";

interface Wallet {
  balance: string;
  freePlay: string;
  totalDeposited: string;
}

interface Transaction {
  id: string;
  type: string;
  amount: string;
  status: "PENDING" | "COMPLETED" | "REJECTED";
  createdAt: string;
  payoutAmount?: string | null;
  forfeitedAmount?: string | null;
}

export default function WalletPage() {
  const api = useApi();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [depositAmount, setDepositAmount] = useState("");
  const [cashoutAmount, setCashoutAmount] = useState("");
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState<"deposit" | "cashout" | null>(null);

  const load = useCallback(async () => {
    const [w, t] = await Promise.all([
      api<{ wallet: Wallet }>("/api/wallet"),
      api<{ transactions: Transaction[] }>("/api/wallet/transactions"),
    ]);
    setWallet(w.wallet);
    setTransactions(t.transactions);
  }, [api]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  async function handleDeposit(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    setBusy("deposit");
    try {
      const res = await api<{ bonus: { kind: string; percent: number; amount: number } }>("/api/wallet/deposit", {
        method: "POST",
        body: JSON.stringify({ amount: Number(depositAmount) }),
      });
      setMessage({
        type: "success",
        text: `Deposit requested — pending admin approval. Once approved you'll get +${res.bonus.percent}% bonus ($${res.bonus.amount.toFixed(2)}).`,
      });
      setDepositAmount("");
      await load();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof ApiError ? err.message : "Deposit failed." });
    } finally {
      setBusy(null);
    }
  }

  async function handleCashout(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    setBusy("cashout");
    try {
      const res = await api<{ payout: number; forfeited: number; note?: string }>("/api/wallet/cashout", {
        method: "POST",
        body: JSON.stringify({ amount: Number(cashoutAmount) }),
      });
      setMessage({
        type: "success",
        text: `Cashout requested: $${res.payout.toFixed(2)}${res.note ? ` — ${res.note}` : ""}`,
      });
      setCashoutAmount("");
      await load();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof ApiError ? err.message : "Cashout failed." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="card">
          <p className="text-muted text-sm">Wallet Balance</p>
          <p className="text-4xl font-extrabold text-primary mb-1">${Number(wallet?.balance ?? 0).toFixed(2)}</p>
          <p className="text-sm text-muted">Free Play: {Number(wallet?.freePlay ?? 0).toFixed(2)} FP</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <form onSubmit={handleDeposit} className="card space-y-3">
            <h2 className="font-bold">Deposit</h2>
            <input
              className="input"
              type="number"
              min="1"
              step="0.01"
              placeholder="Amount ($)"
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
              required
            />
            <button type="submit" className="btn-primary w-full" disabled={busy === "deposit"}>
              {busy === "deposit" ? "Processing…" : "Deposit"}
            </button>
            <p className="text-xs text-muted">
              First deposit: 100% bonus · Tuesdays: 50% bonus · Otherwise: 20% bonus. Requests need
              admin approval before funds land in your balance.
            </p>
          </form>

          <form onSubmit={handleCashout} className="card space-y-3">
            <h2 className="font-bold">Cashout</h2>
            <input
              className="input"
              type="number"
              min="1"
              step="0.01"
              placeholder="Amount ($)"
              value={cashoutAmount}
              onChange={(e) => setCashoutAmount(e.target.value)}
              required
            />
            <button type="submit" className="btn-gold w-full" disabled={busy === "cashout"}>
              {busy === "cashout" ? "Processing…" : "Cashout"}
            </button>
            <p className="text-xs text-muted">
              $5-$35 deposit: 5x-10x cashout · &gt;$35 deposit: min 3x, no max. Amounts above your
              tier max are forfeited beyond the limit. Requests need admin approval before payout.
            </p>
          </form>
        </div>

        {message && (
          <p className={`text-sm ${message.type === "error" ? "text-red-400" : "text-green-400"}`}>{message.text}</p>
        )}

        <div className="card">
          <h2 className="font-bold mb-3">Recent Transactions</h2>
          {transactions.length === 0 && <p className="text-muted text-sm">No transactions yet.</p>}
          <div className="divide-y divide-border">
            {transactions.map((t) => (
              <div key={t.id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <p className="font-medium">
                    {t.type.replace(/_/g, " ")}{" "}
                    {t.status !== "COMPLETED" && (
                      <span
                        className={`ml-1 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${
                          t.status === "PENDING" ? "bg-yellow-500/20 text-yellow-400" : "bg-red-500/20 text-red-400"
                        }`}
                      >
                        {t.status}
                      </span>
                    )}
                  </p>
                  <p className="text-muted text-xs">{new Date(t.createdAt).toLocaleString()}</p>
                  {t.type === "CASHOUT" && Number(t.forfeitedAmount ?? 0) > 0 && (
                    <p className="text-muted text-xs">
                      Payout ${Number(t.payoutAmount).toFixed(2)} · forfeited ${Number(t.forfeitedAmount).toFixed(2)}
                    </p>
                  )}
                </div>
                <p className={t.type === "CASHOUT" ? "text-red-400" : "text-green-400"}>
                  {t.type === "CASHOUT" ? "-" : "+"}${Number(t.amount).toFixed(2)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
