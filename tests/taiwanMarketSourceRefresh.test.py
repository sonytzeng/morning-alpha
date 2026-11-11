"""The real worker with deterministic HTTP responses. No provider requests."""
import copy
from datetime import datetime, timedelta, timezone
import gzip
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
import urllib.error
import urllib.parse

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('refresh_worker', ROOT / 'scripts/operations/refresh-taiwan-market-sources.py')
w = importlib.util.module_from_spec(spec); spec.loader.exec_module(w)


class Clock:
    def __init__(self):
        self.base = datetime(2026, 11, 11, 10, 0, tzinfo=timezone.utc); self.seconds = 0.0

    def now(self):
        return (self.base + timedelta(seconds=self.seconds)).isoformat(timespec='microseconds').replace('+00:00', 'Z')

    def monotonic(self):
        return self.seconds

    def sleep(self, seconds):
        self.seconds += seconds


class Response:
    def __init__(self, url, raw, headers=None):
        self.url = url; self.raw = io.BytesIO(raw); self.status = 200; self.headers = headers or {}

    def geturl(self):
        return self.url

    def read(self, count=-1):
        return self.raw.read(count)

    def read1(self, count):
        return self.raw.read(count)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.raw.close()


class Opener:
    def __init__(self, responses, clock):
        self.responses = list(responses); self.clock = clock; self.calls = []

    def open(self, request, timeout):
        self.calls.append({'url': request.full_url, 'method': request.get_method(), 'body': request.data,
                           'headers': dict(request.header_items()), 'time': self.clock.monotonic(), 'timeout': timeout})
        self.clock.seconds += 0.05
        if not self.responses:
            raise AssertionError('UNEXPECTED_HTTP_REQUEST')
        value = self.responses.pop(0)
        if isinstance(value, BaseException):
            raise value
        if callable(value):
            return value(request)
        raw, headers = value if isinstance(value, tuple) else (value, {})
        return Response(request.full_url, raw, headers)


def task(kind, **values):
    return {'schema': 'TAIWAN_INPUT_REFRESH_TASK_V1', 'kind': kind, **values}


def day_body(day='20261111'):
    return json.dumps({'stat': 'ok', 'date': day, 'tables': []}).encode()


def valuation_body(day='20261111'):
    return json.dumps({'stat': 'OK', 'date': day,
        'fields': ['證券代號', '證券名稱', '收盤價', '殖利率(%)', '股利年度', '本益比', '股價淨值比', '財報年/季'],
        'data': [['2330', '測試', '100.00', '2.00', 114, '10.00', '2.00', '115/3']]}, ensure_ascii=False).encode()


def monthly_html(include_button=True, period='115年10月份'):
    button = '<input onclick=\'document.show_file.fileName.value="t21sc03_115_10.csv";document.show_file.submit();\'>' if include_button else ''
    return (f'<html><meta http-equiv="Content-Type" content="text/html;charset=big5"><font size="5"><b>上市公司{period}(累計與當月)營業收入統計表</b></font>'
        '<form name="show_file" action="/server-java/FileDownLoad" method="post"><input type="hidden" name="step" value="9">'
        '<input type="hidden" name="functionName" value="show_file2"><input type="hidden" name="filePath" value="/t21/sii/">'
        '<input type="hidden" name="fileName" value=""></form>' + button + '</html>').encode('cp950')


def revenue_csv():
    return ('\ufeff出表日期,資料年月,公司代號,公司名稱,產業別,營業收入-當月營收\r\n'
            '115/11/11,115/10,2330,測試,半導體業,1000\r\n').encode()


