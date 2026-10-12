-- H3: real SQL policy/trigger execution, not the Supabase HTTP Storage service.
begin;
insert into public.projects(id,user_id,status,brief) values
('93000000-0000-4000-8000-000000000012','aaaaaaaa-0000-4000-8000-00000000000a','DRAFT','H3 second owned draft');
insert into public.projects(id,user_id,status,brief) values
('93000000-0000-4000-8000-000000000009','aaaaaaaa-0000-4000-8000-00000000000a','DRAFT','H3 owner draft'),('93000000-0000-4000-8000-000000000010','bbbbbbbb-0000-4000-8000-00000000000b','DRAFT','H3 other draft');
select avs_test.become('customer_b');
insert into storage.objects(bucket_id,name,metadata) values ('reference-images','bbbbbbbb-0000-4000-8000-00000000000b/93000000-0000-4000-8000-000000000010/h3.jpg','{"size":100,"mimetype":"image/jpeg"}');
select avs_test.become('customer_a');
select avs_test.attempt('H3 Storage', 'Owner uploads draft without asset metadata', 'ALLOWED', $$ insert into storage.objects(bucket_id,name,metadata) values ('reference-images','aaaaaaaa-0000-4000-8000-00000000000a/93000000-0000-4000-8000-000000000009/h3.jpg','{"size":100,"mimetype":"image/jpeg"}') $$);
select avs_test.attempt('H3 Storage', 'Owner replaces draft bytes metadata', 'ALLOWED', $$ update storage.objects set metadata='{"size":101}' where bucket_id='reference-images' and name='aaaaaaaa-0000-4000-8000-00000000000a/93000000-0000-4000-8000-000000000009/h3.jpg' $$);
select avs_test.attempt('H3 Storage', 'Owner renames draft', 'ALLOWED', $$ update storage.objects set name='aaaaaaaa-0000-4000-8000-00000000000a/93000000-0000-4000-8000-000000000009/renamed.jpg' where bucket_id='reference-images' and name='aaaaaaaa-0000-4000-8000-00000000000a/93000000-0000-4000-8000-000000000009/h3.jpg' $$);
select avs_test.attempt('H3 Storage', 'Owner renames draft back', 'ALLOWED', $$ update storage.objects set name='aaaaaaaa-0000-4000-8000-00000000000a/93000000-0000-4000-8000-000000000009/h3.jpg' where bucket_id='reference-images' and name='aaaaaaaa-0000-4000-8000-00000000000a/93000000-0000-4000-8000-000000000009/renamed.jpg' $$);
select avs_test.attempt('H3 Storage', 'Owner deletes draft', 'ALLOWED', $$ delete from storage.objects where bucket_id='reference-images' and name='aaaaaaaa-0000-4000-8000-00000000000a/93000000-0000-4000-8000-000000000009/h3.jpg' $$);
select avs_test.attempt('H3 Storage', 'Owner reuploads draft', 'ALLOWED', $$ insert into storage.objects(bucket_id,name,metadata) values ('reference-images','aaaaaaaa-0000-4000-8000-00000000000a/93000000-0000-4000-8000-000000000009/h3.jpg','{"size":100,"mimetype":"image/jpeg"}') $$);
select avs_test.attempt('H3 Storage', 'Other customer cannot read draft', 'DENIED', $$ select * from storage.objects where name='bbbbbbbb-0000-4000-8000-00000000000b/93000000-0000-4000-8000-000000000010/h3.jpg' $$);
select avs_test.attempt('H3 Storage', 'Other customer cannot overwrite draft', 'DENIED', $$ update storage.objects set metadata='{"size":0}' where bucket_id='reference-images' and name='bbbbbbbb-0000-4000-8000-00000000000b/93000000-0000-4000-8000-000000000010/h3.jpg' $$);
select avs_test.attempt('H3 Storage', 'Other customer cannot delete draft', 'DENIED', $$ delete from storage.objects where bucket_id='reference-images' and name='bbbbbbbb-0000-4000-8000-00000000000b/93000000-0000-4000-8000-000000000010/h3.jpg' $$);
select avs_test.attempt('H3 Storage', 'Other customer cannot upload into draft', 'DENIED', $$ insert into storage.objects(bucket_id,name,metadata) values ('reference-images','bbbbbbbb-0000-4000-8000-00000000000b/93000000-0000-4000-8000-000000000010/planted.jpg','{"size":100,"mimetype":"image/jpeg"}') $$);
select avs_test.attempt('H3 Storage', 'Missing project', 'DENIED', $$ insert into storage.objects(bucket_id,name,metadata) values ('reference-images','aaaaaaaa-0000-4000-8000-00000000000a/99999999-0000-4000-8000-000000000099/x.jpg','{"size":100,"mimetype":"image/jpeg"}') $$);
select avs_test.attempt('H3 Storage', 'Own prefix with foreign project', 'DENIED', $$ insert into storage.objects(bucket_id,name,metadata) values ('reference-images','aaaaaaaa-0000-4000-8000-00000000000a/93000000-0000-4000-8000-000000000010/x.jpg','{"size":100,"mimetype":"image/jpeg"}') $$);
select avs_test.attempt('H3 Storage', 'Missing filename', 'DENIED', $$ insert into storage.objects(bucket_id,name,metadata) values ('reference-images','aaaaaaaa-0000-4000-8000-00000000000a/93000000-0000-4000-8000-000000000009/','{"size":100,"mimetype":"image/jpeg"}') $$);
select avs_test.attempt('H3 Storage', 'Nested path', 'DENIED', $$ insert into storage.objects(bucket_id,name,metadata) values ('reference-images','aaaaaaaa-0000-4000-8000-00000000000a/93000000-0000-4000-8000-000000000009/nested/x.jpg','{"size":100,"mimetype":"image/jpeg"}') $$);
select avs_test.attempt('H3 Storage', 'Traversal', 'DENIED', $$ insert into storage.objects(bucket_id,name,metadata) values ('reference-images','aaaaaaaa-0000-4000-8000-00000000000a/93000000-0000-4000-8000-000000000009/../x.jpg','{"size":100,"mimetype":"image/jpeg"}') $$);
select avs_test.attempt('H3 Storage', 'Root path', 'DENIED', $$ insert into storage.objects(bucket_id,name,metadata) values ('reference-images','x.jpg','{"size":100,"mimetype":"image/jpeg"}') $$);
select avs_test.attempt('H3 Storage', 'Malformed project', 'DENIED', $$ insert into storage.objects(bucket_id,name,metadata) values ('reference-images','aaaaaaaa-0000-4000-8000-00000000000a/not-uuid/x.jpg','{"size":100,"mimetype":"image/jpeg"}') $$);
select avs_test.attempt('H3 Storage', 'Empty project', 'DENIED', $$ insert into storage.objects(bucket_id,name,metadata) values ('reference-images','aaaaaaaa-0000-4000-8000-00000000000a//x.jpg','{"size":100,"mimetype":"image/jpeg"}') $$);
select avs_test.attempt('H3 Storage', 'Leading slash', 'DENIED', $$ insert into storage.objects(bucket_id,name,metadata) values ('reference-images','/aaaaaaaa-0000-4000-8000-00000000000a/93000000-0000-4000-8000-000000000009/h3.jpg','{"size":100,"mimetype":"image/jpeg"}') $$);
select avs_test.attempt('H3 Storage', 'Backslash', 'DENIED', $$ insert into storage.objects(bucket_id,name,metadata) values ('reference-images','aaaaaaaa-0000-4000-8000-00000000000a/93000000-0000-4000-8000-000000000009/x\y.jpg','{"size":100,"mimetype":"image/jpeg"}') $$);
select avs_test.attempt('H3 Storage', 'Encoded traversal', 'DENIED', $$ insert into storage.objects(bucket_id,name,metadata) values ('reference-images','aaaaaaaa-0000-4000-8000-00000000000a/93000000-0000-4000-8000-000000000009/%2e%2e.jpg','{"size":100,"mimetype":"image/jpeg"}') $$);
select avs_test.attempt('H3 Storage', 'Cannot move draft into foreign project', 'DENIED', $$ update storage.objects set name='aaaaaaaa-0000-4000-8000-00000000000a/93000000-0000-4000-8000-000000000010/x.jpg' where bucket_id='reference-images' and name='aaaaaaaa-0000-4000-8000-00000000000a/93000000-0000-4000-8000-000000000009/h3.jpg' $$);
select avs_test.attempt('H3 Storage', 'Cannot move draft into missing project', 'DENIED', $$ update storage.objects set name='aaaaaaaa-0000-4000-8000-00000000000a/99999999-0000-4000-8000-000000000099/x.jpg' where bucket_id='reference-images' and name='aaaaaaaa-0000-4000-8000-00000000000a/93000000-0000-4000-8000-000000000009/h3.jpg' $$);
select avs_test.attempt('H3 Storage', 'Cannot move draft into submitted project', 'DENIED', $$ update storage.objects set name='aaaaaaaa-0000-4000-8000-00000000000a/11111111-0000-4000-8000-000000000001/moved.jpg' where bucket_id='reference-images' and name='aaaaaaaa-0000-4000-8000-00000000000a/93000000-0000-4000-8000-000000000009/h3.jpg' $$);
-- Same object exists before and after the transition, ruling out absent-target passes.
update public.projects set brief='H3 submitted project with a complete brief for verification.', orientation='VERTICAL_9_16',desired_duration_seconds=15 where id='93000000-0000-4000-8000-000000000009';
select public.confirm_reference_asset('93000000-0000-4000-8000-000000000009','aaaaaaaa-0000-4000-8000-00000000000a/93000000-0000-4000-8000-000000000009/h3.jpg','h3.jpg');
select public.submit_project('93000000-0000-4000-8000-000000000009',true,true,false);
select avs_test.expect('H3 Storage','Fixture is submitted','SUBMITTED',(select status::text from public.projects where id='93000000-0000-4000-8000-000000000009'));
select avs_test.attempt('H3 Storage', 'Submitted reference remains readable', 'ALLOWED', $$ select * from storage.objects where name='aaaaaaaa-0000-4000-8000-00000000000a/93000000-0000-4000-8000-000000000009/h3.jpg' $$);
select avs_test.attempt('H3 Storage', 'Submitted owner overwrite', 'DENIED', $$ update storage.objects set metadata='{"size":0}' where bucket_id='reference-images' and name='aaaaaaaa-0000-4000-8000-00000000000a/93000000-0000-4000-8000-000000000009/h3.jpg' $$);
select avs_test.attempt('H3 Storage', 'Submitted owner delete', 'DENIED', $$ delete from storage.objects where bucket_id='reference-images' and name='aaaaaaaa-0000-4000-8000-00000000000a/93000000-0000-4000-8000-000000000009/h3.jpg' $$);
select avs_test.attempt('H3 Storage', 'Submitted owner rename', 'DENIED', $$ update storage.objects set name='aaaaaaaa-0000-4000-8000-00000000000a/93000000-0000-4000-8000-000000000009/renamed.jpg' where bucket_id='reference-images' and name='aaaaaaaa-0000-4000-8000-00000000000a/93000000-0000-4000-8000-000000000009/h3.jpg' $$);
select avs_test.attempt('H3 Storage', 'Submitted owner move into own valid draft', 'DENIED', $$ update storage.objects set name='aaaaaaaa-0000-4000-8000-00000000000a/93000000-0000-4000-8000-000000000012/moved.jpg' where bucket_id='reference-images' and name='aaaaaaaa-0000-4000-8000-00000000000a/93000000-0000-4000-8000-000000000009/h3.jpg' $$);
select avs_test.attempt('H3 Storage', 'Submitted owner add', 'DENIED', $$ insert into storage.objects(bucket_id,name,metadata) values ('reference-images','aaaaaaaa-0000-4000-8000-00000000000a/93000000-0000-4000-8000-000000000009/new.jpg','{"size":100,"mimetype":"image/jpeg"}') $$);
select avs_test.attempt('H3 Storage', 'Submitted owner upsert', 'DENIED', $$ insert into storage.objects(bucket_id,name,metadata) values ('reference-images','aaaaaaaa-0000-4000-8000-00000000000a/93000000-0000-4000-8000-000000000009/h3.jpg','{"size":100,"mimetype":"image/jpeg"}') on conflict(bucket_id,name) do update set metadata=excluded.metadata $$);
select avs_test.become('customer_b');
select avs_test.attempt('H3 Storage', 'Other customer submitted read', 'DENIED', $$ select * from storage.objects where name='aaaaaaaa-0000-4000-8000-00000000000a/93000000-0000-4000-8000-000000000009/h3.jpg' $$);
select avs_test.attempt('H3 Storage', 'Other customer submitted overwrite', 'DENIED', $$ update storage.objects set metadata='{"size":0}' where bucket_id='reference-images' and name='aaaaaaaa-0000-4000-8000-00000000000a/93000000-0000-4000-8000-000000000009/h3.jpg' $$);
select avs_test.attempt('H3 Storage', 'Other customer submitted delete', 'DENIED', $$ delete from storage.objects where bucket_id='reference-images' and name='aaaaaaaa-0000-4000-8000-00000000000a/93000000-0000-4000-8000-000000000009/h3.jpg' $$);
select avs_test.attempt('H3 Storage', 'Other customer submitted add', 'DENIED', $$ insert into storage.objects(bucket_id,name,metadata) values ('reference-images','aaaaaaaa-0000-4000-8000-00000000000a/93000000-0000-4000-8000-000000000009/foreign.jpg','{"size":100,"mimetype":"image/jpeg"}') $$);
select avs_test.become('admin');
select avs_test.attempt('H3 Storage', 'Admin can still read submitted reference', 'ALLOWED', $$ select * from storage.objects where name='aaaaaaaa-0000-4000-8000-00000000000a/93000000-0000-4000-8000-000000000009/h3.jpg' $$);
select avs_test.attempt('H3 Storage', 'Admin has no new customer-reference write privilege', 'DENIED', $$ delete from storage.objects where bucket_id='reference-images' and name='aaaaaaaa-0000-4000-8000-00000000000a/93000000-0000-4000-8000-000000000009/h3.jpg' $$);
select avs_test.become_postgres();
-- Privileged Storage completion (e.g. previously signed token): bypassing RLS
-- must still hit the trigger. Assert specific SQLSTATE, not arbitrary failure.
set local role service_role;
do $test$
begin
  begin
    insert into storage.objects(bucket_id,name,metadata) values ('reference-images','aaaaaaaa-0000-4000-8000-00000000000a/93000000-0000-4000-8000-000000000009/late.jpg','{"size":100,"mimetype":"image/jpeg"}');
    perform avs_test.expect('H3 Storage','Privileged late signed-token insert','42501','ALLOWED');
  exception when insufficient_privilege then
    perform avs_test.expect('H3 Storage','Privileged late signed-token insert','42501',sqlstate);
  end;
  begin
    update storage.objects set metadata='{"size":0}' where bucket_id='reference-images' and name='aaaaaaaa-0000-4000-8000-00000000000a/93000000-0000-4000-8000-000000000009/h3.jpg';
    perform avs_test.expect('H3 Storage','Privileged overwrite','42501','ALLOWED');
  exception when insufficient_privilege then
    perform avs_test.expect('H3 Storage','Privileged overwrite','42501',sqlstate);
  end;
  begin
    delete from storage.objects where bucket_id='reference-images' and name='aaaaaaaa-0000-4000-8000-00000000000a/93000000-0000-4000-8000-000000000009/h3.jpg';
    perform avs_test.expect('H3 Storage','Privileged delete','42501','ALLOWED');
  exception when insufficient_privilege then
    perform avs_test.expect('H3 Storage','Privileged delete','42501',sqlstate);
  end;
  begin
    update storage.objects set name='bbbbbbbb-0000-4000-8000-00000000000b/93000000-0000-4000-8000-000000000010/moved.jpg' where bucket_id='reference-images' and name='aaaaaaaa-0000-4000-8000-00000000000a/93000000-0000-4000-8000-000000000009/h3.jpg';
    perform avs_test.expect('H3 Storage','Privileged move out to draft','42501','ALLOWED');
  exception when insufficient_privilege then
    perform avs_test.expect('H3 Storage','Privileged move out to draft','42501',sqlstate);
  end;
end;
$test$;
insert into storage.objects(bucket_id,name,metadata) values ('reference-images','bbbbbbbb-0000-4000-8000-00000000000b/93000000-0000-4000-8000-000000000010/service.jpg','{"size":100,"mimetype":"image/jpeg"}');
select avs_test.expect('H3 Storage','Service role can write valid draft','1',(select count(*)::text from storage.objects where name='bbbbbbbb-0000-4000-8000-00000000000b/93000000-0000-4000-8000-000000000010/service.jpg'));
select avs_test.expect('H3 Storage','Submitted bytes metadata unchanged','100',(select metadata->>'size' from storage.objects where name='aaaaaaaa-0000-4000-8000-00000000000a/93000000-0000-4000-8000-000000000009/h3.jpg'));
select avs_test.expect('H3 Storage','No submitted additional objects','1',(select count(*)::text from storage.objects where bucket_id='reference-images' and name like 'aaaaaaaa-0000-4000-8000-00000000000a/93000000-0000-4000-8000-000000000009/%'));
reset role;
commit;
