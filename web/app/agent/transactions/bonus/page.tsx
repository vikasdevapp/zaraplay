"use client";

import AgentShell from "@/components/AgentShell";
import TransactionsView from "@/components/desk/TransactionsView";

export default function AgentBonusPage() {
  return (
    <AgentShell>
      <h1 className="text-2xl font-bold">Bonus</h1>
      <p className="text-sm text-muted mb-6">View bonus transactions for players in your group. Bonuses are added with a recharge.</p>
      <TransactionsView type="BONUS" />
    </AgentShell>
  );
}
