"""Offline fakes only. Never initiates any HTTP/TLS/DNS request."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
P=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("sdk_checker",P/"sdk_public_freshness.py")
c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
BODY=b"fixed public fixture"
CANONICAL="https://esm.sh/fixed@1.0.0"
ALIAS="https://esm.sh/fixed@^1.0.0"
ROW={"url":CANONICAL,"canonical":CANONICAL,"kind":"CANONICAL_SOURCE",
     "sha256":hashlib.sha256(BODY).hexdigest(),"bytes":len(BODY)}
class Pipe:
    def __init__(self):self.events=[]
    def send(self,event):self.events.append(event)
class Response:
    def __init__(self,status=200,headers=None,body=BODY):
        self.status=status;self.headers=headers or {};self.body=body;self.position=0
    def getheader(self,key,default=None):return self.headers.get(key,default)
    def read(self,n):
        value=self.body[self.position:self.position+n];self.position+=len(value);return value
def invoke(row,responses,stop=None):
    pipe=Pipe();stop=stop or threading.Event();lock=threading.Lock()
    class Connection:
        def __init__(self,*a,**k):pass
        def request(self,method,path,headers):
            if method!="GET" or headers!={"User-Agent":"Deno/2.9.2","Accept-Encoding":"identity"}:
                raise AssertionError("request scope")
        def getresponse(self):return responses.pop(0)
        def close(self):pass
    with patch.object(c.http.client,"HTTPSConnection",Connection):
        result=c._http_check(row,time.monotonic()+1,pipe,stop,lock,0)
    return result,pipe
def fake_success(row,deadline,pipe,stop,lock,index):
    c._authorize_wire(pipe,stop,lock,index,row["url"])
    if row["kind"]=="EXACT_REDIRECT_EDGE":
        c._authorize_wire(pipe,stop,lock,index,row["canonical"])
    return {"pass":True,"status":200}
def fake_failure(row,deadline,pipe,stop,lock,index):
    c._authorize_wire(pipe,stop,lock,index,row["url"])
    if index==0:raise RuntimeError("EXPECTED_OFFLINE_FAILURE")
    time.sleep(.01)
    return {"pass":True,"status":200}
def fake_hang(row,deadline,pipe,stop,lock,index):
    c._authorize_wire(pipe,stop,lock,index,row["url"]);time.sleep(2)
    return {"pass":True,"status":200}
class Checks(unittest.TestCase):
    def context(self):
        return {"event":"pull_request","action":"opened","repository":c.REPOSITORY,
            "head_repository":c.REPOSITORY,"head_branch":c.HEAD_BRANCH,"base_branch":"main",
            "run_id":"1234","run_number":"1","run_attempt":"1",
            "event_head_sha":"a"*40,"actual_head_sha":"a"*40}
    def test_exact_plan(self):
        p=c.load_plan(P/"sdk-freshness-plan.json")
        self.assertEqual(len(p["rows"]),68)
        self.assertEqual(sum(1+(r["kind"]=="EXACT_REDIRECT_EDGE") for r in p["rows"]),73)
    def test_plan_tamper(self):
        with tempfile.TemporaryDirectory() as directory:
            f=Path(directory)/"plan.json";f.write_bytes((P/"sdk-freshness-plan.json").read_bytes()+b" ")
            with self.assertRaisesRegex(ValueError,"PLAN_HASH"):c.load_plan(f)
    def test_context_positive(self):c.validate_context(self.context())
    def test_context_reject_rerun(self):
        x=self.context();x["run_attempt"]="2"
        with self.assertRaisesRegex(ValueError,"CI_CONTEXT"):c.validate_context(x)
    def test_context_reject_new_run2(self):
        x=self.context();x["run_number"]="2"
        with self.assertRaisesRegex(ValueError,"CI_CONTEXT"):c.validate_context(x)
    def test_context_reject_other_event(self):
        x=self.context();x["event"]="pull_request_target"
        with self.assertRaisesRegex(ValueError,"CI_CONTEXT"):c.validate_context(x)
    def test_context_reject_other_branch(self):
        x=self.context();x["head_branch"]="other"
        with self.assertRaisesRegex(ValueError,"CI_CONTEXT"):c.validate_context(x)
    def test_context_reject_fork(self):
        x=self.context();x["head_repository"]="attacker/morning-alpha"
        with self.assertRaisesRegex(ValueError,"CI_CONTEXT"):c.validate_context(x)
    def test_context_reject_different_head(self):
        x=self.context();x["actual_head_sha"]="b"*40
        with self.assertRaisesRegex(ValueError,"CI_CONTEXT"):c.validate_context(x)
    def test_context_reject_synchronize(self):
        x=self.context();x["action"]="synchronize"
        with self.assertRaisesRegex(ValueError,"CI_CONTEXT"):c.validate_context(x)
    def test_fixed_public_url_only(self):
        for value in ["http://esm.sh/a","https://esm.sh:443/a","https://esm.sh.evil/a",
                      "https://name:secret@esm.sh/a","https://esm.sh/a#fragment",
                      "https://cttfzgvhiewfckydcrci.supabase.co/a","https://127.0.0.1/a"]:
            self.assertFalse(c.safe_url(value),value)
    def test_direct_body_match(self):
        result,pipe=invoke(ROW,[Response()]);self.assertTrue(result["pass"]);self.assertEqual(len(pipe.events),1)
    def test_alias_exact_one_hop(self):
        row={**ROW,"url":ALIAS,"kind":"EXACT_REDIRECT_EDGE"}
        result,pipe=invoke(row,[Response(302,{"Location":CANONICAL}),Response()])
        self.assertTrue(result["pass"]);self.assertEqual(len(pipe.events),2)
    def test_canonical_redirect_refused(self):
        with self.assertRaisesRegex(RuntimeError,"UNEXPECTED_REDIRECT"):
            invoke(ROW,[Response(302,{"Location":CANONICAL})])
    def test_alias_wrong_target_refused(self):
        row={**ROW,"url":ALIAS,"kind":"EXACT_REDIRECT_EDGE"}
        with self.assertRaisesRegex(RuntimeError,"UNEXPECTED_REDIRECT"):
            invoke(row,[Response(302,{"Location":"https://evil.invalid/a"})])
    def test_alias_second_hop_refused(self):
        row={**ROW,"url":ALIAS,"kind":"EXACT_REDIRECT_EDGE"}
        with self.assertRaisesRegex(RuntimeError,"UNEXPECTED_REDIRECT"):
            invoke(row,[Response(302,{"Location":CANONICAL}),Response(302,{"Location":CANONICAL})])
    def test_alias_without_redirect_refused(self):
        row={**ROW,"url":ALIAS,"kind":"EXACT_REDIRECT_EDGE"}
        with self.assertRaisesRegex(RuntimeError,"REDIRECT_NOT_PROVEN"):invoke(row,[Response()])
    def test_oversized_declared_body_refused(self):
        with self.assertRaisesRegex(RuntimeError,"BODY_LIMIT"):
            invoke(ROW,[Response(headers={"Content-Length":str(c.BODY_MAX+1)})])
    def test_stream_oversize_refused(self):
        with self.assertRaisesRegex(RuntimeError,"BODY_LIMIT"):
            invoke(ROW,[Response(body=b"x"*(c.BODY_MAX+1))])
    def test_hash_mismatch_refused(self):
        with self.assertRaisesRegex(RuntimeError,"FINGERPRINT"):invoke(ROW,[Response(body=b"wrong")])
    def test_compression_refused(self):
        with self.assertRaisesRegex(RuntimeError,"CONTENT_ENCODING"):
            invoke(ROW,[Response(headers={"Content-Encoding":"gzip"})])
    def test_http_denial_refused(self):
        with self.assertRaisesRegex(RuntimeError,"HTTP_STATUS_403"):invoke(ROW,[Response(403)])
    def test_sticky_stop_before_redirect(self):
        stop=threading.Event()
        class StopResponse(Response):
            def getheader(self,key,default=None):
                if key=="Location":stop.set()
                return super().getheader(key,default)
        with self.assertRaisesRegex(RuntimeError,"STICKY_STOP"):
            invoke({**ROW,"url":ALIAS,"kind":"EXACT_REDIRECT_EDGE"},
                [StopResponse(302,{"Location":CANONICAL})],stop)
    def test_coordinator_wire_count73(self):
        plan=c.load_plan(P/"sdk-freshness-plan.json")
        result=c.run_plan(plan["rows"],transport=fake_success,deadline_seconds=2)
        self.assertEqual(result["status"],"PASS");self.assertEqual(result["logical_started"],68)
        self.assertEqual(result["wire_get_started"],73)
    def test_failure_stops_new_items(self):
        result=c.run_plan([ROW]*8,transport=fake_failure,deadline_seconds=1)
        self.assertEqual(result["status"],"FAIL_CLOSED")
        self.assertLessEqual(result["logical_started"],2);self.assertLessEqual(result["wire_get_started"],2)
        self.assertGreaterEqual(result["not_requested_count"],6);self.assertEqual(result["retry"],0)
    def test_blocking_call_hard_deadline(self):
        start=time.monotonic()
        result=c.run_plan([ROW]*4,transport=fake_hang,deadline_seconds=.05)
        self.assertLess(time.monotonic()-start,.5)
        self.assertEqual(result["status"],"FAIL_CLOSED")
        self.assertTrue(all(x["error"]=="HARD_DEADLINE" for x in result["rows"]))
        self.assertLessEqual(result["logical_started"],2)
if __name__=="__main__":unittest.main()
