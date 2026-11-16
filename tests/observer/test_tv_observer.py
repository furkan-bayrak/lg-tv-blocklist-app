"""Host-only checks. Never connect to a TV from this suite."""

import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import zlib

SPEC = importlib.util.spec_from_file_location(
    "tv_observer", Path(__file__).resolve().parents[2] / "tools/tv-observer.py"
)
observer_module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(observer_module)


def png_image():
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    return b"\x89PNG\r\n\x1a\n" + chunk(
        b"IHDR", struct.pack(">IIBBBBB", 1920, 1080, 8, 0, 0, 0, 0)
    ) + chunk(b"IDAT", zlib.compress((b"\0" * 1921) * 1080)) + chunk(b"IEND", b"")


def capture_output(image, return_value=True):
    return json.dumps({"returnValue": return_value}) + "\n@@PNG-BEGIN@@\n" + base64.b64encode(
        image
    ).decode() + "\n@@PNG-END@@\n"


class ObserverTests(unittest.TestCase):
    def setUp(self):
        self.observer = observer_module.TVObserver("tv.example")

    def test_foreign_foreground_never_receives_input(self):
        with patch.object(self.observer, "foreground", return_value="com.webos.app.browser"), patch.object(
            self.observer, "call"
        ) as send:
            with self.assertRaisesRegex(observer_module.ObserverError, "not in the foreground"):
                self.observer.press("RIGHT")
            send.assert_not_called()

    def test_activation_requires_explicit_opt_in_before_any_tv_call(self):
        with patch.object(self.observer, "foreground") as foreground:
            for key in ("ENTER", "BACK"):
                with self.assertRaisesRegex(observer_module.ObserverError, "allow-activation"):
                    self.observer.press(key)
            foreground.assert_not_called()

    def test_power_and_arbitrary_input_are_not_supported(self):
        with patch.object(self.observer, "foreground") as foreground:
            for key in ("POWER", "HOME", "RIGHT; reboot"):
                with self.assertRaisesRegex(observer_module.ObserverError, "Unsupported"):
                    self.observer.press(key, allow_activation=True)
            foreground.assert_not_called()

    def test_timeout_stops_without_retry(self):
        with patch.object(observer_module.subprocess, "run", side_effect=subprocess.TimeoutExpired("ssh", 15)) as run:
            with self.assertRaisesRegex(observer_module.ObserverError, "no automatic retry"):
                self.observer.foreground()
            self.assertEqual(run.call_count, 1)

    def test_capture_saves_verifiable_bytes_and_does_not_claim_acceptance(self):
        image = png_image()
        with tempfile.TemporaryDirectory() as directory, patch.object(
            self.observer, "foreground", return_value=observer_module.APP_ID
        ), patch.object(self.observer, "execute", return_value=capture_output(image)):
            result = self.observer.capture(Path(directory), "screen")
            self.assertEqual((Path(directory) / "screen.png").read_bytes(), image)
            self.assertEqual(result["sha256"], hashlib.sha256(image).hexdigest())
            self.assertTrue(result["foreground_stable"])
            self.assertTrue(result["acceptance"].startswith("UNVERIFIED"))

    def test_negative_reply_is_not_a_successful_capture(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(
            self.observer, "foreground", return_value=observer_module.APP_ID
        ), patch.object(self.observer, "execute", return_value=capture_output(png_image(), False)):
            with self.assertRaisesRegex(observer_module.ObserverError, "refused"):
                self.observer.capture(Path(directory), "screen")
            self.assertFalse((Path(directory) / "screen.png").exists())

    def test_missing_or_corrupt_image_cannot_be_reported_as_a_capture(self):
        image = bytearray(png_image())
        image[50] ^= 1
        for payload in (b"", b"not a png", png_image()[:-12], bytes(image)):
            with self.subTest(payload_size=len(payload)), tempfile.TemporaryDirectory() as directory, patch.object(
                self.observer, "foreground", return_value=observer_module.APP_ID
            ), patch.object(self.observer, "execute", return_value=capture_output(payload)):
                with self.assertRaises(observer_module.ObserverError):
                    self.observer.capture(Path(directory), "screen")
                self.assertFalse((Path(directory) / "screen.png").exists())

    def test_foreground_change_is_preserved_not_attributed_to_app(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(
            self.observer, "foreground", side_effect=[observer_module.APP_ID, "com.webos.app.browser"]
        ), patch.object(self.observer, "execute", return_value=capture_output(png_image())):
            result = self.observer.capture(Path(directory), "screen")
            self.assertFalse(result["foreground_stable"])
            self.assertEqual(result["foreground_after"], "com.webos.app.browser")

    def test_ssh_option_injection_is_rejected(self):
        for host in ("-oProxyCommand=reboot", "tv;reboot", "root@tv", "ssh://tv"):
            with self.subTest(host=host), self.assertRaises(observer_module.ObserverError):
                observer_module.TVObserver(host)

    def test_empty_or_nonboolean_luna_success_is_not_accepted(self):
        for response in ("", "[]", '{"returnValue":"true"}', '{"returnValue":1}'):
            with self.subTest(response=response), self.assertRaises(observer_module.ObserverError):
                observer_module.response_object(response)


if __name__ == "__main__":
    unittest.main()
