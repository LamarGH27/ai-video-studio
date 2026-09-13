import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * The standard way a section introduces itself: an eyebrow, a display line, and
 * optionally a supporting paragraph set off to the side.
 *
 * Asymmetric by default — the heading takes the left two thirds and the
 * supporting copy sits low and right, the way a magazine sets a standfirst.
 * That single decision is most of what stops a page of sections looking like a
 * page of centred hero blocks.
 *
 * `as` exists because heading LEVEL is a document-structure decision and must
 * not be dictated by how large the text looks.
 */
export function SectionHeading({
  eyebrow,
  title,
  lede,
  action,
  as: Heading = 'h2',
  align = 'split',
  id,
  className,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  lede?: React.ReactNode;
  action?: React.ReactNode;
  as?: 'h1' | 'h2' | 'h3';
  align?: 'split' | 'center';
  id?: string;
  className?: string;
}) {
  if (align === 'center') {
    return (
      <div className={cn('mx-auto max-w-3xl text-center', className)}>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <Heading id={id} className="mt-5 display-heading text-display-lg">
          {title}
        </Heading>
        {lede ? <p className="mx-auto mt-6 max-w-xl lede">{lede}</p> : null}
        {action ? <div className="mt-9 flex justify-center">{action}</div> : null}
      </div>
    );
  }

  return (
    <div className={cn('grid gap-8 lg:grid-cols-12 lg:items-end lg:gap-12', className)}>
      <div className="lg:col-span-7">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <Heading id={id} className="mt-5 display-heading text-display-lg text-balance">
          {title}
        </Heading>
      </div>

      {lede || action ? (
        <div className="lg:col-span-4 lg:col-start-9">
          {lede ? <p className="leading-relaxed text-bone-400">{lede}</p> : null}
          {action ? <div className="mt-6">{action}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
