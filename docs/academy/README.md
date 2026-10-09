# Academy V1 isolated candidate

This branch adds a generic learning interface to the existing application at
`/academy`. It does not publish a course, change a strategy, or authorize a release.

## Privacy boundary

The repository is public. Private source documents, private course research,
unlisted video links, evidence ledgers, course JSON and the generated learning PDF
must remain outside the repository and build root. No course package is bundled.
Do not upload those materials to a public PR, CI artifact, Readdy or a public URL.

In the loopback-only development harness, the learner selects a local JSON file
and optionally a PDF with the browser file chooser. The application reads them in
browser memory; there is no upload endpoint. Text is rendered as React text, not
HTML. Only opaque scoped chapter-completion progress is stored locally. The PDF
Blob URL is revoked on unload, reset, identity change or sign-out.

The production build does **not** enable the importer. A future authorized private
content-delivery design and real Owner acceptance are separate gates. An Owner UI
guard is not a substitute for server-side content authorization.

## Isolated preview

```sh
MA_ACADEMY_PREVIEW=SYNTHETIC_ONLY npm exec vite -- --config tests/browser/academy.vite.ts
```

Open `http://127.0.0.1:3217/academy?role=owner`. The prominent synthetic-test banner
is intentional: the harness uses a synthetic identity and is **not** Production
Owner authentication evidence. Anonymous, member, paid, admin, unavailable and
logout-race cases are available only in this isolated harness. Production code
does not read the role query parameter.

The candidate's real access guard reuses `is_research_owner_v1` and `auth.getUser()`;
it adds no role, policy, table, credential, Function or migration. Auth transitions
abort pending local reads and remove loaded course content.

## Learning features

- Original interactive SVG diagrams and accessible keyboard controls.
- Choice, diagram, zone and sequence questions with explanations and retries.
- Locally scoped progress, with honest degraded storage feedback.
- Responsive layout; no private content or production session required in CI.
- Disabled AI adapter. Deterministic explanations are never presented as live AI.

## Validation

```sh
npm run type-check
npm run lint
npm run build
node --test tests/academyModel.test.mjs tests/academyIntegrity.test.mjs
```

`tests/browser/academy.e2e.mjs` is a separate synthetic browser regression runner.
It never loads the private course. Private-material visual acceptance is performed
locally through the browser file chooser and is not uploaded to CI.

`tests/browser/academy.private.e2e.mjs` is an explicitly enabled, local-only QA
runner. It takes a user-authorized file through the browser file chooser, checks
rendering against that file in browser memory, and saves screenshots outside the
repository. It contains no private lesson text, answers or source documents.
It must not be run in CI or against Production. Its identity remains synthetic.

Candidate QA covers 15 chapters, four exercise interactions, local progress,
keyboard controls, exact stepwise chart disclosure, and 375/390/430/768/1440
layouts. Anonymous/member/paid/admin rejection, logout races, revoked access,
unavailable RPC, blocked storage and PDF Blob cleanup are exercised in isolation.
The production-mode build test proves that query flags cannot activate imports.
None of these synthetic checks is a real Production Owner acceptance or RLS change.

Auth lifecycle implementation was checked against the official
[onAuthStateChange](https://supabase.com/docs/reference/javascript/auth-onauthstatechange)
and [getUser](https://supabase.com/docs/reference/javascript/auth-getuser) references.
Supabase work is scheduled outside the synchronous auth callback; private local
reads are discarded after a session transition.

No Production deployment, merge, migration, paid AI, automatic trading, member
publication, strategy promotion, report change or LINE send is part of this branch.
Learning completion does not establish investment skill or trading edge.
