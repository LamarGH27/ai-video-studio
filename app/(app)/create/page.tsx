import type { Metadata } from 'next';
import { Container } from '@/components/site/container';
import { Alert } from '@/components/ui/alert';
import { CreateWizard, type WizardInitialProject } from '@/features/create-project/wizard';
import { listActiveExperiences } from '@/lib/data/experiences';
import { getSessionUser } from '@/lib/auth/session';
import { getMyDraftProject } from '@/lib/data/projects';
import {
  listReferenceImages,
  reconcileOrphanedReferenceImages,
  signReferenceImages,
} from '@/lib/data/assets';
import { isSupabaseConfigured } from '@/lib/env';

export const metadata: Metadata = {
  title: 'Create My Video',
  description: 'Brief your cinematic AI-generated film.',
};

// The wizard depends on who is signed in and on their existing draft.
export const dynamic = 'force-dynamic';

/**
 * /create is intentionally public.
 *
 * A visitor can choose an experience and write their brief before they have an
 * account; the sign-up prompt appears at the point it is actually needed, when
 * private images have to be stored against an owner. Everything that writes is a
 * server action that re-derives identity from the session.
 */
export default async function CreatePage({
  searchParams,
}: {
  searchParams: Promise<{ experience?: string }>;
}) {
  const params = await searchParams;
  const configured = isSupabaseConfigured();

  const [experiences, user] = await Promise.all([
    listActiveExperiences(),
    configured ? getSessionUser() : Promise.resolve(null),
  ]);

  let initialProject: WizardInitialProject | null = null;

  // Pick up where they left off rather than starting a second draft.
  if (user) {
    const draft = await getMyDraftProject(user.id);
    if (draft) {
      // Reopening a draft is the natural moment to clear up an upload that
      // landed but was never confirmed — see lib/data/assets.ts.
      await reconcileOrphanedReferenceImages(user.id, draft.id);

      const assetRows = await listReferenceImages(draft.id);
      const signed = await signReferenceImages(assetRows);

      initialProject = {
        projectId: draft.id,
        publicReference: draft.public_reference,
        values: {
          experienceSlug:
            experiences.find((experience) => experience.id === draft.experience_id)?.slug ??
            params.experience ??
            null,
          brief: draft.brief ?? '',
          mood: draft.mood ?? '',
          environment: draft.environment ?? '',
          wardrobeStyle: draft.wardrobe_style ?? '',
          orientation: draft.orientation,
          desiredDurationSeconds: draft.desired_duration_seconds ?? 15,
          specialRequirements: draft.special_requirements ?? '',
          preserveRequirements: draft.preserve_requirements ?? '',
        },
        assets: signed.map((asset) => ({
          assetId: asset.id,
          storagePath: asset.storagePath,
          originalFilename: asset.originalFilename ?? 'Reference image',
          fileSize: asset.fileSize,
          mimeType: asset.mimeType,
          previewUrl: asset.signedUrl,
        })),
      };
    }
  }

  return (
    <>
      <section className="border-b border-white/8 surface-glow">
        <Container className="py-14 sm:py-20">
          <p className="eyebrow">Create My Video</p>
          <h1 className="mt-5 max-w-2xl display-heading text-[clamp(2rem,5vw,3.25rem)]">
            Let&rsquo;s build your film.
          </h1>
        </Container>
      </section>

      {!configured ? (
        <Container className="pt-10">
          <Alert tone="error" title="This environment is not connected to Supabase">
            Set <code className="font-mono">NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
            <code className="font-mono">NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> to enable
            accounts, uploads and project submission. See{' '}
            <code className="font-mono">.env.example</code>.
          </Alert>
        </Container>
      ) : null}

      <CreateWizard
        experiences={experiences}
        isAuthenticated={user !== null}
        initialExperienceSlug={params.experience ?? null}
        initialProject={initialProject}
      />
    </>
  );
}
