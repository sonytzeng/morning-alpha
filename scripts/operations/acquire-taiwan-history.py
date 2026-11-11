#!/usr/bin/env python3
"""Bounded official whole-market history capture with no retries or credentials.

Each exact URL is attempted once in a destination, including failed attempts.
HTTP 403/429 and HTML denials stop subsequent requests for that source. Raw
bytes, actual receipt times and hashes precede any financial normalization.
"""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
import hashlib
import gzip
import json
from pathlib import Path
import time
import threading
import urllib.error
import urllib.parse
import urllib.request

SOURCES = {
    'twse_daily': ('TWSE', 'PRICE', 'https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX'),
    'tpex_daily': ('TPEX', 'PRICE', 'https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes'),
    'twse_ex_right': ('TWSE', 'ACTION_EX_RIGHT', 'https://www.twse.com.tw/rwd/zh/exRight/TWT49U'),
    'twse_capital_reduction': ('TWSE', 'ACTION_CAPITAL_REDUCTION', 'https://www.twse.com.tw/rwd/zh/reducation/TWTAUU'),
    'twse_par_value_change': ('TWSE', 'ACTION_PAR_VALUE_CHANGE', 'https://www.twse.com.tw/rwd/zh/change/TWTB8U'),
    'tpex_ex_right': ('TPEX', 'ACTION_EX_RIGHT', 'https://www.tpex.org.tw/www/zh-tw/bulletin/exDailyQ'),
    'tpex_capital_reduction': ('TPEX', 'ACTION_CAPITAL_REDUCTION', 'https://www.tpex.org.tw/www/zh-tw/bulletin/revivt'),
    'tpex_par_value_change': ('TPEX', 'ACTION_PAR_VALUE_CHANGE', 'https://www.tpex.org.tw/www/zh-tw/bulletin/pvChgRslt'),
}
MAX_RESPONSE_BYTES = 16_000_000
MAX_RUN_BYTES = 960_000_000

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec='microseconds').replace('+00:00', 'Z')

def valid_date(value):
    if date.fromisoformat(value).isoformat() != value:
        raise ValueError('DATE_INVALID')
    return value

def task_for(source_id, day=None, start=None, through=None):
    market, family, base = SOURCES[source_id]
    fmt = lambda d: d.replace('-', '' if market == 'TWSE' else '/')
    if family == 'PRICE':
        valid_date(day)
        query = [('date', fmt(day))]
        if market == 'TWSE':
            query.append(('type', 'ALLBUT0999'))
        query.append(('response', 'json'))
    else:
        valid_date(start); valid_date(through)
        if start > through or (date.fromisoformat(through)-date.fromisoformat(start)).days > 550:
            raise ValueError('ACTION_PERIOD_INVALID')
        query = [('startDate', fmt(start)), ('endDate', fmt(through)), ('response', 'json')]
    url = base + '?' + urllib.parse.urlencode(query, safe='/')
    return {'source_id': source_id, 'market': market, 'family': family, 'url': url,
            'date': day, 'from': start, 'through': through, 'task_id': hashlib.sha256(url.encode()).hexdigest()}

def save_raw(destination, task, data):
    digest = hashlib.sha256(data).hexdigest()
    target = destination / 'raw' / f"{task['source_id']}-{task['date'] or task['from']}-{digest}.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        if target.read_bytes() != data:
            raise ValueError('CONTENT_ADDRESS_COLLISION')
    else:
        with target.open('xb') as handle:
            handle.write(data)
    return {'raw_path': str(target.resolve()), 'sha256': digest, 'bytes': len(data)}

