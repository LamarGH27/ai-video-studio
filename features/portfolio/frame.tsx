import { cn } from '@/lib/utils';
import { categoryLabel } from '@/lib/catalog/categories';
import type { ExperienceCategory } from '@/types/database';

/**
 * The stand-in for a film still.
 *
 * No real films exist yet, and stock photography would misrepresent the work —
 * a portfolio of other people's images is worse than an honest absence. So each
 * piece gets a composed frame derived from its slug: a graded duotone, a
 * horizon, a soft key light and grain. Deterministic, so the grid reads as a
 * considered set rather than a wall of random colour, and stable across
 * renders so nothing flickers.
 *
 * It is built to be DELETED. The moment `portfolio_items.media_url` is
 * populated, swap the inner layers for a <video poster> or next/image at the
 * same aspect ratio and nothing around it changes.
 */

interface Grade {
  /** Two stops of the same light, warm through cool. */
  from: string;
  to: string;
  /** Where the key light sits, as a percentage across the frame. */
  keyX: number;
  /** Horizon height, as a percentage down the frame. */
  horizon: number;
}

/**
 * One grade per category, chosen rather than hashed.
 *
 * An earlier version picked a palette from a hash of the slug, which produced a
 * grid where four of eight tiles came out the same warm amber — random is not
 * the same as varied. Grading by category also means the colour carries
 * meaning: travel is daylight, celebration is candlelight, executive is cold
 * and architectural.
 */
const CATEGORY_GRADES: Record<ExperienceCategory, Grade> = {
  LUXURY_LIFESTYLE: {
    from: 'oklch(0.42 0.055 210)',
    to: 'oklch(0.19 0.022 250)',
    keyX: 70,
    horizon: 58,
  },
  FASHION: { from: 'oklch(0.34 0.085 340)', to: 'oklch(0.18 0.03 320)', keyX: 32, horizon: 52 },
  CINEMATIC: { from: 'oklch(0.30 0.055 268)', to: 'oklch(0.17 0.02 285)', keyX: 62, horizon: 46 },
  SOCIAL_MEDIA: {
    from: 'oklch(0.36 0.07 152)',
    to: 'oklch(0.18 0.025 200)',
    keyX: 44,
    horizon: 66,
  },
  CELEBRATION: { from: 'oklch(0.40 0.09 62)', to: 'oklch(0.19 0.035 40)', keyX: 26, horizon: 70 },
  TRAVEL: { from: 'oklch(0.46 0.07 88)', to: 'oklch(0.20 0.03 60)', keyX: 78, horizon: 62 },
  EXECUTIVE: { from: 'oklch(0.30 0.02 250)', to: 'oklch(0.17 0.012 260)', keyX: 20, horizon: 44 },
  BESPOKE: { from: 'oklch(0.33 0.05 30)', to: 'oklch(0.18 0.025 300)', keyX: 55, horizon: 60 },
};

/**
 * A small deterministic wobble, so two pieces in the same category are not
 * pixel-identical. Derived from the slug, bounded to a few percent — enough to
 * read as different frames of the same shoot.
 */
function gradeFor(seed: string, category: ExperienceCategory): Grade {
  const base = CATEGORY_GRADES[category];
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 100_000;
  }
  const shift = (hash % 17) - 8;
  return {
    ...base,
    keyX: Math.min(88, Math.max(12, base.keyX + shift)),
    horizon: Math.min(78, Math.max(38, base.horizon + (shift >> 1))),
  };
}

export function PortfolioFrame({
  seed,
  title,
  category,
  className,
  showLabel = true,
  scrim = true,
}: {
  seed: string;
  title: string;
  category: ExperienceCategory;
  className?: string;
  /** Off for decorative strips, where a repeated caption is just noise. */
  showLabel?: boolean;
  /**
   * The bottom fall-off exists so overlaid text has something to sit on. Turn it
   * off where the caption sits BELOW the frame — otherwise it crushes the lower
   * half of a tall poster to flat black for no reason.
   */
  scrim?: boolean;
}) {
  const grade = gradeFor(seed, category);

  return (
    <div
      className={cn('relative h-full w-full overflow-hidden', className)}
      role="img"
      aria-label={`${title} — ${categoryLabel(category)}. Placeholder frame; film stills are added as work is published.`}
    >
      {/* Ground: a graded sky falling into shadow. */}
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          backgroundImage: `linear-gradient(to bottom, ${grade.from} 0%, ${grade.to} 100%)`,
        }}
      />

      {/* Key light, off-centre. This is what stops it reading as a gradient. */}
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          backgroundImage: `radial-gradient(38% 46% at ${grade.keyX}% ${grade.horizon - 26}%, oklch(1 0 0 / 0.22), transparent 70%)`,
        }}
      />

      {/* Horizon: one hairline where light meets ground. */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 h-px"
        style={{
          top: `${grade.horizon}%`,
          backgroundImage:
            'linear-gradient(to right, transparent, oklch(1 0 0 / 0.28) 35%, oklch(1 0 0 / 0.1) 65%, transparent)',
        }}
      />

      {scrim ? (
        /* Foreground fall-off, so a caption always has something to sit on. */
        <div aria-hidden="true" className="absolute inset-0 media-scrim" />
      ) : null}

      {/* Anamorphic streak — the one flourish, and it earns its place. */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 h-16 opacity-40 blur-xl"
        style={{
          top: `${grade.horizon - 18}%`,
          backgroundImage: `linear-gradient(to right, transparent, ${grade.from}, transparent)`,
        }}
      />

      <div className="grain-layer" aria-hidden="true" />

      {showLabel ? (
        <p
          aria-hidden="true"
          className="absolute bottom-0 left-0 p-5 font-mono text-[0.6rem] tracking-[0.32em] text-bone-50/45 uppercase"
        >
          {categoryLabel(category)}
        </p>
      ) : null}
    </div>
  );
}
