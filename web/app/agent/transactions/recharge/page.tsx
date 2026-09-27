"use client";

import AgentShell from "@/components/AgentShell";
import TransactionsView from "@/components/desk/TransactionsView";

export default function AgentRechargePage() {
  return (
    <AgentShell>
      <h1 className="text-2xl font-bold">Recharge</h1>
      <p className="text-sm text-muted mb-6">Create a recharge transaction for players in your group.</p>
      <TransactionsView type="RECHARGE" form="RECHARGE" />
    </AgentShell>
  );
}
