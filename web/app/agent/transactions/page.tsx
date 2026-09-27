"use client";

import AgentShell from "@/components/AgentShell";
import TransactionsView from "@/components/desk/TransactionsView";

export default function AgentAllTransactionsPage() {
  return (
    <AgentShell>
      <h1 className="text-2xl font-bold">All Transactions</h1>
      <p className="text-sm text-muted mb-6">View every recharge, bonus, redeem and free play in your group.</p>
      <TransactionsView />
    </AgentShell>
  );
}
