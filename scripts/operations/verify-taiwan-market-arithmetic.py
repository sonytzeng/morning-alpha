#!/usr/bin/env python3
"""Independently recalculate an immutable Taiwan market research run.

This verifier uses Python's standard library and Decimal arithmetic. It never
imports a JavaScript calculator, invokes a subprocess, fetches a source, writes
to a database, or changes a run/cache. An optional retained capture cache lets
it re-read the exact JSON/CSV rows used by the arithmetic. It does not certify
investment suitability, historical performance, source rights, HTML unit
definitions, or the completeness of corporate-action inventories.
"""

from __future__ import annotations

import argparse
import calendar
import csv
import hashlib
import io
import json
import re
import sys
import time
from collections import Counter, defaultdict
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation, localcontext
from pathlib import Path


VERSION = "TAIWAN_INDEPENDENT_ARITHMETIC_PYTHON_V1"
SHORT = "OBSERVED_UNADJUSTED_20_SESSION_RANGE"
MEDIUM_PE = "CURRENT_PRICE_TIMES_PEER_PE_DIVIDED_BY_CURRENT_OFFICIAL_PE"
MEDIUM_PB = "CURRENT_PRICE_TIMES_PEER_PB_DIVIDED_BY_CURRENT_OFFICIAL_PB"
LONG_PB = "CURRENT_PRICE_TIMES_QUALITY_MATCHED_PEER_PB_DIVIDED_BY_CURRENT_OFFICIAL_PB"
BVPS_MEDIUM = "CURRENT_REPORTED_BVPS_TIMES_PEER_DERIVED_PB"
BVPS_LONG = "CURRENT_REPORTED_BVPS_TIMES_QUALITY_MATCHED_PEER_DERIVED_PB"
METHODS = {SHORT, MEDIUM_PE, MEDIUM_PB, LONG_PB, BVPS_MEDIUM, BVPS_LONG}
QUANTILES = (Decimal("0.25"), Decimal("0.5"), Decimal("0.75"))
ABS_TOL = Decimal("1e-9")
REL_TOL = Decimal("1e-12")
FIELDS = {
    "net_profit": ("本期淨利（淨損）", "本期淨利(淨損)", "本期稅後淨利（淨損）"),
    "parent_net_profit": ("淨利（淨損）歸屬於母公司業主", "淨利（損）歸屬於母公司業主"),
    "equity": ("權益總計", "權益總額"),
    "assets": ("資產總計", "資產總額"),
    "operating_cashflow": ("營業活動之淨現金流入（流出）", "營業活動之淨現金流入(流出)", "營業活動之淨現金流量"),
    "cash_opening": ("期初現金及約當現金餘額",),
    "cash_closing": ("期末現金及約當現金餘額",),
    "cash_change": ("本期現金及約當現金增加（減少）數", "本期現金及約當現金增加(減少)數"),
}
PRICE_FIELDS = {
    "open": ("開盤價", "開盤", "OpeningPrice", "Open"),
    "high": ("最高價", "最高", "HighestPrice", "High"),
    "low": ("最低價", "最低", "LowestPrice", "Low"),
    "close": ("收盤價", "收盤", "ClosingPrice", "Close"),
    "volume": ("成交股數", "TradeVolume", "TradingShares"),
    "amount": ("成交金額", "成交金額(元)", "TradeValue", "TransactionAmount"),
    "pe": ("本益比", "PriceEarningRatio", "PEratio"),
    "pb": ("股價淨值比", "PriceBookRatio", "PBratio"),
}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def load_json(data):
    return json.loads(data, parse_float=Decimal, parse_constant=lambda x: (_ for _ in ()).throw(ValueError(x)))


def canonical(value):
    """Sorted compact UTF-8 JSON; source-row values are strings/integers.

    Finite numeric support also permits checking full normalized balance
    records. This is not used to claim a cross-language hash of all expanded
    floating-point research references: the actual run file bytes bind those.
    """
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, (int, Decimal)):
        n = Decimal(value)
        if not n.is_finite():
            raise ValueError("Nonfinite canonical number")
        if not n:
            return "0"
        if Decimal("1e-6") <= abs(n) < Decimal("1e21"):
            s = format(n, "f")
            return s.rstrip("0").rstrip(".") if "." in s else s
        mantissa, exponent = format(n.normalize(), "e").split("e")
        return mantissa + "e" + ("+" if int(exponent) >= 0 else "-") + str(abs(int(exponent)))
    if isinstance(value, list):
        return "[" + ",".join(canonical(v) for v in value) + "]"
    if isinstance(value, dict):
        return "{" + ",".join(canonical(k) + ":" + canonical(value[k]) for k in sorted(value)) + "}"
    raise TypeError(type(value).__name__)


def hash_json(value):
    return sha(canonical(value).encode("utf-8"))


def number(value):
    if value is None or isinstance(value, bool):
        return None
    text = str(value).strip().replace(",", "")
    if text in {"", "-", "--", "－", "—", "N/A", "null"}:
        return None
    if text.startswith("(") and text.endswith(")"):
        text = "-" + text[1:-1]
    try:
        result = Decimal(text)
        return result if result.is_finite() else None
    except InvalidOperation:
        return None


def norm(value):
    return re.sub(r"\s+", "", str(value))


def field(fields, names):
    values = {norm(k): v for k, v in fields.items()}
    for key in names:
        if norm(key) in values:
            return values[norm(key)]
    return None


def parse_date(value):
    if value is None:
        return None
    text = str(value).strip()
    if re.fullmatch(r"\d{7,8}", text):
        year, month, day = int(text[:-4]), int(text[-4:-2]), int(text[-2:])
    else:
        match = re.fullmatch(r"(\d{3,4})[-/](\d{1,2})[-/](\d{1,2})", text)
        if not match:
            return None
        year, month, day = map(int, match.groups())
    if year < 1911:
        year += 1911
    try:
        return date(year, month, day).isoformat()
    except ValueError:
        return None


