"""Bounded offline PDF cell candidates, never source/quality/rights approval.

CLI: --private-root DIR --descriptor FILE --descriptor-sha256 SHA
     --source-host HOST --outdir DIR --output-name NEW.json

The versioned descriptor contains entity, source(path/url/sha256/receipt),
period(year/quarter/header/year_label/column_x), issuer_name, identity, accounting
and metrics. issuer_name is an exact PDF text locator, NOT a symbol directory.
Every text locator is {page,bbox,text}; numeric cells are {page,bbox}. Coordinates
are PDF points from the top left. No expressions, value literals, network,
issuer-specific branches, annual differencing, or external canonical writer.
Human-reviewed descriptors are evidence selectors, not approval instruments.
Private operator-only for pinned originals: PDF decompression precedes decoded
stream length checks. Time/byte/page checks are NOT an untrusted-service sandbox.
"""
from __future__ import annotations

import argparse
import calendar
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP, localcontext
import hashlib
from io import BytesIO
import json
import math
import os
from pathlib import Path
import re
import signal
import stat
import time
from urllib.parse import urlsplit

import pdfplumber
from pypdf import PdfReader

CONTRACT = "issuer-pdf-descriptor-v1"
SHA = re.compile(r"[0-9a-f]{64}\Z")
MULTIPLIERS = {"1": "", "1000": "thousand", "1000000": "million", "1000000000": "billion"}
CURRENCIES = {"TWD": ("new taiwan dollars", "nt$", "ntd"),
              "USD": ("us dollars", "u.s. dollars", "usd"),
              "EUR": ("euros", "eur"), "JPY": ("japanese yen", "jpy")}


class DescriptorError(ValueError):
    """Non-sensitive rejection code, never source text or values."""


def require(ok: bool, code: str) -> None:
    if not ok:
        raise DescriptorError(code)


def norm(text: str) -> str:
    return " ".join(text.split())


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def clock() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


@dataclass(frozen=True)
class Limits:
    json_bytes: int = 131_072
    receipt_bytes: int = 262_144
    pdf_bytes: int = 8 * 1024 * 1024
    pages: int = 160
    selected_pages: int = 12
    page_stream_bytes: int = 2_000_000
    words: int = 20_000
    page_chars: int = 120_000
    nodes: int = 6000
    depth: int = 16
    seconds: float = 30.0


def keys(obj: object, required: set[str], optional: set[str] = frozenset()) -> dict:
    require(type(obj) is dict and required <= obj.keys() and obj.keys() <= required | optional,
            "DESCRIPTOR_SCHEMA")
    return obj


def text(value: object, maximum: int = 2048) -> str:
    require(type(value) is str and 0 < len(value) <= maximum and "\x00" not in value,
            "STRING_BOUND")
    return value


def checked_sha(value: object) -> str:
    require(type(value) is str and SHA.fullmatch(value) is not None, "SHA256_REQUIRED")
    return value


def bounded_json(raw: bytes, limit: int, limits: Limits) -> object:
    require(0 < len(raw) <= limit, "JSON_BYTE_LIMIT")
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, "JSON_DUPLICATE_KEY")
            result[key] = value
        return result
    def constant(_):
        raise DescriptorError("JSON_NONFINITE")
    try:
        value = json.loads(raw, object_pairs_hook=pairs, parse_constant=constant)
    except (ValueError, RecursionError, UnicodeError) as exc:
        if isinstance(exc, DescriptorError):
            raise
        raise DescriptorError("JSON_INVALID") from None
    count = 0
    def visit(node, depth):
        nonlocal count
        count += 1
        require(depth <= limits.depth and count <= limits.nodes, "JSON_STRUCTURE_LIMIT")
        if isinstance(node, dict):
            for key, child in node.items():
                text(key, 128)
                visit(child, depth + 1)
        elif isinstance(node, list):
            for child in node:
                visit(child, depth + 1)
        elif isinstance(node, str):
            require(len(node) <= 4096 and "\x00" not in node, "JSON_STRING_LIMIT")
        elif isinstance(node, float):
            require(math.isfinite(node), "JSON_NONFINITE")
        elif type(node) is int:
            require(node.bit_length() <= 256, "JSON_INTEGER_LIMIT")
        else:
            require(node is None or type(node) is bool, "JSON_TYPE")
    visit(value, 0)
    return value


