/**
 * The one email document.
 *
 * Every message is this layout with different words in it. Email clients are
 * the least forgiving rendering targets in use — no external stylesheets, no
 * <style> in some clients, patchy flexbox, Outlook's table model — so this is a
 * single-column table with inline styles, and it is written once here rather
 * than copied into eight files that then drift.
 *
 * Deliberately not a design system: a dark band, a rule, a button, a footer.
 * Enough to look like the product, little enough to survive Gmail's sanitiser.
 */

export interface EmailLayoutOptions {
  /** The <title> and the visible heading. */
  heading: string;
  /** Shown in the inbox preview line, after the subject. */
  preheader: string;
  /** Body paragraphs, plain sentences — no markup. */
  paragraphs: readonly string[];
  cta: { label: string; url: string };
  /** The customer-facing project reference, e.g. AVS-000123. */
  reference: string;
  /** An optional closing line under the button. */
  footnote?: string;
}

const BRAND = 'AI Video Studio';

/** Emails are read by strangers' software; everything interpolated is escaped. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const INK = '#12110f';
const PAPER = '#faf8f5';
const BODY = '#3a3733';
const MUTED = '#6f6a63';
const BRASS = '#b08d42';

export function renderEmailLayout(options: EmailLayoutOptions): { html: string; text: string } {
  const { heading, preheader, paragraphs, cta, reference, footnote } = options;

  const paragraphHtml = paragraphs
    .map(
      (paragraph) =>
        `<p style="margin:0 0 16px;font-size:16px;line-height:1.65;color:${BODY};">${escapeHtml(paragraph)}</p>`,
    )
    .join('');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background:${PAPER};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e7e2da;border-radius:14px;overflow:hidden;">

<tr><td style="background:${INK};padding:22px 32px;">
<span style="font-size:15px;letter-spacing:.14em;text-transform:uppercase;color:${PAPER};font-family:Georgia,'Times New Roman',serif;">${BRAND}</span>
</td></tr>

<tr><td style="padding:34px 32px 8px;">
<h1 style="margin:0 0 18px;font-size:24px;line-height:1.3;color:${INK};font-family:Georgia,'Times New Roman',serif;font-weight:normal;">${escapeHtml(heading)}</h1>
${paragraphHtml}
</td></tr>

<tr><td style="padding:8px 32px 28px;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="background:${INK};border-radius:999px;">
<a href="${escapeHtml(cta.url)}" style="display:inline-block;padding:13px 26px;font-size:15px;color:${PAPER};text-decoration:none;font-weight:600;">${escapeHtml(cta.label)}</a>
</td></tr></table>
${footnote ? `<p style="margin:18px 0 0;font-size:14px;line-height:1.6;color:${MUTED};">${escapeHtml(footnote)}</p>` : ''}
</td></tr>

<tr><td style="padding:0 32px;"><div style="height:1px;background:#eee9e1;"></div></td></tr>

<tr><td style="padding:20px 32px 30px;">
<p style="margin:0 0 6px;font-size:13px;color:${MUTED};">Project reference <strong style="color:${BRASS};">${escapeHtml(reference)}</strong></p>
<p style="margin:0;font-size:13px;line-height:1.6;color:${MUTED};">Quote this reference if you reply to us. You are receiving this because you have a project with ${BRAND} — it is a service message, not marketing.</p>
</td></tr>

</table>
</td></tr></table>
</body>
</html>`;

  const text = [
    BRAND.toUpperCase(),
    '',
    heading,
    '',
    ...paragraphs.flatMap((paragraph) => [paragraph, '']),
    `${cta.label}: ${cta.url}`,
    ...(footnote ? ['', footnote] : []),
    '',
    `Project reference ${reference}`,
    'Quote this reference if you reply to us. This is a service message, not marketing.',
    '',
  ].join('\n');

  return { html, text };
}
