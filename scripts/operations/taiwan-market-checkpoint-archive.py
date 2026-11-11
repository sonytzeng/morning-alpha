"""Bounded deterministic archive IO. No network, credentials, or source deletion.

pack consumes a local file inventory on stdin and writes a tar/gzip stream.
unpack verifies every original SHA and safe path before atomic installation by
the Node caller. Extraction is into a newly created private temporary directory.
"""
import gzip
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import stat
import sys
import tarfile

MAX_FILES = 50000
MAX_FILE = 256 * 1024 * 1024
MAX_TOTAL = 8 * 1024 * 1024 * 1024
MAX_MANIFEST = 16 * 1024 * 1024
MANIFEST = "checkpoint-manifest.json"


class BoundedTarInfo(tarfile.TarInfo):
    # tarfile processes extended headers before yielding a member. Bound those
    # declarations too, so a malformed PAX/GNU header cannot allocate gigabytes
    # before our per-file checks get control.
    def _proc_pax(self, archive):
        if self.size > MAX_MANIFEST:
            raise ValueError("ARCHIVE_METADATA_SIZE")
        return super()._proc_pax(archive)

    def _proc_gnulong(self, archive):
        if self.size > MAX_MANIFEST:
            raise ValueError("ARCHIVE_METADATA_SIZE")
        return super()._proc_gnulong(archive)


class BoundedExpandedReader:
    def __init__(self, source, maximum):
        self.source = source
        self.maximum = maximum
        self.count = 0

    def read(self, size=-1):
        if size < 0 or size > MAX_MANIFEST:
            raise ValueError("ARCHIVE_READ_SIZE")
        value = self.source.read(size)
        self.count += len(value)
        if self.count > self.maximum:
            raise ValueError("ARCHIVE_EXPANDED_SIZE")
        return value


def check_path(name):
    if not isinstance(name, str) or not name or "\\" in name or "\x00" in name:
        raise ValueError("ARCHIVE_PATH")
    p = PurePosixPath(name)
    if p.is_absolute() or str(p) != name or any(x in ("", ".", "..") for x in p.parts):
        raise ValueError("ARCHIVE_PATH")
    return p


def original(root, name):
    p = root
    for part in check_path(name).parts:
        p = p / part
        if p.is_symlink():
            raise ValueError("ARCHIVE_SYMLINK")
    if not p.is_file():
        raise ValueError("ARCHIVE_FILE")
    return p


class VerifiedReader:
    def __init__(self, source, expected):
        self.source = source
        self.expected = expected
        self.digest = hashlib.sha256()
        self.size = 0

    def read(self, size=-1):
        value = self.source.read(size)
        self.digest.update(value)
        self.size += len(value)
        if self.size > self.expected["bytes"]:
            raise ValueError("ARCHIVE_SOURCE_CHANGED")
        return value

    def verify(self):
        if self.source.read(1) or self.size != self.expected["bytes"] or self.digest.hexdigest() != self.expected["sha256"]:
            raise ValueError("ARCHIVE_SOURCE_CHANGED")


def manifest_valid(value):
    if value.get("schema") != "TAIWAN_MARKET_CHECKPOINT_FILES_V1" or value.get("kind") not in ("AUDIT", "RESUME"):
        raise ValueError("ARCHIVE_MANIFEST")
    files = value.get("files")
    if not isinstance(files, list) or len(files) + 1 > MAX_FILES:
        raise ValueError("ARCHIVE_FILE_COUNT")
    names = set()
    total = 0
    for item in files:
        name = item.get("file")
        check_path(name)
        if name == MANIFEST or name in names:
            raise ValueError("ARCHIVE_DUPLICATE")
        names.add(name)
        if type(item.get("bytes")) is not int or not 0 <= item["bytes"] <= MAX_FILE:
            raise ValueError("ARCHIVE_FILE_SIZE")
        digest = item.get("sha256", "")
        if len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
            raise ValueError("ARCHIVE_FILE_HASH")
        total += item["bytes"]
        if total > MAX_TOTAL:
            raise ValueError("ARCHIVE_TOTAL")
    if value.get("total_bytes") != total:
        raise ValueError("ARCHIVE_TOTAL")
    return files


def pack(request):
    root = Path(request["root"]).resolve()
    value = request["manifest"]
    files = manifest_valid(value)
    encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()
    if len(encoded) > MAX_MANIFEST:
        raise ValueError("ARCHIVE_MANIFEST_SIZE")
    with gzip.GzipFile(fileobj=sys.stdout.buffer, mode="wb", filename="", mtime=0, compresslevel=6) as zipped:
        with tarfile.open(fileobj=zipped, mode="w|", format=tarfile.PAX_FORMAT) as archive:
            info = tarfile.TarInfo(MANIFEST)
            info.size = len(encoded)
            info.mode = 0o600
            archive.addfile(info, io.BytesIO(encoded))
            for item in files:
                p = original(root, item["file"])
                if p.stat().st_size != item["bytes"]:
                    raise ValueError("ARCHIVE_SOURCE_CHANGED")
                info = tarfile.TarInfo(item["file"])
                info.size = item["bytes"]
                info.mode = 0o600
                with p.open("rb") as stream:
                    checked = VerifiedReader(stream, item)
                    archive.addfile(info, checked)
                    checked.verify()


