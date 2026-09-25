/**
 * Local stand-in for the GGUSOnePay gateway, so the whole deposit/payout flow can be tested
 * without a merchant account. Dev only — never deploy this.
 *
 *   npm run mock:gateway            (listens on :4900)
 *
 * Then in server/.env:
 *   GGUSONEPAY_BASE_URL="http://127.0.0.1:4900"
 *   GGUSONEPAY_MCH_NO="MOCK"                  (any value)
 *   GGUSONEPAY_NOTIFY_IPS="127.0.0.1"         (callbacks come from this machine)
 *   API_PUBLIC_URL="http://127.0.0.1:4000"
 *   GGUSONEPAY_TRANSFER_WAY_CODES="ecashapp,paypal"   (to test payouts)
 *
 * Deposits: "Continue to payment" opens the mock cashier with Success / Fail / Underpay.
 * Payouts: open http://127.0.0.1:4900 and mark transfers Success or Fail.
 * Requests are signature-checked with GGUSONEPAY_API_KEY, the same as the real gateway.
 */
import "dotenv/config";
import express from "express";
import { sign, verifySign } from "../src/lib/ggusonepay";

const PORT = Number(process.env.MOCK_GATEWAY_PORT || 4900);
const KEY = process.env.GGUSONEPAY_API_KEY || "";

interface PayOrder {
  payOrderNo: string;
  mchOrderNo: string;
  amount: number;
  realAmount?: number;
  currency: string;
  wayCode: string;
  state: number;
  notifyUrl?: string;
  returnUrl?: string;
  createTime: number;
  successTime?: number;
}
interface TransferOrder {
  transferOrderNo: string;
  mchOrderNo: string;
  amount: number;
  currency: string;
  wayCode: string;
  wayParam: Record<string, string>;
  state: number;
  notifyUrl?: string;
  createTime: number;
  successTime?: number;
}

const pays = new Map<string, PayOrder>();
const transfers = new Map<string, TransferOrder>();
const STATE_NAMES = ["Created", "In payment", "Success", "Failed", "Cancelled", "Refunded", "Closed", "Disputed"];

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

function signed(req: express.Request, res: express.Response) {
  if (!verifySign(req.body, KEY)) {
    res.json({ code: 12, msg: "Signature error" });
    return false;
  }
  return true;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

async function sendNotify(url: string | undefined, fields: Record<string, unknown>) {
  if (!url) return "no notifyUrl";
  const params: Record<string, unknown> = { ...fields, signType: "MD5" };
  params.sign = sign(params, KEY);
  const body = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)])
  );
  try {
    const r = await fetch(url, { method: "POST", body });
    return `${r.status} ${await r.text()}`;
  } catch (err) {
    return `callback failed: ${err instanceof Error ? err.message : err}`;
  }
}

// ---- Pay-in API
app.post("/api/pay/create", (req, res) => {
  if (!signed(req, res)) return;
  const b = req.body;
  if (pays.has(b.mchOrderNo)) return res.json({ code: 14, msg: "Duplicate Request" });
  if (!Number.isInteger(b.amount) || b.amount <= 0) return res.json({ code: 11, msg: "amount must be integer cents" });
  const o: PayOrder = {
    payOrderNo: `P${Date.now()}${Math.floor(Math.random() * 1000)}`,
    mchOrderNo: b.mchOrderNo,
    amount: b.amount,
    currency: b.currency,
    wayCode: b.wayCode,
    state: 0,
    notifyUrl: b.notifyUrl,
    returnUrl: b.returnUrl,
    createTime: Date.now(),
  };
  pays.set(o.mchOrderNo, o);
  res.json({
    code: 0,
    msg: "SUCCESS",
    data: {
      payOrderNo: o.payOrderNo,
      mchOrderNo: o.mchOrderNo,
      state: 0,
      cashierUrl: `http://127.0.0.1:${PORT}/cashier/${encodeURIComponent(o.mchOrderNo)}`,
      expireTimestamp: Date.now() + (Number(b.expiredTime) || 7200) * 1000,
    },
  });
});

