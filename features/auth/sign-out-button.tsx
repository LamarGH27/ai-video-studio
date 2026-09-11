import { Button } from '@/components/ui/button';

/**
 * Sign out is a POST form, not a link — see app/auth/sign-out/route.ts.
 * Works without JavaScript.
 */
export function SignOutButton({ className }: { className?: string }) {
  return (
    <form action="/auth/sign-out" method="post" className={className}>
      <Button type="submit" variant="ghost" size="sm">
        Sign out
      </Button>
    </form>
  );
}
