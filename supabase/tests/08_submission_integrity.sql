-- H4: unprivileged RPC/RLS tests plus explicitly labelled invariant-trigger tests.
begin;
insert into public.projects(id,user_id,status,brief,orientation,desired_duration_seconds) values ('94000000-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-00000000000a','DRAFT','H4 complete fixture brief with sufficient production detail.','VERTICAL_9_16',15);
insert into public.projects(id,user_id,status,brief,orientation,desired_duration_seconds) values ('94000000-0000-4000-8000-000000000002','aaaaaaaa-0000-4000-8000-00000000000a','DRAFT','H4 complete fixture brief with sufficient production detail.','VERTICAL_9_16',15);
insert into public.projects(id,user_id,status,brief,orientation,desired_duration_seconds) values ('94000000-0000-4000-8000-000000000003','aaaaaaaa-0000-4000-8000-00000000000a','DRAFT','H4 complete fixture brief with sufficient production detail.','VERTICAL_9_16',15);
insert into public.projects(id,user_id,status,brief,orientation,desired_duration_seconds) values ('94000000-0000-4000-8000-000000000004','aaaaaaaa-0000-4000-8000-00000000000a','DRAFT','H4 complete fixture brief with sufficient production detail.','VERTICAL_9_16',15);
insert into public.projects(id,user_id,status,brief,orientation,desired_duration_seconds) values ('94000000-0000-4000-8000-000000000005','aaaaaaaa-0000-4000-8000-00000000000a','DRAFT','H4 complete fixture brief with sufficient production detail.','VERTICAL_9_16',15);
insert into public.projects(id,user_id,status,brief,orientation,desired_duration_seconds) values ('94000000-0000-4000-8000-000000000006','aaaaaaaa-0000-4000-8000-00000000000a','DRAFT','H4 complete fixture brief with sufficient production detail.','VERTICAL_9_16',15);
insert into public.projects(id,user_id,status,brief,orientation,desired_duration_seconds) values ('94000000-0000-4000-8000-000000000007','aaaaaaaa-0000-4000-8000-00000000000a','DRAFT','H4 complete fixture brief with sufficient production detail.','VERTICAL_9_16',15);
insert into public.projects(id,user_id,status,brief,orientation,desired_duration_seconds) values ('94000000-0000-4000-8000-000000000008','bbbbbbbb-0000-4000-8000-00000000000b','DRAFT','H4 complete fixture brief with sufficient production detail.','VERTICAL_9_16',15);
insert into public.projects(id,user_id,status,brief,orientation,desired_duration_seconds) values ('94000000-0000-4000-8000-000000000009','aaaaaaaa-0000-4000-8000-00000000000a','DRAFT','H4 complete fixture brief with sufficient production detail.','VERTICAL_9_16',15);
insert into public.projects(id,user_id,status,brief,orientation,desired_duration_seconds) values ('94000000-0000-4000-8000-000000000010','aaaaaaaa-0000-4000-8000-00000000000a','DRAFT','H4 complete fixture brief with sufficient production detail.','VERTICAL_9_16',15);
insert into public.projects(id,user_id,status,brief,orientation,desired_duration_seconds) values ('94000000-0000-4000-8000-000000000011','aaaaaaaa-0000-4000-8000-00000000000a','DRAFT','H4 complete fixture brief with sufficient production detail.','VERTICAL_9_16',15);
-- A legacy wrong-type fixture: only trusted maintenance can return production to draft.
update public.projects set status='IN_PRODUCTION',submitted_at=now() where id='94000000-0000-4000-8000-000000000009';
insert into public.project_assets(project_id,user_id,asset_type,storage_bucket,storage_path,mime_type,file_size) values ('94000000-0000-4000-8000-000000000009','aaaaaaaa-0000-4000-8000-00000000000a','PREVIEW_VIDEO','project-deliveries','aaaaaaaa-0000-4000-8000-00000000000a/94000000-0000-4000-8000-000000000009/preview.mp4','video/mp4',100);
update public.projects set status='DRAFT' where id='94000000-0000-4000-8000-000000000009';
-- Seed draft consent to exercise identity/OLD and NEW trigger checks independently of RLS.
insert into public.project_consents(project_id,user_id,consent_type,granted,wording_version,granted_at) values ('94000000-0000-4000-8000-000000000010','aaaaaaaa-0000-4000-8000-00000000000a','HAS_LIKENESS_PERMISSION',true,'2026-09-15',now());
select avs_test.become('customer_a');
select avs_test.attempt('H4 submission','Empty project cannot submit through RPC','DENIED',$$ select public.submit_project('94000000-0000-4000-8000-000000000002',true,true,false) $$);
select avs_test.attempt('H4 submission','Another projects reference cannot satisfy empty project','DENIED',$$ select public.submit_project('94000000-0000-4000-8000-000000000002',true,true,false) $$);
insert into storage.objects(bucket_id,name,metadata) values ('reference-images','aaaaaaaa-0000-4000-8000-00000000000a/94000000-0000-4000-8000-000000000003/image.jpg','{"size":100,"mimetype":"image/jpeg"}');
select avs_test.attempt('H4 submission','Storage object alone is insufficient','DENIED',$$ select public.submit_project('94000000-0000-4000-8000-000000000003',true,true,false) $$);
select avs_test.attempt('H4 submission','Cannot manufacture confirmed asset by direct insert','DENIED',$$ insert into public.project_assets(project_id,user_id,asset_type,storage_bucket,storage_path,mime_type,file_size) values ('94000000-0000-4000-8000-000000000003','aaaaaaaa-0000-4000-8000-00000000000a','REFERENCE_IMAGE','reference-images','aaaaaaaa-0000-4000-8000-00000000000a/94000000-0000-4000-8000-000000000003/image.jpg','image/jpeg',100) $$);
select avs_test.attempt('H4 submission','Missing object cannot be confirmed','DENIED',$$ select public.confirm_reference_asset('94000000-0000-4000-8000-000000000002','aaaaaaaa-0000-4000-8000-00000000000a/94000000-0000-4000-8000-000000000002/image.jpg','image.jpg') $$);
select avs_test.attempt('H4 submission','Foreign project cannot be confirmed','DENIED',$$ select public.confirm_reference_asset('94000000-0000-4000-8000-000000000008','aaaaaaaa-0000-4000-8000-00000000000a/94000000-0000-4000-8000-000000000008/image.jpg','image.jpg') $$);
select avs_test.attempt('H4 submission','Malformed confirmation path','DENIED',$$ select public.confirm_reference_asset('94000000-0000-4000-8000-000000000003','aaaaaaaa-0000-4000-8000-00000000000a/94000000-0000-4000-8000-000000000003/../image.jpg','image.jpg') $$);
select avs_test.attempt('H4 submission','Delivery asset does not satisfy reference requirement','DENIED',$$ select public.submit_project('94000000-0000-4000-8000-000000000009',true,true,false) $$);
select avs_test.prepare_submission('94000000-0000-4000-8000-000000000001');
select avs_test.prepare_submission('94000000-0000-4000-8000-000000000004');
select avs_test.prepare_submission('94000000-0000-4000-8000-000000000005');
select avs_test.prepare_submission('94000000-0000-4000-8000-000000000006');
select avs_test.prepare_submission('94000000-0000-4000-8000-000000000007');
select avs_test.attempt('H4 submission','Direct status update blocked: empty','DENIED',$$ update public.projects set status='SUBMITTED',submitted_at=now() where id='94000000-0000-4000-8000-000000000002' $$);
select avs_test.attempt('H4 submission','Direct status update blocked: storage','DENIED',$$ update public.projects set status='SUBMITTED',submitted_at=now() where id='94000000-0000-4000-8000-000000000003' $$);
select avs_test.attempt('H4 submission','Direct status update blocked: valid','DENIED',$$ update public.projects set status='SUBMITTED',submitted_at=now() where id='94000000-0000-4000-8000-000000000001' $$);
select avs_test.attempt('H4 submission','Direct status update blocked: false','DENIED',$$ update public.projects set status='SUBMITTED',submitted_at=now() where id='94000000-0000-4000-8000-000000000007' $$);
select avs_test.attempt('H4 submission','False likeness consent','DENIED',$$ select public.submit_project('94000000-0000-4000-8000-000000000007',false,true,false) $$);
select avs_test.attempt('H4 submission','False processing consent','DENIED',$$ select public.submit_project('94000000-0000-4000-8000-000000000007',true,false,false) $$);
select avs_test.attempt('H4 submission','Null mandatory consent','DENIED',$$ select public.submit_project('94000000-0000-4000-8000-000000000007',null,true,false) $$);
select avs_test.attempt('H4 submission','Null optional consent is invalid input','DENIED',$$ select public.submit_project('94000000-0000-4000-8000-000000000007',true,true,null) $$);
update public.projects set brief='too short' where id='94000000-0000-4000-8000-000000000004';
select avs_test.attempt('H4 submission','Short brief','DENIED',$$ select public.submit_project('94000000-0000-4000-8000-000000000004',true,true,false) $$);
update public.projects set brief=null where id='94000000-0000-4000-8000-000000000004';
select avs_test.attempt('H4 submission','Missing brief','DENIED',$$ select public.submit_project('94000000-0000-4000-8000-000000000004',true,true,false) $$);
update public.projects set brief=repeat(E'\t',45) where id='94000000-0000-4000-8000-000000000004';
select avs_test.attempt('H4 submission','Whitespace brief','DENIED',$$ select public.submit_project('94000000-0000-4000-8000-000000000004',true,true,false) $$);
update public.projects set desired_duration_seconds=null where id='94000000-0000-4000-8000-000000000005';
select avs_test.attempt('H4 submission','Missing duration','DENIED',$$ select public.submit_project('94000000-0000-4000-8000-000000000005',true,true,false) $$);
select avs_test.attempt('H4 submission','Invalid duration rejected on write','DENIED',$$ update public.projects set desired_duration_seconds=181 where id='94000000-0000-4000-8000-000000000005' $$);
update public.projects set orientation=null where id='94000000-0000-4000-8000-000000000006';
select avs_test.attempt('H4 submission','Missing orientation','DENIED',$$ select public.submit_project('94000000-0000-4000-8000-000000000006',true,true,false) $$);
select avs_test.attempt('H4 submission','Missing mandatory consent through direct submission','DENIED',$$ update public.projects set status='SUBMITTED',submitted_at=now() where id='94000000-0000-4000-8000-000000000001' $$);
select avs_test.attempt('H4 submission','Cannot forge direct consent','DENIED',$$ insert into public.project_consents(project_id,user_id,consent_type,granted,wording_version,granted_at) values ('94000000-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-00000000000a','HAS_LIKENESS_PERMISSION',true,'invented',now()) $$);
select avs_test.attempt('H4 submission','Cannot reparent draft consent','DENIED',$$ update public.project_consents set project_id='94000000-0000-4000-8000-000000000011' where project_id='94000000-0000-4000-8000-000000000010' $$);
select avs_test.attempt('H4 submission','Cannot use another customers project','DENIED',$$ select public.submit_project('94000000-0000-4000-8000-000000000008',true,true,false) $$);
select avs_test.become('customer_b');
select avs_test.attempt('H4 submission','Other customer cannot submit A','DENIED',$$ select public.submit_project('94000000-0000-4000-8000-000000000001',true,true,false) $$);
select avs_test.attempt('H4 submission','Other customer cannot confirm A reference','DENIED',$$ select public.confirm_reference_asset('94000000-0000-4000-8000-000000000003','aaaaaaaa-0000-4000-8000-00000000000a/94000000-0000-4000-8000-000000000003/image.jpg','image.jpg') $$);
select avs_test.attempt('H4 submission','Other customer cannot attach consent','DENIED',$$ insert into public.project_consents(project_id,user_id,consent_type,granted,wording_version,granted_at) values ('94000000-0000-4000-8000-000000000001','bbbbbbbb-0000-4000-8000-00000000000b','HAS_LIKENESS_PERMISSION',true,'2026-09-15',now()) $$);
select avs_test.prepare_submission('94000000-0000-4000-8000-000000000008');
select avs_test.become('customer_a');
select avs_test.attempt('H4 submission','Cannot attach another customers asset path','DENIED',$$ select public.confirm_reference_asset('94000000-0000-4000-8000-000000000001','bbbbbbbb-0000-4000-8000-00000000000b/94000000-0000-4000-8000-000000000008/image.jpg','image.jpg') $$);
select avs_test.attempt('H4 submission','Owner reference RPC confirms real object','ALLOWED',$$ select public.confirm_reference_asset('94000000-0000-4000-8000-000000000003','aaaaaaaa-0000-4000-8000-00000000000a/94000000-0000-4000-8000-000000000003/image.jpg','image.jpg') $$);
select avs_test.attempt('H4 submission','Reference confirmation replay','ALLOWED',$$ select public.confirm_reference_asset('94000000-0000-4000-8000-000000000003','aaaaaaaa-0000-4000-8000-00000000000a/94000000-0000-4000-8000-000000000003/image.jpg','renamed-display.jpg') $$);
select avs_test.expect('H4 submission','Reference replay has one committed row','1',(select count(*)::text from public.project_assets where project_id='94000000-0000-4000-8000-000000000003'));
select avs_test.attempt('H4 submission','Valid owner submission with optional consent false','ALLOWED',$$ select public.submit_project('94000000-0000-4000-8000-000000000001',true,true,false) $$);
select avs_test.attempt('H4 submission','Submission replay returns existing project','ALLOWED',$$ select public.submit_project('94000000-0000-4000-8000-000000000001',true,true,false) $$);
select avs_test.attempt('H4 submission','Replay cannot change portfolio consent','DENIED',$$ select public.submit_project('94000000-0000-4000-8000-000000000001',true,true,true) $$);
select avs_test.attempt('H4 submission','Frozen consent cannot be modified','DENIED',$$ update public.project_consents set granted=false,granted_at=null where project_id='94000000-0000-4000-8000-000000000001' $$);
select avs_test.attempt('H4 submission','Draft consent cannot attach to submitted project','DENIED',$$ update public.project_consents set project_id='94000000-0000-4000-8000-000000000001' where project_id='94000000-0000-4000-8000-000000000010' $$);
select avs_test.attempt('H4 submission','New consent cannot attach to submitted project','DENIED',$$ insert into public.project_consents(project_id,user_id,consent_type,granted,wording_version,granted_at) values ('94000000-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-00000000000a','PORTFOLIO_PERMISSION',true,'2026-09-15',now()) $$);
select avs_test.attempt('H4 submission','Submitted reference asset cannot be deleted','DENIED',$$ delete from public.project_assets where project_id='94000000-0000-4000-8000-000000000001' $$);
select avs_test.expect('H4 submission','Exactly one submission history row','1',(select count(*)::text from public.project_status_history where project_id='94000000-0000-4000-8000-000000000001' and to_status='SUBMITTED'));
select avs_test.expect('H4 submission','Consent snapshot has three rows','3',(select count(*)::text from public.project_consents where project_id='94000000-0000-4000-8000-000000000001'));
select avs_test.expect('H4 submission','Optional consent remains false','false',(select granted::text from public.project_consents where project_id='94000000-0000-4000-8000-000000000001' and consent_type='PORTFOLIO_PERMISSION'));
select avs_test.become_postgres();
select avs_test.expect('H4 submission','Replay creates exactly two outbox records','2',(select count(*)::text from public.notification_outbox where project_id='94000000-0000-4000-8000-000000000001'));
select avs_test.expect('H4 submission','Failed submission creates no partial consent','0',(select count(*)::text from public.project_consents where project_id in ('94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000004','94000000-0000-4000-8000-000000000005','94000000-0000-4000-8000-000000000006')));
select avs_test.expect('H4 submission','Failed submission creates no status event','0',(select count(*)::text from public.project_status_history where project_id='94000000-0000-4000-8000-000000000002' and to_status='SUBMITTED'));
do $test$ begin
  begin
    update public.projects set status='SUBMITTED',submitted_at=now() where id='94000000-0000-4000-8000-000000000003';
    perform avs_test.expect('H4 trigger','Privileged transition still requires consent','23514','ALLOWED');
  exception when sqlstate '23514' then
    perform avs_test.expect('H4 trigger','Privileged transition still requires consent','23514',sqlstate);
  end;
