import type { ProjectOrientation } from '@/types/database';

/** Everything the wizard holds for steps 1 and 2. */
export interface DraftValues {
  experienceSlug: string | null;
  brief: string;
  mood: string;
  environment: string;
  wardrobeStyle: string;
  orientation: ProjectOrientation | null;
  desiredDurationSeconds: number;
  specialRequirements: string;
  preserveRequirements: string;
}

export const EMPTY_DRAFT: DraftValues = {
  experienceSlug: null,
  brief: '',
  mood: '',
  environment: '',
  wardrobeStyle: '',
  orientation: null,
  desiredDurationSeconds: 15,
  specialRequirements: '',
  preserveRequirements: '',
};

/** A reference image that has been uploaded and recorded. */
export interface UploadedAsset {
  assetId: string;
  storagePath: string;
  originalFilename: string;
  fileSize: number;
  mimeType: string;
  /** Short-lived signed URL, or a local object URL for one just uploaded. */
  previewUrl: string | null;
}

export const WIZARD_STEPS = [
  { id: 1, label: 'Your idea', hint: 'The kind of film' },
  { id: 2, label: 'Your vision', hint: 'Where, what, the mood' },
  { id: 3, label: 'Your photos', hint: 'Reference images' },
  { id: 4, label: 'Review', hint: 'Check and send' },
] as const;

export type WizardStepId = (typeof WIZARD_STEPS)[number]['id'];
