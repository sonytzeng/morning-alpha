#!/usr/bin/env python3
"""Bind original MOPS CSV bytes, explicit report periods and every HTML cell.

The official CSV is the admitted source. Parent HTML supplies the original
export form, market identity and explicit units. Neither source is rewritten.
"""
from __future__ import annotations
import argparse
import csv
from collections import Counter
from datetime import date,datetime,timedelta,timezone
from decimal import Decimal,InvalidOperation
import hashlib
import importlib.util
import io
import json
import math
from pathlib import Path
import re

ROOT=Path(__file__).resolve().parents[1]
def load_module(name,path):
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
history=load_module('financial_html',ROOT/'research/taiwan-market-financial-history.py')
acquire=load_module('financial_csv_acquire',ROOT/'scripts/operations/acquire-taiwan-financial-csv.py')
PARSER_VERSION='MOPS_OFFICIAL_CSV_HTML_MATCH_20261111_V1'
DEFINITION_SOURCE={'url':'https://mopsfin.twse.com.tw/','verified_on':'2026-11-11',
                   'source_labels':{'INCOME':'綜合損益表(累計)','CASHFLOW':'現金流量表(累計)'},
                   'scope':'OFFICIAL_STATEMENT_CUMULATIVE_DEFINITION_NOT_COMPANY_FORECAST'}
_PARENT_CACHE={}

def canonical(value):return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'))
def sha(value):return hashlib.sha256(value).hexdigest()
def hashed(value):return sha(canonical(value).encode())
def derived_document_hash(value):
    # Source receipts remain byte-for-byte unchanged. The JS consumer hashes
    # JSON numeric values, where 15.0 and 15 (also -0.0 and 0) are identical.
    # Original collector timing fields can contain integral Python floats.
    def numbers(item):
        if isinstance(item,float):
            if not math.isfinite(item):raise ValueError('DERIVED_NONFINITE_NUMBER')
            return int(item) if item.is_integer() else item
        if isinstance(item,list):return [numbers(v) for v in item]
        if isinstance(item,dict):return {k:numbers(v) for k,v in item.items()}
        return item
    return hashed(numbers(value))
def normalized(value):return re.sub(r'\s+','',value)
def stamp(value):return datetime.fromisoformat(value.replace('Z','+00:00'))

def normalized_parent(receipt,raw):
    # Six industry exports often share a large, immutable parent. The cache
    # key covers both the complete receipt and actual raw bytes, never a path
    # or source id that could silently point to a later version.
    key=(hashed(receipt),sha(raw))
    if key not in _PARENT_CACHE:
        if len(_PARENT_CACHE)>=64:_PARENT_CACHE.pop(next(iter(_PARENT_CACHE)))
        _PARENT_CACHE[key]=(history.normalize_mops_report(receipt,raw),acquire.tasks_from_html(receipt,raw))
    return _PARENT_CACHE[key]

def rows_from_cp950(raw):
    if not isinstance(raw,bytes) or not 1<=len(raw)<=8_000_000:raise ValueError('CSV_BYTES_SCOPE')
    text=raw.decode('cp950',errors='strict')
    if text.encode('cp950',errors='strict')!=raw:raise ValueError('CSV_CP950_ROUNDTRIP')
    if '<html' in text.lower() or 'FOR SECURITY REASONS' in text:raise ValueError('CSV_IS_NOT_REPORT')
    rows=[row for row in csv.reader(io.StringIO(text,newline=''),strict=True) if any(cell!='' for cell in row)]
    if not rows or len(rows)>10001 or rows[0][:5]!=['出表日期','年度','季別','公司代號','公司名稱'] \
       or not 6<=len(rows[0])<=128 or len(set(rows[0]))!=len(rows[0]) \
       or len(set(normalized(v) for v in rows[0]))!=len(rows[0]) \
       or any(len(row)!=len(rows[0]) or any(len(v.encode())>65536 for v in row) for row in rows):
        raise ValueError('CSV_REPORT_ROWS')
    return text,rows

def equivalent_cell(a,b):
    """Accept numeric display formatting only; an absent value never becomes zero."""
    if normalized(a)==normalized(b):return True
    def number(value):
        text=value.strip().replace(',','')
        if re.fullmatch(r'\(\d+(?:\.\d+)?\)',text):text='-'+text[1:-1]
        if not re.fullmatch(r'-?\d+(?:\.\d+)?',text):return None
        try:return Decimal(text)
        except InvalidOperation:return None
    x,y=number(a),number(b)
    return x is not None and y is not None and x==y

