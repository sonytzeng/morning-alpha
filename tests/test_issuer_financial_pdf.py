"""Synthetic rejection controls plus opt-in local-original replay; no saved PDFs."""
import hashlib
import importlib.util
import os
from pathlib import Path
import sys
import unittest
from dataclasses import replace
from datetime import datetime

# Importing the local parser must not create unreviewed bytecode in the source
# inventory. Real-original replays remain opt-in and separately reported.
sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("issuer_financial_pdf", ROOT / "scripts/official-actuals/issuer-financial-pdf.py")
M = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = M
SPEC.loader.exec_module(M)
URL = "https://www.cathayholdings.com/holdings/-/media/ddbe3183b0e94c799145bc1a7074f50a.pdf?sc_lang=zh-tw"


def w(text, x, y):
    return M.Word(text, x, x + 20, y, y + 8)


def table(*, current="2026", direct="Three", amount="7.13", ytd="19.42"):
    return [w("For the", 160, 70), w(direct, 200, 70), w("Months Ended", 225, 70),
            w("June", 200, 80), w("30", 225, 80), w("Six", 400, 70),
            w("Months Ended", 425, 70), w("June", 400, 80), w("30", 425, 80),
            w(current, 200, 100), w("2025", 300, 100), w(current, 400, 100), w("2025", 500, 100),
            w("Basic earnings per share", 20, 130), w(amount, 200, 130),
            w("(1.23)", 300, 130), w(ytd, 400, 130), w("8.43", 500, 130)]


PROOF = ("Unit: NT$ Per Share Weighted Average Number of Ordinary Shares Outstanding "
         "ordinary shares used in the computation of basic earnings per share "
         "Less: Dividends on preference shares")


class GeometryControls(unittest.TestCase):
    def test_direct_column_not_ytd_and_no_hardcoded_eps(self):
        result = M.direct_eps(table(amount="7.13", ytd="19.42"), year=2026, quarter=2)
        self.assertEqual(result["value_decimal"], "7.13")
        self.assertEqual(result["column_index"], 0)
        self.assertEqual(result["resolution_decimal"], "0.01")
        self.assertEqual(M.direct_eps(table(amount="0.00"), year=2026, quarter=2)["value_decimal"], "0.00")

    def test_negative_eps_preserved(self):
        self.assertEqual(M.direct_eps(table(amount="(7.13)"), year=2026, quarter=2)["value_decimal"], "-7.13")

    def test_ytd_only_rejected(self):
        with self.assertRaisesRegex(M.ExtractionError, "DIRECT_THREE_MONTH"):
            M.direct_eps(table(direct="Six"), year=2026, quarter=2)

    def test_comparative_year_cannot_be_selected_as_current(self):
        with self.assertRaisesRegex(M.ExtractionError, "CURRENT_YEAR"):
            M.direct_eps(table(current="2024"), year=2026, quarter=2)

    def test_wrong_quarter_header_rejected(self):
        with self.assertRaisesRegex(M.ExtractionError, "DIRECT_THREE_MONTH"):
            M.direct_eps(table(), year=2026, quarter=1)

    def test_diluted_or_prose_not_basic(self):
        words = [replace(x, text="Diluted earnings per share") if x.text.startswith("Basic") else x for x in table()]
        with self.assertRaisesRegex(M.ExtractionError, "BASIC_EPS_ROW"):
            M.direct_eps(words, year=2026, quarter=2)

    def test_duplicate_basic_rows_rejected(self):
        with self.assertRaisesRegex(M.ExtractionError, "AMBIGUOUS_BASIC"):
            M.direct_eps(table() + [w("Basic earnings per share", 20, 155)], year=2026, quarter=2)

    def test_missing_or_misaligned_value_not_filled(self):
        words = [x for x in table() if x.text != "7.13"]
        with self.assertRaisesRegex(M.ExtractionError, "EPS_VALUE_ROW"):
            M.direct_eps(words, year=2026, quarter=2)
        words = [replace(x, x0=500, x1=520) if x.text == "7.13" else x for x in table()]
        with self.assertRaisesRegex(M.ExtractionError, "ALIGNMENT"):
            M.direct_eps(words, year=2026, quarter=2)

    def test_precision_not_inferred_from_thousands_unit(self):
        words = [replace(x, text="7.1") if x.text == "7.13" else x for x in table()]
        with self.assertRaisesRegex(M.ExtractionError, "EPS_VALUE_ROW"):
            M.direct_eps(words, year=2026, quarter=2)

    def test_ordinary_and_preference_note_are_required_for_q2(self):
        self.assertTrue(M.ordinary_share_proof(PROOF, year=2026, quarter=2))
        with self.assertRaisesRegex(M.ExtractionError, "ORDINARY_SHARE"):
            M.ordinary_share_proof(PROOF.replace("Ordinary Shares", "Preference Shares"), year=2026, quarter=2)
        with self.assertRaisesRegex(M.ExtractionError, "PREFERENCE_DIVIDEND"):
            M.ordinary_share_proof(PROOF.replace("Dividends on preference shares", ""), year=2026, quarter=2)

    def test_note_unit_is_explicit(self):
        with self.assertRaisesRegex(M.ExtractionError, "NOTE_EPS_UNIT"):
            M.ordinary_share_proof(PROOF.replace("Unit: NT$ Per Share", "Unit: thousands"), year=2026, quarter=2)

    def test_statement_note_conflict_fails_closed(self):
        with self.assertRaisesRegex(M.ExtractionError, "STATEMENT_NOTE_EPS_CONFLICT"):
            M.verify_eps_agreement({"value_decimal": "7.13"}, {"value_decimal": "7.14"})

    def test_q1_missing_preference_row_is_not_claimed_zero(self):
        self.assertFalse(M.ordinary_share_proof(PROOF.replace("Dividends on preference shares", ""), year=2026, quarter=1))

    def test_accounting_mentions_of_future_ifrs17_not_adoption(self):
        with self.assertRaisesRegex(M.ExtractionError, "ACCOUNTING_BASIS"):
            M.accounting_basis({13: "IFRS 17 will supersede IFRS 4 in 2026"}, 2026)
        legacy = M.accounting_basis({24: "overlay approach under IFRS 4"}, 2025)
        modern = M.accounting_basis({14: "retrospectively applied IFRS 17 and restated comparative information"}, 2026)
        self.assertNotEqual(legacy["basis"], modern["basis"])
        self.assertFalse(modern["four_consecutive_comparable_quarters"])

    def test_protocol_limits_and_wrong_hash_fail_before_pdf_decode(self):
        data = b"%PDF-not-a-real-PDF"
        args = dict(year=2026, quarter=2, source_url=URL, expected_sha256=hashlib.sha256(data).hexdigest())
        for changes, code in [({"quarter": 4}, "PERIOD_NOT_PROFILED"),
                              ({"expected_sha256": "0" * 64}, "SHA256_MISMATCH"),
                              ({"limits": M.Limits(max_bytes=1)}, "BYTE_LIMIT"),
                              ({"source_url": URL.replace("www.cathayholdings.com", "evil.example")}, "URL_NOT_PROFILED")]:
            with self.subTest(code=code), self.assertRaisesRegex(M.ExtractionError, code):
                M.extract_actuals(data, **(args | changes))


