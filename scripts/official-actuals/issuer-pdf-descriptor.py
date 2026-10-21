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
Q4_CONTRACT = "issuer-pdf-direct-q4-annual-policy-v1"
INTERIM_CONTRACT = "issuer-pdf-direct-interim-common-note-v1"
INTERIM_FLOW_CONTRACT = "issuer-pdf-direct-interim-content-flow-v1"
Q4_SHARE_PROOF = "reviewed-annual-ordinary-policy-v1"
BROWSER_RECEIPT = "BROWSER_NATIVE_PUBLIC_DOWNLOAD_RECEIPT_V1"
LINK_RECEIPT = "BROWSER_PUBLIC_LINK_DOWNLOAD_RECEIPT_V1"
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


def bind_receipt(document: object, source: dict, selector: str,
                 allowed_hosts: frozenset[str], fiscal: dict) -> tuple[dict, dict]:
    """Strict single native capture, not document-URL or source authority.

    Native unknown HTTP is never converted to a successful HTTP observation.
    No hidden form material or provider headers are accepted in this dialect.
    """
    entry = pointer(document, selector)
    if type(document) is dict and document.get("contract") == LINK_RECEIPT:
        return bind_link_receipt(document, source, selector, allowed_hosts, fiscal)
    native = type(document) is dict and document.get("contract") == BROWSER_RECEIPT
    if not native:
        require(not any(k in entry for k in ("capture_method", "download_status",
            "visible_control", "source_url_role", "secret_or_hidden_form_material_exported",
            "provider_response_headers_exported")), "RECEIPT_KIND")
        require(entry.get("url") == source["url"]
                and entry.get("sha256") == checked_sha(source["sha256"])
                and entry.get("raw_path") == source["path"]
                and type(entry.get("http_status")) is int and entry["http_status"] == 200,
                "RECEIPT_SOURCE_BINDING")
        require("http_status_observed" not in entry or entry["http_status_observed"] is True,
                "RECEIPT_HTTP_OBSERVATION")
        return entry, {"capture_kind": "HTTP_RESPONSE_RECEIPT", "http_status": 200,
            "http_status_observed": True, "source_url_role": "DOCUMENT_HTTP_RESPONSE_URL",
            "source_page_url": None, "raw_document_url": source["url"],
            "first_seen_basis": "NATIVE_HTTP_RECEIPT", "native_capture": None}
    envelope = keys(document, {"contract", "source_admission", "quality_admission",
                               "member_publication", "results"})
    require(all(envelope[k] is False for k in
                ("source_admission", "quality_admission", "member_publication")), "NATIVE_ADMISSION_FLAGS")
    require(type(envelope["results"]) is list and len(envelope["results"]) == 1
            and selector == "/results/0", "NATIVE_SINGLE_CAPTURE")
    keys(entry, {"capture_method", "download_status", "url", "source_url_role", "raw_document_url",
        "request_method", "visible_control", "raw_path", "sha256", "bytes", "http_status",
        "http_status_observed", "first_seen_at", "first_seen_basis", "available_at",
        "copy_verified_at", "published_at", "source_version", "revision_chain",
        "secret_or_hidden_form_material_exported", "provider_response_headers_exported"})
    require(entry["capture_method"] == "BROWSER_NATIVE_PUBLIC_DOWNLOAD"
            and entry["request_method"] == "NATIVE_FORM_POST", "NATIVE_CAPTURE_KIND")
    require(entry["download_status"] == "COMPLETED", "NATIVE_DOWNLOAD_NOT_COMPLETED")
    require(entry["http_status"] is None and entry["http_status_observed"] is False,
            "NATIVE_HTTP_MUST_BE_UNKNOWN")
    require(entry["source_url_role"] == "SOURCE_INDEX_WITH_VISIBLE_DOWNLOAD_CONTROL"
            and entry["raw_document_url"] is None, "NATIVE_URL_ROLE")
    require(entry["secret_or_hidden_form_material_exported"] is False
            and entry["provider_response_headers_exported"] is False, "NATIVE_PRIVATE_EXPORT_FORBIDDEN")
    require(all(entry[k] is None for k in ("published_at", "source_version", "revision_chain")),
            "NATIVE_UNOBSERVED_SOURCE_METADATA")
    page = urlsplit(text(entry["url"]))
    require(page.scheme == "https" and page.hostname in allowed_hosts and not page.fragment
            and page.username is None and page.password is None and page.port in (None, 443)
            and bool(page.path) and not page.path.lower().endswith(".pdf"), "NATIVE_PAGE_URL")
    require(entry["url"] == source["url"] and entry["raw_path"] == source["path"]
            and entry["sha256"] == checked_sha(source["sha256"]), "NATIVE_SOURCE_BINDING")
    require(type(entry["bytes"]) is int and entry["bytes"] > 0, "NATIVE_BYTE_COUNT")
    control = keys(entry["visible_control"], {"id", "row_label", "role"})
    require(type(control["id"]) is str
            and re.fullmatch(r"[A-Za-z][A-Za-z0-9_.:-]{0,127}", control["id"]) is not None
            and control["role"] == "button", "NATIVE_VISIBLE_CONTROL")
    require(type(fiscal) is dict and type(fiscal.get("year")) is int
            and type(fiscal.get("quarter")) is int
            and control["row_label"] == f"FY{fiscal['year']}_Q{fiscal['quarter']} Consolidated Financial Statements",
            "NATIVE_VISIBLE_CONTROL_PERIOD")
    require(entry["first_seen_basis"] == "CONSERVATIVE_FIRST_OBSERVATION_AFTER_BROWSER_NATIVE_DOWNLOAD",
            "NATIVE_FIRST_SEEN_BASIS")
    first, available = timestamp(entry["first_seen_at"]), timestamp(entry["available_at"])
    require(first <= available == timestamp(entry["copy_verified_at"])
            <= datetime.now(timezone.utc), "NATIVE_TIME_ORDER")
    return entry, {"capture_kind": BROWSER_RECEIPT, "http_status": None,
        "http_status_observed": False, "source_url_role": entry["source_url_role"],
        "source_page_url": entry["url"], "raw_document_url": None,
        "first_seen_basis": entry["first_seen_basis"],
        "native_capture": {"capture_method": entry["capture_method"],
            "request_method": entry["request_method"], "download_status": entry["download_status"],
            "visible_control": control, "copy_verified_at": entry["copy_verified_at"],
            "secret_or_hidden_form_material_exported": False,
            "provider_response_headers_exported": False}}


