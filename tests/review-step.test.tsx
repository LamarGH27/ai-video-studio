/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReviewStep } from '@/features/create-project/steps/review-step';
import { CONSENT_DEFINITIONS } from '@/lib/consent/definitions';
import type { DraftValues, UploadedAsset } from '@/features/create-project/types';

const values: DraftValues = {
  experienceSlug: 'luxury-lifestyle',
  brief: 'A walk through a berthed yacht in Monaco at golden hour, confident and unhurried.',
  mood: 'Confident',
  environment: 'Monaco harbour',
  wardrobeStyle: 'Linen summer suit',
  orientation: 'VERTICAL_9_16',
  desiredDurationSeconds: 15,
  specialRequirements: '',
  preserveRequirements: 'Do not alter my hairline',
};

const experience = {
  id: 'b2f1a0d4-0000-4000-8000-000000000001',
  slug: 'luxury-lifestyle',
  name: 'Luxury Lifestyle',
  description: 'Yachts, penthouses and private terraces.',
  category: 'LUXURY_LIFESTYLE' as const,
  sortOrder: 10,
};

const assets: UploadedAsset[] = [
  {
    assetId: 'asset-1',
    storagePath: 'user/project/one.jpg',
    originalFilename: 'one.jpg',
    fileSize: 120_000,
    mimeType: 'image/jpeg',
    previewUrl: null,
  },
];

function renderStep(onSubmit = vi.fn()) {
  render(
    <ReviewStep
      values={values}
      experience={experience}
      assets={assets}
      publicReference="AVS-000123"
      onBack={vi.fn()}
      onSubmit={onSubmit}
      submitting={false}
      error={null}
    />,
  );
  return { onSubmit };
}

function consentCheckbox(
  field: 'has_likeness_permission' | 'ai_processing_consent' | 'portfolio_permission',
) {
  const definition = CONSENT_DEFINITIONS.find((candidate) => candidate.field === field)!;
  return screen.getByRole('checkbox', { name: new RegExp(definition.statement.slice(0, 40), 'i') });
}

/**
 * The consent gate is the commercially and legally important part of this step,
 * so it is tested through the rendered UI rather than only through the schema.
 */
describe('ReviewStep consent gate', () => {
  it('shows the submitted brief and the chosen experience for review', () => {
    renderStep();
    expect(screen.getByText(values.brief)).toBeInTheDocument();
    expect(screen.getByText(/Luxury Lifestyle/)).toBeInTheDocument();
    expect(screen.getByText('AVS-000123')).toBeInTheDocument();
  });

  it('never pre-selects any consent, portfolio permission least of all', () => {
    renderStep();
    expect(consentCheckbox('has_likeness_permission')).not.toBeChecked();
    expect(consentCheckbox('ai_processing_consent')).not.toBeChecked();
    expect(consentCheckbox('portfolio_permission')).not.toBeChecked();
  });

  it('refuses to submit until both required consents are given', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderStep();

    await user.click(screen.getByRole('button', { name: /submit project/i }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent(/required confirmations/i);

    await user.click(consentCheckbox('has_likeness_permission'));
    await user.click(screen.getByRole('button', { name: /submit project/i }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits with portfolio permission false when it was left untouched', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderStep();

    await user.click(consentCheckbox('has_likeness_permission'));
    await user.click(consentCheckbox('ai_processing_consent'));
    await user.click(screen.getByRole('button', { name: /submit project/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      hasLikenessPermission: true,
      aiProcessingConsent: true,
      portfolioPermission: false,
    });
  });

  it('passes portfolio permission through when it is opted into', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderStep();

    await user.click(consentCheckbox('has_likeness_permission'));
    await user.click(consentCheckbox('ai_processing_consent'));
    await user.click(consentCheckbox('portfolio_permission'));
    await user.click(screen.getByRole('button', { name: /submit project/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      hasLikenessPermission: true,
      aiProcessingConsent: true,
      portfolioPermission: true,
    });
  });
});
