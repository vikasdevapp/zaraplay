"use client";

import { useEffect, useState, useCallback } from "react";
import AppShell from "@/components/AppShell";
import { useApi, useAuth } from "@/context/AuthContext";
import RouletteWheel from "@/components/RouletteWheel";

interface ReferralData {
  referralCode: string;
  referralCount: number;
  totalEarned: string;
  referrals: { id: string; username: string; createdAt: string }[];
}

interface VipTier {
  id: string;
  name: string;
  emoji: string;
  colorHex: string;
  minDeposit: string;
  minReferrals: number;
  perks: string[];
}

interface VipStatus {
  currentTier: VipTier | null;
  nextTier: VipTier | null;
  totalDeposited: number;
  referralCount: number;
}

export default function RewardsPage() {
  const api = useApi();
  const { user } = useAuth();
  const [data, setData] = useState<ReferralData | null>(null);
  const [copied, setCopied] = useState(false);
  const [vip, setVip] = useState<VipStatus | null>(null);

  // Roulette prizes land in the wallet; re-fetching the wallet keeps balances fresh elsewhere.
  const loadWallet = useCallback(() => {
    api("/api/wallet").catch(() => {});
  }, [api]);

  useEffect(() => {
    api<ReferralData>("/api/referral").then(setData).catch(() => {});
    api<VipStatus>("/api/vip").then(setVip).catch(() => {});
  }, [api]);

  const referralLink = data ? `${typeof window !== "undefined" ? window.location.origin : ""}/signup?ref=${data.referralCode}` : "";

  function copyLink() {
    if (!referralLink) return;
    navigator.clipboard.writeText(referralLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <AppShell>
      <div className="space-y-4">
        <div className="card">
          <h1 className="font-bold text-lg mb-1">🎁 Explore &amp; Earn</h1>
          <p className="text-sm text-muted">Complete tasks. Unlock rewards.</p>
        </div>

        <div id="roulette" className="card scroll-mt-20">
          <h2 className="font-bold mb-1">🎡 Spin to Win</h2>
          <p className="text-sm text-muted mb-4">One free spin every day. Prizes land straight in your wallet.</p>
          <RouletteWheel onWin={loadWallet} />
        </div>

        <div className="card">
          <h2 className="font-bold mb-2">🏆 VIP Status</h2>
          {vip?.currentTier ? (
            <div className="flex items-center gap-3">
              <span className="text-3xl">{vip.currentTier.emoji}</span>
              <div>
                <p className="font-bold" style={{ color: vip.currentTier.colorHex }}>
                  {vip.currentTier.name}
                </p>
                {vip.currentTier.perks.length > 0 && <p className="text-xs text-muted">{vip.currentTier.perks.join(" · ")}</p>}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted">Deposit to unlock your first VIP tier.</p>
          )}
          {vip?.nextTier && (
            <p className="text-xs text-muted mt-3">
              Next: {vip.nextTier.emoji} {vip.nextTier.name} — needs ${Number(vip.nextTier.minDeposit).toFixed(2)} deposited &amp;{" "}
              {vip.nextTier.minReferrals} referrals.
            </p>
          )}
        </div>

        <div className="card">
          <h2 className="font-bold mb-2">👥 Referral &amp; Earn</h2>
          <p className="text-sm text-muted mb-3">
            Earn 100% of a friend&apos;s first deposit when they sign up with your code.
          </p>
          <div className="flex gap-2">
            <input className="input flex-1" readOnly value={referralLink} />
            <button onClick={copyLink} className="btn-gold shrink-0">
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-4">
            <div className="bg-surface2 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-primary">{data?.referralCount ?? 0}</p>
              <p className="text-xs text-muted">Friends referred</p>
            </div>
            <div className="bg-surface2 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-primary">${Number(data?.totalEarned ?? 0).toFixed(2)}</p>
              <p className="text-xs text-muted">Earned from referrals</p>
            </div>
          </div>
        </div>

        <p className="text-center text-xs text-green-400">Logged in as {user?.username}</p>
      </div>
    </AppShell>
  );
}
