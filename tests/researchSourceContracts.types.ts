// Compile only. No backend module is evaluated and no transport is created.
import type {Strategy,EntryResult,EntryEvaluation,PhaseEvaluation,LabDiscovery,LabPerformance} from '../src/types/research-source-contracts.ts';
import type {Strategy as BackendStrategy,EntryResult as BackendEntryResult,evaluateEntry} from '../research/entry-opportunity.ts';
import type {PhaseEvaluation as BackendPhaseEvaluation} from '../supabase/functions/_shared/recommendation-phase.ts';
import type {discoverCandidates,performance} from '../supabase/functions/_shared/owner-trading-lab.ts';
type BackendEntryEvaluation=Awaited<ReturnType<typeof evaluateEntry>>;
type BackendLabDiscovery=ReturnType<typeof discoverCandidates>;
type BackendLabPerformance=ReturnType<typeof performance>;
type IsAny<T>=0 extends (1&T)?true:false;
type Exact<A,B>=(<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)
 ?(<T>()=>T extends B?1:2) extends (<T>()=>T extends A?1:2)?true:false:false;
type Assignable<A,B>=[A] extends [B]?true:false;
type Assert<T extends true>=T;
type AssertFalse<T extends false>=T;
// Instantiate every complete actual comparison; no backend is a DTO alias.
type NoAny=[AssertFalse<IsAny<Strategy>>,AssertFalse<IsAny<EntryResult>>,AssertFalse<IsAny<EntryEvaluation>>,
 AssertFalse<IsAny<PhaseEvaluation>>,AssertFalse<IsAny<LabDiscovery>>,AssertFalse<IsAny<LabPerformance>>,
 AssertFalse<IsAny<BackendStrategy>>,AssertFalse<IsAny<BackendEntryResult>>,AssertFalse<IsAny<BackendEntryEvaluation>>,
 AssertFalse<IsAny<BackendPhaseEvaluation>>,AssertFalse<IsAny<BackendLabDiscovery>>,AssertFalse<IsAny<BackendLabPerformance>>];
type StrategyEquality=[Assert<Assignable<Strategy,BackendStrategy>>,Assert<Assignable<BackendStrategy,Strategy>>,Assert<Exact<Strategy,BackendStrategy>>];
type EntryResultEquality=[Assert<Assignable<EntryResult,BackendEntryResult>>,Assert<Assignable<BackendEntryResult,EntryResult>>,Assert<Exact<EntryResult,BackendEntryResult>>];
type EntryEvaluationEquality=[Assert<Assignable<EntryEvaluation,BackendEntryEvaluation>>,Assert<Assignable<BackendEntryEvaluation,EntryEvaluation>>,Assert<Exact<EntryEvaluation,BackendEntryEvaluation>>];
type PhaseEquality=[Assert<Assignable<PhaseEvaluation,BackendPhaseEvaluation>>,Assert<Assignable<BackendPhaseEvaluation,PhaseEvaluation>>,Assert<Exact<PhaseEvaluation,BackendPhaseEvaluation>>];
type DiscoveryEquality=[Assert<Assignable<LabDiscovery,BackendLabDiscovery>>,Assert<Assignable<BackendLabDiscovery,LabDiscovery>>,Assert<Exact<LabDiscovery,BackendLabDiscovery>>];
type PerformanceEquality=[Assert<Assignable<LabPerformance,BackendLabPerformance>>,Assert<Assignable<BackendLabPerformance,LabPerformance>>,Assert<Exact<LabPerformance,BackendLabPerformance>>];
type NegativeSensitivity=[AssertFalse<Exact<Strategy,string>>,AssertFalse<Exact<EntryResult['name'],string>>,
 AssertFalse<Exact<NonNullable<EntryResult['plan']>['reference_range'],number[]>>,
 AssertFalse<Exact<EntryResult['horizons'],number[]>>,AssertFalse<Exact<EntryEvaluation['owner_only'],true>>,
 AssertFalse<Exact<EntryEvaluation['policy']['minAmount'],number>>,
 AssertFalse<Exact<LabDiscovery['watchlist'][number]['relative_strength'],number|null>>,
 AssertFalse<Exact<PhaseEvaluation['candidates'][number],Omit<PhaseEvaluation['candidates'][number],'relative_strength'>>>,
 AssertFalse<Exact<EntryEvaluation['policy'],{-readonly [K in keyof EntryEvaluation['policy']]:EntryEvaluation['policy'][K]}>>];
export type ResearchSourceContractChecks=[NoAny,StrategyEquality,EntryResultEquality,EntryEvaluationEquality,PhaseEquality,DiscoveryEquality,PerformanceEquality,NegativeSensitivity];
