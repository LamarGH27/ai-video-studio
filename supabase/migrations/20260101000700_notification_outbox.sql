-- =============================================================================
-- AI Video Studio — transactional notification outbox
-- =============================================================================
-- Additive. Nothing in migrations 000000–000600 is modified.
--
-- The problem this solves is not "send an email". It is: a customer approves a
-- preview, the email provider is down, and the approval must still have
-- happened. So email is never part of the business transaction. The workflow
-- commits, a durable row is written in the same transaction, and a separate
-- worker sends it later — retrying, and eventually giving up, without the
-- project's state ever depending on any of that.
--
-- Events come from the database rather than from the page that triggered them.
-- A status change is a fact once it is committed, whoever caused it: the
-- create-project action, the admin panel, a customer RPC, or psql. Enqueuing
-- from a server action instead would mean every future caller has to remember,
-- and two callers doing the same thing would send two emails.
--
-- What it adds:
--   * notification_outbox, with a UNIQUE dedupe key so duplicates are a
--     database impossibility rather than a code convention
--   * triggers that enqueue the eight transactional events
--   * claim/complete/fail functions for a concurrency-safe worker
--   * RLS: customers cannot see, create or alter any of it
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Types
-- -----------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'notification_event_type'
                 and typnamespace = 'public'::regnamespace) then
    create type public.notification_event_type as enum (
      'PROJECT_SUBMITTED_CUSTOMER',
      'PROJECT_SUBMITTED_ADMIN',
      'PREVIEW_READY_CUSTOMER',
      'PREVIEW_REVISED_CUSTOMER',
      'REVISION_REQUESTED_ADMIN',
      'PREVIEW_APPROVED_CUSTOMER',
      'PREVIEW_APPROVED_ADMIN',
      'FINAL_VIDEO_READY_CUSTOMER'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'notification_status'
                 and typnamespace = 'public'::regnamespace) then
    create type public.notification_status as enum ('PENDING', 'PROCESSING', 'SENT', 'FAILED');
  end if;

  -- Who the message is for, as a role rather than an address. An admin row
  -- deliberately carries no address: see the table comment.
  if not exists (select 1 from pg_type where typname = 'notification_recipient'
                 and typnamespace = 'public'::regnamespace) then
    create type public.notification_recipient as enum ('CUSTOMER', 'ADMIN');
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. The outbox
-- -----------------------------------------------------------------------------

create table if not exists public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  event_type public.notification_event_type not null,

  recipient public.notification_recipient not null,
  -- Populated for a CUSTOMER row only, and only ever by enqueue_notification(),
  -- which reads auth.users. Nothing the browser sends reaches this column.
  recipient_user_id uuid references public.profiles (id) on delete set null,
  recipient_email text check (
    recipient_email is null
    or recipient_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ),

  project_id uuid references public.projects (id) on delete cascade,

  -- Rendering data only: the public reference, a version number, a display
  -- name. Never a URL, never a storage path, never a token — the CHECK below
  -- enforces that rather than trusting the triggers to remember.
  payload jsonb not null default '{}'::jsonb,

  status public.notification_status not null default 'PENDING',
  attempt_count integer not null default 0 check (attempt_count >= 0),
  -- When this row next becomes eligible. NULL means never again: either it has
  -- been sent, or it has exhausted its attempts. That is the terminal marker —
  -- see the note on statuses below.
  next_attempt_at timestamptz default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 500),
  provider_message_id text check (
    provider_message_id is null or char_length(provider_message_id) <= 200
  ),

  dedupe_key text not null unique check (char_length(dedupe_key) between 1 and 200),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint notification_outbox_customer_is_addressed check (
    recipient <> 'CUSTOMER' or (recipient_email is not null and recipient_user_id is not null)
  ),
  -- An admin row is addressed at send time from ADMIN_NOTIFICATION_EMAIL. The
  -- database does not know, and must not learn, who staff are.
  constraint notification_outbox_admin_is_unaddressed check (
    recipient <> 'ADMIN' or (recipient_email is null and recipient_user_id is null)
  ),
  constraint notification_outbox_sent_has_timestamp check (
    (status = 'SENT') = (sent_at is not null)
  ),
  -- A signed URL is a bearer credential with an expiry. Putting one in a queue
  -- that may be read minutes or days later, and then emailed, would turn it into
  -- a durable one. Emails link to authenticated pages instead, so no payload
  -- ever needs a URL — and this refuses to store one if a future change forgets.
  constraint notification_outbox_payload_has_no_urls check (
    payload::text !~* '(https?://|/storage/v1/|token=|[?&]signature=)'
  )
);

