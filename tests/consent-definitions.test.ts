import { describe, expect, it } from 'vitest';
import {
  CONSENT_DEFINITIONS,
  CONSENT_WORDING_VERSION,
  REQUIRED_CONSENT_TYPES,
  consentLabel,
  consentStatement,
} from '@/lib/consent/definitions';

describe('consent definitions', () => {
  it('versions the wording so a historical record stays accurate', () => {
    expect(CONSENT_WORDING_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('marks likeness permission and AI processing as required', () => {
    expect(REQUIRED_CONSENT_TYPES).toEqual(['HAS_LIKENESS_PERMISSION', 'AI_PROCESSING_CONSENT']);
  });

  // Pre-selecting a permission to publish someone's likeness is not consent.
  it('never pre-selects any consent, and keeps portfolio permission optional', () => {
    for (const definition of CONSENT_DEFINITIONS) {
      expect(definition.defaultValue).toBe(false);
    }

    const portfolio = CONSENT_DEFINITIONS.find(
      (definition) => definition.type === 'PORTFOLIO_PERMISSION',
    );
    expect(portfolio?.required).toBe(false);
  });

  it('carries the exact wording the customer is shown', () => {
    expect(consentStatement('HAS_LIKENESS_PERMISSION')).toBe(
      'I confirm that I am the person shown in these images, or I have permission from the person shown to use their likeness for this service.',
    );
    expect(consentStatement('AI_PROCESSING_CONSENT')).toBe(
      'I consent to these images being processed for the purpose of creating the requested AI-generated media.',
    );
    expect(consentStatement('PORTFOLIO_PERMISSION')).toBe(
      'I give permission for the finished video to be displayed publicly in the Scenelio portfolio.',
    );
  });

  it('has a unique type and form field per definition', () => {
    const types = CONSENT_DEFINITIONS.map((definition) => definition.type);
    const fields = CONSENT_DEFINITIONS.map((definition) => definition.field);
    expect(new Set(types).size).toBe(types.length);
    expect(new Set(fields).size).toBe(fields.length);
  });

  it('labels every consent type', () => {
    for (const definition of CONSENT_DEFINITIONS) {
      expect(consentLabel(definition.type)).toBeTruthy();
    }
  });
});
