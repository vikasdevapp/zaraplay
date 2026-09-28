"use client";

import AgentShell from "@/components/AgentShell";
import TwoFactorSettings from "@/components/TwoFactorSettings";

export default function AgentTwoFactorPage() {
  return (
    <AgentShell>
      <h1 className="text-2xl font-bold mb-6">Two-Factor (2FA)</h1>
      <TwoFactorSettings />
    </AgentShell>
  );
}
