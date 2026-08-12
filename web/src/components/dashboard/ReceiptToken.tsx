import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { cn } from "../../lib/utils";

type ReceiptTokenMarker = "incoming" | "cashed-out";

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function tokenValues(seed: string) {
  const hash = hashSeed(seed);
  return {
    rotation: (hash % 4) * 45,
    ring: 8 + ((hash >>> 4) % 4),
    offset: 7 + ((hash >>> 8) % 10),
    constellation: Array.from({ length: 4 }, (_, index) => ({
      x: 10 + ((hash >>> (index * 4)) % 20),
      y: 10 + ((hash >>> (index * 5 + 2)) % 20),
    })),
  };
}

export function ReceiptToken({
  seed,
  marker,
  placeholder = false,
  size = "md",
  className,
}: {
  seed: string | number;
  marker?: ReceiptTokenMarker;
  placeholder?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const values = tokenValues(String(seed));
  const label = placeholder
    ? "Private receipt placeholder"
    : `Private receipt token${marker ? `, ${marker}` : ""}`;

  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center rounded-full border border-brand-obsidian/70 bg-brand-linen shadow-[0_1px_0_rgba(26,31,18,0.18)]",
        size === "sm" && "size-8",
        size === "md" && "size-10",
        size === "lg" && "size-12",
        placeholder && "opacity-55",
        className,
      )}
      role="img"
      aria-label={label}
    >
      <svg viewBox="0 0 40 40" className="size-full" aria-hidden="true">
        <g
          transform={`rotate(${values.rotation} 20 20)`}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {placeholder ? (
            <>
              <path
                d="M10 14h20M12 20h16M15 26h10"
                stroke="currentColor"
                className="text-brand-obsidian/35"
                strokeWidth="1.35"
              />
              {values.constellation.slice(0, 3).map((point, index) => (
                <circle
                  key={`${point.x}-${point.y}`}
                  cx={point.x}
                  cy={point.y}
                  r={index === 0 ? 1.4 : 1}
                  fill="currentColor"
                  className="text-gold/65"
                  stroke="none"
                />
              ))}
            </>
          ) : (
            <>
              <circle
                cx="20"
                cy="20"
                r={values.ring}
                stroke="currentColor"
                className="text-olive/75"
                strokeWidth="1.5"
              />
              <path
                d={`M${values.offset} 20h${40 - values.offset * 2}M20 ${values.offset}v${40 - values.offset * 2}`}
                stroke="currentColor"
                className="text-brand-obsidian/30"
                strokeWidth="1"
              />
              {values.constellation.map((point, index) => (
                <circle
                  key={`${point.x}-${point.y}`}
                  cx={point.x}
                  cy={point.y}
                  r={index === 0 ? 2 : 1.35}
                  fill="currentColor"
                  className={index % 2 === 0 ? "text-gold" : "text-olive"}
                  stroke="none"
                />
              ))}
              <path
                d={values.constellation
                  .slice(0, 3)
                  .map((point, index) =>
                    `${index === 0 ? "M" : "L"}${point.x} ${point.y}`,
                  )
                  .join(" ")}
                stroke="currentColor"
                className="text-brand-obsidian/45"
                strokeWidth="0.85"
              />
            </>
          )}
        </g>
      </svg>

      {marker ? (
        <span className="absolute -right-1 -bottom-0.5 flex size-4 items-center justify-center rounded-full border border-brand-obsidian bg-olive text-brand-linen shadow-sm">
          {marker === "incoming" ? (
            <ArrowDownLeft className="size-2.5" aria-hidden="true" />
          ) : (
            <ArrowUpRight className="size-2.5" aria-hidden="true" />
          )}
        </span>
      ) : null}
    </span>
  );
}

export function ReceiptTokenStack({
  seeds,
  total = seeds.length,
  placeholder = false,
  className,
}: {
  seeds: Array<string | number>;
  total?: number;
  placeholder?: boolean;
  className?: string;
}) {
  const visibleSeeds = seeds.slice(0, 3);
  const remaining = Math.max(0, total - visibleSeeds.length);

  return (
    <span
      className={cn("inline-flex items-center", className)}
      aria-label={placeholder ? "No private receipts yet" : `${total} private receipts`}
    >
      {visibleSeeds.map((seed, index) => (
        <ReceiptToken
          key={`${seed}-${index}`}
          seed={seed}
          placeholder={placeholder}
          size="sm"
          className={cn(index > 0 && "-ml-2.5", "ring-2 ring-brand-obsidian")}
        />
      ))}
      {remaining > 0 ? (
        <span className="-ml-2.5 flex size-8 items-center justify-center rounded-full border border-brand-linen/25 bg-brand-obsidian font-mono text-[10px] font-semibold text-brand-linen ring-2 ring-brand-obsidian">
          +{remaining}
        </span>
      ) : null}
    </span>
  );
}
