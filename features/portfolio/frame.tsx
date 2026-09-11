import { cn } from '@/lib/utils';
import { categoryLabel } from '@/lib/catalog/categories';
import type { ExperienceCategory } from '@/types/database';

/**
 * Placeholder frame for a showcase piece with no media yet.
 *
 * The MVP ships no real films, and stock imagery would misrepresent the work.
 * Instead each piece gets a deterministic duotone frame derived from its slug,
 * so the grid reads as a considered set rather than a wall of grey boxes.
 * Swap this for a <video>/<Image> the moment portfolio_items.media_url is
 * populated — the layout does not change.
 */

const DUOTONES: readonly string[] = [
  'from-[oklch(0.30_0.06_45)] via-[oklch(0.19_0.03_40)] to-[oklch(0.14_0.01_285)]',
  'from-[oklch(0.28_0.05_250)] via-[oklch(0.18_0.03_255)] to-[oklch(0.14_0.01_285)]',
  'from-[oklch(0.30_0.05_150)] via-[oklch(0.19_0.03_160)] to-[oklch(0.14_0.01_285)]',
  'from-[oklch(0.29_0.07_330)] via-[oklch(0.19_0.04_320)] to-[oklch(0.14_0.01_285)]',
  'from-[oklch(0.31_0.06_85)] via-[oklch(0.20_0.03_80)] to-[oklch(0.14_0.01_285)]',
  'from-[oklch(0.27_0.04_200)] via-[oklch(0.18_0.02_210)] to-[oklch(0.14_0.01_285)]',
] as const;

function toneFor(seed: string): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 100_000;
  }
  return DUOTONES[hash % DUOTONES.length] ?? DUOTONES[0]!;
}

export function PortfolioFrame({
  seed,
  title,
  category,
  className,
}: {
  seed: string;
  title: string;
  category: ExperienceCategory;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'relative flex h-full w-full items-end overflow-hidden bg-gradient-to-br',
        toneFor(seed),
        className,
      )}
      role="img"
      aria-label={`${title} — placeholder frame, ${categoryLabel(category)}`}
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-[0.07] mix-blend-overlay"
        style={{
          backgroundImage:
            'repeating-linear-gradient(90deg, rgba(255,255,255,0.9) 0 1px, transparent 1px 7px)',
        }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[radial-gradient(70%_60%_at_50%_120%,rgba(0,0,0,0.55),transparent)]"
      />
      <p
        aria-hidden="true"
        className="relative p-5 font-mono text-[0.65rem] tracking-[0.3em] text-white/35 uppercase"
      >
        {categoryLabel(category)}
      </p>
    </div>
  );
}
