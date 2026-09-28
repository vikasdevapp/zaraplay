"use client";

import AdminShell from "@/components/AdminShell";
import TwoFactorSettings from "@/components/TwoFactorSettings";

export default function AdminTwoFactorPage() {
  return (
    <AdminShell>
      <h1 className="text-2xl font-bold mb-6">Two-Factor (2FA)</h1>
      <TwoFactorSettings />
    </AdminShell>
  );
}
