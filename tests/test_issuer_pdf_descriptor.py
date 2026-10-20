"""Public synthetic controls only. No skipped real-original tests.

Separate local replay (not part of unittest discovery or GitHub PASS counts):
  python3 -B tests/test_issuer_pdf_descriptor.py --replay-manifest PRIVATE.json
    --manifest-sha256 SHA --private-root DIR --outdir PRIVATE_SUBDIR
The private manifest pins descriptors and independent private reference receipts.
No original, descriptor, reference value or personal data is embedded in Git.
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


def local_replay(argv):
    """Explicit local command, never counted as public unittest PASS/skip."""
    ap=argparse.ArgumentParser();ap.add_argument('--replay-manifest',type=Path,required=True);ap.add_argument('--manifest-sha256',required=True);ap.add_argument('--private-root',type=Path,required=True);ap.add_argument('--outdir',type=Path,required=True);args=ap.parse_args(argv)
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
        M.require(sum(x['status']=='CANDIDATE_ONLY' for x in results)==3 and sum(x['status']=='REJECTED' for x in results)==1,'REPLAY_COUNTS')
        safe={'contract':'issuer-descriptor-local-replay-safe-v1','results':results,'normalizer_sha256':sha(SCRIPT.read_bytes()),'test_harness_sha256':sha(Path(__file__).read_bytes()),'public_synthetic_test_count_includes_real_replay':False,'manifest_sha256':sha(raw),'source_admission':False,'quality_admission':False,'member_publication':False,'network_requests':0}
        rb=(json.dumps(safe,indent=2)+'\n').encode();rp=root.write_new(args.outdir,manifest['safe_receipt_name'],rb)
        print(json.dumps({'real_quarters_normalized':3,'real_metric_rows':6,'q4_rejected':1,'safe_receipt':str(rp),'safe_receipt_sha256':sha(rb),'source_admission':False,'quality_admission':False,'member_publication':False}));return 0
    finally:root.close()


if __name__=='__main__':
    if '--replay-manifest' in sys.argv:
        try:raise SystemExit(local_replay(sys.argv[1:]))
        except Exception:
            print(json.dumps({'status':'REPLAY_FAILED','code':'LOCAL_REPLAY_VALIDATION_ERROR'}));raise SystemExit(2)
    unittest.main()
