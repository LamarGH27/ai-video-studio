import { Container } from '@/components/site/container';

export default function DashboardLoading() {
  return (
    <Container className="py-14 sm:py-20">
      <div className="animate-pulse space-y-10" aria-hidden="true">
        <div className="space-y-4">
          <div className="h-3 w-28 rounded bg-white/8" />
          <div className="h-10 w-80 max-w-full rounded bg-white/8" />
        </div>
        <div className="space-y-4">
          {[0, 1, 2].map((index) => (
            <div key={index} className="h-32 rounded-panel bg-white/5" />
          ))}
        </div>
      </div>
      <p className="sr-only" role="status">
        Loading your projects
      </p>
    </Container>
  );
}
