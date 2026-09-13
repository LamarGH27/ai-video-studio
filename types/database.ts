/**
 * Hand-maintained mirror of supabase/migrations.
 *
 * Regenerate with the Supabase CLI once a project is linked:
 *   npx supabase gen types typescript --linked > types/database.ts
 * Until then, keep this file in step with the migrations by hand — every query
 * in lib/data is typed through it.
 */

export type UserRole = 'customer' | 'admin';

export type ProjectStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'ASSETS_REVIEW'
  | 'IN_PRODUCTION'
  | 'PREVIEW_READY'
  | 'FINALISING'
  | 'REVISION_REQUESTED'
  | 'COMPLETED'
  | 'CANCELLED';

export type RevisionStatus = 'OPEN' | 'RESOLVED';

export type NotificationStatus = 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED';

export type NotificationRecipient = 'CUSTOMER' | 'ADMIN';

export type NotificationEventType =
  | 'PROJECT_SUBMITTED_CUSTOMER'
  | 'PROJECT_SUBMITTED_ADMIN'
  | 'PREVIEW_READY_CUSTOMER'
  | 'PREVIEW_REVISED_CUSTOMER'
  | 'REVISION_REQUESTED_ADMIN'
  | 'PREVIEW_APPROVED_CUSTOMER'
  | 'PREVIEW_APPROVED_ADMIN'
  | 'FINAL_VIDEO_READY_CUSTOMER';

export type ProjectOrientation = 'VERTICAL_9_16' | 'LANDSCAPE_16_9' | 'SQUARE_1_1';

export type AssetType = 'REFERENCE_IMAGE' | 'PREVIEW_VIDEO' | 'FINAL_VIDEO';

export type ConsentType =
  'HAS_LIKENESS_PERMISSION' | 'AI_PROCESSING_CONSENT' | 'PORTFOLIO_PERMISSION';

export type ExperienceCategory =
  | 'LUXURY_LIFESTYLE'
  | 'FASHION'
  | 'CINEMATIC'
  | 'SOCIAL_MEDIA'
  | 'CELEBRATION'
  | 'TRAVEL'
  | 'EXECUTIVE'
  | 'BESPOKE';

export type ProfileRow = {
  id: string;
  display_name: string | null;
  role: UserRole;
  created_at: string;
  updated_at: string;
};

