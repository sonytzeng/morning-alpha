/** Candidate only: no timer, HTTP endpoint, credential, Production writer or promotion. */
import {HORIZONS, hashValid, snapshotHash, validTime, type Horizon} from './contracts.ts';
import {evaluateResearch, RESEARCH_FUNNEL_VERSION, traceIssues, publicationEligibility, type PublicationPolicy, type FunnelInput, type ResearchEvaluation} from './researchFunnel.ts';
import {evaluateEntry, ENTRY_VERSION, type EntryInput, type EntryEvaluation} from '../../../research/entry-opportunity.ts';
import {coveredCalendarDate, isMarketTradingDate, MARKET_CALENDAR_VERSION, previousMarketTradingDate} from '../../../supabase/functions/_shared/market-session-contract.mjs';

export const DAILY_INTELLIGENCE_VERSION = 'DAILY_STOCK_INTELLIGENCE_CANDIDATE_1';
export const STAGES = ['ACQUISITION', 'RESEARCH', 'ENTRY', 'PREDICTION_LOCK', 'OUTCOME', 'PUBLICATION'] as const;
type Stage = typeof STAGES[number];
export type DailyRequest = {
 business_date: string; checkpoint: string; mode: 'HISTORICAL_REPLAY' | 'FORWARD_SHADOW';
 provenance: 'RETAINED_REAL_EVIDENCE' | 'SYNTHETIC_CONTROL'; core_ready: boolean; core_busy: boolean;
 source_revision: string; source_hash: string; actionable_at: string;
};
export type AcquiredResearch = {inputs: FunnelInput[]; entry: EntryInput | null; evidence_cutoff: string; snapshot_hash: string};
export type DailyLock = {
 id: string; business_date: string; mode: DailyRequest['mode']; provenance: DailyRequest['provenance'];
 symbol: string; company: string; horizon: Horizon; strategy_version: string; entry_version: string;
 generated_at: string; locked_at: string; evidence_cutoff: string; evidence_hash: string;
 actionable_at: string; target_sessions: readonly number[]; research: ResearchEvaluation;
 entry: EntryEvaluation['candidates']; entry_gap: string | null; confirmation: string; invalidation: string;
 next_review_at: string; lock_hash: string;
};
export type RunState = {key: string; request_hash: string; attempts: Partial<Record<Stage, number>>;
 completed: Stage[]; acquired?: AcquiredResearch; research?: ResearchEvaluation[];
 entry?: EntryEvaluation | null; locks?: DailyLock[]; outcome?: unknown; publication?: unknown;
 failure?: {stage: Stage; reason: string}; finished: boolean};
