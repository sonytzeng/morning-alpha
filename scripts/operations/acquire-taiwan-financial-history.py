#!/usr/bin/env python3
"""Read 33 explicit public MOPS financial reports; never retry an exact request.

Two bounded workers share a two-second minimum between request starts. Raw
wire bytes, decoded HTTP entity bytes, actual times and exact POST forms are
retained. This performs public queries only, with no credentials or cookies.
"""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import gzip
import hashlib
import json
from pathlib import Path
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from lxml import html

BASE='https://mopsov.twse.com.tw/mops/web/'
FAMILIES={'INCOME':'t163sb04','BALANCE':'t163sb05','CASHFLOW':'t163sb20'}
MARKETS={'TWSE':'sii','TPEX':'otc','EMERGING':'rotc'}
MAX_BYTES=16_000_000
MAX_SECONDS=180

def canonical(value):
    return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'))

def digest(value):
    return hashlib.sha256(value).hexdigest()

def now():
    return datetime.now(timezone.utc).isoformat(timespec='microseconds').replace('+00:00','Z')

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        return None

def request_key(url,form):
    return digest(canonical({'method':'POST' if form is not None else 'GET','url':url,'form':form}).encode())

def report_task(market,family,year,quarter):
    if market not in MARKETS or family not in FAMILIES or (year,quarter) not in [(2023,4),(2024,4),(2025,4),(2026,2)]:
        raise ValueError('REPORT_SCOPE')
    if year==2026 and family=='CASHFLOW':
        raise ValueError('REPORT_SCOPE')
    form={'encodeURIComponent':'1','step':'1','firstin':'1','off':'1','TYPEK':MARKETS[market],'year':str(year-1911),'season':f'{quarter:02d}'}
    url=BASE+'ajax_'+FAMILIES[family]
    return {'source_id':f'mops_{family.lower()}_{market}_{year}Q{quarter}','url':url,'method':'POST','form':form,
            'market':market,'family':family,'period':f'{year}Q{quarter}','task_id':request_key(url,form)}

def planned_report_tasks():
    return [report_task(m,f,y,4) for y in [2025,2024,2023] for f in ['CASHFLOW','BALANCE','INCOME'] for m in MARKETS] + \
           [report_task(m,f,2026,2) for f in ['INCOME','BALANCE'] for m in MARKETS]

def unattempted_plan(directory):
    """An offline, explicit list; every receipt, including interrupted intent, excludes a request."""
    attempted={};halted=[]
    for path in sorted(directory.glob('*receipt.json')):
        receipt=json.loads(path.read_text())
        if not receipt.get('url'):continue
        key=request_key(receipt['url'],receipt.get('form'))
        attempted[key]={'receipt':str(path.resolve()),'state':receipt.get('state'),'status':receipt.get('status'),
                        'receipt_sha256':digest(path.read_bytes())}
        if receipt.get('source_halted'):halted.append(str(path.resolve()))
    tasks=planned_report_tasks();pending=[task for task in tasks if task['task_id'] not in attempted]
    return {'schema':'TAIWAN_FINANCIAL_HISTORY_CONTINUATION_V1','formed_at':now(),
            'directory':str(directory.resolve()),'planned_total':len(tasks),'source_halt_receipts':halted,
            'excluded_attempts':[{'source_id':task['source_id'],'task_id':task['task_id'],**attempted[task['task_id']]}
                                 for task in tasks if task['task_id'] in attempted],
            'tasks':pending,'retry_failed_or_interrupted_requests':False,'network_requests_performed':0}

def validate_continuation_plan(plan,directory):
    if plan.get('schema')!='TAIWAN_FINANCIAL_HISTORY_CONTINUATION_V1' or plan.get('directory')!=str(directory.resolve()) \
       or plan.get('retry_failed_or_interrupted_requests') is not False or plan.get('source_halt_receipts'):
        raise ValueError('CONTINUATION_PLAN_SCOPE')
    expected={task['task_id']:task for task in planned_report_tasks()};tasks=plan.get('tasks')
    if not isinstance(tasks,list) or len(tasks)>33:raise ValueError('CONTINUATION_PLAN_TASKS')
    ids=set()
    for task in tasks:
        if not isinstance(task,dict) or task.get('task_id') in ids or expected.get(task.get('task_id'))!=task:
            raise ValueError('CONTINUATION_PLAN_TASK_IDENTITY')
        ids.add(task['task_id'])
    # New receipts written since freezing the plan are also excluded, never retried.
    current=unattempted_plan(directory)
    if current['source_halt_receipts']:raise ValueError('CONTINUATION_SOURCE_HALTED')
    still_unattempted={task['task_id'] for task in current['tasks']}
    return [task for task in tasks if task['task_id'] in still_unattempted]

def write_once(path,content):
    if path.exists():
        if path.read_bytes()!=content:
            raise ValueError('CONTENT_ADDRESS_COLLISION')
    else:
        with path.open('xb') as handle:handle.write(content)