def roc_date(value):
    match=re.fullmatch(r'(\d{2,3})/(\d{1,2})/(\d{1,2})',value)
    if not match:raise ValueError('CSV_EXPORT_DATE')
    return date(int(match.group(1))+1911,int(match.group(2)),int(match.group(3)))

def normalize_mops_csv(receipt,raw,parent_receipt,parent_raw):
    parent,tasks=normalized_parent(parent_receipt,parent_raw)
    candidates=[task for task in tasks if task['form']==receipt.get('form')]
    if len(candidates)!=1:raise ValueError('CSV_NOT_IN_PARENT_EXPORT_FORMS')
    task=candidates[0]
    if receipt.get('schema')!='TAIWAN_FINANCIAL_CSV_RECEIPT_V1' or receipt.get('state')!='CAPTURED' or receipt.get('status')!=200 \
       or receipt.get('url')!=acquire.URL or receipt.get('method')!='POST' \
       or receipt.get('parent_html_sha256')!=parent_receipt['sha256'] or receipt.get('sha256')!=sha(raw) or receipt.get('bytes')!=len(raw) \
       or receipt.get('entity_bytes_complete',True) is not True or stamp(receipt['started_at'])>stamp(receipt['received_at']) \
       or stamp(receipt['started_at'])<stamp(parent_receipt['received_at']):
        raise ValueError('CSV_SOURCE_RECEIPT')
    for field,expected in [('parent_source_id',task['parent_source_id']),('parent_request_form',parent_receipt['form']),('parent_receipt_hash',hashed(parent_receipt))]:
        if field in receipt and receipt[field]!=expected:raise ValueError('CSV_PARENT_BINDING')
    text,rows=rows_from_cp950(raw);headers=rows[0];year=int(parent['period'][:4]);quarter=int(parent['period'][-1])
    if receipt.get('decoded_text_sha256') is not None and receipt['decoded_text_sha256']!=sha(text.encode()):raise ValueError('CSV_DECODED_HASH')
    allowed_header_sets={tuple(normalized(h) for h in table['headers']) for table in parent['tables']}
    if tuple(normalized(h) for h in headers[3:]) not in allowed_header_sets:raise ValueError('CSV_HEADERS_DIFFER_FROM_HTML')
    public_receipt={'schema':'TAIWAN_PUBLIC_SOURCE_RECEIPT_V1','source_id':task['source_id'],'url':acquire.URL,
                    'format':'csv','state':'CAPTURED','status':200,'started_at':receipt['started_at'],'received_at':receipt['received_at'],
                    'bytes':len(raw),'sha256':sha(raw),'encoding':'CP950','decoded_text_sha256':sha(text.encode()),
                    'row_layout':'HEADER_AND_DATA_ARRAYS_V1','row_count':len(rows),'data_row_count':len(rows)-1,
                    'request_method':'POST','request_form':receipt['form'],'parent_html_sha256':parent_receipt['sha256'],
                    'parent_request_url':parent_receipt['url'],'parent_request_form':parent_receipt['form'],
                    'parent_receipt_hash':hashed(parent_receipt),'original_csv_receipt_hash':hashed(receipt),
                    'historical_knowledge':False}
    capture_id=hashed({'source_id':task['source_id'],'url':acquire.URL,'source_sha256':sha(raw),'received_at':receipt['received_at']})
    source_base={'capture_id':capture_id,'source_id':task['source_id'],'source_url':acquire.URL,'source_sha256':sha(raw),
                 'source_bytes':len(raw),'received_at':receipt['received_at'],'encoding':'CP950','decoded_text_sha256':sha(text.encode()),
                 'parser_version':PARSER_VERSION,'parent_html_sha256':parent_receipt['sha256'],'parent_financial_history_hash':parent['financial_history_hash'],
                 'header_row_hash':hashed(headers),'csv_filename':receipt['form']['filename']}
    parent_by_symbol={row['symbol']:row for row in parent['records']};records=[];seen=set()
    for row_index,row in enumerate(rows[1:],1):
        if not re.fullmatch(r'\d{2,3}',row[1]) or int(row[1])+1911!=year or not re.fullmatch(r'0?[1-4]',row[2]) or int(row[2])!=quarter:
            raise ValueError('CSV_YEAR_QUARTER_MISMATCH')
        export_date=roc_date(row[0]);received_date=stamp(receipt['received_at']).astimezone(timezone(timedelta(hours=8))).date()
        period_end=date(year,quarter*3+1,1)-timedelta(days=1) if quarter<4 else date(year,12,31)
        if export_date>received_date or export_date<period_end:raise ValueError('CSV_EXPORT_DATE_SCOPE')
        symbol=row[3]
        if symbol not in parent_by_symbol or symbol in seen:raise ValueError('CSV_COMPANY_IDENTITY_OR_DUPLICATE')
        seen.add(symbol);html_row=parent_by_symbol[symbol];keys=[normalized(h) for h in headers[3:]]
        if set(keys)!=set(html_row['normalized_fields']):raise ValueError('CSV_COMPANY_COLUMNS_DIFFER_FROM_HTML')
        for header,value in zip(keys,row[3:]):
            if not equivalent_cell(value,html_row['normalized_fields'][header]):raise ValueError('CSV_HTML_CELL_MISMATCH:'+symbol+':'+header)
        units_by_key={normalized(k):v for k,v in html_row['field_units'].items()}
        fields=dict(zip(headers[3:],row[3:]));field_units={header:units_by_key[normalized(header)] for header in headers[3:]}
        capture={**source_base,'row_index':row_index,'row_path':[row_index],'symbol_field':'3','source_row_hash':hashed(row),
                 'parent_html_record_hash':html_row['record_hash']}
        family=parent['family'];period_basis='POINT_IN_TIME_AS_REPORTED' if family=='BALANCE' else 'YTD_AS_REPORTED'
        record={'security_id':html_row['security_id'],'market':parent['market'],'symbol':symbol,'company_as_reported':row[4],
                'period':parent['period'],'family':family,'period_basis':period_basis,
                'period_identity_basis':'CSV_RESPONSE_YEAR_QUARTER_MATCHED_PARENT_REQUEST',
                'period_scope':'POINT_IN_TIME' if family=='BALANCE' else 'FULL_FISCAL_YEAR_AS_REPORTED' if quarter==4 else f'CUMULATIVE_THROUGH_Q{quarter}',
                'period_definition_source':None if family=='BALANCE' else DEFINITION_SOURCE,
                'parent_cumulative_statement_note_present':parent['cumulative_statement_note_present'],
                'amount_unit':parent['amount_unit'],'amount_unit_basis':'MATCHED_PARENT_HTML_EXPLICIT_UNIT',
                'fields':fields,'normalized_fields':dict(zip(keys,row[3:])),'field_units':field_units,'eps_basis':html_row['eps_basis'],
                'export_date_as_reported':row[0],'source_url':acquire.URL,'available_at':receipt['received_at'],'first_seen_at':receipt['received_at'],
                'published_at':None,'source_capture':capture,'source_cells_matched_parent_html':True,
                'forecast':False,'fcfe_inferred':False,'single_quarter_inferred':False}
        record['record_hash']=hashed(record);records.append(record)
    records.sort(key=lambda row:row['symbol'])
    body={'schema':'TAIWAN_MARKET_FINANCIAL_CSV_V1','parser_version':PARSER_VERSION,'source_id':task['source_id'],
          'parent_source_id':parent['source_id'],'parent_html_sha256':parent_receipt['sha256'],'parent_financial_history_hash':parent['financial_history_hash'],
          'market':parent['market'],'family':parent['family'],'period':parent['period'],'company_count':len(records),
          'source_receipt':public_receipt,'original_source_receipt':receipt,'source_capture':source_base,'records':records,
          'raw_csv_headers':headers,'valid_empty_industry':len(records)==0,'all_cells_matched_parent':True,
          'period_identity_basis':'CSV_RESPONSE_YEAR_QUARTER_MATCHED_PARENT_REQUEST' if records else 'PARENT_REQUEST_ONLY_EMPTY_INDUSTRY',
          'publication_time_known':False,'historical_knowledge':False,'methodology_approved':False,'member_published':False}
    return {**body,'financial_history_hash':derived_document_hash(body)}

