"""Fixed public-byte hash check. No SDK import/eval, credentials or production API.
New independent CI evidence; never changes or rearms the failed local plan.
"""
import argparse
import hashlib
import http.client
import json
import multiprocessing as mp
from multiprocessing.connection import wait
import os
from pathlib import Path
import re
import ssl
import sys
import time
from urllib.parse import urljoin, urlsplit

EXPECTED_PLAN_SHA256 = "4c9da92507641a0268f7ec595a406556f0cd22469a1f97d6b5ab3f7dbd524145"
REPOSITORY = "sonytzeng/morning-alpha"
HEAD_BRANCH = "codex/market-regime-compatibility-20261019"
HEX40 = re.compile(r"[0-9a-f]{40}\Z")
HEX64 = re.compile(r"[0-9a-f]{64}\Z")
BODY_MAX = 1048576
REDIRECTS = {301, 302, 303, 307, 308}
FORBIDDEN_ENV = {
    "GITHUB_TOKEN", "GH_TOKEN", "ACTIONS_RUNTIME_TOKEN", "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
    "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy",
    "SSL_CERT_FILE", "SSL_CERT_DIR", "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE",
    "PYTHONPATH", "PYTHONHOME", "LD_PRELOAD", "LD_LIBRARY_PATH",
}

def digest(data):
    return hashlib.sha256(data).hexdigest()

def safe_url(value):
    try:
        u = urlsplit(value)
        return (u.scheme == "https" and u.netloc == "esm.sh" and u.hostname == "esm.sh"
                and u.port is None and u.username is None and u.password is None
                and not u.fragment and u.path.startswith("/")
                and not any(ord(c) < 33 or ord(c) > 126 for c in value))
    except (ValueError, TypeError):
        return False

def load_plan(path):
    raw = Path(path).read_bytes()
    if digest(raw) != EXPECTED_PLAN_SHA256:
        raise ValueError("PLAN_HASH_MISMATCH")
    p = json.loads(raw)
    rows = p["rows"]
    if (p["repository"] != REPOSITORY or p["head_branch"] != HEAD_BRANCH
            or len(rows) != 68 or len({r["url"] for r in rows}) != 68
            or p["limits"] != {"deadline_seconds_per_item":10, "accepted_body_bytes":1048576,
                "concurrency":2, "http_retry":0, "logical_items":68, "canonical_items":63,
                "alias_items":5, "wire_get_max":73, "sticky_stop":True}
            or p["deployment_authorized"] is not False or p["production_changed"] is not False):
        raise ValueError("PLAN_SCOPE_INVALID")
    canonical = {r["url"]:r for r in rows if r["kind"] == "CANONICAL_SOURCE"}
    aliases = [r for r in rows if r["kind"] == "EXACT_REDIRECT_EDGE"]
    if len(canonical) != 63 or len(aliases) != 5:
        raise ValueError("PLAN_COUNTS_INVALID")
    for row in rows:
        if not safe_url(row["url"]) or not safe_url(row["canonical"]) or not HEX64.fullmatch(row["sha256"]):
            raise ValueError("PLAN_URL_OR_HASH_INVALID")
        if not isinstance(row["bytes"], int) or not 0 < row["bytes"] <= BODY_MAX:
            raise ValueError("PLAN_BYTES_INVALID")
        if row["canonical"] not in canonical:
            raise ValueError("PLAN_TARGET_INVALID")
        target = canonical[row["canonical"]]
        if row["sha256"] != target["sha256"] or row["bytes"] != target["bytes"]:
            raise ValueError("PLAN_TARGET_BODY_INVALID")
        if (row["kind"] == "CANONICAL_SOURCE") != (row["url"] == row["canonical"]):
            raise ValueError("PLAN_EDGE_INVALID")
    return p

def validate_context(c):
    if (c["event"] != "pull_request" or c["action"] != "opened"
            or c["repository"] != REPOSITORY or c["head_repository"] != REPOSITORY
            or c["head_branch"] != HEAD_BRANCH or c["base_branch"] != "main"
            or c["run_number"] != "1" or c["run_attempt"] != "1"
            or not re.fullmatch(r"[1-9][0-9]*", c["run_id"])
            or not HEX40.fullmatch(c["event_head_sha"]) or c["actual_head_sha"] != c["event_head_sha"]):
        raise ValueError("CI_CONTEXT_REFUSED")