class PrivateRoot:
    """dir_fd traversal: no symlink component, FIFO, overwrite or path escape."""
    def __init__(self, path: Path):
        path = Path(path)
        require(path.is_absolute() and ".." not in path.parts, "PRIVATE_ROOT_PATH")
        self.path = path
        fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
        try:
            for part in path.parts[1:]:
                new = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                os.close(fd)
                fd = new
            self._private_dir(fd)
            self.fd = fd
        except BaseException:
            os.close(fd)
            raise

    @staticmethod
    def _private_dir(fd: int) -> None:
        info = os.fstat(fd)
        require(info.st_uid == os.getuid() and stat.S_IMODE(info.st_mode) == 0o700,
                "PRIVATE_DIRECTORY_MODE")

    def close(self):
        os.close(self.fd)

    def relative(self, path: Path) -> tuple[str, ...]:
        path = Path(path)
        require(path.is_absolute() and ".." not in path.parts, "PATH_ESCAPE")
        try:
            parts = path.relative_to(self.path).parts
        except ValueError:
            raise DescriptorError("PATH_ESCAPE") from None
        require(bool(parts) and all(p not in ("", ".", "..") for p in parts), "PATH_ESCAPE")
        return parts

    def directory(self, parts: tuple[str, ...], create: bool = False) -> int:
        fd = os.dup(self.fd)
        try:
            for part in parts:
                if create:
                    try:
                        os.mkdir(part, 0o700, dir_fd=fd)
                    except FileExistsError:
                        pass
                new = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                try:
                    self._private_dir(new)
                except BaseException:
                    os.close(new)
                    raise
                os.close(fd)
                fd = new
            return fd
        except BaseException:
            os.close(fd)
            raise

    def read(self, path: Path, limit: int) -> bytes:
        parts = self.relative(path)
        parent = self.directory(parts[:-1])
        try:
            fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
            with os.fdopen(fd, "rb") as stream:
                info = os.fstat(stream.fileno())
                require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
                        and stat.S_IMODE(info.st_mode) == 0o400 and info.st_nlink == 1,
                        "PRIVATE_INPUT_FILE")
                require(0 < info.st_size <= limit, "FILE_BYTE_LIMIT")
                raw = stream.read(limit + 1)
                require(len(raw) == info.st_size and len(raw) <= limit, "FILE_CHANGED_OR_LIMIT")
                return raw
        finally:
            os.close(parent)

    def write_new(self, outdir: Path, name: str, raw: bytes) -> Path:
        require(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,120}\.json", name) is not None,
                "OUTPUT_NAME")
        parts = self.relative(outdir)
        parent = self.directory(parts, create=True)
        opened = False
        try:
            fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                         0o400, dir_fd=parent)
            opened = True
            with os.fdopen(fd, "wb") as stream:
                stream.write(raw)
                stream.flush()
                os.fsync(stream.fileno())
            return Path(outdir) / name
        except BaseException:
            if opened:
                os.unlink(name, dir_fd=parent)
            raise
        finally:
            os.close(parent)


def pointer(value: object, path: str) -> dict:
    require(type(path) is str and path.startswith("/") and len(path) <= 256, "RECEIPT_POINTER")
    parts = path[1:].split("/")
    require(0 < len(parts) <= 12, "RECEIPT_POINTER")
    for part in parts:
        require(re.fullmatch(r"[A-Za-z0-9_-]{1,64}", part) is not None, "RECEIPT_POINTER")
        if type(value) is dict and part in value:
            value = value[part]
        elif type(value) is list and part.isdigit() and int(part) < len(value):
            value = value[int(part)]
        else:
            raise DescriptorError("RECEIPT_POINTER_MISSING")
    require(type(value) is dict, "RECEIPT_ENTRY")
    return value