@unittest.skipUnless(os.environ.get("MA_ISSUER_FINANCIAL_PDF_DIR"), "local original replay explicitly enabled")
class OriginalReplay(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        directory = Path(os.environ["MA_ISSUER_FINANCIAL_PDF_DIR"])
        cases = [(2026, 2, "32b47d83ed389e488b4a21700aa06202fd01629c7e9a0f97639f5ec141ef0b6a", "ddbe3183b0e94c799145bc1a7074f50a"),
                 (2026, 1, "4077649dec0b872598d21890c78defeddaec24a6662ab6ed418cfff325e9bdf1", "5ebb55818af74822ab4882600f00c6d7"),
                 (2025, 3, "3f7cfe4c4e10e7e24ec8a17a0b1bff2b4a9e9afdf1f7849d374e400ede9ff43f", "dd66525ab69f4f65928a94140779663e")]
        cls.results = {}
        for year, quarter, sha, identity in cases:
            path = directory / f"cathay-{year}q{quarter}.pdf"
            cls.results[(year, quarter)] = M.extract_actuals(path.read_bytes(), year=year, quarter=quarter,
                source_url=f"https://www.cathayholdings.com/holdings/-/media/{identity}.pdf", expected_sha256=sha)

    def test_three_originals_direct_eps_and_actual_note_numbers(self):
        # Expectations are regression assertions, never parser constants.
        for period, expected, note in [((2026, 2), "2.80", 31), ((2026, 1), "2.15", 30), ((2025, 3), "1.95", 29)]:
            row = self.results[period]["rows"][0]
            self.assertEqual(row["value_decimal"], expected)
            self.assertEqual(row["evidence"]["eps_note_number"], note)
            self.assertEqual(row["share_class"], "ORDINARY")
            self.assertEqual(row["unit"], "TWD/ordinary_share")
            self.assertFalse(row["evidence"]["ytd_subtraction_used"])

    def test_time_and_version_never_fabricated(self):
        for result in self.results.values():
            for field in ["source_received_at", "first_seen_at", "announced_at", "source_version", "revision_chain"]:
                self.assertIsNone(result[field])
            self.assertLessEqual(datetime.fromisoformat(result["first_verified_at"]), datetime.fromisoformat(result["conservative_available_at"]))
            self.assertFalse(result["source_admission"])
            self.assertFalse(result["member_publication"])

    def test_no_revenue_rename_or_four_quarter_claim(self):
        for result in self.results.values():
            self.assertEqual([r["metric"] for r in result["rows"]], ["basic_eps"])
            self.assertIn("financial_net_revenue", [r.get("metric") for r in result["missing"]])
            self.assertFalse(result["coverage"]["four_consecutive_comparable_quarters"])
            self.assertFalse(result["coverage"]["cross_period_growth_computed"])
            self.assertTrue(result["unmapped_financial_statement_labels"])
            self.assertTrue(all(not x["generic_revenue_equivalence"] for x in result["unmapped_financial_statement_labels"]))
        self.assertNotEqual(self.results[(2025, 3)]["rows"][0]["accounting"]["basis"], self.results[(2026, 2)]["rows"][0]["accounting"]["basis"])

    def test_actual_pdf_wrong_period_and_resource_limits_are_rejected(self):
        path = Path(os.environ["MA_ISSUER_FINANCIAL_PDF_DIR"]) / "cathay-2026q2.pdf"
        data = path.read_bytes()
        args = dict(year=2026, quarter=2, source_url=URL, expected_sha256=hashlib.sha256(data).hexdigest())
        for changes, code in [({"quarter": 1}, "COVER_REPORT_PERIOD_MISMATCH"),
                              ({"limits": M.Limits(max_pages=10)}, "PDF_PAGE_LIMIT"),
                              ({"limits": M.Limits(seconds=0)}, "PARSE_DEADLINE"),
                              ({"limits": M.Limits(max_page_chars=10)}, "PAGE_TEXT_LIMIT"),
                              ({"limits": M.Limits(max_total_chars=10)}, "TOTAL_TEXT_LIMIT")]:
            with self.subTest(code=code), self.assertRaisesRegex(M.ExtractionError, code):
                M.extract_actuals(data, **(args | changes))


if __name__ == "__main__":
    unittest.main()
