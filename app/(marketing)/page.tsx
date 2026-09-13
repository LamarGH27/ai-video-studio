import Link from 'next/link';
import { ArrowRight, Eye, KeyRound, Lock, ShieldCheck } from 'lucide-react';
import { Container } from '@/components/site/container';
import { Button } from '@/components/ui/button';
import { SectionHeading } from '@/components/ui/section-heading';
import { PortfolioFrame } from '@/features/portfolio/frame';
import { TransformationStrip } from '@/features/marketing/transformation-strip';
import { listPortfolioEntries } from '@/lib/data/portfolio';
import { listActiveExperiences } from '@/lib/data/experiences';
import { categoryLabel } from '@/lib/catalog/categories';
import { brand } from '@/lib/brand';

// Marketing content changes rarely and must not require a live session to render.
export const revalidate = 300;

const PROCESS = [
  {
    step: '01',
    title: 'Upload your photos',
    copy: 'Choose clear reference images that show you at your best — a few good ones beat a whole camera roll.',
  },
  {
    step: '02',
    title: 'Describe your vision',
    copy: 'Tell us where you want to be, what you want to wear, and the moment you want to experience.',
  },
  {
    step: '03',
    title: 'We create your film',
    copy: 'We transform your idea into a personalised cinematic video and send you a private preview.',
  },
  {
    step: '04',
    title: 'Approve or refine',
    copy: 'Request changes or approve the film before receiving your final version.',
  },
] as const;

const TRUST = [
  {
    icon: Lock,
    title: 'Your photos stay private',
    copy: 'Reference images go into private storage the moment you upload them. They are never public, never indexed, and never shown to another customer.',
  },
  {
    icon: KeyRound,
    title: 'Only you can open your project',
    copy: 'Everything about your film — the brief, the previews, the final cut — sits behind your account. Links alone open nothing.',
  },
  {
    icon: Eye,
    title: 'Previews are for your eyes',
    copy: 'Each preview plays through a short-lived private link created for your session. Nothing is shareable by accident.',
  },
  {
    icon: ShieldCheck,
    title: 'Nothing is shown publicly without you',
    copy: 'Your film is never added to our portfolio unless you explicitly say yes. Saying no changes nothing about the work we do for you.',
  },
] as const;

export default async function HomePage() {
  const [entries, experiences] = await Promise.all([
    listPortfolioEntries(),
    listActiveExperiences(),
  ]);

  const featured = entries.filter((entry) => entry.featured).slice(0, 5);
  const showcase = featured.length > 0 ? featured : entries.slice(0, 5);
  const [lead, ...rest] = showcase;

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
          </div>

          {/* The claim, shown rather than stated: a photograph becoming a scene. */}
          <div className="lg:col-span-6 xl:col-span-5 xl:col-start-8">
            <TransformationStrip
              seed={lead?.slug ?? 'lead'}
              category={lead?.category ?? 'CINEMATIC'}
              title={lead?.title ?? 'A cinematic scene'}
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
                      <h3 className="mt-2.5 display-heading text-2xl">{experience.name}</h3>
                      <p className="mt-2.5 max-w-sm text-sm leading-relaxed text-bone-400">
                        {experience.description}
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
            title="Four steps. Most of them are ours."
            lede="You choose, you describe, you approve. Everything in between is production work you never have to think about."
          />

          <ol className="mt-16 grid gap-x-12 gap-y-14 sm:grid-cols-2 lg:grid-cols-4">
            {PROCESS.map((item) => (
              <li key={item.step} className="reveal pt-7 rule-top">
                <p className="figure-mark">{item.step}</p>
                <h3 className="mt-5 display-heading text-xl">{item.title}</h3>
                <p className="mt-3 leading-relaxed text-bone-400">{item.copy}</p>
              </li>
            ))}
          </ol>

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

          <ol className="mt-20 grid gap-10 lg:grid-cols-3 lg:gap-6">
            {[
              {
                mark: 'Your photo',
                copy: 'A clear picture of you. The one where you actually like how you look.',
                seed: 'stage-photo',
                category: 'BESPOKE' as const,
                ratio: 'aspect-square',
              },
              {
                mark: 'Your idea',
                copy: '“Walking a Monaco quayside at first light, linen suit, nobody else around.”',
                seed: 'stage-idea',
                category: 'LUXURY_LIFESTYLE' as const,
                ratio: 'aspect-square',
              },
              {
                mark: 'Your cinematic world',
                copy: 'A film of that moment, graded and cut, with you at the centre of it.',
                seed: 'stage-world',
                category: 'CINEMATIC' as const,
                ratio: 'aspect-square',
              },
            ].map((stage, index) => (
              <li key={stage.mark} className="relative reveal">
                {/* The connector, drawn only where there is a next panel. */}
                {index < 2 ? (
                  <span
                    aria-hidden="true"
                    className="absolute top-1/2 -right-3 hidden h-px w-6 bg-gradient-to-r from-brass-400/60 to-transparent lg:block"
                  />
                ) : null}

                <div className={`media-frame ${stage.ratio}`}>
                  <PortfolioFrame
                    seed={stage.seed}
                    title={stage.mark}
                    category={stage.category}
                    showLabel={false}
                    className={index === 2 ? 'motion-safe:animate-drift' : undefined}
                  />
                  {index === 0 ? (
                    // The first panel is a photograph, so it gets a photograph's
                    // furniture: a white border and a slight tilt.
                    <div
                      aria-hidden="true"
                      className="absolute inset-6 rotate-[-2.5deg] border-6 border-bone-50/85 shadow-2xl sm:inset-10"
                    />
                  ) : null}
                </div>

                <p className="mt-7 eyebrow">{stage.mark}</p>
                <p className="mt-3 leading-relaxed text-bone-400">{stage.copy}</p>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      {/* ============================================================ 5. Portfolio */}
      <section className="section-y rule-top" aria-labelledby="work-heading">
        <Container>
          <SectionHeading
            id="work-heading"
            eyebrow="Selected Work"
            title="Films we have made."
            action={
              <Button asChild variant="link">
                <Link href="/portfolio">
                  View the full portfolio
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            }
          />

          <ul className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {rest.slice(0, 4).map((entry) => (
              <li key={entry.id} className="group reveal">
                <Link
                  href={{ pathname: '/portfolio', query: { category: entry.category } }}
                  className="block focus-visible:outline-offset-4"
                >
                  <div className="media-frame aspect-[3/4]">
                    <PortfolioFrame
                      seed={entry.slug}
                      title={entry.title}
                      category={entry.category}
                      showLabel={false}
                      className="transition-transform duration-[1.4s] ease-cinema group-hover:scale-[1.06]"
                    />
                  </div>
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
        </Container>
      </section>
    </>
  );
}
