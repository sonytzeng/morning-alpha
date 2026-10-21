"""Public synthetic controls only. No skipped real-original tests.

Separate local replay (not part of unittest discovery or GitHub PASS counts):
  python3 -B tests/test_issuer_pdf_descriptor.py --replay-manifest PRIVATE.json
    --manifest-sha256 SHA --private-root DIR --outdir PRIVATE_SUBDIR
The private manifest pins descriptors and independent private reference receipts.
No original, descriptor, reference value or personal data is embedded in Git.
Optional Q4 replay uses --q4-descriptor/--q4-descriptor-sha256 and
--q4-reference/--q4-reference-sha256. The old annual-table rejection is retained.
"""
from __future__ import annotations
import argparse
import contextlib
import copy
from datetime import datetime
from decimal import Decimal
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
SCRIPT = Path(__file__).resolve().parents[1] / "scripts/official-actuals/issuer-pdf-descriptor.py"
SPEC = importlib.util.spec_from_file_location("issuer_pdf_descriptor", SCRIPT)
M = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = M
SPEC.loader.exec_module(M)


def sha(raw): return hashlib.sha256(raw).hexdigest()
def box(x, y, width=160): return [x, y, x + width, y + 10]
def label(page, x, y, value, width=160): return {"page": page, "bbox": box(x, y, width), "text": value}
def cell(page, y): return {"page": page, "bbox": box(220, y, 60)}


class SyntheticDocument:
    """Synthetic word geometry, not an actual PDF replay or source assertion."""
    select = M.Document.select
    def __init__(self, _data, limits, started):
        self.limits, self.started = limits, started
        self.items = {
            1: [(10,10,"SYNTHETIC CONSOLIDATED"), (200,40,"Three Months Ended September 30"),
                (220,65,"2025"), (10,80,"Amounts in thousands of New Taiwan Dollars"),
                (10,100,"Net sales"), (220,100,"123,456"),
                (10,130,"Basic earnings per share (in New Taiwan Dollars)"), (220,130,"15.00")],
            2: [(10,10,"Basic earnings per share is calculated by dividing net profit attributable to ordinary equity owners of the parent entity by the weighted average number of ordinary shares"),
                (200,40,"Three months ended September 30"), (220,65,"2025"),
                (10,100,"Profit attributable to ordinary equity owners of the parent (in thousand NT$)"), (220,100,"1,500"),
                (10,130,"Weighted average number of ordinary shares outstanding for basic earnings per share (share)"), (220,130,"100,000"),
                (10,160,"Basic earnings per share (NT$)"), (220,160,"15.00")],
            3: [(10,10,"IFRS as endorsed by FSC")],
        }
        self.items[1].append((10,25,"SYNTHETIC ISSUER LIMITED"))
    def page(self, number):
        M.require(type(number) is int and number in self.items, "LOCATOR_PAGE")
        page = type("Page", (), {"width": 600, "height": 800})()
        words = [{"text": s,"x0": x,"x1": x+(60 if x==220 else 160),"top": y,"bottom": y+10}
                 for x,y,s in self.items[number]]
        return page, words
    def close(self): pass


