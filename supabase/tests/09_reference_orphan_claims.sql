-- H2 claim authorization and durable retirement; native concurrency is separate.
begin;
insert into public.projects(id,user_id,status,brief,orientation,desired_duration_seconds) values ('96000000-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-00000000000a','DRAFT','A complete H2 regression brief suitable for production testing.','VERTICAL_9_16',15);
insert into storage.objects(bucket_id,name,metadata,created_at) values ('reference-images','aaaaaaaa-0000-4000-8000-00000000000a/96000000-0000-4000-8000-000000000001/old.jpg','{"size":100,"mimetype":"image/jpeg"}',now()-interval '2 hours');
insert into storage.objects(bucket_id,name,metadata,created_at) values ('reference-images','aaaaaaaa-0000-4000-8000-00000000000a/96000000-0000-4000-8000-000000000001/tracked.jpg','{"size":100,"mimetype":"image/jpeg"}',now()-interval '2 hours');
insert into storage.objects(bucket_id,name,metadata,created_at) values ('reference-images','aaaaaaaa-0000-4000-8000-00000000000a/96000000-0000-4000-8000-000000000001/recent.jpg','{"size":100,"mimetype":"image/jpeg"}',now());
insert into storage.objects(bucket_id,name,metadata,created_at) values ('reference-images','aaaaaaaa-0000-4000-8000-00000000000a/96000000-0000-4000-8000-000000000001/rollback.jpg','{"size":100,"mimetype":"image/jpeg"}',now()-interval '2 hours');
select avs_test.become('customer_a');
select avs_test.attempt('H2 claims','Confirm tracked fixture','ALLOWED',$$ select public.confirm_reference_asset('96000000-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-00000000000a/96000000-0000-4000-8000-000000000001/tracked.jpg','tracked.jpg') $$);
select avs_test.expect('H2 claims','Old orphan claimed once','1',(cardinality(public.claim_reference_orphans('96000000-0000-4000-8000-000000000001',array['aaaaaaaa-0000-4000-8000-00000000000a/96000000-0000-4000-8000-000000000001/old.jpg']::text[])))::text);
select avs_test.expect('H2 claims','Claim replay returns same path','1',(cardinality(public.claim_reference_orphans('96000000-0000-4000-8000-000000000001',array['aaaaaaaa-0000-4000-8000-00000000000a/96000000-0000-4000-8000-000000000001/old.jpg']::text[])))::text);
select avs_test.expect('H2 claims','Tracked recent and missing objects not claimed','0',(cardinality(public.claim_reference_orphans('96000000-0000-4000-8000-000000000001',array['aaaaaaaa-0000-4000-8000-00000000000a/96000000-0000-4000-8000-000000000001/tracked.jpg','aaaaaaaa-0000-4000-8000-00000000000a/96000000-0000-4000-8000-000000000001/recent.jpg','aaaaaaaa-0000-4000-8000-00000000000a/96000000-0000-4000-8000-000000000001/missing.jpg']::text[])))::text);
select avs_test.attempt('H2 claims','Claimed object cannot confirm','DENIED',$$ select public.confirm_reference_asset('96000000-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-00000000000a/96000000-0000-4000-8000-000000000001/old.jpg','old.jpg') $$);
select avs_test.attempt('H2 claims','Claimed object cannot be overwritten','DENIED',$$ update storage.objects set metadata='{"size":101,"mimetype":"image/jpeg"}' where name='aaaaaaaa-0000-4000-8000-00000000000a/96000000-0000-4000-8000-000000000001/old.jpg' $$);
select avs_test.attempt('H2 claims','Claimed object cannot move','DENIED',$$ update storage.objects set name='aaaaaaaa-0000-4000-8000-00000000000a/96000000-0000-4000-8000-000000000001/renamed.jpg' where name='aaaaaaaa-0000-4000-8000-00000000000a/96000000-0000-4000-8000-000000000001/old.jpg' $$);
select avs_test.attempt('H2 claims','Cannot move onto a claimed path','DENIED',$$ update storage.objects set name='aaaaaaaa-0000-4000-8000-00000000000a/96000000-0000-4000-8000-000000000001/old.jpg' where name='aaaaaaaa-0000-4000-8000-00000000000a/96000000-0000-4000-8000-000000000001/recent.jpg' $$);
select avs_test.attempt('H2 claims','Owner cannot remove claim','DENIED',$$ delete from public.reference_orphan_claims where storage_path='aaaaaaaa-0000-4000-8000-00000000000a/96000000-0000-4000-8000-000000000001/old.jpg' $$);
select avs_test.attempt('H2 claims','Owner cannot forge claim','DENIED',$$ insert into public.reference_orphan_claims(storage_path,project_id) values ('aaaaaaaa-0000-4000-8000-00000000000a/96000000-0000-4000-8000-000000000001/tracked.jpg','96000000-0000-4000-8000-000000000001') $$);
select avs_test.attempt('H2 claims','Malformed path refused','DENIED',$$ select public.claim_reference_orphans('96000000-0000-4000-8000-000000000001',array['malformed']) $$);
select avs_test.attempt('H2 claims','Wrong owner prefix refused','DENIED',$$ select public.claim_reference_orphans('96000000-0000-4000-8000-000000000001',array['bbbbbbbb-0000-4000-8000-00000000000b/96000000-0000-4000-8000-000000000001/old.jpg']) $$);
select avs_test.attempt('H2 claims','Oversized batch refused','DENIED',$$ select public.claim_reference_orphans('96000000-0000-4000-8000-000000000001',array_fill('aaaaaaaa-0000-4000-8000-00000000000a/96000000-0000-4000-8000-000000000001/old.jpg'::text,array[101])) $$);
select avs_test.attempt('H2 claims','Null batch refused','DENIED',$$ select public.claim_reference_orphans('96000000-0000-4000-8000-000000000001',null) $$);
select avs_test.expect('H2 claims','Empty batch allowed','0',(cardinality(public.claim_reference_orphans('96000000-0000-4000-8000-000000000001',array[]::text[])))::text);
select avs_test.attempt('H2 claims','Claim batch rolls back on invalid path','DENIED',$$ select public.claim_reference_orphans('96000000-0000-4000-8000-000000000001',array['aaaaaaaa-0000-4000-8000-00000000000a/96000000-0000-4000-8000-000000000001/rollback.jpg','invalid']) $$);
select avs_test.attempt('H2 claims','Rolled back claim does not retire object','ALLOWED',$$ select public.confirm_reference_asset('96000000-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-00000000000a/96000000-0000-4000-8000-000000000001/rollback.jpg','rollback.jpg') $$);
select avs_test.attempt('H2 claims','Claimed draft orphan may be deleted','ALLOWED',$$ delete from storage.objects where name='aaaaaaaa-0000-4000-8000-00000000000a/96000000-0000-4000-8000-000000000001/old.jpg' $$);
select avs_test.expect('H2 claims','Lost delete response retry is safe','1',(cardinality(public.claim_reference_orphans('96000000-0000-4000-8000-000000000001',array['aaaaaaaa-0000-4000-8000-00000000000a/96000000-0000-4000-8000-000000000001/old.jpg']::text[])))::text);
select avs_test.attempt('H2 claims','Deleted claimed path cannot be reused','DENIED',$$ insert into storage.objects(bucket_id,name,metadata) values ('reference-images','aaaaaaaa-0000-4000-8000-00000000000a/96000000-0000-4000-8000-000000000001/old.jpg','{"size":100,"mimetype":"image/jpeg"}') $$);
select avs_test.become('customer_b');
select avs_test.attempt('H2 claims','Another customer cannot claim','DENIED',$$ select public.claim_reference_orphans('96000000-0000-4000-8000-000000000001',array['aaaaaaaa-0000-4000-8000-00000000000a/96000000-0000-4000-8000-000000000001/recent.jpg']::text[]) $$);
select avs_test.become_anon();
select avs_test.attempt('H2 claims','Anonymous cannot claim','DENIED',$$ select public.claim_reference_orphans('96000000-0000-4000-8000-000000000001',array['aaaaaaaa-0000-4000-8000-00000000000a/96000000-0000-4000-8000-000000000001/recent.jpg']::text[]) $$);
select avs_test.become_postgres();
set local role service_role;
do $$ begin
 begin
  insert into public.project_assets(project_id,user_id,asset_type,storage_bucket,storage_path,mime_type,file_size)
  values ('96000000-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-00000000000a','REFERENCE_IMAGE','reference-images','aaaaaaaa-0000-4000-8000-00000000000a/96000000-0000-4000-8000-000000000001/old.jpg','image/jpeg',100);
  perform avs_test.expect('H2 claims','Privileged asset insertion cannot bypass claim','23514','ALLOWED');
 exception when sqlstate '23514' then
  perform avs_test.expect('H2 claims','Privileged asset insertion cannot bypass claim','23514',sqlstate);
 end;
