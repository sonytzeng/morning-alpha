"""Synthetic protocol controls, never a real issuer filing or saved raw fixture."""
import importlib.util
import hashlib
import json
from pathlib import Path
import sys
import subprocess
import tempfile
import unittest
from dataclasses import replace

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("official_inline_xbrl", ROOT / "scripts/official-actuals/inline_xbrl.py")
M = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = M
SPEC.loader.exec_module(M)


def fixture(*, extra="", fact_attrs="", context_extra="", namespace=None):
    return f'''<html xmlns="http://www.w3.org/1999/xhtml" xmlns:x="{M.XBRLI}"
 xmlns:ix="{M.IX}" xmlns:ifrs="{namespace or M.IFRS_2025}" xmlns:iso="{M.ISO}"
 xmlns:ixt="{M.IXT}" xmlns:xsi="{M.XSI}" xmlns:nilAlias="{M.XSI}"
 xmlns:dim="{M.XBRLDI}"><head><meta charset="utf-8"/></head><body>
<x:context id="c"><x:entity><x:identifier scheme="http://www.twse.com.tw">2330</x:identifier></x:entity>
<x:period><x:startDate>2026-04-01</x:startDate><x:endDate>2026-06-30</x:endDate></x:period>{context_extra}</x:context>
<x:unit id="eps"><x:divide><x:unitNumerator><x:measure>iso:TWD</x:measure></x:unitNumerator>
<x:unitDenominator><x:measure>x:shares</x:measure></x:unitDenominator></x:divide></x:unit>
<x:unit id="twd"><x:measure>iso:TWD</x:measure></x:unit>
<ix:nonFraction name="ifrs:BasicEarningsLossPerShare" contextRef="c" unitRef="eps" decimals="2" format="ixt:numdotdecimal" {fact_attrs}>1.25</ix:nonFraction>
<ix:nonFraction name="ifrs:DilutedEarningsLossPerShare" contextRef="c" unitRef="eps" decimals="2" format="ixt:numdotdecimal">1.20</ix:nonFraction>
<ix:nonFraction name="ifrs:Revenue" contextRef="c" unitRef="twd" decimals="-3" scale="3" format="ixt:numdotdecimal">12,345</ix:nonFraction>
{extra}</body></html>'''


def receipt(data):
    return {"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data), "http": 200,
            "received_at": "2026-10-18T10:38:09.839344+00:00",
            "url": "https://mopsov.twse.com.tw/server-java/t164sb01?step=1&CO_ID=2330&SYEAR=2026&SSEASON=2&REPORT_ID=C"}


def extract(text=None, *, changes=None, **kwargs):
    data = (text or fixture()).encode("utf-8")
    r = receipt(data)
    r.update(changes or {})
    return M.extract_actuals(data, r, entity="2330", year=2026, quarter=2,
                            encoding="utf-8", revenue_mode="ifrs-revenue", **kwargs)


def rows(result):
    return {row["metric"]: row for row in result["rows"]}


def opaque_fixture(*, body="PRIVATE_NOTE_BODY_NEVER_OUTPUT OPAQUE_BYTE note", namespace=None,
                   note_attrs=None, extra=""):
    note_attrs = note_attrs or 'contextRef="c" escape="true"'
    note = (f'<ix:nonNumeric xmlns:notes="{namespace or sorted(M.OPAQUE_NOTE_NAMESPACES)[0]}" '
            f'name="notes:{M.OPAQUE_NOTE_LOCAL}" {note_attrs}>{body}</ix:nonNumeric>')
    return fixture(extra=note + extra).encode("cp950").replace(b"OPAQUE_BYTE", b"\x84")


def extract_opaque(data=None, **kwargs):
    data = data if data is not None else opaque_fixture()
    return M.extract_actuals(data, receipt(data), entity="2330", year=2026, quarter=2,
                             encoding="cp950", revenue_mode="ifrs-revenue",
                             decode_profile=M.OPAQUE_NOTE_PROFILE, **kwargs)


