#!/usr/bin/env python3
"""Execute one validated public-source refresh task, without retries.

The parent cache owns cross-day scheduling and retry policy. This worker owns
one immutable attempt directory, actual HTTP receipts and normalization. It
does not use credentials, stage SQL, review a method or publish content.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager, redirect_stdout
from datetime import date, datetime, timedelta, timezone
import csv
import hashlib
import importlib.util
import io
import json
import math
import os
from pathlib import Path
import re
import sys
import time
from types import SimpleNamespace
import urllib.error
import urllib.parse
import urllib.request
import zlib
from lxml import html

ROOT = Path(__file__).resolve().parents[2]
MAX_REQUESTS = 8
MAX_RESPONSE_BYTES = 16_000_000
MAX_ATTEMPT_BYTES = 128_000_000
MAX_ATTEMPT_SECONDS = 900
MINIMUM_GAP_SECONDS = 2
TAIPEI = timezone(timedelta(hours=8))
ACTION_SOURCES = ('tpex_ex_right', 'tpex_capital_reduction', 'tpex_par_value_change')
MARKETS = {'TWSE': 'sii', 'TPEX': 'otc', 'EMERGING': 'rotc'}
FAMILIES = {'INCOME': 't163sb04', 'BALANCE': 't163sb05', 'CASHFLOW': 't163sb20'}
CSV_URL = 'https://mopsov.twse.com.tw/server-java/t105sb02'
REVENUE_URL = 'https://mopsov.twse.com.tw/server-java/FileDownLoad'
CASHFLOW_TRIGGER = 'SAME_MARKET_REPORTED_PERIOD_LOOKUP_NOT_CASHFLOW_AVAILABILITY'
RETAINED_REPORT_TRIGGER = 'RETAINED_EXACT_PUBLIC_REPORT_REQUEST_RECOVERY'


def load(name, relative):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


history = load('refresh_history_capture', 'scripts/operations/acquire-taiwan-history.py')
financial = load('refresh_financial_capture', 'scripts/operations/acquire-taiwan-financial-history.py')
financial_csv = load('refresh_csv_capture', 'scripts/operations/acquire-taiwan-financial-csv.py')
normalizer = load('refresh_financial_normalizer', 'research/taiwan-market-financial-csv.py')
CATALOG = json.loads((ROOT / 'research/taiwan-market-sources.json').read_text())


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec='microseconds').replace('+00:00', 'Z')


def stamp(value):
    if not isinstance(value, str):
        raise ValueError('REFRESH_TIME')
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        raise ValueError('REFRESH_TIME')
    return parsed


def canonical(value):
    # Task / raw financial rows use strings and safe JSON numbers. Match the
    # existing JS snapshot format, including whole-valued JSON floats.
    if isinstance(value, dict):
        return '{' + ','.join(json.dumps(k, ensure_ascii=False) + ':' + canonical(value[k]) for k in sorted(value)) + '}'
    if isinstance(value, list):
        return '[' + ','.join(canonical(v) for v in value) + ']'
    if isinstance(value, float):
        if not math.isfinite(value) or abs(value) > 9007199254740991:
            raise ValueError('REFRESH_CANONICAL_NUMBER')
        if value.is_integer():
            return str(int(value))
        text = repr(value)
        if 'e' in text:
            mantissa, exponent = text.split('e'); power = int(exponent)
            if abs(value) >= 0.000001:
                from decimal import Decimal
                return format(Decimal(text), 'f')
            return mantissa + 'e' + ('+' if power >= 0 else '-') + str(abs(power))
        return text
    if isinstance(value, int) and not isinstance(value, bool) and abs(value) > 9007199254740991:
        raise ValueError('REFRESH_CANONICAL_NUMBER')
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


def sha(value):
    return hashlib.sha256(value).hexdigest()


def json_hash(value):
    return sha(canonical(value).encode())


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    with temporary.open('x', encoding='utf-8') as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2); handle.write('\n')
        handle.flush()
        os.fsync(handle.fileno())
    temporary.replace(path)


def immutable_json(path, value):
    data = (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode()
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.read_bytes() != data:
            raise ValueError('REFRESH_IMMUTABLE_CONFLICT')
    else:
        with path.open('xb') as handle:
            handle.write(data); handle.flush(); os.fsync(handle.fileno())


def read_bounded(path, maximum=MAX_RESPONSE_BYTES):
    path = Path(path)
    if not 1 <= path.stat().st_size <= maximum:
        raise ValueError('REFRESH_FILE_SIZE')
    data = path.read_bytes()
    if not 1 <= len(data) <= maximum:
        raise ValueError('REFRESH_FILE_CHANGED')
    return data


def valid_day(value):
    if not isinstance(value, str) or not re.fullmatch(r'20\d\d-\d\d-\d\d', value) or date.fromisoformat(value).isoformat() != value:
        raise ValueError('REFRESH_DATE')
    return date.fromisoformat(value)


def validate_task(task, at):
    if not isinstance(task, dict) or task.get('schema') != 'TAIWAN_INPUT_REFRESH_TASK_V1':
        raise ValueError('REFRESH_TASK_SCHEMA')
    fields = {'TPEX_DAY': {'date'}, 'TWSE_VALUATION_DAY': {'date'}, 'TPEX_ACTION_SET': {'from', 'through'},
              'MOPS_REVENUE_MONTH': {'market', 'period'}, 'MOPS_REPORT': {'market', 'family', 'period'}}
    kind = task.get('kind')
    extra = {'period_trigger_basis'} if kind == 'MOPS_REPORT' and 'period_trigger_basis' in task else set()
    recovery = kind == 'MOPS_REPORT' and task.get('period_trigger_basis') == RETAINED_REPORT_TRIGGER
    if extra and not recovery and (task.get('family') != 'CASHFLOW' or task['period_trigger_basis'] != CASHFLOW_TRIGGER):
        raise ValueError('REFRESH_PERIOD_TRIGGER')
    if kind == 'MOPS_REPORT':
        extra |= {'retained_request_evidence' if recovery else 'publication_evidence'}
    if kind not in fields or set(task) != {'schema', 'kind'} | fields[kind] | extra:
        raise ValueError('REFRESH_TASK_FIELDS')
    now = stamp(at); today = now.astimezone(TAIPEI).date()
    if kind in ('TPEX_DAY', 'TWSE_VALUATION_DAY'):
        day = valid_day(task['date'])
        if now < datetime.combine(day, datetime.min.time(), TAIPEI) + timedelta(hours=17, minutes=5):
            raise ValueError('REFRESH_SESSION_NOT_COMPLETE')
    elif kind == 'TPEX_ACTION_SET':
        start, through = valid_day(task['from']), valid_day(task['through'])
        if start > through or (through - start).days > 550 or through > today:
            raise ValueError('REFRESH_ACTION_RANGE')
    elif kind == 'MOPS_REVENUE_MONTH':
        if task['market'] != 'TWSE' or not re.fullmatch(r'20\d\d(?:0[1-9]|1[0-2])', str(task['period'])):
            raise ValueError('REFRESH_REVENUE_PERIOD')
        if task['period'] >= today.strftime('%Y%m'):
            raise ValueError('REFRESH_REVENUE_PERIOD_NOT_COMPLETE')
    else:
        if task['market'] not in MARKETS or task['family'] not in FAMILIES or not re.fullmatch(r'20\d\dQ[1-4]', str(task['period'])):
            raise ValueError('REFRESH_FINANCIAL_SCOPE')
        year, quarter = int(task['period'][:4]), int(task['period'][-1])
        end = date(year + 1, 1, 1) - timedelta(days=1) if quarter == 4 else date(year, quarter * 3 + 1, 1) - timedelta(days=1)
        if end > today:
            raise ValueError('REFRESH_FINANCIAL_PERIOD_NOT_COMPLETE')
        if recovery:
            verify_retained_request_evidence(task, now)
        else:
            verify_publication_evidence(task, now)
    return task


def verify_retained_request_evidence(task, at):
    """Only the same recorded public report query, never a new availability claim.

    The caller's durable cache owns attempt limits and cooldown. This verifies
    the original failed request bytes and blocks denial/unknown-ACK receipts.
    """
    proof = task['retained_request_evidence']
    if not isinstance(proof, dict) or set(proof) != {'receipt', 'receipt_file', 'receipt_sha256'}:
        raise ValueError('REFRESH_RETAINED_REQUEST_PROOF')
    raw = read_bounded(proof['receipt_file'], 200_000)
    receipt = proof['receipt']
    if not isinstance(receipt, dict) or sha(raw) != proof['receipt_sha256'] or json.loads(raw) != receipt:
        raise ValueError('REFRESH_RETAINED_REQUEST_BYTES')
    expected = financial.report_task(task['market'], task['family'], int(task['period'][:4]), int(task['period'][-1]))
    if receipt.get('schema') != 'TAIWAN_FINANCIAL_HISTORY_RECEIPT_V1' or any(receipt.get(k) != v for k, v in expected.items()):
        raise ValueError('REFRESH_RETAINED_REQUEST_IDENTITY')
    status, error = receipt.get('status'), str(receipt.get('error', ''))
    if receipt.get('source_halted', False) is not False or status in (403, 429) \
       or re.search(r'SECURITY|FORBIDDEN|HTTP_403|HTTP_429|安全性', error, re.I) or receipt.get('redirect_location'):
        raise ValueError('REFRESH_RETAINED_REQUEST_DENIAL')
    transient = status in (500, 502, 503, 504) and error == 'HTTP_' + str(status)
    timeout = status in (None, 200) and re.search(r'^(?:TimeoutError:|URLError:.*(?:timed out|timeout))', error, re.I)
    if receipt.get('state') != 'UNAVAILABLE' or not (transient or timeout):
        raise ValueError('REFRESH_RETAINED_REQUEST_NOT_TRANSIENT')
    if stamp(receipt.get('started_at')) > stamp(receipt.get('received_at')) or stamp(receipt['received_at']) > at:
        raise ValueError('REFRESH_RETAINED_REQUEST_TIME')
    encoded = urllib.parse.urlencode(expected['form']).encode()
    if receipt.get('request_form_encoded') != encoded.decode() or receipt.get('request_form_sha256') != sha(encoded):
        raise ValueError('REFRESH_RETAINED_REQUEST_FORM')
    return expected


def verify_publication_evidence(task, at):
    proof = task['publication_evidence']
    if not isinstance(proof, dict) or set(proof) != {'receipt', 'raw_path', 'row_index', 'source_row_hash', 'year_field', 'quarter_field'}:
        raise ValueError('REFRESH_PUBLICATION_PROOF')
    receipt = proof['receipt']
    if not isinstance(receipt, dict):
        raise ValueError('REFRESH_PUBLICATION_SOURCE')
    spec = next((s for s in CATALOG['sources'] if s['id'] == receipt.get('source_id')), None)
    permitted_family = spec and (spec['family'] == task['family'] or task['family'] == 'CASHFLOW'
        and task.get('period_trigger_basis') == CASHFLOW_TRIGGER and spec['family'] in ('INCOME', 'BALANCE'))
    if not spec or not permitted_family or spec['market'] != task['market'] or receipt.get('url') != spec['url'] \
       or receipt.get('schema') != 'TAIWAN_PUBLIC_SOURCE_RECEIPT_V1' or receipt.get('state') != 'CAPTURED' or receipt.get('status') != 200 \
       or receipt.get('format') != 'json' or stamp(receipt['started_at']) > stamp(receipt['received_at']) or stamp(receipt['received_at']) > at \
       or proof['year_field'] != '年度' or proof['quarter_field'] != '季別':
        raise ValueError('REFRESH_PUBLICATION_SOURCE')
    raw = read_bounded(proof['raw_path'], min(spec['byte_limit'], MAX_RESPONSE_BYTES))
    if len(raw) != receipt.get('bytes') or sha(raw) != receipt.get('sha256'):
        raise ValueError('REFRESH_PUBLICATION_BYTES')
    rows = json.loads(raw.decode('utf-8-sig')); index = proof['row_index']
    if not isinstance(rows, list) or len(rows) > 20000 or not isinstance(index, int) or isinstance(index, bool) or not 0 <= index < len(rows):
        raise ValueError('REFRESH_PUBLICATION_ROW')
    row = rows[index]
    if not isinstance(row, dict) or json_hash(row) != proof['source_row_hash']:
        raise ValueError('REFRESH_PUBLICATION_ROW_HASH')
    year_text = str(row.get('年度', '')).strip(); quarter_text = str(row.get('季別', '')).strip()
    if not re.fullmatch(r'(?:\d{3}|20\d\d)', year_text) or not re.fullmatch(r'0?[1-4]', quarter_text):
        raise ValueError('REFRESH_PUBLICATION_PERIOD')
    year = int(year_text) + (1911 if len(year_text) == 3 else 0)
    if task['period'] != f'{year}Q{int(quarter_text)}':
        raise ValueError('REFRESH_PUBLICATION_PERIOD')


def inflate(raw, limit):
    decoder = zlib.decompressobj(16 + zlib.MAX_WBITS); parts = []; size = 0
    try:
        for start in range(0, len(raw), 65536):
            block = decoder.decompress(raw[start:start + 65536], limit - size + 1)
            parts.append(block); size += len(block)
            if size > limit or decoder.unconsumed_tail:
                raise ValueError('REFRESH_GZIP_SIZE')
        if not decoder.eof or decoder.unused_data:
            raise ValueError('REFRESH_GZIP_INCOMPLETE_OR_MULTIPLE')
    except zlib.error as error:
        raise ValueError('REFRESH_GZIP_INVALID') from error
    return b''.join(parts)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def source_scope(url):
    parsed = urllib.parse.urlsplit(url)
    exact = {('www.tpex.org.tw', '/www/zh-tw/afterTrading/dailyQuotes'): 'tpex_daily',
             ('www.twse.com.tw', '/rwd/zh/afterTrading/BWIBBU_d'): 'twse_valuation',
             ('www.tpex.org.tw', '/www/zh-tw/bulletin/exDailyQ'): 'tpex_ex_right',
             ('www.tpex.org.tw', '/www/zh-tw/bulletin/revivt'): 'tpex_capital_reduction',
             ('www.tpex.org.tw', '/www/zh-tw/bulletin/pvChgRslt'): 'tpex_par_value_change',
             ('mopsov.twse.com.tw', '/server-java/FileDownLoad'): 'mops_revenue_twse',
             ('mopsov.twse.com.tw', '/server-java/t105sb02'): 'mops_financial'}
    scope = exact.get((parsed.hostname, parsed.path))
    if parsed.hostname == 'mopsov.twse.com.tw' and re.fullmatch(r'/nas/t21/sii/t21sc03_\d{3}_\d{1,2}_0\.html', parsed.path):
        scope = 'mops_revenue_twse'
    if parsed.hostname == 'mopsov.twse.com.tw' and parsed.path in ['/mops/web/ajax_' + code for code in FAMILIES.values()]:
        scope = 'mops_financial'
    if not scope or parsed.scheme != 'https' or parsed.username or parsed.password or parsed.port is not None:
        raise ValueError('REFRESH_SOURCE_SCOPE')
    return scope


class BudgetResponse:
    def __init__(self, response, budget):
        self.response = response; self.budget = budget; self.count = 0
        self.status = response.status; self.headers = response.headers

    def geturl(self):
        return self.response.geturl()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return self.response.__exit__(*args)

    def read1(self, size=65536):
        self.budget.check_deadline()
        maximum = min(size, 65536, MAX_RESPONSE_BYTES + 1 - self.count)
        if maximum <= 0:
            raise ValueError('REFRESH_RESPONSE_BYTE_LIMIT')
        method = getattr(self.response, 'read1', self.response.read)
        data = method(maximum); self.count += len(data); self.budget.bytes += len(data)
        if self.budget.bytes > MAX_ATTEMPT_BYTES:
            raise ValueError('REFRESH_ATTEMPT_BYTE_LIMIT')
        self.budget.check_deadline(); return data

    def read(self, size=-1):
        wanted = min(size if size >= 0 else MAX_RESPONSE_BYTES + 1, MAX_RESPONSE_BYTES + 1)
        parts = []; count = 0
        while count < wanted:
            piece = self.read1(min(65536, wanted - count))
            if not piece:
                break
            parts.append(piece); count += len(piece)
        return b''.join(parts)


class RequestBudget:
    def __init__(self, output, opener, clock, monotonic, sleeper):
        self.output = output; self.opener = opener; self.clock = clock; self.monotonic = monotonic; self.sleep = sleeper
        self.started = monotonic(); self.last_started = None; self.requests = 0; self.bytes = 0; self.halted = False
        self.allowed = set(); self.halt_scopes = set()

    def check_deadline(self):
        if self.monotonic() - self.started > MAX_ATTEMPT_SECONDS:
            raise TimeoutError('REFRESH_ATTEMPT_DEADLINE')

    def allow(self, url, method='GET', form=None):
        source_scope(url)
        body = urllib.parse.urlencode(form).encode() if form is not None else None
        self.allowed.add((url, method, body))

    def halt(self, url, status=None):
        scope = source_scope(url); self.halted = True; self.halt_scopes.add(scope)
        path = self.output / 'source-halts' / (scope + '.json')
        if not path.exists():
            immutable_json(path, {'scope': scope, 'url': url, 'status': status, 'observed_at': self.clock(), 'reason': 'OFFICIAL_SECURITY_OR_ACCESS_DENIAL'})

    def open(self, request, timeout=25):
        identity = (request.full_url, request.get_method(), request.data)
        if identity not in self.allowed or request.has_header('Authorization') or request.has_header('Cookie'):
            raise ValueError('REFRESH_REQUEST_NOT_AUTHORIZED')
        if self.halted or self.requests >= MAX_REQUESTS:
            raise ValueError('REFRESH_REQUEST_BUDGET_OR_HALT')
        self.check_deadline()
        if self.last_started is not None:
            delay = MINIMUM_GAP_SECONDS - (self.monotonic() - self.last_started)
            if delay > 0:
                self.sleep(delay)
        self.check_deadline(); self.last_started = self.monotonic(); self.requests += 1
        intent = {'schema': 'TAIWAN_REFRESH_HTTP_INTENT_V1', 'sequence': self.requests, 'started_at': self.clock(),
                  'url': request.full_url, 'method': request.get_method(), 'body_sha256': sha(request.data) if request.data is not None else None}
        immutable_json(self.output / 'request-intents' / f'{self.requests:02d}.json', intent)
        try:
            response = self.opener.open(request, timeout=min(timeout, max(1, MAX_ATTEMPT_SECONDS - (self.monotonic() - self.started))))
            if response.geturl() != request.full_url:
                response.__exit__(None, None, None)
                raise ValueError('REFRESH_REDIRECT_DENIED')
            return BudgetResponse(response, self)
        except urllib.error.HTTPError as error:
            if error.code in (403, 429):
                self.halt(request.full_url, error.code)
            raise


@contextmanager
def collector_transport(budget):
    # Module-local injection keeps the existing collectors and parsers intact.
    # It does not change the process-wide urllib implementation or any files.
    saved = []
    for module in (history, financial, financial_csv):
        old = {name: getattr(module, name) for name in ('urllib', 'time', 'gzip')}
        for name in ('now', 'utc_now'):
            if hasattr(module, name):
                old[name] = getattr(module, name); setattr(module, name, budget.clock)
        module.urllib = SimpleNamespace(request=SimpleNamespace(Request=urllib.request.Request, build_opener=lambda *args: budget),
                                       parse=urllib.parse, error=urllib.error)
        module.time = SimpleNamespace(monotonic=budget.monotonic, sleep=budget.sleep)
        limit = 8_000_000 if module is financial_csv else MAX_RESPONSE_BYTES
        module.gzip = SimpleNamespace(decompress=lambda raw, limit=limit: inflate(raw, limit))
        saved.append((module, old))
    try:
        yield
    finally:
        for module, old in saved:
            for name, value in old.items():
                setattr(module, name, value)


def security_denial(data):
    for encoding in ('utf-8', 'cp950'):
        text = data.decode(encoding, errors='ignore').lower()
        if any(value in text for value in ('for security reasons', '因為安全性考量', 'access denied', 'forbidden')):
            return True
    return False


def save_raw(output, source_id, raw, suffix):
    path = output / 'raw' / f'{source_id}-{sha(raw)}.{suffix}'
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.read_bytes() != raw:
            raise ValueError('REFRESH_RAW_COLLISION')
    else:
        with path.open('xb') as handle:
            handle.write(raw)
    return str(path.resolve())


def capture_entity(metadata, output, budget, validate, byte_limit=MAX_RESPONSE_BYTES):
    receipt = {**metadata, 'state': 'IN_PROGRESS', 'started_at': budget.clock(), 'attempts': 1,
               'historical_knowledge': False, 'production_writes': 0}
    path = output / (receipt['source_id'] + '-receipt.json'); immutable_json(path, receipt)
    wire = b''; chunks = []; complete = False
    try:
        form = receipt.get('form'); budget.allow(receipt['url'], receipt['method'], form)
        body = urllib.parse.urlencode(form).encode() if form is not None else None
        headers = {'Accept': 'application/json,text/csv,text/html', 'Accept-Encoding': 'identity'}
        if body is not None:
            headers['Content-Type'] = 'application/x-www-form-urlencoded'
        request = urllib.request.Request(receipt['url'], data=body, method=receipt['method'], headers=headers)
        with budget.open(request, timeout=25) as response:
            receipt.update(status=response.status, content_type=response.headers.get('Content-Type', ''),
                           content_encoding=response.headers.get('Content-Encoding', '').lower())
            if response.status != 200:
                raise ValueError('REFRESH_HTTP_STATUS')
            while True:
                chunk = response.read1(65536)
                if not chunk:
                    complete = True; break
                chunks.append(chunk)
                if sum(map(len, chunks)) > byte_limit:
                    raise ValueError('REFRESH_ENTITY_WIRE_SIZE')
            wire = b''.join(chunks)
        receipt['received_at'] = budget.clock()
        encoding = receipt['content_encoding']
        if encoding not in ('', 'identity', 'gzip'):
            raise ValueError('REFRESH_CONTENT_ENCODING')
        raw = inflate(wire, byte_limit) if encoding == 'gzip' else wire
        if not 1 <= len(raw) <= byte_limit:
            raise ValueError('REFRESH_ENTITY_SIZE')
        receipt.update(raw_path=save_raw(output, receipt['source_id'], raw, receipt.get('format', 'html')),
                       sha256=sha(raw), bytes=len(raw), entity_bytes_complete=True)
        if security_denial(raw):
            receipt['source_halted'] = True; raise ValueError('REFRESH_SECURITY_DENIAL')
        receipt.update(validate(raw)); receipt['state'] = 'CAPTURED'
    except urllib.error.HTTPError as error:
        receipt.update(state='UNAVAILABLE', status=error.code, error='HTTP_' + str(error.code), source_halted=error.code in (403, 429))
        wire = error.read(byte_limit + 1); complete = len(wire) <= byte_limit
        if security_denial(wire):
            receipt['source_halted'] = True
    except (ValueError, UnicodeError, csv.Error, TimeoutError, OSError, urllib.error.URLError) as error:
        receipt.update(state='UNAVAILABLE', error=type(error).__name__ + ':' + str(error)[:160])
        if not wire:
            wire = b''.join(chunks)
    if wire:
        receipt.update(wire_path=save_raw(output, receipt['source_id'] + '-wire', wire, 'bin'),
                       wire_sha256=sha(wire), wire_bytes=len(wire), wire_bytes_complete=complete)
    receipt.setdefault('received_at', budget.clock()); atomic_json(path, receipt)
    return receipt, path


def monthly_export(parent, raw, period):
    text = raw.decode('cp950', errors='strict')
    if text.encode('cp950') != raw or not re.search(r'charset\s*=\s*["\']?big5', text, re.I):
        raise ValueError('REFRESH_REVENUE_HTML_ENCODING')
    tree = html.fromstring(text, parser=html.HTMLParser(no_network=True))
    year, month = int(period[:4]), int(period[4:]); heading = f'上市公司{year - 1911}年{month}月份(累計與當月)營業收入統計表'
    titles = [''.join(node.itertext()).strip() for node in tree.xpath('//font[@size="5"]/b|//h1|//h2|//h3')]
    if heading not in titles:
        raise ValueError('REFRESH_REVENUE_HTML_PERIOD')
    forms = tree.xpath('//form[@name="show_file"]')
    if len(forms) != 1 or forms[0].get('action') != '/server-java/FileDownLoad' or forms[0].get('method', '').lower() != 'post':
        raise ValueError('REFRESH_REVENUE_FORM')
    pairs = [(n.get('name'), n.get('value', '')) for n in forms[0].xpath('.//input[@type="hidden"]')]
    values = dict(pairs)
    if len(pairs) != len(values) or values != {'step': '9', 'functionName': 'show_file2', 'filePath': '/t21/sii/', 'fileName': ''}:
        raise ValueError('REFRESH_REVENUE_FORM_FIELDS')
    filenames = set()
    for node in tree.xpath('//*[@onclick]'):
        script = node.get('onclick')
        match = re.fullmatch(r'\s*document\.show_file\.fileName\.value="(t21sc03_\d{3}_\d{1,2}\.csv)";\s*document\.show_file\.submit\(\);\s*', script)
        if match:
            filenames.add(match.group(1))
    expected = f't21sc03_{year - 1911}_{month}.csv'
    if filenames != {expected}:
        raise ValueError('REFRESH_REVENUE_OBSERVED_FILENAME_REQUIRED')
    # The value is selected from the real button, after validating its period.
    values['fileName'] = next(iter(filenames))
    return values


def revenue_csv_metadata(raw, period, at):
    text = raw.decode('utf-8-sig', errors='strict')
    if raw.decode('utf-8').encode('utf-8') != raw:
        raise ValueError('REFRESH_REVENUE_UTF8')
    rows = [r for r in csv.reader(io.StringIO(text, newline=''), strict=True) if any(v != '' for v in r)]
    if not rows or len(rows) > 10001 or rows[0][:5] != ['出表日期', '資料年月', '公司代號', '公司名稱', '產業別'] \
       or len(set(rows[0])) != len(rows[0]) or any(len(r) != len(rows[0]) for r in rows):
        raise ValueError('REFRESH_REVENUE_CSV_SCHEMA')
    wanted = f'{int(period[:4]) - 1911}/{int(period[4:])}'; symbols = set(); received_day = stamp(at).astimezone(TAIPEI).date()
    for row in rows[1:]:
        if row[1] != wanted or not re.fullmatch(r'\d{4,6}', row[2]) or row[2] in symbols:
            raise ValueError('REFRESH_REVENUE_CSV_PERIOD_OR_SYMBOL')
        symbols.add(row[2])
        exported = normalizer.roc_date(row[0])
        if exported > received_day or exported < date(int(period[:4]), int(period[4:]), 1):
            raise ValueError('REFRESH_REVENUE_EXPORT_DATE')
    return {'encoding': 'UTF8', 'row_layout': 'HEADER_AND_DATA_ARRAYS_V1', 'decoded_text_sha256': sha(raw),
            'row_count': len(rows), 'data_row_count': len(rows) - 1}


def verify_saved_result(result):
    if result.get('schema') != 'TAIWAN_INPUT_REFRESH_CAPTURE_RESULT_V1' or result.get('state') not in ('CAPTURED', 'PARTIAL', 'UNAVAILABLE', 'HALTED') \
       or not isinstance(result.get('network_requests'), int) or not 0 <= result['network_requests'] <= MAX_REQUESTS:
        raise ValueError('REFRESH_SAVED_RESULT')
    for capture in result['captures']:
        receipt = capture['receipt']
        for path_key, hash_key, bytes_key in (('raw_path', 'sha256', 'bytes'), ('wire_path', 'wire_sha256', 'wire_bytes')):
            if receipt.get(path_key):
                raw = read_bounded(receipt[path_key], MAX_RESPONSE_BYTES + 1)
                if sha(raw) != receipt[hash_key] or len(raw) != receipt[bytes_key]:
                    raise ValueError('REFRESH_SAVED_BYTES_CHANGED')
    for document in result['financial_documents']:
        body = json.loads(read_bounded(document['file'], 32_000_000)); expected = body.pop('financial_history_hash')
        if normalizer.hashed(body) != expected:
            raise ValueError('REFRESH_SAVED_DOCUMENT_CHANGED')


def execute_task(task, output, *, opener=None, clock=utc_now, monotonic=time.monotonic, sleeper=time.sleep):
    task = json.loads(json.dumps(task)); validate_task(task, clock()); output = Path(output); output.mkdir(parents=True, exist_ok=True)
    intent_path = output / 'task-intent.json'; result_path = output / 'result.json'; task_hash = json_hash(task)
    if intent_path.exists():
        prior = json.loads(read_bounded(intent_path, 2_000_000))
        if prior.get('task_hash') != task_hash or prior.get('task') != task:
            raise ValueError('REFRESH_ATTEMPT_IDENTITY_CHANGED')
        if result_path.exists():
            result = json.loads(read_bounded(result_path, 4_000_000))
            if result.get('kind') != task['kind']:
                raise ValueError('REFRESH_SAVED_RESULT_KIND')
            verify_saved_result(result); return result
        # An interrupted attempt cannot silently reacquire a previously sent request.
        halts = [json.loads(read_bounded(path, 10000))['scope'] for path in (output / 'source-halts').glob('*.json')]
        captures = []
        for path in sorted([*output.glob('*-receipt.json'), *(output / 'receipts').glob('*.json')]):
            receipt = json.loads(read_bounded(path, 200000)); schema = receipt.get('schema')
            role = 'PUBLIC' if schema == 'TAIWAN_PUBLIC_SOURCE_RECEIPT_V1' else 'FINANCIAL_CSV' if schema == 'TAIWAN_FINANCIAL_CSV_RECEIPT_V1' else \
                'FINANCIAL_HTML' if schema == 'TAIWAN_FINANCIAL_HISTORY_RECEIPT_V1' else 'HISTORY' if receipt.get('family') == 'PRICE' else 'ACTION'
            captures.append({'role': role, 'receipt': receipt, 'raw_path': receipt.get('raw_path') or receipt.get('wire_path')})
            if receipt.get('source_halted') or receipt.get('status') in (403, 429):
                halts.append(source_scope(receipt['url']))
        result = {'schema': 'TAIWAN_INPUT_REFRESH_CAPTURE_RESULT_V1', 'kind': task['kind'], 'state': 'HALTED' if halts else 'UNAVAILABLE',
                  'completed_at': clock(), 'network_requests': len(list((output / 'request-intents').glob('*.json'))),
                  'captures': captures, 'financial_documents': [], 'issues': [{'code': 'INTERRUPTED_ATTEMPT_OUTCOME_UNKNOWN'}], 'source_halts': sorted(set(halts))}
        atomic_json(result_path, result); return result
    if any(output.iterdir()):
        raise ValueError('REFRESH_NEW_ATTEMPT_DIRECTORY_REQUIRED')
    immutable_json(intent_path, {'schema': 'TAIWAN_INPUT_REFRESH_ATTEMPT_V1', 'task_hash': task_hash, 'task': task, 'started_at': clock()})
    budget = RequestBudget(output, opener or urllib.request.build_opener(NoRedirect), clock, monotonic, sleeper)
    result = {'schema': 'TAIWAN_INPUT_REFRESH_CAPTURE_RESULT_V1', 'kind': task['kind'], 'state': 'UNAVAILABLE',
              'completed_at': None, 'network_requests': 0, 'captures': [], 'financial_documents': [], 'issues': [], 'source_halts': []}
    complete = False

    def record(role, receipt, scope):
        result['captures'].append({'role': role, 'receipt': receipt, 'raw_path': receipt.get('raw_path') or receipt.get('wire_path')})
        denied = bool(receipt.get('source_halted')) or receipt.get('status') in (403, 429)
        if receipt.get('state') != 'CAPTURED':
            result['issues'].append({'code': 'SOURCE_UNAVAILABLE', 'source_id': receipt.get('source_id'), 'reason': receipt.get('error')})
            path = receipt.get('raw_path') or receipt.get('wire_path')
            if path:
                denied = denied or security_denial(read_bounded(path, MAX_RESPONSE_BYTES + 1))
        if denied:
            budget.halt(receipt['url'], receipt.get('status'))
            if scope not in result['source_halts']:
                result['source_halts'].append(scope)

    try:
        with collector_transport(budget), redirect_stdout(sys.stderr):
            kind = task['kind']
            if kind in ('TPEX_DAY', 'TPEX_ACTION_SET'):
                requests = [history.task_for('tpex_daily', day=task['date'])] if kind == 'TPEX_DAY' else [
                    history.task_for(source, start=task['from'], through=task['through']) for source in ACTION_SOURCES]
                for request in requests:
                    if budget.halted:
                        break
                    budget.allow(request['url']); receipt, _ = history.capture(request, output, budget)
                    record('HISTORY' if kind == 'TPEX_DAY' else 'ACTION', receipt, request['source_id'])
                complete = len(result['captures']) == len(requests) and all(c['receipt']['state'] == 'CAPTURED' for c in result['captures'])
            elif kind == 'TWSE_VALUATION_DAY':
                day = task['date'].replace('-', '')
                metadata = {'schema': 'TAIWAN_PUBLIC_SOURCE_RECEIPT_V1', 'source_id': 'TWSE_VALUATION_' + day,
                            'url': 'https://www.twse.com.tw/rwd/zh/afterTrading/BWIBBU_d?date=' + day + '&selectType=ALL&response=json',
                            'method': 'GET', 'format': 'json'}
                def valuation(raw):
                    body = json.loads(raw.decode('utf-8-sig'))
                    fields = ['證券代號', '證券名稱', '收盤價', '殖利率(%)', '股利年度', '本益比', '股價淨值比', '財報年/季']
                    if not isinstance(body, dict) or body.get('stat') != 'OK' or body.get('date') != day or body.get('fields') != fields \
                       or not isinstance(body.get('data'), list) or not 1 <= len(body['data']) <= 20000 \
                       or any(not isinstance(row, list) or len(row) != 8 for row in body['data']):
                        raise ValueError('REFRESH_VALUATION_RESPONSE')
                    return {'row_count': len(body['data'])}
                receipt, _ = capture_entity(metadata, output, budget, valuation); record('PUBLIC', receipt, 'twse_valuation')
                complete = receipt['state'] == 'CAPTURED'
            elif kind == 'MOPS_REVENUE_MONTH':
                year, month = int(task['period'][:4]), int(task['period'][4:])
                metadata = {'schema': 'TAIWAN_FINANCIAL_HISTORY_RECEIPT_V1', 'source_id': 'mops_revenue_TWSE_' + task['period'],
                            'url': f'https://mopsov.twse.com.tw/nas/t21/sii/t21sc03_{year - 1911}_{month}_0.html', 'method': 'GET'}
                parent, _ = capture_entity(metadata, output, budget, lambda raw: {'encoding': 'CP950'})
                record('FINANCIAL_HTML', parent, 'mops_revenue_twse')
                if parent['state'] == 'CAPTURED' and not budget.halted:
                    form = monthly_export(parent, read_bounded(parent['raw_path']), task['period'])
                    metadata = {'schema': 'TAIWAN_PUBLIC_SOURCE_RECEIPT_V1', 'source_id': 'MOPS_REVENUE_TWSE_' + task['period'] + '_CSV',
                                'url': REVENUE_URL, 'method': 'POST', 'form': form, 'request_method': 'POST', 'request_form': form,
                                'format': 'csv', 'parent_html_sha256': parent['sha256']}
                    receipt, _ = capture_entity(metadata, output, budget, lambda raw: revenue_csv_metadata(raw, task['period'], clock()), 8_000_000)
                    record('PUBLIC', receipt, 'mops_revenue_twse'); complete = receipt['state'] == 'CAPTURED'
            else:
                year, quarter = int(task['period'][:4]), int(task['period'][-1]); code = FAMILIES[task['family']]
                form = {'encodeURIComponent': '1', 'step': '1', 'firstin': '1', 'off': '1', 'TYPEK': MARKETS[task['market']],
                        'year': str(year - 1911), 'season': f'{quarter:02d}'}
                url = 'https://mopsov.twse.com.tw/mops/web/ajax_' + code
                request = {'source_id': f"mops_{task['family'].lower()}_{task['market']}_{task['period']}", 'url': url,
                           'method': 'POST', 'form': form, 'market': task['market'], 'family': task['family'],
                           'period': task['period'], 'task_id': financial.request_key(url, form)}
                budget.allow(url, 'POST', form); collector = financial.Collector(output); parent, _ = collector.capture(request)
                record('FINANCIAL_HTML', parent, 'mops_financial')
                if parent['state'] == 'CAPTURED' and not budget.halted:
                    parent_path = output / (parent['source_id'] + '-receipt.json'); parent_raw = read_bounded(parent['raw_path'])
                    normalizer.history.normalize_mops_report(parent, parent_raw)
                    tasks = financial_csv.tasks_from_html(parent, parent_raw, parent_path); csv_collector = financial_csv.CsvCollector(output)
                    normalized_documents = []
                    for export in tasks:
                        if budget.halted or budget.requests >= MAX_REQUESTS:
                            result['issues'].append({'code': 'REMAINING_OBSERVED_EXPORTS_NOT_REQUESTED'}); break
                        budget.allow(export['url'], 'POST', export['form']); receipt = csv_collector.run(export)
                        if receipt is None:
                            raise ValueError('REFRESH_CSV_ATTEMPT_UNCONFIRMED')
                        record('FINANCIAL_CSV', receipt, 'mops_financial')
                        if receipt['state'] != 'CAPTURED':
                            continue
                        raw = read_bounded(receipt['raw_path'], 8_000_000)
                        document = normalizer.normalize_mops_csv(receipt, raw, parent, parent_raw)
                        target = output / 'normalized' / (receipt['source_id'] + '-' + document['financial_history_hash'] + '.json')
                        public_path = output / 'normalized' / (receipt['source_id'] + '-public-receipt.json')
                        immutable_json(target, document); immutable_json(public_path, document['source_receipt'])
                        result['financial_documents'].append({'file': str(target.resolve()), 'public_receipt_file': str(public_path.resolve()),
                            'raw_csv_file': receipt['raw_path'], 'parent_receipt_file': str(parent_path.resolve()), 'parent_raw_file': parent['raw_path']})
                        normalized_documents.append(document)
                    coverage = normalizer.coverage(parent, parent_raw, normalized_documents)
                    complete = coverage['complete']
                    if not complete:
                        result['issues'].append({'code': 'REPORT_COMPANY_COVERAGE_INCOMPLETE',
                            'expected_companies': coverage['expected_companies'], 'verified_companies': coverage['verified_companies'],
                            'missing_company_count': len(coverage['missing_symbols']), 'missing_export_count': len(coverage['missing_exports']),
                            'duplicate_company_count': len(coverage['duplicate_symbols']), 'extra_company_count': len(coverage['extra_symbols'])})
    except (ValueError, UnicodeError, KeyError, TypeError, csv.Error, TimeoutError, OSError, urllib.error.URLError) as error:
        result['issues'].append({'code': 'REFRESH_VALIDATION_OR_EXECUTION', 'reason': type(error).__name__ + ':' + str(error)[:160]})
    result['source_halts'] = sorted(set(result['source_halts']) | budget.halt_scopes)
    result['state'] = 'HALTED' if result['source_halts'] else 'CAPTURED' if complete else \
        'PARTIAL' if any(c['receipt'].get('state') == 'CAPTURED' for c in result['captures']) else 'UNAVAILABLE'
    result['completed_at'] = clock(); result['network_requests'] = budget.requests
    atomic_json(result_path, result); return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--task-file', type=Path, required=True); parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(); task = json.loads(read_bounded(args.task_file, 2_000_000))
    result = execute_task(task, args.output)
    print(json.dumps({'result_file': str((args.output / 'result.json').resolve()), 'state': result['state'],
                      'network_requests': result['network_requests'], 'captures': len(result['captures']),
                      'financial_documents': len(result['financial_documents']), 'source_halts': result['source_halts']}, ensure_ascii=False))
    return 0 if result['state'] == 'CAPTURED' else 2


if __name__ == '__main__':
    raise SystemExit(main())
