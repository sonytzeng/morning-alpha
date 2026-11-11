#!/usr/bin/env python3
"""Prepare an immutable, private bootstrap seed. Offline only; never executes SQL.

Original capture bytes and receipt times remain unchanged. The ZIP's fixed file
timestamps describe packaging only and are not source-observation timestamps.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import stat
from datetime import datetime, timezone
import zipfile

CHUNK_BYTES = 1_048_576
MAX_ARCHIVE = 268_435_456
MAX_EXPANDED = 1_073_741_824
MAX_FILE = 268_435_456
MAX_ENTRIES = 20_000


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def prepare(cache: Path, output: Path) -> dict:
    cache = cache.resolve(strict=True)
    if not cache.is_dir() or output.exists():
        raise ValueError("SEED_EXISTING_CACHE_AND_NEW_OUTPUT_REQUIRED")
    if cache == output.resolve() or cache in output.resolve().parents:
        raise ValueError("SEED_OUTPUT_MUST_BE_OUTSIDE_CACHE")
    for name in ("cache-state.json", "latest.json"):
        if not (cache / name).is_file():
            raise ValueError("SEED_REQUIRED_CACHE_FILE:" + name)
    files = []
    for path in sorted(cache.rglob("*")):
        if path.is_symlink():
            raise ValueError("SEED_SYMLINK_REJECTED")
        if path.is_dir():
            continue
        relative = path.relative_to(cache)
        if not path.is_file() or any(part.startswith(".") for part in relative.parts):
            raise ValueError("SEED_NON_REGULAR_OR_HIDDEN_FILE")
        if "\\" in str(relative) or ":" in str(relative):
            raise ValueError("SEED_UNSAFE_PATH")
        size = path.stat().st_size
        if size > MAX_FILE:
            raise ValueError("SEED_FILE_TOO_LARGE:" + relative.as_posix())
        files.append((path, relative, size))
    expanded = sum(size for _, _, size in files)
    if not files or len(files) > MAX_ENTRIES or expanded > MAX_EXPANDED:
        raise ValueError("SEED_EXPANSION_LIMIT")
    output.mkdir(parents=True, exist_ok=False)
    os.chmod(output, 0o700)
    created = datetime.now(timezone.utc)
    archive = output / ("Morning_Alpha_Taiwan_Private_Seed_" + created.strftime("%Y%m%d") + ".zip")
    saved = []
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED,
                         compresslevel=6, allowZip64=False) as zf:
        for path, relative, size in files:
            raw = path.read_bytes()
            if len(raw) != size:
                raise ValueError("SEED_SOURCE_CHANGED_DURING_PACKAGE")
            info = zipfile.ZipInfo("input-cache/" + relative.as_posix(), (1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (stat.S_IFREG | 0o600) << 16
            zf.writestr(info, raw, compress_type=zipfile.ZIP_DEFLATED, compresslevel=6)
            saved.append({"file": relative.as_posix(), "bytes": size, "sha256": sha(raw)})
    if archive.stat().st_size > MAX_ARCHIVE:
        raise ValueError("SEED_ARCHIVE_LIMIT")
    with zipfile.ZipFile(archive) as zf:
        if zf.testzip() is not None:
            raise ValueError("SEED_ZIP_CRC")
        for entry in zf.infolist():
            if entry.flag_bits & (1 | 8) or entry.extra or entry.comment or entry.extract_version > 20:
                raise ValueError("SEED_UNSUPPORTED_ZIP_HEADER")
        if len(zf.infolist()) != len(saved):
            raise ValueError("SEED_ENTRY_COUNT")
    by_name = {item["file"]: item for item in saved}
    for name in ("cache-state.json", "latest.json"):
        if sha((cache / name).read_bytes()) != by_name[name]["sha256"]:
            raise ValueError("SEED_CACHE_CHANGED_DURING_PACKAGE")
    archive_hash = hashlib.sha256()
    chunks = []
    with archive.open("rb") as stream:
        while raw := stream.read(CHUNK_BYTES):
            archive_hash.update(raw)
            chunks.append({"index": len(chunks), "bytes": len(raw), "sha256": sha(raw)})
    seed_id = archive_hash.hexdigest()
    manifest = {"schema": "DAILY_AI_MARKET_PRIVATE_SEED_V1", "seed_id": seed_id,
                "format": "ZIP", "archive_sha256": seed_id, "archive_bytes": archive.stat().st_size,
                "chunk_bytes": CHUNK_BYTES, "chunk_count": len(chunks), "chunks": chunks,
                "entry_count": len(saved), "uncompressed_bytes": expanded,
                "root_directory": "input-cache", "cache_state_sha256": by_name["cache-state.json"]["sha256"],
                "latest_manifest_sha256": by_name["latest.json"]["sha256"],
                "created_at": created.isoformat(timespec="milliseconds").replace("+00:00", "Z")}
    text = canonical(manifest)
    manifest_hash = sha(text.encode())
    (output / "seed-manifest.json").write_text(text, encoding="utf-8")
    (output / "seed-file-manifest.json").write_text(canonical({"seed_id": seed_id, "files": saved}) + "\n", encoding="utf-8")
    sql = output / "private-import-sql"
    sql.mkdir(mode=0o700)
    # JSON consists only of validated hashes, fixed keys and generated UTC time.
    if "'" in text:
        raise ValueError("SEED_UNEXPECTED_SQL_LITERAL")
    (sql / "000-manifest.sql").write_text(
        "-- Prepared only. Requires separate approval for private source import.\n"
        "select public.stage_daily_ai_market_worker_seed_v2('" + text + "','" + manifest_hash + "');\n", encoding="utf-8")
    with archive.open("rb") as stream:
        for chunk in chunks:
            raw = stream.read(CHUNK_BYTES)
            if sha(raw) != chunk["sha256"]:
                raise ValueError("SEED_ARCHIVE_CHANGED")
            body = base64.b64encode(raw).decode("ascii")
            statement = ("select public.stage_daily_ai_market_worker_seed_chunk_v2('" + seed_id
                         + "'," + str(chunk["index"]) + ",'" + chunk["sha256"] + "','" + body + "');\n")
            (sql / f"{chunk['index'] + 1:03d}-chunk-{chunk['index']:03d}.sql").write_text(statement, encoding="ascii")
    (sql / "999-finalize.sql").write_text(
        "select public.finalize_daily_ai_market_worker_seed_v2('" + seed_id + "','" + manifest_hash + "');\n", encoding="ascii")
    receipt = {"state": "PRIVATE_SEED_PREPARED_NOT_IMPORTED", "archive": str(archive),
               "seed_id": seed_id, "manifest_hash": manifest_hash,
               "archive_bytes": manifest["archive_bytes"], "uncompressed_bytes": expanded,
               "entry_count": len(saved), "chunks": len(chunks), "zip_crc_verified": True,
               "source_bytes_preserved": True, "production_writes": 0, "provider_requests": 0,
               "sql_statements_prepared": len(chunks) + 2}
    (output / "preparation-receipt.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    return receipt


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    print(json.dumps(prepare(args.cache, args.output), ensure_ascii=False))
