import Link from "next/link";
import Image from "next/image";
import Logo from "@/components/Logo";

interface Game {
  id: string;
  name: string;
  imageUrl: string | null;
}

async function getGames(): Promise<Game[]> {
  // Server-side rendering happens inside the Docker network, so it should hit the API
  // container directly (API_INTERNAL_URL, e.g. http://api:4000) rather than bouncing back
  // out through the public domain/Nginx like the browser does. Falls back to the public
  // URL for local (non-Docker) dev.
  const apiUrl = process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
  try {
    const res = await fetch(`${apiUrl}/api/games/catalog`, { cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json();
    return data.games as Game[];
  } catch {
    return [];
  }
}

export default async function LandingPage() {
  const games = await getGames();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="max-w-6xl w-full mx-auto px-4 py-6 flex items-center justify-between">
        <Logo size="md" />
        <div className="flex items-center gap-3">
          <Link href="/login" className="text-sm font-medium text-muted hover:text-white">
            Log in
          </Link>
          <Link href="/signup" className="btn-primary text-sm py-2 px-4">
            Sign up
          </Link>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-10 flex flex-col items-center text-center gap-6">
        <Logo size="lg" full />
        <span className="inline-block bg-surface2 border border-border rounded-full px-4 py-1 text-xs text-muted">
          Learning-purpose demo — no real money is processed
        </span>
        <h1 className="font-display text-4xl md:text-6xl font-extrabold leading-tight">
          Rewards, referrals &amp;<br />
          <span className="text-primary">bonus points</span>, gamified.
        </h1>
        <p className="max-w-xl text-muted text-lg">
          A demo rewards portal showing off a wallet, referral bonuses, deposit-tier cashout rules
          and a game library — built to study the mechanics, not to move real money.
        </p>
        <div className="flex gap-3">
          <Link href="/signup" className="btn-primary">
            Get Started
          </Link>
          <Link href="/login" className="btn-ghost">
            I have an account
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6 w-full">
          {[
            { title: "100% Signup Bonus", body: "Your first deposit is matched dollar-for-dollar." },
            { title: "Refer & Earn", body: "Earn 100% of a friend's first deposit when they join with your code." },
            { title: "Tiered Cashouts", body: "Cashout limits scale with your deposit — transparent, rule-based." },
          ].map((f) => (
            <div key={f.title} className="card text-left">
              <h3 className="font-semibold text-primary mb-1">{f.title}</h3>
              <p className="text-sm text-muted">{f.body}</p>
            </div>
          ))}
        </div>

        {games.length > 0 && (
          <div className="w-full mt-10">
            <h2 className="font-display text-2xl font-bold mb-5">Games on Zara Plays</h2>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 sm:gap-4">
              {games.map((g) => (
                <Link key={g.id} href="/signup" className="group">
                  <div className="relative aspect-square rounded-xl overflow-hidden bg-surface2 border border-border">
                    {g.imageUrl ? (
                      <Image
                        src={g.imageUrl}
                        alt={g.name}
                        fill
                        unoptimized
                        className="object-cover transition-transform group-hover:scale-105"
                        sizes="(max-width: 640px) 33vw, (max-width: 1024px) 20vw, 16vw"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/30 to-surface2 text-2xl font-bold">
                        {g.name.slice(0, 1)}
                      </div>
                    )}
                  </div>
                  <p className="mt-2 text-sm font-medium truncate">{g.name}</p>
                </Link>
              ))}
            </div>
          </div>
        )}
      </main>

      <footer className="text-center text-xs text-muted py-6">
        © 2026 Zara Plays. Demo project for educational purposes only.
      </footer>
    </div>
  );
}
