import { Container } from '@/components/site/container';
import { Wordmark } from '@/components/site/wordmark';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col surface-glow">
      <header className="border-b border-white/8">
        <Container className="flex h-16 items-center">
          <Wordmark />
        </Container>
      </header>

      <main id="main" className="flex flex-1 items-center justify-center px-5 py-12 sm:py-20">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
