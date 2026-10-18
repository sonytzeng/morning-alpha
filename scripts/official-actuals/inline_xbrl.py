"""Bounded, offline Inline XBRL direct-quarter extraction. No network or JS.

The output is a source candidate, not source admission, announcement timing,
ordinary-share verification, consensus, or a changed recommendation contract.
"""
from __future__ import annotations

import argparse
import calendar
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal, InvalidOperation, localcontext
import hashlib
from html import unescape
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import time
from typing import Any
from urllib.parse import parse_qsl, urlsplit

XBRLI = "http://www.xbrl.org/2003/instance"
IX = "http://www.xbrl.org/2013/inlineXBRL"
XHTML = "http://www.w3.org/1999/xhtml"
XBRLDI = "http://xbrl.org/2006/xbrldi"
XSI = "http://www.w3.org/2001/XMLSchema-instance"
ISO = "http://www.xbrl.org/2003/iso4217"
IXT = "http://www.xbrl.org/inlineXBRL/transformation/2015-02-26"
# Explicitly observed source profile. Never trust a prefix or auto-admit a URI.
IFRS_2025 = "https://xbrl.ifrs.org/taxonomy/2025-03-27/ifrs-full"
IFRS_2017 = "http://xbrl.ifrs.org/taxonomy/2017-03-09/ifrs-full"
# Observed in the retained tifrs-2020 and tifrs-2025/2026 instances respectively.
# This is a narrow direct-fact mapping, not a full downloaded taxonomy dictionary.
APPROVED_IFRS = frozenset({IFRS_2017, IFRS_2025})
METRICS = {"BasicEarningsLossPerShare": "basic_eps",
           "DilutedEarningsLossPerShare": "diluted_eps", "Revenue": "revenue"}
VOID = frozenset("area base br col embed hr img input link meta param source track wbr".split())
NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_.:-]*")
QNAME = re.compile(r"([A-Za-z_][A-Za-z0-9_.-]*):([A-Za-z_][A-Za-z0-9_.-]*)\Z")
# Explicit, non-default transport for three retained CP950 documents. Their
# isolated 0x84 bytes occur only inside this nonnumeric standards note. This
# never decodes, returns, or admits that note, or repairs the received bytes.
OPAQUE_NOTE_PROFILE = "cp950-opaque-standards-note-v1"
OPAQUE_NOTE_LOCAL = "ApplicationOfNewlyIssuedOrAmendedStandardsAndInterpretations"
OPAQUE_NOTE_NAMESPACES = frozenset({"http://www.xbrl.org/tifrs/notes/2025-06-30",
                                    "http://www.xbrl.org/tifrs/notes/2026-03-31"})
MAX_OPAQUE_INVALID_BYTES = 32
UNDECODABLE = re.compile(r"[\udc80-\udcff]")


class ExtractionError(ValueError):
    """Fail-closed source/receipt/protocol error, with a non-sensitive code."""


def require(condition: bool, code: str) -> None:
    if not condition:
        raise ExtractionError(code)


@dataclass(frozen=True)
class Limits:
    max_bytes: int = 8_000_000
    max_tags: int = 100_000
    max_depth: int = 192
    max_contexts: int = 6_000
    max_units: int = 256
    max_facts: int = 30_000
    max_capture_chars: int = 8_192
    max_tag_chars: int = 65_536
    seconds: float = 8.0


@dataclass
class Node:
    name: tuple[str, str]
    attrs: dict[str, str]
    namespaces: dict[str, str]
    children: list["Node"] = field(default_factory=list)
    text: list[str] = field(default_factory=list)
    direct_text: list[str] = field(default_factory=list)
    size: int = 0

    def descendants(self, name: tuple[str, str]) -> list["Node"]:
        return [node for child in self.children
                for node in ([child] + child.descendants_any()) if node.name == name]

    def descendants_any(self) -> list["Node"]:
        return [node for child in self.children for node in ([child] + child.descendants_any())]

    def lexical(self) -> str:
        return "".join(self.text).strip()


@dataclass
class OpaqueNote:
    context_ref: str
    namespace: str
    invalid_bytes: int = 0
    has_child_markup: bool = False
    closed: bool = False


