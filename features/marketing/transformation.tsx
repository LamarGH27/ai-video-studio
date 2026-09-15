import { PortfolioFrame } from '@/features/portfolio/frame';
import { CinematicVideo } from '@/features/media/cinematic-video';
import { cn } from '@/lib/utils';
import type { ShowcaseFilm } from '@/lib/catalog/showcase';
import type { ShowcaseCategory } from '@/lib/catalog/categories';

/**
 * The proof: a photograph, a sentence, and the film that came out of them.
 *
 * The sequence is deliberately lopsided, because the thing it is proving is
 * lopsided. The inputs are small — a picture and a line of text — so they get
 * two square panels side by side. The result is the whole point, so it gets the
 * full width of the container at its native 16:9 and is the only part that
 * moves. Three equal thumbnails would have made the film the same size as the
 * sentence describing it, and cropping a widescreen film into a square to keep
 * the grid tidy would have cut the subject out of its own demonstration.
 *
 * `result.film` is optional. Without it the panel falls back to the designed
 * placeholder frame, which is what the first two panels use today and what the
 * whole section used before we had anything real to show.
 *
 * Nothing here may imply a demonstration belongs to a customer. `attribution`
 * is required, and it is stated once, under the sequence, rather than stamped
 * across every panel.
 */

export type TransformationAttribution = 'DEMONSTRATION' | 'CUSTOMER';

export interface TransformationPanel {
  /** Short label above the caption: "Reference", "The idea". */
  mark: string;
  caption: string;
  /** Placeholder grading when there is no media. */
  seed: string;
  category: ShowcaseCategory;
  /** A photograph gets a photograph's furniture: white border, slight tilt. */
  asSnapshot?: boolean;
}

export interface TransformationResult {
  mark: string;
  caption: string;
  seed: string;
  category: ShowcaseCategory;
  /** The real thing, when we have it. */
  film?: ShowcaseFilm;
}

const ATTRIBUTION_NOTE: Record<TransformationAttribution, string | null> = {
  DEMONSTRATION: 'Demonstration concept — not a customer project.',
  // A consented, credited customer film needs no disclaimer.
  CUSTOMER: null,
};

export function Transformation({
  panels,
  result,
  attribution,
  className,
}: {
  panels: readonly TransformationPanel[];
  result: TransformationResult;
  attribution: TransformationAttribution;
  className?: string;
}) {
  const note = ATTRIBUTION_NOTE[attribution];

  return (
    <div className={className}>
      <ol className="grid gap-10 sm:grid-cols-2 sm:gap-6">
        {panels.map((panel) => (
          <li key={panel.mark} className="reveal">
            <div className="media-frame aspect-square">
              <PortfolioFrame
                seed={panel.seed}
                title={panel.mark}
                category={panel.category}
                showLabel={false}
              />

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

        <li className="reveal sm:col-span-2 sm:mt-8">
          {result.film ? (
            <CinematicVideo
              videoUrl={result.film.videoUrl}
              posterUrl={result.film.posterUrl}
              title={result.film.title}
              category={result.film.category}
              description={result.film.longCopy}
              provenance={result.film.provenance}
              aspect={result.film.aspect}
              // The one autoplaying video on the page, and only if the
              // visitor's motion setting and connection both allow it.
              mode="autoplay"
            />
          ) : (
            <div className="media-frame aspect-video">
              <PortfolioFrame
                seed={result.seed}
                title={result.mark}
                category={result.category}
                showLabel={false}
                className={cn('motion-safe:animate-drift')}
              />
            </div>
          )}

          <div className="mt-7 sm:flex sm:items-baseline sm:justify-between sm:gap-8">
            <p className="eyebrow">{result.mark}</p>
            <p className="mt-3 max-w-xl leading-relaxed text-bone-400 sm:mt-0">{result.caption}</p>
          </div>
        </li>
      </ol>

      {note ? <p className="mt-10 text-sm text-bone-500">{note}</p> : null}
    </div>
  );
}
