'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Container } from '@/components/site/container';
import { Alert } from '@/components/ui/alert';
import { Stepper } from './stepper';
import { ExperienceStep } from './steps/experience-step';
import { BriefStep } from './steps/brief-step';
import { ReferencesStep } from './steps/references-step';
import { ReviewStep, type ConsentValues } from './steps/review-step';
import { useReferenceUploads } from './use-reference-uploads';
import { saveDraftAction, submitProjectAction } from './actions';
import { clearStoredDraft, readStoredDraft, writeStoredDraft } from './draft-storage';
import { EMPTY_DRAFT, type DraftValues, type UploadedAsset, type WizardStepId } from './types';
import type { ExperienceOption } from '@/lib/catalog/experiences';
import type { BriefFormValues } from '@/lib/validation/project';

const CREATE_PATH = '/create';

export interface WizardInitialProject {
  projectId: string;
  publicReference: string;
  values: DraftValues;
  assets: UploadedAsset[];
}

/**
 * The create-video flow.
 *
 * Steps 1 and 2 are held in browser state so a visitor can start a brief before
 * they have an account; they are persisted to sessionStorage so the sign-up
 * detour does not lose them. From step 3 the project exists as a DRAFT row and
 * the server is the source of truth.
 */
export function CreateWizard({
  experiences,
  isAuthenticated,
  initialExperienceSlug,
  initialProject,
}: {
  experiences: readonly ExperienceOption[];
  isAuthenticated: boolean;
  initialExperienceSlug: string | null;
  initialProject: WizardInitialProject | null;
}) {
  const router = useRouter();

  const [values, setValues] = useState<DraftValues>(
    initialProject?.values ?? {
      ...EMPTY_DRAFT,
      experienceSlug: initialExperienceSlug,
    },
  );
  const [step, setStep] = useState<WizardStepId>(1);
  const [furthestReached, setFurthestReached] = useState<WizardStepId>(1);
  const [projectId, setProjectId] = useState<string | null>(initialProject?.projectId ?? null);
  const [publicReference, setPublicReference] = useState<string | null>(
    initialProject?.publicReference ?? null,
  );
  const [assets, setAssets] = useState<UploadedAsset[]>(initialProject?.assets ?? []);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const headingRef = useRef<HTMLDivElement>(null);
  const hasRestored = useRef(false);

  /*
   * Restore a brief left behind before signing up. Only when the server did not
   * already hand us a saved draft, which is the better source.
   *
   * This is a one-shot read of an external store (sessionStorage) at mount,
   * guarded by `hasRestored`, so it cannot cascade. It cannot be a lazy
   * useState initialiser instead: sessionStorage does not exist during server
   * rendering, and reading it there would produce a hydration mismatch.
   */
  useEffect(() => {
    if (hasRestored.current || initialProject) return;
    hasRestored.current = true;

    const stored = readStoredDraft();
    if (!stored) return;

    const restored: DraftValues = {
      ...stored,
      // A slug from the URL (e.g. "Create Your Version") wins over a stale one.
      experienceSlug: initialExperienceSlug ?? stored.experienceSlug,
    };
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot restore, see above
    setValues(restored);

    const isComplete = Boolean(restored.experienceSlug) && restored.brief.length > 0;
    if (!isComplete) return;

    setFurthestReached(3);

    if (!isAuthenticated) {
      // Land on the sign-up prompt they were sent away from.
      setStep(3);
      return;
    }

    // They have just signed up or signed in. Turn the restored brief into a real
    // DRAFT project so uploads have something to attach to.
    void (async () => {
      setSaving(true);
      const result = await saveDraftAction({
        experienceSlug: restored.experienceSlug!,
        brief: restored.brief,
        mood: restored.mood,
        environment: restored.environment,
        wardrobeStyle: restored.wardrobeStyle,
        orientation: restored.orientation ?? 'VERTICAL_9_16',
        desiredDurationSeconds: restored.desiredDurationSeconds,
        specialRequirements: restored.specialRequirements,
        preserveRequirements: restored.preserveRequirements,
      });
      setSaving(false);

      if (!result.ok) {
        // Fall back to the brief step rather than stranding them on an upload
        // screen with nothing to upload to.
        setStep(2);
        setError(result.message);
        return;
      }

      setProjectId(result.data.projectId);
      setPublicReference(result.data.publicReference);
      setStep(3);
    })();
  }, [initialProject, initialExperienceSlug, isAuthenticated]);

  // Keep the sessionStorage copy in step with what the customer has typed.
  useEffect(() => {
    writeStoredDraft(values);
  }, [values]);

  // Move focus to the step heading on each change, so keyboard and screen reader
  // users are not left at the bottom of the previous step.
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  const goTo = useCallback((next: WizardStepId) => {
    setError(null);
    setStep(next);
    setFurthestReached((current) => (next > current ? next : current));
  }, []);

  const redirectToSignup = useCallback(() => {
    router.push(`/signup?next=${encodeURIComponent(CREATE_PATH)}`);
  }, [router]);

  const { uploading, uploadErrors, uploadFiles, removeAsset } = useReferenceUploads({
    projectId,
    assets,
    setAssets,
    onUnauthenticated: redirectToSignup,
  });

  const selectedExperience =
    experiences.find((experience) => experience.slug === values.experienceSlug) ?? null;

  /** Step 2 → 3: persist the draft so uploads have a project to attach to. */
  const handleBriefSubmit = useCallback(
    async (formValues: BriefFormValues) => {
      const merged: DraftValues = {
        ...values,
        brief: formValues.brief,
        mood: formValues.mood,
        environment: formValues.environment,
        wardrobeStyle: formValues.wardrobeStyle,
        orientation: formValues.orientation,
        desiredDurationSeconds: formValues.desiredDurationSeconds,
        specialRequirements: formValues.specialRequirements,
        preserveRequirements: formValues.preserveRequirements,
      };
      setValues(merged);

      if (!merged.experienceSlug) {
        setError('Choose an experience first.');
        goTo(1);
        return;
      }

      // An unauthenticated visitor gets as far as the sign-up prompt on step 3.
      // Nothing is written until they have an account of their own.
      if (!isAuthenticated) {
        goTo(3);
        return;
      }

      setSaving(true);
      setError(null);

      const result = await saveDraftAction({
        projectId: projectId ?? undefined,
        experienceSlug: merged.experienceSlug,
        brief: merged.brief,
        mood: merged.mood,
        environment: merged.environment,
        wardrobeStyle: merged.wardrobeStyle,
        orientation: merged.orientation ?? 'VERTICAL_9_16',
        desiredDurationSeconds: merged.desiredDurationSeconds,
        specialRequirements: merged.specialRequirements,
        preserveRequirements: merged.preserveRequirements,
      });

      setSaving(false);

      if (!result.ok) {
        if (result.code === 'UNAUTHENTICATED') {
          redirectToSignup();
          return;
        }
        setError(result.message);
        return;
      }

      setProjectId(result.data.projectId);
      setPublicReference(result.data.publicReference);
      goTo(3);
    },
    [values, isAuthenticated, projectId, goTo, redirectToSignup],
  );

  const handleSubmitProject = useCallback(
    async (consent: ConsentValues) => {
      if (!projectId) {
        setError('Your brief has not been saved yet. Go back a step and try again.');
        return;
      }

      setSubmitting(true);
      setError(null);

      const result = await submitProjectAction({
        projectId,
        hasLikenessPermission: consent.hasLikenessPermission as true,
        aiProcessingConsent: consent.aiProcessingConsent as true,
        portfolioPermission: consent.portfolioPermission,
      });

      if (!result.ok) {
        setSubmitting(false);
        if (result.code === 'UNAUTHENTICATED') {
          redirectToSignup();
          return;
        }
        setError(result.message);
        return;
      }

      clearStoredDraft();
      router.push(`/dashboard/projects/${result.data.projectId}?submitted=1`);
    },
    [projectId, router, redirectToSignup],
  );

  return (
    <Container className="py-12 sm:py-16">
      <div className="mb-12">
        <Stepper current={step} furthestReached={furthestReached} onSelect={goTo} />
      </div>

      <div ref={headingRef} tabIndex={-1} className="outline-none">
        {step === 1 ? (
          <ExperienceStep
            experiences={experiences}
            selectedSlug={values.experienceSlug}
            onSelect={(slug) => setValues((current) => ({ ...current, experienceSlug: slug }))}
            onContinue={() => goTo(2)}
          />
        ) : null}

        {step === 2 ? (
          <BriefStep
            values={values}
            onBack={() => goTo(1)}
            onSubmit={handleBriefSubmit}
            submitting={saving}
            error={error}
          />
        ) : null}

        {step === 3 ? (
          <ReferencesStep
            assets={assets}
            uploading={uploading}
            uploadErrors={uploadErrors}
            onFilesSelected={uploadFiles}
            onRemove={removeAsset}
            onBack={() => goTo(2)}
            onContinue={() => goTo(4)}
            requiresAuth={!isAuthenticated}
            authNextPath={CREATE_PATH}
          />
        ) : null}

        {step === 4 ? (
          <ReviewStep
            values={values}
            experience={selectedExperience}
            assets={assets}
            publicReference={publicReference}
            onBack={() => goTo(3)}
            onSubmit={handleSubmitProject}
            submitting={submitting}
            error={error}
          />
        ) : null}
      </div>

      {error && step !== 2 && step !== 4 ? (
        <Alert tone="error" className="mt-8">
          {error}
        </Alert>
      ) : null}
    </Container>
  );
}
