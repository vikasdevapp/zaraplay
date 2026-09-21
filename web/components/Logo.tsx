import Image from "next/image";

interface LogoProps {
  size?: "sm" | "md" | "lg";
  /** Show the full square artwork (mascot + wordmark + tagline) as-is, instead of the compact nav mark. */
  full?: boolean;
}

const MARK_PX = { sm: 36, md: 44, lg: 64 };
const FULL_PX = { sm: 100, md: 140, lg: 220 };
const TEXT_SIZE = { sm: "text-lg", md: "text-xl", lg: "text-4xl" };

export default function Logo({ size = "md", full = false }: LogoProps) {
  if (full) {
    const px = FULL_PX[size];
    return (
      <Image
        src="/logo.jpeg"
        alt="Zara Plays — Play Until You Win"
        width={px}
        height={px}
        className="rounded-2xl"
        priority
      />
    );
  }

  const px = MARK_PX[size];
  return (
    <div className="flex items-center gap-2">
      <div className="relative overflow-hidden rounded-lg shrink-0 bg-black" style={{ width: px, height: px }}>
        <Image
          src="/logo.jpeg"
          alt="Zara Plays"
          fill
          sizes={`${px}px`}
          className="object-cover"
          style={{ objectPosition: "50% 32%", transform: "scale(1.9)" }}
          priority
        />
      </div>
      <span className={`font-display font-bold tracking-wide text-white ${TEXT_SIZE[size]}`}>
        ZARA <span className="text-primary">PLAYS</span>
      </span>
    </div>
  );
}
