/** Candidate only: no timer, HTTP endpoint, credential, Production writer or promotion. */
import {HORIZONS, hashValid, snapshotHash, inputSnapshotHashes, validTime, type Horizon} from './contracts.ts';
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
export type AcquiredResearch = {inputs: FunnelInput[]; entry: EntryInput | null; evidence_cutoff: string; snapshot_hash: string;
 source_issues?:{kind:string;key:string;reason:string}[]};
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
 /** Optional read-only receipt for an already committed exact batch. Unlike
  * lock(), this MUST NOT create predictions. Default adapters stay cutoff-closed. */
 confirmCommitted?(rows: DailyLock[]): Promise<void>;
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
export async function runDailyIntelligence(request: DailyRequest, store: DailyStore, ports: DailyPorts, timeoutMs = 20000, prelockStageLimit = 0, yieldAfterLock = false, yieldAfterPrepare = false) {
 const deadline = Date.now() + 60000;
 if (!/^[A-Z0-9_]{1,40}$/.test(request.checkpoint) || !request.source_revision || request.source_revision.length > 256 || !hashValid(request.source_hash)
  || !['HISTORICAL_REPLAY', 'FORWARD_SHADOW'].includes(request.mode) || !['RETAINED_REAL_EVIDENCE', 'SYNTHETIC_CONTROL'].includes(request.provenance)
  || !validTime(request.actionable_at) || !validTime(ports.clock()) || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 20000
  || !Number.isInteger(prelockStageLimit) || prelockStageLimit < 0 || prelockStageLimit > 3
  || typeof yieldAfterLock !== 'boolean' || yieldAfterLock && !store.confirmCommitted
  || typeof yieldAfterPrepare !== 'boolean' || yieldAfterPrepare && (!yieldAfterLock || !store.confirmCommitted)) fail('REQUEST_INVALID');
 if (!coveredCalendarDate('TW', request.business_date)) return {state: 'CALENDAR_UNKNOWN', core_awaits_research: false};
 if (!isMarketTradingDate('TW', request.business_date)) return {state: 'CLOSED_NO_EXECUTION', core_awaits_research: false};
 if (!request.core_ready || request.core_busy) return {state: 'DEFERRED_CORE_PRIORITY', core_awaits_research: false};
 if (day(request.actionable_at) !== request.business_date) fail('ACTIONABLE_DATE_MISMATCH');
 if (request.mode === 'FORWARD_SHADOW' && day(ports.clock()) !== request.business_date) fail('FORWARD_WINDOW_EXPIRED');
 // Evidence revision is bound to one natural checkpoint: a changed retry must
 // conflict, not create a second authoritative prediction.
 const key = await snapshotHash({version: DAILY_INTELLIGENCE_VERSION, date: request.business_date, checkpoint: request.checkpoint, mode: request.mode, provenance: request.provenance});
 const request_hash = await snapshotHash(request);
 return store.exclusive(key, async () => {
  let state = await store.load(key);
  if (state && state.request_hash !== request_hash) fail('IDEMPOTENCY_SCOPE_CONFLICT');
  if (state?.acquired) await validateAcquired(state.acquired, request, ports.clock());
  if (state?.locks && (state.locks.length !== 216 || (await Promise.all(state.locks.map(verifyDailyLock))).some(ok => !ok))) fail('CHECKPOINT_LOCK_INVALID');
  let committedPrepared = false;
  if (state?.locks && store.confirmCommitted) {
   await store.confirmCommitted(state.locks); committedPrepared = true;
  }
  if (request.mode === 'FORWARD_SHADOW' && Date.parse(ports.clock()) >= Date.parse(request.actionable_at)) {
   if (!committedPrepared) fail('FORWARD_WINDOW_EXPIRED');
  }
  if (state?.finished) return {state: 'ALREADY_COMPLETE', key, checkpoint: state, core_awaits_research: false};
  state ??= {key, request_hash, attempts: {}, completed: [], finished: false};
  if (committedPrepared && !state.completed.includes('PREDICTION_LOCK')) {
   // Reconcile bookkeeping even if the third persisted attempt committed just
   // before a crash. Do not reset, consume or repeat the exhausted write budget.
   state.completed.push('PREDICTION_LOCK');
   if (state.failure?.stage === 'PREDICTION_LOCK') delete state.failure;
   await store.save(state);
  }
  let completedPrelockStages = 0;
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
      if (state.locks) {
       // A persisted attempt save may cross cutoff. Without a read-only commit
       // confirmation this is still a writer, including for non-SQL adapters.
       if (request.mode === 'FORWARD_SHADOW' && Date.parse(ports.clock()) >= Date.parse(request.actionable_at)) fail('LATE_LOCK_NOT_FORWARD');
       // Resume a durable prepared batch unchanged, not a fresh now-timestamp
       // or recomputed evidence hash. Store/SQL remains the commit authority.
       await store.lock(state.locks);
      } else {
      const now = ports.clock();
      if (request.mode === 'FORWARD_SHADOW' && Date.parse(now) >= Date.parse(request.actionable_at)) fail('LATE_LOCK_NOT_FORWARD');
      // Own the complete preimage before the first digest await. A retained
      // acquire/load alias cannot change the evidence between horizons, and a
      // mutation since validation must not become a newly trusted revision.
      const acquired = structuredClone(state.acquired!);
      const {snapshot_hash, ...acquiredBody} = acquired;
      if (snapshot_hash !== request.source_hash || snapshot_hash !== await snapshotHash(acquiredBody)) fail('ACQUISITION_HASH_MISMATCH');
      const locks: DailyLock[] = [];
      // The full input + complete Entry capsule is identical for a stock's
      // three horizons. Keep the original bytes/hash scope, but compute it
      // once within this single lock attempt; never cache across revisions,
      // retries or runs. Rehashing the full 72-stock Entry 216 times can spend
      // the invocation budget before the prepared batch reaches SQL.
      const hashes = await inputSnapshotHashes(acquired.inputs, acquired.entry);
      const evidenceHashes = new Map(acquired.inputs.map((input, index) => [input.symbol, hashes[index]]));
      for (const r of state.research!) {
       const evidenceHash = evidenceHashes.get(r.symbol)!;
       const body = {id: key + ':' + r.symbol + ':' + r.horizon, business_date: request.business_date, mode: request.mode, provenance: request.provenance,
        symbol: r.symbol, company: r.company, horizon: r.horizon, strategy_version: r.version, entry_version: ENTRY_VERSION,
        generated_at: now, locked_at: now, evidence_cutoff: acquired.evidence_cutoff,
        evidence_hash: evidenceHash, actionable_at: request.actionable_at,
        target_sessions: HORIZONS[r.horizon].outcomes, research: r, entry: state.entry?.candidates.filter(c => c.symbol === r.symbol) ?? [],
        entry_gap: state.entry ? null : 'MATCHING_ENTRY_SOURCE_UNAVAILABLE', confirmation: r.confirmation, invalidation: r.invalidation, next_review_at: r.next_review_at};
       locks.push({...body, lock_hash: await snapshotHash(body)});
      }
      // Prepare in checkpoint first: crash after insert retries the same bytes.
      // Do not re-expose the owned preimage via a retained checkpoint root
      // until all three-horizon hashes have finished using it.
      state.acquired = acquired;
      state.locks ??= locks; await store.save(state);
      // This handoff is only preparation. The runtime must replay these exact
      // bytes through SQL on its next fenced invocation before bookkeeping can
      // claim a committed batch. It never authorizes a new late Forward insert.
      if (yieldAfterPrepare) return {state: 'BUDGET_YIELDED', key, checkpoint: state, core_awaits_research: false};
      await store.lock(state.locks);
      }
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
   // Large immutable acquired bytes are sent with every existing CHECKPOINT
   // RPC. Bound pre-lock stages per invocation, not their evidence or attempts.
   // Only yield AFTER completed checkpoints are durable. An explicit post-lock
   // handoff additionally requires the read-only committed-batch contract;
   // prepared-only bytes never authorize late Forward on recovery.
   if (['ACQUISITION', 'RESEARCH', 'ENTRY'].includes(stage)
     && prelockStageLimit > 0 && ++completedPrelockStages >= prelockStageLimit)
    return {state: 'BUDGET_YIELDED', key, checkpoint: state, core_awaits_research: false};
   if (stage === 'PREDICTION_LOCK' && yieldAfterLock)
    return {state: 'BUDGET_YIELDED', key, checkpoint: state, core_awaits_research: false};
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
