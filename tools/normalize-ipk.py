#!/usr/bin/env python3
"""Normalize only generated LG TV Blocklist IPKs, before hashing/manifests.

No extraction, hooks or payload execution. Accept the installed packager's
unsigned three-member ar / gzip / USTAR subset, not general Debian packages.
All regular-file bytes are preserved; unknown paths and archive extensions
(including PAX overrides, GNU long names and sparse files) fail closed.
Archive metadata is not proof of safe installed ownership, ACLs or parent paths.
"""

import argparse
import gzip
import io
import os
from pathlib import Path
import stat
import tarfile
import tempfile
import zlib

MAX_IPK_BYTES = 64 * 1024 * 1024
MAX_CONTROL_BYTES = 1024 * 1024
MAX_DATA_BYTES = 128 * 1024 * 1024
MAX_ENTRIES = 128
AR_NAMES = ("debian-binary", "control.tar.gz", "data.tar.gz")
APP = "usr/palm/applications/io.github.furkanbayrak.lgtvblocklist"
PACKAGEINFO = "usr/palm/packages/io.github.furkanbayrak.lgtvblocklist/packageinfo.json"
ASSETS = """
appinfo.json index.html icon.png largeIcon.png css/app.css
js/bridge.js js/domainlist.js js/domains.gen.js js/main.js js/overrides.js js/status.js
vendor/webOSTV.js vendor/LICENSE-webOSTVjs.txt
filter/dnscrypt-proxy filter/LICENSE.dnscrypt-proxy.txt filter/domains.json
filter/filter-input.txt filter/filter-input-safe.txt filter/filter-input-strict.txt
filter/dnscrypt-proxy.toml.template filter/forward-rules.txt.template
scripts/apply.sh scripts/boot.sh scripts/check.sh scripts/common.sh scripts/dnsq.js
scripts/dnsq.sh scripts/guard.sh scripts/keeper.sh scripts/overrides.sh
scripts/rollback.sh scripts/tier.sh
""".split()
DATA_FILES = {f"{APP}/{p}" for p in ASSETS} | {PACKAGEINFO}
DATA_DIRS = {str(p) for f in DATA_FILES for p in Path(f).parents}
EXECUTABLES = {
    f"{APP}/{p}"
    for p in ASSETS
    if (p.startswith("scripts/") and p.endswith(".sh")) or p == "filter/dnscrypt-proxy"
}


def number(field, base=10):
    text = field.decode("ascii").strip()
    allowed = "01234567" if base == 8 else "0123456789"
    if not text or any(c not in allowed for c in text):
        raise ValueError("invalid ar numeric field")
    return int(text, base)


def read_ar(blob):
    if not blob.startswith(b"!<arch>\n"):
        raise ValueError("invalid ar magic")
    offset, members = 8, {}
    for expected in AR_NAMES:
        header = blob[offset : offset + 60]
        if len(header) != 60 or header[58:] != b"`\n":
            raise ValueError("truncated/invalid ar header")
        name = header[:16].decode("ascii").rstrip(" ").removesuffix("/")
        if name != expected:
            raise ValueError("unexpected, duplicate or out-of-order ar member")
        number(header[16:28])  # validate even metadata that will be replaced
        number(header[28:34])
        number(header[34:40])
        mode = number(header[40:48], 8)
        if mode & 0o7000 or stat.S_IFMT(mode) not in (0, stat.S_IFREG):
            raise ValueError("unsafe ar mode")
        size = number(header[48:58])
        start, end = offset + 60, offset + 60 + size
        if end > len(blob):
            raise ValueError("truncated ar member")
        members[name] = blob[start:end]
        if size % 2 and blob[end : end + 1] != b"\n":
            raise ValueError("invalid ar padding")
        offset = end + size % 2
    if offset != len(blob) or members["debian-binary"] != b"2.0\n":
        raise ValueError("unexpected ar trailer or Debian format")
    return members


def decompress(blob, limit):
    decoder = zlib.decompressobj(16 + zlib.MAX_WBITS)
    raw = decoder.decompress(blob, limit + 1)
    if len(raw) > limit or decoder.unconsumed_tail:
        raise ValueError("decompression limit exceeded")
    if not decoder.eof or decoder.unused_data:
        raise ValueError("invalid/trailing gzip stream")
    return raw


def canonical(name, directory):
    if not name or name.startswith("/") or "\\" in name:
        raise ValueError("unsafe archive path")
    if any(ord(c) < 32 or ord(c) > 126 for c in name):
        raise ValueError("non-ASCII/control archive path")
    while name.startswith("./"):
        name = name[2:]
    if directory:
        name = name.removesuffix("/")
        if name in ("", "."):
            return "."
    if any(part in ("", ".", "..") for part in name.split("/")):
        raise ValueError("noncanonical/traversal archive path")
    return name


