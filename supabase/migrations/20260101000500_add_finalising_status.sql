-- =============================================================================
-- AI Video Studio — add the FINALISING project status
-- =============================================================================
-- This migration contains ONE statement, on purpose.
--
-- PostgreSQL refuses to use a new enum value in the same transaction that added
-- it ("New enum values must be committed before they can be used"), and both
-- `supabase db push` and the local runner apply each migration file in its own
-- transaction. Splitting the ALTER TYPE into its own file is therefore what
-- makes 20260101000600_delivery_workflow.sql — which references 'FINALISING' in
-- function bodies and policies — applicable at all.
--
-- Do not add anything else to this file.
--
-- FINALISING sits between PREVIEW_READY and COMPLETED: the customer has
-- approved a preview and the final cut is being prepared. It exists so that
-- IN_PRODUCTION is not overloaded to mean two different things.
-- =============================================================================

alter type public.project_status add value if not exists 'FINALISING' after 'PREVIEW_READY';
