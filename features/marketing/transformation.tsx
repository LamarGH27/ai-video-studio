import { PortfolioFrame } from '@/features/portfolio/frame';
import { cn } from '@/lib/utils';
import type { ExperienceCategory } from '@/types/database';

/**
 * The proof: a photograph, a sentence, and the film it became.
 *
 * This is the most important thing on the homepage the day we have real media
 * for it, so it is built now to accept that media rather than to be rebuilt
 * around it later. Every panel takes the same shape:
 *
 *   imageUrl  — a still. Rendered with <img>, not next/image: these will often
 *               be customer-consented stills served from storage rather than
 *               from a configured remote pattern, and the optimiser would
 *               refuse them or cache them where they do not belong.
 *   videoUrl  — an optional short loop. Muted, playsInline, and ONLY on the
 *               result panel, because two autoplaying videos side by side is
 *               both a bandwidth problem and a taste problem.
 *   posterUrl — what shows before the loop arrives, and what shows instead of
 *               it under reduced motion. A loop without one is ignored: a frame
 *               that goes blank because the video was hidden is worse than a
 *               frame that never moved.
 *
 * With none of those supplied it degrades to the designed placeholder frame,
 * which is what ships today.
 *
 * Nothing here may imply a demonstration belongs to a customer. `attribution`
 * is required, and `Transformation` renders it.
 */

export type TransformationAttribution = 'DEMONSTRATION' | 'CUSTOMER';

export interface TransformationPanel {
  /** Short label above the caption: "Your photo", "Your idea". */
  mark: string;
  caption: string;
  /** Placeholder grading when no media is supplied. */
  seed: string;
  category: ExperienceCategory;
  imageUrl?: string;
  /** Result panel only. Requires posterUrl. */
  videoUrl?: string;
  posterUrl?: string;
  /** A photograph gets a photograph's furniture: white border, slight tilt. */
  asSnapshot?: boolean;
}

const ATTRIBUTION_LABEL: Record<TransformationAttribution, string | null> = {
  // Said plainly, once, under the sequence — not stamped on every panel.
  DEMONSTRATION: 'A demonstration we created. Not a customer project.',
  // A consented, credited customer film needs no disclaimer.
  CUSTOMER: null,
};

export function Transformation({
  panels,
  attribution,
  className,
}: {
  panels: readonly TransformationPanel[];
  attribution: TransformationAttribution;
  className?: string;
}) {
  const note = ATTRIBUTION_LABEL[attribution];

  return (
    <div className={className}>
      <ol className="grid gap-10 lg:grid-cols-3 lg:gap-6">
        {panels.map((panel, index) => (
          <li key={panel.mark} className="relative reveal">
            {index < panels.length - 1 ? (
              <span
                aria-hidden="true"
                className="absolute top-1/2 -right-3 hidden h-px w-6 bg-gradient-to-r from-brass-400/60 to-transparent lg:block"
              />
            ) : null}

            <div className="media-frame aspect-square">
              <TransformationMedia panel={panel} isResult={index === panels.length - 1} />

              {panel.asSnapshot ? (
                <div
                  aria-hidden="true"
                  className="absolute inset-6 rotate-[-2.5deg] border-6 border-bone-50/85 shadow-2xl sm:inset-10"
                />
              ) : null}
            </div>

            <p className="mt-7 eyebrow">{panel.mark}</p>
            <p className="mt-3 leading-relaxed text-bone-400">{panel.caption}</p>
          </li>
        ))}
      </ol>

      {note ? <p className="mt-10 text-sm text-bone-500">{note}</p> : null}
    </div>
  );
}

function TransformationMedia({
  panel,
  isResult,
}: {
  panel: TransformationPanel;
  isResult: boolean;
}) {
  // Only the last panel may move, and only when it has both a loop and a poster
  // to fall back to.
  if (isResult && panel.videoUrl && panel.posterUrl) {
    return (
      <>
        <video
          className="size-full object-cover motion-reduce:hidden"
          poster={panel.posterUrl}
          autoPlay
          muted
          loop
          playsInline
          preload="none"
          aria-label={`${panel.mark}: ${panel.caption}`}
        >
          <source src={panel.videoUrl} type="video/mp4" />
        </video>
        {/* What someone who asked for reduced motion gets instead. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={panel.posterUrl}
          alt={`${panel.mark}: ${panel.caption}`}
          className="hidden size-full object-cover motion-reduce:block"
          loading="lazy"
          decoding="async"
        />
      </>
    );
  }

  const still = panel.imageUrl ?? panel.posterUrl;

  if (still) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={still}
        alt={`${panel.mark}: ${panel.caption}`}
        className="size-full object-cover"
        loading="lazy"
        decoding="async"
      />
    );
  }

  return (
    <PortfolioFrame
      seed={panel.seed}
      title={panel.mark}
      category={panel.category}
      showLabel={false}
      className={cn(isResult && 'motion-safe:animate-drift')}
    />
  );
}