end; $test$;
do $test$ begin
  begin
    update public.project_consents set project_id='94000000-0000-4000-8000-000000000011' where project_id='94000000-0000-4000-8000-000000000010';
    perform avs_test.expect('H4 trigger','Identity guard checks old and new projects','42501','ALLOWED');
  exception when sqlstate '42501' then
    perform avs_test.expect('H4 trigger','Identity guard checks old and new projects','42501',sqlstate);
  end;
end; $test$;
do $test$ begin
  begin
    update public.project_consents set granted=false,granted_at=null where project_id='94000000-0000-4000-8000-000000000001';
    perform avs_test.expect('H4 trigger','Consent freeze also applies to privileged writes','42501','ALLOWED');
  exception when sqlstate '42501' then
    perform avs_test.expect('H4 trigger','Consent freeze also applies to privileged writes','42501',sqlstate);
  end;
end; $test$;
insert into public.project_consents(project_id,user_id,consent_type,granted,wording_version,granted_at) values ('94000000-0000-4000-8000-000000000003','aaaaaaaa-0000-4000-8000-00000000000a','HAS_LIKENESS_PERMISSION',false,'2026-09-15',null),('94000000-0000-4000-8000-000000000003','aaaaaaaa-0000-4000-8000-00000000000a','AI_PROCESSING_CONSENT',true,'2026-09-15',now());
do $test$ begin
  begin
    update public.projects set status='SUBMITTED',submitted_at=now() where id='94000000-0000-4000-8000-000000000003';
    perform avs_test.expect('H4 trigger','False stored consent cannot satisfy invariant','23514','ALLOWED');
  exception when sqlstate '23514' then
    perform avs_test.expect('H4 trigger','False stored consent cannot satisfy invariant','23514',sqlstate);
  end;