comment on table public.notification_outbox is
  'Durable queue of transactional emails. Rows are written by workflow triggers inside the business transaction; a worker sends them afterwards. Email delivery can never fail a project state change.';

comment on column public.notification_outbox.dedupe_key is
  'Deterministic identity of the business event, e.g. project:{id}:preview:{assetId}:ready. UNIQUE, so re-running an event is a no-op rather than a second email.';

comment on column public.notification_outbox.next_attempt_at is
  'When this row is next eligible. NULL is terminal: sent, or out of attempts. While PROCESSING it holds the lease expiry, so a worker that dies mid-send releases the row automatically.';

comment on column public.notification_outbox.recipient_email is
  'CUSTOMER rows only, captured from auth.users at enqueue time. ADMIN rows are addressed by the worker from ADMIN_NOTIFICATION_EMAIL.';

-- The worker's query: due rows, oldest first.
create index if not exists notification_outbox_due_idx
  on public.notification_outbox (next_attempt_at, created_at)
  where next_attempt_at is not null;

create index if not exists notification_outbox_project_idx
  on public.notification_outbox (project_id, created_at desc);

create index if not exists notification_outbox_status_idx
  on public.notification_outbox (status, created_at desc);

drop trigger if exists notification_outbox_set_updated_at on public.notification_outbox;
create trigger notification_outbox_set_updated_at
  before update on public.notification_outbox
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 3. Retry schedule
-- -----------------------------------------------------------------------------
-- Bounded, and defined here rather than in the worker so that the attempt count
-- and the schedule can never disagree: both move in the same statement.
--
--   attempt 1 fails -> retry in 1 minute
--   attempt 2 fails -> 5 minutes
--   attempt 3 fails -> 30 minutes
--   attempt 4 fails -> 2 hours
--   attempt 5 fails -> never again
--
-- Mirrored by lib/notifications/events.ts; tests/notification-events.test.ts
-- parses this function and fails if the two drift.

create or replace function public.notification_max_attempts()
returns integer
language sql
immutable
set search_path = ''
as $$ select 5 $$;

create or replace function public.notification_retry_delay(p_attempt integer)
returns interval
language sql
immutable
set search_path = ''
as $$
  select case p_attempt
    when 1 then interval '1 minute'
    when 2 then interval '5 minutes'
    when 3 then interval '30 minutes'
    when 4 then interval '2 hours'
    else null
  end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Enqueuing
-- -----------------------------------------------------------------------------
-- The single writer. SECURITY DEFINER because it reads auth.users, which no
-- application role can see — and that is the point: the recipient address comes
-- from the identity system, never from a caller.
--
-- ON CONFLICT DO NOTHING is the whole idempotency story. A retried action, a
-- double-clicked button, a replayed E2E run and a redeployed worker all produce
-- the same dedupe key, and the second insert is silently discarded.

