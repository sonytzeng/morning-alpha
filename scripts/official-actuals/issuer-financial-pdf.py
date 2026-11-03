"""Offline Cathay 2882 PDF candidate profile; no admission or canonical writes.

Only the three reviewed report periods/layouts are supported. Values come from
PDF word coordinates, current-year direct-three-month columns and the EPS note,
never a fixed value, YTD subtraction, filename, approval date, or PDF metadata.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal
import hashlib
from io import BytesIO
import json
from pathlib import Path
import re
import time
from urllib.parse import urlsplit

import pdfplumber
from pypdf import PdfReader

PROFILE = "cathay-2882-consolidated-english-eps-v1"
PERIODS = frozenset({(2025, 3), (2026, 1), (2026, 2)})
OUTPUT_ROOT = Path("/private/tmp/morning-alpha-issuer-financial-20261020")
MONTHS = {1: ("March", 31), 2: ("June", 30), 3: ("September", 30)}
NUMBER = re.compile(r"\(?-?\d+\.\d{2}\)?\Z")


class ExtractionError(ValueError):
    """Fail-closed local profile error; does not expose document contents."""


def require(condition: bool, code: str) -> None:
    if not condition:
        raise ExtractionError(code)


def normalized(text: str) -> str:
    return " ".join(text.split())


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


@dataclass(frozen=True)
class Limits:
    max_bytes: int = 12_000_000
    max_pages: int = 400
    max_page_chars: int = 100_000
    max_total_chars: int = 4_000_000
    max_words: int = 15_000
    seconds: float = 90.0


@dataclass(frozen=True)
class Word:
    text: str
    x0: float
    x1: float
    top: float
    bottom: float


def lines(words: list[Word]) -> list[list[Word]]:
    result: list[list[Word]] = []
    for word in sorted(words, key=lambda w: (w.top, w.x0)):
        if not result or abs(result[-1][0].top - word.top) > 2:
            result.append([word])
        else:
            result[-1].append(word)
    return [sorted(row, key=lambda w: w.x0) for row in result]


def direct_eps(words: list[Word], *, year: int, quarter: int,
               note: bool = False) -> dict[str, object]:
    """Read direct-quarter EPS using geometry, not position in flattened text."""
    rows = lines(words)
    headers = []
    for row in rows:
        years = [w for w in row if re.fullmatch(r"20\d{2}", w.text)]
        if len(years) in (2, 4):
            expected = [str(year), str(year - 1)] * (len(years) // 2)
            if [w.text for w in years] == expected:
                headers.append(years)
    require(bool(headers), "CURRENT_YEAR_COLUMN_NOT_PROVEN")
    # The first table in the statement/EPS-note region must be direct quarter.
    header = headers[0]
    y = header[0].top
    above = [w for w in words if y - 65 <= w.top < y]
    left = [w for w in above if w.x0 < (header[1].x0 + header[2].x0) / 2] if len(header) == 4 else above
    title = normalized(" ".join(w.text for row in lines(left) for w in row))
    month, day = MONTHS[quarter]
    require("Three Months Ended" in title and month in title and str(day) in title,
            "DIRECT_THREE_MONTH_HEADER_NOT_PROVEN")
    if len(header) == 4:
        require(any(w.text in ("Six", "Nine") for w in above), "YTD_HEADER_NOT_SEPARATED")
    anchors = []
    for row in rows:
        label = normalized(" ".join(w.text for w in row if w.x0 < header[0].x0 - 20))
        if row[0].top > y and re.search(r"(?:^| )basic earnings", label, re.I):
            # Exclude prose about the computation; accept the table label only.
            if re.match(r"(?:Total )?Basic earnings", label, re.I):
                anchors.append((row[0].top, label))
    if note and any(label.lower().startswith("total basic") for _, label in anchors):
        anchors = [(top, label) for top, label in anchors if label.lower().startswith("total basic")]
    next_anchor = float("inf")
    if not note and len(anchors) == 2:
        require(quarter == 3 and any("discontinued" in w.text.lower() for w in words),
                "AMBIGUOUS_BASIC_EPS_ROWS")
        next_anchor = anchors[1][0]
        anchors = anchors[:1]  # Source explicitly orders total before continuing-only.
    require(len(anchors) == 1, "BASIC_EPS_ROW_MISSING_OR_AMBIGUOUS")
    top, label = anchors[0]
    candidates = []
    for row in rows:
        if not top - 1 <= row[0].top <= top + 23 or row[0].top >= next_anchor - 1:
            continue
        values = [w for w in row if NUMBER.fullmatch(w.text) and w.x0 > header[0].x0 - 25]
        if len(values) == len(header):
            assigned = [min(range(len(header)), key=lambda i: abs(
                (w.x0 + w.x1) / 2 - (header[i].x0 + header[i].x1) / 2)) for w in values]
            require(assigned == list(range(len(header))), "EPS_COLUMN_ALIGNMENT_AMBIGUOUS")
            candidates.append(values)
    require(len(candidates) == 1, "EPS_VALUE_ROW_MISSING_OR_AMBIGUOUS")
    value = candidates[0][0]
    lexical = value.text
    decimal = Decimal(lexical.replace("(", "-").replace(")", ""))
    return {"value_decimal": str(decimal), "reported_lexical": lexical,
            "label": label, "bbox": [value.x0, value.top, value.x1, value.bottom],
            "column_index": 0, "column_years": [w.text for w in header],
            "period_basis": "DIRECT_THREE_MONTHS", "decimals": -decimal.as_tuple().exponent,
            "resolution_decimal": str(Decimal(1).scaleb(decimal.as_tuple().exponent))}


def accounting_basis(texts: dict[int, str], year: int) -> dict[str, object]:
    pages = []
    for page, text in texts.items():
        text = normalized(text)
        if year == 2026 and "retrospectively applied IFRS 17" in text and "restated comparative" in text:
            pages.append(page)
        if year == 2025 and "overlay approach under IFRS 4" in text:
            pages.append(page)
    require(bool(pages), "ACCOUNTING_BASIS_NOT_PROVEN")
    return {"basis": "IFRS17_RETROSPECTIVE_APPLICATION" if year == 2026 else "IFRS4_OVERLAY_AS_REPORTED",
            "evidence_pdf_pages": pages,
            "comparative_information_restated": year == 2026,
            "comparative_columns_extracted": False,
            "cross_period_comparability": "NOT_ESTABLISHED",
            "four_consecutive_comparable_quarters": False}


def ordinary_share_proof(proof: str, *, year: int, quarter: int) -> bool:
    proof = normalized(proof)
    require("Unit: NT$ Per Share" in proof, "NOTE_EPS_UNIT_NOT_PROVEN")
    require("Weighted Average Number of Ordinary Shares Outstanding" in proof
            and re.search(r"ordinary shares used in the computation of basic earnings", proof, re.I),
            "ORDINARY_SHARE_DENOMINATOR_NOT_PROVEN")
    preference = "Dividends on preference shares" in proof
    if (year, quarter) == (2026, 2):
        require(preference, "PREFERENCE_DIVIDEND_ADJUSTMENT_NOT_PROVEN")
    return preference


def verify_eps_agreement(statement: dict[str, object], note: dict[str, object]) -> None:
    require(statement["value_decimal"] == note["value_decimal"], "STATEMENT_NOTE_EPS_CONFLICT")


def extract_actuals(data: bytes, *, year: int, quarter: int, source_url: str,
                    expected_sha256: str, source_path: str | None = None,
                    limits: Limits = Limits()) -> dict[str, object]:
    started = time.monotonic()
    require((year, quarter) in PERIODS, "PERIOD_NOT_PROFILED")
    require(0 < len(data) <= limits.max_bytes, "PDF_BYTE_LIMIT")
    require(data.startswith(b"%PDF-"), "PDF_MAGIC_INVALID")
    require(bool(re.fullmatch(r"[0-9a-f]{64}", expected_sha256)), "EXPECTED_SHA256_REQUIRED")
    digest = hashlib.sha256(data).hexdigest()
    require(digest == expected_sha256, "SOURCE_SHA256_MISMATCH")
    first_verified = utc_now()
    url = urlsplit(source_url)
    require(url.scheme == "https" and url.hostname == "www.cathayholdings.com"
            and url.username is None and url.password is None and url.port in (None, 443)
            and re.fullmatch(r"/holdings/-/media/[0-9a-f]{32}\.pdf", url.path) is not None,
            "ISSUER_SOURCE_URL_NOT_PROFILED")
    reader = PdfReader(BytesIO(data), strict=True)
    require(not reader.is_encrypted, "ENCRYPTED_PDF_UNSUPPORTED")
    require(len(reader.pages) <= limits.max_pages, "PDF_PAGE_LIMIT")
    cache: dict[int, str] = {}
    total = 0

    def text(page: int) -> str:
        nonlocal total
        require(time.monotonic() - started <= limits.seconds, "PARSE_DEADLINE")
        require(1 <= page <= len(reader.pages), "PROFILE_PAGE_NOT_PRESENT")
        if page not in cache:
            value = reader.pages[page - 1].extract_text()
            require(len(value) <= limits.max_page_chars, "PDF_PAGE_TEXT_LIMIT")
            total += len(value)
            require(total <= limits.max_total_chars, "PDF_TOTAL_TEXT_LIMIT")
            cache[page] = value
        require(time.monotonic() - started <= limits.seconds, "PARSE_DEADLINE")
        return cache[page]

    cover = normalized(text(1))
    require("Cathay Financial Holding Co., Ltd. and Subsidiaries" in cover
            and "Consolidated Financial Statements" in cover, "ISSUER_CONSOLIDATED_IDENTITY_NOT_PROVEN")
    cumulative = {1: "Three", 2: "Six", 3: "Nine"}[quarter]
    month, day = MONTHS[quarter]
    require(f"{cumulative} Months Ended {month} {day}, {year}" in cover, "COVER_REPORT_PERIOD_MISMATCH")
    statement_pages = []
    for page in range(2, min(16, len(reader.pages)) + 1):
        value = normalized(text(page))
        if ("CONSOLIDATED STATEMENTS OF COMPREHENSIVE INCOME" in value
                and re.search(r"Basic earnings(?: \(loss\))? per share", value)):
            statement_pages.append(page)
    require(len(statement_pages) == 1, "CONSOLIDATED_EPS_PAGE_MISSING_OR_AMBIGUOUS")
    statement_page = statement_pages[0]
    statement_text = normalized(text(statement_page))
    unmapped_labels = []
    for page in range(2, statement_page + 1):
        page_text = normalized(text(page))
        if "CONSOLIDATED STATEMENTS OF COMPREHENSIVE INCOME" in page_text:
            for label in ("PROFIT (LOSS) FROM OPERATIONS", "PROFIT FROM OPERATIONS"):
                if label in page_text:
                    unmapped_labels.append({"pdf_page": page, "source_label": label,
                                            "generic_revenue_equivalence": False,
                                            "financial_net_revenue_equivalence": False})
    require(f"For the Three Months Ended {month} {day}" in statement_text,
            "DIRECT_QUARTER_DATE_MISMATCH")
    require("Except Earnings" in statement_text and "Per Share" in statement_text,
            "STATEMENT_EPS_SCALING_EXCEPTION_MISSING")
    note_refs = re.findall(r"EARNINGS(?: \(LOSS\))? PER SHARE\s*\(Note (\d+)\)", statement_text)
    require(len(note_refs) == 1, "EPS_NOTE_REFERENCE_AMBIGUOUS")
    note_number = int(note_refs[0])
    note_pages = []
    heading = re.compile(r"(?:^|\n)\s*" + str(note_number) + r"\.\s+EARNINGS(?: \(LOSS\))? PER SHARE")
    # Explicit reviewed profile search window; layout drift fails closed.
    for page in range(70, min(125, len(reader.pages)) + 1):
        if heading.search(text(page)):
            note_pages.append(page)
    require(len(note_pages) == 1, "EPS_NOTE_MISSING_OR_AMBIGUOUS")
    note_page = note_pages[0]
    match = heading.search(text(note_page))
    note_text = text(note_page)[match.start():] + "\n" + text(note_page + 1)
    note_text = re.split(r"(?:^|\n)\s*" + str(note_number + 1) + r"\.\s+[A-Z]", note_text)[0]
    proof = normalized(note_text)
    preference = ordinary_share_proof(proof, year=year, quarter=quarter)
    with pdfplumber.open(BytesIO(data)) as pdf:
        def words(page: int, note_region: bool = False) -> list[Word]:
            require(time.monotonic() - started <= limits.seconds, "PARSE_DEADLINE")
            raw = pdf.pages[page - 1].extract_words()
            require(len(raw) <= limits.max_words, "PDF_WORD_LIMIT")
            result = [Word(w["text"], w["x0"], w["x1"], w["top"], w["bottom"]) for w in raw]
            if note_region:
                anchors = [w.top for row in lines(result) for w in row
                           if w.text == str(note_number) + "." and any(x.text == "EARNINGS" for x in row)]
                require(len(anchors) == 1, "EPS_NOTE_LAYOUT_NOT_PROVEN")
                result = [w for w in result if w.top >= anchors[0] - 1]
            return result
        eps = direct_eps(words(statement_page), year=year, quarter=quarter)
        note_eps = direct_eps(words(note_page, True), year=year, quarter=quarter, note=True)
    verify_eps_agreement(eps, note_eps)
    basis = accounting_basis({page: text(page) for page in range(12, min(40, len(reader.pages)) + 1)}, year)
    require(time.monotonic() - started <= limits.seconds, "PARSE_DEADLINE")
    normalized_at = utc_now()
    start = date(year, quarter * 3 - 2, 1).isoformat()
    end = date(year, quarter * 3, day).isoformat()
    timing = {"source_received_at": None, "first_seen_at": None, "announced_at": None,
              "first_verified_at": first_verified, "first_normalized_at": normalized_at,
              "conservative_available_at": normalized_at,
              "time_quality": "LOCAL_NORMALIZATION_BOUND_ONLY_NOT_ANNOUNCEMENT",
              "time_precision": "microsecond_UTC_clock_not_source_precision",
              "time_source": "runtime_UTC_clock_after_local_PDF_hash_verification",
              "printed_approval_or_auditor_dates_used": False, "mtime_used": False}
    row = {"entity": "2882", "metric": "basic_eps", "value_decimal": eps["value_decimal"],
           "fiscal_period": f"{year}Q{quarter}", "period_start": start, "period_end": end,
           "period_basis": "DIRECT_SINGLE_QUARTER_AS_REPORTED", "scope": "CONSOLIDATED",
           "operations_scope": "TOTAL_CONTINUING_AND_DISCONTINUED",
           "share_class": "ORDINARY", "unit": "TWD/ordinary_share", "scale": 0,
           "decimals": eps["decimals"], "resolution_decimal": eps["resolution_decimal"],
           "precision_kind": "DISPLAYED_DECIMAL_RESOLUTION_NOT_EXACT_VALUE",
           "accounting": basis, "source_sha256": digest,
           "source_version": None, "revision_chain": None,
           "source_admission": False, "member_publication": False,
           "evidence": {"statement_pdf_page": statement_page, "eps_note_number": note_number,
                        "eps_note_pdf_pages": [note_page, note_page + 1],
                        "statement_cell": eps, "note_cell": note_eps,
                        "ordinary_share_denominator_proven": True,
                        "preference_dividend_deduction_row_present": preference,
                        "preference_adjustment": "EXPLICIT_NOTE_ROW" if preference else "NOT_STATED_IN_EPS_NOTE_NOT_ASSUMED_ZERO",
                        "ytd_subtraction_used": False}, **timing}
    return {"contract": "issuer-financial-pdf-candidate-v1", "profile": PROFILE,
            "source_path": source_path, "source_url": source_url, "format": "ISSUER_PDF",
            "source_url_provenance": "USER_SUPPLIED_ACQUISITION_REFERENCE_NOT_HTTP_RECEIPT",
            "source_sha256": digest, "source_bytes": len(data), "source_version": None,
            "revision_chain": None, "source_admission": False, "member_publication": False,
            "canonical_writer_invoked": False, **timing, "rows": [row],
            "unmapped_financial_statement_labels": unmapped_labels,
            "missing": [{"metric": "financial_net_revenue", "reason": "SOURCE_PROFIT_FROM_OPERATIONS_NOT_EQUIVALENT_TO_NET_REVENUE" if unmapped_labels else "FINANCIAL_NET_REVENUE_IDENTITY_NOT_PROVEN"},
                        {"metric": "revenue", "reason": "GENERIC_REVENUE_IDENTITY_NOT_PROVEN"},
                        {"field": "announced_at", "reason": "NO_EXACT_ANNOUNCEMENT_RECEIPT"},
                        {"field": "source_received_at_and_first_seen_at", "reason": "NO_NATIVE_ACQUISITION_TIME_RECEIPT"},
                        {"field": "source_version_and_revision_chain", "reason": "NO_SOURCE_VERSION_CHAIN"}],
            "coverage": {"observed_periods": [f"{year}Q{quarter}"],
                         "four_consecutive_comparable_quarters": False,
                         "cross_period_growth_computed": False}}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--year", type=int, required=True)
    parser.add_argument("--quarter", type=int, required=True)
    parser.add_argument("--url", required=True)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    limits = Limits()
    require(args.pdf.is_file() and args.pdf.stat().st_size <= limits.max_bytes, "PDF_FILE_OR_SIZE_INVALID")
    with args.pdf.open("rb") as source:
        data = source.read(limits.max_bytes + 1)
    result = extract_actuals(data, year=args.year, quarter=args.quarter, source_url=args.url,
                            expected_sha256=args.sha256, source_path=str(args.pdf.resolve()), limits=limits)
    serialized = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        require(args.output.parent.resolve() == OUTPUT_ROOT and args.output.suffix == ".json",
                "OUTPUT_MUST_BE_NEW_LOCAL_CANDIDATE_JSON")
        with args.output.open("x", encoding="utf-8") as target:
            target.write(serialized)
        print(json.dumps({"output": str(args.output), "rows": len(result["rows"]),
                          "sha256": hashlib.sha256(serialized.encode()).hexdigest()}))
    else:
        print(serialized, end="")


if __name__ == "__main__":
    main()