def bind_link_receipt(document: dict, source: dict, selector: str,
                      allowed_hosts: frozenset[str], fiscal: dict) -> tuple[dict, dict]:
    """A visible public PDF link is not a witnessed HTTP response or form POST.

    Keep unknown transport/status/publication unknown. This private receipt
    dialect cannot grant source authority or approve any use of the document.
    """
    envelope = keys(document, {"contract", "source_admission", "quality_admission",
                               "member_publication", "results"})
    require(all(envelope[k] is False for k in
                ("source_admission", "quality_admission", "member_publication")), "LINK_ADMISSION_FLAGS")
    require(type(envelope["results"]) is list and len(envelope["results"]) == 1
            and selector == "/results/0", "LINK_SINGLE_CAPTURE")
    entry = keys(envelope["results"][0], {"capture_method", "download_status", "url", "request_method",
        "source_page_url", "visible_link", "raw_path", "sha256", "bytes", "http_status",
        "http_status_observed", "first_seen_at", "first_seen_basis", "available_at", "copy_verified_at",
        "published_at", "source_version", "revision_chain", "secret_or_hidden_form_material_exported",
        "provider_response_headers_exported"})
    require(entry["capture_method"] == "BROWSER_PUBLIC_LINK_DOWNLOAD"
            and entry["request_method"] == "UNOBSERVED" and entry["download_status"] == "COMPLETED",
            "LINK_CAPTURE_KIND")
    require(entry["http_status"] is None and entry["http_status_observed"] is False,
            "LINK_HTTP_MUST_BE_UNKNOWN")
    require(entry["secret_or_hidden_form_material_exported"] is False
            and entry["provider_response_headers_exported"] is False, "LINK_PRIVATE_EXPORT_FORBIDDEN")
    require(all(entry[k] is None for k in ("published_at", "source_version", "revision_chain")),
            "LINK_UNOBSERVED_SOURCE_METADATA")
    for field in ("url", "source_page_url"):
        u = urlsplit(text(entry[field]))
        require(u.scheme == "https" and u.hostname in allowed_hosts and not u.fragment
                and u.username is None and u.password is None and u.port in (None, 443)
                and bool(u.path), "LINK_SOURCE_URL")
    require(urlsplit(entry["url"]).path.lower().endswith(".pdf")
            and not urlsplit(entry["source_page_url"]).path.lower().endswith(".pdf"), "LINK_URL_ROLE")
    require(entry["url"] == source["url"] and entry["raw_path"] == source["path"]
            and entry["sha256"] == checked_sha(source["sha256"]), "LINK_SOURCE_BINDING")
    require(type(entry["bytes"]) is int and entry["bytes"] > 0, "LINK_BYTE_COUNT")
    link = keys(entry["visible_link"], {"role", "label", "href"})
    require(link["role"] == "link" and link["href"] == entry["url"]
            and type(fiscal) is dict and type(fiscal.get("quarter")) is int
            and type(fiscal.get("year")) is int
            and link["label"] == f"download {fiscal['quarter']}Q {fiscal['year']}", "LINK_VISIBLE_PERIOD")
    require(entry["first_seen_basis"] == "CONSERVATIVE_FIRST_OBSERVATION_AFTER_BROWSER_LINK_DOWNLOAD",
            "LINK_FIRST_SEEN_BASIS")
    require(timestamp(entry["first_seen_at"]) <= timestamp(entry["available_at"])
            == timestamp(entry["copy_verified_at"]) <= datetime.now(timezone.utc), "LINK_TIME_ORDER")
    return entry, {"capture_kind": LINK_RECEIPT, "http_status": None, "http_status_observed": False,
        "source_url_role": "DOCUMENT_LINK_ON_OFFICIAL_INDEX", "source_page_url": entry["source_page_url"],
        "raw_document_url": entry["url"], "first_seen_basis": entry["first_seen_basis"],
        "native_capture": {"capture_method": entry["capture_method"], "request_method": "UNOBSERVED",
            "download_status": "COMPLETED", "visible_link": link, "copy_verified_at": entry["copy_verified_at"],
            "secret_or_hidden_form_material_exported": False, "provider_response_headers_exported": False}}