class SyntheticControls(unittest.TestCase):
    def setUp(self):
        safe_temp_parent = Path(tempfile.gettempdir()).resolve()
        self.temp = tempfile.TemporaryDirectory(prefix="issuer-descriptor-synthetic-", dir=safe_temp_parent)
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.base.chmod(0o700)
        self.root = M.PrivateRoot(self.base)
        self.addCleanup(self.root.close)
        self.pdf = self.base / "synthetic.pdf"
        self.put(self.pdf, b"%PDF-SYNTHETIC-NOT-A-REAL-REPLAY")
        self.receipt = self.base / "receipt.json"
        self.receipt_obj = {"results":[{"url":"https://issuer.example/report.pdf", "raw_path":str(self.pdf),
            "sha256":sha(self.pdf.read_bytes()),"http_status":200,"first_seen_at":"2026-01-01T01:00:00Z",
            "available_at":"2026-01-01T01:00:01Z","source_received_at":"2026-01-01T01:00:00Z"}]}
        self.put(self.receipt, self.receipt_obj)
        self.descriptor = self.base / "descriptor.json"
        def per(page):
            return {"year":2025,"quarter":3,"header":label(page,200,40,"Three Months Ended September 30" if page==1 else "Three months ended September 30"),
                    "year_label":label(page,220,65,"2025",60),"column_x":[200,300]}
        proof={"period":per(2),"policy":label(2,10,10,self.policy()),
            "numerator_label":label(2,10,100,"Profit attributable to ordinary equity owners of the parent (in thousand NT$)"),
            "numerator_cell":cell(2,100),"numerator_multiplier":"1000",
            "denominator_label":label(2,10,130,"Weighted average number of ordinary shares outstanding for basic earnings per share (share)"),
            "denominator_cell":cell(2,130),"eps_label":label(2,10,160,"Basic earnings per share (NT$)"),"eps_cell":cell(2,160)}
        self.d={"contract":M.CONTRACT,"entity":"SYNTHETIC", "source":{"path":str(self.pdf),"url":"https://issuer.example/report.pdf",
            "sha256":sha(self.pdf.read_bytes()),"receipt":{"path":str(self.receipt),"sha256":sha(self.receipt.read_bytes()),"entry_pointer":"/results/0"}},
            "period":per(1),"issuer_name":label(1,10,25,"SYNTHETIC ISSUER LIMITED"),"identity":label(1,10,10,"SYNTHETIC CONSOLIDATED"),
            "accounting":{"classification":"EXPLICIT_SOURCE_BASIS", "proof":label(3,10,10,"IFRS as endorsed by FSC")},
            "metrics":[{"metric":"revenue","label":label(1,10,100,"Net sales"),"cell":cell(1,100),"currency":"TWD","multiplier":"1000","unit_proof":label(1,10,80,"Amounts in thousands of New Taiwan Dollars"),"numeric_format":"comma_dot"},
                {"metric":"basic_eps","label":label(1,10,130,"Basic earnings per share (in New Taiwan Dollars)"),"cell":cell(1,130),"currency":"TWD","multiplier":"1","unit_proof":label(1,10,130,"Basic earnings per share (in New Taiwan Dollars)"),"numeric_format":"decimal_dot","share_proof":proof}]}
    @staticmethod
    def policy():return "Basic earnings per share is calculated by dividing net profit attributable to ordinary equity owners of the parent entity by the weighted average number of ordinary shares"
    @staticmethod
    def put(path, value):
        raw=(json.dumps(value)+"\n").encode() if not isinstance(value,bytes) else value
        if path.exists():path.chmod(0o600)
        path.write_bytes(raw);path.chmod(0o400)
    def run_descriptor(self, d=None, doc=SyntheticDocument):
        self.put(self.descriptor,self.d if d is None else d)
        with patch.object(M,"Document",doc):
            return M.extract(self.root,self.descriptor,sha(self.descriptor.read_bytes()),frozenset({"issuer.example"}))
    def rejected(self,d,code=None,doc=SyntheticDocument):
        with self.assertRaisesRegex(M.DescriptorError,code or ".+"):
            self.run_descriptor(d,doc)
    def test_synthetic_happy_path_and_native_time_separation(self):
        r=self.run_descriptor()
        self.assertEqual([x['metric'] for x in r['rows']],['revenue','basic_eps'])
        self.assertTrue(r['rows'][1]['share_proof']['denominator_formula_checked'])
        self.assertEqual(r['first_seen_at'],self.receipt_obj['results'][0]['first_seen_at'])
        self.assertEqual(r['source_available_at'],self.receipt_obj['results'][0]['available_at'])
        self.assertLess(datetime.fromisoformat(r['source_available_at']),datetime.fromisoformat(r['normalization_available_at']))
        self.assertTrue(all(r[k] is False for k in ('source_admission','quality_admission','member_publication','descriptor_is_approval')))
        self.assertIsNone(r['announced_at']);self.assertIsNone(r['source_version'])
        self.assertFalse(r['symbol_to_issuer_mapping_reviewed']);self.assertFalse(r['accounting_classification_reviewed'])
        self.assertTrue(r['private_operator_only']);self.assertFalse(r['untrusted_service_sandbox'])
    def test_issuer_name_exact_locator_not_symbol_directory(self):
        d=copy.deepcopy(self.d);d['issuer_name']['text']='ANOTHER ISSUER';self.rejected(d,'LOCATOR_LABEL_MISMATCH')
    def test_wrong_descriptor_hash(self):
        self.put(self.descriptor,self.d)
        with self.assertRaisesRegex(M.DescriptorError,'DESCRIPTOR_SHA_MISMATCH'):
            M.extract(self.root,self.descriptor,'0'*64,frozenset({'issuer.example'}))
    def test_wrong_file_hash(self):
        self.put(self.pdf,b'%PDF-CHANGED')
        self.rejected(self.d,'PDF_SHA_MISMATCH')
    def test_receipt_hash_binding(self):
        self.put(self.receipt,self.receipt_obj|{'extra':True})
        self.rejected(self.d,'RECEIPT_SHA_MISMATCH')
    def test_receipt_url_path_hash_and_status_not_descriptor_claim(self):
        for key,value in [('url','https://issuer.example/another.pdf'),('raw_path',str(self.base/'another.pdf')),('sha256','0'*64),('http_status',403)]:
            obj=copy.deepcopy(self.receipt_obj);obj['results'][0][key]=value;self.put(self.receipt,obj)
            d=copy.deepcopy(self.d);d['source']['receipt']['sha256']=sha(self.receipt.read_bytes())
            self.rejected(d,'RECEIPT_SOURCE_BINDING')
    def test_missing_native_time_not_filled(self):
        obj=copy.deepcopy(self.receipt_obj);obj['results'][0]['first_seen_at']=None;self.put(self.receipt,obj)
        self.d['source']['receipt']['sha256']=sha(self.receipt.read_bytes());self.rejected(self.d,'RECEIPT_TIME_REQUIRED')
    def test_host_and_credentials_rejected(self):
        for url in ['https://other.example/report.pdf','https://user@issuer.example/report.pdf','http://issuer.example/report.pdf']:
            d=copy.deepcopy(self.d);d['source']['url']=url;self.rejected(d,'SOURCE_HOST_OR_URL')
    def test_approval_and_unknown_json_fields_rejected(self):
        d=copy.deepcopy(self.d);d['source_admission']=True;self.rejected(d,'DESCRIPTOR_SCHEMA')
    def test_ytd_header_rejected_even_if_descriptor_agrees(self):
        class Ytd(SyntheticDocument):
            def __init__(self,*a):
                super().__init__(*a);self.items[1][1]=(200,40,'Nine Months Ended September 30')
        d=copy.deepcopy(self.d);d['period']['header']['text']='Nine Months Ended September 30'
        self.rejected(d,'DIRECT_THREE_MONTH_HEADER',Ytd)
    def test_annual_q4_not_direct_quarter(self):
        d=copy.deepcopy(self.d);d['period']['quarter']=4
        self.rejected(d,'DIRECT_THREE_MONTH_HEADER')
    def test_comparative_year_and_ytd_cell_rejected(self):
        d=copy.deepcopy(self.d);d['period']['year']=2026;self.rejected(d,'CURRENT_YEAR_COLUMN')
        d=copy.deepcopy(self.d);d['metrics'][0]['cell']['bbox']=box(320,100,60);self.rejected(d)
    def test_cell_not_single_or_label_mismatch(self):
        d=copy.deepcopy(self.d);d['metrics'][0]['cell']['bbox']=[0,95,300,115];self.rejected(d,'CELL_NOT_SINGLE_TOKEN')
        d=copy.deepcopy(self.d);d['metrics'][0]['label']['text']='Revenue';self.rejected(d,'LOCATOR_LABEL_MISMATCH')
    def test_bbox_page_bounds_and_bool_page_rejected(self):
        for cell_value in [{'page':False,'bbox':box(220,100,60)},{'page':1,'bbox':[220,100,700,110]},{'page':1,'bbox':[220,100,float('nan'),110]}]:
            d=copy.deepcopy(self.d);d['metrics'][0]['cell']=cell_value;self.rejected(d)
    def test_no_metric_rename_and_explicit_scale(self):
        d=copy.deepcopy(self.d);d['metrics'][0]['metric']='financial_net_revenue';self.rejected(d,'METRIC_KIND')
        d=copy.deepcopy(self.d);d['metrics'][0]['multiplier']='1000000';self.rejected(d,'REVENUE_SCALE_NOT_PROVEN')
        d=copy.deepcopy(self.d);d['metrics'][1]['multiplier']='1000';self.rejected(d,'EPS_SCALING')
    def test_revenue_unit_scale_one_cannot_override_thousands(self):
        d=copy.deepcopy(self.d);d['metrics'][0]['multiplier']='1'
        self.rejected(d,'REVENUE_SCALE_NOT_PROVEN')
    def test_revenue_multiple_or_unknown_scale_rejected(self):
        for unit in ['Amounts in thousands or millions of New Taiwan Dollars', 'Amounts in hundreds of New Taiwan Dollars']:
            class ScaleDocument(SyntheticDocument):
                def __init__(self,*a):
                    super().__init__(*a);self.items[1][3]=(10,80,unit)
            d=copy.deepcopy(self.d);d['metrics'][0]['unit_proof']['text']=unit
            self.rejected(d,'REVENUE_SCALE_',ScaleDocument)
    def test_eps_cannot_borrow_usd_unit_from_another_page(self):
        class OtherCurrency(SyntheticDocument):
            def __init__(self,*a):
                super().__init__(*a);self.items[3].append((10,50,'Amounts in US dollars'))
        d=copy.deepcopy(self.d);d['metrics'][1]['currency']='USD';d['metrics'][1]['unit_proof']=label(3,10,50,'Amounts in US dollars')
        self.rejected(d,'EPS_CURRENCY_PROOF_CONFLICT',OtherCurrency)
    def test_eps_twd_proof_must_be_its_actual_row_not_unrelated_page(self):
        d=copy.deepcopy(self.d);d['metrics'][1]['unit_proof']=d['metrics'][0]['unit_proof']
        self.rejected(d,'EPS_CURRENCY_PROOF_CONFLICT')
    def test_negated_and_unconsolidated_identity_not_positive(self):
        for identity in ['UNCONSOLIDATED','NONCONSOLIDATED','NON-CONSOLIDATED','un consolidated','NOT CONSOLIDATED','not a consolidated statement','no consolidated statements']:
            class NegativeIdentity(SyntheticDocument):
                def __init__(self,*a):
                    super().__init__(*a);self.items[1][0]=(10,10,identity)
            d=copy.deepcopy(self.d);d['identity']['text']=identity
            self.rejected(d,'CONSOLIDATED_IDENTITY',NegativeIdentity)
    def test_missing_ordinary_proof_not_numeric_equality(self):
        d=copy.deepcopy(self.d);del d['metrics'][1]['share_proof'];self.rejected(d,'DESCRIPTOR_SCHEMA')
    def test_statement_note_conflict(self):
        class Conflict(SyntheticDocument):
            def __init__(self,*a):
                super().__init__(*a);self.items[2][-1]=(220,160,'16.00')
        self.rejected(self.d,'STATEMENT_NOTE_EPS_CONFLICT',Conflict)
    def test_denominator_formula_not_assumed(self):
        class WrongDenominator(SyntheticDocument):
            def __init__(self,*a):
                super().__init__(*a);self.items[2][-3]=(220,130,'200,000')
        self.rejected(self.d,'EPS_DENOMINATOR_FORMULA_CONFLICT',WrongDenominator)
    def test_duplicate_deep_oversized_json_and_nonfinite(self):
        for raw,code in [(b'{"x":1,"x":2}','JSON_DUPLICATE_KEY'),(b'{"x":NaN}','JSON_NONFINITE'),(b'['*20+b'0'+b']'*20,'JSON_STRUCTURE_LIMIT'),(b' '*200000,'JSON_BYTE_LIMIT')]:
            with self.assertRaisesRegex(M.DescriptorError,code):M.bounded_json(raw,M.Limits().json_bytes,M.Limits())
    def test_symlink_file_directory_hardlink_and_escape(self):
        link=self.base/'link.json';link.symlink_to(self.receipt)
        with self.assertRaises(OSError):self.root.read(link,10000)
        linkdir=self.base/'linkdir';linkdir.symlink_to(self.base,target_is_directory=True)
        with self.assertRaises(OSError):self.root.read(linkdir/'receipt.json',10000)
        hard=self.base/'hard.json';os.link(self.receipt,hard)
        with self.assertRaisesRegex(M.DescriptorError,'PRIVATE_INPUT_FILE'):self.root.read(hard,10000)
        with self.assertRaisesRegex(M.DescriptorError,'PATH_ESCAPE'):self.root.read(self.base.parent/'outside.json',10000)
    def test_output_private_no_overwrite_no_escape_no_symlink(self):
        out=self.base/'out';p=self.root.write_new(out,'candidate.json',b'{}')
        self.assertEqual(p.stat().st_mode&0o777,0o400);self.assertEqual(out.stat().st_mode&0o777,0o700)
        with self.assertRaises(FileExistsError):self.root.write_new(out,'candidate.json',b'changed')
        with self.assertRaisesRegex(M.DescriptorError,'OUTPUT_NAME'):self.root.write_new(out,'../escape.json',b'{}')
        linked=self.base/'linked';linked.symlink_to(out,target_is_directory=True)
        with self.assertRaises(OSError):self.root.write_new(linked,'another.json',b'{}')
    def test_non_private_input_and_output_dir_rejected(self):
        self.receipt.chmod(0o600)
        with self.assertRaisesRegex(M.DescriptorError,'PRIVATE_INPUT_FILE'):self.root.read(self.receipt,10000)
        out=self.base/'public';out.mkdir(mode=0o755);out.chmod(0o755)
        with self.assertRaisesRegex(M.DescriptorError,'PRIVATE_DIRECTORY_MODE'):self.root.write_new(out,'new.json',b'{}')
    def test_cli_stdout_is_safe_and_failed_write_keeps_original(self):
        self.put(self.descriptor,self.d);out=self.base/'results';argv=['--private-root',str(self.base),'--descriptor',str(self.descriptor),'--descriptor-sha256',sha(self.descriptor.read_bytes()),'--source-host','issuer.example','--outdir',str(out),'--output-name','new.json']
        for expected in [0,2]:
            stream=io.StringIO()
            with contextlib.redirect_stdout(stream),patch.object(M,'Document',SyntheticDocument):code=M.main(argv)
            self.assertEqual(code,expected);summary=json.loads(stream.getvalue());self.assertNotIn('rows',summary);self.assertNotIn('value_decimal',stream.getvalue());self.assertNotIn('15.00',stream.getvalue())

    def native_receipt(self):
        entry={'capture_method':'BROWSER_NATIVE_PUBLIC_DOWNLOAD','download_status':'COMPLETED',
            'url':'https://issuer.example/financial-index','source_url_role':'SOURCE_INDEX_WITH_VISIBLE_DOWNLOAD_CONTROL',
            'raw_document_url':None,'request_method':'NATIVE_FORM_POST',
            'visible_control':{'id':'download_q3','row_label':'FY2025_Q3 Consolidated Financial Statements','role':'button'},
            'raw_path':str(self.pdf),'sha256':sha(self.pdf.read_bytes()),'bytes':len(self.pdf.read_bytes()),
            'http_status':None,'http_status_observed':False,'first_seen_at':'2026-01-01T01:00:00Z',
            'first_seen_basis':'CONSERVATIVE_FIRST_OBSERVATION_AFTER_BROWSER_NATIVE_DOWNLOAD',
            'available_at':'2026-01-01T01:00:01Z','copy_verified_at':'2026-01-01T01:00:01Z',
            'published_at':None,'source_version':None,'revision_chain':None,
            'secret_or_hidden_form_material_exported':False,'provider_response_headers_exported':False}
        return {'contract':M.BROWSER_RECEIPT,'source_admission':False,'quality_admission':False,
                'member_publication':False,'results':[entry]}

    def link_receipt(self):
        entry=copy.deepcopy(self.receipt_obj['results'][0])
        entry.pop('source_received_at')
        entry.update(capture_method='BROWSER_PUBLIC_LINK_DOWNLOAD',download_status='COMPLETED',
            request_method='UNOBSERVED',http_status=None,http_status_observed=False,
            source_page_url='https://issuer.example/financial-index',
            visible_link={'role':'link','label':'download 3Q 2025','href':'https://issuer.example/report.pdf'},
            bytes=len(self.pdf.read_bytes()),copy_verified_at=entry['available_at'],
            first_seen_basis='CONSERVATIVE_FIRST_OBSERVATION_AFTER_BROWSER_LINK_DOWNLOAD',
            published_at=None,source_version=None,revision_chain=None,
            secret_or_hidden_form_material_exported=False,provider_response_headers_exported=False)
        return {'contract':'BROWSER_PUBLIC_LINK_DOWNLOAD_RECEIPT_V1','source_admission':False,
                'quality_admission':False,'member_publication':False,'results':[entry]}

    def install_link(self,obj):
        self.put(self.receipt,obj)
        d=copy.deepcopy(self.d);d['source']['receipt']['sha256']=sha(self.receipt.read_bytes())
        return d

    def test_public_link_unknown_transport_stays_unknown(self):
        r=self.run_descriptor(self.install_link(self.link_receipt()))
        self.assertEqual(r['capture_kind'],'BROWSER_PUBLIC_LINK_DOWNLOAD_RECEIPT_V1')
        self.assertIsNone(r['http_status']);self.assertFalse(r['http_status_observed'])
        self.assertIsNone(r['source_received_at']);self.assertIsNone(r['announced_at'])
        self.assertEqual(r['source_page_url'],'https://issuer.example/financial-index')
        self.assertEqual(r['raw_document_url'],'https://issuer.example/report.pdf')
        self.assertFalse(r['source_admission']);self.assertFalse(r['member_publication'])

    def test_public_link_cannot_forge_transport_or_publication(self):
        for key,value in [('http_status',200),('http_status_observed',True),('request_method','GET'),
                          ('published_at','2025-11-01T00:00:00Z'),('source_version','HASH_IS_NOT_VERSION'),
                          ('source_received_at','2026-01-01T01:00:00Z')]:
            obj=self.link_receipt();obj['results'][0][key]=value
            self.rejected(self.install_link(obj),'LINK_|DESCRIPTOR_SCHEMA')

    def test_public_link_binds_bytes_path_exact_link_period_and_private_source(self):
        for key,value in [('bytes',1),('bytes',True),('sha256','0'*64),('download_status','IN_PROGRESS'),
                          ('raw_path',str(self.base/'other.pdf')),('source_page_url','http://issuer.example/index'),
                          ('source_page_url','https://other.example/index'),
                          ('source_page_url','https://user@issuer.example/index')]:
            obj=self.link_receipt();obj['results'][0][key]=value
            self.rejected(self.install_link(obj),'LINK_|NATIVE_BYTE_COUNT')
        for key,value in [('href','https://issuer.example/other.pdf'),('role','button'),('label','download 4Q 2025')]:
            obj=self.link_receipt();obj['results'][0]['visible_link'][key]=value
            self.rejected(self.install_link(obj),'LINK_')

    def test_public_link_no_extra_capture_self_approval_headers_or_future_copy(self):
        for key,value in [('source_admission',True),('quality_admission',True),('unknown',True)]:
            obj=self.link_receipt();obj[key]=value;self.rejected(self.install_link(obj),'LINK_|DESCRIPTOR_SCHEMA')
        for key,value in [('first_seen_at','2099-01-01T00:00:00Z'),('copy_verified_at','2026-01-01T01:00:02Z'),
                          ('provider_response_headers_exported',True),('headers',{})]:
            obj=self.link_receipt();obj['results'][0][key]=value
            self.rejected(self.install_link(obj),'LINK_|DESCRIPTOR_SCHEMA')
        obj=self.link_receipt();obj['results'].append(copy.deepcopy(obj['results'][0]))
        self.rejected(self.install_link(obj),'LINK_SINGLE_CAPTURE')

    def interim_fixture(self):
        class Interim(SyntheticDocument):
            def __init__(self,*a):
                super().__init__(*a)
                self.items[1][1]=(200,40,'Three-month periods ended September 30')
                self.items[1].append((320,65,'2024'))
                self.items[1].extend([(210,80,'AMOUNT'),(285,80,'%')])
                self.items[1][3]=(10,80,'Expressed in thousands of New Taiwan dollars, except for earnings per share amount')
                self.items[1][6]=(10,130,'Basic earnings per share')
                self.items[1][7]=(220,130,'7.50')
                self.items[4]=[(200,40,'For the three-month period ended September 30, 2025'),
                    (10,100,'Basic earnings per share'),(10,130,'Profit attributable to common shareholders of the parent company'),
                    (220,130,'750'),(320,65,'Weighted average number of common shares outstanding (shares in thousands)'),
                    (320,130,'100'),(450,65,'Earnings per share (in dollars)'),(450,130,'7.50'),
                    (10,160,'Diluted earnings per share')]
                self.items[3].append((10,50,'Expressed in thousands of New Taiwan dollars, except as otherwise indicated'))
                self.items[3][0]=(10,10,'International Accounting Standard 34 Interim financial reporting endorsed by FSC')
            def page(self,number):
                page,words=super().page(number)
                if number==4:
                    for w in words:
                        if w['x0']>=320:
                            w['x1']=w['x0']+(60 if w['text'][0] in '0123456789.' else 100)
                if number==1:
                    for w in words:
                        if w['text'] in ('AMOUNT','%'):w['x1']=w['x0']+(25 if w['text']=='AMOUNT' else 10)
                return page,words
        d=copy.deepcopy(self.d);d['contract']='issuer-pdf-direct-interim-common-note-v1'
        d['accounting']={'classification':'FSC_ENDORSED_IAS34_INTERIM',
            'proof':label(3,10,10,'International Accounting Standard 34 Interim financial reporting endorsed by FSC')}
        d['period']['header']['text']='Three-month periods ended September 30'
        d['metrics'][0]['unit_proof']['text']='Expressed in thousands of New Taiwan dollars, except for earnings per share amount'
        m=d['metrics'][1];m['label']['text']='Basic earnings per share'
        m['unit_proof']=copy.deepcopy(d['metrics'][0]['unit_proof']);m['period']=copy.deepcopy(d['period'])
        m['share_proof']={'kind':'DIRECT_COMMON_SHARE_NOTE_V1',
            'period_header':label(4,200,40,'For the three-month period ended September 30, 2025',340),
            'basic_label':label(4,10,100,'Basic earnings per share'),
            'profit_label':label(4,10,130,'Profit attributable to common shareholders of the parent company'),
            'profit_cell':cell(4,130),'share_header':label(4,320,65,'Weighted average number of common shares outstanding (shares in thousands)',100),
            'share_cell':{'page':4,'bbox':box(320,130,100)},
            'eps_header':label(4,450,65,'Earnings per share (in dollars)',100),
            'eps_cell':{'page':4,'bbox':box(450,130,100)},
            'diluted_label':label(4,10,160,'Diluted earnings per share'),
            'unit_context':label(3,10,50,'Expressed in thousands of New Taiwan dollars, except as otherwise indicated')}
        return d,Interim

    def test_direct_interim_common_note_native_pair(self):
        d,doc=self.interim_fixture();r=self.run_descriptor(d,doc)
        self.assertEqual(r['descriptor_dialect'],'issuer-pdf-direct-interim-common-note-v1')
        self.assertEqual(r['rows'][1]['value_decimal'],'7.50')
        self.assertTrue(r['rows'][1]['share_proof']['denominator_formula_checked'])
        self.assertFalse(r['source_admission']);self.assertIsNone(r['announced_at'])

    def test_content_flow_is_version_selected_not_global_text_guessing(self):
        d,base=self.interim_fixture();d['contract']='issuer-pdf-direct-interim-content-flow-v1'
        class FlowOnly(base):
            def page(self,n):
                page,words=super().page(n)
                if not getattr(self,'content_flow',False) and n==4:
                    words=[dict(w,text='B a s i c earnings per share') if w['text']=='Basic earnings per share' else w for w in words]
                return page,words
        r=self.run_descriptor(d,FlowOnly)
        self.assertEqual(r['descriptor_dialect'],d['contract'])
        old=copy.deepcopy(d);old['contract']='issuer-pdf-direct-interim-common-note-v1'
        self.rejected(old,'LOCATOR_LABEL_MISMATCH',FlowOnly)
        bad=copy.deepcopy(d);bad['metrics'][1]['share_proof']['profit_label']['text']='Guessed label'
        self.rejected(bad,'LOCATOR_LABEL_MISMATCH',FlowOnly)

    def test_content_flow_preserves_stated_unit_exception_not_ytd_or_approval(self):
        d,base=self.interim_fixture();d['contract']='issuer-pdf-direct-interim-content-flow-v1'
        unit='Expressed in thousands of New Taiwan dollars, except for earnings per share'
        class FlowUnit(base):
            def __init__(self,*a):
                super().__init__(*a);self.items[1][3]=(10,80,unit)
        d['metrics'][0]['unit_proof']['text']=unit;d['metrics'][1]['unit_proof']['text']=unit
        r=self.run_descriptor(d,FlowUnit)
        self.assertFalse(r['source_admission']);self.assertFalse(r['ytd_or_annual_subtraction_used'])
        bad=copy.deepcopy(d);bad['period']['quarter']=4
        self.rejected(bad,'DIRECT_THREE_MONTH_HEADER',FlowUnit)

    def test_interim_revenue_must_not_use_the_percentage_cell_in_same_quarter(self):
        d,base=self.interim_fixture()
        class Ratio(base):
            def __init__(self,*a):
                super().__init__(*a);self.items[1].append((285,100,'100'))
            def page(self,n):
                page,words=super().page(n)
                if n==1:
                    for w in words:
                        if w['text']=='100' and w['x0']==285:w['x1']=295
                return page,words
        d['metrics'][0]['cell']={'page':1,'bbox':[285,100,295,110]}
        self.rejected(d,'INTERIM_REVENUE_PERCENT_COLUMN',Ratio)

    def test_interim_cannot_take_ytd_or_prior_year_even_with_expanded_axis(self):
        d,doc=self.interim_fixture()
        class Ytd(doc):
            def __init__(self,*a):
                super().__init__(*a);self.items[1][1]=(200,40,'Six-month periods ended September 30')
        bad=copy.deepcopy(d);bad['period']['header']['text']='Six-month periods ended September 30'
        self.rejected(bad,'DIRECT_THREE_MONTH_HEADER',Ytd)
        bad=copy.deepcopy(d);bad['period']['column_x']=[200,500];bad['metrics'][0]['cell']['bbox']=box(320,100,160)
        class Prior(doc):
            def __init__(self,*a):super().__init__(*a);self.items[1].append((320,100,'999'))
        self.rejected(bad,'CELL_INTERIM_ACTUAL_COLUMN',Prior)

    def test_interim_note_period_shares_units_and_native_eps_must_agree(self):
        for replace,code in [(('For the three-month period ended September 30, 2025','For the three-month period ended September 30, 2024'),'NOTE_DIRECT_PERIOD'),
            (('Weighted average number of common shares outstanding (shares in thousands)','Weighted average number of common shares outstanding (shares)'),'NOTE_COMMON_SHARE_UNIT'),
            (('100','200'),'EPS_DENOMINATOR_FORMULA_CONFLICT'),(('7.50','7.49'),'STATEMENT_NOTE_EPS_CONFLICT')]:
            d,base=self.interim_fixture()
            class Wrong(base):
                def __init__(self,*a):
                    super().__init__(*a);self.items[4]=[(x,y,replace[1] if s==replace[0] else s) for x,y,s in self.items[4]]
            for loc in d['metrics'][1]['share_proof'].values():
                if isinstance(loc,dict) and loc.get('text')==replace[0]:loc['text']=replace[1]
            self.rejected(d,code,Wrong)

    def test_interim_no_unrelated_currency_note_or_diluted_row(self):
        d,base=self.interim_fixture()
        bad=copy.deepcopy(d);bad['metrics'][1]['unit_proof']=label(3,10,50,'Expressed in thousands of New Taiwan dollars, except as otherwise indicated')
        self.rejected(bad,'INTERIM_EPS_UNIT_PAGE',base)
        bad=copy.deepcopy(d);bad['metrics'][1]['share_proof']['profit_cell']['bbox']=box(220,170,60)
        class Diluted(base):
            def __init__(self,*a):super().__init__(*a);self.items[4].append((220,170,'750'))
        self.rejected(bad,'NOTE_BASIC_ROW_GEOMETRY',Diluted)

    def test_adjacent_note_decimal_only_when_native_tokens_touch(self):
        d,base=self.interim_fixture()
        class Adjacent(base):
            def __init__(self,*a):
                super().__init__(*a);self.items[4][7]=(450,130,'7');self.items[4].append((510,130,'.50'))
        d['metrics'][1]['share_proof']['eps_cell']['bbox']=box(450,130,150)
        r=self.run_descriptor(d,Adjacent)
        self.assertEqual(r['rows'][1]['value_decimal'],'7.50')
        class Gap(Adjacent):
            def __init__(self,*a):
                super().__init__(*a);self.items[4][-1]=(511,130,'.50')
        self.rejected(d,'NOTE_DECIMAL_NOT_ADJACENT',Gap)

    def test_legacy_http_observation_absent_or_strict_true_compatible(self):
        self.assertTrue(self.run_descriptor()['http_status_observed'])
        obj=copy.deepcopy(self.receipt_obj);obj['results'][0]['http_status_observed']=True
        self.put(self.receipt,obj)
        d=copy.deepcopy(self.d);d['source']['receipt']['sha256']=sha(self.receipt.read_bytes())
        self.assertTrue(self.run_descriptor(d)['http_status_observed'])

    def test_legacy_explicit_http_observation_non_true_rejected(self):
        for value in [False,0,None,1,'true',[],{}]:
            with self.subTest(value=value):
                obj=copy.deepcopy(self.receipt_obj);obj['results'][0]['http_status_observed']=value
                self.put(self.receipt,obj)
                d=copy.deepcopy(self.d);d['source']['receipt']['sha256']=sha(self.receipt.read_bytes())
                self.rejected(d,'RECEIPT_HTTP_OBSERVATION')

    def install_native(self,obj):
        self.put(self.receipt,obj)
        d=copy.deepcopy(self.d);d['source']['url']='https://issuer.example/financial-index'
        d['source']['receipt']['sha256']=sha(self.receipt.read_bytes())
        return d

    def test_native_unknown_http_and_index_role_preserved(self):
        obj=self.native_receipt();d=self.install_native(obj);r=self.run_descriptor(d)
        self.assertEqual(r['capture_kind'],M.BROWSER_RECEIPT);self.assertIsNone(r['http_status'])
        self.assertFalse(r['http_status_observed']);self.assertIsNone(r['raw_document_url'])
        self.assertEqual(r['source_page_url'],d['source']['url'])
        self.assertEqual(r['source_url_role'],'SOURCE_INDEX_WITH_VISIBLE_DOWNLOAD_CONTROL')
        self.assertEqual(r['first_seen_basis'],obj['results'][0]['first_seen_basis'])
        self.assertEqual(r['first_seen_at'],obj['results'][0]['first_seen_at'])
        self.assertEqual(r['source_available_at'],obj['results'][0]['available_at'])
        self.assertIsNone(r['source_received_at']);self.assertFalse(r['source_admission'])

    def test_native_capture_and_contract_kind_not_legacy_fallback(self):
        for target,key,value in [('entry','capture_method','HTTP_GET'),('entry','request_method','POST'),('root','contract','UNKNOWN_NATIVE')]:
            obj=self.native_receipt();(obj['results'][0] if target=='entry' else obj)[key]=value
            self.rejected(self.install_native(obj),'NATIVE_CAPTURE_KIND|RECEIPT_KIND')

    def test_native_only_completed_download(self):
        for status in ['IN_PROGRESS','CANCELLED','FAILED','completed',None]:
            obj=self.native_receipt();obj['results'][0]['download_status']=status
            self.rejected(self.install_native(obj),'NATIVE_DOWNLOAD_NOT_COMPLETED')

    def test_native_cannot_forge_http_200_or_observation(self):
        for key,value in [('http_status',200),('http_status',403),('http_status_observed',True),('http_status_observed',0)]:
            obj=self.native_receipt();obj['results'][0][key]=value
            self.rejected(self.install_native(obj),'NATIVE_HTTP_MUST_BE_UNKNOWN')

    def test_native_no_hidden_values_headers_or_unknown_fields(self):
        for key,value in [('secret_or_hidden_form_material_exported',True),('secret_or_hidden_form_material_exported',{'token':'SYNTHETIC'}),('provider_response_headers_exported',True),('headers',{'x':'SYNTHETIC'}),('hidden',{'x':'SYNTHETIC'})]:
            obj=self.native_receipt();obj['results'][0][key]=value
            self.rejected(self.install_native(obj),'NATIVE_PRIVATE_EXPORT_FORBIDDEN|DESCRIPTOR_SCHEMA')

    def test_native_no_document_url_or_role_upgrade(self):
        for key,value in [('source_url_role','DOCUMENT_URL'),('raw_document_url','https://issuer.example/doc.pdf')]:
            obj=self.native_receipt();obj['results'][0][key]=value
            self.rejected(self.install_native(obj),'NATIVE_URL_ROLE')

    def test_native_exact_control_period_and_valid_button(self):
        for key,value in [('row_label','FY2025_Q4 Consolidated Financial Statements'),('id',''),('role','link')]:
            obj=self.native_receipt();obj['results'][0]['visible_control'][key]=value
            self.rejected(self.install_native(obj),'NATIVE_VISIBLE_CONTROL')

    def test_native_hash_bytes_and_location_binding(self):
        for key,value in [('sha256','0'*64),('bytes',1),('bytes',True),('raw_path',str(self.base/'other.pdf')),('url','https://issuer.example/other-index')]:
            obj=self.native_receipt();obj['results'][0][key]=value
            self.rejected(self.install_native(obj),'NATIVE_SOURCE_BINDING|NATIVE_BYTE_COUNT')

    def test_native_page_cannot_be_http_credentials_or_pdf_location(self):
        for url in ['http://issuer.example/index','https://user@issuer.example/index','https://issuer.example/doc.pdf','https://other.example/index']:
            obj=self.native_receipt();obj['results'][0]['url']=url;d=self.install_native(obj);d['source']['url']=url
            self.rejected(d,'SOURCE_HOST_OR_URL|NATIVE_PAGE_URL')

    def test_native_time_basis_and_copy_order(self):
        for key,value in [('first_seen_at',None),('first_seen_at','2099-01-01T00:00:00Z'),('copy_verified_at','2026-01-01T01:00:02Z'),('first_seen_basis','PRINTED_APPROVAL_DATE')]:
            obj=self.native_receipt();obj['results'][0][key]=value
            self.rejected(self.install_native(obj),'RECEIPT_TIME_REQUIRED|NATIVE_TIME_ORDER|NATIVE_FIRST_SEEN_BASIS')

    def test_native_envelope_no_self_approval_or_extra_capture(self):
        for key,value in [('source_admission',True),('quality_admission',0),('member_publication','false'),('unknown',False)]:
            obj=self.native_receipt();obj[key]=value
            self.rejected(self.install_native(obj),'NATIVE_ADMISSION_FLAGS|DESCRIPTOR_SCHEMA')
        obj=self.native_receipt();obj['results'].append(copy.deepcopy(obj['results'][0]))
        self.rejected(self.install_native(obj),'NATIVE_SINGLE_CAPTURE')

    def test_native_cannot_claim_publication_or_original_version(self):
        for key,value in [('published_at','2026-01-01T01:00:00Z'),('source_version','HASH_IS_NOT_VERSION'),('revision_chain',[])]:
            obj=self.native_receipt();obj['results'][0][key]=value
            self.rejected(self.install_native(obj),'NATIVE_UNOBSERVED_SOURCE_METADATA')

    def test_native_receipt_and_pdf_still_require_private_modes(self):
        d=self.install_native(self.native_receipt())
        self.receipt.chmod(0o600);self.rejected(d,'PRIVATE_INPUT_FILE')
        self.receipt.chmod(0o400);self.pdf.chmod(0o600)
        self.rejected(d,'PRIVATE_INPUT_FILE')

    def test_encrypted_and_page_limit_rejections_remain_distinct(self):
        for encrypted,pages,code in [(True,83,'PDF_ENCRYPTED'),(False,161,'PDF_PAGE_LIMIT')]:
            reader=type('SyntheticPdfMetadata',(),{'is_encrypted':encrypted,'pages':[None]*pages})()
            with patch.object(M,'PdfReader',return_value=reader),patch.object(M.pdfplumber,'open') as opened:
                with self.assertRaisesRegex(M.DescriptorError,code):
                    M.Document(b'%PDF-SYNTHETIC',M.Limits(),time.monotonic())
                opened.assert_not_called()

    def test_observed_operating_revenue_and_expressed_unit_labels_only(self):
        revenue_label='Operating revenue(Notes (4)(w) and (6))'
        unit='AMOUNTS EXPRESSED IN THOUSANDS OF NEW TAIWAN DOLLARS'
        class LabelDialect(SyntheticDocument):
            def __init__(self,*a):
                super().__init__(*a);self.items[1][1]=(200,40,'For the Three Months Ended September 30')
                self.items[1][3]=(10,80,unit);self.items[1][4]=(10,100,revenue_label)
        d=copy.deepcopy(self.d);d['period']['header']['text']='For the Three Months Ended September 30'
        d['metrics'][0]['label']['text']=revenue_label;d['metrics'][0]['unit_proof']['text']=unit
        self.assertEqual(len(self.run_descriptor(d,LabelDialect)['rows']),2)
        d['metrics'][0]['multiplier']='1';self.rejected(d,'REVENUE_SCALE_NOT_PROVEN',LabelDialect)

    def q4_fixture(self):
        annual=self.base/'annual.pdf';self.put(annual,b'%PDF-SYNTHETIC-ANNUAL')
        ar=self.base/'annual-receipt.json'
        entry=copy.deepcopy(self.receipt_obj['results'][0]);entry.update(url='https://issuer.example/annual.pdf',raw_path=str(annual),sha256=sha(annual.read_bytes()),bytes=len(annual.read_bytes()),period='2025Q4')
        self.put(ar,{'results':[entry]})
        review=self.base/'review.json'
        self.qr={'contract':'INDEPENDENT_FINANCIAL_SOURCE_QUALITY_REVIEW_V1','symbol':'SYNTHETIC',
            'review_scope':'DIRECT_QUARTER_REVENUE_AND_BASIC_ORDINARY_EPS_ONLY',
            'review_process':'INDEPENDENT_OF_EXTRACTION_AND_RECOMMENDATION_ENGINE',
            'recorded_at':'2026-01-01T01:00:02Z','source_admission':False,'quality_authority_installed':False,
            'member_publication':False,'canonical_write':False,'formal_v1_evaluation':False,'legal_reuse_approval':None,
            'quarters':[{'period':'2025Q4','quality_status':'QUALITY_PASS','fields':['revenue','basic_ordinary_eps'],
                'statement_sha256':sha(annual.read_bytes()),'short_fs_sha256':sha(self.pdf.read_bytes()),
                'evidence_pages':{'short_fs':1,'ordinary_eps_policy':2,'accounting':3}}]}
        self.put(review,self.qr)
        main=copy.deepcopy(self.receipt_obj);main['results'][0].update(bytes=len(self.pdf.read_bytes()),period='2025Q4');self.put(self.receipt,main)
        d=copy.deepcopy(self.d);d['contract']=M.Q4_CONTRACT;d['source']['receipt']['sha256']=sha(self.receipt.read_bytes())
        d['period']={'year':2025,'quarter':4,'header':label(1,200,40,'For the Fourth quarter of year 2025'),
            'quarter_label':label(1,220,65,'4Q 2025',60),'column_x':[200,300]}
        d['annual_policy_proof']={'source':{'path':str(annual),'url':'https://issuer.example/annual.pdf','sha256':sha(annual.read_bytes()),
            'receipt':{'path':str(ar),'sha256':sha(ar.read_bytes()),'entry_pointer':'/results/0'}},
            'issuer_name':copy.deepcopy(d['issuer_name']),'identity':copy.deepcopy(d['identity']),
            'annual_period':label(1,200,40,'For the years ended December 31, 2025 and 2024'),
            'policy':label(2,10,10,'Basic earnings per share is calculated by dividing net profit for the year attributable to ordinary equity owners of the parent entity by the weighted average number of ordinary shares outstanding during the year.'),
            'independent_review':{'path':str(review),'sha256':sha(review.read_bytes()),'entry_pointer':'/quarters/0'}}
        d['accounting']['proof']=label(3,10,10,'The consolidated financial statements have been prepared in accordance with IFRS as endorsed by FSC.')
        d['metrics'][0]['multiplier']='1000000';d['metrics'][0]['unit_proof']['text']='Unit: Millions of New Taiwan dollars'
        d['metrics'][1]['label']['text']='Basic Earnings Per Share (NTD)';d['metrics'][1]['unit_proof']=copy.deepcopy(d['metrics'][1]['label'])
        d['metrics'][1]['share_proof']={'kind':M.Q4_SHARE_PROOF}
        class Q4Document(SyntheticDocument):
            def __init__(self,data,*args):
                super().__init__(data,*args)
                self.cache={}
                if data.endswith(b'ANNUAL'):
                    self.items[1][1]=(200,40,d['annual_policy_proof']['annual_period']['text'])
                    self.items[2][0]=(10,10,d['annual_policy_proof']['policy']['text'])
                    self.items[3][0]=(10,10,'The consolidated financial statements have been prepared in accordance with IFRS as endorsed by FSC.')
                else:
                    self.items[1][1]=(200,40,'For the Fourth quarter of year 2025');self.items[1][2]=(220,65,'4Q 2025')
                    self.items[1][3]=(10,80,'Unit: Millions of New Taiwan dollars');self.items[1][6]=(10,130,'Basic Earnings Per Share (NTD)')
        return d,Q4Document

    def q4_review_change(self,d,key,value,*,root=False):
        q=copy.deepcopy(self.qr);(q if root else q['quarters'][0])[key]=value
        p=Path(d['annual_policy_proof']['independent_review']['path']);self.put(p,q)
        d=copy.deepcopy(d);d['annual_policy_proof']['independent_review']['sha256']=sha(p.read_bytes());return d

    def test_q4_versioned_direct_cells_and_review_not_authority(self):
        d,doc=self.q4_fixture();r=self.run_descriptor(d,doc)
        self.assertEqual([x['fiscal_period'] for x in r['rows']],['2025Q4','2025Q4'])
        self.assertEqual([x['value_decimal'] for x in r['rows']],['123456000000','15.00'])
        self.assertEqual(r['rows'][1]['share_proof']['share_class'],'ORDINARY')
        self.assertFalse(r['rows'][1]['share_proof']['denominator_formula_checked'])
        self.assertFalse(r['annual_policy_evidence']['annual_values_extracted'])
        for key in ['source_admission','quality_admission','member_publication']:self.assertIs(r[key],False)
        self.assertIsNone(r['announced_at']);self.assertIsNone(r['source_version'])

    def test_q4_requires_explicit_version_not_old_contract(self):
        d,doc=self.q4_fixture();d['contract']=M.CONTRACT;self.rejected(d,'DESCRIPTOR_SCHEMA',doc)
        d['contract']='issuer-pdf-direct-q4-annual-policy-v2';self.rejected(d,'DESCRIPTOR_SCHEMA|DESCRIPTOR_CONTRACT',doc)

    def test_q4_wrong_quarter_or_comparative_column_rejected(self):
        d,doc=self.q4_fixture()
        for value in ['3Q 2025','4Q 2024','2025','2025 YoY%']:
            class Wrong(doc):
                def __init__(self,*a):super().__init__(*a);self.items[1][2]=(220,65,value)
            changed=copy.deepcopy(d);changed['period']['quarter_label']['text']=value
            self.rejected(changed,'CURRENT_Q4_COLUMN',Wrong)

    def test_q4_annual_ytd_header_cannot_be_quarter(self):
        d,doc=self.q4_fixture()
        for value in ['For the years ended December 31, 2025 and 2024','Nine Months Ended December 31','For the Fourth quarter of year 2024']:
            class Wrong(doc):
                def __init__(self,*a):super().__init__(*a);self.items[1][1]=(200,40,value)
            changed=copy.deepcopy(d);changed['period']['header']['text']=value
            self.rejected(changed,'DIRECT_Q4_HEADER',Wrong)

    def test_q4_no_annual_cells_or_borrowed_currency(self):
        d,doc=self.q4_fixture();d['metrics'][0]['cell']['page']=2;self.rejected(d,'CELL_PERIOD_PAGE',doc)
        d,doc=self.q4_fixture();d['metrics'][1]['currency']='USD';self.rejected(d,'CURRENCY_NOT_PROVEN|EPS_CURRENCY_PROOF_CONFLICT',doc)

    def test_q4_explicit_scale_cannot_be_ignored(self):
        for scale in ['1','1000']:
            d,doc=self.q4_fixture();d['metrics'][0]['multiplier']=scale;self.rejected(d,'REVENUE_SCALE_NOT_PROVEN',doc)

    def test_q4_review_hash_period_and_both_original_bindings(self):
        for key,value in [('period','2025Q3'),('quality_status','PENDING'),('statement_sha256','0'*64),('short_fs_sha256','0'*64),('fields',['revenue'])]:
            d,doc=self.q4_fixture();self.rejected(self.q4_review_change(d,key,value),'INDEPENDENT_REVIEW_BINDING',doc)
        d,doc=self.q4_fixture();d['annual_policy_proof']['independent_review']['sha256']='0'*64
        self.rejected(d,'INDEPENDENT_REVIEW_SHA',doc)

    def test_q4_review_pages_time_and_authority_flags(self):
        d,doc=self.q4_fixture();self.rejected(self.q4_review_change(d,'evidence_pages',{'short_fs':1,'ordinary_eps_policy':1,'accounting':3}),'INDEPENDENT_REVIEW_PAGES',doc)
        for key,value,code in [('recorded_at','2026-01-01T00:00:00Z','INDEPENDENT_REVIEW_TIME'),('quality_authority_installed',True,'INDEPENDENT_REVIEW_NOT_AUTHORITY'),('symbol','OTHER','INDEPENDENT_REVIEW_IDENTITY')]:
            d,doc=self.q4_fixture();self.rejected(self.q4_review_change(d,key,value,root=True),code,doc)

    def test_q4_annual_receipt_hash_and_bytes_bound(self):
        d,doc=self.q4_fixture();d['annual_policy_proof']['source']['receipt']['sha256']='0'*64
        self.rejected(d,'ANNUAL_RECEIPT_SHA',doc)
        d,doc=self.q4_fixture();p=Path(d['annual_policy_proof']['source']['receipt']['path']);q=json.loads(p.read_bytes());q['results'][0]['bytes']=1;self.put(p,q);d['annual_policy_proof']['source']['receipt']['sha256']=sha(p.read_bytes())
        self.rejected(d,'ANNUAL_SOURCE_BYTES',doc)

    def test_q4_other_issuer_year_policy_and_non_ifrs_rejected(self):
        for target,value,code in [('issuer_name','OTHER ISSUER','ANNUAL_ISSUER_CONFLICT'),('annual_period','For the years ended June 30, 2025 and 2024','ANNUAL_CALENDAR_YEAR'),('policy','Basic earnings per share uses preference shares','ANNUAL_ORDINARY_POLICY')]:
            d,doc=self.q4_fixture();d['annual_policy_proof'][target]['text']=value
            # Replace actual synthetic source text too, so these test semantics, not just exact locators.
            class Wrong(doc):
                def __init__(self,data,*args):
                    super().__init__(data,*args)
                    if data.endswith(b'ANNUAL'):
                        page=1 if target in ('issuer_name','annual_period') else 2
                        position=-1 if target=='issuer_name' else 1 if target=='annual_period' else 0
                        x,y,_=self.items[page][position];self.items[page][position]=(x,y,value)
            self.rejected(d,code,Wrong)
        d,doc=self.q4_fixture();d['accounting']['proof']['text']='CONSOLIDATED ONLY'
        class NoIFRS(doc):
            def __init__(self,data,*a):
                super().__init__(data,*a)
                if data.endswith(b'ANNUAL'):self.items[3][0]=(10,10,'CONSOLIDATED ONLY')
        self.rejected(d,'ANNUAL_IFRS_PROOF',NoIFRS)

    def test_q4_cannot_skip_metric_share_proof_or_review(self):
        d,doc=self.q4_fixture();d['metrics']=d['metrics'][:1];self.rejected(d,'Q4_METRIC_PAIR',doc)
        d,doc=self.q4_fixture();del d['metrics'][1]['share_proof'];self.rejected(d,'DESCRIPTOR_SCHEMA',doc)
        d,doc=self.q4_fixture();del d['annual_policy_proof']['independent_review'];self.rejected(d,'DESCRIPTOR_SCHEMA',doc)

    def test_q4_axis_cannot_swallow_another_quarter_column(self):
        d,doc=self.q4_fixture()
        class ExtraColumn(doc):
            def __init__(self,data,*args):
                super().__init__(data,*args)
                if not data.endswith(b'ANNUAL'):self.items[1].append((320,65,'3Q 2025'))
        d['period']['column_x']=[200,480]
        self.rejected(d,'Q4_COLUMN_NOT_ISOLATED',ExtraColumn)

    def test_q4_main_receipt_explicit_bytes_and_period_required(self):
        for key,value in [('bytes',True),('bytes',1),('period','2025Q3')]:
            d,doc=self.q4_fixture();q=json.loads(self.receipt.read_bytes());q['results'][0][key]=value
            self.put(self.receipt,q);d['source']['receipt']['sha256']=sha(self.receipt.read_bytes())
            self.rejected(d,'Q4_RECEIPT_BINDING',doc)

    def test_q4_annual_receipt_period_time_and_source_hash_required(self):
        for key,value,code in [('period','2024Q4','ANNUAL_RECEIPT_PERIOD'),('first_seen_at','2099-01-01T00:00:00Z','ANNUAL_RECEIPT_TIME')]:
            d,doc=self.q4_fixture();p=Path(d['annual_policy_proof']['source']['receipt']['path']);q=json.loads(p.read_bytes());q['results'][0][key]=value
            self.put(p,q);d['annual_policy_proof']['source']['receipt']['sha256']=sha(p.read_bytes())
            self.rejected(d,code,doc)
        d,doc=self.q4_fixture();self.put(Path(d['annual_policy_proof']['source']['path']),b'%PDF-CHANGED-ANNUAL')
        self.rejected(d,'ANNUAL_SOURCE_SHA',doc)

    def test_q4_review_boolean_page_not_integer_page(self):
        d,doc=self.q4_fixture();self.rejected(self.q4_review_change(d,'evidence_pages',{'short_fs':True,'ordinary_eps_policy':2,'accounting':3}),'INDEPENDENT_REVIEW_PAGES',doc)

    def test_q4_mention_of_ifrs_not_affirmative_basis(self):
        d,doc=self.q4_fixture();value='The consolidated financial statements have been prepared in accordance with US GAAP rather than IFRS as endorsed by FSC.'
        d['accounting']['proof']['text']=value
        class Mention(doc):
            def __init__(self,data,*a):
                super().__init__(data,*a)
                if data.endswith(b'ANNUAL'):self.items[3][0]=(10,10,value)
        self.rejected(d,'ANNUAL_IFRS_PROOF',Mention)

    def test_q4_annual_host_and_http_observation_cannot_change(self):
        d,doc=self.q4_fixture();d['annual_policy_proof']['source']['url']='https://other.example/annual.pdf'
        self.rejected(d,'ANNUAL_SOURCE_URL',doc)
        d,doc=self.q4_fixture();p=Path(d['annual_policy_proof']['source']['receipt']['path']);q=json.loads(p.read_bytes());q['results'][0]['http_status_observed']=False
        self.put(p,q);d['annual_policy_proof']['source']['receipt']['sha256']=sha(p.read_bytes())
        self.rejected(d,'RECEIPT_HTTP_OBSERVATION',doc)

    def q4_ratio_fixture(self,heading):
        d,Base=self.q4_fixture()
        class AdjacentRatio(Base):
            def __init__(self,data,*args):
                super().__init__(data,*args)
                if not data.endswith(b'ANNUAL'):
                    self.items[1].extend([(320,65,heading),(320,100,'9.5')])
        d['period']['column_x']=[200,480]
        return d,AdjacentRatio

    def test_q4_actual_cell_cannot_be_yoy_or_qoq(self):
        for heading in ['YoY%','QoQ%']:
            with self.subTest(heading=heading):
                d,doc=self.q4_ratio_fixture(heading)
                d['metrics'][0]['cell']={'page':1,'bbox':[320,100,480,110]}
                self.rejected(d,'CELL_Q4_ACTUAL_COLUMN',doc)

    def test_q4_padded_quarter_locator_cannot_include_ratio(self):
        d,doc=self.q4_ratio_fixture('YoY%')
        # Partial overlap does not select the full ratio-header word. The
        # caption text still matches, so native token bounds must control.
        d['period']['quarter_label']['bbox']=[200,65,470,75]
        d['metrics'][0]['cell']={'page':1,'bbox':[320,100,480,110]}
        self.rejected(d,'CELL_Q4_ACTUAL_COLUMN',doc)

    def test_q4_expanded_axis_keeps_native_actual_cell(self):
        d,doc=self.q4_ratio_fixture('YoY%');r=self.run_descriptor(d,doc)
        self.assertEqual(len(r['rows']),2)
        self.assertEqual(r['period_evidence']['native_actual_column_x'],[220,300])
        self.assertEqual(r['rows'][0]['value_decimal'],'123456000000')