class OfficialInlineXbrlActuals(unittest.TestCase):
    def test_direct_exact_typed_values_and_provenance(self):
        result = extract()
        self.assertEqual({key: row["value_decimal"] for key, row in rows(result).items()},
                         {"basic_eps": "1.25", "diluted_eps": "1.20", "revenue": "12345000"})
        self.assertEqual(result["counts"]["rows"], 3)
        for row in result["rows"]:
            self.assertEqual(row["announced_at"], None)
            self.assertEqual(row["available_not_before"], receipt(fixture().encode())["received_at"])
            self.assertEqual(row["source_report_period"], {"year": 2026, "quarter": 2, "report_id": "C"})
            self.assertEqual(row["ordinary_share_basis"], "NOT_PROVEN_BY_UNIT")
        self.assertFalse(result["source_admitted"])

    def test_prefix_alias_is_valid_but_uri_spoof_and_local_rebinding_are_not(self):
        self.assertEqual(extract(fixture().replace("ifrs:", "other:").replace("xmlns:ifrs", "xmlns:other"))["counts"]["rows"], 3)
        spoofed = extract(fixture(namespace="urn:unapproved"))
        self.assertEqual(spoofed["rows"], [])
        self.assertEqual(spoofed["rejections"]["CONCEPT_NAMESPACE_NOT_APPROVED"], 3)
        rebound = extract(fixture(fact_attrs='xmlns:ifrs="urn:unapproved"'))
        self.assertNotIn("basic_eps", rows(rebound))
        local_alias = fixture(fact_attrs=f'xmlns:local="{M.IFRS_2025}"').replace('name="ifrs:BasicEarningsLossPerShare"', 'name="local:BasicEarningsLossPerShare"')
        self.assertEqual(rows(extract(local_alias))["basic_eps"]["value_decimal"], "1.25")

    def test_verified_legacy_namespace_profile_does_not_implicitly_admit_other_uris(self):
        self.assertEqual(extract(fixture(namespace=M.IFRS_2017))["counts"]["rows"], 3)
        self.assertEqual(extract(fixture(namespace=M.IFRS_2025 + "/fake"))["rows"], [])

    def test_html_parser_does_not_fold_xml_attribute_or_prefix_case_into_authority(self):
        result = extract(fixture().replace('contextRef="c"', 'contextref="c"'))
        self.assertEqual(result["rows"], [])
        self.assertEqual(result["rejections"]["CONTEXT_REF_MISSING"], 3)
        wrong_case = extract(fixture().replace('xmlns:ifrs=', 'xmlns:IFRS='))
        self.assertEqual(wrong_case["rows"], [])
        self.assertEqual(wrong_case["rejections"]["QNAME_UNBOUND_OR_INVALID"], 3)

    def test_entity_ytd_and_dimensions_are_not_single_quarter_inputs(self):
        for changed, reason in [
            (fixture().replace('>2330</x:identifier>', '>2881</x:identifier>'), "OTHER_ENTITY"),
            (fixture().replace('2026-04-01', '2026-01-01'), "NOT_EXACT_QUARTER"),
            (fixture(context_extra='<x:scenario><dim:explicitMember dimension="ifrs:Axis">ifrs:Member</dim:explicitMember></x:scenario>'), "CONTEXT_DIMENSIONS_UNSUPPORTED"),
        ]:
            with self.subTest(reason=reason):
                result = extract(changed)
                self.assertEqual(result["rows"], [])
                self.assertEqual(result["rejections"][reason], 3)

    def test_ytd_eps_is_never_subtracted_into_q4(self):
        data = fixture().replace('2026-04-01', '2026-01-01').replace('2026-06-30', '2026-12-31').encode()
        result = M.extract_actuals(data, {**receipt(data), "received_at": "2027-03-31T10:00:00Z"},
                                  entity="2330", year=2026, quarter=4, encoding="utf-8", revenue_mode="ifrs-revenue")
        self.assertEqual(result["rows"], [])
        self.assertTrue(all(row["reason"] == "DIRECT_QUARTER_FACT_MISSING" for row in result["missing"]))

    def test_unit_structure_cannot_flatten_or_swap_division(self):
        for changed in [
            fixture().replace('<x:unitDenominator><x:measure>x:shares', '<x:unitDenominator><x:measure>iso:TWD'),
            fixture().replace('<x:measure>iso:TWD</x:measure></x:unitNumerator>', '<x:measure>x:shares</x:measure></x:unitNumerator>'),
            fixture().replace('<x:divide>', '').replace('</x:divide>', '').replace('<x:unitNumerator>', '').replace('</x:unitNumerator>', '').replace('<x:unitDenominator>', '').replace('</x:unitDenominator>', ''),
        ]:
            with self.subTest():
                self.assertNotIn("basic_eps", rows(extract(changed)))
                self.assertNotIn("diluted_eps", rows(extract(changed)))
        self.assertNotIn("revenue", rows(extract(fixture().replace('name="ifrs:Revenue" contextRef="c" unitRef="twd"', 'name="ifrs:Revenue" contextRef="c" unitRef="eps"'))))

    def test_nil_on_structural_nodes_and_garbage_mixed_content_are_rejected(self):
        for target in ["x:entity", "x:period", "x:startDate", "x:endDate", "x:divide", "x:unitNumerator", "x:unitDenominator"]:
            with self.subTest(target=target):
                self.assertNotIn("basic_eps", rows(extract(fixture().replace('<' + target + '>', '<' + target + ' xsi:nil="true">'))))
        self.assertNotIn("basic_eps", rows(extract(fixture().replace('<x:divide>', '<x:divide>garbage'))))

    def test_expanded_attribute_alias_collision_is_not_last_value_wins(self):
        with self.assertRaisesRegex(M.ExtractionError, "DUPLICATE_EXPANDED_ATTRIBUTE"):
            extract(fixture(fact_attrs='xsi:nil="true" nilAlias:nil="false"'))
        with self.assertRaisesRegex(M.ExtractionError, "DUPLICATE_ATTRIBUTE"):
            extract(fixture(fact_attrs='contextREF="other"'))

    def test_resource_ids_are_unique_across_context_and_unit(self):
        with self.assertRaisesRegex(M.ExtractionError, "DUPLICATE_RESOURCE_ID"):
            extract(fixture().replace('id="eps"', 'id="c"'))
        with self.assertRaisesRegex(M.ExtractionError, "DUPLICATE_RESOURCE_ID"):
            extract(fixture(extra='<x:context id="c"/>'))

    def test_sign_scale_format_and_decimal_exactness(self):
        row = rows(extract(fixture(fact_attrs='sign="-" scale="-3"')))["basic_eps"]
        self.assertEqual(row["value_decimal"], "-0.00125")
        for attr in ['sign="+"', 'scale="19"', 'scale="NaN"', 'continuedAt="another"']:
            with self.subTest(attr=attr):
                self.assertNotIn("basic_eps", rows(extract(fixture(fact_attrs=attr))))
        self.assertNotIn("basic_eps", rows(extract(fixture().replace('>1.25</ix:nonFraction>', '>1e999</ix:nonFraction>'))))
        self.assertNotIn("basic_eps", rows(extract(fixture().replace('format="ixt:numdotdecimal"', 'format="ixt:numcommadecimal"'))))
        self.assertEqual(rows(extract(fixture().replace('>1.25</ix:nonFraction>', '>9007199254740993.25</ix:nonFraction>')))["basic_eps"]["value_decimal"], "9007199254740993.25")

    def test_nested_inline_facts_and_hidden_logic_are_not_numeric_text(self):
        for tag in ["ix:nonNumeric", "ix:fraction", "ix:exclude", "ix:continuation"]:
            changed = fixture().replace('>1.25</ix:nonFraction>', '><' + tag + '>1.25</' + tag + '></ix:nonFraction>')
            with self.subTest(tag=tag):
                self.assertNotIn("basic_eps", rows(extract(changed)))
        formatted = fixture().replace('>1.25</ix:nonFraction>', '><span>1.</span><span>25</span></ix:nonFraction>')
        self.assertEqual(rows(extract(formatted))["basic_eps"]["value_decimal"], "1.25")
        for markup in ["<script>1.25</script>", "1.<br/>25"]:
            self.assertNotIn("basic_eps", rows(extract(fixture().replace('>1.25</ix:nonFraction>', '>' + markup + '</ix:nonFraction>'))))

    def test_nil_is_missing_never_zero_or_basic_fallback(self):
        result = extract(fixture(fact_attrs='xsi:nil="true"').replace('>1.25</ix:nonFraction>', '></ix:nonFraction>'))
        self.assertNotIn("basic_eps", rows(result))
        self.assertIn({"metric": "basic_eps", "reason": "NIL_FACT"}, result["missing"])
        self.assertEqual(rows(result)["diluted_eps"]["value_decimal"], "1.20")
        self.assertNotIn("basic_eps", rows(extract(fixture(fact_attrs='xsi:nil="true"'))))

    def test_duplicate_equal_is_deduplicated_and_conflict_is_missing(self):
        fact = '<ix:nonFraction name="ifrs:BasicEarningsLossPerShare" contextRef="c" unitRef="eps" decimals="2" format="ixt:numdotdecimal">1.25</ix:nonFraction>'
        self.assertEqual(rows(extract(fixture(extra=fact)))["basic_eps"]["duplicate_count"], 2)
        result = extract(fixture(extra=fact.replace('>1.25<', '>2.25<')))
        self.assertNotIn("basic_eps", rows(result))
        self.assertIn({"metric": "basic_eps", "reason": "DUPLICATE_FACT_CONFLICT"}, result["missing"])
        self.assertNotIn("basic_eps", rows(extract(fixture(extra=fact.replace('unitRef="eps"', 'unitRef="twd"')))))

    def test_financial_income_is_not_guessed_as_revenue(self):
        data = fixture().replace('ifrs:Revenue', 'ifrs:NetIncomeLoss').encode()
        result = M.extract_actuals(data, receipt(data), entity="2330", year=2026, quarter=2, encoding="utf-8")
        self.assertEqual(len(result["rows"]), 2)
        self.assertIn({"metric": "revenue", "reason": "PROFILE_NOT_APPROVED"}, result["missing"])

    def test_receipt_hash_size_timestamp_and_http_are_required(self):
        for changes, reason in [({"sha256": "0" * 64}, "RECEIPT_BYTES_MISMATCH"),
                                ({"bytes": 1}, "RECEIPT_BYTES_MISMATCH"),
                                ({"received_at": "2026-10-18"}, "RECEIVED_AT"),
                                ({"received_at": "2020-01-01T00:00:00Z"}, "RECEIPT_PRECEDES"),
                                ({"http": 401}, "RECEIPT_HTTP")]:
            with self.subTest(reason=reason), self.assertRaisesRegex(M.ExtractionError, reason):
                extract(changes=changes)

    def test_observed_raw_capture_receipt_aliases_are_exact_and_never_preferred_over_conflicts(self):
        data = fixture().encode()
        r = receipt(data)
        r["raw_sha256"] = r.pop("sha256")
        r["raw_bytes"] = r.pop("bytes")
        result = M.extract_actuals(data, r, entity="2330", year=2026, quarter=2, encoding="utf-8", revenue_mode="ifrs-revenue")
        self.assertEqual(result["source_sha256"], r["raw_sha256"])
        self.assertEqual(len(result["rows"]), 3)
        for bad in [{**r, "sha256": "0" * 64}, {**r, "bytes": 1}]:
            with self.assertRaisesRegex(M.ExtractionError, "RECEIPT_BYTES_MISMATCH"):
                M.extract_actuals(data, bad, entity="2330", year=2026, quarter=2, encoding="utf-8")

    def test_exact_public_origin_path_and_query_binding(self):
        url = receipt(b"")["url"]
        bad = [url.replace('.com.tw/', '.com.tw:8443/'), url.replace('https://', 'https://user:pass@'),
               url.replace('/server-java/t164sb01', '/other'), url + '&token=do-not-echo',
               url + '&CO_ID=2330', url.replace('CO_ID=2330', 'CO_ID=2881'),
               url.replace('https://', 'http://'), url + '#fragment']
        for value in bad:
            with self.subTest(value=value), self.assertRaisesRegex(M.ExtractionError, "SOURCE_(URL|QUERY)_NOT_APPROVED"):
                extract(changes={"url": value})
        # The filing may carry a prior comparative quarter: source request and
        # fact period are separately preserved, not forcibly equated.
        self.assertEqual(rows(extract(changes={"url": url.replace('SSEASON=2', 'SSEASON=3')}))["basic_eps"]["source_report_period"]["quarter"], 3)

    def test_declaration_and_external_entity_are_never_expanded(self):
        with self.assertRaisesRegex(M.ExtractionError, "DECLARATION_FORBIDDEN"):
            extract('<!DOCTYPE html [<!ENTITY ext SYSTEM "file:///never-read">]>' + fixture())
        with self.assertRaisesRegex(M.ExtractionError, "UNKNOWN_ENTITY"):
            extract(fixture().replace('>1.25</ix:nonFraction>', '>&unknown;</ix:nonFraction>'))

    def test_http200_no_filing_page_is_not_a_parsed_instance(self):
        with self.assertRaisesRegex(M.ExtractionError, "NO_SUPPORTED_INLINE_XBRL_INSTANCE"):
            extract("<html><body>No filing</body></html>")

    def test_explicit_cp950_profile_is_strict_and_never_replacement_or_fallback(self):
        # U+7881 is a CP950 extension not decodable by Python's strict Big5.
        data = fixture(extra="<p>碁</p>").encode("cp950")
        with self.assertRaisesRegex(M.ExtractionError, "SOURCE_DECODING_INVALID"):
            M.extract_actuals(data, receipt(data), entity="2330", year=2026, quarter=2, encoding="big5")
        result = M.extract_actuals(data, receipt(data), entity="2330", year=2026, quarter=2,
                                  encoding="cp950", revenue_mode="ifrs-revenue")
        self.assertEqual(result["encoding"], "cp950")
        self.assertEqual(len(result["rows"]), 3)
        bad = data + b"\x81"
        with self.assertRaisesRegex(M.ExtractionError, "SOURCE_DECODING_INVALID"):
            M.extract_actuals(bad, receipt(bad), entity="2330", year=2026, quarter=2, encoding="cp950")

    def test_opaque_note_profile_is_explicit_and_excludes_only_approved_note_body(self):
        data = opaque_fixture()
        with self.assertRaisesRegex(M.ExtractionError, "SOURCE_DECODING_INVALID"):
            M.extract_actuals(data, receipt(data), entity="2330", year=2026, quarter=2, encoding="cp950")
        result = extract_opaque(data)
        self.assertEqual(len(result["rows"]), 3)
        self.assertEqual(result["source_sha256"], receipt(data)["sha256"])
        self.assertEqual(result["received_at"], receipt(data)["received_at"])
        self.assertEqual(result["source_decoding"]["opaque_invalid_bytes"], 1)
        self.assertEqual(result["source_decoding"]["opaque_notes"], 1)
        self.assertFalse(result["source_decoding"]["whole_source_strict"])
        self.assertTrue(result["source_decoding"]["full_document_scanned"])
        encoded = M.json.dumps(result, ensure_ascii=False).encode("utf-8", errors="strict")
        self.assertNotIn(b"PRIVATE_NOTE_BODY_NEVER_OUTPUT", encoded)
        self.assertFalse(result["source_admitted"])
        self.assertFalse(result["production_evaluation"])
        for encoding in ("big5", "utf-8"):
            with self.subTest(encoding=encoding), self.assertRaisesRegex(M.ExtractionError, "DECODE_PROFILE_ENCODING_MISMATCH"):
                M.extract_actuals(data, receipt(data), entity="2330", year=2026, quarter=2,
                                  encoding=encoding, decode_profile=M.OPAQUE_NOTE_PROFILE)
        with self.assertRaisesRegex(M.ExtractionError, "DECODE_PROFILE_UNSUPPORTED"):
            extract(decode_profile="auto")

    def test_opaque_note_requires_exact_namespace_escape_and_verified_context(self):
        rejected = [
            opaque_fixture(namespace="urn:unapproved"),
            opaque_fixture(namespace="http://www.xbrl.org/tifrs/notes/2019-06-30"),
            opaque_fixture(namespace=sorted(M.OPAQUE_NOTE_NAMESPACES)[0] + "/fake"),
            opaque_fixture(note_attrs='contextRef="c" escape="false"'),
            opaque_fixture(note_attrs='contextRef="c" escape="true" continuedAt="suffix"'),
            opaque_fixture().replace(M.OPAQUE_NOTE_LOCAL.encode(), b"OtherNote"),
        ]
        for data in rejected:
            with self.subTest(source=hashlib.sha256(data).hexdigest()), self.assertRaisesRegex(M.ExtractionError, "OPAQUE_UNDECODABLE_OUTSIDE_APPROVED_NOTE"):
                extract_opaque(data)
        for data, code in [
            (opaque_fixture(note_attrs='contextRef="missing" escape="true"'), "OPAQUE_NOTE_CONTEXT_INVALID"),
            (opaque_fixture().replace(b">2330</x:identifier>", b">2882</x:identifier>"), "OPAQUE_NOTE_ENTITY_MISMATCH"),
            (opaque_fixture().replace(b"2026-04-01", b"2026-44-01"), "OPAQUE_NOTE_PERIOD_INVALID"),
            (opaque_fixture().replace(b"2026-04-01", b"2025-04-01"), "OPAQUE_NOTE_PERIOD_INVALID"),
            (opaque_fixture().replace(b'<x:period>', b'<x:period xsi:nil="true">'), "OPAQUE_NOTE_CONTEXT_INVALID"),
        ]:
            with self.subTest(code=code), self.assertRaisesRegex(M.ExtractionError, code):
                extract_opaque(data)

    def test_opaque_note_observed_namespaces_are_exact_and_never_year_or_scheme_guesses(self):
        approved = {"http://www.xbrl.org/tifrs/notes/2020-06-30",
                    "http://www.xbrl.org/tifrs/notes/2025-06-30",
                    "http://www.xbrl.org/tifrs/notes/2026-03-31"}
        self.assertEqual(M.OPAQUE_NOTE_NAMESPACES, approved)
        for namespace in sorted(approved):
            with self.subTest(namespace=namespace):
                result = extract_opaque(opaque_fixture(namespace=namespace))
                self.assertEqual(len(result["rows"]), 3)
                self.assertEqual(result["source_decoding"]["opaque_invalid_bytes"], 1)
                self.assertEqual(result["source_decoding"]["excluded_note_namespaces"], [namespace])
        unapproved = ["http://www.xbrl.org/tifrs/notes/2020-06-30/fake",
                      "https://www.xbrl.org/tifrs/notes/2020-06-30",
                      "http://www.xbrl.org/tifrs/notes/2019-06-30",
                      "urn:fake:ApplicationOfNewlyIssuedOrAmendedStandardsAndInterpretations"]
        for namespace in unapproved:
            with self.subTest(namespace=namespace), self.assertRaisesRegex(M.ExtractionError, "OPAQUE_UNDECODABLE_OUTSIDE_APPROVED_NOTE"):
                extract_opaque(opaque_fixture(namespace=namespace))

    def test_opaque_byte_cannot_enter_finance_resources_attributes_or_other_text(self):
        clean = fixture().encode("cp950")
        rejected = [
            clean.replace(b">1.25</ix:nonFraction>", b">1.\x8425</ix:nonFraction>"),
            clean.replace(b">2330</x:identifier>", b">23\x8430</x:identifier>"),
            clean.replace(b">iso:TWD</x:measure>", b">iso:TW\x84D</x:measure>"),
            clean.replace(b'contextRef="c"', b'contextRef="c\x84"', 1),
            clean.replace(b'xmlns:ifrs="', b'xmlns:ifrs="\x84', 1),
            clean.replace(b'ifrs:BasicEarningsLossPerShare', b'ifrs:BasicEarnings\x84LossPerShare', 1),
            clean.replace(b'</body>', b'<p>\x84</p></body>'),
            opaque_fixture().replace(b"\x84", b"\x81"),
            opaque_fixture().replace(b'notes:', b'other:', 1),
        ]
        for data in rejected:
            with self.subTest(source=hashlib.sha256(data).hexdigest()), self.assertRaises(M.ExtractionError):
                extract_opaque(data)
        other_fact = '<ix:nonFraction name="ifrs:OtherMetric" contextRef="c" unitRef="eps">OPAQUE_BYTE</ix:nonFraction>'
        with self.assertRaisesRegex(M.ExtractionError, "OPAQUE_UNDECODABLE_OUTSIDE_APPROVED_NOTE"):
            extract_opaque(fixture(extra=other_fact).encode("cp950").replace(b"OPAQUE_BYTE", b"\x84"))

    def test_opaque_note_does_not_crop_suffix_conflicts_resource_ids_or_rebindings(self):
        fact = '<ix:nonFraction name="ifrs:BasicEarningsLossPerShare" contextRef="c" unitRef="eps" decimals="2" format="ixt:numdotdecimal">2.25</ix:nonFraction>'
        result = extract_opaque(opaque_fixture(extra=fact))
        self.assertNotIn("basic_eps", rows(result))
        self.assertIn({"metric": "basic_eps", "reason": "DUPLICATE_FACT_CONFLICT"}, result["missing"])
        with self.assertRaisesRegex(M.ExtractionError, "DUPLICATE_RESOURCE_ID"):
            extract_opaque(opaque_fixture(extra='<x:context id="c"/>'))
        rebound = opaque_fixture(namespace="urn:wrong").replace(b'<ix:nonNumeric ', b'<ix:nonNumeric xmlns:notes="urn:wrong" ', 1)
        with self.assertRaisesRegex(M.ExtractionError, "DUPLICATE_ATTRIBUTE"):
            extract_opaque(rebound)
        # Rebinding a finance prefix in a later, well-formed fact remains an
        # explicit rejected candidate; it never replaces an approved concept.
        rebound_fact = fact.replace('<ix:nonFraction ', '<ix:nonFraction xmlns:ifrs="urn:wrong" ')
        result = extract_opaque(opaque_fixture(extra=rebound_fact))
        self.assertEqual(rows(result)["basic_eps"]["value_decimal"], "1.25")
        self.assertEqual(result["rejections"]["CONCEPT_NAMESPACE_NOT_APPROVED"], 1)

    def test_opaque_note_cannot_hide_markup_nested_facts_or_boundary_damage(self):
        bad = [
            opaque_fixture(body="<span>OPAQUE_BYTE</span>"),
            opaque_fixture(body="OPAQUE_BYTE<span>later</span>"),
            opaque_fixture(body='<ix:nonFraction name="ifrs:Other" contextRef="c">OPAQUE_BYTE</ix:nonFraction>'),
            opaque_fixture().replace(b'</ix:nonNumeric>', b'</ix:non\x84Numeric>'),
            opaque_fixture().replace(b'</ix:nonNumeric>', b'</ix:nonNumeri>'),
            opaque_fixture().replace(b'</ix:nonNumeric>', b''),
            opaque_fixture().replace(b'<ix:nonNumeric ', b'<ix:non\x84Numeric '),
            opaque_fixture().replace(b'</ix:nonNumeric>', b'<!--\x84--></ix:nonNumeric>'),
        ]
        for data in bad:
            with self.subTest(source=hashlib.sha256(data).hexdigest()), self.assertRaises(M.ExtractionError):
                extract_opaque(data)
        nested = opaque_fixture().replace(b'<ix:nonNumeric ', b'<ix:nonFraction name="ifrs:Other"><ix:nonNumeric ', 1).replace(b'</ix:nonNumeric>', b'</ix:nonNumeric></ix:nonFraction>', 1)
        with self.assertRaises(M.ExtractionError):
            extract_opaque(nested)

    def test_opaque_profile_limits_and_receipt_binding_cover_complete_source(self):
        with self.assertRaisesRegex(M.ExtractionError, "OPAQUE_BYTE_LIMIT"):
            extract_opaque(opaque_fixture(body="OPAQUE_BYTE" * (M.MAX_OPAQUE_INVALID_BYTES + 1)))
        data = opaque_fixture(extra="<span></span>" * 20)
        with self.assertRaisesRegex(M.ExtractionError, "TAG_LIMIT"):
            extract_opaque(data, limits=replace(M.Limits(), max_tags=35))
        for limits in [replace(M.Limits(), max_bytes=10), replace(M.Limits(), max_depth=2),
                       replace(M.Limits(), max_capture_chars=2), replace(M.Limits(), seconds=1e-12)]:
            with self.subTest(limits=limits), self.assertRaises(M.ExtractionError):
                extract_opaque(limits=limits)
        with self.assertRaisesRegex(M.ExtractionError, "RECEIPT_BYTES_MISMATCH"):
            M.extract_actuals(data + b"suffix", receipt(data), entity="2330", year=2026, quarter=2,
                              encoding="cp950", decode_profile=M.OPAQUE_NOTE_PROFILE)

    def test_individual_statement_profile_is_explicit_mutually_exclusive_and_provenance_limited(self):
        data = fixture().encode()
        individual = {**receipt(data), "url": receipt(data)["url"].replace("REPORT_ID=C", "REPORT_ID=A")}
        with self.assertRaisesRegex(M.ExtractionError, "SOURCE_QUERY_NOT_APPROVED"):
            M.extract_actuals(data, individual, entity="2330", year=2026, quarter=2, encoding="utf-8")
        result = M.extract_actuals(data, individual, entity="2330", year=2026, quarter=2,
                                  encoding="utf-8", statement_profile="individual", revenue_mode="ifrs-revenue")
        self.assertEqual(len(result["rows"]), 3)
        self.assertEqual(result["statement_profile"], "individual")
        self.assertEqual(result["statement_basis"], "REQUESTED_INDIVIDUAL_A_WITH_ENTITY_CONTEXT_VERIFIED")
        for row in result["rows"]:
            self.assertEqual(row["source_report_period"]["report_id"], "A")
            self.assertEqual(row["statement_basis"], result["statement_basis"])
            self.assertEqual(row["ordinary_share_basis"], "NOT_PROVEN_BY_UNIT")
            self.assertEqual(row["consolidation_basis"], "NOT_PROVEN_BY_CONTEXT_OR_QUERY")
        self.assertFalse(result["source_admitted"])
        for source_report_id in ("B", "C", "a", "A "):
            changed = {**individual, "url": individual["url"].replace("REPORT_ID=A", "REPORT_ID=" + source_report_id)}
            with self.subTest(report_id=source_report_id), self.assertRaisesRegex(M.ExtractionError, "SOURCE_QUERY_NOT_APPROVED"):
                M.extract_actuals(data, changed, entity="2330", year=2026, quarter=2,
                                  encoding="utf-8", statement_profile="individual")
        with self.assertRaisesRegex(M.ExtractionError, "SOURCE_QUERY_NOT_APPROVED"):
            M.extract_actuals(data, {**individual, "url": individual["url"].replace("CO_ID=2330", "CO_ID=4908")},
                              entity="2330", year=2026, quarter=2, encoding="utf-8", statement_profile="individual")
        for profile in ("auto", "A", None, 1):
            with self.subTest(profile=profile), self.assertRaisesRegex(M.ExtractionError, "STATEMENT_PROFILE_UNSUPPORTED"):
                extract(statement_profile=profile)

    def test_individual_profile_keeps_entity_quarter_unit_and_capture_type_controls(self):
        for text, reason in [
            (fixture().replace(">2330</x:identifier>", ">4908</x:identifier>"), "OTHER_ENTITY"),
            (fixture().replace("2026-04-01", "2026-01-01"), "NOT_EXACT_QUARTER"),
            (fixture().replace('unitRef="eps"', 'unitRef="twd"'), "METRIC_UNIT_MISMATCH"),
        ]:
            data = text.encode()
            r = {**receipt(data), "url": receipt(data)["url"].replace("REPORT_ID=C", "REPORT_ID=A")}
            result = M.extract_actuals(data, r, entity="2330", year=2026, quarter=2,
                                      encoding="utf-8", statement_profile="individual")
            self.assertNotIn("basic_eps", rows(result))
            self.assertGreater(result["rejections"][reason], 0)
        data = fixture().encode()
        for not_bytes in (bytearray(data), data.decode()):
            with self.subTest(value_type=type(not_bytes).__name__), self.assertRaisesRegex(M.ExtractionError, "BYTE_LIMIT"):
                M.extract_actuals(not_bytes, receipt(data), entity="2330", year=2026, quarter=2,
                                  encoding="utf-8", statement_profile="individual")
        with self.assertRaisesRegex(M.ExtractionError, "RECEIPT_SCHEMA_INVALID"):
            M.extract_actuals(data, [], entity="2330", year=2026, quarter=2,
                              encoding="utf-8", statement_profile="individual")

    def test_cli_profiles_are_explicit_and_invalid_choices_or_default_individual_are_refused(self):
        data = fixture().encode()
        r = {**receipt(data), "url": receipt(data)["url"].replace("REPORT_ID=C", "REPORT_ID=A")}
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            html, captured = directory / "source.html", directory / "receipt.json"
            html.write_bytes(data)
            captured.write_text(json.dumps(r))
            args = [sys.executable, "-B", str(ROOT / "scripts/official-actuals/inline_xbrl.py"),
                    "--html", str(html), "--receipt", str(captured), "--entity", "2330",
                    "--year", "2026", "--quarter", "2", "--encoding", "utf-8"]
            default = subprocess.run(args, capture_output=True, text=True, check=False)
            self.assertEqual(default.returncode, 2)
            self.assertEqual(json.loads(default.stdout)["error"], "SOURCE_QUERY_NOT_APPROVED")
            explicit = subprocess.run(args + ["--statement-profile", "individual"], capture_output=True, text=True, check=False)
            self.assertEqual(explicit.returncode, 0)
            self.assertEqual(json.loads(explicit.stdout)["statement_profile"], "individual")
            for switches in (["--statement-profile", "auto"], ["--decode-profile", "auto"],
                             ["--decode-profile", M.OPAQUE_NOTE_PROFILE, "--statement-profile", "individual"]):
                refused = subprocess.run(args + switches, capture_output=True, text=True, check=False)
                self.assertEqual(refused.returncode, 2)

    def test_byte_tags_depth_resources_text_and_time_limits(self):
        controls = [replace(M.Limits(), max_bytes=10), replace(M.Limits(), max_tags=3),
                    replace(M.Limits(), max_depth=2), replace(M.Limits(), max_units=1),
                    replace(M.Limits(), max_facts=1), replace(M.Limits(), max_capture_chars=2),
                    replace(M.Limits(), max_tag_chars=20), replace(M.Limits(), seconds=1e-12)]
        for limits in controls:
            with self.subTest(limits=limits), self.assertRaises(M.ExtractionError):
                extract(limits=limits)
        with self.assertRaisesRegex(M.ExtractionError, "LIMITS_INVALID"):
            extract(limits=replace(M.Limits(), max_bytes=99_000_000))
        many_namespaces = ' '.join(f'xmlns:p{i}="urn:example:{i}"' for i in range(65))
        with self.assertRaisesRegex(M.ExtractionError, "NAMESPACE_BINDING_LIMIT"):
            extract(fixture(fact_attrs=many_namespaces))
        many_attributes = ' '.join(f'data-p{i}="x"' for i in range(129))
        with self.assertRaisesRegex(M.ExtractionError, "ATTRIBUTE_COUNT_LIMIT"):
            extract(fixture(fact_attrs=many_attributes))


if __name__ == "__main__":
    unittest.main(verbosity=2)
