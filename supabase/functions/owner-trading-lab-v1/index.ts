import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { loadDecisionEvidence } from '../_shared/decision-v1-data.ts';
import { persistedRecommendationInput } from '../_shared/recommendation-stock-evidence.ts';
import { discoverCandidates, object, records, LAB_VERSION, performance, outcomeFromCloses, taipeiDate, requestIdentity, paperQuote } from '../_shared/owner-trading-lab.ts';

// New Owner-only boundary, not a modification of Core or the dedicated Shadow worker.
// CORS is not authorization. Every operation verifies Supabase Auth AND existing Owner enrollment.
export async function handleOwnerTradingLab(request:Request) {
 const origin=request.headers.get('origin') || '';
 const allowed=origin==='https://morningalphatw.com' || origin==='https://www.morningalphatw.com';
 const headers:Record<string,string>={'Cache-Control':'no-store','Vary':'Origin'};
 if(allowed){headers['Access-Control-Allow-Origin']=origin;headers['Access-Control-Allow-Headers']='authorization, apikey, content-type, x-client-info';headers['Access-Control-Allow-Methods']='POST, OPTIONS';}
 const reply=(status:number,value:unknown)=>Response.json(value,{status,headers});
 if(request.method==='OPTIONS')return new Response(null,{status:allowed?204:403,headers});
 if(origin&&!allowed)return reply(403,{error:'ORIGIN_NOT_ALLOWED'});
 if(request.method!=='POST')return reply(405,{error:'METHOD_NOT_ALLOWED'});
 const authorization=request.headers.get('authorization');
 if(!authorization?.startsWith('Bearer '))return reply(401,{error:'AUTH_REQUIRED'});
 try {
  const userClient=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,
   {global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
  const user=await userClient.auth.getUser(authorization.slice(7));
  if(user.error||!user.data.user)return reply(401,{error:'AUTH_INVALID'});
  const owner=await userClient.rpc('is_research_owner_v1');
  if(owner.error||owner.data!==true)return reply(403,{error:'RESEARCH_OWNER_REQUIRED'});
  const ownerId=user.data.user.id;
  const raw=await request.text();if(raw.length>8192)return reply(413,{error:'INPUT_TOO_LARGE'});
  const body=object(JSON.parse(raw)), operation=body.operation;
  if(!['READ','RECORD_TRADE','RECORD_EXIT','REFRESH_OUTCOMES'].includes(String(operation)))return reply(400,{error:'OPERATION_INVALID'});
  const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
  const now=new Date().toISOString(),date=taipeiDate(now);
  const must=<T>(r:{data:T;error:unknown})=>{if(r.error)throw Error('DEPENDENCY_UNAVAILABLE');return r.data;};
  const trades=records(must(await db.from('owner_lab_trades').select('*').eq('owner_id',ownerId).order('created_at',{ascending:false}).limit(201)));
  if(trades.length>200)return reply(409,{error:'JOURNAL_PAGE_LIMIT','message':'目前超過兩百筆；不把截斷資料當成完整績效。'});
  if(operation==='RECORD_TRADE') {
   if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(String(body.request_id)))return reply(400,{error:'REQUEST_ID_REQUIRED'});
   const existing=trades.find(t=>t.request_id===body.request_id);
   if(existing)return requestIdentity(object(existing.system_snapshot).client_request)===requestIdentity(object(body.trade))
    ?reply(200,{status:'ALREADY_RECORDED',id:existing.id}):reply(409,{error:'IDEMPOTENCY_CONFLICT'});
   if(object(body.trade).kind==='OWNER_EXPERIMENT'){
    // Same verified Owner, separate DB-verified prospective quote/plan. No
    // browser-supplied price, prediction lock or formal recommendation write.
    const result=must(await db.rpc('owner_lab_record_experiment_v1',{p_owner:ownerId,p_request:body.request_id,p_trade:body.trade}));
    return reply(200,result);
   }
  }
  if(operation==='RECORD_EXIT') {
   const e=object(body.event),id=String(body.trade_id);
   if(!trades.some(t=>t.id===id))return reply(404,{error:'TRADE_NOT_FOUND'});
   const result=must(await db.rpc('owner_lab_append_event_v1',{p_owner:ownerId,p_trade_id:id,p_event:{event_type:'EXIT',price:e.price,occurred_at:e.occurred_at}}));
   return reply(200,result);
  }
  if(operation==='REFRESH_OUTCOMES') {
   let appended=0,unavailable=0;
   const previous=trades.length?records(must(await db.from('owner_lab_trade_events').select('trade_id,event_key').in('trade_id',trades.map(t=>String(t.id))))):[];
   for(const t of trades) {
    const targets=object(must(await db.rpc('owner_lab_target_sessions_v1',{p_entry:t.entered_at})));
    for(const [horizon,target] of Object.entries(targets)) {
     if(previous.some(e=>e.trade_id===t.id&&e.event_key===horizon))continue;
     const quotes=records(must(await db.from('market_quotes').select('id,symbol,trading_date,phase,quality_status,freshness_status,captured_at,ingested_at,value')
      .eq('symbol',t.symbol).eq('trading_date',target).eq('phase','close').limit(101)));
     if(quotes.length>100){unavailable++;continue;}
     const result=outcomeFromCloses(t,horizon,String(target),quotes,now);
     if(result.status!=='OBSERVED'){unavailable++;continue;}
     const receipt=object(must(await db.rpc('owner_lab_append_event_v1',{p_owner:ownerId,p_trade_id:t.id,p_event:{event_type:'OUTCOME',horizon,quote_id:result.quote_id}})));
     if(receipt.status==='RECORDED')appended++;
    }
   }
   return reply(200,{status:'REFRESHED',appended,unavailable,business_writes:0});
  }
  const [canonicalResult,shadowResult,calendarResult,eventsResult,qualityResult,ownerAnalysisResult]=await Promise.all([
   db.from('decision_snapshots').select('*').eq('report_date',date).eq('session_type','PREMARKET').eq('is_current',true).lte('created_at',now).order('version',{ascending:false}).limit(1),
   db.from('research_daily_analysis').select('id,analysis,prediction_hash').eq('business_date',date).lte('created_at',now).lte('analysis_cutoff_at',now).order('analysis_cutoff_at',{ascending:false}).limit(1),
   db.rpc('market_calendar_session_v1',{p_market:'TW',p_date:date}),
   trades.length?db.from('owner_lab_trade_events').select('*').in('trade_id',trades.map(t=>String(t.id))).limit(1001):Promise.resolve({data:[],error:null}),
   db.from('prediction_outcomes').select('id,prediction_id,horizon,direction_correct,return_percent,status,data_quality_status,evaluated_at,learning_predictions!inner(prediction_scope,record_status,prediction_at)')
    .eq('horizon','close').eq('status','completed').eq('data_quality_status','complete').eq('learning_predictions.prediction_scope','market').eq('learning_predictions.record_status','valid').lte('evaluated_at',now).order('evaluated_at',{ascending:false}).limit(201),
   userClient.rpc('get_owner_analysis_v2',{p_mode:'FORWARD_SHADOW',p_date:null}),
  ]);
  const canonical=records(must(canonicalResult))[0]||null,shadow=records(must(shadowResult))[0]||null;
  const identity={report_date:date,today_date:date,revision_id:String(canonical?.id || 'NO_CANONICAL'),generated_at:now,data_as_of:now,is_trading_day:must(calendarResult)===true};
  const input=await loadDecisionEvidence(async q=>{
   let query=db.from(q.table).select(q.columns).order(q.order,{ascending:false}).limit(q.limit);
   for(const f of q.filters)query=f.operator==='lte'?query.lte(f.column,f.value):query.gte(f.column,f.value);
   return await query;
  },identity);
  // Owner READ consumes the saved server producer capture, not new provider
  // calls or a second evaluation contract. Existing Auth/RLS remain unchanged.
  const reportResult=await db.from('reports').select('ai_strategy_json').eq('report_date',date).lte('created_at',now).order('created_at',{ascending:false}).limit(1);
  const saved=reportResult.error?{}:object(records(reportResult.data)[0]?.ai_strategy_json);
  const recommendationInput=persistedRecommendationInput(input,identity,saved);
  const discovery=discoverCandidates(recommendationInput.data,identity,canonical,recommendationInput.priorWatch);
  if(operation==='RECORD_TRADE') {
   const requestId=String(body.request_id),draft=object(body.trade);
   const candidate=discovery.watchlist.find(c=>c.symbol===draft.symbol)||null;
   const paper=draft.kind==='SYSTEM_SIMULATION';
   if(!['SYSTEM_SIMULATION','SONY_LIVE_TRADE'].includes(String(draft.kind)))return reply(400,{error:'TRADE_KIND_INVALID'});
   if(paper&&!candidate)return reply(422,{error:'WATCHLIST_EVIDENCE_REQUIRED'});
   const quote=paper?paperQuote(input.quotes,String(draft.symbol),now):null;
   const entry=paper?quote?.value:draft.entry_price;
   if(paper&&(!entry||draft.stop_price==null))return reply(422,{error:'PAPER_PRICE_OR_STOP_MISSING'});
   const trade={kind:draft.kind,symbol:draft.symbol,entered_at:paper?now:draft.entered_at,entry_price:entry,quantity:draft.quantity,
    entry_condition:paper?candidate!.entry_condition:String(draft.entry_condition||'Sony 自行買入；不是系統指令'),stop_price:draft.stop_price??null,
    horizon:draft.horizon,notes:String(draft.notes||'')};
   const snapshot={version:LAB_VERSION,production_eligible:false,as_of:now,canonical,shadow,candidate,discovery,
    client_request:draft,paper_quote_id:quote?.id||null,invalidation:paper?candidate!.invalidation:records(object(shadow?.analysis).invalidation_conditions),
    source_kind:paper?'PROSPECTIVE_PAPER':'SONY_SELF_REPORTED',system_snapshot_id:canonical?.id||null};
   return reply(200,must(await db.rpc('owner_lab_record_trade_v1',{p_owner:ownerId,p_request:requestId,p_trade:trade,p_snapshot:snapshot})));
  }
  const events=records(must(eventsResult));if(events.length>1000)throw Error('EVENT_LIMIT');
  const returns=(kind:string)=>trades.filter(t=>t.kind===kind).flatMap(t=>{
   const e=events.find(e=>e.trade_id===t.id&&e.event_key===(kind==='SONY_LIVE_TRADE'?'EXIT':t.horizon));
   return e?[{id:String(t.id),at:String(e.occurred_at),value:Number(object(e.payload).return_percent)}]:[];
  });
  const qualityRows=records(must(qualityResult));
  const marketQuality=[...new Map(qualityRows.filter(r=>['market','MARKET'].includes(String(object(r.learning_predictions).prediction_scope))
    &&object(r.learning_predictions).record_status==='valid'&&typeof r.direction_correct==='boolean'
    &&Date.parse(String(object(r.learning_predictions).prediction_at))<Date.parse(String(r.evaluated_at))).map(r=>[r.prediction_id,r])).values()];
  const forwardSample=object(must(ownerAnalysisResult)).forward_sample;
  if(!Number.isInteger(forwardSample)||Number(forwardSample)<0)throw Error('FORWARD_SAMPLE_UNAVAILABLE');
  return reply(200,{version:LAB_VERSION,public_product_approval:false,forward_enabled:false,as_of:now,business_date:date,canonical,shadow,
   discovery,trades,events,performance:{system:performance(returns('SYSTEM_SIMULATION')),sony:performance(returns('SONY_LIVE_TRADE')),experiment:performance(returns('OWNER_EXPERIMENT')),
    market:{sample:marketQuality.length,direction_accuracy:qualityRows.length<=200&&marketQuality.length>=5?marketQuality.filter(r=>r.direction_correct).length/marketQuality.length*100:null,
     source:'CLE_CLOSE_DIRECTION_NOT_TRADING_RETURNS',coverage:qualityRows.length>200?'TRUNCATED_NOT_COMPLETE':'BOUNDED_LATEST_200',forward_shadow_sample:forwardSample}}});
 } catch { return reply(422,{error:'OWNER_LAB_UNAVAILABLE',message:'研究資料或交易條件驗證未通過；正式服務未受影響。'}); }
}
Deno.serve(handleOwnerTradingLab);
