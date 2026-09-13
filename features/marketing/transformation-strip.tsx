import { PortfolioFrame } from '@/features/portfolio/frame';
import type { ExperienceCategory } from '@/types/database';

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
 * When real media exists this becomes a <video poster> in the large frame and a
 * next/image in the small one. The composition does not change.
 */
export function TransformationStrip({
  seed,
  title,
  category,
}: {
  seed: string;
  title: string;
  category: ExperienceCategory;
}) {
  return (
    <div className="relative animate-curtain [animation-delay:180ms]">
      {/* The finished scene. 4:5 on phones, cinema-wide from sm up. */}
      <div className="media-frame aspect-[4/5] sm:aspect-[5/4] lg:aspect-[4/5]">
        <PortfolioFrame
          seed={seed}
          title={title}
          category={category}
          showLabel={false}
          className="motion-safe:animate-drift"
        />

        <div className="absolute inset-x-0 top-0 flex items-center gap-3 p-6">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-brass-400/80" />
          <p className="font-mono text-[0.6rem] tracking-[0.3em] text-bone-50/55 uppercase">
            Scene 01 · Your film
          </p>
        </div>
      </div>

      {/* The source photograph, overlapping the lower-left corner. */}
      <div
        className="absolute -bottom-6 -left-4 w-32 rotate-[-5deg] sm:-bottom-8 sm:-left-8 sm:w-44"
        aria-hidden="true"
      >
        <div className="rounded-[3px] border-4 border-bone-50/90 bg-bone-50/90 pb-7 shadow-[0_18px_50px_-12px_oklch(0_0_0/0.7)]">
          <div className="aspect-square overflow-hidden">
            <PortfolioFrame
              seed={`${seed}-source`}
              title="Source photograph"
              category="BESPOKE"
              showLabel={false}
              className="saturate-[0.55]"
            />
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