class Collector:
    def __init__(self,directory):
        self.directory=directory;directory.mkdir(parents=True,exist_ok=True)
        self.guard=threading.Lock();self.last_started=0.;self.halted=False;self.cached={};self.receipts=[];self.requests=0;self.started=now()
        self.progress=directory/('financial-acquisition-'+self.started.replace(':','').replace('.','-')+'.json')
        for path in directory.glob('*receipt.json'):
            r=json.loads(path.read_text())
            if not r.get('url') or r.get('method') not in ('POST',None,'GET'):continue
            key=request_key(r['url'],r.get('form'))
            self.cached[key]=r
            if r.get('source_halted'):self.halted=True

    def capture(self,task):
        key=task['task_id']
        with self.guard:
            if key in self.cached:
                r=self.cached[key]
                if r.get('state')=='CAPTURED' or r.get('status')==200 and r.get('raw_path'):
                    raw=Path(r['raw_path']).read_bytes()
                    if digest(raw)!=r['sha256'] or len(raw)!=r['bytes']:raise ValueError('CACHE_BYTES_CHANGED')
                return r,True
            if self.halted or (self.directory/'stop_requested').exists():
                return {**task,'state':'SKIPPED_SOURCE_HALTED' if self.halted else 'SKIPPED_OPERATOR_STOP','attempts':0},True
            delay=2-(time.monotonic()-self.last_started)
            if delay>0:time.sleep(delay)
            self.last_started=time.monotonic();self.requests+=1
            r={'schema':'TAIWAN_FINANCIAL_HISTORY_RECEIPT_V1',**task,'started_at':now(),'attempts':1,'state':'IN_PROGRESS',
               'historical_knowledge':False,'production_writes':0,'maximum_seconds':MAX_SECONDS,'maximum_bytes':MAX_BYTES}
            receipt_path=self.directory/(task['source_id']+'-receipt.json')
            with receipt_path.open('x') as handle:json.dump(r,handle,ensure_ascii=False,indent=2);handle.write('\n')
            self.cached[key]=r
        data=b'';chunks=[];complete=False;start=time.monotonic()
        try:
            form=task.get('form');encoded=urllib.parse.urlencode(form).encode() if form is not None else None
            r['request_form_encoded']=encoded.decode() if encoded is not None else None
            r['request_form_sha256']=digest(encoded) if encoded is not None else None
            headers={'Accept':'text/html','Accept-Encoding':'gzip'}
            if encoded is not None:headers['Content-Type']='application/x-www-form-urlencoded'
            request=urllib.request.Request(task['url'],data=encoded,headers=headers,method=task['method'])
            opener=urllib.request.build_opener(NoRedirect)
            with opener.open(request,timeout=25) as response:
                r.update({'status':response.status,'content_type':response.headers.get('Content-Type',''),
                          'content_encoding':response.headers.get('Content-Encoding','').lower(),'last_modified':response.headers.get('Last-Modified')})
                if response.status!=200 or response.geturl()!=task['url']:raise ValueError('HTTP_STATUS_OR_REDIRECT')
                while True:
                    if time.monotonic()-start>MAX_SECONDS:raise TimeoutError('TOTAL_RESPONSE_DEADLINE')
                    chunk=response.read1(65536)
                    if not chunk:complete=True;break
                    chunks.append(chunk)
                    if sum(map(len,chunks))>MAX_BYTES:raise ValueError('WIRE_RESPONSE_TOO_LARGE')
                data=b''.join(chunks)
            r['received_at']=now()
            encoding=r['content_encoding']
            if encoding not in ('','identity','gzip'):raise ValueError('UNSUPPORTED_CONTENT_ENCODING')
            entity=gzip.decompress(data) if encoding=='gzip' else data
            if not entity or len(entity)>MAX_BYTES:raise ValueError('ENTITY_RESPONSE_SIZE')
            text=entity.decode('utf-8-sig',errors='strict')
            if 'FOR SECURITY REASONS' in text or '因為安全性考量' in text:
                r['source_halted']=True;raise ValueError('OFFICIAL_SECURITY_DENIAL')
            if '<html' not in text.lower() and '<table' not in text.lower():raise ValueError('HTML_REPORT_REQUIRED')
            raw_path=self.directory/(task['source_id']+'-'+digest(entity)+'.html');write_once(raw_path,entity)
            r.update({'raw_path':str(raw_path.resolve()),'sha256':digest(entity),'bytes':len(entity),'entity_bytes_complete':True,
                      'state':'CAPTURED','semantic_validation':'PENDING_PERIOD_FORM_TABLE_UNIT_AND_CUMULATIVE_BASIS'})
        except urllib.error.HTTPError as error:
            r.update({'state':'UNAVAILABLE','status':error.code,'error':'HTTP_'+str(error.code),'source_halted':error.code in (403,429),
                      'redirect_location':error.headers.get('Location')})
            data=error.read(MAX_BYTES+1);complete=len(data)<=MAX_BYTES
            if b'FOR SECURITY REASONS' in data or '因為安全性考量'.encode() in data:r['source_halted']=True
        except (ValueError,UnicodeError,TimeoutError,OSError,urllib.error.URLError) as error:
            r.update({'state':'UNAVAILABLE','error':type(error).__name__+': '+str(error)[:240]})
            if not data:data=b''.join(chunks)
        if data:
            wire_path=self.directory/(task['source_id']+'-wire-'+digest(data)+'.bin');write_once(wire_path,data)
            r.update({'wire_path':str(wire_path.resolve()),'wire_sha256':digest(data),'wire_bytes':len(data),'wire_bytes_complete':complete})
        r.setdefault('received_at',now());r['elapsed_seconds']=round(time.monotonic()-start,3)
        temporary=receipt_path.with_suffix('.json.tmp');temporary.write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n');temporary.replace(receipt_path)
        with self.guard:
            self.cached[key]=r
            if r.get('source_halted'):self.halted=True
        return r,False

    def record(self,receipt,hit):
        with self.guard:
            self.receipts.append(receipt)
            summary={'schema':'TAIWAN_FINANCIAL_HISTORY_ACQUISITION_V1','started_at':self.started,'updated_at':now(),
                     'requests':self.requests,'source_halted':self.halted,'receipts':self.receipts,'production_writes':0}
            self.progress.write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
            print(json.dumps({'source_id':receipt.get('source_id'),'state':receipt.get('state'),'status':receipt.get('status'),
                              'bytes':receipt.get('bytes'),'wire_bytes':receipt.get('wire_bytes'),'elapsed_seconds':receipt.get('elapsed_seconds'),
                              'cache_hit':hit,'error':receipt.get('error'),'completed':len(self.receipts)},ensure_ascii=False),flush=True)

    def verify_forms(self,allow_fetch=True):
        accepted=set()
        for family,code in FAMILIES.items():
            url=BASE+code;task={'source_id':'official_'+code+'_form','url':url,'method':'GET','form':None,'family':family,'task_id':request_key(url,None)}
            if not allow_fetch and task['task_id'] not in self.cached:
                raise ValueError('RETAINED_OFFICIAL_FORM_REQUIRED_'+code)
            receipt,hit=self.capture(task);self.record(receipt,hit)
            if receipt.get('state')!='CAPTURED' and receipt.get('status')!=200:continue
            tree=html.fromstring(Path(receipt['raw_path']).read_bytes(),parser=html.HTMLParser(encoding='utf-8',no_network=True))
            forms=tree.xpath('//form[contains(@action,"ajax_'+code+'")]')
            if len(forms)!=1:raise ValueError('OFFICIAL_FORM_ACTION_CHANGED_'+code)
            values=set(forms[0].xpath('.//select[@name="TYPEK"]/option/@value'))
            if not set(MARKETS.values()).issubset(values) or not forms[0].xpath('.//*[@name="year"]') or not forms[0].xpath('.//*[@name="season"]'):
                raise ValueError('OFFICIAL_FORM_PARAMETERS_CHANGED_'+code)
            accepted.add(family)
        return accepted

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--write-unattempted-plan',type=Path,help='Offline only: save exact requests without any existing receipt.')
    parser.add_argument('--only-unattempted-plan',type=Path,help='Execute only the retained explicit plan, excluding every prior attempt.')
    args=parser.parse_args()
    if args.write_unattempted_plan:
        if args.only_unattempted_plan:raise ValueError('ONE_PLAN_OPERATION')
        plan=unattempted_plan(args.output);write_once(args.write_unattempted_plan,(json.dumps(plan,ensure_ascii=False,indent=2)+'\n').encode())
        print(json.dumps({'plan':str(args.write_unattempted_plan.resolve()),'tasks':len(plan['tasks']),
                          'excluded_attempts':len(plan['excluded_attempts']),'network_requests':0},ensure_ascii=False));return 0
    tasks=validate_continuation_plan(json.loads(args.only_unattempted_plan.read_text()),args.output) if args.only_unattempted_plan else planned_report_tasks()
    collector=Collector(args.output);families=collector.verify_forms(allow_fetch=not args.only_unattempted_plan)
    def run(task):
        if task['family'] not in families:
            collector.record({**task,'state':'OFFICIAL_FORM_REQUIRED','attempts':0},True);return
        receipt,hit=collector.capture(task);collector.record(receipt,hit)
    with ThreadPoolExecutor(max_workers=2) as executor:list(executor.map(run,tasks))
    return 0 if all(r.get('state')=='CAPTURED' or r.get('status')==200 and r.get('raw_path') for r in collector.receipts) else 2

if __name__=='__main__':raise SystemExit(main())