class Document:
    def __init__(self, data: bytes, limits: Limits, started: float):
        self.limits, self.started = limits, started
        require(data.startswith(b"%PDF-"), "PDF_MAGIC")
        reader = PdfReader(BytesIO(data), strict=True)
        require(not reader.is_encrypted, "PDF_ENCRYPTED")
        require(0 < len(reader.pages) <= limits.pages, "PDF_PAGE_LIMIT")
        self.reader = reader
        self.pdf = pdfplumber.open(BytesIO(data))
        self.cache = {}
        self.content_flow = False

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
            # A separate descriptor version may preserve the PDF's native text
            # stream order. It does not remove spaces, infer glyphs or OCR text;
            # the same exact-label, geometry and single-token controls follow.
            words = pg.extract_words(use_text_flow=True) if self.content_flow else pg.extract_words()
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


def period(doc: Document, obj: object, *, direct_q4: bool = False, interim: bool = False) -> dict:
    p = keys(obj, {"year", "quarter", "header", "column_x",
                   "quarter_label" if direct_q4 else "year_label"})
    year, quarter = p["year"], p["quarter"]
    require(type(year) is int and 2000 <= year <= 2100 and type(quarter) is int
            and 1 <= quarter <= 4, "FISCAL_PERIOD")
    header, h = doc.select(p["header"])
    year_text, y = doc.select(p["quarter_label"] if direct_q4 else p["year_label"])
    if direct_q4:
        require(quarter == 4 and h["page"] == y["page"] and year_text == f"4Q {year}",
                "CURRENT_Q4_COLUMN")
    else:
        require(h["page"] == y["page"] and year_text == str(year), "CURRENT_YEAR_COLUMN")
    month = calendar.month_name[quarter * 3]
    day = calendar.monthrange(year, quarter * 3)[1]
    if direct_q4:
        require(re.fullmatch(r"For the Fourth quarter of year " + str(year), header, re.I)
                is not None, "DIRECT_Q4_HEADER")
    else:
        require(re.fullmatch((r"(?:for the )?three-month periods ended " if interim else r"(?:for the )?three months ended ") + month + r"\s+" + str(day) + r",?",
                             header, re.I) is not None, "DIRECT_THREE_MONTH_HEADER")
    axis = p["column_x"]
    require(type(axis) is list and len(axis) == 2 and all(type(v) in (int, float)
            and math.isfinite(v) for v in axis), "COLUMN_BOUNDS")
    a, b = axis
    require(0 <= a < b <= doc.page(h["page"])[0].width
            and a <= y["bbox"][0] < y["bbox"][2] <= b
            and h["bbox"][1] <= y["bbox"][1]
            and h["bbox"][0] <= (a + b) / 2 <= h["bbox"][2], "COLUMN_HEADER_ALIGNMENT")
    if interim:
        require(quarter in (1, 2, 3), "INTERIM_QUARTER")
        words = doc.page(y["page"])[1]
        years = sorted([w for w in words if y["bbox"][1] - 2 <= w["top"] <= y["bbox"][3] + 2
                        and re.fullmatch(r"20\d{2}", w["text"])], key=lambda w: w["x0"])
        require(len(years) in (2, 4) and [w["text"] for w in years] == [str(year), str(year - 1)] * (len(years) // 2)
                and y["bbox"][0] <= years[0]["x0"] and years[0]["x1"] <= y["bbox"][2],
                "INTERIM_CURRENT_YEAR_NOT_FIRST")
        gap = (years[1]["x0"] - years[0]["x1"]) / 2
        require(gap > 0, "INTERIM_YEAR_COLUMN_OVERLAP")
        interim_axis = [max(0, years[0]["x0"] - gap), years[0]["x1"] + gap]
        table_headers = [w for w in words if y["bbox"][3] < w["top"] <= y["bbox"][3] + 30
                         and interim_axis[0] <= w["x0"] < w["x1"] <= interim_axis[1]]
        amounts = [w for w in table_headers if w["text"].upper() == "AMOUNT"]
        ratios = [w for w in table_headers if w["text"] == "%"]
        require(len(amounts) == len(ratios) == 1 and amounts[0]["x1"] < ratios[0]["x0"]
                and abs(amounts[0]["top"] - ratios[0]["top"]) <= 2, "INTERIM_AMOUNT_HEADERS")
        # Native EPS rows span the AMOUNT/% subcolumns, so retain their separate
        # note reconciliation. Revenue must stay left of the actual % header.
        amount_axis = [interim_axis[0], ratios[0]["x0"]]
    if direct_q4:
        words = doc.page(h["page"])[1]
        markers = [w for w in words
                   if y["bbox"][1] - 2 <= w["top"] <= y["bbox"][3] + 2
                   and re.fullmatch(r"[1-4]Q(?: 20\d{2})?", w["text"])
                   and a <= (w["x0"] + w["x1"]) / 2 <= b]
        require(len(markers) == 1 and y["bbox"][0] <= markers[0]["x0"]
                and markers[0]["x1"] <= y["bbox"][2], "Q4_COLUMN_NOT_ISOLATED")
        # Derive the actual column from native header tokens, not descriptor
        # padding/column_x. Ratio headers are column neighbours too.
        selected = [w for w in words if w["x0"] >= y["bbox"][0] - .05
                    and w["x1"] <= y["bbox"][2] + .05 and w["top"] >= y["bbox"][1] - .05
                    and w["bottom"] <= y["bbox"][3] + .05]
        require(bool(selected) and max(w["top"] for w in selected)
                - min(w["top"] for w in selected) <= 2, "Q4_COLUMN_NOT_ISOLATED")
        left, right = min(w["x0"] for w in selected), max(w["x1"] for w in selected)
        top, bottom = min(w["top"] for w in selected), max(w["bottom"] for w in selected)
        neighbours = [w for w in words if w not in selected and top - 2 <= w["top"] <= bottom + 2
                      and re.fullmatch(r"[1-4]Q(?: 20\d{2})?|(?:YoY|QoQ)%?", w["text"], re.I)]
        require(all(w["x1"] <= left or w["x0"] >= right for w in neighbours),
                "Q4_COLUMN_NOT_ISOLATED")
        before, after = [w["x1"] for w in neighbours if w["x1"] <= left], [w["x0"] for w in neighbours if w["x0"] >= right]
        native_axis = [(max(before) + left) / 2 if before else left,
                       (right + min(after)) / 2 if after else right]
    return {"year": year, "quarter": quarter, "header": h, "year_label": y,
            **({"quarter_label": y, "native_actual_column_x": native_axis} if direct_q4 else {}),
            **({"native_interim_column_x": interim_axis, "native_amount_column_x": amount_axis} if interim else {}),
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
    if "native_actual_column_x" in p:
        require(p["native_actual_column_x"][0] <= x0 < x1 <= p["native_actual_column_x"][1],
                "CELL_Q4_ACTUAL_COLUMN")
    if "native_interim_column_x" in p:
        require(p["native_interim_column_x"][0] <= x0 < x1 <= p["native_interim_column_x"][1],
                "CELL_INTERIM_ACTUAL_COLUMN")
    require(label["bbox"][2] < x0 and label["bbox"][1] - 3 <= (top + bottom) / 2
            <= label["bbox"][3] + 3, "CELL_LABEL_ALIGNMENT")


def revenue_scale(unit: str, currency: str, *, interim: bool = False) -> str:
    """Recognise an explicit, narrow unit sentence, never default over a scale."""
    value = norm(unit).lower().strip("() ")
    if interim and currency == "TWD" and value in ("expressed in thousands of new taiwan dollars, except for earnings per share amount",
                                                    "expressed in thousands of new taiwan dollars, except for earnings per share"):
        return "1000"
    scales = re.findall(r"\b(thousand|million|billion)s?\b", value)
    require(len(scales) <= 1, "REVENUE_SCALE_AMBIGUOUS")
    currency_words = "(?:" + "|".join(re.escape(t) for t in CURRENCIES[currency]) + ")"
    match = re.fullmatch(
        r"(?:amounts(?: are expressed| expressed)? in |unit:\s*|in )?"
        r"(?:(thousands?|millions?|billions?) of )?" + currency_words
        + r"(?:,? (?:except for earnings per share|unless otherwise stated))?", value)
    require(match is not None, "REVENUE_SCALE_NOT_PROVEN")
    scale = match.group(1)
    return "1" if scale is None else {"thousand": "1000", "million": "1000000",
                                      "billion": "1000000000"}[scale.rstrip("s")]


def note_decimal(doc: Document, cell: dict) -> tuple[Decimal, int]:
    """A native decimal may be split at a touching font run, not whitespace.

    Only this note dialect joins exactly integer + decimal suffix. Never join
    adjacent columns, signs, currencies, totals, exponents or arbitrary tokens.
    """
    try:
        v, _, places = number(doc, cell, "decimal_dot")
        return v, places
    except DescriptorError as exc:
        if str(exc) != "CELL_NOT_SINGLE_TOKEN":
            raise
    keys(cell, {"page", "bbox"})
    pg, words = doc.page(cell["page"])
    box = cell["bbox"]
    require(type(box) is list and len(box) == 4 and all(type(x) in (int, float) and math.isfinite(x) for x in box)
            and 0 <= box[0] < box[2] <= pg.width and 0 <= box[1] < box[3] <= pg.height, "LOCATOR_BOUNDS")
    chosen = sorted([w for w in words if box[0] - .05 <= w["x0"] and w["x1"] <= box[2] + .05
                     and box[1] - .05 <= w["top"] and w["bottom"] <= box[3] + .05], key=lambda w: w["x0"])
    require(len(chosen) == 2 and re.fullmatch(r"-?\d{1,40}", chosen[0]["text"])
            and re.fullmatch(r"\.\d{1,12}", chosen[1]["text"]), "NOTE_DECIMAL_TOKENS")
    require(abs(chosen[1]["x0"] - chosen[0]["x1"]) <= .05
            and abs(chosen[0]["top"] - chosen[1]["top"]) <= .05
            and abs(chosen[0]["bottom"] - chosen[1]["bottom"]) <= .05, "NOTE_DECIMAL_NOT_ADJACENT")
    value = chosen[0]["text"] + chosen[1]["text"]
    return Decimal(value), len(chosen[1]["text"]) - 1


def common_note(doc: Document, proof: object, p: dict, value: Decimal, decimals: int) -> dict:
    """Read, then reconcile a reported basic EPS; never calculate missing EPS."""
    q = keys(proof, {"kind", "period_header", "basic_label", "profit_label", "profit_cell",
        "share_header", "share_cell", "eps_header", "eps_cell", "diluted_label", "unit_context"})
    require(q["kind"] == "DIRECT_COMMON_SHARE_NOTE_V1", "NOTE_COMMON_KIND")
    loc = {k: doc.select(q[k]) for k in ("period_header", "basic_label", "profit_label",
                                        "share_header", "eps_header", "diluted_label", "unit_context")}
    month = calendar.month_name[p["quarter"] * 3]
    day = calendar.monthrange(p["year"], p["quarter"] * 3)[1]
    require(re.fullmatch(r"For the three-month period ended " + month + " " + str(day) + ", " + str(p["year"]),
                         loc["period_header"][0], re.I), "NOTE_DIRECT_PERIOD")
    require(loc["basic_label"][0].lower() == "basic earnings per share"
            and loc["diluted_label"][0].lower() == "diluted earnings per share"
            and loc["profit_label"][0].lower() == "profit attributable to common shareholders of the parent company",
            "NOTE_COMMON_ATTRIBUTION")
    require(loc["share_header"][0].lower() == "weighted average number of common shares outstanding (shares in thousands)",
            "NOTE_COMMON_SHARE_UNIT")
    require(loc["eps_header"][0].lower() == "earnings per share (in dollars)"
            and loc["unit_context"][0].lower().strip("() ") == "expressed in thousands of new taiwan dollars, except as otherwise indicated",
            "NOTE_TWD_UNIT_CONTEXT")
    page = q["period_header"]["page"]
    require(all(q[k]["page"] == page for k in q if k not in ("kind", "unit_context")), "NOTE_PAGE_CONFLICT")
    for k in ("profit_cell", "share_cell"):
        doc.select(q[k], label=False)
    # Basic row is bounded by source labels, not a guessed ordinal or matching
    # numeric equality with a diluted row or the prior-year table below it.
    basic, stop, profit = (q[k]["bbox"] for k in ("basic_label", "diluted_label", "profit_label"))
    for k in ("profit_cell", "share_cell", "eps_cell"):
        c = q[k]["bbox"]
        require(q["period_header"]["bbox"][3] < basic[1] < c[1] < c[3] < stop[1]
                and profit[1] - 3 <= (c[1] + c[3]) / 2 <= profit[3] + 3
                and profit[2] < c[0], "NOTE_BASIC_ROW_GEOMETRY")
    for field, header in (("share_cell", "share_header"), ("eps_cell", "eps_header")):
        c, h = q[field]["bbox"], q[header]["bbox"]
        require(q["period_header"]["bbox"][3] < h[1] < h[3] < basic[1]
                and h[0] <= (c[0] + c[2]) / 2 <= h[2], "NOTE_HEADER_ALIGNMENT")
    require(q["profit_cell"]["bbox"][2] < q["share_cell"]["bbox"][0]
            and q["share_cell"]["bbox"][2] < q["eps_cell"]["bbox"][0], "NOTE_COLUMN_ORDER")
    num, _, _ = number(doc, q["profit_cell"], "comma_dot")
    den, _, _ = number(doc, q["share_cell"], "comma_dot")
    eps, places = note_decimal(doc, q["eps_cell"])
    require(den > 0 and eps == value and places == decimals, "STATEMENT_NOTE_EPS_CONFLICT")
    with localcontext() as ctx:
        ctx.prec = 80
        # Numerator and denominator are both thousands; only reconcile the
        # displayed native EPS. Nothing is inferred from annual/YTD values.
        require((num / den).quantize(Decimal(1).scaleb(-decimals), rounding=ROUND_HALF_UP) == value,
                "EPS_DENOMINATOR_FORMULA_CONFLICT")
    return {"share_class": "ORDINARY", "eps_basis": "BASIC", "proof": q,
            "denominator_formula_checked": True, "numerator_multiplier": "1000", "denominator_multiplier": "1000",
            "native_eps_read": True, "missing_eps_computed": False}


def annual_policy(root: PrivateRoot, d: dict, issuer: str, allowed_hosts: frozenset[str],
                  limits: Limits, started: float, main_bytes: int, main_available: datetime) -> dict:
    """A separate, pinned reviewed-policy dialect; never annual EPS arithmetic.

    The existing independent review must bind BOTH originals and this quarter.
    Its presence is evidence, not installation of source/quality/rights authority.
    """
    a = keys(d["annual_policy_proof"], {"source", "issuer_name", "identity", "annual_period",
                                       "policy", "independent_review"})
    source = keys(a["source"], {"path", "url", "sha256", "receipt"})
    url = urlsplit(text(source["url"]))
    require(url.scheme == "https" and url.hostname in allowed_hosts
            and url.hostname == urlsplit(d["source"]["url"]).hostname
            and url.username is None and url.password is None and url.port in (None, 443)
            and not url.fragment, "ANNUAL_SOURCE_URL")
    require(source["path"] != d["source"]["path"]
            and source["sha256"] != d["source"]["sha256"], "ANNUAL_DISTINCT_ORIGINAL")
    receipt = keys(source["receipt"], {"path", "sha256", "entry_pointer"})
    rr = root.read(Path(text(receipt["path"])), limits.receipt_bytes)
    require(digest(rr) == checked_sha(receipt["sha256"]), "ANNUAL_RECEIPT_SHA")
    entry, capture = bind_receipt(bounded_json(rr, limits.receipt_bytes, limits), source,
                                 receipt["entry_pointer"], allowed_hosts, d["period"])
    first, available = timestamp(entry.get("first_seen_at")), timestamp(entry.get("available_at"))
    require(first <= available <= datetime.now(timezone.utc), "ANNUAL_RECEIPT_TIME")
    if entry.get("source_received_at") is not None:
        require(timestamp(entry["source_received_at"]) <= available, "ANNUAL_RECEIPT_TIME")
    data = root.read(Path(text(source["path"])), limits.pdf_bytes)
    require(digest(data) == checked_sha(source["sha256"]), "ANNUAL_SOURCE_SHA")
    require(type(entry.get("bytes")) is int and entry["bytes"] == len(data)
            and main_bytes + len(data) <= limits.pdf_bytes, "ANNUAL_SOURCE_BYTES")
    require(entry.get("period") == f"{d['period']['year']}Q4", "ANNUAL_RECEIPT_PERIOD")
    review = keys(a["independent_review"], {"path", "sha256", "entry_pointer"})
    raw = root.read(Path(text(review["path"])), limits.receipt_bytes)
    require(digest(raw) == checked_sha(review["sha256"]), "INDEPENDENT_REVIEW_SHA")
    q = bounded_json(raw, limits.receipt_bytes, limits)
    require(type(q) is dict and q.get("contract") == "INDEPENDENT_FINANCIAL_SOURCE_QUALITY_REVIEW_V1"
            and q.get("symbol") == d["entity"]
            and q.get("review_scope") == "DIRECT_QUARTER_REVENUE_AND_BASIC_ORDINARY_EPS_ONLY"
            and q.get("review_process") == "INDEPENDENT_OF_EXTRACTION_AND_RECOMMENDATION_ENGINE",
            "INDEPENDENT_REVIEW_IDENTITY")
    require(all(q.get(k) is False for k in ("source_admission", "quality_authority_installed",
            "member_publication", "canonical_write", "formal_v1_evaluation"))
            and q.get("legal_reuse_approval") is None, "INDEPENDENT_REVIEW_NOT_AUTHORITY")
    require(max(main_available, available) <= timestamp(q.get("recorded_at"))
            <= datetime.now(timezone.utc), "INDEPENDENT_REVIEW_TIME")
    r = pointer(q, review["entry_pointer"])
    require(r.get("period") == f"{d['period']['year']}Q4" and r.get("quality_status") == "QUALITY_PASS"
            and r.get("fields") == ["revenue", "basic_ordinary_eps"]
            and r.get("statement_sha256") == source["sha256"]
            and r.get("short_fs_sha256") == d["source"]["sha256"], "INDEPENDENT_REVIEW_BINDING")
    pages = r.get("evidence_pages")
    require(type(pages) is dict and all(type(pages.get(k)) is int for k in
            ("short_fs", "ordinary_eps_policy", "accounting"))
            and pages.get("short_fs") == d["period"]["header"]["page"]
            and pages.get("ordinary_eps_policy") == a["policy"]["page"]
            and pages.get("accounting") == d["accounting"]["proof"]["page"],
            "INDEPENDENT_REVIEW_PAGES")
    doc = Document(data, limits, started)
    try:
        name, _ = doc.select(a["issuer_name"])
        require(name == issuer, "ANNUAL_ISSUER_CONFLICT")
        identity, _ = doc.select(a["identity"])
        require(re.search(r"\bconsolidated\b", identity, re.I) is not None
                and re.search(r"\b(?:not|no)\b|\b(?:un|non)[\s-]*consolidated\b", identity, re.I)
                is None, "ANNUAL_CONSOLIDATED_IDENTITY")
        annual, _ = doc.select(a["annual_period"])
        year = d["period"]["year"]
        require(re.fullmatch(r"(?:For the )?years ended December 31,? " + str(year)
                + r" and " + str(year - 1), annual, re.I) is not None, "ANNUAL_CALENDAR_YEAR")
        policy, _ = doc.select(a["policy"])
        require(re.fullmatch(r"Basic earnings per share is calculated by dividing net profit for the year "
            r"attributable to ordinary equity owners of the parent entity by the weighted average number "
            r"of ordinary shares outstanding during the year\.?", policy, re.I) is not None,
            "ANNUAL_ORDINARY_POLICY")
        accounting, _ = doc.select(d["accounting"]["proof"])
        require(re.fullmatch(r"The consolidated financial statements have been prepared in accordance with "
            r"(?:the Regulations Governing the Preparation of Financial Reports by Securities Issuers"
            r"(?: \([“\"]the Regulations[”\"]\))? and )?"
            r"IFRS as endorsed(?: and became effective)? by FSC\.?", accounting, re.I) is not None,
            "ANNUAL_IFRS_PROOF")
        require(len(doc.cache) + 1 <= limits.selected_pages, "SELECTED_PAGE_LIMIT")
    finally:
        doc.close()
    return {"kind": Q4_SHARE_PROOF, "source": source, "source_bytes": len(data),
        "issuer_name_locator": a["issuer_name"], "identity": a["identity"],
        "annual_period": a["annual_period"], "policy": a["policy"],
        "accounting_proof": d["accounting"]["proof"], "independent_review": review,
        "independent_review_recorded_at": q["recorded_at"],
        "first_seen_at": entry["first_seen_at"], "source_available_at": entry["available_at"],
        "source_received_at": entry.get("source_received_at"), **capture,
        "announced_at": None, "source_version": None, "revision_chain": None,
        "review_is_admission": False, "annual_values_extracted": False,
        "source_admission": False, "quality_admission": False, "member_publication": False}


def extract(root: PrivateRoot, descriptor: Path, descriptor_sha256: str,
            allowed_hosts: frozenset[str], limits: Limits = Limits()) -> dict:
    started = time.monotonic()
    raw = root.read(descriptor, limits.json_bytes)
    require(digest(raw) == checked_sha(descriptor_sha256), "DESCRIPTOR_SHA_MISMATCH")
    obj = bounded_json(raw, limits.json_bytes, limits)
    q4 = type(obj) is dict and obj.get("contract") == Q4_CONTRACT
    interim = type(obj) is dict and obj.get("contract") in (INTERIM_CONTRACT, INTERIM_FLOW_CONTRACT)
    content_flow = type(obj) is dict and obj.get("contract") == INTERIM_FLOW_CONTRACT
    d = keys(obj, {"contract", "entity", "source", "period", "issuer_name", "identity", "accounting", "metrics"}
             | ({"annual_policy_proof"} if q4 else set()))
    require(d["contract"] in (CONTRACT, Q4_CONTRACT, INTERIM_CONTRACT, INTERIM_FLOW_CONTRACT), "DESCRIPTOR_CONTRACT")
    require(re.fullmatch(r"[A-Za-z0-9_.-]{1,32}", text(d["entity"], 32)) is not None, "ENTITY")
    source = keys(d["source"], {"path", "url", "sha256", "receipt"})
    url = urlsplit(text(source["url"]))
    require(url.scheme == "https" and url.hostname in allowed_hosts and url.username is None
            and url.password is None and url.port in (None, 443) and not url.fragment,
            "SOURCE_HOST_OR_URL")
    receipt = keys(source["receipt"], {"path", "sha256", "entry_pointer"})
    rr = root.read(Path(text(receipt["path"])), limits.receipt_bytes)
    require(digest(rr) == checked_sha(receipt["sha256"]), "RECEIPT_SHA_MISMATCH")
    entry, capture = bind_receipt(bounded_json(rr, limits.receipt_bytes, limits), source,
                                 receipt["entry_pointer"], allowed_hosts, d["period"])
    first, available = timestamp(entry.get("first_seen_at")), timestamp(entry.get("available_at"))
    require(first <= available <= datetime.now(timezone.utc), "RECEIPT_TIME_ORDER")
    if entry.get("source_received_at") is not None:
        require(timestamp(entry["source_received_at"]) <= available, "RECEIPT_TIME_ORDER")
    pdf_data = root.read(Path(text(source["path"])), limits.pdf_bytes)
    require(digest(pdf_data) == source["sha256"], "PDF_SHA_MISMATCH")
    if capture["capture_kind"] in (BROWSER_RECEIPT, LINK_RECEIPT):
        require(entry["bytes"] == len(pdf_data), "NATIVE_BYTE_COUNT")
    if q4:
        require(type(entry.get("bytes")) is int and entry["bytes"] == len(pdf_data)
                and entry.get("period") == f"{d['period']['year']}Q4", "Q4_RECEIPT_BINDING")
    verified = clock()
    doc = Document(pdf_data, limits, started)
    doc.content_flow = content_flow
    try:
        p = period(doc, d["period"], direct_q4=q4, interim=interim)
        issuer_name, _ = doc.select(d["issuer_name"])
        require(len(issuer_name) <= 256, "ISSUER_NAME_BOUND")
        identity, _ = doc.select(d["identity"])
        require(re.search(r"\bconsolidated\b", identity, re.I) is not None
                and re.search(r"\b(?:not|no)\b|\b(?:un|non)[\s-]*consolidated\b",
                              identity, re.I) is None, "CONSOLIDATED_IDENTITY")
        accounting = keys(d["accounting"], {"classification", "proof"})
        require(re.fullmatch(r"[A-Z][A-Z0-9_]{0,79}", text(accounting["classification"], 80)) is not None,
                "ACCOUNTING_CLASSIFICATION")
        annual = annual_policy(root, d, issuer_name, allowed_hosts, limits, started, len(pdf_data), available) if q4 else None
        if not q4:
            accounting_text, _ = doc.select(accounting["proof"])
            if interim:
                require(accounting["classification"] == "FSC_ENDORSED_IAS34_INTERIM"
                        and re.search(r"International Accounting Standard 34", accounting_text, re.I)
                        and re.search(r"Interim financial reporting", accounting_text, re.I)
                        and re.search(r"endorsed by (?:the )?FSC", accounting_text, re.I), "INTERIM_ACCOUNTING_PROOF")
        require(type(d["metrics"]) is list and 1 <= len(d["metrics"]) <= 2, "METRIC_COUNT")
        if q4 or interim:
            require([m.get("metric") for m in d["metrics"] if type(m) is dict] == ["revenue", "basic_eps"],
                    "Q4_METRIC_PAIR" if q4 else "INTERIM_METRIC_PAIR")
        result, seen = [], set()
        for raw_metric in d["metrics"]:
            m = keys(raw_metric, {"metric", "label", "cell", "currency", "multiplier",
                                 "unit_proof", "numeric_format"}, {"share_proof"} | ({"period"} if interim else set()))
            metric = m["metric"]
            require(metric in ("revenue", "basic_eps") and metric not in seen, "METRIC_KIND")
            seen.add(metric)
            label, label_loc = doc.select(m["label"])
            require((metric == "revenue" and re.fullmatch(
                        r"(?:net sales|revenue|revenues|operating revenue)(?: ?\(Notes? [A-Za-z0-9() ,]+\))?",
                        label, re.I) is not None)
                    or (metric == "basic_eps" and re.fullmatch(
                        r"basic earnings per share \(NTD\)" if q4 else r"basic earnings per share(?: \(in new taiwan dollars\)| \(NT\$\))?",
                        label, re.I) is not None),
                    "METRIC_LABEL_NOT_EQUIVALENT")
            value, lexical, decimals = number(doc, m["cell"], m["numeric_format"])
            mp = period(doc, m["period"], interim=True) if interim and "period" in m else p
            require((mp["year"], mp["quarter"]) == (p["year"], p["quarter"]), "METRIC_PERIOD_CONFLICT")
            aligned(m["cell"], label_loc, mp)
            unit, unit_locator = doc.select(m["unit_proof"])
            if q4:
                require(unit_locator["page"] == p["header"]["page"], "Q4_UNIT_PAGE")
            require(m["currency"] in CURRENCIES and any(t in unit.lower() for t in CURRENCIES[m["currency"]]),
                    "CURRENCY_NOT_PROVEN")
            require(type(m["multiplier"]) is str and m["multiplier"] in MULTIPLIERS, "MULTIPLIER")
            if metric == "revenue":
                if interim:
                    require(mp["native_amount_column_x"][0] <= m["cell"]["bbox"][0]
                            < m["cell"]["bbox"][2] <= mp["native_amount_column_x"][1],
                            "INTERIM_REVENUE_PERCENT_COLUMN")
                require("share_proof" not in m and revenue_scale(unit, m["currency"], interim=interim) == m["multiplier"],
                        "REVENUE_SCALE_NOT_PROVEN")
                share = None
            elif interim:
                require(unit_locator["page"] == m["cell"]["page"], "INTERIM_EPS_UNIT_PAGE")
                require(m["currency"] == "TWD" and m["multiplier"] == "1"
                        and label.lower() == "basic earnings per share"
                        and norm(unit).lower().strip("() ") in ("expressed in thousands of new taiwan dollars, except for earnings per share amount",
                                                               "expressed in thousands of new taiwan dollars, except for earnings per share"),
                        "INTERIM_EPS_CURRENCY_PROOF")
                share = common_note(doc, m.get("share_proof"), p, value, decimals)
            elif q4:
                require(m["currency"] == "TWD" and m["multiplier"] == "1"
                        and unit_locator == label_loc, "EPS_CURRENCY_PROOF_CONFLICT")
                proof = keys(m.get("share_proof"), {"kind"})
                require(proof["kind"] == Q4_SHARE_PROOF, "Q4_SHARE_PROOF_KIND")
                share = {"share_class": "ORDINARY", "eps_basis": "BASIC", "proof": proof,
                         "annual_policy_evidence": annual, "denominator_formula_checked": False,
                         "annual_eps_arithmetic_used": False}
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
                "period_basis": "DIRECT_SINGLE_QUARTER_AS_REPORTED" if q4 else "DIRECT_THREE_MONTHS", "fiscal_period": f"{p['year']}Q{p['quarter']}",
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
            **capture,
            "normalization_available_at": completed, "conservative_available_at": completed,
            "time_quality": "NATIVE_RECEIPT_BOUND_AND_CURRENT_NORMALIZATION_NOT_PUBLICATION",
            "announced_at": None, "source_version": None, "revision_chain": None,
            "accounting": accounting, "period_evidence": p, "rows": result,
            **({"descriptor_dialect": Q4_CONTRACT, "annual_policy_evidence": annual} if q4 else {}),
            **({"descriptor_dialect": d["contract"]} if interim else {}),
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
