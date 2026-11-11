import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const modulePath=fileURLToPath(new URL('../scripts/operations/acquire-taiwan-financial-history.py',import.meta.url));
test('an explicit continuation excludes successful, failed and interrupted requests, and rejects mutated tasks without network',()=>{
 const script=`import importlib.util,json,pathlib,sys,tempfile,copy
s=importlib.util.spec_from_file_location('collector',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
with tempfile.TemporaryDirectory() as d:
 p=pathlib.Path(d);tasks=m.planned_report_tasks()
 for task,state in zip(tasks,['CAPTURED','UNAVAILABLE','IN_PROGRESS']):
  (p/(task['source_id']+'-receipt.json')).write_text(json.dumps({**task,'state':state,'status':503 if state=='UNAVAILABLE' else 200 if state=='CAPTURED' else None}))
 plan=m.unattempted_plan(p)
 initial=m.validate_continuation_plan(plan,p)
 # A request attempted after the immutable plan was formed must also be skipped.
 extra=initial[0];(p/(extra['source_id']+'-receipt.json')).write_text(json.dumps({**extra,'state':'IN_PROGRESS'}))
 after=m.validate_continuation_plan(plan,p)
 bad=copy.deepcopy(plan);bad['tasks'][0]['form']['year']='999'
 try:m.validate_continuation_plan(bad,p);mutation='ACCEPTED'
 except ValueError as e:mutation=str(e)
 halted=tasks[-1];(p/'halt-receipt.json').write_text(json.dumps({**halted,'source_halted':True,'state':'UNAVAILABLE'}))
 try:m.validate_continuation_plan(plan,p);halt='ACCEPTED'
 except ValueError as e:halt=str(e)
 print(json.dumps({'total':len(tasks),'initial':len(initial),'excluded':len(plan['excluded_attempts']),'after':len(after),
  'old_ids_absent':not ({x['task_id'] for x in tasks[:3]} & {x['task_id'] for x in initial}),
  'mutation':mutation,'halt':halt,'network_requests':plan['network_requests_performed']}))`;
 const r=spawnSync('python',['-c',script,modulePath],{encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);const result=JSON.parse(r.stdout);
 assert.deepEqual(result,{total:33,initial:30,excluded:3,after:29,old_ids_absent:true,
  mutation:'CONTINUATION_PLAN_TASK_IDENTITY',halt:'CONTINUATION_SOURCE_HALTED',network_requests:0});
});