def strict_transport_markup(document: str, limits: Limits, started: float) -> None:
    """Reject undecodable bytes in *all* markup, even unrecognised HTML.

    HTMLParser may treat a damaged tag name as data. A separate bounded,
    quote-aware lexical pass prevents that damaged markup from being mistaken
    for an allowed note body. It neither edits nor truncates the document.
    """
    at = 0
    while True:
        require(time.monotonic() - started <= limits.seconds, "PARSE_DEADLINE")
        start = document.find("<", at)
        if start < 0:
            return
        if document.startswith("<!--", start):
            close = document.find("-->", start + 4)
            require(close >= 0, "OPAQUE_MARKUP_UNCLOSED")
            end = close + 3
        else:
            quote, end = "", start + 1
            while end < len(document):
                require(end - start <= limits.max_tag_chars, "TAG_SIZE_LIMIT")
                char = document[end]
                if quote:
                    if char == quote:
                        quote = ""
                elif char in "\"'":
                    quote = char
                elif char == ">":
                    break
                end += 1
            require(end < len(document), "OPAQUE_MARKUP_UNCLOSED")
            end += 1
        require(UNDECODABLE.search(document, start, end) is None,
                "OPAQUE_UNDECODABLE_MARKUP")
        at = end


def raw_attributes(raw: str) -> tuple[str, dict[str, str]]:
    """Preserve XML prefix/attribute case lost by HTMLParser's HTML API."""
    match = NAME.match(raw, 1)
    require(match is not None, "TAG_NAME_INVALID")
    name, at, attrs, folded = match.group(), match.end(), {}, set()
    while at < len(raw):
        while at < len(raw) and raw[at].isspace():
            at += 1
        if raw[at:] in (">", "/>"):
            break
        attr = NAME.match(raw, at)
        require(attr is not None, "ATTRIBUTE_SYNTAX_INVALID")
        key, at = attr.group(), attr.end()
        require(key.lower() not in folded, "DUPLICATE_ATTRIBUTE")
        folded.add(key.lower())
        while at < len(raw) and raw[at].isspace():
            at += 1
        value = ""
        if at < len(raw) and raw[at] == "=":
            at += 1
            while at < len(raw) and raw[at].isspace():
                at += 1
            require(at < len(raw), "ATTRIBUTE_VALUE_MISSING")
            if raw[at] in "\"'":
                quote, at = raw[at], at + 1
                end = raw.find(quote, at)
                require(end >= at, "ATTRIBUTE_VALUE_UNCLOSED")
                value, at = raw[at:end], end + 1
            else:
                end = at
                while end < len(raw) and not raw[end].isspace() and raw[end] != ">":
                    end += 1
                value, at = raw[at:end], end
        attrs[key] = unescape(value)
    return name, attrs


def expanded(value: str, namespaces: dict[str, str]) -> tuple[str, str]:
    match = QNAME.fullmatch(value)
    require(match is not None and match[1] in namespaces, "QNAME_UNBOUND_OR_INVALID")
    return namespaces[match[1]], match[2]


