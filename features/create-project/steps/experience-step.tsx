'use client';

import { ArrowRight, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { categoryLabel } from '@/lib/catalog/categories';
import { Button } from '@/components/ui/button';
import { PortfolioFrame } from '@/features/portfolio/frame';
import { experienceDisplayDescription, experienceDisplayName } from '@/lib/catalog/presentation';
import type { ExperienceOption } from '@/lib/catalog/experiences';

/**
 * Step 1 — the only step that should feel like browsing rather than filling in.
 *
 * The choice is emotional, so it is made against pictures. Each option is a
 * real radio input kept visually hidden inside its label: the whole tile is the
 * hit area, arrow keys move between options, and the selection is announced —
 * none of which is true of a div with an onClick.
 */
export function ExperienceStep({
  experiences,
  selectedSlug,
  onSelect,
  onContinue,
}: {
  experiences: readonly ExperienceOption[];
  selectedSlug: string | null;
  onSelect: (slug: string) => void;
  onContinue: () => void;
}) {
  return (
    <section aria-labelledby="experience-heading" className="space-y-10">
      <header className="max-w-2xl space-y-4">
        <p className="eyebrow">Step 1 — Your idea</p>
        <h2 id="experience-heading" className="display-heading text-display-md">
          What kind of film are we making?
        </h2>
        <p className="lede">
          Pick the world you want to step into. It is a starting point, not a preset — you will make
          it yours in the next step.
        </p>
        {/* The people who need Bespoke most are the ones least sure they are
            allowed to use it, so the page says so before they start scrolling. */}
        <p className="text-sm text-bone-500">
          Not sure which direction fits? Start with Bespoke and describe what you have in mind.
        </p>
      </header>

      <fieldset>
        <legend className="sr-only">Choose a video experience</legend>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {experiences.map((experience) => {
            const isSelected = experience.slug === selectedSlug;

            return (
              <label
                key={experience.slug}
                className={cn(
                  'group media-frame relative block cursor-pointer transition-all duration-500',
                  isSelected
                    ? 'border-brass-400/70 ring-1 ring-brass-400/40'
                    : 'hover:border-white/25',
                  // Focus lands on the hidden input; show it on the tile.
                  'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-3 has-[:focus-visible]:outline-brass-400',
                )}
              >
                <input
                  type="radio"
                  name="experience"
                  value={experience.slug}
                  checked={isSelected}
                  onChange={() => onSelect(experience.slug)}
                  className="sr-only"
                />

                <span className="relative block aspect-[5/4]">
                  <PortfolioFrame
                    seed={experience.slug}
                    title={experience.name}
                    category={experience.category}
                    showLabel={false}
                    className={cn(
                      'transition-transform duration-[1.2s] ease-cinema',
                      isSelected ? 'scale-[1.04]' : 'group-hover:scale-[1.04]',
                    )}
                  />

                  <span className="absolute inset-x-0 bottom-0 block p-5">
                    <span className="block text-[0.62rem] tracking-[0.2em] text-brass-300/80 uppercase">
                      {categoryLabel(experience.category)}
                    </span>
                    <span className="mt-2 block display-heading text-xl">
                      {experienceDisplayName(experience.slug, experience.name)}
                    </span>
                    <span className="mt-2 block text-sm leading-relaxed text-bone-400">
                      {experienceDisplayDescription(experience.slug, experience.description)}
                    </span>
                  </span>

                  {/* The selected mark. Decorative — the radio carries the state. */}
                  <span
                    aria-hidden="true"
                    className={cn(
                      'absolute top-4 right-4 flex size-7 items-center justify-center rounded-full border transition-all duration-300',
                      isSelected
                        ? 'border-brass-400 bg-brass-400 text-ink-990'
                        : 'border-bone-50/35 bg-ink-990/25 text-transparent backdrop-blur-sm group-hover:border-bone-50/70',
                    )}
                  >
                    <Check className="size-3.5" strokeWidth={3} />
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-end">
        {!selectedSlug ? (
          <p className="text-sm text-bone-500 sm:mr-auto">Choose one to continue.</p>
        ) : null}
        <Button
          type="button"
          variant="accent"
          size="lg"
          onClick={onContinue}
          disabled={!selectedSlug}
        >
          Continue to your vision
          <ArrowRight aria-hidden="true" />
        </Button>
      </div>
    </section>
  );
}
