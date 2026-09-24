import { Router } from "express";
import { checkHealth, gateway, GatewayError, queryBalance } from "../../lib/ggusonepay";

export const adminPaymentGatewayRouter = Router();

adminPaymentGatewayRouter.get("/", async (_req, res) => {
  const configured = gateway.payEnabled || gateway.transferEnabled;
  if (!configured) {
    return res.json({ configured, payEnabled: false, transferEnabled: false, healthy: null, accounts: [] });
  }

  const [healthy, balance] = await Promise.all([
    checkHealth(),
    queryBalance().then(
      (accounts) => ({ accounts, error: null as string | null }),
      (err) => ({ accounts: [], error: err instanceof GatewayError ? err.message : "Could not load balance." })
    ),
  ]);

  res.json({
    configured,
    payEnabled: gateway.payEnabled,
    transferEnabled: gateway.transferEnabled,
    payMethods: gateway.payWayCodes,
    transferMethods: gateway.transferWayCodes,
    healthy,
    accounts: balance.accounts,
    balanceError: balance.error,
  });
});