def financial_responses(count=1, family='INCOME', year=2026, quarter=3, formless_index=None):
    field = '基本每股盈餘（元）' if family == 'INCOME' else '營業活動之淨現金流入（流出）'
    family_code = '20' if family == 'CASHFLOW' else '04'
    parts = [f'<html><h2>上市公司第{"一二三四"[quarter - 1]}季資料</h2><p>單位：新台幣仟元，截至該季止之累計金額</p>']; files = []
    for index in range(count):
        filename = f't163sb{family_code}_20261111_{120000000 + index}.csv'
        form = ('<form><input type="hidden" name="firstin" value="true"><input type="hidden" name="step" value="10">'
                f'<input type="hidden" name="filename" value="{filename}"><input type="hidden" name="saveCSV" value="Y">'
                '<button onclick="action=\'/server-java/t105sb02\'; submit();">CSV</button></form>')
        if index == formless_index:
            form = ''
        symbol = str(2330 + index)
        parts.append(form + f'<table><tr><th>公司代號</th><th>公司名稱</th><th>{field}</th><th>營業收入</th></tr>'
                     f'<tr><td>{symbol}</td><td>測試</td><td>1.5</td><td>1000</td></tr></table>' + form)
        raw = (f'出表日期,年度,季別,公司代號,公司名稱,{field},營業收入\r\n115/11/11,{year - 1911},{quarter},{symbol},測試,1.50,1000\r\n').encode('cp950')
        files.append(raw)
    return [(''.join(parts) + '</html>').encode(), *files]


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(); self.root = Path(self.temporary.name); self.clock = Clock()

    def tearDown(self):
        self.temporary.cleanup()

    def run_task(self, wanted, responses, name='attempt'):
        opener = Opener(responses, self.clock)
        result = w.execute_task(wanted, self.root / name, opener=opener, clock=self.clock.now,
                                monotonic=self.clock.monotonic, sleeper=self.clock.sleep)
        return result, opener

    def report_task(self, family='INCOME', trigger=False):
        source = next(s for s in w.CATALOG['sources'] if s['market'] == 'TWSE' and s['family'] == 'INCOME')
        row = {'年度': '115', '季別': '3', '公司代號': '2330', '基本每股盈餘（元）': '1.50'}
        raw = json.dumps([row], ensure_ascii=False).encode(); file = self.root / 'publication-proof.json'; file.write_bytes(raw)
        receipt = {'schema': 'TAIWAN_PUBLIC_SOURCE_RECEIPT_V1', 'source_id': source['id'], 'url': source['url'], 'format': 'json',
                   'state': 'CAPTURED', 'status': 200, 'started_at': '2026-11-11T08:00:00Z', 'received_at': '2026-11-11T08:00:01Z',
                   'bytes': len(raw), 'sha256': w.sha(raw)}
        value = task('MOPS_REPORT', market='TWSE', family=family, period='2026Q3', publication_evidence={
            'receipt': receipt, 'raw_path': str(file), 'row_index': 0, 'source_row_hash': w.json_hash(row), 'year_field': '年度', 'quarter_field': '季別'})
        if trigger:
            value['period_trigger_basis'] = w.CASHFLOW_TRIGGER
        return value

    def test_all_observed_exports_do_not_prove_all_parent_companies_were_captured(self):
        # The second industry's company is still present in the official HTML,
        # but its export button disappeared. Counting fetched forms alone would
        # incorrectly mark this as a complete replacement report.
        parent, first_csv, _ = financial_responses(count=2, formless_index=1)
        result, opener = self.run_task(self.report_task(), [parent, first_csv])
        self.assertEqual(len(opener.calls), 2)
        self.assertEqual(len(result['financial_documents']), 1)
        self.assertEqual(result['state'], 'PARTIAL')
        issue = next(x for x in result['issues'] if x['code'] == 'REPORT_COMPANY_COVERAGE_INCOMPLETE')
        self.assertEqual(issue['expected_companies'], 2)
        self.assertEqual(issue['verified_companies'], 1)
        self.assertEqual(issue['missing_company_count'], 1)
        self.assertEqual(issue['missing_export_count'], 0)

    def test_same_attempt_replay_preserves_wire_bytes_and_first_receipt_time(self):
        wanted = task('TPEX_DAY', date='2026-11-11'); wire = gzip.compress(day_body())
        result, opener = self.run_task(wanted, [(wire, {'Content-Encoding': 'gzip'})])
        self.assertEqual(result['state'], 'CAPTURED'); self.assertEqual(result['network_requests'], 1)
        receipt = result['captures'][0]['receipt']; self.assertEqual(receipt['sha256'], w.sha(wire))
        self.assertEqual(Path(receipt['raw_path']).read_bytes(), wire)
        self.clock.seconds += 86400
        replay, second = self.run_task(wanted, [])
        self.assertEqual(replay, result); self.assertEqual(len(second.calls), 0)
        self.assertEqual(opener.calls[0]['url'], 'https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes?date=2026/11/11&response=json')
        Path(receipt['raw_path']).write_bytes(b'altered')
        with self.assertRaisesRegex(ValueError, 'SAVED_BYTES_CHANGED'):
            self.run_task(wanted, [])

    def test_security_denial_stops_remaining_action_requests_and_survives_replay(self):
        denial = urllib.error.HTTPError('https://www.tpex.org.tw/www/zh-tw/bulletin/revivt', 403, 'Forbidden', {}, io.BytesIO(b'FOR SECURITY REASONS'))
        wanted = task('TPEX_ACTION_SET', **{'from': '2025-08-15', 'through': '2026-11-11'})
        result, opener = self.run_task(wanted, [day_body(), denial])
        self.assertEqual(result['state'], 'HALTED'); self.assertEqual(result['source_halts'], ['tpex_capital_reduction'])
        self.assertEqual(result['network_requests'], 2); self.assertEqual(len(opener.calls), 2)
        self.assertEqual(result['captures'][1]['receipt']['status'], 403)
        self.assertEqual(Path(result['captures'][1]['raw_path']).read_bytes(), b'FOR SECURITY REASONS')
        self.assertGreaterEqual(opener.calls[1]['time'] - opener.calls[0]['time'], 2)
        replay, after = self.run_task(wanted, []); self.assertEqual(replay, result); self.assertFalse(after.calls)

    def test_503_is_saved_once_without_retry_or_permanent_halt(self):
        denial = urllib.error.HTTPError('https://www.twse.com.tw/rwd/zh/afterTrading/BWIBBU_d', 503, 'Unavailable', {}, io.BytesIO(b'temporarily unavailable'))
        result, opener = self.run_task(task('TWSE_VALUATION_DAY', date='2026-11-11'), [denial])
        self.assertEqual(result['state'], 'UNAVAILABLE'); self.assertEqual(result['source_halts'], [])
        self.assertEqual(len(opener.calls), 1); self.assertEqual(result['captures'][0]['receipt']['status'], 503)

    def test_dated_valuation_rejects_wrong_actual_date_and_keeps_raw_response(self):
        wanted = task('TWSE_VALUATION_DAY', date='2026-11-11')
        result, opener = self.run_task(wanted, [valuation_body()])
        self.assertEqual(result['state'], 'CAPTURED'); self.assertEqual(result['captures'][0]['role'], 'PUBLIC')
        self.assertTrue(opener.calls[0]['url'].endswith('BWIBBU_d?date=20261111&selectType=ALL&response=json'))
        wrong, _ = self.run_task(wanted, [valuation_body('20261110')], 'wrong-date')
        self.assertEqual(wrong['state'], 'UNAVAILABLE')
        self.assertTrue(Path(wrong['captures'][0]['raw_path']).exists())

    def test_monthly_parent_is_big5_and_download_is_exact_observed_form_with_utf8_bom(self):
        raw = revenue_csv(); result, opener = self.run_task(task('MOPS_REVENUE_MONTH', market='TWSE', period='202610'), [monthly_html(), raw])
        self.assertEqual(result['state'], 'CAPTURED'); self.assertEqual(len(opener.calls), 2)
        self.assertEqual(urllib.parse.parse_qs(opener.calls[1]['body'].decode()), {
            'step': ['9'], 'functionName': ['show_file2'], 'filePath': ['/t21/sii/'], 'fileName': ['t21sc03_115_10.csv']})
        receipt = result['captures'][1]['receipt']; self.assertEqual(receipt['encoding'], 'UTF8')
        self.assertEqual(receipt['sha256'], w.sha(raw)); self.assertEqual(receipt['decoded_text_sha256'], w.sha(raw))
        self.assertEqual(Path(receipt['raw_path']).read_bytes()[:3], b'\xef\xbb\xbf')
        self.assertEqual(result['captures'][0]['receipt']['encoding'], 'CP950')

    def test_missing_button_or_wrong_period_cannot_create_a_guessed_csv_request(self):
        wanted = task('MOPS_REVENUE_MONTH', market='TWSE', period='202610')
        for index, raw in enumerate([monthly_html(False), monthly_html(period='115年9月份')]):
            result, opener = self.run_task(wanted, [raw], f'bad-html-{index}')
            self.assertEqual(result['state'], 'PARTIAL'); self.assertEqual(len(opener.calls), 1)
            self.assertFalse(result['financial_documents'])

    def test_new_report_period_is_proved_and_native_exports_match_every_cell(self):
        wanted = self.report_task(); result, opener = self.run_task(wanted, financial_responses())
        self.assertEqual(result['state'], 'CAPTURED'); self.assertEqual(len(result['financial_documents']), 1)
        self.assertEqual(len(opener.calls), 2)
        self.assertEqual(urllib.parse.parse_qs(opener.calls[0]['body'].decode())['season'], ['03'])
        document = json.loads(Path(result['financial_documents'][0]['file']).read_text())
        self.assertTrue(document['all_cells_matched_parent']); self.assertEqual(document['period'], '2026Q3')
        self.assertEqual(document['records'][0]['available_at'], result['captures'][1]['receipt']['received_at'])
        self.assertGreater(w.stamp(document['records'][0]['available_at']), w.stamp(wanted['publication_evidence']['receipt']['received_at']))
        changed = copy.deepcopy(wanted); changed['publication_evidence']['source_row_hash'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'PUBLICATION_ROW_HASH'):
            self.run_task(changed, [], 'bad-proof')

    def test_cashflow_trigger_never_substitutes_income_for_actual_cashflow(self):
        with self.assertRaisesRegex(ValueError, 'PUBLICATION_SOURCE'):
            self.run_task(self.report_task('CASHFLOW'), [], 'without-trigger')
        wanted = self.report_task('CASHFLOW', trigger=True)
        result, opener = self.run_task(wanted, financial_responses(family='CASHFLOW'))
        self.assertEqual(result['state'], 'CAPTURED')
        self.assertTrue(opener.calls[0]['url'].endswith('ajax_t163sb20'))
        document = json.loads(Path(result['financial_documents'][0]['file']).read_text())
        self.assertEqual(document['family'], 'CASHFLOW'); self.assertFalse(document['records'][0]['fcfe_inferred'])

    def test_retained_old_report_recovery_verifies_original_bytes_and_exact_query(self):
        expected = w.financial.report_task('TWSE', 'INCOME', 2025, 4)
        encoded = urllib.parse.urlencode(expected['form']).encode()
        receipt = {'schema': 'TAIWAN_FINANCIAL_HISTORY_RECEIPT_V1', **expected, 'state': 'UNAVAILABLE',
            'started_at': '2026-11-10T08:00:00Z', 'received_at': '2026-11-10T08:00:15Z',
            'status': 503, 'error': 'HTTP_503', 'source_halted': False, 'elapsed_seconds': 15.0,
            'request_form_encoded': encoded.decode(), 'request_form_sha256': w.sha(encoded)}

        def wanted(value, name):
            raw = (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode()
            path = self.root / (name + '-original-receipt.json'); path.write_bytes(raw)
            return task('MOPS_REPORT', market='TWSE', family='INCOME', period='2025Q4',
                period_trigger_basis=w.RETAINED_REPORT_TRIGGER,
                retained_request_evidence={'receipt': value, 'receipt_file': str(path), 'receipt_sha256': w.sha(raw)})

        request = wanted(receipt, 'valid')
        result, opener = self.run_task(request, financial_responses(year=2025, quarter=4), 'recover-old')
        self.assertEqual(result['state'], 'CAPTURED'); self.assertEqual(len(opener.calls), 2)
        self.assertEqual(opener.calls[0]['url'], expected['url']); self.assertEqual(opener.calls[0]['body'], encoded)
        document = json.loads(Path(result['financial_documents'][0]['file']).read_text())
        self.assertEqual(document['period'], '2025Q4'); self.assertTrue(document['all_cells_matched_parent'])
        self.assertGreater(w.stamp(document['records'][0]['available_at']), w.stamp(receipt['received_at']))
        for index, patch in enumerate([{'status': 403, 'error': 'HTTP_403'}, {'source_halted': True},
                {'error': 'OFFICIAL_SECURITY_DENIAL'}, {'state': 'IN_PROGRESS'}, {'url': expected['url'] + '?alternate=1'},
                {'request_form_sha256': '0' * 64}]):
            bad = wanted({**receipt, **patch}, 'invalid-' + str(index))
            with self.assertRaisesRegex(ValueError, 'RETAINED_REQUEST_'):
                self.run_task(bad, [], 'reject-' + str(index))
        forged = copy.deepcopy(request); forged['retained_request_evidence']['receipt']['elapsed_seconds'] = 16
        with self.assertRaisesRegex(ValueError, 'RETAINED_REQUEST_BYTES'):
            self.run_task(forged, [], 'byte-mismatch')

    def test_shared_request_budget_bounds_report_and_marks_remaining_exports_partial(self):
        result, opener = self.run_task(self.report_task(), financial_responses(8))
        self.assertEqual(result['state'], 'PARTIAL'); self.assertEqual(result['network_requests'], 8)
        self.assertEqual(len(result['financial_documents']), 7); self.assertEqual(len(opener.calls), 8)
        self.assertTrue(any(i['code'] == 'REMAINING_OBSERVED_EXPORTS_NOT_REQUESTED' for i in result['issues']))
        for first, second in zip(opener.calls, opener.calls[1:]):
            self.assertGreaterEqual(second['time'] - first['time'], 2 - 1e-8)
        for request in opener.calls:
            self.assertNotIn('Authorization', request['headers']); self.assertNotIn('Cookie', request['headers'])

    def test_interruption_never_reissues_unknown_request_and_persists_known_halt(self):
        wanted = task('TWSE_VALUATION_DAY', date='2026-11-11')
        class InterruptedBody:
            def read(self, count):
                raise KeyboardInterrupt()
            def close(self):
                pass
        denial = urllib.error.HTTPError('https://www.twse.com.tw/rwd/zh/afterTrading/BWIBBU_d', 403, 'Forbidden', {}, InterruptedBody())
        with self.assertRaises(KeyboardInterrupt):
            self.run_task(wanted, [denial])
        result, opener = self.run_task(wanted, [])
        self.assertFalse(opener.calls); self.assertEqual(result['network_requests'], 1)
        self.assertEqual(result['state'], 'HALTED'); self.assertEqual(result['source_halts'], ['twse_valuation'])
        self.assertEqual(result['issues'][0]['code'], 'INTERRUPTED_ATTEMPT_OUTCOME_UNKNOWN')

    def test_bounded_gzip_and_input_scope_stop_before_any_unapproved_request(self):
        wire = gzip.compress(b'x' * (w.MAX_RESPONSE_BYTES + 1))
        result, opener = self.run_task(task('TPEX_DAY', date='2026-11-11'), [(wire, {'Content-Encoding': 'gzip'})])
        self.assertEqual(result['state'], 'UNAVAILABLE'); self.assertEqual(len(opener.calls), 1)
        self.assertIn('REFRESH_GZIP_SIZE', result['captures'][0]['receipt']['error'])
        for index, value in enumerate([task('TWSE_DAY', date='2026-11-11'), task('TPEX_DAY', date='2026-11-12'),
                                       {**task('TPEX_DAY', date='2026-11-11'), 'url': 'https://example.com'}]):
            with self.assertRaises(ValueError):
                self.run_task(value, [], f'forbidden-{index}')

    @unittest.skipUnless(os.environ.get('MA_REFRESH_REAL_REVENUE_RECEIPT'), 'explicit retained public artifact not supplied')
    def test_real_retained_monthly_parent_and_csv_through_worker_without_network(self):
        receipt_path = Path(os.environ['MA_REFRESH_REAL_REVENUE_RECEIPT']); receipt = json.loads(receipt_path.read_text())
        parent_path = receipt_path.parent / 'mops-revenue-TWSE-202610-receipt.json'
        parent = json.loads(parent_path.read_text()); raw = Path(receipt['raw_path']).read_bytes(); parent_raw = Path(parent['raw_path']).read_bytes()
        result, opener = self.run_task(task('MOPS_REVENUE_MONTH', market='TWSE', period='202610'), [parent_raw, raw])
        self.assertEqual(result['state'], 'CAPTURED'); self.assertEqual(result['captures'][1]['receipt']['sha256'], receipt['sha256'])
        self.assertEqual(result['captures'][1]['receipt']['data_row_count'], 1076); self.assertEqual(len(opener.calls), 2)


if __name__ == '__main__':
    unittest.main()