export interface DailyStore {
 exclusive<T>(key: string, work: () => Promise<T>): Promise<T>;
 load(key: string): Promise<RunState | null>;
 save(state: RunState): Promise<void>;
 lock(rows: DailyLock[]): Promise<void>;
}
export interface DailyPorts {
 acquire(request: DailyRequest, signal: AbortSignal): Promise<AcquiredResearch>;
 outcomes(locks: DailyLock[], signal: AbortSignal): Promise<unknown>;
 /** Read-only eligibility. Never approval or member publication. */
 publication(locks: DailyLock[], signal: AbortSignal): Promise<unknown>;
 clock(): string;
}
export class CandidateFailure extends Error {
 code: string; retryable: boolean;
 constructor(code: string, retryable = false) { super(code); this.code = code; this.retryable = retryable; }
}
const day = (t: string) => new Date(Date.parse(t) + 8 * 3600000).toISOString().slice(0, 10);
const fail = (code: string): never => {throw new CandidateFailure(code);};
export async function verifyDailyLock(lock: DailyLock) {
 const {lock_hash, ...body} = lock;
 return hashValid(lock_hash) && lock_hash === await snapshotHash(body)
  && lock.strategy_version === RESEARCH_FUNNEL_VERSION && lock.entry_version === ENTRY_VERSION
  && ['RETAINED_REAL_EVIDENCE', 'SYNTHETIC_CONTROL'].includes(lock.provenance)
  && lock.symbol === lock.research.symbol && lock.horizon === lock.research.horizon
  && lock.confirmation === lock.research.confirmation && lock.invalidation === lock.research.invalidation
  && hashValid(lock.evidence_hash)
  && Object.hasOwn(HORIZONS, lock.horizon) && JSON.stringify(lock.target_sessions) === JSON.stringify(HORIZONS[lock.horizon].outcomes)
  && [lock.generated_at, lock.locked_at, lock.evidence_cutoff, lock.actionable_at, lock.next_review_at].every(validTime)
  && day(lock.actionable_at) === lock.business_date
  && Date.parse(lock.evidence_cutoff) <= Date.parse(lock.generated_at) && Date.parse(lock.generated_at) <= Date.parse(lock.locked_at)
  && (lock.mode === 'HISTORICAL_REPLAY' || lock.mode === 'FORWARD_SHADOW' && Date.parse(lock.locked_at) < Date.parse(lock.actionable_at));
}
async function bounded<T>(work: (s: AbortSignal) => Promise<T>, ms: number): Promise<T> {
 const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
 const timeout = new Promise<never>((_, reject) => {timer = setTimeout(() => {reject(new CandidateFailure('TIMEOUT', true)); controller.abort();}, ms);});
 try {return await Promise.race([work(controller.signal), timeout]);} finally {clearTimeout(timer!); controller.abort();}
}
async function validateAcquired(a: AcquiredResearch, request: DailyRequest, now: string) {
 const {snapshot_hash, ...body} = a;
 if (!hashValid(snapshot_hash) || snapshot_hash !== request.source_hash || snapshot_hash !== await snapshotHash(body)) fail('ACQUISITION_HASH_MISMATCH');
 if (!validTime(a.evidence_cutoff) || Date.parse(a.evidence_cutoff) > Date.parse(now)) fail('FUTURE_CUTOFF');
 if (a.inputs.length !== 72 || new Set(a.inputs.map(i => i.symbol)).size !== 72) fail('UNIVERSE_NOT_72');
 for (const i of a.inputs) {
  if (i.cutoff !== a.evidence_cutoff || i.next_session !== request.business_date || i.through !== previousMarketTradingDate('TW', request.business_date)) fail('SOURCE_SESSION_MISMATCH');
  // Missing evidence is handled by the engine, but future/malformed lineage is
  // not silently dropped or relabelled as a successful acquisition.
  if ([...i.bars, ...i.facts].some(e => traceIssues(e, i.cutoff).some(x => ['FUTURE_EVIDENCE', 'TIME_ORDER_INVALID', 'LINEAGE_INVALID'].includes(x)))) fail('POINT_IN_TIME_INVALID');
 }
 if (a.entry) {
  if (a.entry.business_date !== request.business_date || a.entry.evaluation_time !== a.evidence_cutoff
   || a.entry.stocks.length !== 72 || a.entry.stocks.some(s => !a.inputs.some(i => i.symbol === s.symbol))
   || a.entry.mode !== (request.mode === 'HISTORICAL_REPLAY' ? 'HISTORICAL_REPLAY' : 'FORWARD')
   || a.entry.provenance !== (request.provenance === 'RETAINED_REAL_EVIDENCE' ? 'REAL_RETAINED' : 'SYNTHETIC_TEST')) fail('ENTRY_SOURCE_SCOPE_MISMATCH');
 }
}
/** Runs outside the Core request. Caller enqueues after READY, never awaits this
 * from Report/LINE. Store must provide mutual exclusion + durable checkpoints. */