end; $test$;
update public.project_consents set granted=true,granted_at=now() where project_id='94000000-0000-4000-8000-000000000003';
delete from storage.objects where name='aaaaaaaa-0000-4000-8000-00000000000a/94000000-0000-4000-8000-000000000003/image.jpg';
do $test$ begin
  begin
    update public.projects set status='SUBMITTED',submitted_at=now() where id='94000000-0000-4000-8000-000000000003';
    perform avs_test.expect('H4 trigger','Recorded asset whose object was deleted cannot submit','23514','ALLOWED');
  exception when sqlstate '23514' then
    perform avs_test.expect('H4 trigger','Recorded asset whose object was deleted cannot submit','23514',sqlstate);
  end;
end; $test$;
insert into storage.objects(bucket_id,name,metadata) values ('reference-images','aaaaaaaa-0000-4000-8000-00000000000a/94000000-0000-4000-8000-000000000003/image.jpg','{"size":100,"mimetype":"text/html"}');
do $test$ begin
  begin
    update public.projects set status='SUBMITTED',submitted_at=now() where id='94000000-0000-4000-8000-000000000003';
    perform avs_test.expect('H4 trigger','Wrong Storage MIME invalidates existing recorded asset','23514','ALLOWED');
  exception when sqlstate '23514' then
    perform avs_test.expect('H4 trigger','Wrong Storage MIME invalidates existing recorded asset','23514',sqlstate);
  end;
