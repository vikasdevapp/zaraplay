# Zara Plays (learning project)

A demo rewards/wallet web platform inspired by sweepstakes-style reward sites, built purely
for **learning purposes**. There is no real payment processor and no real third-party game
integration — deposits, cashouts and game credentials are simulated so the business logic
(bonus tiers, cashout multipliers, device/IP limits) can be studied end to end.

## Stack

- `server/` — Node.js + Express + TypeScript API, Prisma ORM over PostgreSQL, Redis for
  sessions (single-device login), IP-based signup throttling, and rate limiting.
- `web/` — Next.js (App Router) + TypeScript + Tailwind CSS, serving both the customer site
  (`/`, `/dashboard`, `/wallet`, …) and the admin panel (`/admin/*`) from one app.
- `docker-compose.yml` — local Postgres + Redis for development.
- `docker-compose.prod.yml`, `server/Dockerfile`, `web/Dockerfile`, `nginx/` — production
  deployment (see **Deployment** below).

Bulk SMS/email delivery (Twilio/SendGrid — currently stubbed, see Broadcast below) is a
follow-up milestone on top of this core.

## Email OTP signup verification

Signup is mandatory two-step: `POST /api/auth/signup` validates the details and emails a
6-digit code (nothing is written to the database yet — the pending signup lives in Redis for
10 minutes); `POST /api/auth/signup/verify` checks the code (5 attempts, then it's dead) and
only then creates the account and logs the user in. `POST /api/auth/signup/resend` issues a
fresh code.

No real email provider is configured (no SendGrid/SES credentials), so `server/src/lib/email.ts`
sends through **Ethereal** — nodemailer's free SMTP testing service. Emails are genuinely sent
over real SMTP, just to a disposable test inbox instead of the real address; every send returns
a preview URL, which the signup UI surfaces directly (`Open test inbox` link on the OTP screen)
since there's no other way to read the code in this environment. Swap `getTransporter()` in
that file for a real provider before this goes anywhere beyond local development.

## Admin panel

Log in at `/login` with an account whose role is `ADMIN` or `MASTER_ADMIN` and you're
redirected to `/admin`. The seed script creates a master admin:
`admin@zaraplays.local` / `ChangeMe123!` — change this password before using the project
beyond local development. All `/api/admin/*` routes are enforced server-side by role, not
just hidden in the UI. Everything is denominated in USD ($), matching the customer site.

Two staff tiers: `ADMIN` has full operational access; `MASTER_ADMIN` additionally manages
other admin accounts (Staff Management) and the activity audit log (Staff Activity). This is
a permission tier, not multi-tenancy — there's still only one Zara Plays.

- **Dashboard** (`/admin`) — user count, active games, pending cashouts, total deposited/paid
  out, and platform liability (sum of all wallet + free play balances).
- **Transactions** (`/admin/transactions`) — every transaction across all users, filterable by
  type group (Recharge/Bonus/Redeem/Free Play/Adjustment), user search, and date range.
- **Games** (`/admin/games`) — add/deactivate/delete the games shown in the customer site's
  catalog. A game with players attached can't be hard-deleted, only deactivated.
- **Game Accounts** (`/admin/game-accounts`) — every player's per-game account, searchable, plus
  aggregate balance-per-game totals.
- **Users** (`/admin/users`) — search users, drill into a profile to see wallet, games, and
  full transaction history, and manually adjust a user's balance or free play with a required
  reason (recorded as an `ADMIN_ADJUSTMENT` transaction).
- **Deposit Requests** (`/admin/deposits`) — deposits also require manual approval, symmetric
  to cashouts. A request holds nothing until approved; approving credits the deposit + bonus
  (and the referrer's bonus, if this was the depositor's first deposit) in one step.
- **Cashouts** (`/admin/cashouts`) — every cashout requires manual approval. Requesting a
  cashout immediately holds the funds (deducted from the wallet); an admin then approves
  (finalizes) or rejects (refunds) it from this queue. Marketplace redemptions (below) flow
  into this same queue.
- **VIP Tiers** (`/admin/vip-tiers`) — configure tiers (name, emoji, color, perks) gated on a
  deposit threshold AND a referral-count threshold. Customers see their tier and progress on
  the Rewards page.
- **Marketplace** (`/admin/marketplace`) — a free-play → cash redemption catalog. Customers
  redeem on the Rewards page; each redemption holds the free play and creates a pending
  cashout for admin review.
- **Support** (`/admin/support`) — pick an agent, see their conversation threads, reply as
  that agent.
- **Broadcast** (`/admin/broadcast`) — compose a bulk SMS or email. No Twilio/SendGrid
  credentials are configured yet, so sends are recorded (with the recipient count they'd have
  reached) rather than actually delivered — wiring up real providers is a follow-up.
- **Staff Management** (`/admin/staff`, master admin only) — create additional `ADMIN` or
  `MASTER_ADMIN` accounts.
- **Staff Activity** (`/admin/staff-activity`, master admin only) — an audit log of admin
  actions: cashout approvals/rejections, balance adjustments, game changes, broadcasts sent,
  staff created/removed.

## Agent dashboard

A separate, narrower dashboard for day-to-day staff at `/agent` (own layout — `AgentShell`,
distinct from the admin panel). Login redirects here for the `AGENT` role. Seed creates
`agent1@zaraplays.local` / `ChangeMe123!`. Covers Game Balances, Game Records, a Recharge
Ledger (read view over deposits/cashouts), and the agent's own activity log. `ADMIN` and
`MASTER_ADMIN` can also view it.

**Deliberately not implemented:** a "Backend Attachments" / "Auto Recharge" / "Provider
Automation API" style feature that stores login credentials for third-party game platforms
(Juwa, Orion Stars, etc.) and automates recharge/redeem against them, real payment gateway
integration ("Payment Methods"), and Telegram-based manual cash approval bots ("Approval
Bots"). Unlike everything above, none of that is simulated business logic — it's live
automation against real-money gambling and payment infrastructure, so it's out of scope for
this project regardless of how it's implemented.

## Local setup

```bash
# 1. start Postgres + Redis
docker compose up -d

# 2. API
cd server
cp .env.example .env
npm install
npx prisma migrate dev --name init
npm run seed
npm run dev            # http://localhost:4000

# 3. Web
cd ../web
cp .env.example .env.local
npm install
npm run dev            # http://localhost:3000
```

## Deployment (AWS EC2)

**Architecture**: one EC2 instance runs everything via Docker Compose — Nginx (port 80,
reverse-proxying `/api/` and `/uploads/` to the API container and everything else to the
Next.js container), the Next.js app, the Express API, Postgres, and Redis. `/admin` and
`/agent` are routes inside the same Next.js app, not separate deployments — so all three
planned subdomains (website/admin/agent) point at the same Nginx, which is why one `nginx/default.conf`
server block currently answers all of them (`server_name _;`, i.e. any hostname/bare IP).

### First-time EC2 setup

1. SSH into the instance, then run `scripts/ec2-bootstrap.sh` (installs Docker + the Compose
   plugin, clones the repo to `/opt/zaraplays`).
2. `cp server/.env.production.example server/.env` and fill in real values — a random
   `POSTGRES_PASSWORD`, a random `JWT_SECRET` (`openssl rand -hex 32`), and `CORS_ORIGIN` set
   to whatever URL(s) the site will be reached at (comma-separated if there's more than one).
   This file is never committed — it only exists on the server.
3. `docker compose -f docker-compose.prod.yml build && docker compose -f docker-compose.prod.yml up -d`
4. `docker compose -f docker-compose.prod.yml exec api npx prisma migrate deploy`
5. `docker compose -f docker-compose.prod.yml exec api node dist/seed.js` — seeds games,
   support agents, the master admin (`admin@zaraplays.local` / `ChangeMe123!` — **change this
   password immediately**), and the demo agent account.
6. In the **EC2 security group**, confirm inbound rules allow: port 22 (SSH, ideally locked
   to your IP, not `0.0.0.0/0`), port 80 (HTTP, public). Postgres (5432) and Redis (6379)
   should **not** be open to the public internet — they're only reached container-to-container
   inside the Docker network, never through the security group.

### CI/CD (GitHub Actions)

`.github/workflows/deploy.yml` runs on every push: a `check` job (typecheck + build both
apps) always runs; on `main` specifically, a `deploy` job then SSHes into EC2, hard-resets
the checkout to the pushed commit, and runs `scripts/deploy.sh` (rebuild containers, restart,
run pending Prisma migrations). Add these three repo secrets under **Settings → Secrets and
variables → Actions**:

- `EC2_HOST` — the Elastic IP (or domain, once it exists)
- `EC2_USER` — `ubuntu` or `ec2-user`, whichever the AMI uses
- `EC2_SSH_KEY` — the **private** key's full contents (the `.pem` file), not the public key

The deploy user's key must already be authorized on the box (`~/.ssh/authorized_keys`) — the
same key pair EC2 gave you when the instance was created works, or add a separate
deploy-only key pair if you'd rather not reuse it.

### Once the three subdomains exist

1. Point each subdomain's DNS A record at the Elastic IP.
2. In `nginx/default.conf`, replace `server_name _;` with the three hostnames.
3. Install certbot on the box and run `sudo certbot --nginx -d website.example.com -d admin.example.com -d agent.example.com`
   to get real HTTPS certificates and have it rewrite the Nginx config for you (auto-renews
   via a systemd timer certbot installs).
4. Update `CORS_ORIGIN` in `server/.env` to the `https://` versions of all three hostnames,
   and redeploy.

## Business rules implemented

**Deposit bonuses** (`server/src/utils/bonus.ts`)
- First-ever deposit: 100% signup bonus
- Every Tuesday (any deposit that day): 50% weekend bonus
- Otherwise: 20% regular bonus
- When a referred user makes their first deposit, the referrer is credited a separate 100%
  referral bonus (of the referred user's deposit amount).

**Cashout tiers** (`server/src/utils/cashout.ts`), based on the wallet's most recent deposit
(each deposit opens its own cashout window, rather than compounding against lifetime
deposits, which would make the minimum unreachable):
- $5–$35 deposit → min cashout = 5x deposit, max cashout = 10x deposit
- \>$35 deposit → min cashout = 3x deposit, max cashout = unlimited
- Amounts requested above the eligible max are rejected; the API surfaces the same "excess
  points are forfeited" reminder shown in the product spec.

**Free play**: $5 granted on signup; free-play-funded cashouts are capped at $20, with any
remainder forfeited.

**Account limits** (Redis): max 2 signups per IP per rolling 24h window; only the most
recently issued token per user is valid (logging in on a new device invalidates the
previous session on its next request).
