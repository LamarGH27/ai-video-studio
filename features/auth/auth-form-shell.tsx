import * as React from 'react';

export function AuthFormShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="rounded-panel border border-white/10 bg-white/[0.02] p-8 sm:p-10">
      <h1 className="display-heading text-3xl">{title}</h1>
      <p className="mt-3 text-sm leading-relaxed text-bone-400">{description}</p>
      <div className="mt-8">{children}</div>
      {footer ? <div className="mt-8 border-t border-white/8 pt-6 text-sm">{footer}</div> : null}
    </div>
  );
}

export function SubmitHint({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-bone-400">{children}</p>;
}