def timestamp(value: object) -> datetime:
    require(type(value) is str and re.fullmatch(
        r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)", value) is not None,
        "RECEIPT_TIME_REQUIRED")
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise DescriptorError("RECEIPT_TIME_INVALID") from None


class Document:
    def __init__(self, data: bytes, limits: Limits, started: float):
        self.limits, self.started = limits, started
        require(data.startswith(b"%PDF-"), "PDF_MAGIC")
        reader = PdfReader(BytesIO(data), strict=True)
        require(not reader.is_encrypted and 0 < len(reader.pages) <= limits.pages, "PDF_PAGE_LIMIT")
        self.reader = reader
        self.pdf = pdfplumber.open(BytesIO(data))
        self.cache = {}

    def close(self):
        self.pdf.close()

    def page(self, number: object):
        require(time.monotonic() - self.started <= self.limits.seconds, "PARSE_DEADLINE")
        require(type(number) is int and 1 <= number <= len(self.pdf.pages), "LOCATOR_PAGE")
        if number not in self.cache:
            require(len(self.cache) < self.limits.selected_pages, "SELECTED_PAGE_LIMIT")
            content = self.reader.pages[number - 1].get_contents()
            require(content is not None and len(content.get_data()) <= self.limits.page_stream_bytes,
                    "PAGE_STREAM_LIMIT")
            pg = self.pdf.pages[number - 1]
            words = pg.extract_words()
            require(len(words) <= self.limits.words and sum(len(w["text"]) for w in words)
                    <= self.limits.page_chars, "PAGE_WORD_LIMIT")
            self.cache[number] = (pg, words)
        return self.cache[number]

    def select(self, locator: object, label: bool = True) -> tuple[str, dict]:
        obj = keys(locator, {"page", "bbox", "text"} if label else {"page", "bbox"})
        pg, words = self.page(obj["page"])
        box = obj["bbox"]
        require(type(box) is list and len(box) == 4 and all(type(v) in (int, float)
                and math.isfinite(v) for v in box), "LOCATOR_BBOX")
        x0, top, x1, bottom = box
        require(0 <= x0 < x1 <= pg.width and 0 <= top < bottom <= pg.height, "LOCATOR_BOUNDS")
        chosen = [w for w in words if w["x0"] >= x0 - .05 and w["x1"] <= x1 + .05
                  and w["top"] >= top - .05 and w["bottom"] <= bottom + .05]
        require(bool(chosen), "LOCATOR_EMPTY")
        # Preserve reading order including wrapped labels, never flatten the PDF globally.
        rows = []
        for w in sorted(chosen, key=lambda w: (w["top"], w["x0"])):
            if not rows or abs(rows[-1][0]["top"] - w["top"]) > 2:
                rows.append([w])
            else:
                rows[-1].append(w)
        actual = norm(" ".join(w["text"] for row in rows for w in sorted(row, key=lambda w: w["x0"])))
        if label:
            require(actual == norm(text(obj["text"])), "LOCATOR_LABEL_MISMATCH")
        else:
            require(len(chosen) == 1, "CELL_NOT_SINGLE_TOKEN")
        return actual, obj