end; $test$;
select avs_test.expect('H4 grants','confirm_reference_asset(uuid,text,text) not PUBLIC','false',has_function_privilege('public','public.confirm_reference_asset(uuid,text,text)','execute')::text);
select avs_test.expect('H4 grants','confirm_reference_asset(uuid,text,text) allowed authenticated','true',has_function_privilege('authenticated','public.confirm_reference_asset(uuid,text,text)','execute')::text);
select avs_test.expect('H4 grants','submit_project(uuid,boolean,boolean,boolean) not PUBLIC','false',has_function_privilege('public','public.submit_project(uuid,boolean,boolean,boolean)','execute')::text);
select avs_test.expect('H4 grants','submit_project(uuid,boolean,boolean,boolean) allowed authenticated','true',has_function_privilege('authenticated','public.submit_project(uuid,boolean,boolean,boolean)','execute')::text);
select avs_test.become_anon();
select avs_test.attempt('H4 submission','Anonymous submission','DENIED',$$ select public.submit_project('94000000-0000-4000-8000-000000000002',true,true,false) $$);
select avs_test.attempt('H4 submission','Anonymous confirmation','DENIED',$$ select public.confirm_reference_asset('94000000-0000-4000-8000-000000000003','aaaaaaaa-0000-4000-8000-00000000000a/94000000-0000-4000-8000-000000000003/image.jpg','image.jpg') $$);
select avs_test.become('customer_a');
select avs_test.attempt('H4 submission','Confirmation replay after submission','ALLOWED',$$
  select public.confirm_reference_asset('94000000-0000-4000-8000-000000000001',
    (select storage_path from public.project_assets where project_id='94000000-0000-4000-8000-000000000001' and asset_type='REFERENCE_IMAGE' limit 1),'retry.jpg')
$$);
select avs_test.attempt('H4 submission','New confirmation after submission','DENIED',$$
  select public.confirm_reference_asset('94000000-0000-4000-8000-000000000001',
    'aaaaaaaa-0000-4000-8000-00000000000a/94000000-0000-4000-8000-000000000001/new.jpg','new.jpg')
$$);
update public.projects set brief=repeat(U&'\00a0',45) where id='94000000-0000-4000-8000-000000000004';
select avs_test.attempt('H4 submission','Unicode whitespace is not a valid brief','DENIED',$$
  select public.submit_project('94000000-0000-4000-8000-000000000004',true,true,false)
$$);
select avs_test.become_postgres();
commit;