create or replace function public.enqueue_notification(
  p_event_type public.notification_event_type,
  p_recipient public.notification_recipient,
  p_project_id uuid,
  p_dedupe_key text,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner     uuid;
  v_reference text;
  v_email     text;
  v_id        uuid;
begin
  select p.user_id, p.public_reference into v_owner, v_reference
  from public.projects p
  where p.id = p_project_id;

  if v_owner is null then
    return null;
  end if;

  if p_recipient = 'CUSTOMER' then
    select u.email into v_email from auth.users u where u.id = v_owner;
    -- No address, no notification. Better a missing email than a row that can
    -- only ever fail, and the outbox stays a list of things that can be sent.
    if v_email is null then
      return null;
    end if;
  end if;

  insert into public.notification_outbox
    (event_type, recipient, recipient_user_id, recipient_email, project_id, dedupe_key, payload)
  values (
    p_event_type,
    p_recipient,
    case when p_recipient = 'CUSTOMER' then v_owner else null end,
    case when p_recipient = 'CUSTOMER' then v_email else null end,
    p_project_id,
    p_dedupe_key,
    -- The public reference travels with every notification so that rendering
    -- never has to read the project back, and so no email ever needs a UUID.
    coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('reference', v_reference)
  )
  on conflict (dedupe_key) do nothing
  returning id into v_id;

  return v_id;
end;
$$;

-- Supabase's project defaults include
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS
--     TO anon, authenticated, service_role;
-- so a new function is executable by every API role the moment it is created,
-- and REVOKE ... FROM PUBLIC does not touch a grant held by a named role. Each
-- revoke below therefore names the roles explicitly.
--
-- It matters most here. enqueue_notification() is SECURITY DEFINER and writes
-- the outbox: a customer able to call it could claim a dedupe key before the
-- real event does, and the notification that event should have produced would
-- then never be created. Suppressing somebody's email is a quieter attack than
-- forging one, and this is the only thing standing in front of it.
revoke execute on function public.enqueue_notification(
  public.notification_event_type, public.notification_recipient, uuid, text, jsonb)
  from public, anon, authenticated;

comment on function public.enqueue_notification(
  public.notification_event_type, public.notification_recipient, uuid, text, jsonb) is
  'Internal. Writes one outbox row, resolving the customer address from auth.users. Idempotent on dedupe_key.';

-- -----------------------------------------------------------------------------
-- 5. The events
-- -----------------------------------------------------------------------------

-- 5a. Project status changes.
--
-- Only three of the nine statuses are worth an email. ASSETS_REVIEW and
-- IN_PRODUCTION are internal production stages: telling a customer that their
-- project has moved between two of our own queues is noise, and noise is what
-- makes people stop reading the messages that matter.
create or replace function public.notify_on_project_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_preview_id      uuid;
  v_preview_version integer;
begin
  -- Submission: confirm to the customer, alert the team.
  if old.status = 'DRAFT' and new.status = 'SUBMITTED' then
    perform public.enqueue_notification(
      'PROJECT_SUBMITTED_CUSTOMER', 'CUSTOMER', new.id,
      format('project:%s:submitted:customer', new.id));

    perform public.enqueue_notification(
      'PROJECT_SUBMITTED_ADMIN', 'ADMIN', new.id,
      format('project:%s:submitted:admin', new.id));

  elsif new.status = 'PREVIEW_READY' then
    select a.id, a.version into v_preview_id, v_preview_version
    from public.project_assets a
    where a.project_id = new.id and a.asset_type = 'PREVIEW_VIDEO'
    order by a.version desc
    limit 1;

    if v_preview_id is not null then
      -- Keyed on the ASSET, not the project: a second preview is a second
      -- notification, and the same preview announced twice is not.
      perform public.enqueue_notification(
        case when v_preview_version > 1
             then 'PREVIEW_REVISED_CUSTOMER'::public.notification_event_type
             else 'PREVIEW_READY_CUSTOMER'::public.notification_event_type end,
        'CUSTOMER', new.id,
        format('project:%s:preview:%s:ready', new.id, v_preview_id),
        jsonb_build_object('previewVersion', v_preview_version));
    end if;

  elsif old.status = 'FINALISING' and new.status = 'COMPLETED' then
    perform public.enqueue_notification(
      'FINAL_VIDEO_READY_CUSTOMER', 'CUSTOMER', new.id,
      format('project:%s:completed:customer', new.id));
  end if;

  return null;
end;
$$;

drop trigger if exists projects_notify_status_change on public.projects;
create trigger projects_notify_status_change
  after update of status on public.projects
  for each row
  when (old.status is distinct from new.status)
  execute function public.notify_on_project_status_change();

-- 5b. A revision request. The admin is told that changes were asked for; the
-- message itself stays in the authenticated portal.
create or replace function public.notify_on_revision_requested()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.enqueue_notification(
    'REVISION_REQUESTED_ADMIN', 'ADMIN', new.project_id,
    format('project:%s:revision:%s:admin', new.project_id, new.id));
  return null;
end;
$$;

drop trigger if exists project_revisions_notify on public.project_revisions;
create trigger project_revisions_notify
  after insert on public.project_revisions
  for each row execute function public.notify_on_revision_requested();

-- 5c. An approval. The customer gets a receipt; the team gets the go-ahead.
create or replace function public.notify_on_preview_approved()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.enqueue_notification(
    'PREVIEW_APPROVED_CUSTOMER', 'CUSTOMER', new.project_id,
    format('project:%s:approval:%s:customer', new.project_id, new.id));

  perform public.enqueue_notification(
    'PREVIEW_APPROVED_ADMIN', 'ADMIN', new.project_id,
    format('project:%s:approval:%s:admin', new.project_id, new.id));

  return null;
end;
$$;

drop trigger if exists project_preview_approvals_notify on public.project_preview_approvals;
create trigger project_preview_approvals_notify
  after insert on public.project_preview_approvals
  for each row execute function public.notify_on_preview_approved();

-- -----------------------------------------------------------------------------
-- 6. The worker's three operations
-- -----------------------------------------------------------------------------
-- Claiming is a short transaction that touches only the database. The provider
-- call happens afterwards, outside any transaction, because an open transaction
-- waiting on somebody else's HTTP endpoint holds locks for as long as their
-- slowest response — and a provider timeout would then become a database
-- problem. The lease is what makes that safe: a claimed row is invisible to
-- other workers until it expires, and a worker that dies mid-send releases its
-- rows by doing nothing.

create or replace function public.claim_notifications(
  p_limit integer default 20,
  p_lease_seconds integer default 300
)
returns setof public.notification_outbox
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_lease integer := least(greatest(coalesce(p_lease_seconds, 300), 30), 3600);
begin
  return query
  with due as (
    select o.id
    from public.notification_outbox o
    where o.next_attempt_at is not null
      and o.next_attempt_at <= now()
      and o.status <> 'SENT'
      and o.attempt_count < public.notification_max_attempts()
    order by o.next_attempt_at, o.created_at
    limit v_limit
    -- SKIP LOCKED is what lets two workers run at once: each takes rows the
    -- other has not locked, rather than queueing behind them or duplicating.
    for update skip locked
  )
  update public.notification_outbox o
  set status = 'PROCESSING',
      claimed_at = now(),
      attempt_count = o.attempt_count + 1,
      -- The lease, not the retry delay. If this worker never reports back, the
      -- row becomes due again here.
      next_attempt_at = now() + make_interval(secs => v_lease)
  from due
  where o.id = due.id
  returning o.*;
end;
$$;

create or replace function public.mark_notification_sent(
  p_id uuid,
  p_provider_message_id text default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notification_outbox
  set status = 'SENT',
      sent_at = now(),
      next_attempt_at = null,
      last_error = null,
      provider_message_id = left(p_provider_message_id, 200)
  where id = p_id and status <> 'SENT';
$$;

create or replace function public.mark_notification_failed(
  p_id uuid,
  p_error text,
  p_permanent boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt integer;
  v_delay   interval;
begin
  select attempt_count into v_attempt
  from public.notification_outbox where id = p_id;

  if v_attempt is null then
    return;
  end if;

  -- A permanent failure is not worth four more attempts: a rejected address
  -- will still be rejected in two hours.
  v_delay := case when p_permanent then null
                  else public.notification_retry_delay(v_attempt) end;

  update public.notification_outbox
  set status = 'FAILED',
      next_attempt_at = case when v_delay is null then null else now() + v_delay end,
      claimed_at = null,
      -- Truncated, and never shown to a customer. Operators see it in /admin.
      last_error = left(coalesce(p_error, 'Unknown error'), 500)
  where id = p_id and status <> 'SENT';
end;
$$;

-- The worker is not a user. It authenticates to the application with CRON_SECRET
-- and reaches the database as service_role, so these three are granted there and
-- nowhere else. Customers and admins cannot call them through PostgREST.
revoke execute on function public.claim_notifications(integer, integer)
  from public, anon, authenticated;
revoke execute on function public.mark_notification_sent(uuid, text)
  from public, anon, authenticated;
revoke execute on function public.mark_notification_failed(uuid, text, boolean)
  from public, anon, authenticated;

grant execute on function public.claim_notifications(integer, integer) to service_role;
grant execute on function public.mark_notification_sent(uuid, text) to service_role;
grant execute on function public.mark_notification_failed(uuid, text, boolean) to service_role;

-- -----------------------------------------------------------------------------
-- 7. Operator retry
-- -----------------------------------------------------------------------------
-- For the admin view. Restores a row's attempt budget; it never creates a new
-- row, so the dedupe key — and therefore the guarantee of one email per event —
-- survives the retry.

create or replace function public.retry_notification(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  if not public.is_admin() then
    raise exception 'Notification not found' using errcode = '42501';
  end if;

  update public.notification_outbox
  set status = 'PENDING',
      attempt_count = 0,
      next_attempt_at = now(),
      claimed_at = null
  where id = p_id and status <> 'SENT';

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

-- The operator retry IS for a session, but only an administrator's: it is
-- granted to authenticated and re-checks is_admin() itself.
revoke execute on function public.retry_notification(uuid) from public, anon;
grant execute on function public.retry_notification(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 8. Row Level Security
-- -----------------------------------------------------------------------------
-- Staff may read. Nobody may write.
--
-- There is deliberately no customer policy of any kind — not even to read their
-- own. An outbox row is operational data: it says which address we hold, what
-- failed, and how many times. A customer has no use for it and several reasons
-- not to see it. And there is no INSERT, UPDATE or DELETE policy for anyone: the
-- only writer is enqueue_notification(), and the only mutators are the four
-- SECURITY DEFINER functions above, each of which decides for itself who may
-- call it.

alter table public.notification_outbox enable row level security;

drop policy if exists "notification_outbox: admin can read" on public.notification_outbox;
create policy "notification_outbox: admin can read"
  on public.notification_outbox for select
  to authenticated
  using (public.is_admin());
