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

The original synthetic preview remains a test tool, NOT a login acceptance result.

## Real Auth final acceptance (2026-10-09)

An independent, loopback-only environment now runs the actual Supabase Auth
v2.194.0, PostgREST v14.13 and PostgreSQL 17. No hosted project, paid environment,
Production account copy, Production credential, new Production Secret or existing
Auth/RLS change is involved. Accounts register through GoTrue and log in with
passwords; PostgREST verifies their signed JWTs before the candidate RPC/RLS runs.
Owner access uses the exact existing `is_research_owner_v1` SQL predicate against
isolated account records. There is no client role selector or custom auth mock.

- Owner, Free, Premium and second Free account: real Auth password login PASS.
- Free 7 chapters / 14 questions; Premium and Owner 10 chapters / 23 questions,
  using the unchanged reviewed original curriculum and PDFs in the local DB.
- Free direct Premium lesson/PDF request DENY; anonymous DENY; changed user_metadata
  cannot elevate access; forged JWT rejected by PostgREST.
- Real browser: answer and complete stock-basics, reload retains completion;
  logout clears lesson/progress; second account sees zero completion; first
  account logs in again and sees its saved completion. API regression also tests
  revoked refresh token, database row isolation and independent re-login.
- Direct Premium URL with `role=owner` remains locked for Free.
- All ten original lessons at 1440 / 375 / 390 / 430: 40 checks, zero horizontal
  overflow or first-layer engineering copy. Screenshots reviewed at all four
  widths; browser error/warning logs empty.
- Member headings and instructions are Traditional Chinese. The separate local
  acceptance login disclosure is collapsed by default and is not production UI.
- The private V1 diagram defaults and private importer remain unchanged; member
  diagrams opt into separate plain-language captions.

`ISOLATED_REAL_AUTH_E2E = PASS`; `PRODUCTION_OWNER_BROWSER_E2E = NOT_RUN`.
The test Owner is a legitimate local Auth account, not Sony's Production account.
Production migration and public member launch still require Sony's separate
approval. No Production E2E or Sony usability PASS is claimed.

Reproduce API/DB acceptance: `node scripts/academy-v11/auth-environment.mjs`.
The script owns and cleans only its new disposable containers/network. CI uses
synthetic lesson content; local reviewed-material acceptance supplies the existing
hash-pinned private course/PDF directory. Start the latter with
`node scripts/academy-v11/auth-preview.mjs`; Preview is
`http://127.0.0.1:3219/academy`. It uses Supabase JS password login and real HTTP
Auth/REST, not the older 3218 role-selector harness. No teacher materials are
included in either public test code or the member content.

## Future release manifest — NOT executed

1. Additive `20261009053655_academy_member_learning_v11.sql` (new academy schema,
   tables, policies and RPCs only).
2. Reviewed original course/PDF content load into those new academy tables;
   exact hashes pinned in content-manifest.json, no teacher-source upload.
3. Member Academy UI plus the report educational link.
4. Controlled post-release real authenticated free/Premium/Owner acceptance,
   logout and cross-user checks; preserve the pre-release isolated Auth evidence.

No new Function, Secret, Cron, paid service, business-data backfill, existing
policy change or Signal Lab promotion is proposed. Production execution needs
separate explicit approval; candidate artifacts do not grant it.

## Honest completion limits

Engineering test PASS does not establish investment efficacy, rights to third-
party teacher material, real Owner Browser PASS or Sony usability approval.
AI remains off and unvalidated teacher strategies remain private.
