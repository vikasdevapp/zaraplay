"use client";

import AgentShell from "@/components/AgentShell";
import ChangePasswordForm from "@/components/ChangePasswordForm";

export default function AgentChangePasswordPage() {
  return (
    <AgentShell>
      <h1 className="text-2xl font-bold mb-6">Change Password</h1>
      <ChangePasswordForm />
    </AgentShell>
  );
}
