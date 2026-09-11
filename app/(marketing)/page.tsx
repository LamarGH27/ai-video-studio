import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Container } from '@/components/site/container';
import { Button } from '@/components/ui/button';
import { PortfolioFrame } from '@/features/portfolio/frame';
import { listPortfolioEntries } from '@/lib/data/portfolio';
import { listActiveExperiences } from '@/lib/data/experiences';
import { categoryLabel } from '@/lib/catalog/categories';

// Marketing content changes rarely and must not require a live session to render.
export const revalidate = 300;

const PROCESS = [
  { step: '01', title: 'Choose your experience', copy: 'Pick the kind of film you want made.' },
  { step: '02', title: 'Upload your photos', copy: 'A handful of clear reference images.' },
  { step: '03', title: 'Describe your vision', copy: 'Mood, location, wardrobe, the lot.' },
  { step: '04', title: 'Production begins', copy: 'A producer picks up your brief.' },
  { step: '05', title: 'Receive your film', copy: 'Preview, revise, then final delivery.' },
] as const;

export default async function HomePage() {
  const [entries, experiences] = await Promise.all([
    listPortfolioEntries(),
    listActiveExperiences(),
  ]);

  const featured = entries.filter((entry) => entry.featured).slice(0, 3);
  const showcase = featured.length > 0 ? featured : entries.slice(0, 3);

  return (
    <>
      {/* ---------------------------------------------------------------- Hero */}
      <section className="relative overflow-hidden border-b border-white/8 surface-glow">
        <Container className="relative py-24 sm:py-32 lg:py-40">
          <p className="animate-fade eyebrow">Cinematic AI Production</p>

          <h1 className="mt-6 max-w-4xl animate-rise display-heading text-[clamp(2.75rem,8vw,5.5rem)]">
            Your photos.
            <br />
            Your vision.
            <br />
            <span className="text-brass-300">Your movie.</span>
          </h1>

          <p className="mt-8 max-w-xl animate-rise text-lg leading-relaxed text-bone-400 [animation-delay:120ms]">
            Turn existing photographs into bespoke cinematic AI-generated video experiences.
          </p>

          <div className="mt-10 flex animate-rise flex-col gap-3 [animation-delay:200ms] sm:flex-row sm:items-center">
            <Button asChild size="lg" variant="accent">
              <Link href="/create">
                Create My Video
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/portfolio">View Portfolio</Link>
            </Button>
          </div>
        </Container>

        {/* Full-bleed film strip. Decorative — the real work lives on /portfolio. */}
        <div aria-hidden="true" className="flex gap-px overflow-hidden border-t border-white/8">
          {entries.slice(0, 6).map((entry) => (
            <div key={entry.id} className="h-28 flex-1 sm:h-40">
              <PortfolioFrame seed={entry.slug} title={entry.title} category={entry.category} />
            </div>
          ))}
        </div>
      </section>

      {/* -------------------------------------------------------- Experiences */}
      <section className="border-b border-white/8 py-24 sm:py-28">
        <Container>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-xl">
              <p className="eyebrow">The Experiences</p>
              <h2 className="mt-4 display-heading text-[clamp(1.875rem,4vw,2.75rem)]">
                Start from a form, not a blank page.
              </h2>
            </div>
            <p className="max-w-sm text-sm leading-relaxed text-bone-400">
              Each experience is a production approach with its own framing, pacing and grade. Pick
              the closest one and shape it with your brief.
            </p>
          </div>

          <ul className="mt-14 grid gap-px overflow-hidden rounded-panel border border-white/10 bg-white/8 sm:grid-cols-2 lg:grid-cols-4">
            {experiences.map((experience) => (
              <li key={experience.slug} className="bg-ink-950 p-6">
                <p className="text-[0.65rem] tracking-[0.2em] text-brass-300/70 uppercase">
                  {categoryLabel(experience.category)}
                </p>
                <h3 className="mt-3 display-heading text-xl">{experience.name}</h3>
                <p className="mt-3 text-sm leading-relaxed text-bone-400">
                  {experience.description}
                </p>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      {/* ----------------------------------------------------------- Showcase */}
      <section className="border-b border-white/8 py-24 sm:py-28">
        <Container>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="eyebrow">Selected Work</p>
              <h2 className="mt-4 display-heading text-[clamp(1.875rem,4vw,2.75rem)]">
                Recent commissions.
              </h2>
            </div>
            <Button asChild variant="link" className="self-start sm:self-auto">
              <Link href="/portfolio">
                View the full portfolio
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </div>

          <ul className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {showcase.map((entry) => (
              <li key={entry.id} className="group">
                <div className="aspect-[4/5] overflow-hidden rounded-panel border border-white/10">
                  <PortfolioFrame
                    seed={entry.slug}
                    title={entry.title}
                    category={entry.category}
                    className="transition-transform duration-700 group-hover:scale-[1.03]"
                  />
                </div>
                <h3 className="mt-5 display-heading text-lg">{entry.title}</h3>
                {entry.description ? (
                  <p className="mt-2 text-sm leading-relaxed text-bone-400">{entry.description}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </Container>
      </section>

      {/* ------------------------------------------------------------ Process */}
      <section className="border-b border-white/8 py-24 sm:py-28">
        <Container>
          <p className="eyebrow">The Process</p>
          <h2 className="mt-4 max-w-2xl display-heading text-[clamp(1.875rem,4vw,2.75rem)]">
            Five steps from photographs to a finished film.
          </h2>

          <ol className="mt-14 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-5">
            {PROCESS.map((item) => (
              <li key={item.step} className="border-t border-white/12 pt-5">
                <p className="font-mono text-xs tracking-[0.25em] text-brass-300/70">{item.step}</p>
                <h3 className="mt-4 text-base font-medium text-bone-50">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-bone-400">{item.copy}</p>
              </li>
            ))}
          </ol>

          <Button asChild variant="link" className="mt-12">
            <Link href="/how-it-works">
              Read how it works
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </Container>
      </section>

      {/* ---------------------------------------------------------- Final CTA */}
      <section className="surface-glow py-28 sm:py-36">
        <Container className="text-center">
          <h2 className="mx-auto max-w-3xl display-heading text-[clamp(2rem,5vw,3.5rem)]">
            Tell us the film you have in mind.
          </h2>
          <p className="mx-auto mt-6 max-w-md text-base leading-relaxed text-bone-400">
            Briefs take a few minutes. You will need a handful of clear photographs and permission
            to use the likeness shown.
          </p>
          <Button asChild size="lg" variant="accent" className="mt-10">
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
