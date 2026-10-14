import {spawnSync} from 'node:child_process';
import {appendFileSync} from 'node:fs';
import {stagedTransition} from '../../tests/helpers/stagedReleaseIntegrity.mjs';
const release=stagedTransition();
if(process.env.GITHUB_OUTPUT&&release)for(const batch of ['A','B1','B2','C'])appendFileSync(process.env.GITHUB_OUTPUT,batch+'='+release.manifests.some(m=>m.batch===batch)+'\n');
if(!release||process.env.MA_FULL_REGRESSION==='1'){
 const r=spawnSync('npm',['run','test:public'],{stdio:'inherit'});if(r.error)throw r.error;process.exit(r.status??1);
}
const targets={
  "A": [
    "tests/ctoConfidencePresentation.test.mjs",
    "tests/ctoHistoricalEvidencePresentation.test.mjs",
    "tests/ctoPerformancePresentation.test.mjs",
    "tests/ctoPricingPresentation.test.mjs",
    "tests/accountSubscriberProjection.test.mjs",
    "tests/ownerCockpit.test.mjs",
    "tests/subscriberStateContract.test.mjs",
    "tests/subscriberStateFrontend.test.mjs",
    "tests/marketNewsReportIntegration.test.mjs"
  ],
  "B1": [
    "tests/recommendationReaderBinding.test.mjs",
    "tests/decisionEvidencePipeline.test.mjs",
    "tests/recommendationRuntimeSmoke.test.mjs",
    "tests/subscriberStateContract.test.mjs",
    "tests/member-entitlement.test.mjs"
  ],
  "B2": [
    "tests/lineProductionPromotion.test.mjs",
    "tests/lineIncidentMessage.test.mjs",
    "tests/lineFinalUsability.test.mjs"
  ],
  "C": [
    "tests/vnextDailyRuntimeRecovery.test.mjs",
    "tests/vnextDailyWiring.test.mjs",
    "tests/recommendationV2ForwardHandler.test.mjs",
    "tests/entryOpportunity.test.mjs",
    "tests/recommendationV2Forward.test.mjs"
  ]
};
const files=[...new Set([...release.manifests.flatMap(m=>targets[m.batch]),'tests/stagedReleaseIntegrity.test.mjs','tests/marketNewsReportIntegrity.test.mjs'])];
console.log(JSON.stringify({scope:'OWNER_APPROVED_AFFECTED_RELEASE_REGRESSION_NOT_FULL_SUITE',profiles:release.manifests.map(m=>m.batch),files,full_suite_retained:'npm run test:public',full_suite_previous_sha:'f786d97bb45101e41e9b8b8b0a616e6dbf6050e0',production_verified:false}));
const r=spawnSync(process.execPath,['--experimental-strip-types','--test','--test-concurrency=1',...files],{stdio:'inherit'});
if(r.error)throw r.error;process.exit(r.status??1);
