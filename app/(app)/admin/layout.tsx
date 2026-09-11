import { requireAdmin } from '@/lib/auth/session';

/**
 * Server-side gate for the whole admin area.
 *
 * Every /admin route renders inside this layout, so the role check runs before
 * any admin page does. The middleware only guarantees the caller is signed in;
 * this is where privilege is checked, against the database.
 *
 * Hiding the nav link is not access control and is not relied on here.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return <>{children}</>;
}