app.post("/api/pay/query", (req, res) => {
  if (!signed(req, res)) return;
  const o = pays.get(req.body.mchOrderNo);
  res.json(o ? { code: 0, msg: "SUCCESS", data: o } : { code: 11, msg: "Order not found" });
});

app.post("/api/pay/close", (req, res) => {
  if (!signed(req, res)) return;
  const o = pays.get(req.body.mchOrderNo);
  if (o && o.state < 2) o.state = 6;
  res.json({ code: 0, msg: "SUCCESS", data: {} });
});

// ---- Payout API
app.post("/api/transfer/create", (req, res) => {
  if (!signed(req, res)) return;
  const b = req.body;
  if (transfers.has(b.mchOrderNo)) return res.json({ code: 14, msg: "Duplicate Request" });
  const o: TransferOrder = {
    transferOrderNo: `T${Date.now()}${Math.floor(Math.random() * 1000)}`,
    mchOrderNo: b.mchOrderNo,
    amount: b.amount,
    currency: b.currency,
    wayCode: b.wayCode,
    wayParam: b.wayParam || {},
    state: 1,
    notifyUrl: b.notifyUrl,
    createTime: Date.now(),
  };
  transfers.set(o.mchOrderNo, o);
  res.json({ code: 0, msg: "SUCCESS", data: { transferOrderNo: o.transferOrderNo, mchOrderNo: o.mchOrderNo, state: o.state } });
});

app.post("/api/transfer/query", (req, res) => {
  if (!signed(req, res)) return;
  const o = transfers.get(req.body.mchOrderNo);
  res.json(o ? { code: 0, msg: "SUCCESS", data: o } : { code: 11, msg: "Order not found" });
});

app.post("/api/balance/query", (req, res) => {
  if (!signed(req, res)) return;
  const pending = [...transfers.values()].filter((t) => t.state < 2).reduce((s, t) => s + t.amount, 0);
  const paidIn = [...pays.values()].filter((p) => p.state === 2).reduce((s, p) => s + (p.realAmount ?? p.amount), 0);
  const paidOut = [...transfers.values()].filter((t) => t.state === 2).reduce((s, t) => s + t.amount, 0);
  const balance = 1_000_000 + paidIn - paidOut;
  res.json({
    code: 0,
    msg: "SUCCESS",
    data: { mchNo: req.body.mchNo, accounts: [{ currency: "usd", balance, availableBalance: balance - pending, transferPendingAmount: pending, delayAmount: 0 }] },
  });
});

app.get("/api/health", (_req, res) => res.json({ code: 0, msg: "SUCCESS", data: null, sign: null, signType: null }));

// ---- Cashier page (what the user sees after "Continue to payment")
const page = (title: string, body: string) => `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;background:#0f1115;color:#e8e8ea;max-width:720px;margin:40px auto;padding:0 16px}
.card{background:#1a1d24;border:1px solid #2a2e37;border-radius:12px;padding:20px;margin-bottom:16px}
button{border:0;border-radius:8px;padding:10px 16px;font-weight:600;cursor:pointer;margin:4px 8px 4px 0}
.ok{background:#22c55e;color:#04120a}.bad{background:#ef4444;color:#fff}.warn{background:#eab308;color:#1a1400}
.muted{color:#9aa0aa;font-size:13px}table{width:100%;border-collapse:collapse;font-size:14px}td,th{padding:6px;border-bottom:1px solid #2a2e37;text-align:left}
form{display:inline}</style></head><body><p class="muted">MOCK GGUSOnePay — local testing only</p>${body}</body></html>`;

