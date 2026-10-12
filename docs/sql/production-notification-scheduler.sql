-- OPERATOR-ONLY setup; jobs remain inactive. No secret values in source.
begin;
DO $$ BEGIN IF current_user <> 'postgres' THEN RAISE EXCEPTION 'Run as postgres'; END IF; IF (SELECT count(*) FROM pg_extension WHERE extname IN ('pg_cron','pg_net','supabase_vault') AND extowner='supabase_admin'::regrole) <> 3 THEN RAISE EXCEPTION 'Enable managed extensions and verify ownership first'; END IF; END $$;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create schema if not exists production_scheduler;
revoke all on schema production_scheduler from public, anon, authenticated, service_role;
create table if not exists production_scheduler.requests(request_id bigint primary key,started_at timestamptz not null default clock_timestamp(),origin text not null check(origin in ('scheduled','manual')),completed_at timestamptz,http_status integer,healthy boolean,claimed integer,sent integer,failed integer,skipped integer,acknowledgement_errors integer,failure_kind text);
create table if not exists production_scheduler.watchdog(checked_at timestamptz primary key default clock_timestamp(),healthy boolean not null,last_success_at timestamptz,overdue_requests integer not null,pending_count bigint not null,oldest_pending_at timestamptz,operator_retry_count bigint not null);
revoke all on all tables in schema production_scheduler from public,anon,authenticated,service_role;
create or replace function production_scheduler.invoke(p_origin text default 'manual') returns bigint language plpgsql security invoker set search_path='' as $$
declare v_url text; v_secret text; v_id bigint;
begin
if p_origin is null or p_origin not in ('scheduled','manual') then raise exception 'Invalid invocation origin'; end if;
select decrypted_secret into strict v_url from vault.decrypted_secrets where name='h7_production_notification_worker_url';
select decrypted_secret into strict v_secret from vault.decrypted_secrets where name='h7_production_cron_secret';
if v_url is null or v_secret is null or length(v_secret)<32 then raise exception 'Production scheduler configuration unavailable'; end if;
if v_url !~ '^https://[a-zA-Z0-9.-]+/api/internal/notifications/process$' then raise exception 'Invalid worker endpoint'; end if;
v_id:=net.http_post(url:=v_url,body:='{}'::jsonb,headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_secret),timeout_milliseconds:=70000);
insert into production_scheduler.requests(request_id,origin) values(v_id,p_origin); return v_id;
end $$;
create or replace function production_scheduler.check_health() returns boolean language plpgsql security invoker set search_path='' as $$
declare r record; b jsonb; ok boolean; v_last timestamptz; v_overdue integer; v_healthy boolean;
begin
for r in select q.request_id,n.status_code,n.timed_out,n.error_msg,n.content from production_scheduler.requests q join net._http_response n on n.id=q.request_id where q.completed_at is null loop
b:=null; ok:=false;
begin
b:=r.content::jsonb;
ok:=r.status_code=200 and not coalesce(r.timed_out,false) and r.error_msg is null and b->>'provider'='resend' and b->>'budgetExhausted'='false' and (b->>'claimed')::integer=(b->>'sent')::integer and (b->>'claimed')::integer between 0 and 100 and b->>'failed'='0' and b->>'skipped'='0' and b->>'acknowledgementErrors'='0';
update production_scheduler.requests set completed_at=clock_timestamp(),http_status=r.status_code,healthy=coalesce(ok,false),claimed=(b->>'claimed')::integer,sent=(b->>'sent')::integer,failed=(b->>'failed')::integer,skipped=(b->>'skipped')::integer,acknowledgement_errors=(b->>'acknowledgementErrors')::integer,failure_kind=case when coalesce(ok,false) then null else 'HTTP_OR_WORKER_FAILURE' end where request_id=r.request_id;
exception when others then update production_scheduler.requests set completed_at=clock_timestamp(),http_status=r.status_code,healthy=false,failure_kind='INVALID_RESPONSE' where request_id=r.request_id; end;
end loop;
select max(started_at) into v_last from production_scheduler.requests where healthy and origin='scheduled';
select count(*) into v_overdue from production_scheduler.requests where completed_at is null and started_at<clock_timestamp()-interval '2 minutes';
v_healthy:=v_last>clock_timestamp()-interval '10 minutes' and v_overdue=0 and coalesce((select healthy from production_scheduler.requests where origin='scheduled' order by started_at desc limit 1),false);
insert into production_scheduler.watchdog(healthy,last_success_at,overdue_requests,pending_count,oldest_pending_at,operator_retry_count) select coalesce(v_healthy,false),v_last,v_overdue,count(*) filter(where status='PENDING'),min(created_at) filter(where status='PENDING'),count(*) filter(where status='FAILED' and next_attempt_at is null) from public.notification_outbox;
return coalesce(v_healthy,false); end $$;
revoke all on all functions in schema production_scheduler from public,anon,authenticated,service_role;

alter schema production_scheduler owner to postgres;
alter table production_scheduler.requests owner to postgres;
alter table production_scheduler.watchdog owner to postgres;
alter function production_scheduler.invoke(text) owner to postgres;
alter function production_scheduler.check_health() owner to postgres;
alter default privileges in schema production_scheduler revoke execute on functions from public;
select cron.schedule('production-notifications','*/5 * * * *',$cmd$select production_scheduler.invoke('scheduled');$cmd$);
select cron.schedule('production-notifications-watchdog','2-59/5 * * * *',$cmd$select production_scheduler.check_health();$cmd$);
select cron.alter_job(job_id:=jobid,active:=false) from cron.job where username='postgres' and jobname in ('production-notifications','production-notifications-watchdog');
commit;
