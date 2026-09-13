import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowRight, Check } from 'lucide-react';
import { Container } from '@/components/site/container';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { PLACEHOLDER_PACKAGES } from '@/lib/catalog/pricing';
import { cn } from '@/lib/utils';

export const metadata: Metadata = {
  title: 'Pricing',
  description: 'Provisional package structure for AI Video Studio commissions.',
};

export default function PricingPage() {
  return (
    <>
      <section className="border-b border-white/8 surface-glow">
        <Container className="py-20 sm:py-28">
          <p className="eyebrow">Pricing</p>
          <h1 className="mt-6 max-w-3xl display-heading text-[clamp(2.25rem,6vw,4rem)]">
            Three ways to commission.
          </h1>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-bone-400">
            Packages differ by length, number of revisions and how much production attention your
            brief gets.
          </p>
        </Container>
      </section>

      <section className="py-16 sm:py-20">
        <Container>
          <Alert tone="info" title="Provisional pricing">
            These packages are placeholder content for the current build. Nothing here is a
            commercial offer, no payment is taken, and the structure and figures will change before
            launch.
          </Alert>

          <ul className="mt-12 grid gap-6 lg:grid-cols-3">
            {PLACEHOLDER_PACKAGES.map((tier) => (
              <li key={tier.slug}>
                <div
                  className={cn(
                    'flex h-full flex-col rounded-panel border p-8',
                    tier.highlighted
                      ? 'border-brass-400/40 bg-brass-400/[0.04]'
                      : 'border-white/10 bg-white/[0.02]',
                  )}
                >
                  <div className="flex items-center justify-between gap-4">
                    <h2 className="display-heading text-2xl">{tier.name}</h2>
                    {tier.highlighted ? (
                      <span className="rounded-full border border-brass-400/30 px-2.5 py-1 text-[0.65rem] tracking-[0.18em] text-brass-200 uppercase">
                        Most chosen
                      </span>
                    ) : null}
                  </div>

                  <p className="mt-4 text-sm leading-relaxed text-bone-400">{tier.summary}</p>

                  <p className="mt-8 flex items-baseline gap-2">
                    <span className="display-heading text-4xl">{tier.indicativePrice}</span>
                    <span className="text-xs tracking-wide text-bone-400/70 uppercase">
                      indicative
                    </span>
                  </p>

                  <ul className="mt-8 flex-1 space-y-3 text-sm text-bone-300">
                    {tier.includes.map((line) => (
                      <li key={line} className="flex gap-3">
                        <Check
                          className="mt-0.5 size-4 shrink-0 text-brass-300"
                          aria-hidden="true"
                        />
                        <span className="leading-relaxed">{line}</span>
                      </li>
                    ))}
                  </ul>

                  <Button
                    asChild
                    variant={tier.highlighted ? 'accent' : 'outline'}
                    className="mt-10 w-full"
                  >
                    <Link href="/create">Start a brief</Link>
                  </Button>
                </div>
              </li>
            ))}
          </ul>

          <p className="mt-10 text-sm text-bone-400">
            Payment is not part of the current release. Submitting a brief costs nothing and commits
            you to nothing.
          </p>

          <div className="mt-16 text-center">
            <Button asChild variant="link">
              <Link href="/how-it-works">
                See how a commission works
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </Container>
      </section>
    </>
  );
}