// Hosted-checkout look (summary panel + payment panel), so local testing resembles a real cashier.
const cashierPage = (o: PayOrder, body: string) => `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Pay ${usd(o.amount)}</title>
<style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
background:#e9ebf0;font-family:system-ui,sans-serif;color:#1c1f26;padding:16px}
.box{display:flex;width:100%;max-width:760px;border-radius:16px;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.18)}
.side{width:38%;background:linear-gradient(135deg,#dc2626,#991b1b);color:#fff;padding:24px;display:flex;flex-direction:column;gap:16px}
.side .sum{background:#fff;color:#1c1f26;border-radius:12px;padding:16px}.side .sum b{display:block;font-size:30px;margin-top:4px}
.side small{margin-top:auto;opacity:.85}.main{flex:1;background:#fff;padding:24px;display:flex;flex-direction:column;gap:14px}
.muted{color:#6b7280;font-size:13px}.method{background:#f3f4f6;border-radius:12px;padding:16px;font-weight:600}
.qr{width:140px;height:140px;background:repeating-conic-gradient(#111 0 25%,#fff 0 50%) 0 0/20px 20px;border:8px solid #fff;outline:1px solid #ddd}
button{width:100%;border:0;border-radius:10px;padding:12px;font-weight:600;cursor:pointer;margin-top:6px;font-size:15px}
.ok{background:#dc2626;color:#fff}.bad{background:#f3f4f6;color:#b91c1c}.warn{background:#fef3c7;color:#92400e}
.test{border-top:1px dashed #ddd;padding-top:10px}
@media(max-width:640px){.box{flex-direction:column}.side{width:100%}}</style></head><body>
<div class="box"><div class="side"><strong style="font-size:20px">ZaraPlay</strong>
<div class="sum"><span class="muted">Price Summary</span><b>${usd(o.amount)}</b></div>
<small>🔒 MOCK GGUSOnePay — local testing only</small></div>
<div class="main">${body}</div></div></body></html>`;

app.get("/cashier/:mchOrderNo", (req, res) => {
  const o = pays.get(req.params.mchOrderNo);
  if (!o) return res.status(404).send(page("Not found", `<div class="card">Order not found (the mock was restarted?).</div>`));
  const id = encodeURIComponent(o.mchOrderNo);
  res.send(
    cashierPage(
      o,
      `<h2 style="margin:0">Payment Options</h2>
      <div class="method">${esc(o.wayCode)}</div>
      ${
        o.state < 2
          ? `<div style="display:flex;gap:16px;align-items:center"><div class="qr"></div>
             <p class="muted">Scan the QR with the app to pay.<br>Order ${esc(o.payOrderNo)}</p></div>
             <form method="post" action="/cashier/${id}/success"><button class="ok">Pay ${usd(o.amount)}</button></form>
             <div class="test"><p class="muted">Test outcomes</p>
             <form method="post" action="/cashier/${id}/fail"><button class="bad">Payment fails</button></form>
             <form method="post" action="/cashier/${id}/underpay"><button class="warn">Underpay by $1</button></form></div>`
          : `<p>This order is already ${STATE_NAMES[o.state].toLowerCase()}.</p>`
      }`
    )
  );
});

app.post("/cashier/:mchOrderNo/:result", async (req, res) => {
  const o = pays.get(req.params.mchOrderNo);
  if (!o || o.state >= 2) return res.redirect(`/cashier/${encodeURIComponent(req.params.mchOrderNo)}`);
  const result = req.params.result;
  o.state = result === "fail" ? 3 : 2;
  if (result === "underpay") o.realAmount = Math.max(1, o.amount - 100);
  if (o.state === 2) o.successTime = Date.now();

  // Like the real gateway, the async notify is only sent for successful payments.
  const cb =
    o.state === 2
      ? await sendNotify(o.notifyUrl, {
          orderNo: o.payOrderNo, mchOrderNo: o.mchOrderNo, wayCode: o.wayCode, amount: o.amount,
          realAmount: o.realAmount, currency: o.currency, state: o.state, createTime: o.createTime, successTime: o.successTime,
        })
      : "not sent (failed payment)";
  console.log(`[mock] pay ${o.mchOrderNo} -> ${STATE_NAMES[o.state]}; notify: ${cb}`);

  if (!o.returnUrl) return res.redirect(`/cashier/${encodeURIComponent(o.mchOrderNo)}`);
  const status = o.state === 2 ? "succeeded" : "failed";
  const sep = o.returnUrl.includes("?") ? "&" : "?";
  res.redirect(`${o.returnUrl}${sep}status=${status}&mchOrderNo=${encodeURIComponent(o.mchOrderNo)}&amount=${o.amount}`);
});

