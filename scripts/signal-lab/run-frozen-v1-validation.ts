#!/usr/bin/env -S deno run --allow-read=/tmp --allow-write=/tmp

import { validateBacktestInputs } from "../../supabase/functions/_shared/signal-lab/backtest-engine.ts";

interface DatasetManifest {
  manifestVersion: string;
  acquiredAt: string;
  researchUseOnly: boolean;
  productionImported: boolean;
  quality?: {
    status?: string;
    tradingDays?: number;
    reasonCodes?: string[];
    availableAtStatus?: string;
    corporateActionStatus?: string;
    survivorshipBiasRisk?: string;
  };
}

function valueFor(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

const dataset = valueFor(Deno.args, "--dataset") || "/tmp/morning-alpha-signal-lab-official-latest";
const output = valueFor(Deno.args, "--output") || `${dataset}/frozen-v1-validation.json`;
if (!dataset.startsWith("/tmp/") || !output.startsWith("/tmp/")) throw new Error("RESEARCH_STORAGE_MUST_BE_ISOLATED_UNDER_TMP");

const manifest = JSON.parse(await Deno.readTextFile(`${dataset}/manifest.json`)) as DatasetManifest;
if (!manifest.researchUseOnly || manifest.productionImported) throw new Error("DATASET_ISOLATION_CONTRACT_MISSING");
const quality = manifest.quality || {};
const validity = validateBacktestInputs({
  availableAtProven: quality.availableAtStatus === "proven",
  corporateActionsHandled: quality.corporateActionStatus === "complete",
  historicalUniverseAvailable: quality.survivorshipBiasRisk === "absent",
  adjustedPriceMethodologyKnown: quality.corporateActionStatus === "complete",
});
const datasetReady = quality.status === "pass" && (quality.tradingDays || 0) >= 252 * 5 && validity.status === "valid";
if (datasetReady) throw new Error("DATASET_READY_REQUIRES_FROZEN_V1_EXPERIMENT_RUNNER");
const result = {
  experimentVersion: "SIGNAL_LAB_FROZEN_V1_VALIDATION_1",
  strategyVersion: "SIGNAL_LAB_V1_SHADOW",
  featureVersion: "SIGNAL_FEATURES_V1",
  manifestVersion: manifest.manifestVersion,
  acquiredAt: manifest.acquiredAt,
  datasetQuality: quality.status || "blocked",
  datasetReasonCodes: quality.reasonCodes || [],
  backtestValidity: validity,
  split: null,
  walkForward: "not_run_invalid_dataset",
  frozenParametersChanged: false,
  sampleSize: 0,
  metrics: {
    hitRate1d: null, hitRate5d: null, hitRate10d: null, hitRate20d: null, hitRate60d: null,
    averageReturn5d: null, averageReturn20d: null, excessReturn5d: null, excessReturn20d: null,
    expectancy: null, profitFactor: null, mfe: null, mae: null,
  },
  baselines: { taiex: null, randomEligible: null, simpleMomentum: null, ma20AboveMa60: null, breakout20d: null },
  scoreCalibration: "insufficient",
  marketRegimeResults: null,
  signalEdge: "INVALID_BACKTEST",
  productionImpact: "ZERO",
};
await Deno.writeTextFile(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ output, ...result }, null, 2));
if (!datasetReady) Deno.exit(4);