def quarter_end(period):
    match = re.fullmatch(r"(\d{4})Q([1-4])", str(period))
    if not match:
        raise ValueError("Explicit financial quarter required")
    year, quarter = map(int, match.groups())
    month = quarter * 3
    return date(year, month, calendar.monthrange(year, month)[1])


def timestamp(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def r7(values, probability):
    """R type-7 quantile, evaluated with decimal weighted interpolation."""
    ordered = sorted(values)
    if not ordered or not Decimal(0) <= probability <= Decimal(1):
        raise ValueError("Quantile input")
    rank = (len(ordered) - 1) * probability
    lower = int(rank)
    fraction = rank - lower
    if not fraction:
        return ordered[lower]
    return ordered[lower] * (1 - fraction) + ordered[lower + 1] * fraction


def short_values(bars):
    if len(bars) < 20:
        raise ValueError("Twenty observed sessions required")
    bars = [{key: number(bar[key]) for key in ("high", "low", "close")} for bar in bars[-20:]]
    last20 = bars
    ranges = []
    for previous, current in zip(bars[-15:-1], bars[-14:]):
        ranges.append(max(current["high"] - current["low"], abs(current["high"] - previous["close"]), abs(current["low"] - previous["close"])))
    return [min(b["low"] for b in last20), max(b["high"] for b in last20)], bars[-1]["close"], sum(ranges) / 14


class Verification:
    def __init__(self, run, cache):
        self.run = run.resolve()
        self.cache = cache.resolve() if cache else None
        self.file_bindings = {}
        self.errors = []
        self.error_count = 0
        self.error_codes = Counter()
        self.method_stats = {}
        self.context = {"phase": "INPUTS"}
        self.failed_references = set()
        self.stats = Counter()
        self.pool_memo = {}
        self.pool_active = set()
        self.packets = {}
        self.raw_claims = defaultdict(dict)
        self.observed = set()
        self.quality_memo = {}
        self.balance_memo = {}
        self.raw_hashes = []
        self.raw_source_counts = Counter()

    def read(self, path):
        path = path.resolve()
        data = path.read_bytes()
        self.file_bindings[str(path)] = {"bytes": len(data), "sha256": sha(data)}
        return load_json(data)

    def check(self, condition, code, **details):
        self.stats["checks"] += 1
        if condition:
            return True
        self.error_count += 1
        self.error_codes[code] += 1
        if "horizon" in self.context:
            self.failed_references.add((self.context.get("security_id"), self.context["horizon"]))
        if len(self.errors) < 100:
            self.errors.append({**self.context, "code": code, **details})
        return False

    def equal(self, actual, expected, label):
        return self.check(actual == expected, "VALUE_OR_IDENTITY_MISMATCH", field=label, expected=expected, actual=actual)

    def numeric(self, actual, expected, label):
        a, e = number(actual), number(expected)
        if a is None or e is None:
            return self.equal(a, e, label)
        error = abs(a - e)
        relative = error / abs(e) if e else error
        self.stats["numeric_checks"] += 1
        method = self.context.get("method")
        if method:
            stat = self.method_stats[method]
            stat["numeric_checks"] += 1
            if error > stat["max_absolute_error"]:
                stat["max_absolute_error"] = error
                stat["max_error_location"] = {"security_id": self.context["security_id"], "field": label}
            stat["max_relative_error"] = max(relative, stat["max_relative_error"])
            if label.startswith("price_scenarios") or label.startswith("range") or label == "current_price":
                stat["price_value_checks"] += 1
                stat["max_price_absolute_error"] = max(error, stat["max_price_absolute_error"])
            if label.startswith("multiple_scenarios"):
                stat["max_quantile_absolute_error"] = max(error, stat["max_quantile_absolute_error"])
        return self.check(error <= ABS_TOL + REL_TOL * abs(e), "NUMERIC_MISMATCH", field=label, expected=str(e), actual=str(a), absolute_error=str(error))

    def expand(self, item, depth=0):
        if depth > 40:
            raise ValueError("Input-pool nesting exceeds 40")
        if isinstance(item, dict) and "$price_input_ref" in item:
            if set(item) != {"$price_input_ref"}:
                raise ValueError("Mixed input-pool reference")
            key = item["$price_input_ref"]
            if key not in self.pool_memo:
                if key in self.pool_active or key not in self.pool:
                    raise ValueError("Cyclic or missing input-pool node: " + key)
                self.pool_active.add(key)
                self.pool_memo[key] = self.expand(self.pool[key], depth + 1)
                self.pool_active.remove(key)
            return self.pool_memo[key]
        if isinstance(item, dict):
            return {k: self.expand(v, depth + 1) for k, v in item.items()}
        if isinstance(item, list):
            return [self.expand(v, depth + 1) for v in item]
        return item

    @staticmethod
    def capture_key(capture):
        return capture.get("capture_id"), capture.get("source_row_hash")

    def load_packets(self):
        for path in sorted((self.run / "shards").glob("shard-*.json")):
            shard = self.read(path)
            for stock in shard["stocks"]:
                sid = stock["security_id"]
                self.context = {"phase": "PACKET_INPUT", "security_id": sid}
                self.check(sid not in self.packets, "DUPLICATE_PACKET")
                packet = stock["packet"]
                self.equal(packet["cutoff"], self.manifest["cutoff"], "packet.cutoff")
                view = {"by_capture": defaultdict(list), "history": [], "identity": None, "references": stock["research_references"]}
                for evidence in packet["evidence"]:
                    content = evidence["content"]
                    self.equal(sha(content.encode("utf-8")), evidence["evidence_hash"], "evidence_hash")
                    body = load_json(content)
                    schema = body.get("schema")
                    if schema not in {"TAIWAN_MARKET_HISTORY_OBSERVATION_V1", "TAIWAN_MARKET_OBSERVATION_V1", "TAIWAN_FINANCIAL_HISTORY_OBSERVATION_V1"}:
                        continue
                    family = body.get("family") or body.get("kind", "").removesuffix("_HISTORY")
                    if family not in {"PRICE", "VALUATION", "ROSTER", "INCOME", "BALANCE", "CASHFLOW"}:
                        continue
                    body["_evidence_available_at"] = evidence["available_at"]
                    body["_family"] = family
                    if body.get("source_capture"):
                        view["by_capture"][self.capture_key(body["source_capture"])].append(body)
                    if family == "ROSTER":
                        self.check(view["identity"] is None, "AMBIGUOUS_ROSTER")
                        view["identity"] = body
                    if schema == "TAIWAN_MARKET_HISTORY_OBSERVATION_V1":
                        view["history"].append(body)
                view["history"].sort(key=lambda b: b["date"])
                self.packets[sid] = view
            self.stats["shards"] += 1
        self.stats["packets"] = len(self.packets)

    def observe(self, sid, capture, family, historical=False):
        candidates = self.packets[sid]["by_capture"].get(self.capture_key(capture), [])
        matches = [o for o in candidates if o["_family"] == family and (o["schema"] == "TAIWAN_MARKET_HISTORY_OBSERVATION_V1") == historical]
        if not self.check(len(matches) == 1, "EXACT_PACKET_SOURCE_REQUIRED", source_capture=capture, family=family, matches=len(matches)):
            raise ValueError("Reference has no unambiguous packet source")
        observation = matches[0]
        self.equal(capture, observation["source_capture"], "reference.source_capture")
        self.equal(observation.get("symbol"), sid.split(":", 1)[1], "source.symbol")
        self.equal(observation.get("market"), sid.split(":", 1)[0], "source.market")
        key = (sid, observation["schema"], family, *self.capture_key(capture))
        if key not in self.observed:
            self.observed.add(key)
            self.check(timestamp(observation["_evidence_available_at"]) <= timestamp(self.manifest["cutoff"]), "SOURCE_AFTER_CUTOFF")
            self.check(timestamp(capture["received_at"]) <= timestamp(self.manifest["cutoff"]), "CAPTURE_AFTER_CUTOFF")
            self.queue_raw(sid, observation)
        return observation

    def queue_raw(self, sid, observation):
        capture = observation["source_capture"]
        key = (sid, observation.get("schema"), observation.get("kind"), capture["source_row_hash"])
        self.raw_claims[capture["capture_id"]][key] = (sid, observation)

    def identity(self, sid):
        value = self.packets[sid]["identity"]
        if value is None:
            raise ValueError("No roster identity for " + sid)
        return self.observe(sid, value["source_capture"], "ROSTER")

    def cohort(self, sid, other_sid, market, industry):
        self.check(other_sid != sid, "ISSUER_INCLUDED_AS_PEER")
        other = self.identity(other_sid)
        self.equal(other["market"], market, "peer.market")
        self.equal(other["industry_code"], industry, "peer.industry_code")
        self.equal(other["instrument_kind"], "ORDINARY_COMPANY_EQUITY", "peer.instrument_kind")

    def quality(self, sid, quality):
        key = (sid, id(quality))
        if key in self.quality_memo:
            self.check(self.quality_memo[key], "SHARED_ANNUAL_QUALITY_INVALID")
            return
        before = self.error_count
        self.stats["unique_annual_quality_objects"] += 1
        years = list(range(int(self.manifest["cutoff"][:4]) - 3, int(self.manifest["cutoff"][:4])))
        annuals = quality.get("annuals", [])
        self.equal([a.get("year") for a in annuals], years, "annual_quality.years")
        ocfs, parents = [], []
        previous_closing = None
        for annual in annuals:
            year = annual["year"]
            sources = annual["source_captures"]
            observations = {family: self.observe(sid, sources[family.lower()], family) for family in ("INCOME", "BALANCE", "CASHFLOW")}
            for family, obs in observations.items():
                self.equal(obs["period"], f"{year}Q4", "annual.period")
                self.equal(obs["amount_unit"], "TWD_THOUSANDS", "annual.amount_unit")
                self.equal(obs["period_basis"], "POINT_IN_TIME_AS_REPORTED" if family == "BALANCE" else "YTD_AS_REPORTED", "annual.period_basis")
            values = {}
            for name in ("net_profit", "parent_net_profit", "equity", "assets", "operating_cashflow"):
                family = "INCOME" if "profit" in name else "CASHFLOW" if name == "operating_cashflow" else "BALANCE"
                values[name] = number(field(observations[family]["fields"], FIELDS[name]))
                self.numeric(annual.get(name), values[name], "annual." + str(year) + "." + name)
            self.check(values["net_profit"] is not None and values["net_profit"] > 0, "ANNUAL_NET_PROFIT_NOT_POSITIVE")
            self.check(values["parent_net_profit"] is None or values["parent_net_profit"] >= 0, "REPORTED_PARENT_LOSS")
            self.check(values["equity"] is not None and values["assets"] is not None and 0 < values["equity"] <= values["assets"], "ANNUAL_EQUITY_ASSETS_CONDITION")
            self.equal(annual["period_verified"], True, "annual.period_verified")
            self.equal(annual["unit_verified"], True, "annual.unit_verified")
            cf = observations["CASHFLOW"]["fields"]
            opening, closing, change = (number(field(cf, FIELDS[k])) for k in ("cash_opening", "cash_closing", "cash_change"))
            within = None if None in (opening, closing, change) else abs(opening + change - closing) <= 2
            across = None if opening is None or previous_closing is None else abs(opening - previous_closing) <= 2
            reconciliation = annual["cashflow_reconciliation"]
            self.equal(reconciliation["within_year"], within, "annual.within_year")
            self.equal(reconciliation["opening_matches_previous_closing"], across, "annual.cash_bridge")
            self.numeric(reconciliation["tolerance_twd_thousands"], 2, "annual.cash_bridge_tolerance")
            self.check(within is not False and across is not False, "CASHFLOW_RECONCILIATION_FAILED")
            previous_closing = closing
            ocfs.append(values["operating_cashflow"])
            parents.append((year, values["parent_net_profit"]))
        complete = len(ocfs) == 3 and all(v is not None for v in ocfs)
        self.check(complete, "THREE_OBSERVED_OCF_YEARS_REQUIRED")
        if complete:
            self.numeric(quality["operating_cashflow_sum"], sum(ocfs), "quality.operating_cashflow_sum")
            self.check(sum(ocfs) > 0 and sum(v > 0 for v in ocfs) >= 2, "THREE_YEAR_OCF_QUALITY_CONDITION")
        self.equal(quality.get("eligible"), True, "quality.eligible")
        self.equal(quality.get("reasons"), [], "quality.reasons")
        disclosure = quality.get("parent_profit_disclosure", {})
        self.equal(disclosure.get("reported_years"), sum(v is not None for _, v in parents), "quality.parent_reported_years")
        self.equal(disclosure.get("missing_years"), [y for y, v in parents if v is None], "quality.parent_missing_years")
        self.quality_memo[key] = self.error_count == before

    def short(self, sid, ref):
        bars = self.packets[sid]["history"]
        self.check(len(bars) >= 61, "SHORT_61_SOURCE_SESSIONS_REQUIRED")
        self.equal(len({b["date"] for b in bars}), len(bars), "history.unique_dates")
        self.equal(ref["through"], bars[-1]["date"], "through")
        expected_captures = {b["source_capture"]["capture_id"] for b in bars}
        self.equal(set(ref["source_capture_ids"]), expected_captures, "source_capture_ids")
        for bar in bars[-20:]:
            self.observe(sid, bar["source_capture"], "PRICE", historical=True)
            self.equal(bar.get("all_trades_session_complete"), True, "history.complete_session")
            self.check(0 < bar["low"] <= min(bar["open"], bar["close"]) <= max(bar["open"], bar["close"]) <= bar["high"], "INVALID_HISTORY_OHLC")
        prices, close, atr = short_values(bars)
        for i, value in enumerate(prices):
            self.numeric(ref["range"][i], value, "range[" + str(i) + "]")
        self.numeric(ref["current_price"], close, "current_price")
        self.numeric(ref["atr14"], atr, "atr14")

    def official(self, sid, ref, horizon):
        issuer = self.identity(sid)
        self.equal(issuer["instrument_kind"], "ORDINARY_COMPANY_EQUITY", "issuer.instrument_kind")
        metric = ref["metric"].lower()
        long = horizon == "LONG"
        if long:
            self.check(issuer["industry_code"] != "17", "LONG_FINANCIAL_SECTOR_EXCLUDED")
            captures = ref["issuer_source_captures"]
            quote_capture, value_capture = captures["quote"], captures["official_pb"]
            current_multiple = ref["current_official_pb"]
            self.quality(sid, ref["issuer_quality"])
        else:
            quote_capture, value_capture = ref["issuer_source_captures"]
            current_multiple = ref["current_multiple"]
        quote = self.observe(sid, quote_capture, "PRICE")
        valuation = self.observe(sid, value_capture, "VALUATION")
        self.numeric(ref["current_price"], quote["close"], "current_price")
        self.numeric(current_multiple, valuation[metric], "current_multiple")
        self.equal(ref["quote_date"], quote["date"], "quote_date")
        self.equal(valuation["date"], ref["quote_date"], "valuation.date")
        self.equal(valuation["financial_period"], ref["financial_period"], "valuation.financial_period")
        self.equal(ref["quote_date"], self.manifest["expected_quote_date"], "expected_quote_date")
        values = []
        for peer in ref["peers"]:
            other_sid = peer["security_id"]
            self.cohort(sid, other_sid, issuer["market"], issuer["industry_code"])
            if long:
                capture = peer["market_source_captures"]
                other_quote = self.observe(other_sid, capture["quote"], "PRICE")
                other_val = self.observe(other_sid, capture["official_pb"], "VALUATION")
                self.numeric(peer["current_price"], other_quote["close"], "peer.current_price")
                self.equal(other_quote["date"], ref["quote_date"], "peer.quote.date")
                self.equal(peer["quote_date"], other_quote["date"], "peer.quote_date")
                self.equal(peer["financial_period"], ref["financial_period"], "peer.financial_period")
                self.quality(other_sid, peer["annual_quality"])
                supplied = peer["official_pb"]
            else:
                other_val = self.observe(other_sid, peer["source_capture"], "VALUATION")
                supplied = peer["multiple"]
            self.equal(other_val["date"], ref["quote_date"], "peer.valuation.date")
            self.equal(other_val["financial_period"], ref["financial_period"], "peer.valuation.financial_period")
            actual = number(other_val[metric])
            self.check(actual is not None and actual > 0, "POSITIVE_PEER_MULTIPLE_REQUIRED")
            self.numeric(supplied, actual, "peer.multiple")
            values.append(actual)
        denominator = number(valuation[metric])
        self.check(denominator is not None and denominator > 0, "POSITIVE_ISSUER_MULTIPLE_REQUIRED")
        self.scenarios(ref, values, lambda multiple: number(quote["close"]) * multiple / denominator)

    def balance(self, sid, record, capture, period):
        key = (sid, id(record))
        if key in self.balance_memo:
            self.check(self.balance_memo[key], "SHARED_BALANCE_RECORD_INVALID")
            return number(record["fields"]["每股參考淨值"])
        before = self.error_count
        self.stats["unique_bvps_balance_records"] += 1
        self.equal(record["security_id"], sid, "balance.security_id")
        self.equal(record["family"], "BALANCE", "balance.family")
        self.equal(record["period"], period, "balance.period")
        self.equal(record["source_capture"], capture, "balance.source_capture")
        self.equal(record["period_basis"], "POINT_IN_TIME_AS_REPORTED", "balance.period_basis")
        self.equal(record["amount_unit"], "TWD_THOUSANDS", "balance.table_amount_unit")
        body = {k: v for k, v in record.items() if k != "record_hash"}
        self.equal(hash_json(body), record["record_hash"], "balance.record_hash")
        obs = self.observe(sid, capture, "BALANCE")
        self.equal(obs["period"], period, "balance.packet_period")
        self.equal(obs["fields"].get("每股參考淨值"), record["fields"].get("每股參考淨值"), "balance.packet_raw_bvps")
        self.queue_raw(sid, {**record, "schema": "FULL_BVPS_BALANCE_RECORD", "kind": "BALANCE_HISTORY", "_family": "BALANCE"})
        self.balance_memo[key] = before == self.error_count
        return number(record["fields"]["每股參考淨值"])

    def bvps(self, sid, ref, horizon):
        issuer = self.identity(sid)
        self.equal(issuer["market"], "TPEX", "issuer.market")
        self.equal(issuer["instrument_kind"], "ORDINARY_COMPANY_EQUITY", "issuer.instrument_kind")
        self.equal(ref["industry_code"], issuer["industry_code"], "issuer.industry_code")
        self.equal(ref["reported_bvps_field"], "每股參考淨值", "reported_bvps_field")
        self.equal(ref["unit_proof"]["per_share_unit"], "TWD_PER_SHARE", "bvps.per_share_unit")
        self.numeric(ref["unit_proof"]["raw_value_multiplier"], 1, "bvps.raw_multiplier")
        self.equal(ref["unit_proof"]["shares_or_par_value_inferred"], False, "bvps.no_share_inference")
        if horizon == "LONG":
            self.check(issuer["industry_code"] != "17", "LONG_FINANCIAL_SECTOR_EXCLUDED")
            self.quality(sid, ref["issuer_quality"])
        quote = self.observe(sid, ref["issuer_source_captures"]["quote"], "PRICE")
        bvps = self.balance(sid, ref["issuer_balance_record"], ref["issuer_source_captures"]["balance"], ref["financial_period"])
        self.equal(ref["issuer_balance_record_hash"], ref["issuer_balance_record"]["record_hash"], "issuer_balance_record_hash")
        self.equal(ref["reported_bvps_raw"], ref["issuer_balance_record"]["fields"]["每股參考淨值"], "reported_bvps_raw")
        self.numeric(ref["reported_bvps"], bvps, "reported_bvps")
        self.check(bvps is not None and bvps > 0, "POSITIVE_ISSUER_BVPS_REQUIRED")
        self.numeric(ref["current_price"], quote["close"], "current_price")
        self.numeric(ref["derived_pb"], number(quote["close"]) / bvps, "derived_pb")
        self.equal(ref["quote_date"], quote["date"], "quote_date")
        self.equal(ref["quote_date"], self.manifest["expected_quote_date"], "expected_quote_date")
        end = quarter_end(ref["financial_period"])
        self.equal(ref["financial_period_end"], end.isoformat(), "financial_period_end")
        self.check(0 <= (date.fromisoformat(ref["quote_date"]) - end).days <= 180, "BVPS_REPORT_AGE_EXCEEDS_180_DAYS")
        self.equal(ref["issuer_action_proof"].get("share_change_events"), [], "issuer.share_change_events")
        values = []
        for peer in ref["peers"]:
            other_sid = peer["security_id"]
            self.cohort(sid, other_sid, issuer["market"], issuer["industry_code"])
            self.equal(peer["market"], issuer["market"], "peer.market")
            self.equal(peer["industry_code"], issuer["industry_code"], "peer.industry_code")
            self.equal(peer["financial_period"], ref["financial_period"], "peer.financial_period")
            self.equal(peer["financial_period_end"], end.isoformat(), "peer.financial_period_end")
            other_quote = self.observe(other_sid, peer["source_captures"]["quote"], "PRICE")
            other_bvps = self.balance(other_sid, peer["balance_record"], peer["source_captures"]["balance"], peer["financial_period"])
            self.equal(peer["balance_record_hash"], peer["balance_record"]["record_hash"], "peer.balance_record_hash")
            self.equal(peer["reported_bvps_raw"], peer["balance_record"]["fields"]["每股參考淨值"], "peer.reported_bvps_raw")
            self.check(other_bvps is not None and other_bvps > 0, "POSITIVE_PEER_BVPS_REQUIRED")
            self.numeric(peer["reported_bvps"], other_bvps, "peer.reported_bvps")
            self.numeric(peer["current_price"], other_quote["close"], "peer.current_price")
            self.equal(other_quote["date"], ref["quote_date"], "peer.quote.date")
            self.equal(peer["quote_date"], ref["quote_date"], "peer.quote_date")
            actual = number(other_quote["close"]) / other_bvps
            self.numeric(peer["derived_pb"], actual, "peer.derived_pb")
            self.equal(peer["action_proof"].get("share_change_events"), [], "peer.share_change_events")
            if horizon == "LONG":
                self.quality(other_sid, peer["annual_quality"])
            values.append(actual)
        self.scenarios(ref, values, lambda multiple: bvps * multiple)

    def scenarios(self, ref, values, price):
        self.equal(ref["peer_count"], len(values), "peer_count")
        self.check(len(values) >= 5, "AT_LEAST_FIVE_OTHER_PEERS_REQUIRED")
        ids = [p["security_id"] for p in ref["peers"]]
        self.equal(len(set(ids)), len(ids), "peer_ids_unique")
        self.equal(ref["peer_quantiles"], list(QUANTILES), "peer_quantiles")
        self.equal(len(ref["multiple_scenarios"]), 3, "multiple_scenarios.length")
        self.equal(len(ref["price_scenarios"]), 3, "price_scenarios.length")
        for index, probability in enumerate(QUANTILES):
            multiple = r7(values, probability)
            self.numeric(ref["multiple_scenarios"][index], multiple, f"multiple_scenarios[{index}]")
            self.numeric(ref["price_scenarios"][index], price(multiple), f"price_scenarios[{index}]")

    def references(self):
        seen = set()
        for entry in self.price_research:
            sid = entry["security_id"]
            for horizon in ("SHORT", "MEDIUM", "LONG"):
                encoded = entry[horizon.lower()]
                if not encoded or (horizon != "SHORT" and encoded.get("state") != "CALCULATED_RESEARCH_ONLY"):
                    continue
                reference = self.expand(encoded)
                method = SHORT if horizon == "SHORT" else reference.get("method")
                self.context = {"phase": "REFERENCE", "security_id": sid, "horizon": horizon, "method": method}
                self.method_stats.setdefault(method, {"count": 0, "numeric_checks": 0, "price_value_checks": 0, "max_absolute_error": Decimal(0), "max_relative_error": Decimal(0), "max_price_absolute_error": Decimal(0), "max_quantile_absolute_error": Decimal(0), "max_error_location": None})["count"] += 1
                self.check(method in METHODS, "UNSUPPORTED_METHOD")
                self.check((sid, horizon) not in seen, "DUPLICATE_RESEARCH_REFERENCE")
                seen.add((sid, horizon))
                self.equal(reference["security_id"], sid, "reference.security_id")
                packet_ref = self.packets[sid]["references"][horizon]
                self.equal(packet_ref["reference_hash"], reference["reference_hash"], "packet.reference_hash")
                for key in ("buy_ready", "production_eligible", "forecast"):
                    self.equal(reference.get(key), False, key)
                try:
                    if method == SHORT:
                        self.short(sid, reference)
                    elif method in {MEDIUM_PE, MEDIUM_PB, LONG_PB}:
                        self.official(sid, reference, horizon)
                    elif method in {BVPS_MEDIUM, BVPS_LONG}:
                        self.bvps(sid, reference, horizon)
                except (KeyError, TypeError, ValueError, ArithmeticError, IndexError) as error:
                    self.check(False, "REFERENCE_CHECK_EXCEPTION", detail=str(error))
                self.stats["references"] += 1
                self.stats["references_" + horizon] += 1
                if self.stats["references"] % 500 == 0:
                    print(f"Checked {self.stats['references']} references; {self.error_count} mismatches", file=sys.stderr, flush=True)

    def raw_payload(self, entry):
        receipt = entry["receipt"]
        path = (self.cache / entry["raw"]["file"]).resolve()
        if not path.is_relative_to(self.cache):
            raise ValueError("Capture path leaves cache")
        data = path.read_bytes()
        digest = sha(data)
        self.equal(digest, receipt["sha256"], "raw.sha256")
        self.equal(digest, entry["raw"]["sha256"], "raw.object_sha256")
        self.equal(len(data), receipt["bytes"], "raw.bytes")
        self.equal(receipt.get("state"), "CAPTURED", "raw.receipt_state")
        self.equal(receipt.get("status"), 200, "raw.receipt_status")
        self.raw_hashes.append({"capture_id": self.context["capture_id"], "sha256": digest, "bytes": len(data)})
        if receipt["format"] == "json":
            return load_json(data), None
        if receipt["format"] != "csv":
            raise ValueError("Only original JSON/CSV source rows supported")
        encoding = receipt.get("encoding", "utf-8-sig")
        text = data.decode(encoding, errors="strict")
        if encoding.upper() == "CP950":
            self.equal(text.encode("cp950"), data, "raw.cp950_byte_roundtrip")
            self.equal(sha(text.encode("utf-8")), receipt["decoded_text_sha256"], "raw.decoded_utf8_sha256")
        rows = [row for row in csv.reader(io.StringIO(text)) if any(cell.strip() for cell in row)]
        if receipt.get("row_layout") == "HEADER_AND_DATA_ARRAYS_V1":
            return rows, rows[0]
        return [dict(zip(rows[0], row)) for row in rows[1:]], rows[0]

    @staticmethod
    def raw_row(payload, header, path):
        row = payload
        parents = []
        for item in path:
            parents.append(row)
            row = row[item]
        if isinstance(row, dict):
            return row, row
        if not isinstance(row, list):
            raise ValueError("Raw row is not an object/array")
        if header is None:
            for parent in reversed(parents):
                if isinstance(parent, dict) and isinstance(parent.get("fields"), list):
                    header = parent["fields"]
                    break
        if header is None or len(header) != len(row):
            raise ValueError("Raw array header does not match row")
        return row, dict(zip(header, row))

    def check_raw(self):
        if self.cache is None:
            return
        state = self.read(self.cache / "cache-state.json")
        for index, (capture_id, claims) in enumerate(sorted(self.raw_claims.items())):
            self.context = {"phase": "RETAINED_RAW_SOURCE", "capture_id": capture_id}
            entry = state["captures"].get(capture_id)
            if not self.check(entry is not None, "RETAINED_CAPTURE_MISSING"):
                continue
            receipt = entry["receipt"]
            try:
                payload, header = self.raw_payload(entry)
                verified_rows = {}
                for sid, observation in claims.values():
                    self.context = {"phase": "RETAINED_RAW_SOURCE", "capture_id": capture_id, "security_id": sid}
                    capture = observation["source_capture"]
                    for key, receipt_key in (("source_id", "source_id"), ("source_url", "url"), ("source_sha256", "sha256"), ("source_bytes", "bytes"), ("received_at", "received_at")):
                        self.equal(capture[key], receipt[receipt_key], "raw.binding." + key)
                    computed_id = hash_json({"source_id": capture["source_id"], "url": capture["source_url"], "source_sha256": capture["source_sha256"], "received_at": capture["received_at"]})
                    self.equal(capture_id, computed_id, "raw.capture_id")
                    row, fields = self.raw_row(payload, header, capture["row_path"])
                    row_key = tuple(capture["row_path"])
                    if row_key not in verified_rows:
                        verified_rows[row_key] = hash_json(row)
                        self.stats["raw_unique_rows"] += 1
                    # Memoize the expensive row serialization, not the claim.
                    # Every consumer must still name this exact row and stock.
                    self.equal(verified_rows[row_key], capture["source_row_hash"], "raw.source_row_hash")
                    symbol_key = int(capture["symbol_field"]) if isinstance(row, list) else capture["symbol_field"]
                    self.equal(str(row[symbol_key]).strip(), sid.split(":", 1)[1], "raw.symbol")
                    self.raw_observation(observation, fields, payload)
                    self.raw_source_counts[observation.get("schema", "UNKNOWN")] += 1
                self.stats["raw_captures"] += 1
                self.stats["raw_bytes_read"] += receipt["bytes"]
            except (KeyError, TypeError, ValueError, ArithmeticError, IndexError, UnicodeError) as error:
                self.check(False, "RAW_SOURCE_CHECK_EXCEPTION", source_id=receipt["source_id"], detail=str(error))
            if (index + 1) % 25 == 0:
                print(f"Checked {index + 1}/{len(self.raw_claims)} retained raw captures; {self.error_count} mismatches", file=sys.stderr, flush=True)

    def raw_observation(self, obs, fields, payload):
        family = obs.get("_family")
        if obs.get("schema") in {"TAIWAN_FINANCIAL_HISTORY_OBSERVATION_V1", "FULL_BVPS_BALANCE_RECORD"}:
            normalized = {norm(k): v for k, v in fields.items()}
            for key, expected in obs["fields"].items():
                self.equal(normalized.get(norm(key)), expected, "raw.financial_field." + key)
                self.stats["raw_field_comparisons"] += 1
            year = int(number(field(fields, ("年度",))))
            quarter = int(number(field(fields, ("季別",))))
            self.equal(f"{year + 1911 if year < 1911 else year}Q{quarter}", obs["period"], "raw.financial_period")
            return
        if family == "ROSTER":
            self.equal(str(field(fields, ("產業別", "IndustryType", "IndustryCode"))).zfill(2), str(obs["industry_code"]).zfill(2), "raw.industry_code")
            self.stats["raw_field_comparisons"] += 1
            return
        if family not in {"PRICE", "VALUATION"}:
            raise ValueError("Unsupported raw observation family")
        names = ("pe", "pb", "close") if family == "VALUATION" else ("open", "high", "low", "close", "volume", "amount")
        for name in names:
            if name in obs:
                raw_value = field(fields, PRICE_FIELDS[name])
                self.numeric(obs[name], number(raw_value), "raw." + name)
                self.stats["raw_field_comparisons"] += 1
        actual_date = parse_date(field(fields, ("Date", "日期", "資料日期")))
        if actual_date is None and isinstance(payload, dict):
            actual_date = parse_date(payload.get("date"))
        self.equal(actual_date, obs.get("date"), "raw.date")
        if family == "VALUATION":
            period = field(fields, ("財報年/季", "FinancialReportYearQuarter"))
            match = re.fullmatch(r"(\d{3,4})\s*/\s*([1-4])", str(period))
            if match:
                year, quarter = map(int, match.groups())
                period = f"{year + 1911 if year < 1911 else year}Q{quarter}"
            self.equal(period, obs.get("financial_period"), "raw.valuation_financial_period")

    def verify(self, expected):
        self.manifest = self.read(self.run / "manifest.json")
        self.pool = self.read(self.run / "price-input-pool.json")
        self.price_research = self.read(self.run / "price-research.json")
        self.load_packets()
        self.references()
        self.context = {"phase": "REFERENCE_TOTAL"}
        self.equal(self.stats["references"], expected, "expected_results")
        self.check_raw()
        self.context = {"phase": "IMMUTABLE_INPUTS"}
        for path, binding in self.file_bindings.items():
            self.equal(sha(Path(path).read_bytes()), binding["sha256"], "unchanged." + path)
        method_failures = Counter()
        for sid, horizon in self.failed_references:
            item = next(r for r in self.price_research if r["security_id"] == sid)[horizon.lower()]
            method_failures[SHORT if horizon == "SHORT" else item["method"]] += 1
        for method, stat in self.method_stats.items():
            stat["mismatched_references"] = method_failures[method]
        return {
            "schema": "TAIWAN_INDEPENDENT_ARITHMETIC_VERIFICATION_V1",
            "verifier_version": VERSION,
            "state": "VERIFIED_INDEPENDENT_ARITHMETIC" if not self.error_count else "MISMATCHES_FOUND",
            "run_path": str(self.run), "run_hash_as_recorded": self.manifest["run_hash"],
            "cutoff": self.manifest["cutoff"], "expected_results": expected,
            "method_counts_and_errors": self.method_stats, "counts": dict(self.stats),
            "mismatch_count": self.error_count, "mismatch_codes": dict(self.error_codes),
            "first_mismatches": self.errors, "mismatch_details_limit": 100,
            "arithmetic": {"implementation": "INDEPENDENT_PYTHON_STDLIB_DECIMAL", "decimal_precision": 50, "quantile": "R7_WEIGHTED_LINEAR_INTERPOLATION", "absolute_tolerance": str(ABS_TOL), "relative_tolerance": str(REL_TOL), "imports_js_calculator": False},
            "raw_verification": {"performed": self.cache is not None, "cache": str(self.cache) if self.cache else None, "capture_count": self.stats["raw_captures"], "unique_row_count": self.stats["raw_unique_rows"], "field_comparisons": self.stats["raw_field_comparisons"], "observation_counts": dict(self.raw_source_counts), "source_byte_bindings_hash": hash_json(sorted(self.raw_hashes, key=lambda r: r["capture_id"])), "coverage": "REFERENCED_PRICE_VALUATION_ROSTER_AND_FINANCIAL_JSON_CSV_ROWS" if self.cache else "NOT_PERFORMED"},
            "input_file_byte_bindings": self.file_bindings,
            "scope_limits": [
                "Checks emitted references and their listed peers; does not independently prove completeness of the selected peer universe or availability of missing references.",
                "Raw verification re-reads retained JSON/CSV entity bytes, not remote providers or original HTML table unit definitions.",
                "Corporate-action share-change flags are checked for BVPS; complete corporate-action source inventories are not independently revalidated here.",
                "LONG annual quality recomputes the existing disclosed profit/equity/OCF/cash-bridge conditions; it is not a new quality model or a source-use approval.",
                "Raw file/row/capture hashes and full BVPS record hashes are checked. Expanded floating-point research reference/input hashes are bound by original file bytes, not re-certified as JavaScript canonical hashes.",
                "No strategy validation, historical or forward returns, trade execution, intrinsic-value claim, method approval, review PASS, or member publication is asserted.",
                "This Python receipt is separate from SQL admission; it does not assert that every SQL method independently recalculates every formula."
            ],
            "side_effects": {"provider_requests": 0, "database_calls": 0, "oidc_calls": 0, "modified_run_or_cache_files": 0},
            "implementation_sha256": sha(Path(__file__).read_bytes()),
        }


def self_test():
    with localcontext() as ctx:
        ctx.prec = 50
        values = list(map(Decimal, [1, 2, 4, 8, 16, 32]))
        assert [r7(values, p) for p in QUANTILES] == [Decimal("2.5"), Decimal(6), Decimal(14)]
        assert [r7([Decimal(7)] * 5, p) for p in QUANTILES] == [Decimal(7)] * 3
        assert Decimal(100) * r7([Decimal(1), Decimal(2), Decimal(3), Decimal(4), Decimal(5)], Decimal("0.5")) / 2 == 150
        assert number("(1,234.50)") == Decimal("-1234.50") and number("--") is None
        assert parse_date("1151111") == "2026-11-11" and parse_date("20261111") == "2026-11-11"
        assert quarter_end("2024Q1").isoformat() == "2024-03-31"
        bars = [{"high": Decimal(i + 2), "low": Decimal(i), "close": Decimal(i + 1)} for i in range(1, 26)]
        limits, close, atr = short_values(bars)
        assert limits == [Decimal(6), Decimal(27)] and close == 26 and atr == 2
        row = ["115/11/11", "115", "2", "1259", "86.60"]
        parsed, fields = Verification.raw_row([row], ["出表日期", "年度", "季別", "公司代號", "每股參考淨值"], [0])
        assert parsed == row and number(fields["每股參考淨值"]) == Decimal("86.60")
        assert canonical({"z": Decimal("-0.0"), "a": "財報"}) == '{"a":"財報","z":0}'
    return 9


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path)
    parser.add_argument("--capture-cache", type=Path)
    parser.add_argument("--expected-results", type=int, default=4576)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    tests = self_test()
    if args.self_test and args.run is None:
        print(json.dumps({"state": "SELF_TESTS_PASSED", "cases": tests, "version": VERSION}))
        return 0
    if args.run is None or args.output is None:
        parser.error("--run and --output are required for a full verification")
    if args.output.exists():
        parser.error("Output already exists; choose a new immutable receipt path")
    started = time.monotonic()
    with localcontext() as ctx:
        ctx.prec = 50
        result = Verification(args.run, args.capture_cache).verify(args.expected_results)
    result["self_test_cases"] = tests
    result["elapsed_seconds"] = round(time.monotonic() - started, 3)
    result["completed_at"] = datetime.now(timezone.utc).isoformat()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("x", encoding="utf-8") as handle:
        json.dump(result, handle, ensure_ascii=False, indent=2, default=str)
        handle.write("\n")
    print(json.dumps({"state": result["state"], "references": result["counts"]["references"], "mismatches": result["mismatch_count"], "raw_captures": result["raw_verification"]["capture_count"], "receipt": str(args.output), "receipt_sha256": sha(args.output.read_bytes())}, ensure_ascii=False))
    return 0 if not result["mismatch_count"] else 1


if __name__ == "__main__":
    sys.exit(main())