end $$;
select avs_test.become('customer_a');
select avs_test.attempt('H2 claims','Submit with confirmed unclaimed assets','ALLOWED',$$ select public.submit_project('96000000-0000-4000-8000-000000000001',true,true,false) $$);
select avs_test.expect('H2 claims','Submitted project claims nothing','0',(cardinality(public.claim_reference_orphans('96000000-0000-4000-8000-000000000001',array['aaaaaaaa-0000-4000-8000-00000000000a/96000000-0000-4000-8000-000000000001/recent.jpg']::text[])))::text);
select avs_test.attempt('H2 claims','Confirmation replay still works after submit','ALLOWED',$$ select public.confirm_reference_asset('96000000-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-00000000000a/96000000-0000-4000-8000-000000000001/tracked.jpg','retry.jpg') $$);
select avs_test.become_postgres();
select avs_test.expect('H2 claims','Claim table has RLS','true',(select relrowsecurity from pg_class where oid='public.reference_orphan_claims'::regclass)::text);
select avs_test.expect('H2 claims','Claim RPC not PUBLIC','false',(has_function_privilege('public','public.claim_reference_orphans(uuid,text[])','execute'))::text);
select avs_test.expect('H2 claims','Claim RPC granted authenticated','true',(has_function_privilege('authenticated','public.claim_reference_orphans(uuid,text[])','execute'))::text);
commit;

