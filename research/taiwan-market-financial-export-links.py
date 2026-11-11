#!/usr/bin/env python3
"""Match a missing industry export to a genuine new form in a refreshed report.

Every section is bounded by that filename's two native download forms. Its
header and company cells identify the section across HTML versions. This is
an offline plan builder; it performs no requests and invents no filename.
"""
from __future__ import annotations
import argparse
import importlib.util
import json
from pathlib import Path
import re
from lxml import html

ROOT=Path(__file__).resolve().parents[1]
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
source=load('retained_csv_forms',ROOT/'scripts/operations/acquire-taiwan-financial-csv.py')
financial=load('retained_parent_financial',ROOT/'research/taiwan-market-financial-history.py')

def section_bindings(receipt,raw,receipt_path):
    document=financial.normalize_mops_report(receipt,raw);tasks=source.tasks_from_html(receipt,raw,receipt_path)
    tree=html.fromstring(raw,parser=html.HTMLParser(encoding='utf-8',no_network=True));nodes=list(tree.iter());positions={node:i for i,node in enumerate(nodes)}
    leaves=tree.xpath('//table[not(.//table)]');tables={t['table_index']:t for t in document['tables']};groups={}
    for form in tree.xpath('//form[.//input[@name="filename"]]'):
        names=form.xpath('.//input[@name="filename"]/@value')
        if len(names)!=1:raise ValueError('EXPORT_SECTION_FORM_IDENTITY')
        groups.setdefault(names[0],[]).append(form)
    result=[]
    for task in tasks:
        forms=groups[task['form']['filename']]
        if len(forms)!=2:raise ValueError('EXPORT_SECTION_TWO_NATIVE_BOUNDARIES_REQUIRED')
        lo,hi=sorted(positions[f] for f in forms)
        matches=[index for index in tables if lo<positions[leaves[index]]<hi]
        if len(matches)!=1:raise ValueError('EXPORT_SECTION_UNIQUE_FINANCIAL_TABLE_REQUIRED')
        index=matches[0];table=tables[index]
        records=[r for r in document['records'] if r['source_capture']['table_index']==index]
        semantics={'headers':[financial.normalized(v) for v in table['headers']],
                   'companies':[{'symbol':r['symbol'],'fields':r['normalized_fields']} for r in sorted(records,key=lambda r:r['symbol'])]}
        result.append({'task':task,'table_index':index,'table_cells_hash':table['table_cells_hash'],'company_count':len(records),
                       'company_symbols':[r['symbol'] for r in records],'section_semantic_hash':financial.hash_value(semantics),
                       'boundary_basis':'TWO_IDENTICAL_NATIVE_EXPORT_FORMS_ENCLOSE_EXACTLY_ONE_FINANCIAL_TABLE'})
    return document,result

def link_refreshed_exports(old_receipt,old_raw,old_path,new_receipt,new_raw,new_path,missing_filenames):
    old,old_sections=section_bindings(old_receipt,old_raw,old_path);new,new_sections=section_bindings(new_receipt,new_raw,new_path)
    if old['source_id']!=new['source_id'] or old['market']!=new['market'] or old['family']!=new['family'] or old['period']!=new['period']:
        raise ValueError('REFRESHED_REPORT_IDENTITY_CHANGED')
    if financial.timestamp(new_receipt['received_at'])<=financial.timestamp(old_receipt['received_at']):raise ValueError('REFRESH_TIME_NOT_LATER')
    old_by_filename={s['task']['form']['filename']:s for s in old_sections}
    if not missing_filenames or len(set(missing_filenames))!=len(missing_filenames) or any(f not in old_by_filename for f in missing_filenames):
        raise ValueError('ORIGINAL_MISSING_EXPORT_NOT_IN_HTML')
    changed=old['semantic_values_hash']!=new['semantic_values_hash'];selected=[];links=[];empty=[]
    if changed:
        selected=[s['task'] for s in new_sections]
    else:
        for filename in missing_filenames:
            prior=old_by_filename[filename]
            if prior['company_count']==0:
                empty.append({'old_filename':filename,'table_cells_hash':prior['table_cells_hash'],'company_count':0,
                              'scope':'EXPLICIT_EMPTY_PARENT_SECTION_NO_CSV_VALUES_INVENTED'});continue
            matches=[s for s in new_sections if s['section_semantic_hash']==prior['section_semantic_hash']]
            if len(matches)!=1:raise ValueError('NEW_EXPORT_SECTION_NOT_UNIQUE')
            match=matches[0];selected.append(match['task'])
            links.append({'old_filename':filename,'new_filename':match['task']['form']['filename'],
                          'old_table_index':prior['table_index'],'new_table_index':match['table_index'],
                          'old_table_cells_hash':prior['table_cells_hash'],'new_table_cells_hash':match['table_cells_hash'],
                          'section_semantic_hash':prior['section_semantic_hash'],'company_symbols':prior['company_symbols'],
                          'filename_inferred':False})
    return {'source_id':old['source_id'],'old_parent_sha256':old_receipt['sha256'],'new_parent_sha256':new_receipt['sha256'],
            'old_semantic_hash':old['semantic_values_hash'],'new_semantic_hash':new['semantic_values_hash'],'financial_rows_changed':changed,
            'policy':'ALL_NEW_EXPORTS_REQUIRED_AFTER_CHANGED_FINANCIAL_ROWS' if changed else 'ONLY_MISSING_IDENTICAL_SECTIONS_WITH_GENUINE_NEW_FORMS',
            'tasks':selected,'section_links':links,'verified_empty_sections':empty}