def read_tar(raw, files, directories):
    """Read bounded USTAR records explicitly so no hidden/trailing entries pass."""
    offset, entries = 0, {}
    while True:
        block = raw[offset : offset + 512]
        if len(block) != 512:
            raise ValueError("truncated tar header/terminator")
        if block == b"\0" * 512:
            trailer = raw[offset:]
            if len(trailer) < 1024 or len(trailer) % 512 or any(trailer):
                raise ValueError("invalid tar terminator/trailer")
            break
        if len(entries) >= MAX_ENTRIES:
            raise ValueError("tar entry limit exceeded")
        if block[257:265] != b"ustar\x0000":
            raise ValueError("unsupported tar format")
        # stdlib validates header checksum/numbers; no archive is extracted.
        info = tarfile.TarInfo.frombuf(block, encoding="ascii", errors="strict")
        if info.type not in (tarfile.REGTYPE, tarfile.AREGTYPE, tarfile.DIRTYPE):
            raise ValueError("links, special files and tar extensions forbidden")
        if info.mode < 0 or info.mode & ~0o777:
            raise ValueError("set-id/special tar mode forbidden")
        if info.linkname:
            raise ValueError("unexpected tar link target")
        directory = info.type == tarfile.DIRTYPE
        name = canonical(info.name, directory)
        if name in entries:
            raise ValueError("duplicate canonical tar path")
        if name not in (directories if directory else files):
            raise ValueError(f"unexpected tar path/type: {name}")
        if info.size < 0 or (directory and info.size != 0):
            raise ValueError("invalid tar payload size")
        start = offset + 512
        end = start + info.size
        next_offset = start + ((info.size + 511) // 512) * 512
        if next_offset > len(raw) or any(raw[end:next_offset]):
            raise ValueError("truncated tar payload or invalid padding")
        entries[name] = (directory, raw[start:end])
        offset = next_offset
    if {n for n, (directory, _) in entries.items() if not directory} != files:
        raise ValueError("missing required tar payload")
    return entries


def write_tar(entries):
    result = io.BytesIO()
    with tarfile.open(fileobj=result, mode="w", format=tarfile.USTAR_FORMAT) as archive:
        for name, (directory, payload) in sorted(entries.items()):
            info = tarfile.TarInfo(name)
            info.type = tarfile.DIRTYPE if directory else tarfile.REGTYPE
            info.mode = 0o755 if directory or name in EXECUTABLES else 0o644
            info.uid = info.gid = info.mtime = 0
            info.uname = info.gname = "root"
            info.size = len(payload)
            archive.addfile(info, io.BytesIO(payload))
    # GzipFile fixes OS=255 and omits the filename as well as zeroing mtime.
    compressed = io.BytesIO()
    with gzip.GzipFile(
        fileobj=compressed, mode="wb", filename="", mtime=0, compresslevel=9
    ) as stream:
        stream.write(result.getvalue())
    return compressed.getvalue()


def write_ar(members):
    result = bytearray(b"!<arch>\n")
    for name in AR_NAMES:
        payload = members[name]
        result += (
            f"{name:<16}{0:<12}{0:<6}{0:<6}{'100644':<8}{len(payload):<10}`\n".encode(
                "ascii"
            )
        )
        result += payload
        if len(payload) % 2:
            result += b"\n"
    return bytes(result)


def normalize(path):
    """Validate fully in memory, then replace only the generated regular IPK."""
    path = Path(path)
    original = path.lstat()
    if (
        path.suffix != ".ipk"
        or not stat.S_ISREG(original.st_mode)
        or original.st_nlink != 1
    ):
        raise ValueError("expected a non-linked generated .ipk file")
    if original.st_size > MAX_IPK_BYTES:
        raise ValueError("IPK input limit exceeded")
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), "rb") as source:
        opened = os.fstat(source.fileno())
        if (opened.st_dev, opened.st_ino) != (original.st_dev, original.st_ino):
            raise ValueError("input changed before reading")
        blob = source.read(MAX_IPK_BYTES + 1)
    if len(blob) > MAX_IPK_BYTES:
        raise ValueError("IPK input limit exceeded")
    try:
        members = read_ar(blob)
        control = read_tar(
            decompress(members["control.tar.gz"], MAX_CONTROL_BYTES), {"control"}, {"."}
        )
        data = read_tar(
            decompress(members["data.tar.gz"], MAX_DATA_BYTES), DATA_FILES, DATA_DIRS
        )
    except (UnicodeError, tarfile.HeaderError, zlib.error, OverflowError) as error:
        raise ValueError(f"malformed archive: {error}") from error
    members["control.tar.gz"] = write_tar(control)
    members["data.tar.gz"] = write_tar(data)
    result = write_ar(members)
    if len(result) > MAX_IPK_BYTES:
        raise ValueError("normalized IPK output limit exceeded")
    if result == blob:
        return
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            dir=path.parent, prefix=".normalize-ipk-", delete=False
        ) as output:
            temporary = Path(output.name)
            output.write(result)
            output.flush()
            os.fchmod(output.fileno(), 0o644)
            os.fsync(output.fileno())
        current = path.lstat()
        if (
            current.st_dev,
            current.st_ino,
            current.st_size,
            current.st_mtime_ns,
            current.st_nlink,
        ) != (
            original.st_dev,
            original.st_ino,
            original.st_size,
            original.st_mtime_ns,
            1,
        ):
            raise ValueError("input changed during normalization")
        os.replace(temporary, path)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "ipk", type=Path, help="generated IPK (replaced atomically on success)"
    )
    args = parser.parse_args()
    try:
        normalize(args.ipk)
    except (ValueError, OSError) as error:
        parser.exit(1, f"refusing to normalize {args.ipk}: {error}\n")
    print(f"normalized {args.ipk}")


if __name__ == "__main__":
    main()
