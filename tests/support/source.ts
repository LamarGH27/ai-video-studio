import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

export const readSource = (path: string) => readFileSync(join(ROOT, path), 'utf8');

/**
 * Source with comments removed.
 *
 * Several assertions in these suites are of the form "this file must not
 * contain X", and the comment explaining why X was removed necessarily quotes
 * X. Without this, documenting a fix fails the test for the fix — which has now
 * happened three times: a workflow comment mentioning `--retry`, a privacy
 * comment quoting the line it replaced, and a player comment explaining why
 * there is no `autoPlay` attribute.
 *
 * Only ever use this for negative assertions about what a file says. Positive
 * assertions may read either, but should prefer `readSource` so they are not
 * quietly satisfied by a comment.
 */
export const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

export const prose = (path: string) => stripComments(readSource(path));
