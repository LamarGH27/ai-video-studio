-- H6: an acknowledgement belongs to one live lease, not merely an outbox ID.
alter table public.notification_outbox add column if not exists claim_token uuid;

create or replace function public.claim_notifications(
  p_limit integer default 20, p_lease_seconds integer default 300
)
returns setof public.notification_outbox
language plpgsql security definer set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_lease integer := least(greatest(coalesce(p_lease_seconds, 300), 30), 3600);
begin
  -- A worker dying on its final attempt must become visible to operator retry.
  -- Bounded, nonblocking recovery also runs when no deliverable rows remain.
  with exhausted as (
    select id from public.notification_outbox
    where status = 'PROCESSING'
      and (next_attempt_at is null or next_attempt_at <= clock_timestamp())
      and attempt_count >= public.notification_max_attempts()
    order by next_attempt_at nulls first, created_at
    limit 100 for update skip locked
  )
  update public.notification_outbox o
  set status = 'FAILED', next_attempt_at = null, claimed_at = null,
      claim_token = null,
      last_error = 'Final delivery lease expired; provider outcome unknown. Operator retry required.'
  from exhausted e where o.id = e.id;

  return query
  with due as (
    select o.id from public.notification_outbox o
    where o.status <> 'SENT'
      and o.next_attempt_at <= clock_timestamp()
      and o.attempt_count < public.notification_max_attempts()
    order by o.next_attempt_at, o.created_at
    limit v_limit for update skip locked
  )
  update public.notification_outbox o
  set status = 'PROCESSING', claimed_at = clock_timestamp(),
      claim_token = gen_random_uuid(), attempt_count = o.attempt_count + 1,
      next_attempt_at = clock_timestamp() + make_interval(secs => v_lease)
  from due where o.id = due.id returning o.*;
end;
$$;

-- Remove tokenless acknowledgements: older workers must fail closed.
drop function if exists public.mark_notification_sent(uuid, text);
drop function if exists public.mark_notification_failed(uuid, text, boolean);

create or replace function public.mark_notification_sent(
  p_id uuid, p_claim_token uuid, p_provider_message_id text default null
)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  -- Check wall-clock expiry only after acquiring the row lock.
  perform 1 from public.notification_outbox where id = p_id for update;
  update public.notification_outbox
  set status = 'SENT', sent_at = clock_timestamp(), next_attempt_at = null,
      claimed_at = null, claim_token = null, last_error = null,
      provider_message_id = left(p_provider_message_id, 200)
  where id = p_id and status = 'PROCESSING' and claim_token = p_claim_token
    and next_attempt_at > clock_timestamp();
  return found;
end;
$$;

create or replace function public.mark_notification_failed(
  p_id uuid, p_claim_token uuid, p_error text, p_permanent boolean default false
)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  perform 1 from public.notification_outbox where id = p_id for update;
  update public.notification_outbox
  set status = 'FAILED', claimed_at = null, claim_token = null,
      next_attempt_at = case when p_permanent then null else
        clock_timestamp() + public.notification_retry_delay(attempt_count) end,
      last_error = left(coalesce(p_error, 'Unknown error'), 500)
  where id = p_id and status = 'PROCESSING' and claim_token = p_claim_token
    and next_attempt_at > clock_timestamp();
  return found;
end;
$$;

revoke all on function public.mark_notification_sent(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.mark_notification_failed(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.mark_notification_sent(uuid, uuid, text) to service_role;
grant execute on function public.mark_notification_failed(uuid, uuid, text, boolean) to service_role;

create or replace function public.retry_notification(p_id uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Notification not found' using errcode = '42501';
  end if;
  update public.notification_outbox
  set status = 'PENDING', attempt_count = 0, next_attempt_at = clock_timestamp(),
      claimed_at = null, claim_token = null
  where id = p_id and status <> 'SENT'
    and (status <> 'PROCESSING' or next_attempt_at is null
         or next_attempt_at <= clock_timestamp());
  return found;
end;
$$;