export async function runDailyIntelligence(request: DailyRequest, store: DailyStore, ports: DailyPorts, timeoutMs = 20000) {
 const deadline = Date.now() + 60000;
 if (!/^[A-Z0-9_]{1,40}$/.test(request.checkpoint) || !request.source_revision || request.source_revision.length > 256 || !hashValid(request.source_hash)
  || !['HISTORICAL_REPLAY', 'FORWARD_SHADOW'].includes(request.mode) || !['RETAINED_REAL_EVIDENCE', 'SYNTHETIC_CONTROL'].includes(request.provenance)
  || !validTime(request.actionable_at) || !validTime(ports.clock()) || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 20000) fail('REQUEST_INVALID');
 if (!coveredCalendarDate('TW', request.business_date)) return {state: 'CALENDAR_UNKNOWN', core_awaits_research: false};
 if (!isMarketTradingDate('TW', request.business_date)) return {state: 'CLOSED_NO_EXECUTION', core_awaits_research: false};
 if (!request.core_ready || request.core_busy) return {state: 'DEFERRED_CORE_PRIORITY', core_awaits_research: false};
 if (day(request.actionable_at) !== request.business_date) fail('ACTIONABLE_DATE_MISMATCH');
 if (request.mode === 'FORWARD_SHADOW' && (day(ports.clock()) !== request.business_date || Date.parse(ports.clock()) >= Date.parse(request.actionable_at))) fail('FORWARD_WINDOW_EXPIRED');
 // Evidence revision is bound to one natural checkpoint: a changed retry must
 // conflict, not create a second authoritative prediction.
 const key = await snapshotHash({version: DAILY_INTELLIGENCE_VERSION, date: request.business_date, checkpoint: request.checkpoint, mode: request.mode, provenance: request.provenance});
 const request_hash = await snapshotHash(request);
 return store.exclusive(key, async () => {
  let state = await store.load(key);
  if (state && state.request_hash !== request_hash) fail('IDEMPOTENCY_SCOPE_CONFLICT');
  if (state?.acquired) await validateAcquired(state.acquired, request, ports.clock());
  if (state?.locks && (state.locks.length !== 216 || (await Promise.all(state.locks.map(verifyDailyLock))).some(ok => !ok))) fail('CHECKPOINT_LOCK_INVALID');
  if (state?.finished) return {state: 'ALREADY_COMPLETE', key, checkpoint: state, core_awaits_research: false};
  state ??= {key, request_hash, attempts: {}, completed: [], finished: false};
  for (const stage of STAGES) {
   if (state.completed.includes(stage)) continue;
   let ok = false;
   while ((state.attempts[stage] ?? 0) < 3) {
    if (Date.now() >= deadline) return {state: 'BUDGET_YIELDED', key, checkpoint: state, core_awaits_research: false};
    state.attempts[stage] = (state.attempts[stage] ?? 0) + 1;
    await store.save(state); // attempt persists before work; process restarts cannot reset budget
    try {
     if (stage === 'ACQUISITION') {
      const acquired = await bounded(s => ports.acquire(request, s), Math.min(timeoutMs, deadline - Date.now()));
      await validateAcquired(acquired, request, ports.clock()); state.acquired = acquired;
     } else if (stage === 'RESEARCH') {
      state.research = state.acquired!.inputs.flatMap(i => (Object.keys(HORIZONS) as Horizon[]).map(h => evaluateResearch(i, h)));
     } else if (stage === 'ENTRY') {
      state.entry = state.acquired!.entry ? await evaluateEntry(state.acquired!.entry) : null;
     } else if (stage === 'PREDICTION_LOCK') {
      const now = ports.clock();
      if (request.mode === 'FORWARD_SHADOW' && Date.parse(now) >= Date.parse(request.actionable_at)) fail('LATE_LOCK_NOT_FORWARD');
      const locks: DailyLock[] = [];
      for (const r of state.research!) {
       const input = state.acquired!.inputs.find(i => i.symbol === r.symbol)!;
       const body = {id: key + ':' + r.symbol + ':' + r.horizon, business_date: request.business_date, mode: request.mode, provenance: request.provenance,
        symbol: r.symbol, company: r.company, horizon: r.horizon, strategy_version: r.version, entry_version: ENTRY_VERSION,
        generated_at: now, locked_at: now, evidence_cutoff: state.acquired!.evidence_cutoff,
        evidence_hash: await snapshotHash({input, entry: state.acquired!.entry}), actionable_at: request.actionable_at,
        target_sessions: HORIZONS[r.horizon].outcomes, research: r, entry: state.entry?.candidates.filter(c => c.symbol === r.symbol) ?? [],
        entry_gap: state.entry ? null : 'MATCHING_ENTRY_SOURCE_UNAVAILABLE', confirmation: r.confirmation, invalidation: r.invalidation, next_review_at: r.next_review_at};
       locks.push({...body, lock_hash: await snapshotHash(body)});
      }
      // Prepare in checkpoint first: crash after insert retries the same bytes.
      state.locks ??= locks; await store.save(state); await store.lock(state.locks);
     } else if (stage === 'OUTCOME') state.outcome = await bounded(s => ports.outcomes(state!.locks!, s), Math.min(timeoutMs, deadline - Date.now()));
     else state.publication = await bounded(s => ports.publication(state!.locks!, s), Math.min(timeoutMs, deadline - Date.now()));
     state.completed.push(stage); delete state.failure; await store.save(state); ok = true; break;
    } catch (error) {
     const reason = error instanceof CandidateFailure ? error.code : 'INTEGRATION_FAILED';
     state.failure = {stage, reason}; await store.save(state);
     if (!(error instanceof CandidateFailure) || !error.retryable) break;
     if ((state.attempts[stage] ?? 0) < 3) await new Promise(resolve => setTimeout(resolve, 100 * 2 ** ((state.attempts[stage] ?? 1) - 1)));
    }
   }
   if (!ok) return {state: 'BLOCKED', key, checkpoint: state, core_awaits_research: false};
  }
  state.finished = true; await store.save(state);
  return {state: 'COMPLETE', key, checkpoint: state, core_awaits_research: false};
 });
}
export async function dailyPublication(locks: DailyLock[], policyFor: (lock: DailyLock, hash: string) => PublicationPolicy) {
 const rows = [];
 for (const lock of locks) {
  if (!await verifyDailyLock(lock)) fail('PUBLICATION_LOCK_INVALID');
  const hash = await snapshotHash({version: RESEARCH_FUNNEL_VERSION, research: lock.research});
  const policy = policyFor(lock, hash);
  const gate = publicationEligibility(lock.research, policy);
  const historical = lock.mode !== 'FORWARD_SHADOW';
  rows.push({id: lock.id, checked: gate.checked, eligible: !historical && gate.eligible,
   reasons: [...gate.reasons, ...(historical && gate.checked ? ['HISTORICAL_NOT_MEMBER_FORWARD'] : [])]});
 }
 return {rows, eligible: rows.filter(r => r.eligible).length, publishes: false, approvals_created: 0};
}
/** Candidate event hook: no import into the live Core. Enqueue is a durable,
 * bounded server adapter; the Core never waits on research completion. */
