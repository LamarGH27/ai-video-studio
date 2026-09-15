import type { ConsentType } from '@/types/database';

/**
 * Consent wording, versioned.
 *
 * Bump CONSENT_WORDING_VERSION whenever any `statement` below changes in
 * substance. The version in force at the time is written to
 * project_consents.wording_version, so an old record always says exactly what
 * that customer agreed to — the historical text is not overwritten by a copy
 * edit. Keep superseded wording in docs/architecture.md.
 *
 * 2026-09-15 bumped for the rename to Scenelio. The obligation is identical and
 * a rename is not a change of substance, but only the VERSION is stored — the
 * text lives here — so leaving the version alone would have made an existing
 * record silently resolve to wording its signer never read. Bumping costs
 * nothing: nothing gates on the value and no re-consent is triggered by it.
 *
 * This service is for consenting adults only. There is deliberately no
 * workflow, field or code path here for media of a minor.
 */
export const CONSENT_WORDING_VERSION = '2026-09-15';

export interface ConsentDefinition {
  type: ConsentType;
  /** Form field name, matching the Zod schema in lib/validation/project.ts. */
  field: 'has_likeness_permission' | 'ai_processing_consent' | 'portfolio_permission';
  statement: string;
  required: boolean;
  /** Optional consents are never pre-selected. */
  defaultValue: false;
  helpText?: string;
}

export const CONSENT_DEFINITIONS: readonly ConsentDefinition[] = [
  {
    type: 'HAS_LIKENESS_PERMISSION',
    field: 'has_likeness_permission',
    statement:
      'I confirm that I am the person shown in these images, or I have permission from the person shown to use their likeness for this service.',
    required: true,
    defaultValue: false,
    helpText: 'The person shown must be an adult who has agreed to this.',
  },
  {
    type: 'AI_PROCESSING_CONSENT',
    field: 'ai_processing_consent',
    statement:
      'I consent to these images being processed for the purpose of creating the requested AI-generated media.',
    required: true,
    defaultValue: false,
  },
  {
    type: 'PORTFOLIO_PERMISSION',
    field: 'portfolio_permission',
    statement:
      'I give permission for the finished video to be displayed publicly in the Scenelio portfolio.',
    required: false,
    defaultValue: false,
    helpText: 'Entirely optional. Your project goes ahead either way.',
  },
] as const;

export const REQUIRED_CONSENT_TYPES: readonly ConsentType[] = CONSENT_DEFINITIONS.filter(
  (definition) => definition.required,
).map((definition) => definition.type);

export function consentStatement(type: ConsentType): string {
  const definition = CONSENT_DEFINITIONS.find((candidate) => candidate.type === type);
  if (!definition) throw new Error(`Unknown consent type: ${type}`);
  return definition.statement;
}

export function consentLabel(type: ConsentType): string {
  switch (type) {
    case 'HAS_LIKENESS_PERMISSION':
      return 'Likeness permission';
    case 'AI_PROCESSING_CONSENT':
      return 'AI processing consent';
    case 'PORTFOLIO_PERMISSION':
      return 'Portfolio permission';
  }
}