def _fail(stop, lock):
    with lock:
        stop.set()

def _authorize_wire(pipe, stop, lock, index, url):
    with lock:
        if stop.is_set():
            raise RuntimeError("STICKY_STOP_BEFORE_WIRE")
        # Registration precedes sending; at most two already-authorized items can be in flight.
        pipe.send({"type":"wire", "index":index, "url":url})

def _http_check(row, deadline, pipe, stop, lock, index):
    url = row["url"]
    redirects = []
    for hop in range(2):
        _authorize_wire(pipe, stop, lock, index, url)
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError()
        u = urlsplit(url)
        context = ssl.create_default_context()
        connection = http.client.HTTPSConnection("esm.sh", timeout=remaining, context=context)
        try:
            connection.request("GET", u.path + ("?" + u.query if u.query else ""),
                headers={"User-Agent":"Deno/2.9.2", "Accept-Encoding":"identity"})
            response = connection.getresponse()
            status = response.status
            if status in REDIRECTS:
                location = response.getheader("Location", "")
                target = urljoin(url, location)
                if (row["kind"] != "EXACT_REDIRECT_EDGE" or hop != 0 or redirects
                        or not safe_url(target) or target != row["canonical"]):
                    raise RuntimeError("UNEXPECTED_REDIRECT")
                redirects.append({"status":status, "target":target})
                url = target
                continue
            if status != 200:
                raise RuntimeError("HTTP_STATUS_" + str(status))
            if url != row["canonical"] or (row["kind"] == "EXACT_REDIRECT_EDGE" and len(redirects) != 1):
                raise RuntimeError("REDIRECT_NOT_PROVEN")
            if response.getheader("Content-Encoding", "identity").lower() != "identity":
                raise RuntimeError("UNEXPECTED_CONTENT_ENCODING")
            declared = response.getheader("Content-Length")
            if declared is not None and (not declared.isdigit() or int(declared) > BODY_MAX):
                raise RuntimeError("BODY_LIMIT_OR_LENGTH_INVALID")
            hasher = hashlib.sha256()
            size = 0
            while True:
                if time.monotonic() >= deadline:
                    raise TimeoutError()
                block = response.read(min(65536, BODY_MAX + 1 - size))
                if not block:
                    break
                size += len(block)
                if size > BODY_MAX:
                    raise RuntimeError("BODY_LIMIT")
                hasher.update(block)
            if time.monotonic() >= deadline:
                raise TimeoutError()
            actual = hasher.hexdigest()
            if actual != row["sha256"] or size != row["bytes"]:
                raise RuntimeError("BODY_FINGERPRINT_MISMATCH")
            return {"pass":True, "status":200, "bytes":size, "actual_sha256":actual,
                    "final_url":url, "redirects":redirects}
        finally:
            connection.close()
    raise RuntimeError("REDIRECT_LIMIT")

def _worker(index, row, deadline, pipe, stop, lock, transport):
    started = time.monotonic()
    try:
        data = transport(row, deadline, pipe, stop, lock, index)
    except BaseException as error:
        _fail(stop, lock)
        name = str(error) if type(error) is RuntimeError else type(error).__name__
        # Never serialize exception text, response headers, bodies, or environment data.
        if not re.fullmatch(r"[A-Z0-9_]{1,80}", name):
            name = type(error).__name__
        data = {"pass":False, "status":"FAILED", "error":name}
    data.update(index=index, elapsed_ms=round((time.monotonic()-started)*1000))
    pipe.send({"type":"result", "data":data})
    pipe.close()