export function naturalCallerCandidate(request: DailyRequest, enqueue: (r: DailyRequest, signal: AbortSignal) => Promise<unknown>, background: (p: Promise<unknown>) => void) {
 if (!coveredCalendarDate('TW', request.business_date)) return 'CALENDAR_UNKNOWN';
 if (!isMarketTradingDate('TW', request.business_date)) return 'CLOSED_NO_EXECUTION';
 if (!request.core_ready || request.core_busy) return 'DEFERRED_CORE_PRIORITY';
 // Defer invocation too: even a synchronous adapter throw must not escape into
 // the Core. Bound queue admission, not just the later research worker.
 const task=Promise.resolve().then(()=>bounded(s=>enqueue(request,s),2000)).catch(() => ({state: 'ENQUEUE_FAILED', recovery: 'NEXT_EXISTING_CHECKPOINT'}));
 try {background(task);return 'CANDIDATE_ENQUEUED_NOT_PRODUCTION';}
 catch {return 'CANDIDATE_BACKGROUND_REGISTRATION_FAILED';}
}
export function dailySummary(locks: DailyLock[]) {
 const entry = [...new Map(locks.flatMap(l => l.entry).map(e => [e.symbol + ':' + e.strategy, e])).values()];
 return {calendar_version: MARKET_CALENDAR_VERSION, candidate_only: true, natural_forward_execution: 'NOT_ENABLED',
  horizons: Object.fromEntries((Object.keys(HORIZONS) as Horizon[]).map(h => {const rows = locks.filter(l => l.horizon === h); return [h, {scanned: rows.length,
   qualified: rows.filter(l => l.research.state === 'QUALIFIED').length, rejected: rows.filter(l => l.research.state === 'REJECTED').length, insufficient: rows.filter(l => l.research.state === 'INSUFFICIENT').length}];})),
  entry: Object.fromEntries(['ENTRY_READY', 'WAIT_CONFIRMATION', 'AVOID_ENTRY', 'INSUFFICIENT_EVIDENCE'].map(s => [s, entry.filter(e => e.status === s).length])),
  entry_source_missing_symbols: new Set(locks.filter(l => l.entry_gap).map(l => l.symbol)).size,
  // Isolated locked controls/replay never count as Production forward samples.
  forward_sample: 0, outcome_sample: 0, publication_approved: 0, free_visible: 0, premium_visible: 0};
}