class InstanceParser(HTMLParser):
    def __init__(self, document: str, limits: Limits, *, opaque_notes: bool = False):
        super().__init__(convert_charrefs=False)
        self.document, self.limits, self.started = document, limits, time.monotonic()
        self.offsets, total = [0], 0
        for line in document.splitlines(keepends=True):
            total += len(line)
            self.offsets.append(total)
        self.stack: list[tuple[str, dict[str, str], Node | None]] = []
        self.captures: list[Node] = []
        self.tags = self.contexts = self.units = self.facts = 0
        self.opaque_enabled = opaque_notes
        self.opaque_frames: dict[int, OpaqueNote] = {}
        self.opaque_notes: list[OpaqueNote] = []
        self.opaque_invalid_bytes = 0

    def check(self) -> None:
        require(time.monotonic() - self.started <= self.limits.seconds, "PARSE_DEADLINE")

    def handle_decl(self, decl: str) -> None:
        # No DTD, external entity, or declaration interpretation is supported.
        raise ExtractionError("DECLARATION_FORBIDDEN")

    def unknown_decl(self, data: str) -> None:
        raise ExtractionError("DECLARATION_FORBIDDEN")

    def handle_pi(self, data: str) -> None:
        # The actual Big5 wrapper embeds a UTF-8 XML declaration. It does not
        # override the selected, receipt-bound outer byte decoding.
        require(data.lower().startswith("xml "), "PROCESSING_INSTRUCTION_UNSUPPORTED")

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.check()
        self.tags += 1
        require(self.tags <= self.limits.max_tags, "TAG_LIMIT")
        require(len(self.stack) < self.limits.max_depth, "DEPTH_LIMIT")
        raw = self.get_starttag_text()
        require(len(raw) <= self.limits.max_tag_chars, "TAG_SIZE_LIMIT")
        if self.opaque_enabled:
            require(UNDECODABLE.search(raw) is None, "OPAQUE_UNDECODABLE_MARKUP")
            for note in self.opaque_frames.values():
                note.has_child_markup = True
        original, attributes = raw_attributes(raw)
        require(len(attributes) <= 128, "ATTRIBUTE_COUNT_LIMIT")
        namespaces = dict(self.stack[-1][1]) if self.stack else {"xml": "http://www.w3.org/XML/1998/namespace"}
        for key, value in attributes.items():
            if key == "xmlns":
                namespaces[""] = value
            elif key.startswith("xmlns:"):
                prefix = key[6:]
                require(re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.-]*", prefix) is not None,
                        "NAMESPACE_PREFIX_INVALID")
                require(prefix != "xmlns" and (prefix != "xml" or value == "http://www.w3.org/XML/1998/namespace"), "RESERVED_NAMESPACE_REBIND")
                namespaces[prefix] = value
        require(len(namespaces) <= 64, "NAMESPACE_BINDING_LIMIT")
        attribute_names = set()
        for key in attributes:
            if key == "xmlns" or key.startswith("xmlns:"):
                continue
            expanded_name = expanded(key, namespaces) if ":" in key else ("", key)
            require(expanded_name not in attribute_names, "DUPLICATE_EXPANDED_ATTRIBUTE")
            attribute_names.add(expanded_name)
        attributes = {key: value for key, value in attributes.items()
                      if key != "xmlns" and not key.startswith("xmlns:")}
        name = expanded(original, namespaces) if ":" in original else (namespaces.get("", ""), original)
        opaque_note = None
        if self.opaque_enabled and name == (IX, "nonNumeric"):
            concept = attributes.get("name", "")
            if QNAME.fullmatch(concept) and concept.split(":")[0] in namespaces:
                concept_name = expanded(concept, namespaces)
                if (concept_name[0] in OPAQUE_NOTE_NAMESPACES and
                        concept_name[1] == OPAQUE_NOTE_LOCAL and
                        set(attributes) == {"name", "contextRef", "escape"} and
                        attributes["escape"] == "true" and attributes["contextRef"]):
                    opaque_note = OpaqueNote(attributes["contextRef"], concept_name[0])
        if ":" not in original and original.lower() in VOID:
            parent = next((frame[2] for frame in reversed(self.stack) if frame[2] is not None), None)
            if parent is not None:
                parent.children.append(Node(name, attributes, namespaces))
            return
        selected = name in ((XBRLI, "context"), (XBRLI, "unit"), (IX, "nonFraction"))
        if name == (XBRLI, "context"):
            self.contexts += 1
            require(self.contexts <= self.limits.max_contexts, "CONTEXT_LIMIT")
        if name == (XBRLI, "unit"):
            self.units += 1
            require(self.units <= self.limits.max_units, "UNIT_LIMIT")
        if name == (IX, "nonFraction"):
            require(not any(frame[0].split(":")[-1] == "nonFraction" for frame in self.stack), "FACT_NESTING_UNSUPPORTED")
            self.facts += 1
            require(self.facts <= self.limits.max_facts, "FACT_LIMIT")
            # Capture only explicit requested metric local names; QName trust
            # is checked separately, including namespace rebinding attacks.
            selected = attributes.get("name", "").split(":")[-1] in METRICS
        parent = next((frame[2] for frame in reversed(self.stack) if frame[2] is not None), None)
        node = Node(name, attributes, namespaces) if selected or parent is not None else None
        if node is not None:
            if parent is not None:
                parent.children.append(node)
            else:
                self.captures.append(node)
        self.stack.append((original, namespaces, node))
        if opaque_note is not None:
            self.opaque_frames[len(self.stack)] = opaque_note
            self.opaque_notes.append(opaque_note)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        before = len(self.stack)
        self.handle_starttag(tag, attrs)
        if len(self.stack) > before:
            note = self.opaque_frames.pop(len(self.stack), None)
            if note is not None:
                note.closed = True
            self.stack.pop()

    def handle_endtag(self, tag: str) -> None:
        self.check()
        line, col = self.getpos()
        at = self.offsets[line - 1] + col
        match = re.match(r"</\s*([A-Za-z_][A-Za-z0-9_.:-]*)\s*>", self.document[at:at + self.limits.max_tag_chars])
        require(match is not None, "END_TAG_INVALID")
        original = match[1]
        found = next((i for i in range(len(self.stack) - 1, -1, -1)
                      if self.stack[i][0] == original), None)
        if ":" in original or any(frame[2] is not None for frame in self.stack):
            require(found == len(self.stack) - 1, "CAPTURE_TAG_STRUCTURE_INVALID")
        if self.opaque_enabled and self.opaque_frames:
            require(found == len(self.stack) - 1, "OPAQUE_NOTE_STRUCTURE_INVALID")
        if found is not None:
            for depth in list(self.opaque_frames):
                if depth > found:
                    note = self.opaque_frames.pop(depth)
                    note.closed = True
            del self.stack[found:]

    def handle_data(self, data: str) -> None:
        self.check()
        if self.opaque_enabled and UNDECODABLE.search(data):
            note = self.opaque_frames.get(len(self.stack))
            require(note is not None and not note.has_child_markup and
                    not any(frame[2] is not None for frame in self.stack) and
                    not any((namespaces.get(original.split(":")[0], "") if ":" in original
                             else namespaces.get("", "")) in (IX, XBRLI)
                            for original, namespaces, _ in self.stack[:-1]),
                    "OPAQUE_UNDECODABLE_OUTSIDE_APPROVED_NOTE")
            invalid = UNDECODABLE.findall(data)
            require(all(char == "\udc84" for char in invalid), "OPAQUE_BYTE_NOT_APPROVED")
            self.opaque_invalid_bytes += len(invalid)
            require(self.opaque_invalid_bytes <= MAX_OPAQUE_INVALID_BYTES, "OPAQUE_BYTE_LIMIT")
            note.invalid_bytes += len(invalid)
            # No note text is captured. The original complete bytes, including
            # each invalid byte at its original offset, remain receipt-bound.
            return
        # Propagate text in document order, including nested spans, to captured
        # ancestors. Resource subtrees are small and bounded independently.
        for _, _, node in self.stack:
            if node is not None:
                node.size += len(data)
                require(node.size <= self.limits.max_capture_chars, "CAPTURE_SIZE_LIMIT")
                node.text.append(data)
        if self.stack and self.stack[-1][2] is not None:
            self.stack[-1][2].direct_text.append(data)

    def handle_entityref(self, name: str) -> None:
        if any(frame[2] is not None for frame in self.stack):
            value = unescape("&" + name + ";")
            require(value != "&" + name + ";", "UNKNOWN_ENTITY")
            self.handle_data(value)

    def handle_charref(self, name: str) -> None:
        if any(frame[2] is not None for frame in self.stack):
            value = unescape("&#" + name + ";")
            require("\ufffd" not in value, "INVALID_CHARACTER_REFERENCE")
            self.handle_data(value)

    def finish(self) -> None:
        require(not any(frame[2] is not None for frame in self.stack), "CAPTURE_UNCLOSED")
        for note in self.opaque_notes:
            if note.invalid_bytes:
                require(note.closed and not note.has_child_markup,
                        "OPAQUE_NOTE_STRUCTURE_INVALID")
        self.check()