def period(doc: Document, obj: object) -> dict:
    p = keys(obj, {"year", "quarter", "header", "year_label", "column_x"})
    year, quarter = p["year"], p["quarter"]
    require(type(year) is int and 2000 <= year <= 2100 and type(quarter) is int
            and 1 <= quarter <= 4, "FISCAL_PERIOD")
    header, h = doc.select(p["header"])
    year_text, y = doc.select(p["year_label"])
    require(h["page"] == y["page"] and year_text == str(year), "CURRENT_YEAR_COLUMN")
    month = calendar.month_name[quarter * 3]
    day = calendar.monthrange(year, quarter * 3)[1]
    require(re.fullmatch(r"three months ended " + month + r"\s+" + str(day) + r",?",
                         header, re.I) is not None, "DIRECT_THREE_MONTH_HEADER")
    axis = p["column_x"]
    require(type(axis) is list and len(axis) == 2 and all(type(v) in (int, float)
            and math.isfinite(v) for v in axis), "COLUMN_BOUNDS")
    a, b = axis
    require(0 <= a < b <= doc.page(h["page"])[0].width
            and a <= y["bbox"][0] < y["bbox"][2] <= b
            and h["bbox"][1] <= y["bbox"][1]
            and h["bbox"][0] <= (a + b) / 2 <= h["bbox"][2], "COLUMN_HEADER_ALIGNMENT")
    return {"year": year, "quarter": quarter, "header": h, "year_label": y,
            "column_x": axis, "period_start": f"{year}-{quarter * 3 - 2:02d}-01",
            "period_end": f"{year}-{quarter * 3:02d}-{day:02d}"}


def number(doc: Document, cell: object, fmt: str) -> tuple[Decimal, str, int]:
    lexical, _ = doc.select(cell, label=False)
    require(fmt in ("decimal_dot", "comma_dot"), "NUMBER_FORMAT")
    integer = r"\d{1,40}" if fmt == "decimal_dot" else r"(?:\d{1,3}(?:,\d{3}){1,12}|\d{1,40})"
    require(re.fullmatch(r"-?" + integer + r"(?:\.\d{1,12})?", lexical) is not None,
            "NUMERIC_CELL_FORMAT")
    value = Decimal(lexical.replace(",", ""))
    decimals = len(lexical.split(".")[1]) if "." in lexical else 0
    return value, lexical, decimals


def aligned(cell: dict, label: dict, p: dict) -> None:
    require(cell["page"] == label["page"] == p["header"]["page"], "CELL_PERIOD_PAGE")
    x0, top, x1, bottom = cell["bbox"]
    require(p["column_x"][0] <= x0 < x1 <= p["column_x"][1]
            and top > p["year_label"]["bbox"][3], "CELL_CURRENT_COLUMN")
    require(label["bbox"][2] < x0 and label["bbox"][1] - 3 <= (top + bottom) / 2
            <= label["bbox"][3] + 3, "CELL_LABEL_ALIGNMENT")


def revenue_scale(unit: str, currency: str) -> str:
    """Recognise an explicit, narrow unit sentence, never default over a scale."""
    value = norm(unit).lower().strip("() ")
    scales = re.findall(r"\b(thousand|million|billion)s?\b", value)
    require(len(scales) <= 1, "REVENUE_SCALE_AMBIGUOUS")
    currency_words = "(?:" + "|".join(re.escape(t) for t in CURRENCIES[currency]) + ")"
    match = re.fullmatch(
        r"(?:amounts(?: are expressed)? in |unit:\s*|in )?"
        r"(?:(thousands?|millions?|billions?) of )?" + currency_words
        + r"(?:,? (?:except for earnings per share|unless otherwise stated))?", value)
    require(match is not None, "REVENUE_SCALE_NOT_PROVEN")
    scale = match.group(1)
    return "1" if scale is None else {"thousand": "1000", "million": "1000000",
                                      "billion": "1000000000"}[scale.rstrip("s")]


