#!/usr/bin/env python3
"""Capture only official CSV forms retained in previously captured MOPS HTML.

No invented filename, credential or redirect is permitted. Default collection
skips every prior attempt. A separately frozen recovery plan may authorize one
new attempt for a recorded 503 or socket timeout; access denials remain blocked.
The original CP950 entity and wire bytes are retained separately.
"""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor
import csv
from datetime import datetime,timezone
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from lxml import html

URL='https://mopsov.twse.com.tw/server-java/t105sb02'
FAMILIES={'income':'04','balance':'05','cashflow':'20'}
MARKETS={'TWSE':'sii','TPEX':'otc','EMERGING':'rotc'}
MAX_BYTES=8_000_000

def canonical(value):return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'))
def sha(value):return hashlib.sha256(value).hexdigest()
def now():return datetime.now(timezone.utc).isoformat(timespec='microseconds').replace('+00:00','Z')
def key(url,form):return sha(canonical({'method':'POST','url':url,'form':form}).encode())

def write_once(path,data):
    if path.exists():
        if path.read_bytes()!=data:raise ValueError('IMMUTABLE_BYTES_CHANGED')
    else:
        with path.open('xb') as handle:handle.write(data)

def tasks_from_html(receipt,body,receipt_path=None):
    match=re.fullmatch(r'mops_(income|balance|cashflow)_(TWSE|TPEX|EMERGING)_(20\d\d)Q([1-4])',receipt.get('source_id',''))
    if not match or receipt.get('schema')!='TAIWAN_FINANCIAL_HISTORY_RECEIPT_V1' or receipt.get('state')!='CAPTURED' \
       or receipt.get('status')!=200 or receipt.get('method')!='POST' or len(body)!=receipt.get('bytes') or sha(body)!=receipt.get('sha256'):
        raise ValueError('PARENT_HTML_RECEIPT')
    family,market,year,quarter=match.groups();code='t163sb'+FAMILIES[family]
    expected={'encodeURIComponent':'1','step':'1','firstin':'1','off':'1','TYPEK':MARKETS[market],'year':str(int(year)-1911),'season':f'{int(quarter):02d}'}
    if receipt.get('url')!='https://mopsov.twse.com.tw/mops/web/ajax_'+code or receipt.get('form')!=expected:
        raise ValueError('PARENT_REQUEST_IDENTITY')
    body.decode('utf-8-sig',errors='strict');tree=html.fromstring(body,parser=html.HTMLParser(encoding='utf-8',no_network=True))
    tasks={}
    for form_node in tree.xpath('//form[.//input[@name="filename"]]'):
        pairs=[(node.get('name'),node.get('value','')) for node in form_node.xpath('.//input[@type="hidden"]')]
        if len(pairs)!=len({k for k,v in pairs}):raise ValueError('DUPLICATE_FORM_PARAMETER')
        form=dict(pairs);filename=form.get('filename','')
        allowed_keys=[{'firstin','step','filename','saveCSV'}]
        if family=='balance':allowed_keys.append({'firstin','step','filename'})
        if set(form) not in allowed_keys or form.get('firstin')!='true' or form.get('step')!='10' or ('saveCSV' in form and form['saveCSV']!='Y'):
            raise ValueError('CSV_FORM_PARAMETERS')
        # The retained t163sb05 balance page itself emits legacy t163sb04
        # filenames, with no saveCSV input. Preserve the observed form exactly.
        filename_code=r't163sb(?:04|05)' if family=='balance' else code
        token=re.fullmatch(filename_code+r'_(\d{8})_(\d{6,12})\.csv',filename)
        if not token:raise ValueError('CSV_FILENAME_FAMILY')
        clicks=form_node.xpath('.//button/@onclick')
        if not clicks or any(not re.fullmatch(r"\s*action='/server-java/t105sb02';\s*submit\(\);\s*",v) for v in clicks):
            raise ValueError('CSV_BUTTON_ACTION_REQUIRED')
        source_id=f'MOPS_{family.upper()}_{market}_{year}Q{quarter}_CSV_{token.group(1)}_{token.group(2)}'
        task={'source_id':source_id,'url':URL,'method':'POST','form':form,'task_id':key(URL,form),
              'parent_source_id':receipt['source_id'],'parent_html_sha256':receipt['sha256'],
              'parent_receipt_hash':sha(canonical(receipt).encode()),'parent_request_form':receipt['form'],
              'parent_receipt_path':str(Path(receipt_path).resolve()) if receipt_path else None,
              'market':market,'family':family.upper(),'period':year+'Q'+quarter}
        if filename in tasks and tasks[filename]!=task:raise ValueError('CONFLICTING_EXPORT_FORM')
        tasks[filename]=task
    if not tasks:raise ValueError('NO_OFFICIAL_CSV_FORMS')
    return list(tasks.values())