def one(nodes: list[Node], code: str) -> Node:
    require(len(nodes) == 1, code)
    return nodes[0]


def context(node: Node) -> dict[str, Any]:
    require(set(node.attrs) == {"id"} and node.attrs["id"], "CONTEXT_ID_INVALID")
    require(not any(n.name[0] == XBRLDI or n.name in ((XBRLI, "segment"), (XBRLI, "scenario"))
                    for n in node.descendants_any()), "CONTEXT_DIMENSIONS_UNSUPPORTED")
    entity = one([n for n in node.children if n.name == (XBRLI, "entity")], "CONTEXT_ENTITY_STRUCTURE")
    require(not entity.attrs and not "".join(entity.direct_text).strip() and
            not "".join(node.direct_text).strip(), "CONTEXT_STRUCTURAL_CONTENT")
    identifier = one(entity.children, "CONTEXT_IDENTIFIER_STRUCTURE")
    require(identifier.name == (XBRLI, "identifier") and
            identifier.attrs == {"scheme": "http://www.twse.com.tw"} and not identifier.children,
            "CONTEXT_IDENTIFIER_SCHEME")
    period = one([n for n in node.children if n.name == (XBRLI, "period")], "CONTEXT_PERIOD_STRUCTURE")
    require(not period.attrs and not "".join(period.direct_text).strip(), "CONTEXT_PERIOD_ATTRIBUTES_OR_TEXT")
    require(len(node.children) == 2 and len(period.children) == 2, "CONTEXT_PERIOD_NOT_DURATION")
    start = one([n for n in period.children if n.name == (XBRLI, "startDate")], "CONTEXT_START")
    end = one([n for n in period.children if n.name == (XBRLI, "endDate")], "CONTEXT_END")
    require(not start.children and not end.children and not start.attrs and not end.attrs, "CONTEXT_DATE_STRUCTURE")
    return {"entity": identifier.lexical(), "start": start.lexical(), "end": end.lexical()}