def unpack(request):
    root = Path(request["output"])
    if root.exists():
        raise ValueError("ARCHIVE_OUTPUT_EXISTS")
    root.mkdir(parents=False, mode=0o700)
    seen = set()
    actual = 0
    # This includes bounded tar headers/padding as well as declared file bytes.
    total_limit = min(request.get("maximum_total_bytes", MAX_TOTAL), MAX_TOTAL)
    with gzip.open(request["archive"], "rb") as zipped, tarfile.open(
            fileobj=BoundedExpandedReader(zipped, total_limit + MAX_MANIFEST + MAX_FILES * 2048),
            mode="r|", tarinfo=BoundedTarInfo) as archive:
        first = archive.next()
        if first is None or first.name != MANIFEST or not first.isfile() or first.size > MAX_MANIFEST:
            raise ValueError("ARCHIVE_FIRST_MANIFEST")
        raw = archive.extractfile(first).read(MAX_MANIFEST + 1)
        if hashlib.sha256(raw).hexdigest() != request["manifest_sha256"]:
            raise ValueError("ARCHIVE_MANIFEST_HASH")
        value = json.loads(raw)
        if value["checkpoint_id"] != request["checkpoint_id"] or value["kind"] != request["kind"]:
            raise ValueError("ARCHIVE_IDENTITY")
        expected = {v["file"]: v for v in manifest_valid(value)}
        for item in archive:
            if item is first:
                continue
            check_path(item.name)
            if not item.isfile() or item.name in seen or item.name not in expected or item.size != expected[item.name]["bytes"]:
                raise ValueError("ARCHIVE_MEMBER")
            seen.add(item.name)
            actual += item.size
            if actual > request.get("maximum_total_bytes", MAX_TOTAL) or len(seen) + 1 > MAX_FILES:
                raise ValueError("ARCHIVE_TOTAL")
            target = root.joinpath(*PurePosixPath(item.name).parts)
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            digest = hashlib.sha256()
            count = 0
            with archive.extractfile(item) as source, target.open("xb") as destination:
                while True:
                    chunk = source.read(1024 * 1024)
                    if not chunk:
                        break
                    count += len(chunk)
                    if count > item.size:
                        raise ValueError("ARCHIVE_MEMBER_SIZE")
                    digest.update(chunk)
                    destination.write(chunk)
            os.chmod(target, stat.S_IRUSR | stat.S_IWUSR)
            if count != item.size or digest.hexdigest() != expected[item.name]["sha256"]:
                raise ValueError("ARCHIVE_MEMBER_HASH")
        if seen != set(expected) or actual != value["total_bytes"]:
            raise ValueError("ARCHIVE_MISSING_FILES")
    (root / MANIFEST).write_bytes(raw)
    print(json.dumps({"files": len(seen), "bytes": actual}))


def unwrap(request):
    # actions/upload-artifact wraps the one ciphertext file in a ZIP. It is
    # untrusted input; no zipfile.extract or path-based extraction is used.
    import zipfile
    output = Path(request["output"])
    with zipfile.ZipFile(request["zip"]) as archive:
        items = archive.infolist()
        if len(items) != 1:
            raise ValueError("ARTIFACT_MEMBER_COUNT")
        item = items[0]
        if item.filename != request["filename"] or item.is_dir() or item.flag_bits & 1 \
                or stat.S_ISLNK(item.external_attr >> 16) or item.file_size != request["bytes"]:
            raise ValueError("ARTIFACT_MEMBER")
        digest = hashlib.sha256()
        size = 0
        with archive.open(item) as source, output.open("xb") as destination:
            while True:
                chunk = source.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > request["bytes"]:
                    raise ValueError("ARTIFACT_SIZE")
                digest.update(chunk)
                destination.write(chunk)
        if size != request["bytes"] or digest.hexdigest() != request["sha256"]:
            raise ValueError("ARTIFACT_HASH")


if __name__ == "__main__":
    try:
        request = json.load(sys.stdin)
        {"pack": pack, "unpack": unpack, "unwrap": unwrap}[sys.argv[1]](request)
    except Exception as error:
        # Do not print private paths, source rows, key material, or JSON values.
        print("TAIWAN_CHECKPOINT_ARCHIVE_" + (str(error) if isinstance(error, ValueError)
              and str(error).startswith(("ARCHIVE_", "ARTIFACT_")) else type(error).__name__), file=sys.stderr)
        raise SystemExit(2)
