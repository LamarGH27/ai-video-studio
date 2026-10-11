# Authoritative final-video release (Blocker 2)

## Boundary

Uploading is not releasing. An administrator records a final through `record_delivery_asset`, which locks the project, checks actual Storage metadata and records the object identity in the private `final_delivery.confirmations` ledger. Direct asset inserts cannot create that proof.

An administrator reviews an exact asset and calls `release_final_video(project_id, asset_id)`. The RPC locks the project; checks admin authority, FINALISING state, ownership, final type, confirmation, live object identity/metadata and latest version; inserts one release binding; and transitions to COMPLETED. The existing notification trigger inserts the completion notice inside that same transaction with the existing H6 deduplication key. Rollback removes every effect. Replaying the same release returns the existing result; selecting another asset after release fails.

A database trigger rejects COMPLETED without the binding, including direct service-role status mutations. API roles cannot write either private ledger. Keep `final_delivery` out of exposed PostgREST schemas.

## Reads and immutable identity

Customer asset RLS hides every final except the exact released one on a completed, non-erasing project. Storage applies the same rule and permits final bytes through authenticated GET. Final read signing is denied for authenticated customers and administrators; preview signing is unchanged. The application reauthorizes the asset and streams final bytes using the caller's JWT, so Storage independently reauthorizes the request. No final read token or upstream redirect is returned. Responses are private/no-store and support a single byte range.

Confirmed final rows and Storage objects cannot be overwritten, renamed or deleted through normal admin/customer/service operations. New uploads use new identities. Blocker 1's exact manifest-authorized Storage deletion and FINALIZING database cleanup remain the only deletion exception. Its permanent erasure tombstone keeps subsequent access/reuse closed.

## Staging rollout and legacy media

Migration 014 is additive and does not infer a release from existing status or asset rows. Historical completed projects therefore have no new release binding and are hidden by the new customer policies. Do not invent an authoritative asset by selecting the latest historical row. Inventory and explicitly review legacy finals before any production rollout.

Existing Supabase signed read URLs do not consult the new authorization policy. A policy migration cannot revoke previously issued bearer URLs or downloaded copies. Before declaring the legacy boundary closed, retire the affected old objects through an approved targeted procedure (and verify cached URLs stop returning bytes), or obtain a verified Supabase revocation procedure. Merely waiting for the application's configured TTL is insufficient because direct API clients could have requested another lifetime. On 11 October 2026 the operator explicitly approved retirement of the six disposable legacy staging projects. The existing operator procedure removed all six and their 24 manifest objects; six representative previously fetched signed URLs then returned HTTP 400. This does not authorize production retirement or prove global CDN propagation.

The matching application was deployed to staging Preview dpl_5iVFbuoQRLhZgGF3qpRLEo9nD3X4. Authenticated customer routes and the explicit admin release control passed. Full 8 MiB and 32 MiB streamed responses and byte ranges passed. Verify larger-file and slow-client behavior before production. The stream currently uses an explicit 120-second upstream timeout; the repository's 1 GiB upload ceiling is not evidence that a hosted 1 GiB download has passed. Production activation remains prohibited until these operational limits and legacy URLs have been addressed.

## Verification

`npm run verify:db` runs native SQL, H2/H5/H6/Blocker 1 concurrency and the Blocker 2 final-release suite. The latter uses independent connections and real lock waits; the local Storage operation helpers are explicitly a shim, not proof of hosted Storage behavior.

`tests/final-release.test.ts` covers independent application authorization, refusal to sign finals, authenticated streaming, Storage rejection after authorization, explicit identity selection and failed release actions. Hosted tests must additionally cover real Auth/Storage/PostgREST, object preservation after rejected mutation, duplicate concurrent releases, exact notification count and operator erasure. Use disposable staging fixtures only. Keep credentials and fixture passwords outside Git and logs.

No retention period, H6 queue protocol, scheduler configuration or production setting is changed by this work.

## Hosted verification notes

Real staging Storage requires authenticated metadata-read operations as part of download authorization. The policy permits those operations only under the same exact-release check; customer and admin final signing remain denied. The real hosted suite passed 35 release/security/cleanup checks. Synthetic payloads verify transport and access control, not codec playback.

The repository delivery E2E assertions now use explicit release and authenticated streaming. The shared setup helper still expects an obsolete upload heading, its notification assertions count matching events globally, and its completion heading selector is ambiguous. Those pre-existing E2E issues are recorded for the separate release-gate work; do not report the unadapted repository journey as passing. An external staging verification copy corrected those three selector/assertion issues and passed both delivery lifecycle tests, including revision, approval, explicit release, authenticated download and cross-customer denial. Its synthetic projects and accounts were erased afterward. These adaptations were not applied to the shared repository helper or unrelated assertions.
