import Link from 'next/link';
import { Container } from '@/components/site/container';
import { Button } from '@/components/ui/button';
import { Wordmark } from '@/components/site/wordmark';

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col surface-glow">
      <header className="border-b border-white/8">
        <Container className="flex h-16 items-center">
          <Wordmark />
        </Container>
      </header>

      <main id="main" className="flex flex-1 items-center">
        <Container className="py-24 text-center">
          <p className="eyebrow">404</p>
          <h1 className="mt-6 display-heading text-[clamp(2rem,6vw,3.5rem)]">
            We could not find that.
          </h1>
          <p className="mx-auto mt-5 max-w-md leading-relaxed text-bone-400">
            The page may have moved, or the project may not be yours to view.
          </p>
          <div className="mt-10 flex flex-col justify-center gap-3 sm:flex-row">
            <Button asChild variant="accent">
              <Link href="/">Back to home</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/dashboard">Go to your dashboard</Link>
            </Button>
          </div>
        </Container>
      </main>
    </div>
  );
}