def run_plan(rows, transport=_http_check, deadline_seconds=10, concurrency=2):
    # Linux hosted runner only. Per-item child termination also bounds blocking DNS/read.
    context = mp.get_context("fork")
    stop, lock = context.Event(), context.Lock()
    active, results, wires = {}, [], []
    cursor = 0
    while active or (cursor < len(rows) and not stop.is_set()):
        while cursor < len(rows) and len(active) < concurrency and not stop.is_set():
            index = cursor
            cursor += 1
            parent, child = context.Pipe(duplex=False)
            started = time.monotonic()
            process = context.Process(target=_worker,
                args=(index, rows[index], started+deadline_seconds, child, stop, lock, transport))
            process.start()
            child.close()
            active[parent] = (process, index, started)
        for pipe in wait(list(active), timeout=0.005) if active else []:
            try:
                event = pipe.recv()
            except EOFError:
                event = {"type":"result", "data":{"index":active[pipe][1], "pass":False,
                    "status":"FAILED", "error":"WORKER_EXIT_WITHOUT_RESULT"}}
            if event["type"] == "wire":
                wires.append({"index":event["index"], "url":event["url"]})
                continue
            process, index, started = active.pop(pipe)
            data = event["data"]
            if time.monotonic() >= started + deadline_seconds:
                data = {"index":index, "pass":False, "status":"FAILED", "error":"HARD_DEADLINE"}
            if not data["pass"]:
                _fail(stop, lock)
            results.append(data)
            process.join(timeout=0.05)
            if process.is_alive():
                process.kill()
                process.join()
            pipe.close()
        for pipe, (process, index, started) in list(active.items()):
            if time.monotonic() >= started + deadline_seconds:
                _fail(stop, lock)
                process.kill()
                process.join()
                # Wire authorizations were sent synchronously before a request; preserve queued accounting.
                while pipe.poll():
                    try:
                        event = pipe.recv()
                    except EOFError:
                        break
                    if event["type"] == "wire":
                        wires.append({"index":event["index"], "url":event["url"]})
                results.append({"index":index, "pass":False, "status":"FAILED", "error":"HARD_DEADLINE"})
                active.pop(pipe)
                pipe.close()
    return {"status":"PASS" if len(results)==len(rows) and all(r["pass"] for r in results) else "FAIL_CLOSED",
        "logical_started":cursor, "wire_get_started":len(wires),
        "wire_requests":wires, "rows":sorted(results,key=lambda r:r["index"]),
        "not_requested_count":len(rows)-cursor, "retry":0, "sticky_stop":stop.is_set()}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--execute-public-plan", action="store_true")
    for key in ["event","action","repository","head-repository","head-branch","base-branch",
                "run-id","run-number","run-attempt","event-head-sha","actual-head-sha"]:
        parser.add_argument("--"+key, required=True)
    args = parser.parse_args()
    c = {key:getattr(args,key) for key in ["event","action","repository","head_repository",
        "head_branch","base_branch","run_id","run_number","run_attempt","event_head_sha","actual_head_sha"]}
    validate_context(c)
    if not args.execute_public_plan:
        raise ValueError("EXPLICIT_EXECUTION_REQUIRED")
    if any(key in os.environ for key in FORBIDDEN_ENV):
        raise ValueError("ENVIRONMENT_NOT_SCRUBBED")
    plan = load_plan(args.plan)
    output = Path(args.output)
    output.parent.mkdir(parents=True,exist_ok=True)
    marker = output.parent / "CI_PLAN_CONSUMED.marker"
    with marker.open("x",encoding="utf-8") as file:
        file.write(plan["plan_id"]+"\n")
    started = time.time()
    report = run_plan(plan["rows"])
    report.update(schema="C_WORKER_NEW_INDEPENDENT_CI_SDK_FRESHNESS_RECEIPT_V1",
        plan_id=plan["plan_id"], context=c, started_unix=started, finished_unix=time.time(),
        plan_sha256=digest(Path(args.plan).read_bytes()),
        checker_sha256=digest(Path(__file__).read_bytes()),
        workflow_sha256=digest(Path(plan["workflow_path"]).read_bytes()),
        prior_local_fail_receipt_sha256=plan["prior_local_fail_receipt_sha256"],
        prior_local_status_preserved="FAIL_CLOSED", limits=plan["limits"],
        user_agent=plan["user_agent"], production_calls=0, deployment_authorized=False,
        source_or_sdk_modified=False, remote_body_executed=False,
        validity="Only these bytes at this CI time/context; not Supabase resolution or deployed ESZIP identity.",
        once_scope="First opened event for this fixed workflow identity only; no rename/delete/recreate/rearm.")
    with output.open("x",encoding="utf-8") as file:
        json.dump(report,file,indent=2)
        file.write("\n")
    print(json.dumps({k:report[k] for k in ["status","plan_id","logical_started",
        "wire_get_started","not_requested_count","plan_sha256","checker_sha256"]}))
    return 0 if report["status"] == "PASS" else 1

if __name__ == "__main__":
    sys.exit(main())
