-- Read-only release assertion; exits with an error on worker privilege drift.
DO $$ DECLARE p regprocedure; r text; BEGIN
FOREACH p IN ARRAY ARRAY['public.claim_notifications(integer,integer)'::regprocedure,'public.mark_notification_sent(uuid,uuid,text)'::regprocedure,'public.mark_notification_failed(uuid,uuid,text,boolean)'::regprocedure,'public.enqueue_notification(public.notification_event_type,public.notification_recipient,uuid,text,jsonb)'::regprocedure] LOOP
FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
IF has_function_privilege(r,p,'EXECUTE') THEN RAISE EXCEPTION 'Worker RPC exposed to %',r; END IF;
END LOOP;
IF NOT has_function_privilege('service_role',p,'EXECUTE') THEN RAISE EXCEPTION 'Worker execution grant missing'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=p AND proowner='postgres'::regrole AND prosecdef AND proconfig @> ARRAY['search_path=""']) THEN RAISE EXCEPTION 'Worker owner/definer/search_path drift'; END IF;
END LOOP; END $$;