def extract(root: PrivateRoot, descriptor: Path, descriptor_sha256: str,
            allowed_hosts: frozenset[str], limits: Limits = Limits()) -> dict:
    started = time.monotonic()
    raw = root.read(descriptor, limits.json_bytes)
    require(digest(raw) == checked_sha(descriptor_sha256), "DESCRIPTOR_SHA_MISMATCH")
    d = keys(bounded_json(raw, limits.json_bytes, limits),
             {"contract", "entity", "source", "period", "issuer_name", "identity", "accounting", "metrics"})
    require(d["contract"] == CONTRACT, "DESCRIPTOR_CONTRACT")
    require(re.fullmatch(r"[A-Za-z0-9_.-]{1,32}", text(d["entity"], 32)) is not None, "ENTITY")
    source = keys(d["source"], {"path", "url", "sha256", "receipt"})
    url = urlsplit(text(source["url"]))
    require(url.scheme == "https" and url.hostname in allowed_hosts and url.username is None
            and url.password is None and url.port in (None, 443) and not url.fragment,
            "SOURCE_HOST_OR_URL")
    receipt = keys(source["receipt"], {"path", "sha256", "entry_pointer"})
    rr = root.read(Path(text(receipt["path"])), limits.receipt_bytes)
    require(digest(rr) == checked_sha(receipt["sha256"]), "RECEIPT_SHA_MISMATCH")
    entry = pointer(bounded_json(rr, limits.receipt_bytes, limits), receipt["entry_pointer"])
    require(entry.get("url") == source["url"] and entry.get("sha256") == checked_sha(source["sha256"])
            and entry.get("raw_path") == source["path"] and entry.get("http_status") == 200,
            "RECEIPT_SOURCE_BINDING")
    first, available = timestamp(entry.get("first_seen_at")), timestamp(entry.get("available_at"))
    require(first <= available <= datetime.now(timezone.utc), "RECEIPT_TIME_ORDER")
    if entry.get("source_received_at") is not None:
        require(timestamp(entry["source_received_at"]) <= available, "RECEIPT_TIME_ORDER")
    pdf_data = root.read(Path(text(source["path"])), limits.pdf_bytes)
    require(digest(pdf_data) == source["sha256"], "PDF_SHA_MISMATCH")
    verified = clock()
    doc = Document(pdf_data, limits, started)
    try:
        p = period(doc, d["period"])
        issuer_name, _ = doc.select(d["issuer_name"])
        require(len(issuer_name) <= 256, "ISSUER_NAME_BOUND")
        identity, _ = doc.select(d["identity"])
        require(re.search(r"\bconsolidated\b", identity, re.I) is not None
                and re.search(r"\b(?:not|no)\b|\b(?:un|non)[\s-]*consolidated\b",
                              identity, re.I) is None, "CONSOLIDATED_IDENTITY")
        accounting = keys(d["accounting"], {"classification", "proof"})
        require(re.fullmatch(r"[A-Z][A-Z0-9_]{0,79}", text(accounting["classification"], 80)) is not None,
                "ACCOUNTING_CLASSIFICATION")
        doc.select(accounting["proof"])
        require(type(d["metrics"]) is list and 1 <= len(d["metrics"]) <= 2, "METRIC_COUNT")
        result, seen = [], set()
        for raw_metric in d["metrics"]:
            m = keys(raw_metric, {"metric", "label", "cell", "currency", "multiplier",
                                 "unit_proof", "numeric_format"}, {"share_proof"})
            metric = m["metric"]
            require(metric in ("revenue", "basic_eps") and metric not in seen, "METRIC_KIND")
            seen.add(metric)
            label, label_loc = doc.select(m["label"])
            require((metric == "revenue" and re.fullmatch(r"net sales|revenue|revenues", label, re.I) is not None)
                    or (metric == "basic_eps" and re.fullmatch(r"basic earnings per share(?: \(in new taiwan dollars\)| \(NT\$\))?", label, re.I) is not None),
                    "METRIC_LABEL_NOT_EQUIVALENT")
            value, lexical, decimals = number(doc, m["cell"], m["numeric_format"])
            aligned(m["cell"], label_loc, p)
            unit, unit_locator = doc.select(m["unit_proof"])
            require(m["currency"] in CURRENCIES and any(t in unit.lower() for t in CURRENCIES[m["currency"]]),
                    "CURRENCY_NOT_PROVEN")
            require(type(m["multiplier"]) is str and m["multiplier"] in MULTIPLIERS, "MULTIPLIER")
            if metric == "revenue":
                require("share_proof" not in m and revenue_scale(unit, m["currency"]) == m["multiplier"],
                        "REVENUE_SCALE_NOT_PROVEN")
                share = None
            else:
                require(m["multiplier"] == "1" and "per share" in label.lower(), "EPS_SCALING")
                # This bounded proof dialect uses explicit NT$ numerator/note labels.
                # A USD label elsewhere in the same PDF is not an EPS currency proof.
                require(m["currency"] == "TWD" and unit_locator == label_loc
                        and re.search(r"\((?:in new taiwan dollars|NT\$)\)", label, re.I) is not None,
                        "EPS_CURRENCY_PROOF_CONFLICT")
                proof = keys(m.get("share_proof"), {"period", "policy", "numerator_label", "numerator_cell",
                    "numerator_multiplier", "denominator_label", "denominator_cell", "eps_label", "eps_cell"})
                np = period(doc, proof["period"])
                require((np["year"], np["quarter"]) == (p["year"], p["quarter"]), "NOTE_PERIOD_CONFLICT")
                policy, _ = doc.select(proof["policy"])
                require(re.search(r"basic earnings per share.*attributable to ordinary equity owners of the parent.*weighted average number of ordinary shares", policy, re.I) is not None,
                        "ORDINARY_POLICY_NOT_PROVEN")
                numerator_label, nl = doc.select(proof["numerator_label"])
                denominator_label, dl = doc.select(proof["denominator_label"])
                require(re.search(r"profit attributable to ordinary equity owners of the parent", numerator_label, re.I) is not None
                        and "thousand NT$" in numerator_label and proof["numerator_multiplier"] == "1000", "ORDINARY_NUMERATOR_NOT_PROVEN")
                require(re.fullmatch(r"weighted average number of ordinary shares outstanding for basic earnings per share \(share\)", denominator_label, re.I) is not None,
                        "ORDINARY_DENOMINATOR_NOT_PROVEN")
                neps_label, el = doc.select(proof["eps_label"])
                require(re.fullmatch(r"basic earnings per share \(NT\$\)", neps_label, re.I) is not None, "NOTE_BASIC_LABEL")
                for cell, lab in ((proof["numerator_cell"], nl), (proof["denominator_cell"], dl), (proof["eps_cell"], el)):
                    doc.select(cell, label=False)
                    aligned(cell, lab, np)
                num, _, _ = number(doc, proof["numerator_cell"], "comma_dot")
                den, _, _ = number(doc, proof["denominator_cell"], "comma_dot")
                neps, _, nd = number(doc, proof["eps_cell"], m["numeric_format"])
                require(den > 0 and neps == value and nd == decimals, "STATEMENT_NOTE_EPS_CONFLICT")
                with localcontext() as ctx:
                    ctx.prec = 80
                    require((num * 1000 / den).quantize(Decimal(1).scaleb(-decimals), rounding=ROUND_HALF_UP) == value,
                            "EPS_DENOMINATOR_FORMULA_CONFLICT")
                share = {"share_class": "ORDINARY", "eps_basis": "BASIC", "proof": proof,
                         "denominator_formula_checked": True}
            with localcontext() as ctx:
                ctx.prec = 80
                multiplier = Decimal(m["multiplier"])
                scaled = value * multiplier
                resolution = Decimal(1).scaleb(-decimals) * multiplier
            result.append({"entity": d["entity"], "metric": metric, "value_decimal": str(scaled),
                "reported_lexical": lexical, "currency": m["currency"], "multiplier": m["multiplier"],
                "unit": m["currency"] + ("/ordinary_share" if metric == "basic_eps" else ""),
                "display_resolution_decimal": str(resolution), "precision_kind": "DISPLAYED_NOT_EXACT",
                "period_basis": "DIRECT_THREE_MONTHS", "fiscal_period": f"{p['year']}Q{p['quarter']}",
                "period_start": p["period_start"], "period_end": p["period_end"], "scope": "CONSOLIDATED",
                "label": m["label"], "cell": m["cell"], "unit_proof": m["unit_proof"],
                "share_proof": share, "source_sha256": source["sha256"],
                "symbol_to_issuer_mapping_reviewed": False,
                "accounting_classification_reviewed": False,
                "source_admission": False, "quality_admission": False, "member_publication": False})
        require(time.monotonic() - started <= limits.seconds, "PARSE_DEADLINE")
        completed = clock()
        return {"contract": "issuer-pdf-descriptor-candidate-v1", "descriptor_sha256": digest(raw),
            "descriptor_is_approval": False, "entity": d["entity"], "source_url": source["url"],
            "issuer_name": issuer_name, "issuer_name_locator": d["issuer_name"],
            "symbol_to_issuer_mapping_reviewed": False, "accounting_classification_reviewed": False,
            "private_operator_only": True, "untrusted_service_sandbox": False,
            "source_path": source["path"], "source_sha256": source["sha256"], "source_bytes": len(pdf_data),
            "receipt_path": receipt["path"], "receipt_sha256": receipt["sha256"],
            "receipt_entry_pointer": receipt["entry_pointer"], "first_seen_at": entry["first_seen_at"],
            "source_received_at": entry.get("source_received_at"),
            "source_available_at": entry["available_at"], "first_verified_at": verified,
            "normalization_available_at": completed, "conservative_available_at": completed,
            "time_quality": "NATIVE_RECEIPT_BOUND_AND_CURRENT_NORMALIZATION_NOT_PUBLICATION",
            "announced_at": None, "source_version": None, "revision_chain": None,
            "accounting": accounting, "period_evidence": p, "rows": result,
            "ytd_or_annual_subtraction_used": False, "canonical_writer_invoked": False,
            "source_admission": False, "quality_admission": False, "member_publication": False,
            "legal_reuse_approval": None}
    finally:
        doc.close()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--private-root", required=True, type=Path)
    parser.add_argument("--descriptor", required=True, type=Path)
    parser.add_argument("--descriptor-sha256", required=True)
    parser.add_argument("--source-host", required=True, action="append")
    parser.add_argument("--outdir", required=True, type=Path)
    parser.add_argument("--output-name", required=True)
    args = parser.parse_args(argv)
    root = None
    old_handler = signal.getsignal(signal.SIGALRM)
    def timeout(_signum, _frame):
        raise DescriptorError("PARSE_DEADLINE")
    try:
        signal.signal(signal.SIGALRM, timeout)
        signal.setitimer(signal.ITIMER_REAL, Limits().seconds)
        require(all(re.fullmatch(r"[a-z0-9]+(?:[.-][a-z0-9]+)*", h) for h in args.source_host), "HOST_ALLOWLIST")
        root = PrivateRoot(args.private_root)
        result = extract(root, args.descriptor, args.descriptor_sha256, frozenset(args.source_host))
        raw = (json.dumps(result, ensure_ascii=False, indent=2) + "\n").encode()
        path = root.write_new(args.outdir, args.output_name, raw)
        print(json.dumps({"status": "CANDIDATE_ONLY", "output": str(path), "sha256": digest(raw),
                          "row_count": len(result["rows"]), "source_admission": False,
                          "quality_admission": False, "member_publication": False}))
        return 0
    except DescriptorError as exc:
        print(json.dumps({"status": "REJECTED", "code": str(exc)}))
        return 2
    except Exception:
        print(json.dumps({"status": "REJECTED", "code": "LOCAL_IO_OR_PDF_ERROR"}))
        return 2
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, old_handler)
        if root is not None:
            root.close()


if __name__ == "__main__":
    raise SystemExit(main())