export type VideoExperienceRow = {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: ExperienceCategory;
  active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type ProjectRow = {
  id: string;
  public_reference: string;
  user_id: string;
  experience_id: string | null;
  title: string | null;
  status: ProjectStatus;
  brief: string | null;
  mood: string | null;
  environment: string | null;
  wardrobe_style: string | null;
  orientation: ProjectOrientation | null;
  desired_duration_seconds: number | null;
  special_requirements: string | null;
  preserve_requirements: string | null;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
};

export type ProjectAssetRow = {
  id: string;
  project_id: string;
  user_id: string;
  asset_type: AssetType;
  storage_bucket: string;
  storage_path: string;
  mime_type: string;
  original_filename: string | null;
  file_size: number;
  /** Delivery sequence within (project_id, asset_type). Always 1 for a reference image. */
  version: number;
  created_at: string;
};

export type ProjectRevisionRow = {
  id: string;
  project_id: string;
  user_id: string;
  preview_asset_id: string | null;
  message: string;
  status: RevisionStatus;
  requested_at: string;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

export type NotificationOutboxRow = {
  id: string;
  event_type: NotificationEventType;
  recipient: NotificationRecipient;
  recipient_user_id: string | null;
  recipient_email: string | null;
  project_id: string | null;
  payload: Record<string, unknown>;
  status: NotificationStatus;
  attempt_count: number;
  next_attempt_at: string | null;
  claimed_at: string | null;
  sent_at: string | null;
  last_error: string | null;
  provider_message_id: string | null;
  dedupe_key: string;
  created_at: string;
  updated_at: string;
};

export type ProjectPreviewApprovalRow = {
  id: string;
  project_id: string;
  user_id: string;
  preview_asset_id: string | null;
  approved_at: string;
  created_at: string;
};

export type ProjectConsentRow = {
  id: string;
  project_id: string;
  user_id: string;
  consent_type: ConsentType;
  granted: boolean;
  wording_version: string;
  granted_at: string | null;
  created_at: string;
};

export type ProjectStatusHistoryRow = {
  id: string;
  project_id: string;
  from_status: ProjectStatus | null;
  to_status: ProjectStatus;
  changed_by: string | null;
  created_at: string;
};

export type PortfolioItemRow = {
  id: string;
  experience_id: string | null;
  title: string;
  slug: string;
  description: string | null;
  category: ExperienceCategory;
  media_url: string | null;
  thumbnail_url: string | null;
  featured: boolean;
  active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

type Insertable<TRow, TRequired extends keyof TRow> = Pick<TRow, TRequired> &
  Partial<Omit<TRow, TRequired>>;

/**
 * `Relationships` entries mirror the foreign keys in the migrations. PostgREST's
 * TypeScript client uses them to type embedded selects such as
 * `.select('*, video_experiences (id, slug)')`, so they must stay in step with
 * the constraint names in supabase/migrations.
 */
export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow;
        Insert: Insertable<ProfileRow, 'id'>;
        Update: Partial<ProfileRow>;
        Relationships: [
          {
            foreignKeyName: 'profiles_id_fkey';
            columns: ['id'];
            isOneToOne: true;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      video_experiences: {
        Row: VideoExperienceRow;
        Insert: Insertable<VideoExperienceRow, 'slug' | 'name' | 'description' | 'category'>;
        Update: Partial<VideoExperienceRow>;
        Relationships: [];
      };
      projects: {
        Row: ProjectRow;
        Insert: Insertable<ProjectRow, 'user_id'>;
        Update: Partial<ProjectRow>;
        Relationships: [
          {
            foreignKeyName: 'projects_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'projects_experience_id_fkey';
            columns: ['experience_id'];
            isOneToOne: false;
            referencedRelation: 'video_experiences';
            referencedColumns: ['id'];
          },
        ];
      };
      project_assets: {
        Row: ProjectAssetRow;
        Insert: Insertable<
          ProjectAssetRow,
          | 'project_id'
          | 'user_id'
          | 'asset_type'
          | 'storage_bucket'
          | 'storage_path'
          | 'mime_type'
          | 'file_size'
        >;
        Update: Partial<ProjectAssetRow>;
        Relationships: [
          {
            foreignKeyName: 'project_assets_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'project_assets_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      project_consents: {
        Row: ProjectConsentRow;
        Insert: Insertable<
          ProjectConsentRow,
          'project_id' | 'user_id' | 'consent_type' | 'granted' | 'wording_version'
        >;
        Update: Partial<ProjectConsentRow>;
        Relationships: [
          {
            foreignKeyName: 'project_consents_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'project_consents_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      project_status_history: {
        Row: ProjectStatusHistoryRow;
        Insert: Insertable<ProjectStatusHistoryRow, 'project_id' | 'to_status'>;
        Update: Partial<ProjectStatusHistoryRow>;
        Relationships: [
          {
            foreignKeyName: 'project_status_history_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['id'];
          },
        ];
      };
      notification_outbox: {
        Row: NotificationOutboxRow;
        // No Insert or Update path exists through PostgREST: the table has no
        // INSERT/UPDATE/DELETE policy for any role. Rows are created by
        // workflow triggers and mutated only by SECURITY DEFINER functions.
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: 'notification_outbox_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'notification_outbox_recipient_user_id_fkey';
            columns: ['recipient_user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      project_revisions: {
        Row: ProjectRevisionRow;
        Insert: Insertable<ProjectRevisionRow, 'project_id' | 'user_id' | 'message'>;
        Update: Partial<ProjectRevisionRow>;
        Relationships: [
          {
            foreignKeyName: 'project_revisions_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'project_revisions_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'project_revisions_preview_asset_id_fkey';
            columns: ['preview_asset_id'];
            isOneToOne: false;
            referencedRelation: 'project_assets';
            referencedColumns: ['id'];
          },
        ];
      };
      project_preview_approvals: {
        Row: ProjectPreviewApprovalRow;
        Insert: Insertable<ProjectPreviewApprovalRow, 'project_id' | 'user_id'>;
        Update: Partial<ProjectPreviewApprovalRow>;
        Relationships: [
          {
            foreignKeyName: 'project_preview_approvals_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'project_preview_approvals_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      portfolio_items: {
        Row: PortfolioItemRow;
        Insert: Insertable<PortfolioItemRow, 'title' | 'slug' | 'category'>;
        Update: Partial<PortfolioItemRow>;
        Relationships: [
          {
            foreignKeyName: 'portfolio_items_experience_id_fkey';
            columns: ['experience_id'];
            isOneToOne: false;
            referencedRelation: 'video_experiences';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      is_admin: { Args: Record<string, never>; Returns: boolean };
      // Atomic customer decisions. Each validates auth.uid(), ownership and the
      // expected current status inside the database — see migration 000600.
      // Administrator delivery upload: locks the project, validates the stage,
      // inserts the asset and moves the project — atomically. Returns
      // { assetId, version, status }.
      record_delivery_asset: {
        Args: {
          p_project_id: string;
          p_asset_type: AssetType;
          p_storage_path: string;
          p_mime_type: string;
          p_original_filename: string | null;
          p_file_size: number;
        };
        Returns: { assetId: string; version: number; status: ProjectStatus };
      };
      // The notification worker's three operations. Granted to service_role
      // only; unreachable from a customer or admin session.
      claim_notifications: {
        Args: { p_limit: number; p_lease_seconds: number };
        Returns: NotificationOutboxRow[];
      };
      mark_notification_sent: {
        Args: { p_id: string; p_provider_message_id: string | null };
        Returns: undefined;
      };
      mark_notification_failed: {
        Args: { p_id: string; p_error: string; p_permanent: boolean };
        Returns: undefined;
      };
      // Operator retry, from the admin view. Preserves the outbox row.
      retry_notification: { Args: { p_id: string }; Returns: boolean };
      approve_preview: {
        Args: { p_project_id: string; p_preview_asset_id: string };
        Returns: string;
      };
      request_project_revision: {
        Args: { p_project_id: string; p_preview_asset_id: string; p_message: string };
        Returns: string;
      };
    };
    Enums: {
      user_role: UserRole;
      project_status: ProjectStatus;
      project_orientation: ProjectOrientation;
      asset_type: AssetType;
      consent_type: ConsentType;
      experience_category: ExperienceCategory;
      revision_status: RevisionStatus;
      notification_status: NotificationStatus;
      notification_recipient: NotificationRecipient;
      notification_event_type: NotificationEventType;
    };
    CompositeTypes: { [_ in never]: never };
  };
}
