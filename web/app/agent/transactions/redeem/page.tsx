"use client";

import AgentShell from "@/components/AgentShell";
import TransactionsView from "@/components/desk/TransactionsView";

export default function AgentRedeemPage() {
  return (
    <AgentShell>
      <h1 className="text-2xl font-bold">Redeem</h1>
      <p className="text-sm text-muted mb-6">Create a redeem transaction for players in your group.</p>
      <TransactionsView type="REDEEM" form="REDEEM" />
    </AgentShell>
  );
}
