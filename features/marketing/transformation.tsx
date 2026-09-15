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
 * `result.film` and `panel.imageUrl` are both optional. Without them a panel
 * falls back to the designed placeholder frame, which is what the whole section
 * used before there was anything real to show.
 *
 * Nothing here may imply a demonstration belongs to a customer. `attribution`
 * is required, and it is stated once, under the sequence, rather than stamped
 * across every panel. That one line has to cover the reference panel as well as
 * the film: an input nobody actually sent us is exactly as much a
 * demonstration as an output nobody actually commissioned.
 */

export type TransformationAttribution = 'DEMONSTRATION' | 'CUSTOMER';

export interface TransformationPanel {
  /** Short label above the caption: "Your photo", "Your idea". */
  mark: string;
  caption: string;
  /** Placeholder grading when there is no media. */
  seed: string;
  category: ShowcaseCategory;
  /**
   * A real input image, sized to its own aspect ratio inside the panel.
   *
   * It is deliberately NOT cropped to fill the square. This panel stands for
   * something somebody hands us, and a portrait squeezed into a landscape box
   * loses the top of a head — which is both the worst possible thing to do to
   * the one image on the page that is supposed to look ordinary, and a lie
   * about what we accept.
   */
  imageUrl?: string;
  /** Natural ratio of `imageUrl`, as a Tailwind aspect class. */
  imageAspect?: string;
  /** Required with `imageUrl`. Describes the image, not the person in it. */
  imageAlt?: string;
  /**
   * The brief itself, set inside the panel.
   *
   * The middle step is a sentence somebody types, and a sentence rendered as an
   * empty coloured rectangle with the words underneath reads as a placeholder —
   * especially now that the panel beside it holds a real image. Putting the
   * words where the picture would go is what makes the middle of the sequence
   * look like a step rather than a gap.
   */
  quote?: string;
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
  // Covers both ends of the sequence. See the note on `attribution` above.
  DEMONSTRATION:
    'A demonstration we made end to end — the reference image and the film are both ours, not a customer project.',
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
            <div className="media-frame flex aspect-square items-center justify-center">
              {panel.imageUrl ? (
                <>
                  {/* The graded ground stays behind it, so the photo reads as
                      something resting ON the page rather than another poster
                      bled to the edges. */}
                  <PortfolioFrame
                    seed={panel.seed}
                    title={panel.mark}
                    category={panel.category}
                    showLabel={false}
                    className="absolute inset-0"
                  />
                  <div
                    className={cn(
                      'relative h-[82%] overflow-hidden rounded-[2px] border-4 border-bone-50/90 shadow-[0_18px_50px_-12px_oklch(0_0_0/0.7)]',
                      panel.imageAspect ?? 'aspect-[4/5]',
                    )}
                  >
                    {/* Not next/image: a static asset already served at the size
                        it renders at, where the optimiser adds a request and a
                        cache entry for nothing. Dimensions are set so the box is
                        reserved before it loads. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={panel.imageUrl}
                      alt={panel.imageAlt ?? ''}
                      width={1122}
                      height={1402}
                      loading="lazy"
                      decoding="async"
                      className="size-full object-cover"
                    />
                  </div>
                </>
              ) : (
                <>
                  <PortfolioFrame
                    seed={panel.seed}
                    title={panel.mark}
                    category={panel.category}
                    showLabel={false}
                    className="absolute inset-0"
                  />

                  {panel.quote ? (
                    <p className="text-bone-100 relative max-w-[26ch] px-8 display-heading text-[clamp(1.25rem,2.4vw,1.75rem)] text-balance">
                      {panel.quote}
                    </p>
                  ) : null}

                  {panel.asSnapshot ? (
                    <div
                      aria-hidden="true"
                      className="absolute inset-6 rotate-[-2.5deg] border-6 border-bone-50/85 shadow-2xl sm:inset-10"
                    />
                  ) : null}
                </>
              )}
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