def cached_receipts(directory):
    found={}
    for path in directory.glob('*receipt.json'):
        receipt=json.loads(path.read_text())
        if receipt.get('url')==URL and receipt.get('method')=='POST' and isinstance(receipt.get('form'),dict):
            found[key(URL,receipt['form'])]=receipt
    return found

def build_plan(directory,parent_source_id=None,filename=None):
    cache=cached_receipts(directory);tasks=[];excluded=[];parents=[];priority={}
    for path in sorted(directory.glob('*receipt.json')):
        r=json.loads(path.read_text())
        if r.get('schema')!='TAIWAN_FINANCIAL_HISTORY_RECEIPT_V1' or r.get('state')!='CAPTURED' \
           or not re.fullmatch(r'mops_(income|balance|cashflow)_(TWSE|TPEX|EMERGING)_20\d\dQ[1-4]',r.get('source_id','')):continue
        if parent_source_id and r['source_id']!=parent_source_id:continue
        raw=Path(r['raw_path']).read_bytes();exports=tasks_from_html(r,raw,path)
        # This affects request order only. Completion still requires every form.
        tree=html.fromstring(raw,parser=html.HTMLParser(encoding='utf-8',no_network=True));counts=[]
        for table in tree.xpath('//table[not(.//table)]'):
            cells=[[c.text_content() for c in row.xpath('./th|./td')] for row in table.xpath('.//tr')]
            if any(len(row)>1 and re.sub(r'\s+','',row[0])=='公司代號' and re.sub(r'\s+','',row[1])=='公司名稱' for row in cells):
                counts.append(sum(bool(row and re.fullmatch(r'\d{4,6}',row[0].strip())) for row in cells))
        if len(counts)==len(exports):priority.update({task['task_id']:count for task,count in zip(exports,counts)})
        parents.append({'source_id':r['source_id'],'sha256':r['sha256'],'forms':len(exports)})
        for task in exports:
            if filename and task['form']['filename']!=filename:continue
            if task['task_id'] in cache:
                old=cache[task['task_id']];excluded.append({'source_id':task['source_id'],'task_id':task['task_id'],'state':old.get('state'),'status':old.get('status')})
            else:tasks.append(task)
    tasks.sort(key=lambda task:(-priority.get(task['task_id'],0),task['period'],task['family'],task['source_id']))
    return {'schema':'MOPS_OFFICIAL_CSV_ACQUISITION_PLAN_V1','formed_at':now(),'directory':str(directory.resolve()),
            'parents':parents,'tasks':tasks,'excluded_attempts':excluded,'source_halted':any(r.get('source_halted') for r in cache.values()),
            'request_order':'LARGEST_RETAINED_INDUSTRY_FIRST_WITH_ALL_FORMS_STILL_REQUIRED',
            'network_requests_performed':0,'retry_attempted_requests':False}

def validate_plan(plan,directory):
    if plan.get('schema')!='MOPS_OFFICIAL_CSV_ACQUISITION_PLAN_V1' or plan.get('directory')!=str(directory.resolve()) \
       or plan.get('retry_attempted_requests') is not False or plan.get('source_halted') or not isinstance(plan.get('tasks'),list) or len(plan['tasks'])>220:
        raise ValueError('CSV_ACQUISITION_PLAN')
    cache=cached_receipts(directory)
    if any(r.get('source_halted') for r in cache.values()):raise ValueError('CSV_SOURCE_HALTED')
    tasks=[];seen=set();parents={}
    for task in plan['tasks']:
        path=Path(task['parent_receipt_path'])
        if path.parent.resolve()!=directory.resolve():raise ValueError('CSV_PARENT_DIRECTORY')
        if str(path) not in parents:
            receipt=json.loads(path.read_text());parents[str(path)]={t['task_id']:t for t in tasks_from_html(receipt,Path(receipt['raw_path']).read_bytes(),path)}
        if task.get('task_id') in seen or parents[str(path)].get(task.get('task_id'))!=task:raise ValueError('CSV_PLAN_FORM_CHANGED')
        seen.add(task['task_id'])
        if task['task_id'] not in cache:tasks.append(task)
    return tasks