def plan_refreshed_exports(directory,recovery_result_path):
    result_bytes=recovery_result_path.read_bytes();result=json.loads(result_bytes)
    if result.get('schema')!='MOPS_OFFICIAL_CSV_RECOVERY_RESULT_V1' or result.get('security_halt'):
        raise ValueError('CSV_RECOVERY_RESULT_REQUIRED')
    cache=source.cached_receipts(directory)
    if any(r.get('source_halted') for r in cache.values()):raise ValueError('CSV_SOURCE_HALTED')
    tasks=[];relations=[];missing=[];excluded=[];seen=set()
    for refreshed in result.get('parent_refreshes',[]):
        if refreshed.get('state')!='CAPTURED' or refreshed.get('validation_error'):
            missing.append({'source_id':refreshed.get('source_id'),'reason':'PARENT_REFRESH_NOT_VALIDATED','state':refreshed.get('state'),'error':refreshed.get('error')});continue
        new_path=Path(refreshed['receipt']);new_receipt=json.loads(new_path.read_text())
        old_path=Path(new_receipt['recovery_of']['prior_receipt_path']);old_receipt=json.loads(old_path.read_text())
        if source.sha(old_path.read_bytes())!=new_receipt['recovery_of']['prior_receipt_sha256']:raise ValueError('ORIGINAL_PARENT_RECEIPT_CHANGED')
        relation=link_refreshed_exports(old_receipt,Path(old_receipt['raw_path']).read_bytes(),old_path,
                                       new_receipt,Path(new_receipt['raw_path']).read_bytes(),new_path,
                                       [e['filename'] for e in refreshed['missing_original_exports']])
        if relation['old_parent_sha256']!=refreshed['old_parent_sha256'] or relation['new_parent_sha256']!=refreshed['new_parent_sha256']:
            raise ValueError('RECOVERY_RESULT_PARENT_HASH')
        relations.append(relation)
        for task in relation['tasks']:
            if task['task_id'] in seen:continue
            seen.add(task['task_id'])
            if task['task_id'] in cache:excluded.append({'source_id':task['source_id'],'filename':task['form']['filename'],'reason':'EXACT_EXPORT_REQUEST_ALREADY_ATTEMPTED'})
            else:tasks.append(task)
    body={'schema':'MOPS_OFFICIAL_CSV_ACQUISITION_PLAN_V1','formed_at':source.now(),'directory':str(directory.resolve()),
          'tasks':tasks,'excluded_attempts':excluded,'source_halted':False,'network_requests_performed':0,'retry_attempted_requests':False,
          'recovery_result_sha256':source.sha(result_bytes),'recovery_result_path':str(recovery_result_path.resolve()),
          'refreshed_report_relations':relations,'unresolved_parent_refreshes':missing,'filenames_are_from_actual_new_html_forms':True}
    return {**body,'link_plan_hash':source.sha(source.canonical(body).encode())}

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--directory',type=Path,required=True);p.add_argument('--recovery-result',type=Path,required=True);p.add_argument('--output-plan',type=Path,required=True);a=p.parse_args()
    plan=plan_refreshed_exports(a.directory,a.recovery_result);source.write_once(a.output_plan,(json.dumps(plan,ensure_ascii=False,indent=2)+'\n').encode())
    print(json.dumps({'plan':str(a.output_plan.resolve()),'new_genuine_export_requests':len(plan['tasks']),'refreshed_reports':len(plan['refreshed_report_relations']),
                      'changed_reports':[r['source_id'] for r in plan['refreshed_report_relations'] if r['financial_rows_changed']],
                      'unresolved':plan['unresolved_parent_refreshes'],'link_plan_hash':plan['link_plan_hash'],'network_requests':0},ensure_ascii=False));return 0

if __name__=='__main__':raise SystemExit(main())
