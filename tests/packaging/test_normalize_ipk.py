"""Synthetic IPKs only: never execute payloads or touch a release candidate."""

import gzip
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import textwrap
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
TOOL = ROOT / "tools/normalize-ipk.py"
APP = "usr/palm/applications/io.github.furkanbayrak.lgtvblocklist"
PKG = "usr/palm/packages/io.github.furkanbayrak.lgtvblocklist/packageinfo.json"
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
FILES = {f"{APP}/{p}": f"synthetic payload: {p}\n".encode() for p in ASSETS}
FILES[PKG] = b'{"id":"io.github.furkanbayrak.lgtvblocklist","version":"0.4.2"}\n'
FILES[f"{APP}/appinfo.json"] = FILES[PKG]
FILES[f"{APP}/scripts/common.sh"] = b'# synthetic only\nchmod +x "$FILTER_BIN"\n'
DIRS = sorted({str(p) for f in FILES for p in Path(f).parents if str(p) != "."})
EXECUTABLES = {
    f"{APP}/{p}"
    for p in ASSETS
    if (p.startswith("scripts/") and p.endswith(".sh")) or p == "filter/dnscrypt-proxy"
}


def entry(name, payload=b"", kind=tarfile.REGTYPE, mode=None, seed=1):
    info = tarfile.TarInfo(name)
    info.type = kind
    info.mode = (
        mode if mode is not None else (0o777 if kind == tarfile.DIRTYPE else 0o666)
    )
    info.uid, info.gid = 1000 + seed, 2000 + seed
    info.uname, info.gname = "builder", "staff"
    info.mtime = 1700000000 + seed
    info.size = len(payload)
    if kind in (tarfile.SYMTYPE, tarfile.LNKTYPE):
        info.linkname = "/etc/passwd"
    return info, payload


def tar_bytes(entries):
    result = io.BytesIO()
    with tarfile.open(fileobj=result, mode="w", format=tarfile.USTAR_FORMAT) as archive:
        for info, payload in entries:
            archive.addfile(info, io.BytesIO(payload))
    return result.getvalue()


def ar_bytes(members, seed=1):
    result = bytearray(b"!<arch>\n")
    for name, payload in members:
        result += (
            f"{name:<16}{1700000000 + seed:<12}{1000 + seed:<6}"
            f"{2000 + seed:<6}{'100666':<8}{len(payload):<10}`\n"
        ).encode("ascii")
        result += payload
        if len(payload) % 2:
            result += b"\n"
    return bytes(result)


def fixture(data=None, control=None, seed=1, reverse=False):
    if data is None:
        data = [entry(d + "/", kind=tarfile.DIRTYPE, seed=seed) for d in DIRS]
        data += [entry(p, b, seed=seed) for p, b in FILES.items()]
    if control is None:
        control = [
            entry("./control", b"Package: io.github.furkanbayrak.lgtvblocklist\n")
        ]
    if reverse:
        data = list(reversed(data))
    return ar_bytes(
        [
            ("debian-binary", b"2.0\n"),
            ("control.tar.gz", gzip.compress(tar_bytes(control), mtime=seed)),
            ("data.tar.gz", gzip.compress(tar_bytes(data), mtime=seed)),
        ],
        seed=seed,
    )


def read_ar(blob):
    """Independent output reader, including computed ar metadata."""
    assert blob[:8] == b"!<arch>\n"
    pos, result = 8, {}
    while pos < len(blob):
        header = blob[pos : pos + 60]
        assert len(header) == 60 and header[58:] == b"`\n"
        name = header[:16].decode().strip().removesuffix("/")
        size = int(header[48:58])
        result[name] = (
            tuple(
                int(header[a:b], base)
                for a, b, base in [
                    (16, 28, 10),
                    (28, 34, 10),
                    (34, 40, 10),
                    (40, 48, 8),
                ]
            ),
            blob[pos + 60 : pos + 60 + size],
        )
        pos += 60 + size + size % 2
    assert pos == len(blob)
    return result


class NormalizeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location("normalize_ipk", TOOL)
        cls.tool = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.tool)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="lg-normalize-test-")
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "synthetic.ipk"

    def normalize(self, blob):
        self.path.write_bytes(blob)
        self.tool.normalize(self.path)
        return self.path.read_bytes()

    def reject(self, blob, pattern=None):
        self.path.write_bytes(blob)
        before = self.path.stat()
        with self.assertRaises(ValueError) as raised:
            self.tool.normalize(self.path)
        if pattern:
            self.assertRegex(str(raised.exception), pattern)
        self.assertEqual(self.path.read_bytes(), blob)
        self.assertEqual(self.path.stat().st_ino, before.st_ino)
        self.assertEqual(self.path.stat().st_mtime_ns, before.st_mtime_ns)
        self.assertEqual(list(Path(self.temp.name).iterdir()), [self.path])

    def test_metadata_payload_hashes_and_layout(self):
        result = self.normalize(fixture())
        members = read_ar(result)
        self.assertEqual(
            list(members), ["debian-binary", "control.tar.gz", "data.tar.gz"]
        )
        self.assertEqual(members["debian-binary"][1], b"2.0\n")
        for meta, payload in members.values():
            self.assertEqual(meta, (0, 0, 0, 0o100644))
        for name, expected in [
            (
                "control.tar.gz",
                {"control": b"Package: io.github.furkanbayrak.lgtvblocklist\n"},
            ),
            ("data.tar.gz", FILES),
        ]:
            compressed = members[name][1]
            self.assertEqual(compressed[4:8], b"\0" * 4)
            self.assertEqual(compressed[3], 0)  # no filename/extra/comment
            found, directories = {}, set()
            with tarfile.open(fileobj=io.BytesIO(compressed), mode="r:gz") as archive:
                for member in archive:
                    self.assertEqual(
                        (
                            member.uid,
                            member.gid,
                            member.uname,
                            member.gname,
                            member.mtime,
                        ),
                        (0, 0, "root", "root", 0),
                    )
                    self.assertIn(member.type, (tarfile.REGTYPE, tarfile.DIRTYPE))
                    mode = (
                        0o755 if member.isdir() or member.name in EXECUTABLES else 0o644
                    )
                    self.assertEqual(member.mode, mode, member.name)
                    if member.isdir():
                        directories.add(member.name)
                    if member.isfile():
                        found[member.name] = hashlib.sha256(
                            archive.extractfile(member).read()
                        ).hexdigest()
            self.assertEqual(directories, set(DIRS) if name == "data.tar.gz" else set())
            self.assertEqual(
                found, {p: hashlib.sha256(b).hexdigest() for p, b in expected.items()}
            )
        self.assertEqual(self.path.stat().st_mode & 0o7777, 0o644)

    def test_deterministic_and_idempotent(self):
        first = self.normalize(fixture(seed=1))
        second = self.normalize(fixture(seed=50, reverse=True))
        self.assertEqual(first, second)
        inode = self.path.stat().st_ino
        self.tool.normalize(self.path)
        self.assertEqual(self.path.read_bytes(), first)
        self.assertEqual(self.path.stat().st_ino, inode)

    def test_canonical_duplicate_paths(self):
        for names in [("control", "./control"), ("./control", "././control")]:
            with self.subTest(names=names):
                self.reject(fixture(control=[entry(p) for p in names]), "duplicate")
        self.reject(
            fixture(
                data=[
                    entry(p, kind=tarfile.DIRTYPE)
                    for p in (APP + "/", "./" + APP + "/")
                ]
            ),
            "duplicate",
        )
        self.reject(
            fixture(
                data=[entry(APP + "/index.html"), entry("./" + APP + "/index.html")]
            ),
            "duplicate",
        )

    def test_reject_paths_and_unexpected_files(self):
        for name in [
            "/control",
            "../control",
            "./../control",
            "a/../../control",
            "a//control",
            "a/./control",
            "control/",
            "control\\evil",
            "control\n",
            "postinst",
            "preinst",
            "prerm",
            "postrm",
        ]:
            with self.subTest(name=name):
                self.reject(fixture(control=[entry(name)]))
        for name in [
            "etc/passwd",
            APP + "/.env",
            APP + "/scripts/unknown.sh",
            PKG + "/extra",
            "usr/palm/services/evil/run",
        ]:
            with self.subTest(name=name):
                self.reject(fixture(data=[entry(name)]))

    def test_reject_links_special_files_extensions_and_setid(self):
        for kind in [
            tarfile.SYMTYPE,
            tarfile.LNKTYPE,
            tarfile.FIFOTYPE,
            tarfile.CHRTYPE,
            tarfile.BLKTYPE,
            tarfile.CONTTYPE,
            tarfile.XHDTYPE,
            tarfile.XGLTYPE,
            tarfile.GNUTYPE_LONGNAME,
            tarfile.GNUTYPE_SPARSE,
        ]:
            with self.subTest(kind=kind):
                self.reject(fixture(control=[entry("control", kind=kind)]))
        for mode in [0o4666, 0o2666, 0o1666]:
            with self.subTest(mode=mode):
                self.reject(fixture(control=[entry("control", mode=mode)]))

    def test_reject_missing_and_malformed_ar(self):
        good = fixture()
        members = [(n, p) for n, (_, p) in read_ar(good).items()]
        for bad in [
            b"",
            b"not ar",
            good[:-1],
            good + b"extra",
            ar_bytes(members[1:]),
            ar_bytes(members + [members[1]]),
            ar_bytes(members[::-1]),
            ar_bytes([("debian-binary", b"3.0\n")] + members[1:]),
            ar_bytes(members + [("postinst", b"evil")]),
            ar_bytes([("/", b"names")] + members),
            good[:56] + b"x" + good[57:],
        ]:
            with self.subTest(size=len(bad)):
                self.reject(bad)

    def test_reject_corrupt_gzip_tar_and_missing_payload(self):
        control = gzip.compress(tar_bytes([entry("control", b"x")]), mtime=0)
        data = read_ar(fixture())["data.tar.gz"][1]
        raw = tar_bytes([entry("control", b"x")])
        corrupt_header = bytearray(raw)
        corrupt_header[0] ^= 1
        missing_end = raw[:1024]
        bad_tars = [
            bytes(corrupt_header),
            missing_end,
            raw + b"nonzero trailer",
            raw[:512] + b"x",
            b"\0" * 10240,
        ]
        for bad in [b"not gzip", control[:-3], control + b"junk", control + control] + [
            gzip.compress(b) for b in bad_tars
        ]:
            with self.subTest(size=len(bad)):
                self.reject(
                    ar_bytes(
                        [
                            ("debian-binary", b"2.0\n"),
                            ("control.tar.gz", bad),
                            ("data.tar.gz", data),
                        ]
                    )
                )
        self.reject(fixture(data=[]))

    def test_bounds_before_replacement(self):
        for setting, limit in [
            ("MAX_IPK_BYTES", 100),
            ("MAX_CONTROL_BYTES", 100),
            ("MAX_DATA_BYTES", 100),
            ("MAX_ENTRIES", 2),
        ]:
            with (
                self.subTest(setting=setting),
                mock.patch.object(self.tool, setting, limit),
            ):
                self.reject(fixture(), "limit")
        with mock.patch.object(self.tool, "MAX_CONTROL_BYTES", 1024):
            self.reject(fixture(control=[entry("control", b"A" * 100000)]), "limit")

    def test_atomic_failure_does_not_change_input(self):
        blob = fixture()
        self.path.write_bytes(blob)
        with mock.patch.object(
            self.tool.os, "replace", side_effect=OSError("synthetic failure")
        ):
            with self.assertRaises(OSError):
                self.tool.normalize(self.path)
        self.assertEqual(self.path.read_bytes(), blob)
        self.assertEqual(list(Path(self.temp.name).iterdir()), [self.path])

    def test_symlink_and_hardlink_rejected(self):
        target = Path(self.temp.name) / "target.ipk"
        target.write_bytes(fixture())
        self.path.symlink_to(target)
        with self.assertRaises(ValueError):
            self.tool.normalize(self.path)
        self.assertTrue(self.path.is_symlink())
        self.path.unlink()
        os.link(target, self.path)
        with self.assertRaises(ValueError):
            self.tool.normalize(self.path)
        self.assertEqual(target.read_bytes(), fixture())

    def test_npm_and_description_integration(self):
        package = json.loads((ROOT / "package.json").read_text())
        appinfo = json.loads((ROOT / "app/appinfo.json").read_text())
        self.assertEqual((package["version"], appinfo["version"]), ("0.4.2", "0.4.2"))
        self.assertEqual(appinfo["id"], "io.github.furkanbayrak.lgtvblocklist")
        self.assertEqual(package["description"], appinfo["appDescription"])
        for phrase in (
            "Experimental",
            "DNS blocking",
            "SAFE/STRICT",
            "rooted",
            "Homebrew Channel",
        ):
            self.assertIn(phrase, appinfo["appDescription"])
        scripts = package["scripts"]
        self.assertIn("npm run test:packaging", scripts["test"])
        self.assertIn("python3 -B", scripts["test:packaging"])
        self.assertIn("ares-package", scripts["package"].split("&&")[0])
        self.assertIn("tools/normalize-ipk.py", scripts["package"].split("&&")[1])

    def test_ci_assertions_with_synthetic_payloads(self):
        workflow = (ROOT / ".github/workflows/build.yml").read_text()
        self.assertLess(
            workflow.index("run: npm run package"),
            workflow.index("Assert normalized IPK"),
        )
        self.assertLess(
            workflow.index("Assert normalized IPK"),
            workflow.index("webosbrew-gen-manifest "),
        )
        body = workflow.split("python3 -B - <<'PY'\n", 1)[1].split("          PY\n", 1)[
            0
        ]
        body = textwrap.dedent(body)
        compile(body, "CI-content-check", "exec")
        base = Path(self.temp.name)
        for path, payload in FILES.items():
            if not path.startswith(APP + "/"):
                continue
            dest = base / "app" / path.removeprefix(APP + "/")
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(payload)
        (base / "tools").mkdir()
        pin = hashlib.sha256(FILES[APP + "/filter/dnscrypt-proxy"]).hexdigest()
        (base / "tools/fetch-filter.mjs").write_text(f"const BIN_SHA256 = '{pin}';\n")
        (base / "dist").mkdir()
        ipk = base / "dist/synthetic.ipk"
        ipk.write_bytes(self.normalize(fixture()))
        command = [sys.executable, "-B", "-c", body]
        passed = subprocess.run(command, cwd=base, capture_output=True, text=True)
        self.assertEqual(passed.returncode, 0, passed.stderr)
        self.assertIn("all payload hashes unchanged", passed.stdout)
        # The CI gate must detect changed bytes even in an otherwise normalized IPK.
        (base / "app/index.html").write_bytes(b"changed source")
        failed = subprocess.run(command, cwd=base, capture_output=True, text=True)
        self.assertNotEqual(failed.returncode, 0)
        self.assertIn(APP + "/index.html", failed.stderr)
        # Restore matching source so payload rejection cannot mask missing metadata checks.
        (base / "app/index.html").write_bytes(FILES[APP + "/index.html"])
        self.assertEqual(
            (base / "app/index.html").read_bytes(), FILES[APP + "/index.html"]
        )
        # Keep the control path canonical: only metadata should cause rejection.
        ipk.write_bytes(
            fixture(
                control=[
                    entry("control", b"Package: io.github.furkanbayrak.lgtvblocklist\n")
                ]
            )
        )
        failed = subprocess.run(command, cwd=base, capture_output=True, text=True)
        self.assertNotEqual(failed.returncode, 0)
        self.assertIn("AssertionError", failed.stderr)

    def test_cli_success_and_rejection(self):
        self.path.write_bytes(fixture())
        command = [sys.executable, "-B", str(TOOL), str(self.path)]
        passed = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(passed.returncode, 0, passed.stderr)
        self.assertIn("normalized", passed.stdout)
        self.path.write_bytes(b"unsafe")
        failed = subprocess.run(command, capture_output=True, text=True)
        self.assertNotEqual(failed.returncode, 0)
        self.assertIn("refusing", failed.stderr)
        self.assertEqual(self.path.read_bytes(), b"unsafe")


if __name__ == "__main__":
    unittest.main()