def validate_transient_csv_recovery(task,recovery,directory):
    """A separately frozen plan may grant one new attempt, never an access-denial retry."""
    if not isinstance(recovery,dict) or recovery.get('new_attempt_ordinal')!=2 or not re.fullmatch(r'[a-f0-9]{64}',recovery.get('plan_hash','')):
        raise ValueError('CSV_RECOVERY_SCOPE')
    prior_path=Path(recovery['prior_receipt_path'])
    if prior_path.parent.resolve()!=directory.resolve():raise ValueError('CSV_RECOVERY_RECEIPT_PATH')
    raw=prior_path.read_bytes();prior=json.loads(raw)
    if sha(raw)!=recovery.get('prior_receipt_sha256') or prior.get('url')!=URL or prior.get('form')!=task['form'] \
       or prior.get('state')!='UNAVAILABLE' or prior.get('source_halted') or prior.get('attempts',1)!=1:
        raise ValueError('CSV_RECOVERY_PRIOR_IDENTITY')
    transient=prior.get('status')==503 or prior.get('status') in (None,200) and str(prior.get('error','')).startswith('TimeoutError:')
    if not transient:raise ValueError('CSV_RECOVERY_NOT_TRANSIENT')
    parent_path=Path(task['parent_receipt_path']);parent=json.loads(parent_path.read_text())
    choices=tasks_from_html(parent,Path(parent['raw_path']).read_bytes(),parent_path)
    if task not in choices:raise ValueError('CSV_RECOVERY_FORM_CHANGED')
    return prior

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):return None

