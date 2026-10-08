// SYNTHETIC ISOLATION ONLY. No imports, test registration, network or credentials.
// A factory returns fresh data so visual and unit harnesses cannot mutate each other.
export const OWNER_BACKEND_TODAY='2026-10-08';
export const OWNER_BACKEND_PRIOR='2026-10-07';
export const OWNER_BACKEND_SCENARIOS=Object.freeze([
 'MIDNIGHT_WAITING','CURRENT_PASS','RECOMMENDATION_BLOCKED','DEGRADED',
 'CORE_FAIL','HOLIDAY','CALENDAR_UNKNOWN','OVERDUE',
]);
export function ownerBackendFixture(scenario='MIDNIGHT_WAITING',overrides={}){
 if(!OWNER_BACKEND_SCENARIOS.includes(scenario))throw Error('UNKNOWN_SYNTHETIC_OWNER_SCENARIO');
 const today=OWNER_BACKEND_TODAY,prior=OWNER_BACKEND_PRIOR;
 const r={schema_version:'OWNER_BACKEND_STATUS_V1',business_writes:0,today_date:today,
  as_of:`${today}T00:27:00+08:00`,timezone:'Asia/Taipei',cron_timezone:'GMT',
  calendar:[{date:today,is_trading_day:true},{date:'2026-10-09',is_trading_day:false},{date:'2026-10-10',is_trading_day:false},{date:'2026-10-11',is_trading_day:false},{date:'2026-10-12',is_trading_day:true}],
  schedule:[
   ['morning-alpha-daily-refresh-primary','0 23 * * 0-4'],
   ['morning-alpha-daily-generate-primary','5 23 * * 0-4'],
   ['morning-alpha-daily-deliver-primary','23 23 * * 0-4'],
   ['morning-alpha-runtime-0900-primary','0 1 * * 1-5'],
   ['morning-alpha-runtime-1430-primary','30 6 * * 1-5'],
   ['morning-alpha-cle-primary','40 6 * * 1-5'],
  ].map(([name,expression])=>({name,expression,active:true})),
  sla:[{key:'premarket_delivery_0730',deadline:'07:30',active:true},{key:'closing_verification_completion',deadline:'15:00',active:true}],
  acceptance:{business_date:prior,overall_status:'PASS',verdict:'PASS'},
  history:[{business_date:prior,overall_status:'PASS',verdict:'PASS'},{business_date:'2026-10-06',overall_status:'CORE_FAIL',verdict:'FAIL'}],
  report:{business_date:prior,id:'SYNTHETIC_PRIOR_REPORT',publication_status:'PUBLISHED',publication_date:prior,recommendation_status:'BLOCKED'},
  runtime:null,closing:null,batches:[],line:{total:0,sent:0,failed:0,pending:0,last_sent_at:null},learning:null,stock_data:null,
  news:{selected_48h:0,latest_at:null},
  legacy_health:[{check_date:prior,health_score:25,issues:['SYNTHETIC_OWNER_DIAGNOSTIC']}],
  quality:{market_direction:[30,90].map(days=>({days,samples:0,independent_days:0,accuracy:null,truncated:false,benchmark:null})),
   stock_shadow:{forward_sample:0,completed_forward_dates:0,sample_status:'INSUFFICIENT_SAMPLE',latest_snapshot:null,performance:null}},
 };
 if(['CURRENT_PASS','RECOMMENDATION_BLOCKED','DEGRADED','CORE_FAIL'].includes(scenario)){
  r.as_of=`${today}T16:00:00+08:00`;
  r.acceptance={business_date:today,overall_status:'PASS',verdict:'PASS',dimensions:{RECOMMENDATION:'NONE'}};
  r.report={business_date:today,id:'SYNTHETIC_CURRENT_REPORT',publication_status:'PUBLISHED',publication_date:today,recommendation_status:'NONE'};
  r.runtime={business_date:today,decision_status:'READY',closing_status:'SUCCEEDED'};
  r.closing={business_date:today,data_quality:'高可信',missing_count:0,has_result:true,updated_at:`${today}T14:50:00+08:00`};
  r.learning={business_date:today,status:'succeeded',completed_at:`${today}T14:45:00+08:00`};
  r.line={total:3,sent:3,failed:0,pending:0,last_sent_at:`${today}T07:29:00+08:00`};
  r.batches=['PREMARKET','0900','0930','1030','1300','1410','1430'].map(checkpoint=>({checkpoint,status:'COMMITTED',committed_provider_count:11,expected_provider_count:11,committed_at:`${today}T${checkpoint==='PREMARKET'?'07:00':'14:31'}:00+08:00`}));
  r.stock_data={business_date:today,universe:72,historical_20d:72,failed_captures:0,captured_symbols:72,passed_symbols:72};
  r.news={selected_48h:12,latest_at:`${today}T15:00:00+08:00`};
 }
 if(scenario==='RECOMMENDATION_BLOCKED'){
  r.report.recommendation_status='BLOCKED';r.acceptance.dimensions.RECOMMENDATION='BLOCKED';
 }
 if(scenario==='DEGRADED'){r.acceptance.overall_status='DEGRADED';r.learning.status='degraded';}
 if(scenario==='CORE_FAIL'){r.acceptance.overall_status='CORE_FAIL';r.acceptance.verdict='FAIL';r.runtime.closing_status='FAILED';}
 if(scenario==='HOLIDAY'){
  r.today_date='2026-10-09';r.as_of='2026-10-09T16:00:00+08:00';
  r.report.business_date=today;r.report.publication_date=today;r.acceptance.business_date=today;
 }
 if(scenario==='CALENDAR_UNKNOWN'){
  r.as_of=`${today}T18:00:00+08:00`;r.calendar=r.calendar.map(day=>({...day,is_trading_day:null}));
 }
 if(scenario==='OVERDUE')r.as_of=`${today}T08:00:00+08:00`;
 return {...r,...structuredClone(overrides)};
}

// Convenient names for the external local-only visual harness.
export const syntheticOwnerStatus=ownerBackendFixture;
export function fixture(time='00:27:00'){
 return ownerBackendFixture('MIDNIGHT_WAITING',{as_of:`${OWNER_BACKEND_TODAY}T${time}+08:00`});
}
