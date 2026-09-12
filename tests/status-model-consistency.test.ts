import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALLOWED_STATUS_TRANSITIONS, PROJECT_STATUS_ORDER } from '@/lib/projects/status';
import type { ProjectStatus } from '@/types/database';

/**
 * The status model exists twice: as SQL, where it is enforced, and as
 * TypeScript, where it decides what to render. Two copies of a security rule
 * drift, and the drift is silent — the buttons would keep working while the
 * database quietly rejected them, or worse, the buttons would offer something
 * the database allows but the product should not.
 *
 * So this test reads the migrations and compares them to the TypeScript. It is
 * the reason `lib/projects/status.ts` is safe to trust for rendering.
 *
 * Parsing SQL with regular expressions is normally a poor idea. Here the target
 * is a fixed, hand-written CASE block in a file this repository controls, and
 * the alternative — running Postgres inside the unit suite — costs far more
 * than it returns. If the parse ever finds nothing, the test fails loudly
 * rather than passing vacuously.
 */

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations');

function read(file: string): string {
  return readFileSync(join(MIGRATIONS, file), 'utf8');
}

/** Enum values in declaration order, across the initial schema plus any later ALTER TYPE. */
function parseEnumValues(): ProjectStatus[] {
  const initial = read('20260101000000_initial_schema.sql');
  const block = /create type public\.project_status as enum \(([\s\S]*?)\);/.exec(initial);
  expect(block, 'project_status enum not found in the initial migration').not.toBeNull();

  const values = [...block![1]!.matchAll(/'([A-Z_]+)'/g)].map((match) => match[1] as ProjectStatus);
  expect(values.length).toBeGreaterThan(0);

  // Later migrations may append. `AFTER 'X'` places the value directly after X.
  const added = read('20260101000500_add_finalising_status.sql');
  const alter = /add value if not exists '([A-Z_]+)'(?:\s+after\s+'([A-Z_]+)')?/i.exec(added);
  expect(alter, 'ALTER TYPE ... ADD VALUE not found in migration 000500').not.toBeNull();

  const newValue = alter![1] as ProjectStatus;
  const afterValue = alter![2] as ProjectStatus | undefined;

  if (afterValue) {
    values.splice(values.indexOf(afterValue) + 1, 0, newValue);
  } else {
    values.push(newValue);
  }

  return values;
}

/** The `when 'X' then array[...]` rows of allowed_status_transitions(). */
function parseSqlTransitions(): Record<string, string[]> {
  const migration = read('20260101000600_delivery_workflow.sql');
  const fn =
    /create or replace function public\.allowed_status_transitions[\s\S]*?select case from_status([\s\S]*?)end::public\.project_status\[\];/.exec(
      migration,
    );
  expect(fn, 'allowed_status_transitions() not found in migration 000600').not.toBeNull();

  const table: Record<string, string[]> = {};
  for (const row of fn![1]!.matchAll(/when\s+'([A-Z_]+)'\s+then\s+array\[([^\]]*)\]/g)) {
    const from = row[1]!;
    const targets = [...row[2]!.matchAll(/'([A-Z_]+)'/g)].map((match) => match[1]!);
    table[from] = targets;
  }

  expect(
    Object.keys(table).length,
    'parsed no transitions — the CASE shape must have changed',
  ).toBeGreaterThan(0);
  return table;
}

const sqlEnumValues = parseEnumValues();
const sqlTransitions = parseSqlTransitions();

describe('project_status: SQL and TypeScript agree', () => {
  it('has FINALISING, added by its own migration so it commits before use', () => {
    expect(sqlEnumValues).toContain('FINALISING');
    expect(PROJECT_STATUS_ORDER).toContain('FINALISING');

    // Migration 000500 must contain exactly one statement. A new enum value
    // cannot be used in the transaction that added it, so anything else in that
    // file would make migration 000600 unapplyable.
    const migration = read('20260101000500_add_finalising_status.sql')
      .split('\n')
      .filter((line) => line.trim().length > 0 && !line.trim().startsWith('--'))
      .join(' ');
    expect(migration.match(/;/g) ?? []).toHaveLength(1);
    expect(migration).toMatch(/alter type public\.project_status add value/i);
  });

  it('declares the same statuses, in the same order', () => {
    expect(PROJECT_STATUS_ORDER).toEqual(sqlEnumValues);
  });
});

describe('the workflow: SQL and TypeScript agree', () => {
  it('covers every status on both sides', () => {
    const sqlSources = new Set(Object.keys(sqlTransitions));
    for (const status of PROJECT_STATUS_ORDER) {
      // COMPLETED and CANCELLED fall through to the `else` branch, which is the
      // empty array — they are final.
      const expected = sqlSources.has(status) ? sqlTransitions[status]! : [];
      expect(
        [...ALLOWED_STATUS_TRANSITIONS[status]].sort(),
        `transitions out of ${status} differ between the migration and lib/projects/status.ts`,
      ).toEqual([...expected].sort());
    }
  });

  it('names only statuses that exist, and never a self-transition', () => {
    for (const [from, targets] of Object.entries(sqlTransitions)) {
      expect(sqlEnumValues).toContain(from as ProjectStatus);
      for (const to of targets) {
        expect(sqlEnumValues).toContain(to as ProjectStatus);
        expect(to).not.toBe(from);
      }
    }
  });

  it('routes approval through FINALISING rather than straight to COMPLETED', () => {
    expect(sqlTransitions['PREVIEW_READY']).toContain('FINALISING');
    expect(sqlTransitions['PREVIEW_READY']).not.toContain('COMPLETED');
    expect(sqlTransitions['FINALISING']).toContain('COMPLETED');
  });

  it('answers a revision with a new preview rather than reinstating the old one', () => {
    // REVISION_REQUESTED -> PREVIEW_READY would return the customer to the very
    // preview they rejected, and the auto-resolve trigger would mark the
    // revision answered. Rework has to pass through production.
    expect(sqlTransitions['REVISION_REQUESTED']).toContain('IN_PRODUCTION');
    expect(sqlTransitions['REVISION_REQUESTED']).not.toContain('PREVIEW_READY');
  });

  it('never returns a submitted project to DRAFT', () => {
    for (const targets of Object.values(sqlTransitions)) {
      expect(targets).not.toContain('DRAFT');
    }
  });

  it('treats COMPLETED and CANCELLED as final', () => {
    expect(ALLOWED_STATUS_TRANSITIONS.COMPLETED).toHaveLength(0);
    expect(ALLOWED_STATUS_TRANSITIONS.CANCELLED).toHaveLength(0);
    expect(sqlTransitions['COMPLETED']).toBeUndefined();
    expect(sqlTransitions['CANCELLED']).toBeUndefined();
  });
});
