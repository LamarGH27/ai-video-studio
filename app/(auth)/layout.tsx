import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Container } from '@/components/site/container';
import { Wordmark } from '@/components/site/wordmark';
import { PortfolioFrame } from '@/features/portfolio/frame';
import { brand } from '@/lib/brand';

/**
 * Sign-in and sign-up.
 *
 * The form is the point, so it keeps the left column and the full width of a
 * phone. The panel beside it is a brand statement, not a hero: it appears only
 * from `lg` up, where there is room to spare, and it is `aria-hidden` because
 * it repeats nothing a screen reader needs and adds nothing to the task.
 *
 * Deliberately no decoration between a person and the fields: no carousel, no
 * animated background behind the inputs, no JavaScript this page did not
 * already need.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[1fr_minmax(0,38rem)]">
      {/* ------------------------------------------------------------- form */}
      <div className="flex min-h-dvh flex-col surface-glow lg:min-h-0">
        <header className="border-b border-white/8">
          <Container className="flex h-[4.5rem] items-center justify-between gap-4">
            <Wordmark />
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-sm text-bone-500 transition-colors hover:text-bone-200"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              Back to site
            </Link>
          </Container>
        </header>

        <main id="main" className="flex flex-1 items-center justify-center px-5 py-14 sm:py-20">
          <div className="w-full max-w-md">{children}</div>
        </main>
      </div>

      {/* -------------------------------------------------- brand statement */}
      <aside
        aria-hidden="true"
        className="relative hidden overflow-hidden border-l border-white/8 lg:block"
      >
        <PortfolioFrame
          seed="auth-panel"
          title=""
          category="CINEMATIC"
          showLabel={false}
          className="absolute inset-0 motion-safe:animate-drift"
        />
        <div className="grain-layer" />

        <div className="relative flex h-full flex-col justify-end p-12 xl:p-16">
          <p className="max-w-md display-heading text-[clamp(2rem,3vw,2.75rem)] text-balance">
            {brand.tagline}
          </p>
          <p className="mt-6 max-w-sm leading-relaxed text-bone-400">{brand.proposition}</p>
        </div>
      </aside>
    </div>
  );
}
