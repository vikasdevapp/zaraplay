"use client";

import AgentShell from "@/components/AgentShell";
import TransactionsView from "@/components/desk/TransactionsView";

export default function AgentFreePlayFPPage() {
  return (
    <AgentShell>
      <h1 className="text-2xl font-bold">Free Play (FP)</h1>
      <p className="text-sm text-muted mb-6">Give free play credits to players in your group.</p>
      <TransactionsView type="FREEPLAY" form="FREEPLAY" />
    </AgentShell>
  );
}
