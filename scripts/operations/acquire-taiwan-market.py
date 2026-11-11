#!/usr/bin/env python3
"""Capture explicitly selected public exchange datasets, once per invocation.

No credentials, redirects, retries, provider substitutions or production writes.
Original bytes and actual acquisition time are preserved before normalization.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import time
import urllib.error
import urllib.request

SOURCES = {
    "twse_companies": ("https://openapi.twse.com.tw/v1/opendata/t187ap03_L", "json", 8_000_000),
    "tpex_companies": ("https://mopsfin.twse.com.tw/opendata/t187ap03_O.csv", "csv", 8_000_000),
    "emerging_companies": ("https://mopsfin.twse.com.tw/opendata/t187ap03_R.csv", "csv", 8_000_000),
    "twse_api_schema": ("https://openapi.twse.com.tw/v1/swagger.json", "json", 8_000_000),
    "tpex_api_schema": ("https://www.tpex.org.tw/openapi/swagger.json", "json", 8_000_000),
}
CATALOG_PATH = Path(__file__).resolve().parents[2] / "research" / "taiwan-market-sources.json"
CATALOG = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
if CATALOG.get("schema") != "TAIWAN_OFFICIAL_DATASET_CATALOG_V1":
    raise ValueError("DATASET_CATALOG_SCHEMA")
for source in CATALOG["sources"]:
    url = source["url"]
    if not (url.startswith("https://openapi.twse.com.tw/v1/") or url.startswith("https://www.tpex.org.tw/openapi/v1/")):
        raise ValueError("DATASET_CATALOG_SOURCE")
    if source["id"] in SOURCES or source["format"] != "json" or not 1 <= source["byte_limit"] <= 16_000_000:
        raise ValueError("DATASET_CATALOG_IDENTITY")
    SOURCES[source["id"]] = (url, source["format"], source["byte_limit"])


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def capture(source_id, destination, opener):
    url, format_name, byte_limit = SOURCES[source_id]
    receipt = {"schema": "TAIWAN_PUBLIC_SOURCE_RECEIPT_V1", "source_id": source_id,
               "url": url, "format": format_name, "started_at": utc_now(),
               "state": "UNAVAILABLE", "attempts": 1, "byte_limit": byte_limit,
               "source_as_of": None, "historical_knowledge": False}
    try:
        request = urllib.request.Request(url, headers={"Accept": "application/json,text/csv"})
        with opener.open(request, timeout=25) as response:
            receipt["status"] = response.status
            receipt["content_type"] = response.headers.get("Content-Type", "")
            receipt["etag"] = response.headers.get("ETag")
            receipt["last_modified"] = response.headers.get("Last-Modified")
            if response.status != 200 or response.geturl() != url:
                raise ValueError("HTTP_STATUS_OR_REDIRECT")
            data = response.read(byte_limit + 1)
            receipt["received_at"] = utc_now()
            if len(data) > byte_limit:
                raise ValueError("RESPONSE_TOO_LARGE")
            if not data:
                raise ValueError("EMPTY_RESPONSE")
            digest = hashlib.sha256(data).hexdigest()
            raw_path = destination / "raw" / f"{source_id}-{digest}.{format_name}"
            raw_path.parent.mkdir(parents=True, exist_ok=True)
            if raw_path.exists():
                if raw_path.read_bytes() != data:
                    raise ValueError("CONTENT_ADDRESS_COLLISION")
            else:
                raw_path.write_bytes(data)
            receipt.update({"raw_path": str(raw_path.resolve()), "sha256": digest, "bytes": len(data)})
            text = data.decode("utf-8-sig", errors="strict")
            if text.lstrip().lower().startswith(("<!doctype", "<html")):
                raise ValueError("HTML_INSTEAD_OF_DATA")
            if format_name == "json":
                parsed = json.loads(text)
                if not isinstance(parsed, (list, dict)):
                    raise ValueError("JSON_DATASET_SHAPE")
                receipt["row_count"] = len(parsed) if isinstance(parsed, list) else None
            else:
                import csv
                import io
                rows = list(csv.DictReader(io.StringIO(text, newline="")))
                if not rows or "公司代號" not in rows[0]:
                    raise ValueError("COMPANY_CSV_COLUMNS")
                receipt["row_count"] = len(rows)
            receipt["state"] = "CAPTURED"
    except urllib.error.HTTPError as error:
        receipt.update({"status": error.code, "error": "HTTP_" + str(error.code)})
    except urllib.error.URLError as error:
        receipt["error"] = "TRANSPORT_UNAVAILABLE: " + type(error.reason).__name__
    except (ValueError, UnicodeError, TimeoutError, OSError) as error:
        receipt["error"] = type(error).__name__ + ": " + str(error)[:200]
    receipt.setdefault("received_at", utc_now())
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    selection = parser.add_mutually_exclusive_group(required=True)
    selection.add_argument("--source", action="append", choices=sorted(SOURCES))
    selection.add_argument("--group", choices=["daily"])
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.group:
        args.source = [s["id"] for s in CATALOG["sources"] if s["group"] == args.group]
    if len(set(args.source)) != len(args.source):
        parser.error("Duplicate source selection is not allowed")
    args.output.mkdir(parents=True, exist_ok=True)
    run_started = utc_now()
    opener = urllib.request.build_opener(NoRedirect)
    receipts = []
    for i, source in enumerate(args.source):
        if i:
            time.sleep(1)
        receipt = capture(source, args.output, opener)
        receipts.append(receipt)
        print(json.dumps(receipt, ensure_ascii=False), flush=True)
        document = {"schema": "TAIWAN_PUBLIC_ACQUISITION_V1", "started_at": run_started,
                    "updated_at": utc_now(), "selected_sources": args.source, "receipts": receipts,
                    "production_writes": 0}
        path = args.output / ("acquisition-" + run_started.replace(":", "").replace(".", "-") + ".json")
        path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0 if all(r["state"] == "CAPTURED" for r in receipts) else 2


if __name__ == "__main__":
    raise SystemExit(main())
