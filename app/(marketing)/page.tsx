import Link from 'next/link';
import { ArrowRight, Eye, KeyRound, Lock, ShieldCheck } from 'lucide-react';
import { Container } from '@/components/site/container';
import { Button } from '@/components/ui/button';
import { SectionHeading } from '@/components/ui/section-heading';
import { PortfolioFrame } from '@/features/portfolio/frame';
import { CinematicStill } from '@/features/media/cinematic-video';
import { TransformationStrip } from '@/features/marketing/transformation-strip';
import { Transformation } from '@/features/marketing/transformation';
import { listPortfolioEntries } from '@/lib/data/portfolio';
import { listActiveExperiences } from '@/lib/data/experiences';
import { categoryLabel } from '@/lib/catalog/categories';
import { portfolioProvenance, provenanceLabel } from '@/lib/catalog/presentation';
import { brand } from '@/lib/brand';
import { JOURNEY_BRIEF_STEPS, JOURNEY_PRODUCTION_STAGES } from '@/lib/journey';
import { FLAGSHIP_FILM, galleryItems } from '@/lib/catalog/showcase';
import { experienceDisplayDescription, experienceDisplayName } from '@/lib/catalog/presentation';

// Marketing content changes rarely and must not require a live session to render.
export const revalidate = 300;

/**
 * The canonical journey, in the order the create wizard actually runs.
 *
 * It was previously told three different ways on three pages, with photos
 * before the brief here and after it in the wizard. The order is now one order:
 * what YOU build, then what WE do. lib/journey.ts holds it so the homepage,
 * How It Works and the create flow cannot drift apart again.
 */
const BRIEF_STEPS = JOURNEY_BRIEF_STEPS;
const PRODUCTION_STAGES = JOURNEY_PRODUCTION_STAGES;

/**
 * Privacy claims, written to match what the system actually enforces.
 *
 * Two earlier lines overstated it. "Only you can open your project" was false —
 * authorised production staff can, and must, or nobody could make the film. And
 * "no public link and none can be created" was false in the other direction —
 * the product creates short-lived signed URLs by design, which is the mechanism
 * rather than a hole in it. A privacy promise that is not exactly true is worse
 * than a weaker one that is.
 */
const TRUST = [
  {
    icon: Lock,
    title: 'Your photos stay private',
    copy: 'Reference images go into private storage the moment you upload them. They are not held in public buckets or exposed through permanent public URLs — access is authorised and time-limited.',
  },
  {
    icon: KeyRound,
    title: 'Your project stays private',
    copy: 'Your brief, reference images, previews and final film are available only through authenticated access, to you and to authorised production staff. They are never exposed as public project pages.',
  },
  {
    icon: Eye,
    title: 'Previews are for your eyes',
    copy: 'Each preview plays through a short-lived link created for your session and re-authorised every time it is used. Nothing becomes shareable by accident.',
  },
  {
    icon: ShieldCheck,
    title: 'Nothing is shown publicly without you',
    copy: 'Your film is never added to our gallery unless you separately say yes. Saying no changes nothing about the work we do for you.',
  },
] as const;

/**
 * The three reassurances that sit next to the button.
 *
 * Every one of them is something the system does, stated without security
 * vocabulary: no certification badges we do not hold, no padlock iconography,
 * no "bank-grade" anything. Someone hesitating before uploading photographs of
 * themselves wants to know what happens to them, not what standard we claim.
 */
const CONVERSION_ASSURANCES = [
  'Private reference uploads',
  'A private preview before anything is final',
  'Nothing public without your separate consent',
] as const;