def coverage(parent_receipt,parent_raw,documents):
    parent,tasks=normalized_parent(parent_receipt,parent_raw)
    expected={task['source_id'] for task in tasks};present={doc['source_id'] for doc in documents};symbols=[r['symbol'] for doc in documents for r in doc['records']]
    duplicates=sorted(s for s,count in Counter(symbols).items() if count>1);expected_symbols={r['symbol'] for r in parent['records']}
    missing_exports=sorted(expected-present);missing_symbols=sorted(expected_symbols-set(symbols));extra=sorted(set(symbols)-expected_symbols)
    complete=not missing_exports and not missing_symbols and not duplicates and not extra and present<=expected
    return {'parent_source_id':parent['source_id'],'parent_html_sha256':parent_receipt['sha256'],'market':parent['market'],'family':parent['family'],
            'period':parent['period'],'expected_exports':len(expected),'captured_and_verified_exports':len(present),'expected_companies':len(expected_symbols),
            'verified_companies':len(set(symbols)),'missing_exports':missing_exports,'missing_symbols':missing_symbols,'extra_symbols':extra,
            'duplicate_symbols':duplicates,'complete':complete,'scope':'ALL_RETAINED_PARENT_HTML_EXPORT_FORMS_AND_COMPANY_CELLS'}

