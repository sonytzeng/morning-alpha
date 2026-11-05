import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('audit',ROOT/'scripts/operations/retained-research-audit.py')
audit=importlib.util.module_from_spec(spec);spec.loader.exec_module(audit)
D=audit.D

def bars():
    return [{'date':f'2026-01-{i:02d}','open':D(100),'high':D(102),
             'low':D(98),'close':D(101),'volume':D(1_000_000),'amount':D(100_000_000)} for i in range(1,21)]

def eps():
    return [{'kind':'EPS','basis':'SINGLE_QUARTER','period':p,'values':{
        'value':v,'measurement_basis':'BASIC','unit':'TWD_PER_COMMON_SHARE'}}
        for p,v in zip(['2025-Q4','2026-Q1','2026-Q2','2026-Q3'],[1.01,2.02,3.03,4.04])]

class ResearchAuditTest(unittest.TestCase):
    def test_tick_boundaries_and_strict_trigger(self):
        for p,n in [('9.99','10'),('10','10.05'),('49.99','50'),('50','50.1'),
                    ('99.99','100'),('100','100.5'),('499.9','500'),('500','501'),('999.9','1000'),('1000','1005')]:
            self.assertEqual(audit.next_tick(D(p)),D(n))
        self.assertEqual(audit.floor_tick(D('273.618')),D('273.5'))

    def test_missing_or_repeated_session_is_rejected(self):
        b=bars()
        for invalid in [b[:-1],b[:-1]+[b[0]]]:
            with self.assertRaises(ValueError):audit.metrics(invalid)

    def test_invalid_prices_do_not_produce_signals(self):
        for field,value in [('close',D('NaN')),('volume',D(0)),('high',D(97))]:
            b=bars();b[-1][field]=value
            with self.assertRaises(ValueError):audit.metrics(b)

    def test_true_range_and_activity_are_not_mislabeled(self):
        m=audit.metrics(bars())
        self.assertEqual(m['atr19'],4)
        self.assertEqual(m['volume_ratio'],1)
        self.assertEqual(m['amount_ratio'],1)
        self.assertEqual(m['close_location'],D('.75'))

    def test_eps_requires_four_consecutive_same_basis_quarters(self):
        self.assertEqual(audit.quarterly_eps(eps())[1],D('10.10'))
        invalids=[eps()[:-1],eps(),eps(),eps()]
        invalids[1][1]['values']['measurement_basis']='DILUTED'
        invalids[2][1]['period']='2025-Q3'
        invalids[3][0]['kind']='EPS_AS_REPORTED'
        for invalid in invalids:self.assertIsNone(audit.quarterly_eps(invalid)[1])

    def test_negative_revenue_and_missing_peers_cannot_pass(self):
        _,ps=audit.scenarios(bars(),{'yoy_percent':D(20),'mom_percent':D(-1)},D('.2'),None,'TWSE')
        self.assertTrue(all('最新營收年增或月增為負' in p['failed'] for p in ps))
        self.assertIn('原產業不足三家可比同業',ps[-1]['failed'])
        self.assertTrue(all(not p['actionable'] and not p['method_validated'] for p in ps))

    def test_inspection_does_not_modify_inputs_or_invent_order_geometry(self):
        b=bars();before=copy.deepcopy(b)
        _,ps=audit.scenarios(b,{'yoy_percent':D(20),'mom_percent':D(2)},D('.2'),D('.1'),'TWSE')
        self.assertEqual(b,before)
        self.assertTrue(all(p['historical_range'] is None for p in ps[:2]))

    def test_quote_bytes_require_matching_receipt_and_date(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);raw=json.dumps({'stat':'OK','date':'20261030','tables':[]}).encode()
            (root/'twse_quotes.json').write_bytes(raw)
            receipt={'sha256':audit.sha(raw),'bytes':len(raw),'http_status':200}
            (root/'twse_quotes.receipt.json').write_text(json.dumps(receipt))
            with self.assertRaisesRegex(ValueError,'QUOTE_DATE'):audit.parse_latest_quotes(root,set())
            (root/'twse_quotes.json').write_bytes(raw+b' ')
            with self.assertRaisesRegex(ValueError,'QUOTE_RECEIPT_MISMATCH'):audit.parse_latest_quotes(root,set())

if __name__=='__main__':unittest.main()