export default async function HomePage() {
  const [entries, experiences] = await Promise.all([
    listPortfolioEntries(),
    listActiveExperiences(),
  ]);

  // Films we can play first, then the concepts we can only describe.
  const gallery = galleryItems(entries);
  const lead = gallery[0];
  // The hero already carries the lead film's still, so the strip shows the
  // four that are not already on this page above it.
  const strip = gallery.slice(1, 5);

  return (
    <>
      {/* ================================================================ 1. Hero */}
      <section
        className="grain relative overflow-hidden surface-glow"
        aria-labelledby="hero-heading"
      >
        <div className="grain-layer" aria-hidden="true" />

        <Container className="relative grid gap-14 pt-16 pb-20 sm:pt-24 lg:grid-cols-12 lg:items-center lg:gap-10 lg:pt-28 lg:pb-32">
          <div className="lg:col-span-6 xl:col-span-6">
            <p className="animate-fade eyebrow">{brand.descriptor}</p>

            <h1
              id="hero-heading"
              className="mt-7 animate-rise display-heading text-display-xl text-balance"
            >
              Your photos.
              <br />
              Your vision.
              <br />
              <span className="text-brass-300 italic">Your movie.</span>
            </h1>

            <p className="mt-8 max-w-lg animate-rise lede [animation-delay:120ms]">
              Upload your photos, describe the experience you want to live, and we transform your
              idea into a cinematic video created around you.
            </p>

            <div className="mt-11 flex animate-rise flex-col gap-3 [animation-delay:220ms] sm:flex-row sm:items-center">
              <Button asChild size="xl" variant="accent">
                <Link href="/create">
                  Create My Video
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
              <Button asChild size="xl" variant="outline">
                <Link href="/portfolio">See What&rsquo;s Possible</Link>
              </Button>
            </div>

            <ul className="mt-9 flex animate-rise flex-wrap gap-x-6 gap-y-2.5 text-sm text-bone-500 [animation-delay:320ms]">
              {CONVERSION_ASSURANCES.map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <span aria-hidden="true" className="size-1 rounded-full bg-brass-400/70" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* The claim, shown rather than stated: a photograph becoming a scene. */}
          <div className="lg:col-span-6 xl:col-span-5 xl:col-start-8">
            <TransformationStrip
              seed={lead?.slug ?? 'lead'}
              category={lead?.category ?? 'CINEMATIC'}
              title={lead?.title ?? 'A cinematic scene'}
              scenePosterUrl={lead?.film?.posterUrl}
              provenance={lead?.film?.provenance}
            />
          </div>
        </Container>
      </section>

      {/* ========================================================= 2. Experiences */}
      <section
        id="experiences"
        className="section-y rule-top"
        aria-labelledby="experiences-heading"
      >
        <Container>
          <SectionHeading
            id="experiences-heading"
            eyebrow="The Experiences"
            title={
              <>
                Somewhere you have always <span className="text-brass-300 italic">pictured</span>{' '}
                yourself.
              </>
            }
            lede="Every film starts from one of these, then becomes entirely yours. Pick the world; the details are up to you."
          />

          <ul className="mt-16 grid reveal gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {experiences.map((experience, index) => (
              <li
                key={experience.slug}
                // First tile runs tall on desktop: an even grid of identical
                // boxes is the single fastest way to look like a template.
                // h-full on every link in the chain, because `lg:h-full` on the
                // inner frame resolves against nothing unless each ancestor
                // also has a definite height — the symptom being a caption
                // stranded halfway up a tile.
                className={index === 0 ? 'lg:row-span-2 lg:h-full' : undefined}
              >
                <Link
                  href={{ pathname: '/create', query: { experience: experience.slug } }}
                  className="group media-frame block h-full focus-visible:outline-offset-4"
                >
                  <div
                    className={
                      index === 0
                        ? 'relative aspect-[4/5] lg:flex lg:aspect-auto lg:h-full lg:min-h-[34rem]'
                        : 'relative aspect-[4/3]'
                    }
                  >
                    <PortfolioFrame
                      seed={experience.slug}
                      title={experience.name}
                      category={experience.category}
                      showLabel={false}
                      className="transition-transform duration-[1.4s] ease-cinema group-hover:scale-[1.05]"
                    />

                    <div className="absolute inset-x-0 bottom-0 p-6 sm:p-7">
                      <p className="text-[0.65rem] tracking-[0.22em] text-brass-300/80 uppercase">
                        {categoryLabel(experience.category)}
                      </p>
                      <h3 className="mt-2.5 display-heading text-2xl">
                        {experienceDisplayName(experience.slug, experience.name)}
                      </h3>
                      <p className="mt-2.5 max-w-sm text-sm leading-relaxed text-bone-400">
                        {experienceDisplayDescription(experience.slug, experience.description)}
                      </p>
                      <span className="mt-5 inline-flex items-center gap-2 text-sm text-bone-50 opacity-0 transition-opacity duration-500 group-hover:opacity-100 motion-reduce:opacity-100">
                        Start with this
                        <ArrowRight className="size-4" aria-hidden="true" />
                      </span>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      {/* ======================================================== 3. How it works */}
      <section className="section-y rule-top" aria-labelledby="process-heading">
        <Container>
          <SectionHeading
            id="process-heading"
            eyebrow="How It Works"
            title="You build the brief. We make the film."
            lede="Four short steps from you, then the work is ours. You see it before anything is finished."
          />

          <ol className="mt-16 grid gap-x-12 gap-y-14 sm:grid-cols-2 lg:grid-cols-4">
            {BRIEF_STEPS.map((item) => (
              <li key={item.step} className="reveal pt-7 rule-top">
                <p className="figure-mark">{item.step}</p>
                <h3 className="mt-5 display-heading text-xl">{item.title}</h3>
                <p className="mt-3 leading-relaxed text-bone-400">{item.copy}</p>
              </li>
            ))}
          </ol>

          {/* Unnumbered on purpose: these are ours, not four more things the
              customer has to complete. */}
          <div className="mt-20 pt-10 rule-top">
            <p className="eyebrow">Then we take over</p>
            <ul className="mt-8 grid gap-x-12 gap-y-8 sm:grid-cols-3">
              {PRODUCTION_STAGES.map((stage) => (
                <li key={stage.title} className="reveal">
                  <h3 className="display-heading text-xl">{stage.title}</h3>
                  <p className="mt-2.5 leading-relaxed text-bone-400">{stage.copy}</p>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-14">
            <Button asChild variant="link">
              <Link href="/how-it-works">
                Read the longer version
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </Container>
      </section>

      {/* =================================================== 4. Photo → idea → film */}
      <section className="grain relative section-y-lg rule-top" aria-labelledby="transform-heading">
        <div className="grain-layer" aria-hidden="true" />
        <Container className="relative">
          <SectionHeading
            id="transform-heading"
            align="center"
            eyebrow="The Idea"
            title={
              <>
                One photograph. One sentence.
                <br className="hidden sm:block" /> Somewhere{' '}
                <span className="text-brass-300 italic">extraordinary</span>.
              </>
            }
          />

          <Transformation
            className="mt-20"
            // Everything here is ours. The label under the sequence says so,
            // and nothing in the copy suggests a customer sent us these.
            attribution="DEMONSTRATION"
            panels={[
              {
                // Stays a placeholder until somebody gives us a photograph they
                // are happy to have on the homepage. A stock face standing in
                // for a customer would undo the whole point of the section.
                mark: 'Reference',
                caption: 'A clear picture of you. The one where you actually like how you look.',
                seed: 'stage-photo',
                category: 'BESPOKE',
                asSnapshot: true,
              },
              {
                mark: 'The idea',
                caption:
                  '“A luxury yacht at night, surrounded by friends and family, with fireworks and moonlight.”',
                seed: 'stage-idea',
                category: 'LUXURY_LIFESTYLE',
              },
            ]}
            result={{
              mark: 'The cinematic result',
              caption: FLAGSHIP_FILM.shortCopy,
              seed: 'stage-world',
              category: FLAGSHIP_FILM.category,
              film: FLAGSHIP_FILM,
            }}
          />
        </Container>
      </section>

      {/* ============================================================ 5. Portfolio */}
      <section className="section-y rule-top" aria-labelledby="work-heading">
        <Container>
          <SectionHeading
            id="work-heading"
            eyebrow="Explore the possibilities"
            title="See where a single photograph could take you."
            lede="Concepts we created to show what is possible. Yours will be built around you."
            action={
              <Button asChild variant="link">
                <Link href="/portfolio">
                  Browse the concept gallery
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            }
          />

          {/* Two columns, not four. These are 16:9 films: a quarter-width
              widescreen card is a letterbox slot, and cropping one to portrait
              to fill a tall tile cuts the subject out of its own still. Two
              columns shows four films at a size worth looking at. */}
          <ul className="mt-16 grid gap-x-6 gap-y-10 sm:grid-cols-2">
            {strip.map((entry) => (
              <li key={entry.id} className="group reveal">
                <Link
                  href={{ pathname: '/portfolio', query: { category: entry.category } }}
                  className="block focus-visible:outline-offset-4"
                >
                  {entry.film ? (
                    // A still, not a player: this card is itself a link, and a
                    // player nested inside one is both invalid and a confusing
                    // target. The film plays in the gallery it leads to.
                    <CinematicStill
                      posterUrl={entry.film.posterUrl}
                      title={entry.film.title}
                      provenance={entry.film.provenance}
                      aspect={entry.film.aspect}
                      imageClassName="transition-transform duration-[1.4s] ease-cinema group-hover:scale-[1.06]"
                    />
                  ) : (
                    <div className="media-frame aspect-video">
                      <PortfolioFrame
                        seed={entry.slug}
                        title={entry.title}
                        category={entry.category}
                        showLabel={false}
                        className="transition-transform duration-[1.4s] ease-cinema group-hover:scale-[1.06]"
                      />
                      {provenanceLabel(portfolioProvenance(entry)) ? (
                        <p className="absolute top-3.5 left-3.5 rounded-full border border-bone-50/20 bg-ink-990/55 px-2.5 py-0.5 text-[0.55rem] tracking-[0.2em] text-bone-200 uppercase backdrop-blur-sm">
                          {provenanceLabel(portfolioProvenance(entry))}
                        </p>
                      ) : null}
                    </div>
                  )}
                  <p className="mt-5 text-[0.65rem] tracking-[0.22em] text-brass-300/75 uppercase">
                    {categoryLabel(entry.category)}
                  </p>
                  <h3 className="mt-2 display-heading text-lg transition-colors group-hover:text-brass-200">
                    {entry.title}
                  </h3>
                </Link>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      {/* ================================================================ 6. Trust */}
      <section className="section-y rule-top" aria-labelledby="trust-heading">
        <Container>
          <SectionHeading
            id="trust-heading"
            eyebrow="Your Privacy"
            title="You are sending us photographs of yourself. We treat that seriously."
            lede="No part of this is on trust alone — the rules below are enforced by the system, not by a policy document."
          />

          <ul className="mt-16 grid gap-x-12 gap-y-12 sm:grid-cols-2">
            {TRUST.map((item) => (
              <li key={item.title} className="flex reveal gap-5">
                <span
                  aria-hidden="true"
                  className="mt-1 flex size-10 shrink-0 items-center justify-center rounded-full border border-brass-400/25 bg-brass-400/[0.07] text-brass-300"
                >
                  <item.icon className="size-4.5" />
                </span>
                <div>
                  <h3 className="display-heading text-xl">{item.title}</h3>
                  <p className="mt-2.5 leading-relaxed text-bone-400">{item.copy}</p>
                </div>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      {/* ============================================================ 7. Final CTA */}
      <section
        className="grain relative overflow-hidden surface-glow section-y-lg rule-top"
        aria-labelledby="cta-heading"
      >
        <div className="grain-layer" aria-hidden="true" />
        <Container className="relative text-center">
          <h2
            id="cta-heading"
            className="mx-auto max-w-4xl display-heading text-display-xl text-balance"
          >
            What world do you want to <span className="text-brass-300 italic">step into</span>?
          </h2>
          <p className="mx-auto mt-8 max-w-md lede">
            Your next cinematic experience starts with a single photo.
          </p>
          <Button asChild size="xl" variant="accent" className="mt-12">
            <Link href="/create">
              Create My Video
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>

          <ul className="mt-9 flex flex-wrap justify-center gap-x-6 gap-y-2.5 text-sm text-bone-500">
            {CONVERSION_ASSURANCES.map((item) => (
              <li key={item} className="flex items-center gap-2">
                <span aria-hidden="true" className="size-1 rounded-full bg-brass-400/70" />
                {item}
              </li>
            ))}
          </ul>
        </Container>
      </section>
    </>
  );
}
