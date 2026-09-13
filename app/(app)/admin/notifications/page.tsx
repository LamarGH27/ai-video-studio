import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowLeft, BellOff } from 'lucide-react';
import { Container } from '@/components/site/container';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { EmptyState } from '@/components/ui/empty-state';
import { NotificationRetryButton } from '@/features/admin/notification-retry-button';
import {
  getNotificationSummary,
  isDeadLettered,
  listRecentNotifications,
  notificationStatusTone,
} from '@/lib/data/notifications';
import { formatDateTime } from '@/lib/utils';

export const metadata: Metadata = {
  title: 'Notifications',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * Operational health of the notification queue.
 *
 * Answers the questions that matter when a customer says "I never got an
 * email": what was supposed to send, to whom, for which project, when, how many
 * times was it attempted, did it succeed, and what did the provider say when it
 * did not.
 *
 * It shows the recipient address because that is the first thing to check, and
 * it is a staff-only page behind the admin layout's role gate and an RLS policy.
 * It deliberately shows no message body — the content is reconstructible from
 * the event type, and storing or displaying rendered copy would put a
 * customer's project details into an operations screen that does not need them.
 */

const TONE_CLASS = {
  ok: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
  warn: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
  bad: 'border-rose-400/35 bg-rose-500/10 text-rose-200',
  muted: 'border-white/15 bg-white/5 text-bone-300',
} as const;

function EventLabel({ eventType }: { eventType: string }) {
  // PROJECT_SUBMITTED_CUSTOMER -> "Project submitted · customer"
  const parts = eventType.toLowerCase().split('_');
  const audience = parts.at(-1);
  const rest = parts.slice(0, -1).join(' ');
  return (
    <span>
      {rest.charAt(0).toUpperCase() + rest.slice(1)}
      <span className="text-bone-400/70"> · {audience}</span>
    </span>
  );
}

export default async function AdminNotificationsPage() {
  const [summary, notifications] = await Promise.all([
    getNotificationSummary(),
    listRecentNotifications(50),
  ]);

  const stats = [
    { label: 'Queued', value: summary.pending },
    { label: 'In flight', value: summary.processing },
    { label: 'Retrying', value: summary.retrying },
    { label: 'Needs attention', value: summary.deadLettered },
    { label: 'Sent (24h)', value: summary.sentLast24h },
  ];

  return (
    <Container className="py-14 sm:py-20">
      <Button asChild variant="ghost" size="sm" className="-ml-4">
        <Link href="/admin">
          <ArrowLeft aria-hidden="true" />
          Production queue
        </Link>
      </Button>

      <header className="mt-8">
        <p className="eyebrow">Admin</p>
        <h1 className="mt-5 display-heading text-[clamp(2rem,5vw,3rem)]">Notifications</h1>
        <p className="mt-4 max-w-xl leading-relaxed text-bone-400">
          Transactional email is queued when a project changes and sent by a scheduled worker, so a
          provider outage never affects a project. This is that queue.
        </p>
      </header>

      <section aria-label="Queue health" className="mt-10">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="rounded-panel border border-white/10 bg-white/[0.02] p-4"
            >
              <dt className="text-xs tracking-wide text-bone-400/70 uppercase">{stat.label}</dt>
              <dd className="mt-2 display-heading text-2xl">{stat.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {summary.deadLettered > 0 ? (
        <Alert tone="error" title="Some notifications have stopped retrying" className="mt-8">
          <p className="leading-relaxed">
            These used their full attempt budget. Check the last error, fix the cause, then retry —
            retrying reuses the same queue entry, so nobody receives a duplicate.
          </p>
        </Alert>
      ) : null}

      <section aria-labelledby="recent-heading" className="mt-12">
        <h2
          id="recent-heading"
          className="text-sm font-medium tracking-wide text-bone-400 uppercase"
        >
          Recent notifications
        </h2>

        {notifications.length === 0 ? (
          <EmptyState
            className="mt-6"
            icon={<BellOff className="size-8" aria-hidden="true" />}
            title="Nothing queued yet"
            description="Notifications appear here as soon as a project is submitted, delivered or decided on."
          />
        ) : (
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[64rem] border-collapse text-left text-sm">
              <caption className="sr-only">The 50 most recent transactional emails</caption>
              <thead>
                <tr className="border-b border-white/10 text-xs tracking-wide text-bone-400 uppercase">
                  <th scope="col" className="py-3 pr-4 font-medium">
                    Event
                  </th>
                  <th scope="col" className="py-3 pr-4 font-medium">
                    Project
                  </th>
                  <th scope="col" className="py-3 pr-4 font-medium">
                    Recipient
                  </th>
                  <th scope="col" className="py-3 pr-4 font-medium">
                    Status
                  </th>
                  <th scope="col" className="py-3 pr-4 font-medium">
                    Attempts
                  </th>
                  <th scope="col" className="py-3 pr-4 font-medium">
                    Created
                  </th>
                  <th scope="col" className="py-3 pr-4 font-medium">
                    Sent
                  </th>
                  <th scope="col" className="py-3 pr-4 font-medium">
                    Last error
                  </th>
                  <th scope="col" className="py-3 font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {notifications.map((notification) => {
                  const tone = notificationStatusTone(
                    notification.status,
                    notification.next_attempt_at,
                  );
                  const dead = isDeadLettered(notification);

                  return (
                    <tr key={notification.id} className="border-b border-white/5 align-top">
                      <td className="py-4 pr-4">
                        <EventLabel eventType={notification.event_type} />
                      </td>
                      <td className="py-4 pr-4">
                        {notification.project_id ? (
                          <Link
                            href={`/admin/projects/${notification.project_id}`}
                            className="text-brass-300 underline-offset-4 hover:underline"
                          >
                            {notification.projectReference ?? 'Open'}
                          </Link>
                        ) : (
                          <span className="text-bone-400/70">—</span>
                        )}
                      </td>
                      <td className="text-bone-300 py-4 pr-4">
                        {notification.recipient === 'ADMIN'
                          ? 'Studio team'
                          : (notification.recipient_email ?? '—')}
                      </td>
                      <td className="py-4 pr-4">
                        <Badge className={TONE_CLASS[tone]}>
                          {dead ? 'Stopped' : notification.status.toLowerCase()}
                        </Badge>
                      </td>
                      <td className="text-bone-300 py-4 pr-4">{notification.attempt_count}</td>
                      <td className="py-4 pr-4 text-bone-400/80">
                        {formatDateTime(notification.created_at)}
                      </td>
                      <td className="py-4 pr-4 text-bone-400/80">
                        {notification.sent_at ? formatDateTime(notification.sent_at) : '—'}
                      </td>
                      <td className="max-w-[22rem] py-4 pr-4 text-xs leading-relaxed text-bone-400/80">
                        {notification.last_error ?? '—'}
                      </td>
                      <td className="py-4">
                        {dead ? <NotificationRetryButton notificationId={notification.id} /> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Container>
  );
}
