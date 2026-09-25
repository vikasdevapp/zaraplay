"use client";

import { useEffect, useState, useCallback, FormEvent, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import CheckoutModal from "@/components/CheckoutModal";
import { useApi, useAuth } from "@/context/AuthContext";
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
  gatewayProvider?: string | null;
  meta?: { cashierUrl?: string; expireTimestamp?: number; payout?: { wayCode: string; account: string } } | null;
}

// Stable per-browser id the gateway uses for fraud checks and payment success rate. Falls
// back to a fresh id each time if storage is unavailable (private mode, blocked storage).
function getDeviceId() {
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

interface PaymentOptions {
  deposit: { gateway: boolean; methods: string[] };
  cashout: { gateway: boolean; methods: string[] };
}

const METHOD_LABELS: Record<string, string> = {
  cashapp: "Cash App",
  ecashapp: "Cash App",
  zelle: "Zelle",
  btcpay: "Cash App (BTC)",
  paypal: "PayPal",
  applepay: "Apple Pay",
  googlepay: "Google Pay",
  card: "Card",
  chime: "Chime",
  venmo: "Venmo",
};

// Cashout method names shown to users (the deposit list uses METHOD_LABELS).
const PAYOUT_LABELS: Record<string, string> = {
  card: "Debit card (instant transfer)",
  ecashapp: "Cash App ($Cashtag)",
  chime: "Chime ($ChimeSign)",
};

interface SavedPayoutMethod {
  id: string;
  wayCode: string;
  account: string;
  cardValid?: string | null;
  usable: boolean;
}

const PAYOUT_PLACEHOLDER: Record<string, string> = {
  ecashapp: "$Cashtag",
  chime: "$ChimeSign",
  paypal: "PayPal email",
  venmo: "Venmo email",
  zelle: "Zelle email or phone",
};

function WalletContent() {
  const api = useApi();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [options, setOptions] = useState<PaymentOptions | null>(null);
  const [depositMethod, setDepositMethod] = useState("");
  const [payoutMethod, setPayoutMethod] = useState("");
  const [payoutAccount, setPayoutAccount] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [cardExpiry, setCardExpiry] = useState("");
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [depositAmount, setDepositAmount] = useState("");
  const [cashoutAmount, setCashoutAmount] = useState("");
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState<"deposit" | "cashout" | null>(null);
  const { user } = useAuth();
  const [checkoutAmount, setCheckoutAmount] = useState<number | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const closeCheckout = useCallback(() => setCheckoutAmount(null), []);
  const [savedMethods, setSavedMethods] = useState<SavedPayoutMethod[]>([]);
  const [selectedMethodId, setSelectedMethodId] = useState("");
  const [addingMethod, setAddingMethod] = useState(false);
  const [savingMethod, setSavingMethod] = useState(false);
  const [methodError, setMethodError] = useState<string | null>(null);

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
    api<PaymentOptions>("/api/wallet/payment-options")
      .then((o) => {
        setOptions(o);
        setDepositMethod(o.deposit.methods[0] || "");
        setPayoutMethod(o.cashout.methods[0] || "");
      })
      .catch(() => {});
    api<{ methods: SavedPayoutMethod[] }>("/api/wallet/payout-methods")
      .then(({ methods }) => {
        setSavedMethods(methods);
        setSelectedMethodId(methods.find((m) => m.usable)?.id || "");
        setAddingMethod(methods.length === 0);
      })
      .catch(() => {});
  }, [load, api]);

  async function saveMethod() {
    setMethodError(null);
    setSavingMethod(true);
    try {
      const { method } = await api<{ method: SavedPayoutMethod }>("/api/wallet/payout-methods", {
        method: "POST",
        body: JSON.stringify(
          payoutMethod === "card" ? { wayCode: "card", cardNumber, cardExpiry } : { wayCode: payoutMethod, account: payoutAccount }
        ),
      });
      setSavedMethods((list) => (list.some((m) => m.id === method.id) ? list : [...list, method]));
      setSelectedMethodId(method.id);
      setAddingMethod(false);
      // Don't keep card details around in page state after they've been saved.
      setPayoutAccount("");
      setCardNumber("");
      setCardExpiry("");
    } catch (err) {
      setMethodError(err instanceof ApiError ? err.message : "Could not save this payout method.");
    } finally {
      setSavingMethod(false);
    }
  }

  async function deleteMethod(id: string) {
    if (!window.confirm("Remove this payout method?")) return;
    try {
      await api(`/api/wallet/payout-methods/${id}`, { method: "DELETE" });
      const rest = savedMethods.filter((m) => m.id !== id);
      setSavedMethods(rest);
      if (selectedMethodId === id) setSelectedMethodId(rest.find((m) => m.usable)?.id || "");
      if (!rest.length) setAddingMethod(true);
    } catch (err) {
      setMethodError(err instanceof ApiError ? err.message : "Could not remove this payout method.");
    }
  }

  // Back from the gateway's cashier page (returnUrl = /wallet?status=…&mchOrderNo=…). The
  // query string is only a hint; the server re-checks the order with the gateway.
  const returnedOrder = searchParams.get("mchOrderNo");
  useEffect(() => {
    if (!returnedOrder) return;
    router.replace("/wallet");
    api<{ transaction: Transaction }>(`/api/wallet/deposit/${encodeURIComponent(returnedOrder)}/refresh`, { method: "POST" })
      .then(({ transaction }) => {
        if (transaction.status === "COMPLETED") setMessage({ type: "success", text: "Payment received — your balance has been updated." });
        else if (transaction.status === "REJECTED") setMessage({ type: "error", text: "The payment was not completed." });
        else setMessage({ type: "success", text: "Payment is processing. Your balance will update as soon as it's confirmed." });
        return load();
      })
      .catch(() => {});
  }, [returnedOrder, api, load, router]);

  async function handleDeposit(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    // Gateway deposits pick a method in the checkout sheet first; the order is created from there.
    if (options?.deposit.gateway && options.deposit.methods.length) {
      setCheckoutError(null);
      setCheckoutAmount(Number(depositAmount));
      return;
    }
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

  async function payWithGateway(method: string) {
    if (checkoutAmount === null) return;
    setCheckoutError(null);
    setBusy("deposit");
    try {
      const res = await api<{ cashierUrl?: string }>("/api/wallet/deposit", {
        method: "POST",
        body: JSON.stringify({ amount: checkoutAmount, wayCode: method, deviceId: getDeviceId() }),
      });
      if (res.cashierUrl) {
        setDepositMethod(method);
        window.location.href = res.cashierUrl;
        return; // keep the sheet in its busy state while the browser navigates away
      }
      setCheckoutError("Could not open the payment page. Please try again.");
    } catch (err) {
      setCheckoutError(err instanceof ApiError ? err.message : "Could not start the payment. Please try again.");
    }
    setBusy(null);
  }

  async function refreshDeposit(id: string) {
    try {
      const { transaction } = await api<{ transaction: Transaction }>(`/api/wallet/deposit/${id}/refresh`, { method: "POST" });
      if (transaction.status === "COMPLETED") setMessage({ type: "success", text: "Payment received — your balance has been updated." });
      else if (transaction.status === "PENDING") setMessage({ type: "success", text: "Still waiting for payment confirmation." });
      await load();
    } catch {
      setMessage({ type: "error", text: "Could not check the payment right now." });
    }
  }

  async function handleCashout(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    const needsMethod = !!options?.cashout.methods.length;
    if (needsMethod && !selectedMethodId) {
      setMessage({ type: "error", text: "Add or choose where to receive your payout." });
      return;
    }
    setBusy("cashout");
    try {
      const res = await api<{ payout: number; forfeited: number; note?: string }>("/api/wallet/cashout", {
        method: "POST",
        body: JSON.stringify({
          amount: Number(cashoutAmount),
          payoutMethodId: needsMethod ? selectedMethodId : undefined,
        }),
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
              First deposit: 100% bonus · Tuesdays: 50% bonus · Otherwise: 20% bonus.{" "}
              {options?.deposit.gateway
                ? "You'll be taken to a secure payment page; funds land in your balance once payment is confirmed."
                : "Requests need admin approval before funds land in your balance."}
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
            {!!options?.cashout.methods.length && (
              <div className="space-y-2">
                <p className="text-sm text-muted">Withdraw to</p>
                {savedMethods.map((m) => (
                  <label
                    key={m.id}
                    className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm ${
                      !m.usable
                        ? "border-border opacity-50"
                        : selectedMethodId === m.id
                          ? "border-primary bg-primary/10 cursor-pointer"
                          : "border-border bg-surface2 cursor-pointer"
                    }`}
                  >
                    <input
                      type="radio"
                      name="payoutMethod"
                      className="accent-primary"
                      checked={selectedMethodId === m.id}
                      disabled={!m.usable}
                      onChange={() => setSelectedMethodId(m.id)}
                    />
                    <span className="flex-1 min-w-0">
                      <span className="font-medium">{PAYOUT_LABELS[m.wayCode] || METHOD_LABELS[m.wayCode] || m.wayCode}</span>
                      <span className="block text-muted truncate">
                        {m.account}
                        {m.cardValid && ` · exp ${m.cardValid}`}
                        {!m.usable && " · no longer available"}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => deleteMethod(m.id)}
                      className="text-muted hover:text-red-400 px-1"
                      aria-label="Remove payout method"
                    >
                      ✕
                    </button>
                  </label>
                ))}

                {addingMethod ? (
                  <div className="rounded-xl border border-border p-3 space-y-2">
                    <select className="input" value={payoutMethod} onChange={(e) => setPayoutMethod(e.target.value)}>
                      {options.cashout.methods.map((m) => (
                        <option key={m} value={m}>
                          {PAYOUT_LABELS[m] || METHOD_LABELS[m] || m}
                        </option>
                      ))}
                    </select>
                    {payoutMethod === "card" ? (
                      <div className="grid grid-cols-3 gap-2">
                        <input
                          className="input col-span-2"
                          inputMode="numeric"
                          autoComplete="cc-number"
                          placeholder="Card number"
                          maxLength={23}
                          value={cardNumber}
                          onChange={(e) => setCardNumber(e.target.value.replace(/[^\d ]/g, ""))}
                        />
                        <input
                          className="input"
                          inputMode="numeric"
                          autoComplete="cc-exp"
                          placeholder="MM/YY"
                          maxLength={7}
                          value={cardExpiry}
                          onChange={(e) => setCardExpiry(e.target.value.replace(/[^\d/]/g, ""))}
                        />
                      </div>
                    ) : (
                      <input
                        className="input"
                        placeholder={PAYOUT_PLACEHOLDER[payoutMethod] || "Payout account"}
                        value={payoutAccount}
                        onChange={(e) => setPayoutAccount(e.target.value)}
                      />
                    )}
                    {payoutMethod === "card" && (
                      <p className="text-xs text-muted">Debit card only. We never ask for your CVV or PIN.</p>
                    )}
                    {methodError && <p className="text-xs text-red-400">{methodError}</p>}
                    <div className="flex gap-2">
                      <button type="button" onClick={saveMethod} disabled={savingMethod} className="btn-primary flex-1 py-2">
                        {savingMethod ? "Saving…" : "Save"}
                      </button>
                      {savedMethods.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setAddingMethod(false);
                            setMethodError(null);
                          }}
                          className="flex-1 rounded-xl border border-border py-2 text-sm text-muted hover:text-white"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                    {methodError && <p className="text-xs text-red-400">{methodError}</p>}
                    <button
                      type="button"
                      onClick={() => {
                        setAddingMethod(true);
                        setMethodError(null);
                      }}
                      className="w-full rounded-xl border border-dashed border-border py-2.5 text-sm text-muted hover:text-white"
                    >
                      + Add payout method
                    </button>
                  </>
                )}
              </div>
            )}
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
                  {t.type === "CASHOUT" && t.meta?.payout && (
                    <p className="text-muted text-xs">
                      To {METHOD_LABELS[t.meta.payout.wayCode] || t.meta.payout.wayCode} · {t.meta.payout.account}
                    </p>
                  )}
                  {t.type === "DEPOSIT" &&
                    t.status === "PENDING" &&
                    t.gatewayProvider &&
                    t.meta?.cashierUrl &&
                    (t.meta.expireTimestamp ?? 0) > Date.now() && (
                      <p className="text-xs mt-0.5 flex gap-3">
                        <a href={t.meta.cashierUrl} className="text-primary font-medium">
                          Continue payment →
                        </a>
                        <button type="button" onClick={() => refreshDeposit(t.id)} className="text-muted underline">
                          Refresh
                        </button>
                      </p>
                    )}
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

      {checkoutAmount !== null && options && (
        <CheckoutModal
          amount={checkoutAmount}
          methods={options.deposit.methods}
          initialMethod={depositMethod}
          payerName={user?.username}
          busy={busy === "deposit"}
          error={checkoutError}
          onPay={payWithGateway}
          onClose={closeCheckout}
        />
      )}
    </AppShell>
  );
}

// useSearchParams (cashier return) needs a Suspense boundary for the static build.
export default function WalletPage() {
  return (
    <Suspense>
      <WalletContent />
    </Suspense>
  );
}