// ---- Dashboard: all orders, with payout Success/Fail controls and pay-in refund/dispute
app.get("/", (_req, res) => {
  const payRows = [...pays.values()].reverse().map((o) => {
    const id = encodeURIComponent(o.mchOrderNo);
    const actions =
      o.state === 2
        ? `<form method="post" action="/admin/pay/${id}/5"><button class="warn">Refund</button></form>
           <form method="post" action="/admin/pay/${id}/7"><button class="bad">Dispute</button></form>`
        : o.state < 2
          ? `<a href="/cashier/${id}">cashier</a>`
          : "";
    return `<tr><td>${esc(o.payOrderNo)}</td><td>${usd(o.amount)}${o.realAmount ? ` (paid ${usd(o.realAmount)})` : ""}</td><td>${esc(o.wayCode)}</td><td>${STATE_NAMES[o.state]}</td><td>${actions}</td></tr>`;
  });
  const transferRows = [...transfers.values()].reverse().map((o) => {
    const id = encodeURIComponent(o.mchOrderNo);
    const actions =
      o.state < 2
        ? `<form method="post" action="/admin/transfer/${id}/2"><button class="ok">Success</button></form>
           <form method="post" action="/admin/transfer/${id}/3"><button class="bad">Fail</button></form>`
        : "";
    return `<tr><td>${esc(o.transferOrderNo)}</td><td>${usd(o.amount)}</td><td>${esc(o.wayCode)} ${esc(JSON.stringify(o.wayParam))}</td><td>${STATE_NAMES[o.state]}</td><td>${actions}</td></tr>`;
  });
  res.send(
    page(
      "Mock gateway",
      `<div class="card"><h2>Pay-in orders</h2><table><tr><th>Order</th><th>Amount</th><th>Method</th><th>State</th><th></th></tr>${payRows.join("") || '<tr><td colspan="5" class="muted">None yet</td></tr>'}</table></div>
       <div class="card"><h2>Payouts</h2><table><tr><th>Order</th><th>Amount</th><th>To</th><th>State</th><th></th></tr>${transferRows.join("") || '<tr><td colspan="5" class="muted">None yet</td></tr>'}</table></div>
       <p class="muted">State lives in memory — restarting the mock forgets all orders.</p>`
    )
  );
});

app.post("/admin/transfer/:mchOrderNo/:state", async (req, res) => {
  const o = transfers.get(req.params.mchOrderNo);
  if (o && o.state < 2) {
    o.state = Number(req.params.state) === 2 ? 2 : 3;
    if (o.state === 2) o.successTime = Date.now();
    const cb = await sendNotify(o.notifyUrl, {
      orderNo: o.transferOrderNo, mchOrderNo: o.mchOrderNo, wayCode: o.wayCode, amount: o.amount, currency: o.currency,
      state: o.state, reviewCode: o.state === 2 ? "11" : "25", errMsg: o.state === 3 ? "Tag error (mock)" : undefined,
      createTime: o.createTime, successTime: o.successTime,
    });
    console.log(`[mock] transfer ${o.mchOrderNo} -> ${STATE_NAMES[o.state]}; notify: ${cb}`);
  }
  res.redirect("/");
});

// Refund/dispute after success. The real gateway may not notify for these, so no callback is
// sent; the app picks them up when it next queries the order (e.g. admin "Check status").
app.post("/admin/pay/:mchOrderNo/:state", (req, res) => {
  const o = pays.get(req.params.mchOrderNo);
  if (o && o.state === 2) o.state = Number(req.params.state) === 7 ? 7 : 5;
  res.redirect("/");
});

app.listen(PORT, () => {
  if (!KEY) console.warn("[mock] GGUSONEPAY_API_KEY is empty — signatures will use an empty key.");
  console.log(`Mock GGUSOnePay gateway on http://127.0.0.1:${PORT}`);
});