def logical_report_coverage(parent_versions,documents):
    """Verify company values across immutable exports of an unchanged report.

    Refreshing an expired native export creates a new HTML/filename version.
    The earlier captures keep their own timestamps and parents. They count
    here only if the entire parent's financial contents are still identical.
    This is company-value coverage, not a claim that every new export file
    was fetched or that a missing original download succeeded.
    """
    if not parent_versions:raise ValueError('LOGICAL_REPORT_PARENT_REQUIRED')
    versions=[(r,normalized_parent(r,raw)[0],normalized_parent(r,raw)[1]) for r,raw in parent_versions]
    identities={(p['source_id'],p['market'],p['family'],p['period']) for _,p,_ in versions}
    if len(identities)!=1:raise ValueError('LOGICAL_REPORT_IDENTITY')
    latest_receipt,latest,latest_tasks=max(versions,key=lambda item:stamp(item[0]['received_at']))
    allowed={p['financial_history_hash']:p['source_capture']['source_sha256'] for _,p,_ in versions
             if p['semantic_values_hash']==latest['semantic_values_hash']}
    expected={r['symbol']:r for r in latest['records']};matching={};excluded=[];mismatches=[];accepted_exports=set()
    for doc in documents:
        if doc['parent_source_id']!=latest['source_id'] or doc['market']!=latest['market'] or doc['family']!=latest['family'] or doc['period']!=latest['period']:
            raise ValueError('LOGICAL_REPORT_DOCUMENT_IDENTITY')
        if allowed.get(doc['parent_financial_history_hash'])!=doc['parent_html_sha256']:
            excluded.append(doc['source_id']);continue
        accepted_exports.add(doc['source_id'])
        for row in doc['records']:
            target=expected.get(row['symbol']);fields=row['normalized_fields']
            if target is None or set(fields)!=set(target['normalized_fields']) or any(not equivalent_cell(value,target['normalized_fields'][key]) for key,value in fields.items()):
                mismatches.append({'source_id':doc['source_id'],'symbol':row['symbol'],'reason':'CSV_VALUES_DIFFER_FROM_LATEST_PARENT'});continue
            matching.setdefault(row['symbol'],[]).append(row)
    missing=sorted(set(expected)-set(matching));latest_ids={task['source_id'] for task in latest_tasks}
    return {'parent_source_id':latest['source_id'],'market':latest['market'],'family':latest['family'],'period':latest['period'],
            'latest_parent_html_sha256':latest_receipt['sha256'],'latest_parent_received_at':latest_receipt['received_at'],
            'latest_parent_semantic_values_hash':latest['semantic_values_hash'],'parent_versions':len(versions),
            'expected_companies':len(expected),'verified_companies':len(matching),'missing_symbols':missing,
            'mismatched_company_values':mismatches,'excluded_changed_parent_exports':sorted(excluded),
            'multiple_identical_company_observations':sorted(symbol for symbol,rows in matching.items() if len(rows)>1),
            'all_latest_export_files_captured':latest_ids<=accepted_exports,'complete':not missing and not mismatches,
            'scope':'ALL_LATEST_PARENT_COMPANY_VALUES_FROM_MATCHING_IMMUTABLE_CSV_OBSERVATIONS',
            'original_capture_times_and_parent_bindings_preserved':True}

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--directory',type=Path,required=True);p.add_argument('--output',type=Path,required=True);args=p.parse_args()
    args.output.mkdir(parents=True,exist_ok=True);parents={};parents_by_html={};csv_receipts=[]
    for path in sorted(args.directory.glob('*receipt.json')):
        r=json.loads(path.read_text())
        if r.get('state')!='CAPTURED':continue
        if r.get('schema')=='TAIWAN_FINANCIAL_HISTORY_RECEIPT_V1' and re.fullmatch(r'mops_(income|balance|cashflow)_(TWSE|TPEX|EMERGING)_20\d\dQ[1-4]',r.get('source_id','')):
            parents[hashed(r)]=(r,Path(r['raw_path']).read_bytes());parents_by_html.setdefault(r['sha256'],[]).append(hashed(r))
        elif r.get('schema')=='TAIWAN_FINANCIAL_CSV_RECEIPT_V1' and r.get('url')==acquire.URL:csv_receipts.append(r)
    documents=[];failures=[];files=[]
    for receipt in csv_receipts:
        try:
            if receipt.get('parent_receipt_hash') is not None:
                parent=parents.get(receipt['parent_receipt_hash'])
            else:
                candidates=parents_by_html.get(receipt.get('parent_html_sha256'),[])
                if len(candidates)>1:raise ValueError('CSV_PARENT_RECEIPT_AMBIGUOUS')
                parent=parents.get(candidates[0]) if candidates else None
            if parent is None:raise ValueError('CSV_PARENT_RAW_REQUIRED')
            result=normalize_mops_csv(receipt,Path(receipt['raw_path']).read_bytes(),*parent);documents.append(result)
            output=args.output/(result['source_id']+'-'+result['source_capture']['source_sha256']+'.json')
            acquire.write_once(output,(json.dumps(result,ensure_ascii=False,indent=2)+'\n').encode())
            public_path=args.output/(result['source_id']+'-public-receipt.json')
            acquire.write_once(public_path,(json.dumps(result['source_receipt'],ensure_ascii=False,indent=2)+'\n').encode())
            files.append({'source_id':result['source_id'],'parent_source_id':result['parent_source_id'],'market':result['market'],'family':result['family'],
                          'period':result['period'],'company_count':result['company_count'],'financial_history_hash':result['financial_history_hash'],
                          'file':str(output.resolve()),'public_receipt_file':str(public_path.resolve()),'raw_csv_file':receipt['raw_path']})
        except Exception as e:failures.append({'source_id':receipt.get('source_id'),'error':type(e).__name__+': '+str(e)})
    coverages=[coverage(r,raw,[doc for doc in documents if doc['parent_html_sha256']==r['sha256']]) for r,raw in parents.values()]
    groups={}
    for r,raw in parents.values():groups.setdefault(r['source_id'],[]).append((r,raw))
    logical=[logical_report_coverage(versions,[doc for doc in documents if doc['parent_source_id']==source_id]) for source_id,versions in sorted(groups.items())]
    manifest={'schema':'TAIWAN_FINANCIAL_CSV_MANIFEST_V1','parser_version':PARSER_VERSION,'documents':files,'normalization_failures':failures,
              'records':sum(d['company_count'] for d in documents),'parent_report_coverage':coverages,'logical_report_coverage':logical,
              'cash_flow_reconciliations':history.cash_flow_reconciliations(documents),'methodology_approved':False}
    manifest['manifest_hash']=hashed(manifest);output=args.output/('manifest-'+manifest['manifest_hash']+'.json')
    acquire.write_once(output,(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n').encode())
    print(json.dumps({'manifest':str(output.resolve()),'documents':len(documents),'records':manifest['records'],'complete_parent_reports':sum(c['complete'] for c in coverages),
                      'complete_company_value_reports':sum(c['complete'] for c in logical),'failures':failures},ensure_ascii=False))
    return 0 if not failures else 2

if __name__=='__main__':raise SystemExit(main())
