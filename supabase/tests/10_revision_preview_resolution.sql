-- H5: run through authenticated RPCs, with assertions on durable records.
begin;
insert into avs_test.ids(k,v) values ('h5_project','97000000-0000-4000-8000-000000000001');
insert into public.projects(id,user_id,status,brief,orientation,desired_duration_seconds,submitted_at)
values (avs_test.id('h5_project'),avs_test.id('customer_a'),'IN_PRODUCTION',
  'An H5 regression fixture with a complete production brief.','VERTICAL_9_16',15,now());

select avs_test.become('admin');
select public.record_delivery_asset(avs_test.id('h5_project'),'PREVIEW_VIDEO',
  avs_test.id('customer_a')||'/'||avs_test.id('h5_project')||'/one.mp4','video/mp4','one.mp4',1000);
select avs_test.become('customer_a');
select public.request_project_revision(avs_test.id('h5_project'),avs_test.preview_id('h5_project',1),
  'Please replace the opening sequence with the alternate shot.');
select avs_test.become('admin');
update public.projects set status='IN_PRODUCTION' where id=avs_test.id('h5_project');
select avs_test.attempt('H5','Status-only reannouncement refused','DENIED',
  $$update public.projects set status='PREVIEW_READY' where id=avs_test.id('h5_project')$$);
select avs_test.expect('H5','Rejected preview leaves revision open','true',
  (select (status='OPEN' and resolved_at is null and resolved_by_preview_asset_id is null)::text
   from public.project_revisions where project_id=avs_test.id('h5_project')));
select avs_test.expect('H5','No false preview notification','1',
  (select count(*)::text from public.notification_outbox where project_id=avs_test.id('h5_project')
   and event_type in ('PREVIEW_READY_CUSTOMER','PREVIEW_REVISED_CUSTOMER')));
select avs_test.attempt('H5','Rejected object path cannot be recorded again','DENIED',
  $$select public.record_delivery_asset(avs_test.id('h5_project'),'PREVIEW_VIDEO',
    avs_test.id('customer_a')||'/'||avs_test.id('h5_project')||'/one.mp4','video/mp4','one.mp4',1000)$$);
select avs_test.expect('H5','Failed duplicate leaves one asset','1',
  (select count(*)::text from public.project_assets where project_id=avs_test.id('h5_project')));

-- A recorded replacement and its announcement/resolution are one transaction.
savepoint replacement;
select public.record_delivery_asset(avs_test.id('h5_project'),'PREVIEW_VIDEO',
  avs_test.id('customer_a')||'/'||avs_test.id('h5_project')||'/two.mp4','video/mp4','two.mp4',1000);
select avs_test.expect('H5','Replacement resolves with exact identity','true',
  (select (status='RESOLVED' and resolved_at is not null
    and preview_asset_id=avs_test.preview_id('h5_project',1)
    and resolved_by_preview_asset_id=avs_test.preview_id('h5_project',2))::text
   from public.project_revisions where project_id=avs_test.id('h5_project')));
-- This assertion is deliberately repeated after rollback; savepoint rolls back
-- the assertion row as well as the asset, resolution, status and outbox rows.
rollback to savepoint replacement;
select avs_test.expect('H5','Rollback restores unresolved revision','true',
  (select (status='OPEN' and resolved_at is null and resolved_by_preview_asset_id is null)::text
   from public.project_revisions where project_id=avs_test.id('h5_project')));
select avs_test.expect('H5','Rollback removes replacement notification','1',
  (select count(*)::text from public.notification_outbox where project_id=avs_test.id('h5_project')
   and event_type in ('PREVIEW_READY_CUSTOMER','PREVIEW_REVISED_CUSTOMER')));
select public.record_delivery_asset(avs_test.id('h5_project'),'PREVIEW_VIDEO',
  avs_test.id('customer_a')||'/'||avs_test.id('h5_project')||'/two.mp4','video/mp4','two.mp4',1000);
select avs_test.expect('H5','Replacement resolves with exact identity','true',
  (select (status='RESOLVED' and resolved_at is not null
    and preview_asset_id=avs_test.preview_id('h5_project',1)
    and resolved_by_preview_asset_id=avs_test.preview_id('h5_project',2))::text
   from public.project_revisions where project_id=avs_test.id('h5_project')));
select avs_test.expect('H5','Exactly one revised-preview notification','1',
  (select count(*)::text from public.notification_outbox where project_id=avs_test.id('h5_project')
   and event_type='PREVIEW_REVISED_CUSTOMER'));

select avs_test.become_postgres();
create temporary table h5_history as
 select * from public.project_revisions where project_id=avs_test.id('h5_project');
grant select on h5_history to authenticated;
select avs_test.become('customer_a');
select public.request_project_revision(avs_test.id('h5_project'),avs_test.preview_id('h5_project',2),
  'Please change the closing sequence on the second preview.');
select avs_test.become('admin');
update public.projects set status='IN_PRODUCTION' where id=avs_test.id('h5_project');
select avs_test.attempt('H5','Prior replacement cannot resolve next revision','DENIED',
 $$select public.record_delivery_asset(avs_test.id('h5_project'),'PREVIEW_VIDEO',
   avs_test.id('customer_a')||'/'||avs_test.id('h5_project')||'/two.mp4','video/mp4','two.mp4',1000)$$);
select public.record_delivery_asset(avs_test.id('h5_project'),'PREVIEW_VIDEO',
  avs_test.id('customer_a')||'/'||avs_test.id('h5_project')||'/three.mp4','video/mp4','three.mp4',1000);
select avs_test.expect('H5','New preview resolves only the current revision','1',
 (select count(*)::text from public.project_revisions where project_id=avs_test.id('h5_project')
  and preview_asset_id=avs_test.preview_id('h5_project',2)
  and resolved_by_preview_asset_id=avs_test.preview_id('h5_project',3) and status='RESOLVED'));