def unit(node: Node) -> str:
    require(set(node.attrs) == {"id"} and node.attrs["id"], "UNIT_ID_INVALID")
    child = one(node.children, "UNIT_STRUCTURE")
    require(not "".join(node.direct_text).strip(), "UNIT_STRUCTURAL_TEXT")
    def measure(item: Node, expected: tuple[str, str]) -> None:
        require(item.name == (XBRLI, "measure") and not item.children and not item.attrs,
                "UNIT_MEASURE_STRUCTURE")
        require(expanded(item.lexical(), item.namespaces) == expected, "UNIT_MEASURE_UNSUPPORTED")
    if child.name == (XBRLI, "measure"):
        measure(child, (ISO, "TWD"))
        return "TWD"
    require(child.name == (XBRLI, "divide") and len(child.children) == 2, "UNIT_DIVIDE_STRUCTURE")
    require(not child.attrs and not "".join(child.direct_text).strip(), "UNIT_DIVIDE_ATTRIBUTES_OR_TEXT")
    numerator = one([n for n in child.children if n.name == (XBRLI, "unitNumerator")], "UNIT_NUMERATOR")
    denominator = one([n for n in child.children if n.name == (XBRLI, "unitDenominator")], "UNIT_DENOMINATOR")
    require(not numerator.attrs and not denominator.attrs and
            not "".join(numerator.direct_text).strip() and not "".join(denominator.direct_text).strip(),
            "UNIT_DIVIDE_MEMBER_ATTRIBUTES_OR_TEXT")
    measure(one(numerator.children, "UNIT_NUMERATOR_MEASURE"), (ISO, "TWD"))
    measure(one(denominator.children, "UNIT_DENOMINATOR_MEASURE"), (XBRLI, "shares"))
    return "TWD_PER_SHARE"


def numeric(node: Node) -> tuple[str | None, str]:
    allowed = {"id", "name", "contextRef", "unitRef", "format", "scale", "sign", "decimals"}
    nil = False
    for key, value in node.attrs.items():
        if ":" in key:
            require(expanded(key, node.namespaces) == (XSI, "nil") and value in ("true", "1", "false", "0"), "FACT_ATTRIBUTE_UNSUPPORTED")
            nil = value in ("true", "1")
        else:
            require(key in allowed, "FACT_ATTRIBUTE_UNSUPPORTED")
    require(not any(n.name[0] == IX for n in node.descendants_any()), "FACT_NESTING_UNSUPPORTED")
    require(all(n.name in ((XHTML, "span"), ("", "span")) for n in node.descendants_any()), "FACT_MARKUP_UNSUPPORTED")
    require("decimals" in node.attrs and (node.attrs["decimals"] == "INF" or
            re.fullmatch(r"-?(?:0|[1-9][0-9]?)", node.attrs["decimals"]) is not None), "DECIMALS_UNSUPPORTED")
    require(node.attrs.get("sign", "") in ("", "-"), "SIGN_UNSUPPORTED")
    scale = node.attrs.get("scale", "0")
    require(re.fullmatch(r"-?(?:0|[1-9][0-9]?)", scale) is not None and -18 <= int(scale) <= 18, "SCALE_UNSUPPORTED")
    lexical = node.lexical()
    if nil:
        require(not lexical, "NIL_WITH_VALUE")
        return None, lexical
    if "format" in node.attrs:
        require(expanded(node.attrs["format"], node.namespaces) == (IXT, "numdotdecimal"), "FORMAT_UNSUPPORTED")
        require(re.fullmatch(r"(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)(?:\.[0-9]+)?", lexical) is not None,
                "NUMERIC_LEXICAL_INVALID")
        lexical = lexical.replace(",", "")
    else:
        require(re.fullmatch(r"-?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)", lexical) is not None, "NUMERIC_LEXICAL_INVALID")
        require(not (lexical.startswith("-") and node.attrs.get("sign") == "-"), "DOUBLE_SIGN")
    require(len(lexical) <= 80, "NUMERIC_SIZE_LIMIT")
    try:
        with localcontext() as ctx:
            ctx.prec = 128
            value = Decimal(lexical).scaleb(int(scale))
            if node.attrs.get("sign") == "-":
                value = -value
            require(value.is_finite(), "NUMERIC_NONFINITE")
            return format(value, "f"), node.lexical()
    except InvalidOperation as exc:
        raise ExtractionError("NUMERIC_INVALID") from exc


def quarter_dates(year: int, quarter: int) -> tuple[str, str]:
    require(type(year) is int and type(quarter) is int and 2000 <= year <= 2100 and quarter in (1, 2, 3, 4), "QUARTER_INVALID")
    month = 3 * quarter
    return f"{year:04d}-{month - 2:02d}-01", f"{year:04d}-{month:02d}-{calendar.monthrange(year, month)[1]:02d}"