def capture(task, destination, opener):
    target = destination / 'receipts' / (task['task_id']+'.json')
    if target.exists():
        receipt = json.loads(target.read_text())
        if receipt['url'] != task['url'] or receipt['task_id'] != task['task_id']:
            raise ValueError('CACHE_IDENTITY')
        if receipt.get('raw_path'):
            data = Path(receipt['raw_path']).read_bytes()
            if len(data) != receipt['bytes'] or hashlib.sha256(data).hexdigest() != receipt['sha256']:
                raise ValueError('CACHE_BYTES_CHANGED')
        return receipt, True
    receipt = {'schema': 'TAIWAN_HISTORY_SOURCE_RECEIPT_V1', **task, 'started_at': utc_now(), 'state': 'IN_PROGRESS',
               'attempts': 1, 'byte_limit': MAX_RESPONSE_BYTES, 'historical_knowledge': False, 'production_writes': 0}
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open('x') as handle:
        json.dump(receipt, handle, ensure_ascii=False, indent=2); handle.write('\n')
    receipt['state'] = 'UNAVAILABLE'
    try:
        request = urllib.request.Request(task['url'], headers={'Accept': 'application/json', 'Accept-Encoding': 'identity'})
        with opener.open(request, timeout=25) as response:
            receipt.update({'status': response.status, 'content_type': response.headers.get('Content-Type', ''),
                            'etag': response.headers.get('ETag'), 'last_modified': response.headers.get('Last-Modified'),
                            'content_encoding': response.headers.get('Content-Encoding', '').lower()})
            if response.status != 200 or response.geturl() != task['url']:
                raise ValueError('HTTP_STATUS_OR_REDIRECT')
            data = response.read(MAX_RESPONSE_BYTES+1)
        receipt['received_at'] = utc_now()
        receipt['raw_bytes_complete'] = len(data) <= MAX_RESPONSE_BYTES
        receipt.update(save_raw(destination, task, data))
        if not data or len(data) > MAX_RESPONSE_BYTES:
            raise ValueError('EMPTY_OR_OVERSIZED_RESPONSE')
        if receipt['content_encoding'] not in ('', 'identity', 'gzip'):
            raise ValueError('UNSUPPORTED_CONTENT_ENCODING')
        decoded = gzip.decompress(data) if receipt['content_encoding'] == 'gzip' else data
        if len(decoded) > MAX_RESPONSE_BYTES:
            raise ValueError('DECOMPRESSED_RESPONSE_TOO_LARGE')
        text = decoded.decode('utf-8-sig', errors='strict')
        if text.lstrip().lower().startswith(('<html', '<!doctype')):
            receipt['source_halted'] = True
            raise ValueError('HTML_INSTEAD_OF_JSON')
        payload = json.loads(text)
        if not isinstance(payload, dict):
            raise ValueError('JSON_OBJECT_REQUIRED')
        receipt.update({'state': 'CAPTURED', 'provider_stat': payload.get('stat'), 'provider_date': payload.get('date'),
                        'semantic_validation': 'PENDING_EXACT_MARKET_DATE_SCHEMA_AND_UNITS'})
    except urllib.error.HTTPError as error:
        receipt.update({'status': error.code, 'error': 'HTTP_'+str(error.code), 'source_halted': error.code in (403, 429)})
        data = error.read(MAX_RESPONSE_BYTES+1)
        receipt.update(save_raw(destination, task, data))
        receipt['raw_bytes_complete'] = len(data) <= MAX_RESPONSE_BYTES
        receipt['redirect_location'] = error.headers.get('Location')
        if b'FOR SECURITY REASONS' in data or '因為安全性考量'.encode() in data:
            receipt['source_halted'] = True
    except urllib.error.URLError as error:
        receipt['error'] = 'TRANSPORT_UNAVAILABLE: '+type(error.reason).__name__
    except (ValueError, UnicodeError, TimeoutError, OSError) as error:
        receipt['error'] = type(error).__name__+': '+str(error)[:200]
    receipt.setdefault('received_at', utc_now())
    temporary = target.with_suffix('.json.tmp')
    with temporary.open('x') as handle:
        json.dump(receipt, handle, ensure_ascii=False, indent=2); handle.write('\n')
    temporary.replace(target)
    return receipt, False

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', action='append', choices=sorted(SOURCES), required=True)
    selection = parser.add_mutually_exclusive_group()
    selection.add_argument('--date', action='append')
    selection.add_argument('--dates-file', type=Path)
    parser.add_argument('--from', dest='start')
    parser.add_argument('--through')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--throttle-seconds', type=float, default=2)
    args = parser.parse_args()
    if not 2 <= args.throttle_seconds <= 30 or len(set(args.source)) != len(args.source):
        parser.error('Invalid throttle or duplicate source')
    dates = json.loads(args.dates_file.read_text()) if args.dates_file else args.date or []
    if not isinstance(dates, list) or len(dates) > 300 or len(set(dates)) != len(dates):
        parser.error('Explicit distinct date list must contain at most 300 dates')
    for d in dates:
        valid_date(d)
        if datetime.now(timezone.utc).timestamp() < datetime.fromisoformat(d+'T17:05:00+08:00').timestamp():
            parser.error('Only completed official all-trades dates may be requested')
    if any(SOURCES[s][1] == 'PRICE' for s in args.source) and not dates:
        parser.error('Price sources require explicit dates')
    if any(SOURCES[s][1] != 'PRICE' for s in args.source) and (not args.start or not args.through):
        parser.error('Action sources require an explicit period')
    tasks = [task_for(s, day=d) for d in dates for s in args.source if SOURCES[s][1] == 'PRICE']
    tasks += [task_for(s, start=args.start, through=args.through) for s in args.source if SOURCES[s][1] != 'PRICE']
    if len(tasks) > 610:
        parser.error('Acquisition budget exceeds 610 exact URL attempts')
    args.output.mkdir(parents=True, exist_ok=True)
    started = utc_now(); receipts = []; halted = set(); size = 0; requests = 0; guard = threading.Lock()
    for path in (args.output/'receipts').glob('*.json'):
        prior = json.loads(path.read_text())
        security_body = prior.get('raw_path') and prior.get('state') != 'CAPTURED' and b'FOR SECURITY REASONS' in Path(prior['raw_path']).read_bytes()
        if prior.get('source_halted') or security_body:
            halted.add(prior['source_id'])
    output = args.output/('acquisition-'+started.replace(':', '').replace('.', '-')+'.json')
    def save_progress():
        document = {'schema': 'TAIWAN_HISTORY_ACQUISITION_V1', 'started_at': started, 'updated_at': utc_now(),
                    'requested_tasks': len(tasks), 'requests': requests, 'raw_bytes': size, 'source_halted': sorted(halted),
                    'receipts': receipts, 'production_writes': 0}
        output.write_text(json.dumps(document, ensure_ascii=False, indent=2)+'\n')
    def run_host(host_tasks):
        nonlocal size, requests
        opener = urllib.request.build_opener(NoRedirect); prior_request_finished = None
        for task in host_tasks:
            with guard:
                reason = 'SKIPPED_SOURCE_HALTED' if task['source_id'] in halted else 'SKIPPED_BYTE_BUDGET' if size >= MAX_RUN_BYTES else 'SKIPPED_OPERATOR_STOP' if (args.output/'stop_requested').exists() else None
                if reason:
                    receipts.append({**task, 'state': reason, 'attempts': 0}); continue
            cached = (args.output/'receipts'/(task['task_id']+'.json')).exists()
            if prior_request_finished is not None and not cached:
                delay = args.throttle_seconds-(time.monotonic()-prior_request_finished)
                if delay > 0:
                    time.sleep(delay)
            receipt, hit = capture(task, args.output, opener)
            if not hit:
                prior_request_finished = time.monotonic()
            with guard:
                if not hit:
                    requests += 1
                size += receipt.get('bytes', 0)
                if receipt.get('source_halted'):
                    halted.add(task['source_id'])
                receipts.append(receipt); save_progress()
                print(json.dumps({'source_id': task['source_id'], 'date': task['date'], 'from': task['from'], 'through': task['through'],
                                  'state': receipt['state'], 'status': receipt.get('status'), 'bytes': receipt.get('bytes'),
                                  'cache_hit': hit, 'error': receipt.get('error'), 'completed': len(receipts), 'total': len(tasks)}, ensure_ascii=False), flush=True)
    hosts = {}
    for task in tasks:
        hosts.setdefault(urllib.parse.urlsplit(task['url']).hostname, []).append(task)
    if len(hosts) > 2:
        raise ValueError('HOST_CONCURRENCY_BUDGET')
    with ThreadPoolExecutor(max_workers=2) as executor:
        for future in [executor.submit(run_host, group) for group in hosts.values()]:
            future.result()
    save_progress()
    return 0 if all(r['state'] == 'CAPTURED' for r in receipts) else 2

if __name__ == '__main__':
    raise SystemExit(main())
