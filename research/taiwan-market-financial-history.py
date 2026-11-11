#!/usr/bin/env python3
"""Normalize retained public MOPS HTML with request-period and exact cell binding.

This does not infer diluted EPS, single quarters, future cash flows or source
publication time. Every record remains attached to the original HTML bytes.
"""
from __future__ import annotations
import argparse
from datetime import datetime
from decimal import Decimal,InvalidOperation
import hashlib
import json
from pathlib import Path
import re
from lxml import html

PARSER_VERSION='MOPS_FINANCIAL_HTML_CELL_BINDING_20261111_V1'
FAMILY_CODES={'INCOME':'t163sb04','BALANCE':'t163sb05','CASHFLOW':'t163sb20'}
MARKET_CODES={'TWSE':'sii','TPEX':'otc','EMERGING':'rotc'}
MARKET_LABELS={'TWSE':'上市','TPEX':'上櫃','EMERGING':'興櫃'}

def canonical(value):
    return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'))

def sha(value):
    return hashlib.sha256(value).hexdigest()

def hash_value(value):
    return sha(canonical(value).encode())

def normalized(value):
    return re.sub(r'\s+','',value)

def timestamp(value):
    return datetime.fromisoformat(value.replace('Z','+00:00'))

def normalize_mops_report(receipt,entity):
    match=re.fullmatch(r'mops_(income|balance|cashflow)_(TWSE|TPEX|EMERGING)_(20\d\d)Q([1-4])',receipt.get('source_id',''))
    if not match:raise ValueError('MOPS_SOURCE_IDENTITY')
    family,market,year,quarter=match.group(1).upper(),match.group(2),int(match.group(3)),int(match.group(4))
    expected_url='https://mopsov.twse.com.tw/mops/web/ajax_'+FAMILY_CODES[family]
    form=receipt.get('form')
    expected_form={'encodeURIComponent':'1','step':'1','firstin':'1','off':'1','TYPEK':MARKET_CODES[market],'year':str(year-1911),'season':f'{quarter:02d}'}
    if receipt.get('schema')!='TAIWAN_FINANCIAL_HISTORY_RECEIPT_V1' or receipt.get('state')!='CAPTURED' or receipt.get('status')!=200 or receipt.get('method')!='POST' \
       or receipt.get('url')!=expected_url or form!=expected_form or not isinstance(entity,bytes) or len(entity)!=receipt.get('bytes') or sha(entity)!=receipt.get('sha256') \
       or receipt.get('entity_bytes_complete',True) is not True or timestamp(receipt['started_at'])>timestamp(receipt['received_at']):
        raise ValueError('MOPS_SOURCE_RECEIPT')
    # MOPS AJAX statements declare UTF-8. Passing unqualified bytes to lxml
    # would default to a different encoding on pages without a meta charset.
    text=entity.decode('utf-8-sig',errors='strict')
    if 'FOR SECURITY REASONS' in text or '因為安全性考量' in text:raise ValueError('MOPS_SECURITY_DENIAL')
    tree=html.fromstring(entity,parser=html.HTMLParser(encoding='utf-8',no_network=True))
    whole=normalized(tree.text_content())
    heading=''.join(tree.xpath('//h1/text()|//h2/text()|//h3/text()'))
    quarter_text=['','一','二','三','四'][quarter]
    if MARKET_LABELS[market]+'公司第'+quarter_text+'季資料' not in normalized(heading):raise ValueError('MOPS_MARKET_OR_QUARTER_MISMATCH')
    if '單位：新台幣仟元' not in whole and '單位:新台幣仟元' not in whole:raise ValueError('MOPS_AMOUNT_UNIT_REQUIRED')
    cumulative='截至該季止之累計金額' in whole
    period_basis='POINT_IN_TIME_AS_REPORTED' if family=='BALANCE' else 'YTD_AS_REPORTED' if cumulative else \
                 'REQUESTED_ANNUAL_Q4_NOT_RESPONSE_LABELLED_YTD' if quarter==4 else 'REQUESTED_INTERIM_FLOW_BASIS_NOT_EXPLICIT'
    period=f'{year}Q{quarter}';form_hash=hash_value(form)
    capture_id=hash_value({'source_id':receipt['source_id'],'url':receipt['url'],'source_sha256':receipt['sha256'],'received_at':receipt['received_at']})
    source_base={'capture_id':capture_id,'source_id':receipt['source_id'],'source_url':receipt['url'],'source_sha256':receipt['sha256'],
                 'source_bytes':receipt['bytes'],'started_at':receipt['started_at'],'received_at':receipt['received_at'],
                 'receipt_hash':hash_value(receipt),'request_form':form,'request_form_hash':form_hash,
                 'request_body_sha256':receipt.get('request_form_sha256'),'parser_version':PARSER_VERSION,
                 'table_index_basis':'ZERO_BASED_LEAF_TABLE_DOCUMENT_ORDER','row_index_basis':'ZERO_BASED_TR_WITHIN_LEAF_TABLE',
                 'row_hash_basis':'CANONICAL_JSON_ARRAY_OF_UNMODIFIED_CELL_TEXT','cell_hash_basis':'UTF8_UNMODIFIED_CELL_TEXT'}
    records=[];tables=[];seen=set()
    for table_index,table in enumerate(tree.xpath('//table[not(.//table)]')):
        tr_rows=table.xpath('.//tr');cells=[[c.text_content() for c in row.xpath('./th|./td')]for row in tr_rows]
        header_indices=[i for i,row in enumerate(cells) if len(row)>=3 and normalized(row[0])=='公司代號' and normalized(row[1])=='公司名稱']
        if not header_indices:continue
        header_index=header_indices[0];headers=cells[header_index];keys=[normalized(h) for h in headers]
        if len(set(headers))!=len(headers) or len(set(keys))!=len(keys):raise ValueError('MOPS_DUPLICATE_COLUMNS')
        table_hash=hash_value(cells);table_xpath=f'(//table[not(.//table)])[{table_index+1}]';record_count=0
        for row_index,row in enumerate(cells):
            if row_index<=header_index or not row:continue
            if normalized(row[0])=='公司代號':
                if row!=headers:raise ValueError('MOPS_REPEATED_HEADER_CHANGED')
                continue
            symbol=normalized(row[0])
            if not re.fullmatch(r'\d{4,6}',symbol):
                if any(re.fullmatch(r'\d{4,6}',normalized(c)) for c in row[:1]):raise ValueError('MOPS_ROW_IDENTITY')
                continue
            if len(row)!=len(headers):raise ValueError('MOPS_ROW_WIDTH')
            if symbol in seen:raise ValueError('MOPS_DUPLICATE_SYMBOL')
            seen.add(symbol);record_count+=1
            fields=dict(zip(headers,row));normalized_fields=dict(zip(keys,row));units={}
            for header,key in zip(headers,keys):
                if key in ('公司代號','公司名稱'):units[header]='TEXT'
                elif '每股盈餘' in key and ('元' in key):units[header]='TWD_PER_SHARE'
                elif '單位：股' in key or '單位:股' in key:units[header]='SHARES'
                elif '每股' in key:units[header]='PER_SHARE_UNIT_NOT_EXPLICIT'
                elif '%' in key or '％' in key:units[header]='PERCENT'
                else:units[header]='TWD_THOUSANDS'
            capture={**source_base,'table_index':table_index,'table_xpath':table_xpath,'table_cells_hash':table_hash,
                     'header_row_index':header_index,'header_cells_hash':hash_value(headers),'row_index':row_index,
                     'row_xpath':f'({table_xpath}//tr)[{row_index+1}]','rowcells_hash':hash_value(row),'cell_hashes':[sha(c.encode()) for c in row]}
            record={'security_id':market+':'+symbol,'market':market,'symbol':symbol,'company_as_reported':row[1],
                    'period':period,'family':family,'period_basis':period_basis,'period_identity_basis':'REQUEST_FORM_BOUND_NOT_RESPONSE_ECHOED',
                    'cumulative_statement_note_present':cumulative,
                    'amount_unit':'TWD_THOUSANDS','fields':fields,'normalized_fields':normalized_fields,'field_units':units,
                    'eps_basis':'BASIC_AS_REPORTED' if any('基本每股盈餘' in k for k in keys) else None,
                    'source_url':receipt['url'],'available_at':receipt['received_at'],'first_seen_at':receipt['received_at'],'published_at':None,
                    'source_capture':capture,'forecast':False,'fcfe_inferred':False,'single_quarter_inferred':False}
            record['record_hash']=hash_value(record);records.append(record)
        tables.append({'table_index':table_index,'table_xpath':table_xpath,'headers':headers,'table_cells_hash':table_hash,'records':record_count})
    if not records:raise ValueError('MOPS_NO_COMPANY_ROWS')
    records.sort(key=lambda r:r['symbol'])
    semantic_hash=hash_value([{'symbol':r['symbol'],'fields':r['normalized_fields']}for r in records])
    body={'schema':'TAIWAN_MARKET_FINANCIAL_HISTORY_V1','parser_version':PARSER_VERSION,'source_id':receipt['source_id'],'market':market,
          'family':family,'period':period,'period_basis':period_basis,'period_identity_basis':'REQUEST_FORM_BOUND_NOT_RESPONSE_ECHOED',
          'cumulative_statement_note_present':cumulative,
          'amount_unit':'TWD_THOUSANDS','source_receipt':receipt,'source_capture':source_base,'company_count':len(records),'tables':tables,
          'records':records,'semantic_values_hash':semantic_hash,'validation_state':'REQUEST_PERIOD_BOUND_PENDING_CROSS_YEAR_CHECK',
          'publication_time_known':False,'source_as_of_backdated':False,'methodology_approved':False,'member_published':False}
    return {**body,'financial_history_hash':hash_value(body)}