def extract_actuals(data: bytes, receipt: dict[str, Any], *, entity: str, year: int,
                    quarter: int, revenue_mode: str = "none", encoding: str = "big5",
                    decode_profile: str = "strict",
                    statement_profile: str = "consolidated",
                    limits: Limits | None = None) -> dict[str, Any]:
    limits = limits or Limits()
    ceilings = Limits()
    require(all(isinstance(getattr(limits, key), int) and 0 < getattr(limits, key) <= getattr(ceilings, key)
                for key in ("max_bytes", "max_tags", "max_depth", "max_contexts", "max_units", "max_facts", "max_capture_chars", "max_tag_chars")) and
            0 < limits.seconds <= ceilings.seconds, "LIMITS_INVALID")
    require(isinstance(data, bytes) and 0 < len(data) <= limits.max_bytes, "BYTE_LIMIT")
    require(isinstance(receipt, dict), "RECEIPT_SCHEMA_INVALID")
    require(re.fullmatch(r"[0-9]{4,6}", entity) is not None, "ENTITY_INVALID")
    require(revenue_mode in ("none", "ifrs-revenue"), "REVENUE_PROFILE_INVALID")
    require(encoding in ("big5", "cp950", "utf-8"), "ENCODING_UNSUPPORTED")
    require(decode_profile in ("strict", OPAQUE_NOTE_PROFILE), "DECODE_PROFILE_UNSUPPORTED")
    require(decode_profile == "strict" or encoding == "cp950", "DECODE_PROFILE_ENCODING_MISMATCH")
    require(statement_profile in ("consolidated", "individual"), "STATEMENT_PROFILE_UNSUPPORTED")
    digest = hashlib.sha256(data).hexdigest()
    # Two observed capture schemas, with no preference that could hide a
    # conflicting alias. Every supplied hash/length must match the same bytes.
    hashes = [receipt[key] for key in ("sha256", "raw_sha256") if key in receipt]
    lengths = [receipt[key] for key in ("bytes", "raw_bytes") if key in receipt]
    require(bool(hashes) and bool(lengths) and all(value == digest for value in hashes) and
            all(type(value) is int and value == len(data) for value in lengths), "RECEIPT_BYTES_MISMATCH")
    received_at = receipt.get("received_at")
    require(isinstance(received_at, str), "RECEIVED_AT_REQUIRED")
    try:
        parsed = datetime.fromisoformat(received_at.replace("Z", "+00:00"))
        require(parsed.utcoffset() is not None, "RECEIVED_AT_TIMEZONE_REQUIRED")
    except ValueError as exc:
        raise ExtractionError("RECEIVED_AT_INVALID") from exc
    require(receipt.get("http") == 200, "RECEIPT_HTTP_NOT_SUCCESS")
    url = receipt.get("url", "")
    require(isinstance(url, str) and len(url) <= 2048, "SOURCE_URL_NOT_APPROVED")
    try:
        source = urlsplit(url)
        require(source.scheme == "https" and source.hostname in ("mopsov.twse.com.tw", "mops.twse.com.tw") and
                not source.username and not source.password and not source.fragment and
                source.port in (None, 443) and source.path == "/server-java/t164sb01", "SOURCE_URL_NOT_APPROVED")
        pairs = parse_qsl(source.query, keep_blank_values=True, strict_parsing=True)
        query = dict(pairs)
        require(len(query) == len(pairs) == 5 and set(query) == {"step", "CO_ID", "SYEAR", "SSEASON", "REPORT_ID"} and
                query["step"] == "1" and query["CO_ID"] == entity and
                re.fullmatch(r"20[0-9]{2}", query["SYEAR"]) is not None and
                query["SSEASON"] in ("1", "2", "3", "4") and
                query["REPORT_ID"] == ("C" if statement_profile == "consolidated" else "A"),
                "SOURCE_QUERY_NOT_APPROVED")
    except ValueError as exc:
        if isinstance(exc, ExtractionError):
            raise
        raise ExtractionError("SOURCE_URL_NOT_APPROVED") from exc
    start, end = quarter_dates(year, quarter)
    require(parsed >= datetime.fromisoformat(end + "T00:00:00+08:00"), "RECEIPT_PRECEDES_ACTUAL_PERIOD")
    try:
        text = data.decode(encoding, errors="strict" if decode_profile == "strict" else "surrogateescape")
    except UnicodeDecodeError as exc:
        raise ExtractionError("SOURCE_DECODING_INVALID") from exc
    require("\x00" not in text, "SOURCE_NUL")
    if decode_profile != "strict":
        require(text.encode("cp950", errors="surrogateescape") == data, "OPAQUE_TRANSPORT_NOT_REVERSIBLE")
    parser = InstanceParser(text, limits, opaque_notes=decode_profile != "strict")
    if decode_profile != "strict":
        strict_transport_markup(text, limits, parser.started)
    parser.feed(text)
    parser.close()
    parser.finish()
    require(parser.contexts > 0 and parser.units > 0 and parser.facts > 0, "NO_SUPPORTED_INLINE_XBRL_INSTANCE")
    contexts, units, invalid_contexts, invalid_units, resource_ids = {}, {}, {}, {}, set()
    facts = []
    for node in parser.captures:
        parser.check()
        if node.name not in ((XBRLI, "context"), (XBRLI, "unit")):
            facts.append(node)
            continue
        target, invalid, decoder = (contexts, invalid_contexts, context) if node.name[1] == "context" else (units, invalid_units, unit)
        identifier = node.attrs.get("id", "")
        require(identifier and identifier not in resource_ids, "DUPLICATE_RESOURCE_ID")
        resource_ids.add(identifier)
        try:
            target[identifier] = decoder(node)
        except ExtractionError as exc:
            invalid[identifier] = str(exc)
    for note in parser.opaque_notes:
        if note.invalid_bytes:
            require(note.context_ref in contexts, "OPAQUE_NOTE_CONTEXT_INVALID")
            scope = contexts[note.context_ref]
            require(scope["entity"] == entity, "OPAQUE_NOTE_ENTITY_MISMATCH")
            try:
                require(all(re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", scope[key])
                            for key in ("start", "end")), "OPAQUE_NOTE_PERIOD_INVALID")
                note_start, note_end = (datetime.fromisoformat(scope[key]) for key in ("start", "end"))
                require(note_start <= note_end and note_start.year == int(query["SYEAR"]) and
                        note_end.year == int(query["SYEAR"]) and
                        note_end.date().isoformat() <= quarter_dates(int(query["SYEAR"]), int(query["SSEASON"]))[1],
                        "OPAQUE_NOTE_PERIOD_INVALID")
            except ValueError as exc:
                if isinstance(exc, ExtractionError):
                    raise
                raise ExtractionError("OPAQUE_NOTE_PERIOD_INVALID") from exc
    candidates: dict[str, list[dict[str, Any]]] = {metric: [] for metric in METRICS.values()}
    blocked: dict[str, list[str]] = {metric: [] for metric in METRICS.values()}
    rejected: dict[str, int] = {}
    def reject(code: str) -> None:
        rejected[code] = rejected.get(code, 0) + 1
    for node in facts:
        parser.check()
        local = node.attrs.get("name", "").split(":")[-1]
        metric = METRICS.get(local)
        if metric is None:
            continue
        try:
            qname = expanded(node.attrs["name"], node.namespaces)
            require(qname[0] in APPROVED_IFRS and qname[1] == local, "CONCEPT_NAMESPACE_NOT_APPROVED")
            ref = node.attrs.get("contextRef", "")
            require(ref in contexts, invalid_contexts.get(ref, "CONTEXT_REF_MISSING"))
            scope = contexts[ref]
            require(scope["entity"] == entity, "OTHER_ENTITY")
            require((scope["start"], scope["end"]) == (start, end), "NOT_EXACT_QUARTER")
        except ExtractionError as exc:
            reject(str(exc))
            continue
        if metric == "revenue" and revenue_mode != "ifrs-revenue":
            reject("REVENUE_PROFILE_NOT_APPROVED")
            continue
        try:
            unit_ref = node.attrs.get("unitRef", "")
            require(unit_ref in units, invalid_units.get(unit_ref, "UNIT_REF_MISSING"))
            expected = "TWD" if metric == "revenue" else "TWD_PER_SHARE"
            require(units[unit_ref] == expected, "METRIC_UNIT_MISMATCH")
            value, lexical = numeric(node)
            candidates[metric].append({"metric": metric, "entity": entity, "quarter": f"{year}Q{quarter}",
                "period_start": start, "period_end": end, "concept_namespace": qname[0],
                "concept_local_name": local, "context_ref": ref, "unit_ref": unit_ref,
                "unit": expected, "currency": "TWD", "value_decimal": value,
                "raw_lexical_value": lexical, "scale": int(node.attrs.get("scale", "0")),
                "decimals": node.attrs["decimals"], "direct_single_quarter": True})
        except ExtractionError as exc:
            blocked[metric].append(str(exc))
            reject(str(exc))
    rows, missing = [], []
    for metric, values in candidates.items():
        if blocked[metric]:
            missing.append({"metric": metric, "reason": "INVALID_MATCHING_FACT", "details": sorted(set(blocked[metric]))})
        elif not values:
            missing.append({"metric": metric, "reason": "PROFILE_NOT_APPROVED" if metric == "revenue" and revenue_mode == "none" else "DIRECT_QUARTER_FACT_MISSING"})
        elif len({None if row["value_decimal"] is None else Decimal(row["value_decimal"]) for row in values}) != 1:
            missing.append({"metric": metric, "reason": "DUPLICATE_FACT_CONFLICT"})
        elif len({row["concept_namespace"] for row in values}) != 1:
            missing.append({"metric": metric, "reason": "MIXED_TAXONOMY_NAMESPACE_CONFLICT"})
        elif values[0]["value_decimal"] is None:
            missing.append({"metric": metric, "reason": "NIL_FACT"})
        else:
            row = values[0]
            row["duplicate_count"] = len(values)
            row["source_sha256"] = digest
            row["source_url"] = url
            row["source_report_period"] = {"year": int(query["SYEAR"]), "quarter": int(query["SSEASON"]), "report_id": query["REPORT_ID"]}
            row["received_at"] = received_at
            row["available_not_before"] = received_at
            row["announced_at"] = None
            row["ordinary_share_basis"] = "NOT_PROVEN_BY_UNIT"
            row["consolidation_basis"] = "NOT_PROVEN_BY_CONTEXT_OR_QUERY"
            if statement_profile == "individual":
                row["statement_basis"] = "REQUESTED_INDIVIDUAL_A_WITH_ENTITY_CONTEXT_VERIFIED"
            rows.append(row)
    result = {"schema": "OFFICIAL_INLINE_XBRL_DIRECT_ACTUAL_CANDIDATE_V1", "entity": entity,
            "quarter": f"{year}Q{quarter}", "source_sha256": digest, "received_at": received_at,
            "encoding": encoding, "rows": rows, "missing": missing, "rejections": rejected,
            "counts": {"tags": parser.tags, "contexts": parser.contexts, "units": parser.units,
                       "numeric_facts": parser.facts, "rows": len(rows), "missing": len(missing)},
            "source_admitted": False, "production_evaluation": False,
            "announcement_time_inferred": False, "revenue_profile": revenue_mode}
    if statement_profile == "individual":
        result["statement_profile"] = "individual"
        result["statement_basis"] = "REQUESTED_INDIVIDUAL_A_WITH_ENTITY_CONTEXT_VERIFIED"
    if decode_profile != "strict":
        result["source_decoding"] = {
            "profile": decode_profile, "transport": "CP950_SURROGATEESCAPE_REVERSIBLE",
            "whole_source_strict": parser.opaque_invalid_bytes == 0,
            "opaque_invalid_bytes": parser.opaque_invalid_bytes,
            "opaque_notes": sum(note.invalid_bytes > 0 for note in parser.opaque_notes),
            "excluded_note_local_name": OPAQUE_NOTE_LOCAL,
            "excluded_note_namespaces": sorted({note.namespace for note in parser.opaque_notes if note.invalid_bytes}),
            "note_bodies": "EXCLUDED_NOT_DECODED_OR_OUTPUT",
            "selected_facts_and_resources": "STRICT_CP950_BYTES_ONLY",
            "full_document_scanned": True,
        }
    return result


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--html", type=Path, required=True)
    ap.add_argument("--receipt", type=Path, required=True)
    ap.add_argument("--entity", required=True)
    ap.add_argument("--year", type=int, required=True)
    ap.add_argument("--quarter", type=int, required=True)
    ap.add_argument("--encoding", choices=("big5", "cp950", "utf-8"), default="big5")
    ap.add_argument("--decode-profile", choices=("strict", OPAQUE_NOTE_PROFILE), default="strict")
    ap.add_argument("--statement-profile", choices=("consolidated", "individual"), default="consolidated")
    ap.add_argument("--revenue-mode", choices=("none", "ifrs-revenue"), default="none")
    args = ap.parse_args()
    require(args.html.stat().st_size <= Limits().max_bytes, "BYTE_LIMIT")
    require(args.receipt.stat().st_size <= 65_536, "RECEIPT_SIZE_LIMIT")
    result = extract_actuals(args.html.read_bytes(), json.loads(args.receipt.read_text()),
        entity=args.entity, year=args.year, quarter=args.quarter, encoding=args.encoding,
        revenue_mode=args.revenue_mode, decode_profile=args.decode_profile,
        statement_profile=args.statement_profile)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ExtractionError, OSError, json.JSONDecodeError) as exc:
        print(json.dumps({"status": "REFUSED", "error": str(exc) if isinstance(exc, ExtractionError) else type(exc).__name__}))
        raise SystemExit(2)
