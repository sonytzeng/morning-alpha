import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationPath = new URL('../supabase/migrations/20260822090000_continuous_learning_engine_v1.sql', import.meta.url);
const enginePath = new URL('../supabase/functions/continuous-learning-engine/index.ts', import.meta.url);
const apiPath = new URL('../supabase/functions/get-learning-center/index.ts', import.meta.url);
const reportGeneratorPath = new URL('../supabase/functions/generate-daily-report-v7/index.ts', import.meta.url);
const runtimeWorkflowPath = new URL('../.github/workflows/morning-alpha-runtime-checkpoints.yml', import.meta.url);
const deployWorkflowPath = new URL('../.github/workflows/deploy-morning-alpha-runtime.yml', import.meta.url);
const learningCenterPath = new URL('../src/pages/admin/learning/page.tsx', import.meta.url);
const closingVerificationPath = new URL('../supabase/functions/closing-verification-engine/index.ts', import.meta.url);
const deliveryOrchestratorPath = new URL('../supabase/functions/daily-delivery-orchestrator/index.ts', import.meta.url);
const cronBackupPath = new URL('../supabase/migrations/20260824165454_continuous_learning_cron_backup.sql', import.meta.url);

const [
  migration,
  engine,
  api,
  reportGenerator,
  runtimeWorkflow,
  deployWorkflow,
  learningCenter,
  closingVerification,
  deliveryOrchestrator,
  cronBackup,
] = await Promise.all([
  readFile(migrationPath, 'utf8'),
  readFile(enginePath, 'utf8'),
  readFile(apiPath, 'utf8'),
  readFile(reportGeneratorPath, 'utf8'),
  readFile(runtimeWorkflowPath, 'utf8'),
  readFile(deployWorkflowPath, 'utf8'),
  readFile(learningCenterPath, 'utf8'),
  readFile(closingVerificationPath, 'utf8'),
  readFile(deliveryOrchestratorPath, 'utf8'),
  readFile(cronBackupPath, 'utf8'),
]);

test('CLE migration contains the complete internal memory lifecycle', () => {
  for (const table of [
    'learning_predictions',
    'prediction_outcomes',
    'prediction_reviews',
    'learning_cases',
    'market_patterns',
    'learning_rules',
    'rule_backtests',
    'model_evaluations',
    'learning_runs',
    'learning_audit_logs',
  ]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(migration, new RegExp(`'${table}'`));
  }
});

test('predictions and audit logs are append-only while outcome jobs remain idempotent', () => {
  assert.match(migration, /learning_predictions are append-only; create a revision instead/);
  assert.match(migration, /learning_audit_logs are append-only/);
  assert.match(migration, /unique \(prediction_id, horizon\)/);
  assert.match(migration, /idempotency_key text not null unique/);
  assert.match(engine, /onConflict: 'prediction_id,horizon'/);
  assert.match(engine, /onConflict: 'prediction_review_id,case_type'/);
  assert.match(engine, /NO_TRUSTED_PREDICTIONS/);
  assert.match(engine, /CANONICAL_REPORT_MISSING/);
  assert.match(engine, /CANONICAL_DECISION_SNAPSHOT_MISSING/);
  assert.match(engine, /enrichReviewsWithSemanticAnalysis/);
  assert.match(engine, /\.slice\(0, 12\)/);
  assert.match(engine, /if \(!apiKey\) return reviewRows/);
});

test('all learning tables are private and service-role only', () => {
  assert.match(migration, /enable row level security/);
  assert.match(migration, /force row level security/);
  assert.match(migration, /revoke all on table public\.%I from public, anon, authenticated/);
  assert.match(migration, /grant all on table public\.%I to service_role/);
  assert.doesNotMatch(migration, /create policy .*learning_/i);
});

test('rule promotion requires backtest and shadow evidence', () => {
  assert.match(migration, /new\.shadow_sample_size < 10/);
  assert.match(migration, /backtest\.status = 'passed'/);
  assert.match(migration, /backtest\.out_of_sample_size >= 10/);
  assert.match(engine, /production_effect: false/);
  assert.match(engine, /production_rule_mutated: false/);
  assert.match(engine, /updateShadowRules/);
  assert.match(engine, /predictionDate > startedDate/);
  assert.match(engine, /pairedBrierImprovement/);
  assert.match(engine, /paired_brier_improvement_not_statistically_supported/);
  assert.match(engine, /average_max_adverse_excursion/);
  assert.match(engine, /average_abnormal_return/);
  assert.match(migration, /promote_learning_rule_v1/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /grant execute on function public\.promote_learning_rule_v1\(uuid, uuid, text\) to service_role/);
  assert.doesNotMatch(migration, /security definer[\s\S]*promote_learning_rule_v1/i);
  assert.match(migration, /lower\(coalesce\(profile\.role, ''\)\) = 'admin'/);
  assert.match(migration, /shadow_sample_size < 10/);
  assert.match(migration, /out_of_sample_size >= 10/);
});

