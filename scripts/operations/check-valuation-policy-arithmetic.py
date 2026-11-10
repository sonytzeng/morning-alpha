#!/usr/bin/env python3
"""Independent exact-rational check of the saved 2330 proposal and calculations.

Only Python's standard library is used. This checks numerical consistency with
the retained packet, not investment merit, source rights, a review decision or
production readiness. It makes no requests and changes no source artifact.
"""
import argparse
import hashlib
import json
from decimal import Decimal, localcontext
from fractions import Fraction
from pathlib import Path


def require(condition, message):
    if not condition:
        raise ValueError(message)


def fraction(value):
    require(isinstance(value, (int, Decimal, str)) and not isinstance(value, bool), "NON_NUMERIC_INPUT")
    return Fraction(value)


def decimal(value):
    with localcontext() as context:
        context.prec = 32
        return str(Decimal(value.numerator) / Decimal(value.denominator))


def cents(value):
    exact_cents = value * 100
    return Fraction(exact_cents.numerator // exact_cents.denominator, 100)


def matches(actual, expected, label):
    # The JS trace is stored as IEEE-754 JSON numbers. Allow its representation
    # error only; endpoint cents below must match exactly, with no tolerance.
    tolerance = max(Fraction("0.000000001"), abs(expected) * Fraction("0.000000000001"))
    require(abs(fraction(actual) - expected) <= tolerance, "TRACE_MISMATCH:" + label)


def read(path):
    raw = Path(path).read_bytes()
    return json.loads(raw, parse_float=Decimal), hashlib.sha256(raw).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--packet", required=True, help="Saved read-only packet JSON")
    parser.add_argument("--preparation", required=True, help="Saved actual-data preparation JSON")
    args = parser.parse_args()
    saved, packet_file_hash = read(args.packet)
    prepared, preparation_file_hash = read(args.preparation)
    require(saved.get("read_only") is True and len(saved.get("rows", [])) == 1, "READ_ONLY_PACKET_REQUIRED")
    row = saved["rows"][0]
    packet = row["packet"]
    require(packet["symbol"] == "2330", "SYMBOL")
    require(prepared["schema"] == "DAILY_AI_REAL_DATA_VALUATION_PREPARATION_V1", "PREPARATION_SCHEMA")
    require(prepared["source_packet_hash"] == row["packet_hash"] == prepared["proposal"]["packet_hash"], "PACKET_COMMITMENT")
    require(prepared["data_through"] == packet["data_through"] and prepared["source_cutoff"] == packet["cutoff"], "SOURCE_TIME_BINDING")
    require(prepared["review"] is None and prepared["methodology_approved"] is False and prepared["member_published"] is False
            and prepared["production_writes"] == 0, "PROPOSAL_MUST_REMAIN_UNAPPROVED")
    proposal = prepared["proposal"]
    require(proposal["version"] == "MA_2330_VALUATION_PROPOSAL_20261110_1", "EXPLICIT_POLICY_VERSION_REQUIRED")
    evidence = {source["id"]: source for source in packet["evidence"]}
    require(len(evidence) == len(packet["evidence"]), "DUPLICATE_SOURCE_ID")
    quarters = []
    for source in packet["evidence"]:
        try:
            content = json.loads(source["content"], parse_float=Decimal)
        except (ValueError, TypeError):
            continue
        if source["kind"] != "FINANCIAL" or content.get("kind") != "EPS":
            continue
        values = content["values"]
        require(source["symbol"] == "2330" and content["basis"] == "SINGLE_QUARTER"
                and values["measurement_basis"] == "DILUTED" and values["unit"] == "TWD_PER_COMMON_SHARE", "EPS_BASIS")
        amount = fraction(values.get("reported_decimal", str(values["value"])))
        require(amount == fraction(values["value"]), "EPS_REPORTED_DECIMAL")
        quarters.append({"period": content["period"], "value": amount, "evidence_id": source["id"],
                         "assurance": values.get("assurance"), "revision_review": values.get("subsequent_revision_review")})
    quarters.sort(key=lambda q: q["period"])
    require([q["period"] for q in quarters] == ["2025-Q4", "2026-Q1", "2026-Q2", "2026-Q3"], "EXACT_FOUR_QUARTERS")
    eps = sum((q["value"] for q in quarters), Fraction(0))
    require(eps == Fraction("98.26"), "REPORTED_QUARTER_SUM")
    results = []
    for item in prepared["calculations"]:
        policy, inputs, calculation = item["policy"], item["calculation_input"], item["calculation"]
        parameters, trace = inputs["parameters"], calculation["trace"]
        horizon = inputs["horizon"]
        require(policy in proposal["policies"] and policy["version"] == proposal["version"], "POLICY_BINDING")
        require(inputs["symbol"] == "2330" and inputs["evidence"] == packet["evidence"], "EXACT_INPUT_EVIDENCE")
        require(inputs["cutoff"] == packet["cutoff"] and inputs["data_through"] == packet["data_through"], "INPUT_TIME_BINDING")
        require(calculation["status"] == "CALCULATED_REVIEW_REQUIRED" and calculation["review"] is None
                and calculation["production_eligible"] is False and calculation["buy_ready"] is False, "CALCULATION_MUST_REMAIN_UNAPPROVED")
        require(parameters["earnings_basis"] == "REPORTED_FOUR_QUARTER_DILUTED_EPS_SUM", "HISTORICAL_SUM_BASIS")
        require(set(q["evidence_id"] for q in quarters).issubset(parameters["dilution_basis"]["evidence_ids"]), "EPS_REFERENCE_BINDING")
        require(parameters["entry_scenarios"] == ["conservative", "base"] and fraction(parameters["margin_of_safety"]) == Fraction(1, 4), "EXPLICIT_ENDPOINT_SELECTION")
        quote_source = evidence[inputs["quote_evidence_id"]]
        quote = json.loads(quote_source["content"], parse_float=Decimal)
        require(quote_source["kind"] == "PRICE" and quote["date"] == packet["data_through"], "QUOTE_DATE")
        quote_value = fraction(quote["close"])
        require(quote_value == Fraction(2235), "RETAINED_QUOTE")
        scenarios = []
        require([s["name"] for s in parameters["scenarios"]] == ["conservative", "base", "upside"], "SCENARIO_ORDER")
        for index, scenario in enumerate(parameters["scenarios"]):
            observed = trace["scenarios"][index]
            if horizon == "MEDIUM":
                require(inputs["method_id"] == "MEDIUM_EPS_PE_SCENARIOS_V1", "MEDIUM_METHOD")
                require(fraction(scenario["eps"]) == eps and scenario["pe"] == [16, 20, 24][index], "MEDIUM_POLICY")
                value = eps * fraction(scenario["pe"])
                details = {"pe": scenario["pe"], "earnings_yield_percent": decimal(100 / fraction(scenario["pe"]))}
            elif horizon == "LONG":
                require(inputs["method_id"] == "LONG_EPS_DIVIDEND_TERMINAL_PE_SCENARIOS_V1", "LONG_METHOD")
                growth = [fraction(n) for n in scenario["eps_growth_rates"]]
                payout = [fraction(n) for n in scenario["payout_ratios"]]
                rate, terminal_pe = fraction(scenario["required_return"]), fraction(scenario["terminal_pe"])
                require(growth == [Fraction(["0.06", "0.12", "0.18"][index])] * 5 and payout == [Fraction(1, 4)] * 5
                        and rate == Fraction(["0.12", "0.10", "0.09"][index]) and terminal_pe == [12, 16, 20][index], "LONG_POLICY")
                earnings, dividend_pv = eps, Fraction(0)
                for year, (g, p) in enumerate(zip(growth, payout), 1):
                    earnings *= 1 + g
                    dividend = earnings * p
                    yearly_pv = dividend / (1 + rate) ** year
                    dividend_pv += yearly_pv
                    recorded = observed["years"][year - 1]
                    matches(recorded["eps"], earnings, "yearly_eps")
                    matches(recorded["dividend"], dividend, "yearly_dividend")
                    matches(recorded["dividend_present_value"], yearly_pv, "yearly_dividend_pv")
                terminal_value = earnings * terminal_pe
                terminal_pv = terminal_value / (1 + rate) ** 5
                value = dividend_pv + terminal_pv
                matches(observed["dividend_present_value"], dividend_pv, "dividend_pv")
                matches(observed["terminal"]["value"], terminal_value, "terminal_value")
                matches(observed["terminal"]["present_value"], terminal_pv, "terminal_pv")
                matches(observed["terminal_fraction"], terminal_pv / value, "terminal_fraction")
                details = {"dividend_present_value": decimal(dividend_pv), "terminal_present_value": decimal(terminal_pv),
                           "terminal_fraction_percent": decimal(100 * terminal_pv / value)}
            else:
                raise ValueError("UNEXPECTED_HORIZON")
            matches(observed["value"], value, "scenario_value")
            discounted = cents(value * Fraction(3, 4))
            scenarios.append({"name": scenario["name"], "value": decimal(value), "discount_25_price": decimal(discounted),
                              "retained_quote_at_or_below_discount_price": quote_value <= discounted, **details})
        require([fraction(v) for v in calculation["entry_range"]] == [fraction(s["discount_25_price"]) for s in scenarios[:2]], "ENTRY_RANGE_MISMATCH")
        require(fraction(calculation["wait_above"]) == fraction(scenarios[1]["discount_25_price"])
                and calculation["stop_kind"] == "EVENT" and calculation["stop"] is None, "WAIT_STOP_BINDING")
        results.append({"horizon": horizon, "scenarios": scenarios, "selected_endpoints": parameters["entry_scenarios"],
                        "quote_above_selected_range": quote_value > fraction(scenarios[1]["discount_25_price"])})
    require(sorted(r["horizon"] for r in results) == ["LONG", "MEDIUM"], "EXACT_TWO_MODELS")
    print(json.dumps({"schema": "DAILY_AI_VALUATION_PROPOSAL_ARITHMETIC_CROSSCHECK_V1", "arithmetic_consistent": True,
          "scope": "ARITHMETIC_ONLY_NOT_METHODOLOGY_APPROVAL", "policy_version": proposal["version"],
          "packet_file_sha256": packet_file_hash, "preparation_file_sha256": preparation_file_hash,
          "retained_packet_commitment": row["packet_hash"], "data_through": packet["data_through"], "reported_eps_sum": decimal(eps),
          "source_quarters": [{**q, "value": decimal(q["value"])} for q in quarters], "models": results,
          "review_questions": ["Why select conservative/base while the retained quote meets the upside LONG discount threshold?",
            "How are terminal PE, required return and growth justified jointly given 89.55%–94.91% terminal dependence?",
            "Define model year timing and an ex-dividend terminal price after the last modeled dividend.",
            "Keep the five-year valuation horizon separate from the three-to-eighteen-month observation/reassessment window.",
            "Confirm quarter EPS revisions, dilution/corporate actions, payout/reinvestment feasibility and source-use permission."],
          "methodology_approved": False, "review": None, "member_published": False, "production_writes": 0, "network_calls": 0}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
