# Academy V1.1 candidate acceptance

## Scope and architecture

Continues Draft PR #225 from `6ad78d0fdd23c0bcc4470351b3c74612b60f4404`.
The V1 private Owner importer, diagrams, private PDF and Signal Lab research are
preserved. Normal `/academy` uses Supabase-verified identity plus server-derived
catalog permissions. Query parameters select a lesson only; they cannot set a
role. No client tier, localStorage or user_metadata grants access.

The server projection mirrors the existing member-entitlement resolver and
reuses `is_research_owner_v1()`. It does not change billing, Auth or existing RLS.
All three new tables force RLS. The catalog exposes locked titles, not bodies.
Lesson and PDF reads are invoker-gated; progress writes are identity-bound,
server-graded, row-locked operations with fixed empty search_path. Clients cannot
set user_id, grade, version or timestamps. A learner cannot mark incomplete
questions complete or read another learner's progress.

The report change is a UI-only educational link to support/resistance. It does
not change report production, decisions, recommendations or delivery.

## Executed candidate verification

- Disposable PostgreSQL 17: actual migration, exact existing Owner predicate,
  anonymous/anonymous-sign-in denial, free/Premium/Owner tiers, direct table/RPC
  bypass rejection, A/B isolation, persisted grading/completion, expiration,
  fixed search_path, forced RLS, and parity with nineteen existing entitlement
  states. Test identities are synthetic local identities, not Sony.
- Reviewed original curriculum and both PDFs loaded only in the disposable DB.
- Browser: all ten lessons at 375/390/430/768/1440; free/Premium/Owner paths,
  premium locks, query forgery, server answer grading, reload, separate user,
  logout clearing and gated PDF downloads. No external network requests allowed.
- PDF: embedded CJK fonts, text extraction/glyph checks, overflow checks and
  rendered-page visual review. Artifacts and detailed browser/PDF QA remain in
  the private local delivery folder, not the public repository.
- CI adds a disposable PostgreSQL role/isolation gate with synthetic lessons.
  CI never connects to Production and does not contain Production credentials.

## Preview meaning

`http://127.0.0.1:3218/academy` is a loopback-only, isolated-database preview.
Its clearly labeled role selector creates **synthetic test sessions** at the
server harness, never in the production app. Sony may explore free and Premium
flows here. This is NOT a real Owner/member authentication or Production E2E
claim. Nothing from the harness is imported by the production build.

`OWNER_BROWSER_E2E = NOT_RUN`: the new RPC/content are intentionally not deployed,
and no authorized staging environment with a real Sony identity is available.
Existing Production Owner access to other pages cannot prove this new flow.
Do not recommend Production release until this remaining gate is completed in
an approved environment. Production changes, merge and deploy remain prohibited.

## Future release manifest — NOT executed

1. Additive `20261009053655_academy_member_learning_v11.sql` (new academy schema,
   tables, policies and RPCs only).
2. Reviewed original course/PDF content load into those new academy tables;
   exact hashes pinned in content-manifest.json, no teacher-source upload.
3. Member Academy UI plus the report educational link.
4. Real authenticated free/Premium/Owner acceptance, logout and cross-user checks.

No new Function, Secret, Cron, paid service, business-data backfill, existing
policy change or Signal Lab promotion is proposed. Production execution needs
separate explicit approval; candidate artifacts do not grant it.

## Honest completion limits

Engineering test PASS does not establish investment efficacy, rights to third-
party teacher material, real Owner Browser PASS or Sony usability approval.
AI remains off and unvalidated teacher strategies remain private.
