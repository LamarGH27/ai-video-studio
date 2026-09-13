import * as React from 'react';
import { ShieldCheck } from 'lucide-react';

/**
 * The frame every authentication form sits in.
 *
 * No card: a bordered box around a form on an already-dark page adds a line and
 * takes away air. The heading carries the weight instead.
 *
 * `reassurance` is for the two screens where someone is about to hand us
 * something — an account, a new password. It is one plain sentence rather than
 * a lock icon and a security claim.
 */
export function AuthFormShell({
  title,
  description,
  reassurance,
  children,
  footer,
}: {
  title: string;
  description: string;
  reassurance?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div>
      <h1 className="display-heading text-display-md">{title}</h1>
      <p className="mt-4 leading-relaxed text-bone-400">{description}</p>

      <div className="mt-10">{children}</div>

      {reassurance ? (
        <p className="mt-8 flex gap-3 text-sm leading-relaxed text-bone-500">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brass-300/70" aria-hidden="true" />
          <span>{reassurance}</span>
        </p>
      ) : null}

      {footer ? <div className="mt-10 pt-7 text-sm rule-top">{footer}</div> : null}
    </div>
  );
}

export function SubmitHint({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-bone-500">{children}</p>;
}
