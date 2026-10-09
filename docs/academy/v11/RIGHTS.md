# Academy V1.1 content boundary

This is a member-candidate content audit, not a legal determination or a grant of third-party rights.

## Existing V1 material: keep private

The original 100-page teacher handout, all three linked videos, their images,
transcripts and teacher-specific expressions are **not member deliverables**.
No license to republish them has been established. The videos' unavailable
content remains unverified; this candidate does not claim to have viewed it.

The existing 40-page V1 PDF is retained unchanged in the private Owner workflow:

| Pages | Topic | Classification and disposition |
| --- | --- | --- |
| 1–3 | Cover, guide, contents | Original layout; mixed private-course context; Owner-only |
| 4–13 | Stock charts, OHLC, volume, trend, support/resistance | General concepts with original explanations/figures; independently rewrite for members |
| 14–20 | Important turns and six teacher key-candle cases | Teacher-derived arrangement/terminology; Owner-only |
| 21–30 | Rising/falling starts, cycles, entries, risk | General concepts mixed with teacher framework; Owner-only original book |
| 31–35 | Six-case review and quiz | Teacher-framework examples; Owner-only |
| 36–40 | Common mistakes, workflow, quick reference | Original exposition within private-course structure; Owner-only original book |

No page or figure from that PDF is reused in the member PDF. Even where a
diagram was originally drawn by Codex, a teacher-specific arrangement is not
treated as cleared for public distribution. Potential reproductions and all
source-handout figures remain private. The private importer remains localhost
development-only and is never an entitlement mechanism for the member route.

## New member material

V1.1 uses a separately authored curriculum: seven free chapters / fourteen
questions; ten total Premium chapters / twenty-three questions. It teaches
general market concepts using independently written Traditional Chinese,
original illustrative OHLC sequences and newly designed questions/answers.
Illustrative prices are explicitly educational examples, not market evidence,
performance, recommendations or predictions.

The six member candle appearances are generic long up/down bodies, small body,
doji, long upper wick and long lower wick. They are **not a licensed copy of the
teacher's six-key-candle method**. The latter and unvalidated Signal Lab rules
remain Owner-only. AI coaching is disabled for all member tiers.

The new free PDF has 15 pages; the complete original Premium PDF has 21 pages.
Both include original diagrams, exercises, answers and risk limitations. These
replace neither the private 40-page study guide nor the original handout.

## Public repository / payload isolation

This repository is public. Actual curriculum bodies, answer text, private PDFs,
teacher sources and generated content SQL are not checked in or built into
public assets. `content-manifest.json` records titles, counts and approved SHA-256
digests only. CI uses clearly synthetic contract fixtures, not Premium lessons.

The reviewed private curriculum and PDFs can be loaded only by a separately
approved future release step. The loader checks pinned hashes and produces an
artifact; it has no database connection. No production content upload occurred.
Runtime SQL RLS serves authorized lesson/PDF rows and denies anonymous access,
including Supabase anonymous-sign-in identities. Hiding a button is not the gate.

This design controls server access; it cannot prevent an authorized learner
from retaining a PDF or copying a lesson they were legitimately allowed to read.
