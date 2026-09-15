import { PortfolioFrame } from '@/features/portfolio/frame';
import { provenanceLabel, type PortfolioProvenance } from '@/lib/catalog/presentation';
import type { ShowcaseCategory } from '@/lib/catalog/categories';

/**
 * The hero's visual: a photograph turning into a scene.
 *
 * The whole proposition is one transformation, and a paragraph explaining it is
 * weaker than showing it. So: a small square snapshot, tilted, bordered like a
 * print, overlapping the corner of a wide cinematic frame that drifts very
 * slowly behind it. The eye reads the small thing becoming the large one
 * without being told.
 *
 * Entirely CSS. No video, no image request, nothing to lazy-load and nothing
 * that shifts layout once it arrives — which matters most here, because this is
 * the first thing above the fold on a phone over a mobile connection.
 *
 * The large frame now takes a real film still when one is supplied — a poster
 * image, never a video. Above the fold on a phone is the worst place on the
 * site to start a download, and the film itself is a few hundred pixels further
 * down where it can be played deliberately. The composition does not change.
 *
 * The small frame stays a placeholder: it stands for the customer's own
 * photograph, and putting a stock face there would be inventing the very thing
 * the section is trying to demonstrate honestly.
 */
export function TransformationStrip({
  seed,
  title,
  category,
  scenePosterUrl,
  provenance,
}: {
  seed: string;
  title: string;
  category: ShowcaseCategory;
  /** A still from a real film. Falls back to the composed frame without it. */
  scenePosterUrl?: string;
  /** Required alongside a still: whose work this is must travel with it. */
  provenance?: PortfolioProvenance;
}) {
  const mark = scenePosterUrl && provenance ? provenanceLabel(provenance) : null;

  return (
    <div className="relative animate-curtain [animation-delay:180ms]">
      {/* The finished scene. 4:5 on phones, cinema-wide from sm up. */}
      <div className="media-frame aspect-[4/5] sm:aspect-[5/4] lg:aspect-[4/5]">
        {scenePosterUrl ? (
          // Not next/image: a static asset at a known size, already sized for
          // this frame, where the optimiser would only add a request.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={scenePosterUrl}
            alt={title}
            width={1280}
            height={720}
            // The one image above the fold that is worth fetching eagerly.
            fetchPriority="high"
            decoding="async"
            className="size-full object-cover"
          />
        ) : (
          <PortfolioFrame
            seed={seed}
            title={title}
            category={category}
            showLabel={false}
            className="motion-safe:animate-drift"
          />
        )}

        {scenePosterUrl ? (
          /* A real still has real highlights in it. The caption below was set
             over fireworks and disappeared into them, so it gets something to
             sit on — the placeholder frame never needed one. */
          <div
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-ink-990/75 to-transparent"
          />
        ) : null}

        {mark ? (
          <p className="absolute top-5 right-5 rounded-full border border-bone-50/20 bg-ink-990/55 px-3 py-1 text-[0.6rem] tracking-[0.2em] text-bone-200 uppercase backdrop-blur-sm">
            {mark}
          </p>
        ) : null}

        <div className="absolute inset-x-0 top-0 flex items-center gap-3 p-6">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-brass-400/80" />
          <p className="relative font-mono text-[0.6rem] tracking-[0.3em] text-bone-50/75 uppercase">
            {scenePosterUrl ? title : 'Scene 01 · Your film'}
          </p>
        </div>
      </div>

      {/* The source photograph, overlapping the lower-left corner. */}
      <div
        className="absolute -bottom-6 -left-4 w-32 rotate-[-5deg] sm:-bottom-8 sm:-left-8 sm:w-44"
        aria-hidden="true"
      >
        <div className="rounded-[3px] border-4 border-bone-50/90 bg-bone-50/90 pb-7 shadow-[0_18px_50px_-12px_oklch(0_0_0/0.7)]">
          <div className="relative aspect-square overflow-hidden">
            <PortfolioFrame
              seed={`${seed}-source`}
              title="Source photograph"
              category="BESPOKE"
              showLabel={false}
              className="saturate-[0.55]"
            />
            {/* Next to a photorealistic still, an unlabelled dark square reads
                as an image that failed to load. Saying what belongs there turns
                it back into what it is: the slot the visitor fills. */}
            <p className="absolute inset-0 flex items-center justify-center font-mono text-[0.5rem] tracking-[0.25em] text-bone-50/70 uppercase sm:text-[0.55rem]">
              Your photo
            </p>
          </div>
        </div>
      </div>

      {/* The arrow between them. Decorative, and only where there is room. */}
      <div
        aria-hidden="true"
        className="absolute bottom-8 left-30 hidden h-px w-16 bg-gradient-to-r from-bone-50/70 to-transparent sm:left-40 sm:block"
      />
    </div>
  );
}