def local_replay(argv):
    """Explicit local command, never counted as public unittest PASS/skip."""
    ap=argparse.ArgumentParser();ap.add_argument('--replay-manifest',type=Path,required=True);ap.add_argument('--manifest-sha256',required=True);ap.add_argument('--private-root',type=Path,required=True);ap.add_argument('--outdir',type=Path,required=True)
    ap.add_argument('--q4-descriptor',type=Path);ap.add_argument('--q4-descriptor-sha256')
    ap.add_argument('--q4-reference',type=Path);ap.add_argument('--q4-reference-sha256');args=ap.parse_args(argv)
    root=M.PrivateRoot(args.private_root)
    try:
        raw=root.read(args.replay_manifest,M.Limits().json_bytes);M.require(sha(raw)==args.manifest_sha256,'REPLAY_MANIFEST_SHA')
        manifest=M.bounded_json(raw,M.Limits().json_bytes,M.Limits());cases=manifest['cases'];M.require(len(cases)==4,'REPLAY_CASE_COUNT')
        results=[]
        for case in cases:
            try:
                r=M.extract(root,Path(case['descriptor_path']),case['descriptor_sha256'],frozenset(manifest['source_hosts']))
            except M.DescriptorError as exc:
                M.require(case['expected_status']=='REJECTED' and str(exc)==case['expected_code'],'UNEXPECTED_REPLAY_REJECTION')
                results.append({'period':case['fiscal_period'],'status':'REJECTED','code':str(exc)});continue
            M.require(case['expected_status']=='CANDIDATE','UNEXPECTED_REPLAY_ACCEPTANCE')
            M.require(len(r['rows'])==2 and all(x['fiscal_period']==case['fiscal_period'] for x in r['rows']),'REPLAY_PERIOD_OR_ROWS')
            reference=case['reference'];rr=root.read(Path(reference['path']),M.Limits().receipt_bytes);M.require(sha(rr)==reference['sha256'],'REPLAY_REFERENCE_SHA')
            ref=M.pointer(M.bounded_json(rr,M.Limits().receipt_bytes,M.Limits()),reference['entry_pointer'])
            M.require(ref['source_sha256']==r['source_sha256'] and ref['source_url']==r['source_url'] and ref['source_path']==r['source_path'] and ref['period']==case['fiscal_period'],'REPLAY_REFERENCE_SOURCE_BINDING')
            expected={'revenue':Decimal(ref['current_quarter_revenue_thousand_twd'])*1000,'basic_eps':Decimal(ref['current_quarter_basic_ordinary_eps'])}
            M.require(all(Decimal(x['value_decimal'])==expected[x['metric']] for x in r['rows']),'REPLAY_REFERENCE_METRIC_CONFLICT')
            M.require(all(x['label']['text'] and x['source_sha256']==r['source_sha256'] for x in r['rows']),'REPLAY_LABEL_SOURCE')
            payload=(json.dumps(r,ensure_ascii=False,indent=2)+'\n').encode();output=root.write_new(args.outdir,case['output_name'],payload)
            results.append({'period':case['fiscal_period'],'status':'CANDIDATE_ONLY','row_count':len(r['rows']),'output':str(output),'output_sha256':sha(payload),'descriptor_sha256':case['descriptor_sha256'],'source_sha256':r['source_sha256'],'receipt_sha256':r['receipt_sha256'],'reference_hash_label_period_checks':'PASS','first_seen_at':r['first_seen_at'],'source_available_at':r['source_available_at'],'normalization_available_at':r['normalization_available_at']})
        q4_args=[args.q4_descriptor,args.q4_descriptor_sha256,args.q4_reference,args.q4_reference_sha256]
        M.require(all(x is None for x in q4_args) or all(x is not None for x in q4_args),'Q4_REPLAY_ARGUMENTS')
        if args.q4_descriptor is not None:
            r=M.extract(root,args.q4_descriptor,args.q4_descriptor_sha256,frozenset(manifest['source_hosts']))
            M.require(r.get('descriptor_dialect')==M.Q4_CONTRACT and len(r['rows'])==2,'Q4_REPLAY_DIALECT')
            rr=root.read(args.q4_reference,M.Limits().receipt_bytes);M.require(sha(rr)==args.q4_reference_sha256,'Q4_REPLAY_REFERENCE_SHA')
            reference=M.bounded_json(rr,M.Limits().receipt_bytes,M.Limits())
            refs=[x for x in reference['rows'] if x['fiscal_period']==r['rows'][0]['fiscal_period']]
            M.require(len(refs)==1,'Q4_REPLAY_REFERENCE_PERIOD');ref=refs[0]
            M.require(ref['fs_source_sha256']==r['source_sha256'] and ref['fs_source_ref']==r['source_url']
                      and ref['fs_source_path']==r['source_path'],'Q4_REPLAY_REFERENCE_SOURCE')
            expected={'revenue':Decimal(ref['quarter_revenue_twd_decimal']),
                      'basic_eps':Decimal(ref['basic_eps_as_reported_twd_per_share'])}
            M.require(all(Decimal(x['value_decimal'])==expected[x['metric']] for x in r['rows']),'Q4_REPLAY_REFERENCE_VALUES')
            M.require(all(x['fiscal_period']==ref['fiscal_period'] and x['label']['page']==1
                          and x['source_admission'] is False and x['quality_admission'] is False
                          and x['member_publication'] is False for x in r['rows']),'Q4_REPLAY_ROWS')
            payload=(json.dumps(r,ensure_ascii=False,indent=2)+'\n').encode();output=root.write_new(args.outdir,'q4-direct-short-actual.json',payload)
            results.append({'period':ref['fiscal_period'],'status':'CANDIDATE_ONLY','row_count':2,
                'output':str(output),'output_sha256':sha(payload),'descriptor_sha256':args.q4_descriptor_sha256,
                'source_sha256':r['source_sha256'],'annual_policy_sha256':r['annual_policy_evidence']['source']['sha256'],
                'independent_review_sha256':r['annual_policy_evidence']['independent_review']['sha256'],
                'value_reference_sha256':sha(rr),'value_reference_is_share_class_proof':False,
                'reference_hash_label_period_checks':'PASS','first_seen_at':r['first_seen_at'],
                'source_available_at':r['source_available_at'],'normalization_available_at':r['normalization_available_at']})
        count=4 if args.q4_descriptor is not None else 3
        M.require(sum(x['status']=='CANDIDATE_ONLY' for x in results)==count and sum(x['status']=='REJECTED' for x in results)==1,'REPLAY_COUNTS')
        safe={'contract':'issuer-descriptor-local-replay-safe-v1','results':results,'normalizer_sha256':sha(SCRIPT.read_bytes()),'test_harness_sha256':sha(Path(__file__).read_bytes()),'public_synthetic_test_count_includes_real_replay':False,'manifest_sha256':sha(raw),'source_admission':False,'quality_admission':False,'member_publication':False,'network_requests':0}
        rb=(json.dumps(safe,indent=2)+'\n').encode();rp=root.write_new(args.outdir,manifest['safe_receipt_name'],rb)
        print(json.dumps({'real_quarters_normalized':count,'real_metric_rows':count*2,'q4_rejected':1,'legacy_annual_q4_rejected':1,'direct_q4_candidates':count-3,'safe_receipt':str(rp),'safe_receipt_sha256':sha(rb),'source_admission':False,'quality_admission':False,'member_publication':False}));return 0
    finally:root.close()


if __name__=='__main__':
    if '--replay-manifest' in sys.argv:
        try:raise SystemExit(local_replay(sys.argv[1:]))
        except Exception:
            print(json.dumps({'status':'REPLAY_FAILED','code':'LOCAL_REPLAY_VALIDATION_ERROR'}));raise SystemExit(2)
    unittest.main()