select avs_test.expect('H5','Previous resolution timestamp and identity unchanged','true',
 (select (r.resolved_at=h.resolved_at and r.updated_at=h.updated_at
  and r.resolved_by_preview_asset_id=h.resolved_by_preview_asset_id)::text
  from public.project_revisions r join h5_history h using(id)));
select avs_test.attempt('H5','Direct duplicate RPC creates no new revision state','DENIED',
 $$select public.record_delivery_asset(avs_test.id('h5_project'),'PREVIEW_VIDEO',
   avs_test.id('customer_a')||'/'||avs_test.id('h5_project')||'/three.mp4','video/mp4','three.mp4',1000)$$);
select avs_test.expect('H5','Three distinct authoritative previews','3',
 (select count(*)::text from public.project_assets where project_id=avs_test.id('h5_project')));
select avs_test.expect('H5','Two revisions resolved exactly once','2',
 (select count(*)::text from public.project_revisions where project_id=avs_test.id('h5_project') and status='RESOLVED'));
select avs_test.expect('H5','One notification per preview identity','3',
 (select count(*)::text from public.notification_outbox where project_id=avs_test.id('h5_project')
 and event_type in ('PREVIEW_READY_CUSTOMER','PREVIEW_REVISED_CUSTOMER')));
select avs_test.become('customer_a');
select avs_test.attempt('H5','Customer cannot forge resolution','DENIED',
 $$update public.project_revisions set resolved_by_preview_asset_id=avs_test.preview_id('h5_project',1)
 where project_id=avs_test.id('h5_project')$$);
select avs_test.become('admin');
select avs_test.attempt('H5','Admin cannot directly forge revision resolution','DENIED',
 $$update public.project_revisions set resolved_by_preview_asset_id=avs_test.preview_id('h5_project',1)
 where project_id=avs_test.id('h5_project')$$);

-- A legacy open request whose rejected asset has been removed has no reliable
-- version baseline. New uploads on other projects, or on this project, cannot
-- invent a resolution for it.
select avs_test.become_postgres();
insert into avs_test.ids(k,v) values ('h5_missing','97000000-0000-4000-8000-000000000002');
insert into public.projects(id,user_id,status,brief,orientation,desired_duration_seconds,submitted_at)
values (avs_test.id('h5_missing'),avs_test.id('customer_a'),'IN_PRODUCTION',
 'A legacy H5 fixture with a missing rejected preview asset.','VERTICAL_9_16',15,now());
insert into public.project_revisions(project_id,user_id,message)
values (avs_test.id('h5_missing'),avs_test.id('customer_a'),'Please replace the opening sequence with another shot.');
select avs_test.become('admin');
select avs_test.attempt('H5','Missing rejected baseline fails closed','DENIED',
 $$select public.record_delivery_asset(avs_test.id('h5_missing'),'PREVIEW_VIDEO',
   avs_test.id('customer_a')||'/'||avs_test.id('h5_missing')||'/new.mp4','video/mp4','new.mp4',1000)$$);
select avs_test.expect('H5','Failed announcement rolls back inserted replacement','0',
 (select count(*)::text from public.project_assets where project_id=avs_test.id('h5_missing')));
select avs_test.expect('H5','Missing baseline remains open','true',
 (select (status='OPEN' and resolved_at is null and resolved_by_preview_asset_id is null)::text
  from public.project_revisions where project_id=avs_test.id('h5_missing')));

-- Direct admin inserts use the same asset trigger; callers cannot choose the
-- version. Another project's unresolved revision/history must stay untouched.
select avs_test.become('customer_a');
select public.request_project_revision(avs_test.id('h5_project'),avs_test.preview_id('h5_project',3),
 'Please change the closing titles on the third preview.');
select avs_test.become('admin');
update public.projects set status='IN_PRODUCTION' where id=avs_test.id('h5_project');
insert into public.project_assets(project_id,user_id,asset_type,storage_bucket,storage_path,mime_type,file_size,version)
values (avs_test.id('h5_project'),avs_test.id('customer_a'),'PREVIEW_VIDEO','project-deliveries',
 avs_test.id('customer_a')||'/'||avs_test.id('h5_project')||'/four.mp4','video/mp4',1000,999);
select avs_test.expect('H5','Version is assigned authoritatively','4',
 (select version::text from public.project_assets where project_id=avs_test.id('h5_project') and storage_path like '%/four.mp4'));
select avs_test.expect('H5','Direct insert resolves with version four before announcement','1',
 (select count(*)::text from public.project_revisions where project_id=avs_test.id('h5_project')
  and status='RESOLVED' and resolved_by_preview_asset_id=avs_test.preview_id('h5_project',4)));
select avs_test.expect('H5','Other project open revision is untouched','OPEN',
 (select status::text from public.project_revisions where project_id=avs_test.id('h5_missing')));
select avs_test.expect('H5','Later assets leave resolved history intact','true',
 (select (r.resolved_at=h.resolved_at and r.updated_at=h.updated_at
  and r.resolved_by_preview_asset_id=h.resolved_by_preview_asset_id)::text
  from public.project_revisions r join h5_history h using(id)));

-- Even break-glass status updates cannot reintroduce the status-only defect.
select avs_test.become_postgres();
do $$
begin
  begin
    update public.projects set status='PREVIEW_READY' where id=avs_test.id('h5_missing');
    raise exception 'H5 privileged announcement unexpectedly succeeded';
  exception when check_violation then
    perform avs_test.expect('H5','Privileged status-only announcement is blocked','23514',sqlstate);
  end;
end;
$$;
commit;