class CsvCollector:
    def __init__(self,directory,throttle_seconds=2):
        if not 2<=throttle_seconds<=30:raise ValueError('CSV_THROTTLE_SCOPE')
        self.directory=directory;self.throttle_seconds=throttle_seconds;self.guard=threading.Lock();self.last_start=0.;self.halted=False;self.receipts=[]
        self.progress=directory/('csv-acquisition-'+now().replace(':','').replace('.','-')+'.json')
    def run(self,task,recovery=None):
        with self.guard:
            if self.halted or (self.directory/'csv_stop_requested').exists():return
            cache=cached_receipts(self.directory)
            if recovery is None:
                if task['task_id'] in cache:return
                receipt_name=task['source_id']+'-receipt.json'
            else:
                validate_transient_csv_recovery(task,recovery,self.directory)
                receipt_name=task['source_id']+'-transient-attempt-2-receipt.json'
                if (self.directory/receipt_name).exists():return
            delay=self.throttle_seconds-(time.monotonic()-self.last_start)
            if delay>0:time.sleep(delay)
            self.last_start=time.monotonic()
            r={'schema':'TAIWAN_FINANCIAL_CSV_RECEIPT_V1',**task,'state':'IN_PROGRESS','started_at':now(),
               'attempts':1,'maximum_seconds':120,'maximum_bytes':MAX_BYTES,'historical_knowledge':False}
            if recovery is not None:r.update({'attempts':2,'attempt_count_this_execution':1,'recovery_of':recovery})
            rp=self.directory/receipt_name
            with rp.open('x') as f:json.dump(r,f,ensure_ascii=False,indent=2);f.write('\n')
        start=time.monotonic();wire=b'';chunks=[];complete=False
        try:
            encoded=urllib.parse.urlencode(task['form']).encode()
            r['request_form_encoded']=encoded.decode();r['request_form_sha256']=sha(encoded)
            req=urllib.request.Request(URL,data=encoded,method='POST',headers={'Accept':'text/csv','Accept-Encoding':'gzip','Content-Type':'application/x-www-form-urlencoded'})
            with urllib.request.build_opener(NoRedirect).open(req,timeout=25) as response:
                r.update({'status':response.status,'content_type':response.headers.get('Content-Type',''),
                          'content_encoding':response.headers.get('Content-Encoding','').lower()})
                if response.status!=200 or response.geturl()!=URL:raise ValueError('CSV_HTTP_OR_REDIRECT')
                while True:
                    if time.monotonic()-start>120:raise TimeoutError('CSV_RESPONSE_DEADLINE')
                    chunk=response.read1(65536)
                    if not chunk:complete=True;break
                    chunks.append(chunk)
                    if sum(map(len,chunks))>MAX_BYTES:raise ValueError('CSV_WIRE_SIZE')
                wire=b''.join(chunks)
            r['received_at']=now()
            if r['content_encoding'] not in ('','identity','gzip'):raise ValueError('CSV_CONTENT_ENCODING')
            raw=gzip.decompress(wire) if r['content_encoding']=='gzip' else wire
            if not raw or len(raw)>MAX_BYTES:raise ValueError('CSV_ENTITY_SIZE')
            if b'FOR SECURITY REASONS' in raw: r['source_halted']=True;raise ValueError('CSV_SECURITY_DENIAL')
            text=raw.decode('cp950',errors='strict')
            if '因為安全性考量' in text or 'access denied' in text.lower() or 'forbidden' in text.lower():
                r['source_halted']=True;raise ValueError('CSV_SECURITY_DENIAL')
            if '<html' in text.lower() or '<!doctype' in text.lower() or '<table' in text.lower():raise ValueError('CSV_RETURNED_HTML')
            rows=list(csv.reader(io.StringIO(text,newline=''),strict=True))
            rows=[row for row in rows if any(cell!='' for cell in row)]
            if not rows or rows[0][:5]!=['出表日期','年度','季別','公司代號','公司名稱'] or len(set(rows[0]))!=len(rows[0]) \
               or any(len(row)!=len(rows[0]) for row in rows[1:]):raise ValueError('CSV_NATIVE_HEADER_OR_WIDTH')
            raw_path=self.directory/(task['source_id']+'-'+sha(raw)+'.csv');write_once(raw_path,raw)
            r.update({'state':'CAPTURED','raw_path':str(raw_path.resolve()),'sha256':sha(raw),'bytes':len(raw),'entity_bytes_complete':True,
                      'encoding':'CP950','decoded_text_sha256':sha(text.encode()),'csv_row_count':len(rows),'data_row_count':len(rows)-1,
                      'semantic_validation':'PENDING_PARENT_YEAR_QUARTER_AND_ALL_CELLS'})
        except urllib.error.HTTPError as e:
            r.update({'state':'UNAVAILABLE','status':e.code,'error':'HTTP_'+str(e.code),'source_halted':e.code in (301,302,303,307,308,401,403,407,429),'redirect_location':e.headers.get('Location')})
            wire=e.read(MAX_BYTES+1);complete=len(wire)<=MAX_BYTES
            if b'FOR SECURITY REASONS' in wire:r['source_halted']=True
        except (ValueError,UnicodeError,OSError,TimeoutError,urllib.error.URLError,csv.Error) as e:
            r.update({'state':'UNAVAILABLE','error':type(e).__name__+': '+str(e)[:240]})
            if not wire:wire=b''.join(chunks)
        if wire:
            wp=self.directory/(task['source_id']+'-wire-'+sha(wire)+'.bin');write_once(wp,wire)
            r.update({'wire_path':str(wp.resolve()),'wire_sha256':sha(wire),'wire_bytes':len(wire),'wire_bytes_complete':complete})
        r.setdefault('received_at',now());r['elapsed_seconds']=round(time.monotonic()-start,3)
        tmp=rp.with_suffix('.json.tmp');tmp.write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n');tmp.replace(rp)
        with self.guard:
            self.halted=self.halted or bool(r.get('source_halted'));self.receipts.append(r)
            self.progress.write_text(json.dumps({'schema':'MOPS_CSV_ACQUISITION_PROGRESS_V1','updated_at':now(),'source_halted':self.halted,'receipts':self.receipts},ensure_ascii=False,indent=2)+'\n')
            print(json.dumps({'source_id':r['source_id'],'state':r['state'],'status':r.get('status'),'bytes':r.get('bytes'),
                              'data_rows':r.get('data_row_count'),'error':r.get('error'),'completed':len(self.receipts)},ensure_ascii=False),flush=True)
        return r

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--directory',type=Path,required=True)
    p.add_argument('--write-plan',type=Path);p.add_argument('--execute-plan',type=Path)
    p.add_argument('--parent-source-id');p.add_argument('--filename');p.add_argument('--workers',type=int,choices=[1,2],default=2)
    p.add_argument('--throttle-seconds',type=float,default=2);args=p.parse_args()
    if bool(args.write_plan)==bool(args.execute_plan):raise ValueError('ONE_CSV_PLAN_OPERATION_REQUIRED')
    if args.write_plan:
        plan=build_plan(args.directory,args.parent_source_id,args.filename);write_once(args.write_plan,(json.dumps(plan,ensure_ascii=False,indent=2)+'\n').encode())
        print(json.dumps({'plan':str(args.write_plan.resolve()),'tasks':len(plan['tasks']),'excluded':len(plan['excluded_attempts']),'network_requests':0}));return 0
    tasks=validate_plan(json.loads(args.execute_plan.read_text()),args.directory);collector=CsvCollector(args.directory,args.throttle_seconds)
    with ThreadPoolExecutor(max_workers=args.workers) as executor:list(executor.map(collector.run,tasks))
    return 0 if all(r['state']=='CAPTURED' for r in collector.receipts) and not collector.halted else 2

if __name__=='__main__':raise SystemExit(main())