def cross_year_checks(documents):
    groups={}
    for document in documents:
        if not document['period'].endswith('Q4'):continue
        groups.setdefault((document['market'],document['family']),[]).append(document)
    findings=[]
    for (market,family),items in groups.items():
        by_semantic={}
        for d in items:by_semantic.setdefault(d['semantic_values_hash'],[]).append(d['period'])
        for value,periods in by_semantic.items():
            if len(set(periods))>1:findings.append({'code':'POSSIBLE_IGNORED_YEAR_PARAMETER','market':market,'family':family,'periods':sorted(periods),'semantic_values_hash':value})
    return findings

def cash_flow_reconciliations(documents):
    """Compare reported amounts without treating a dash as a disclosed zero."""
    def value(fields,label):
        raw=fields.get(label)
        if raw is None:return None
        text=raw.strip().replace(',','')
        if re.fullmatch(r'\(\d+(?:\.\d+)?\)',text):text='-'+text[1:-1]
        if not re.fullmatch(r'-?\d+(?:\.\d+)?',text):return None
        try:return Decimal(text)
        except InvalidOperation:return None
    rows={}
    for document in documents:
        if document['family']!='CASHFLOW' or not document['period'].endswith('Q4'):continue
        for record in document['records']:rows[(record['security_id'],int(record['period'][:4]))]=record
    results=[]
    activity=['營業活動之淨現金流入（流出）','投資活動之淨現金流入（流出）','籌資活動之淨現金流入（流出）','匯率變動對現金及約當現金之影響']
    for (security_id,year),record in sorted(rows.items()):
        fields=record['normalized_fields'];opening=value(fields,'期初現金及約當現金餘額');closing=value(fields,'期末現金及約當現金餘額')
        change=value(fields,'本期現金及約當現金增加（減少）數');flows=[value(fields,k)for k in activity]
        prior=rows.get((security_id,year-1));prior_close=value(prior['normalized_fields'],'期末現金及約當現金餘額') if prior else None
        results.append({'security_id':security_id,'period':record['period'],'record_hash':record['record_hash'],
                        'prior_record_hash':prior['record_hash'] if prior else None,
                        'reported_cash_rollforward_equal':opening+change==closing if all(v is not None for v in [opening,change,closing]) else None,
                        'reported_activity_sum_equal':sum(flows)==change if all(v is not None for v in flows+[change]) else None,
                        'prior_requested_year_end_equals_beginning':prior_close==opening if prior_close is not None and opening is not None else None,
                        'missing_values_are_not_zero':True,'scope':'ACCOUNTING_CONSISTENCY_NOT_SOURCE_PUBLICATION_OR_FCFE_PROOF'})
    return results

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--directory',type=Path,required=True);parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
    args.output.mkdir(parents=True,exist_ok=True);documents=[];failures=[]
    for path in sorted(args.directory.glob('*receipt.json')):
        receipt=json.loads(path.read_text())
        if receipt.get('state')!='CAPTURED' or receipt.get('schema')!='TAIWAN_FINANCIAL_HISTORY_RECEIPT_V1' \
           or not re.fullmatch(r'mops_(income|balance|cashflow)_(TWSE|TPEX|EMERGING)_20\d\dQ[1-4]',receipt.get('source_id','')):continue
        try:
            result=normalize_mops_report(receipt,Path(receipt['raw_path']).read_bytes());documents.append(result)
            output=args.output/(result['source_id']+'-'+result['source_capture']['source_sha256']+'.json')
            data=json.dumps(result,ensure_ascii=False,indent=2)+'\n'
            if output.exists() and output.read_text()!=data:raise ValueError('NORMALIZED_HISTORY_CHANGED')
            if not output.exists():output.write_text(data)
        except Exception as error:failures.append({'source_id':receipt.get('source_id'),'error':type(error).__name__+': '+str(error)})
    checks=cross_year_checks(documents);cash_checks=cash_flow_reconciliations(documents)
    manifest={'schema':'TAIWAN_FINANCIAL_HISTORY_MANIFEST_V1','parser_version':PARSER_VERSION,
              'documents':[{'source_id':d['source_id'],'market':d['market'],'family':d['family'],'period':d['period'],'company_count':d['company_count'],
                            'financial_history_hash':d['financial_history_hash'],'semantic_values_hash':d['semantic_values_hash'],
                            'file':str((args.output/(d['source_id']+'-'+d['source_capture']['source_sha256']+'.json')).resolve())}for d in documents],
              'normalization_failures':failures,'cross_year_findings':checks,'records':sum(d['company_count'] for d in documents),
              'cash_flow_reconciliations':cash_checks,
              'year_identity_basis':'REQUEST_FORM_BOUND_NOT_RESPONSE_ECHOED','methodology_approved':False}
    manifest['manifest_hash']=hash_value(manifest);output=args.output/('manifest-'+manifest['manifest_hash']+'.json')
    if not output.exists():output.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'manifest':str(output.resolve()),'documents':len(documents),'records':manifest['records'],'failures':failures,'cross_year_findings':checks},ensure_ascii=False))
    return 0 if not failures and not checks else 2

if __name__=='__main__':raise SystemExit(main())
