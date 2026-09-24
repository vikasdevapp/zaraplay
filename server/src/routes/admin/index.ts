import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth";
import { adminGamesRouter } from "./games";
import { adminUsersRouter } from "./users";
import { adminCashoutsRouter } from "./cashouts";
import { adminSupportRouter } from "./support";
import { adminBroadcastRouter } from "./broadcast";
import { adminStatsRouter } from "./stats";
import { adminTransactionsRouter } from "./transactions";
import { adminGameAccountsRouter } from "./gameAccounts";
import { adminAuditLogsRouter } from "./auditLogs";
import { adminStaffRouter } from "./staff";
import { adminSettingsRouter } from "./settings";
import { adminPlayerAnalyticsRouter } from "./playerAnalytics";
import { adminDepositsRouter } from "./deposits";
import { adminVipTiersRouter } from "./vipTiers";
import { adminMarketplaceRouter } from "./marketplace";
import { adminRouletteRouter } from "./roulette";
import { adminPaymentGatewayRouter } from "./paymentGateway";

export const adminRouter = Router();

// ADMIN and MASTER_ADMIN share full operational access to the site.
adminRouter.use(requireAuth, requireRole("ADMIN", "MASTER_ADMIN"));

adminRouter.use("/games", adminGamesRouter);
adminRouter.use("/users", adminUsersRouter);
adminRouter.use("/cashouts", adminCashoutsRouter);
adminRouter.use("/support", adminSupportRouter);
adminRouter.use("/broadcast", adminBroadcastRouter);
adminRouter.use("/stats", adminStatsRouter);
adminRouter.use("/transactions", adminTransactionsRouter);
adminRouter.use("/game-accounts", adminGameAccountsRouter);
adminRouter.use("/audit-logs", adminAuditLogsRouter);
adminRouter.use("/settings", adminSettingsRouter);
adminRouter.use("/player-analytics", adminPlayerAnalyticsRouter);
adminRouter.use("/deposits", adminDepositsRouter);
adminRouter.use("/vip-tiers", adminVipTiersRouter);
adminRouter.use("/marketplace", adminMarketplaceRouter);
adminRouter.use("/roulette", adminRouletteRouter);
adminRouter.use("/payment-gateway", adminPaymentGatewayRouter);

// Only MASTER_ADMIN can create or remove other admin accounts.
adminRouter.use("/staff", requireRole("MASTER_ADMIN"), adminStaffRouter);
