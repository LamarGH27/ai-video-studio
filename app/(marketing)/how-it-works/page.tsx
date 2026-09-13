import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowRight } from 'lucide-react';
import { Container } from '@/components/site/container';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { REFERENCE_IMAGE_RULES } from '@/lib/validation/project';

export const metadata: Metadata = {
  title: 'How It Works',
  description: 'From choosing an experience to receiving your finished cinematic film.',
};

const STEPS = [
  {
    number: '01',
    title: 'Choose your experience',
    body: 'Start from a production approach — luxury lifestyle, fashion, cinematic, travel and more — or bring a custom concept with no template behind it.',
    available: true,
  },
  {
    number: '02',
    title: 'Upload your photos',
    body: `Up to ${REFERENCE_IMAGE_RULES.max} clear reference images. They are stored privately, are never published, and are only ever viewed by the producer working on your brief.`,
    available: true,
  },
  {
    number: '03',
    title: 'Describe your vision',
    body: 'Mood, location, wardrobe, orientation, length — and anything that must not change. The more specific the brief, the closer the first cut lands.',
    available: true,
  },
  {
    number: '04',
    title: 'Production begins',
    body: 'A producer reviews your brief and reference images, confirms they are usable, and starts building your film. You can follow the status from your dashboard.',
    available: false,
  },
  {
    number: '05',
    title: 'Receive your finished video',
    body: 'A preview cut arrives first so you can request revisions. Once you are happy, the final film is delivered through your dashboard.',
    available: false,
  },
] as const;

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
          <ol className="space-y-0">
            {STEPS.map((step) => (
              <li
                key={step.number}
                className="grid reveal gap-5 py-10 rule-top sm:grid-cols-12 sm:gap-8 sm:py-14"
              >
                <p className="figure-mark sm:col-span-2">{step.number}</p>
                <div className="sm:col-span-6">
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="display-heading text-2xl sm:text-3xl">{step.title}</h2>
                    {step.available ? null : (
                      <Badge className="border-brass-400/25 bg-brass-400/10 text-brass-200">
                        Coming soon
                      </Badge>
                    )}
                  </div>
                </div>
                <p className="leading-relaxed text-bone-400 sm:col-span-4">{step.body}</p>
              </li>
            ))}
          </ol>

          <div className="mt-20 rounded-panel border border-white/10 bg-white/[0.02] p-8 sm:p-12">
            <h2 className="display-heading text-display-md">What we do with your photographs</h2>
            <ul className="mt-8 grid gap-x-12 gap-y-5 leading-relaxed text-bone-400 sm:grid-cols-2">
              <li>
                They are stored in private storage. There is no public link to them, and none can be
                created.
              </li>
              <li>
                They are shown to you and to the producer assigned to your project, through
                short-lived authorised links.
              </li>
              <li>
                We ask you to confirm you are the person shown, or that you have their permission.
                This service is for consenting adults only.
              </li>
              <li>
                Your film only appears in our portfolio if you separately opt in. That permission is
                off by default.
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