test('Learning Center verifies user JWT and profiles.role server-side', () => {
  assert.match(api, /auth\.getUser\(accessToken\)/);
  assert.match(api, /from\('profiles'\)/);
  assert.match(api, /toLowerCase\(\) !== 'admin'/);
  assert.match(api, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(api, /rpc\('promote_learning_rule_v1'/);
  assert.match(api, /p_admin_id: userData\.user\.id/);
});

test('Learning Center can restore a verified localhost redirect without persisting its URL', () => {
  assert.match(learningCenter, /new Set\(\['http:\/\/localhost:3000', 'https:\/\/morningalphatw\.com'\]\)/);
  assert.match(learningCenter, /fragment\.get\('access_token'\)/);
  assert.match(learningCenter, /fragment\.get\('refresh_token'\)/);
  assert.match(learningCenter, /supabase\.auth\.setSession/);
  assert.match(learningCenter, /setSessionRedirectUrl\(''\)/);
  assert.doesNotMatch(learningCenter, /localStorage\.setItem|sessionStorage\.setItem|console\.log\(.*Token/);
});

test('next-decision learning is fail-open and reads production rules only', () => {
  assert.match(reportGenerator, /resolveProductionLearningConfidence/);
  assert.match(reportGenerator, /\.eq\('status','production'\)/);
  assert.match(reportGenerator, /LEARNING_CONFIDENCE_DEGRADED/);
  assert.match(reportGenerator, /learning_confidence:\{/);
  assert.doesNotMatch(reportGenerator, /\.eq\('status','candidate'\).*confidence/s);
});

test('learning executes in an isolated job even when the closing job fails', () => {
  assert.match(runtimeWorkflow, /continuous-learning:\n\s+needs:\n\s+- resolve-checkpoint\n\s+- closing/);
  assert.match(runtimeWorkflow, /if: \$\{\{ always\(\) && \(needs\.resolve-checkpoint\.outputs\.checkpoint == '1410'/);
  assert.match(runtimeWorkflow, /id: continuous-learning\n\s+continue-on-error: true/);
  assert.match(runtimeWorkflow, /continuous-learning-engine/);
  assert.match(runtimeWorkflow, /Fetch fresh close snapshots\n\s+if: steps\.closing-state\.outputs\.already_complete != 'true'/);
  assert.match(runtimeWorkflow, /Fetch beneficiary close snapshots\n\s+if: steps\.closing-state\.outputs\.already_complete != 'true'/);
  assert.match(deployWorkflow, /supabase functions deploy continuous-learning-engine/);
  assert.match(deployWorkflow, /supabase functions deploy get-learning-center/);
});

test('daily learning waits for verified closing state without weakening explicit backfill', () => {
  assert.match(engine, /if \(!backfill\) \{/);
  assert.match(engine, /\.from\('trading_day_state'\)/);
  assert.match(engine, /Number\(tradingDayState\?\.state_rank \|\| 0\) >= 80/);
  assert.match(engine, /CLOSING_VERIFICATION_INCOMPLETE/);
  assert.match(engine, /production_rule_mutated: false/);
});

test('closing snapshot uses the production decision snapshot contract', () => {
  assert.match(closingVerification, /action: "CLOSED"/);
  assert.match(closingVerification, /p_session_type: "CLOSING"/);
  assert.doesNotMatch(closingVerification, /action: "VERIFY"/);
  assert.doesNotMatch(closingVerification, /p_session_type: "CLOSE"/);
});

test('Supabase Cron invokes same-day learning through the existing private token route', () => {
  assert.match(deliveryOrchestrator, /body\.mode === 'continuous_learning'/);
  assert.match(deliveryOrchestrator, /'continuous-learning-engine'/);
  assert.match(cronBackup, /morning_alpha_daily_delivery_token/);
  assert.match(cronBackup, /'mode', 'continuous_learning'/);
  assert.match(cronBackup, /'40,50 6 \* \* 1-5'/);
  assert.match(cronBackup, /revoke all on function public\.invoke_continuous_learning_tick_v1\(\) from public, anon, authenticated/);
  assert.doesNotMatch(cronBackup, /target_date|backfill/);
});
