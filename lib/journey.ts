/**
 * The customer journey, in one place.
 *
 * It was previously told three different ways — the homepage put photos before
 * the brief, How It Works put the experience first and photos second, and the
 * create wizard ran idea → vision → photos → review. A visitor reading two of
 * those pages learns that we do not know our own process.
 *
 * The wizard is the authority, because it is the thing that actually happens.
 * The split below is the other half of the fix: what YOU build is numbered,
 * what WE do afterwards is not, because numbering our work as though it were
 * the customer's to complete is what made the two run together in the first
 * place.
 *
 * Pages may word these differently — a hero has less room than a process page —
 * but they may not reorder them. features/create-project/types.ts holds the
 * wizard's own step labels and is checked against this by
 * tests/journey-consistency.test.ts.
 */

export interface JourneyStep {
  /** Display number. Brief steps only — production stages are not numbered. */
  step: string;
  title: string;
  copy: string;
  /** Matches the wizard step id in features/create-project/types.ts. */
  wizardStepId: 1 | 2 | 3 | 4;
}

export const JOURNEY_BRIEF_STEPS: readonly JourneyStep[] = [
  {
    step: '01',
    title: 'Choose your idea',
    copy: 'Choose the kind of experience you want to step into — or bring something entirely your own.',
    wizardStepId: 1,
  },
  {
    step: '02',
    title: 'Describe your vision',
    copy: 'Location, wardrobe, mood, movement, and anything that matters to you.',
    wizardStepId: 2,
  },
  {
    step: '03',
    title: 'Add your photos',
    copy: 'Upload strong reference images. A few clear ones do more than a whole camera roll.',
    wizardStepId: 3,
  },
  {
    step: '04',
    title: 'Review and submit',
    copy: 'Check everything over before sending it to production. Nothing is sent until you do.',
    wizardStepId: 4,
  },
] as const;

export interface ProductionStage {
  title: string;
  copy: string;
}

export const JOURNEY_PRODUCTION_STAGES: readonly ProductionStage[] = [
  {
    title: 'Production',
    copy: 'We review your brief and reference images, then create your film and send you a private preview.',
  },
  {
    title: 'Your review',
    copy: 'Watch it through and approve it, or tell us what to change. There is no limit on asking.',
  },
  {
    title: 'Delivery',
    copy: 'Once you approve, your final film appears privately in your account, ready to watch and download.',
  },
] as const;
