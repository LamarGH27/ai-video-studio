import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowRight } from 'lucide-react';
import { Container } from '@/components/site/container';
import { Button } from '@/components/ui/button';
import { REFERENCE_IMAGE_RULES } from '@/lib/validation/project';
import { JOURNEY_BRIEF_STEPS, JOURNEY_PRODUCTION_STAGES } from '@/lib/journey';

export const metadata: Metadata = {
  title: 'How It Works',
  description: 'From choosing an experience to receiving your finished cinematic film.',
};

/**
 * The long-form wording for the journey defined in lib/journey.ts.
 *
 * Kept keyed to that list rather than duplicating it, so this page can say more
 * than the homepage does without being able to say it in a different ORDER.
 *
 * The "Coming soon" markers that used to sit on production and delivery are
 * gone. That workflow shipped in Milestone 2A and has passed live verification;
 * telling a visitor that the second half of the service does not exist yet was
 * costing credibility for nothing.
 */
const EXTENDED_BRIEF_COPY: Readonly<Record<number, string>> = {
  1: 'Start from a production approach — luxury lifestyle, fashion, cinematic, travel and more — or bring a custom concept with no template behind it.',
  2: 'Mood, location, wardrobe, orientation, length — and anything that must not change. The more specific the brief, the closer the first cut lands.',
  3: `Up to ${REFERENCE_IMAGE_RULES.max} clear reference images. They are stored privately, are never published, and are seen only by authorised production staff working on your brief.`,
  4: 'Read it back before it goes anywhere. Nothing reaches production until you submit, and you can leave and return without losing it.',
};

const EXTENDED_PRODUCTION_COPY: Readonly<Record<string, string>> = {
  Production:
    'We review your brief and your reference images, confirm they will produce the result you are after, and build your film. You can follow its status from your account at any time.',
  'Your review':
    'Your first preview arrives privately in your account. Watch it through, then approve it or tell us in your own words what should be different. There is no limit on asking, and every version is kept.',
  Delivery:
    'Once you approve, we prepare the final cut at full quality. It appears in your account to watch and to download, and it stays there.',
};

export default function HowItWorksPage() {
  return (
    <>
      <section className="grain relative overflow-hidden surface-glow">
        <div className="grain-layer" aria-hidden="true" />
        <Container className="relative grid gap-8 py-20 sm:py-28 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-8">
            <p className="eyebrow">How It Works</p>
            <h1 className="mt-6 display-heading text-display-lg text-balance">
              A commission, not a filter.
            </h1>
          </div>
          <p className="leading-relaxed text-bone-400 lg:col-span-4 lg:col-start-9">
            You write the brief and supply the photographs. We handle the production.
          </p>
        </Container>
      </section>

      <section className="section-y rule-top">
        <Container>
          <p className="eyebrow">Build your brief</p>

          <ol className="mt-6">
            {JOURNEY_BRIEF_STEPS.map((step) => (
              <li
                key={step.step}
                className="grid reveal gap-5 py-10 rule-top sm:grid-cols-12 sm:gap-8 sm:py-14"
              >
                <p className="figure-mark sm:col-span-2">{step.step}</p>
                <div className="sm:col-span-6">
                  <h2 className="display-heading text-2xl sm:text-3xl">{step.title}</h2>
                </div>
                <p className="leading-relaxed text-bone-400 sm:col-span-4">
                  {EXTENDED_BRIEF_COPY[step.wizardStepId] ?? step.copy}
                </p>
              </li>
            ))}
          </ol>

          <p className="mt-20 eyebrow">Then we take over</p>

          <ol className="mt-6">
            {JOURNEY_PRODUCTION_STAGES.map((stage) => (
              <li
                key={stage.title}
                className="grid reveal gap-5 py-10 rule-top sm:grid-cols-12 sm:gap-8 sm:py-14"
              >
                <div className="sm:col-span-6 sm:col-start-3">
                  <h2 className="display-heading text-2xl sm:text-3xl">{stage.title}</h2>
                </div>
                <p className="leading-relaxed text-bone-400 sm:col-span-4">
                  {EXTENDED_PRODUCTION_COPY[stage.title] ?? stage.copy}
                </p>
              </li>
            ))}
          </ol>

          <div className="mt-20 rounded-panel border border-white/10 bg-white/[0.02] p-8 sm:p-12">
            <h2 className="display-heading text-display-md">What we do with your photographs</h2>
            <ul className="mt-8 grid gap-x-12 gap-y-5 leading-relaxed text-bone-400 sm:grid-cols-2">
              <li>
                They are not held in public buckets and are never exposed through permanent public
                URLs. Access is authorised and time-limited.
              </li>
              <li>
                They are available to you and to authorised production staff, through short-lived
                links that are re-authorised every time they are used.
              </li>
              <li>
                We ask you to confirm you are the person shown, or that you have their permission.
                This service is for consenting adults only.
              </li>
              <li>
                Your film only appears in our gallery if you separately opt in. That permission is
                off by default, and every piece in the gallery today is a concept we created
                ourselves.
              </li>
            </ul>
          </div>

          <div className="mt-20 text-center">
            <Button asChild size="xl" variant="accent">
              <Link href="/create">
                Create My Video
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </Container>
      </section>
    </>
  );
}
