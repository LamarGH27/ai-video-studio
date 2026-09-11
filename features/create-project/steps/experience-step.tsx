'use client';

import { cn } from '@/lib/utils';
import { categoryLabel } from '@/lib/catalog/categories';
import { Button } from '@/components/ui/button';
import type { ExperienceOption } from '@/lib/catalog/experiences';

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
    <section aria-labelledby="experience-heading" className="space-y-8">
      <header className="space-y-3">
        <p className="eyebrow">Step 1</p>
        <h2 id="experience-heading" className="display-heading text-3xl sm:text-4xl">
          What kind of film are we making?
        </h2>
        <p className="max-w-xl leading-relaxed text-bone-400">
          Each experience is a production approach, not a preset. You will shape it with your brief
          next.
        </p>
      </header>

      <fieldset>
        <legend className="sr-only">Choose a video experience</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          {experiences.map((experience) => {
            const isSelected = experience.slug === selectedSlug;
            return (
              <label
                key={experience.slug}
                className={cn(
                  'group relative flex cursor-pointer flex-col rounded-panel border p-6 transition-colors',
                  isSelected
                    ? 'border-brass-400/60 bg-brass-400/[0.06]'
                    : 'border-white/10 bg-white/[0.02] hover:border-white/25',
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

                <span className="text-[0.65rem] tracking-[0.2em] text-brass-300/70 uppercase">
                  {categoryLabel(experience.category)}
                </span>
                <span className="mt-3 display-heading text-xl">{experience.name}</span>
                <span className="mt-3 text-sm leading-relaxed text-bone-400">
                  {experience.description}
                </span>

                <span
                  aria-hidden="true"
                  className={cn(
                    'absolute top-5 right-5 size-2.5 rounded-full transition-colors',
                    isSelected ? 'bg-brass-400' : 'bg-white/10 group-hover:bg-white/25',
                  )}
                />
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="flex justify-end">
        <Button type="button" variant="accent" onClick={onContinue} disabled={!selectedSlug}>
          Continue to your brief
        </Button>
      </div>
    </section>
  );
}
