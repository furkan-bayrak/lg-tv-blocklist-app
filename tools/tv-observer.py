#!/usr/bin/env python3
"""Owner-supervised LG screen capture/navigation over an existing trusted SSH link.

No daemon, pairing secret, app modification or protection helper invocation.
"""

import argparse
import base64
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import struct
import subprocess
import sys
import tempfile
import time
import zlib

APP_ID = "io.github.furkanbayrak.lgtvblocklist"
APP_DIRECTORY = "/media/developer/apps/usr/palm/applications/" + APP_ID
DIRECTION_KEYS = ("UP", "DOWN", "LEFT", "RIGHT")
ACTIVATION_KEYS = ("ENTER", "BACK")


class ObserverError(Exception):
    """An observation/action could not be verified; stop rather than retry."""


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def shell_quote(value):
    return shlex.quote(str(value))


def luna_command(uri, payload):
    # This TV exits silently on stdin EOF without a PTY. -w bounds the remote call
    # too; an SSH timeout alone does not prove that the remote process stopped.
    return "luna-send -n 1 -w 5000 " + shell_quote(uri) + " " + shell_quote(
        json.dumps(payload, separators=(",", ":"))
    )


def response_object(text):
    try:
        response = json.loads(text.strip())
    except (ValueError, TypeError) as error:
        raise ObserverError("TV returned no valid JSON response") from error
    if not isinstance(response, dict) or response.get("returnValue") is not True:
        raise ObserverError("TV refused the operation: " + json.dumps(response))
    return response


def png_dimensions(image):
    """Reject truncated/corrupted captures, not just a successful Luna reply."""
    if image[:8] != b"\x89PNG\r\n\x1a\n":
        raise ObserverError("Capture is not a PNG")
    position = 8
    dimensions = None
    has_image_data = False
    while position + 12 <= len(image):
        length = struct.unpack_from(">I", image, position)[0]
        end = position + 12 + length
        if end > len(image):
            break
        chunk_type = image[position + 4:position + 8]
        data = image[position + 8:end - 4]
        checksum = struct.unpack_from(">I", image, end - 4)[0]
        if zlib.crc32(chunk_type + data) & 0xFFFFFFFF != checksum:
            raise ObserverError("Capture PNG checksum mismatch")
        if dimensions is None:
            if chunk_type != b"IHDR" or length != 13:
                raise ObserverError("Capture has no valid PNG header")
            dimensions = struct.unpack_from(">II", data)
            if not all(0 < size <= 4096 for size in dimensions):
                raise ObserverError("Capture has invalid dimensions")
        if chunk_type == b"IDAT" and length:
            has_image_data = True
        if chunk_type == b"IEND":
            if length or end != len(image) or not has_image_data:
                break
            return dimensions
        position = end
    raise ObserverError("Capture PNG is incomplete")


class TVObserver:
    def __init__(self, host, user="root", port=22, capture_service="capture"):
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:-]*", host or ""):
            raise ObserverError("Supply a TV hostname/IP or SSH alias, not a command or URL")
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_-]*", user):
            raise ObserverError("Invalid SSH user")
        if not 1 <= port <= 65535:
            raise ObserverError("Invalid SSH port")
        if capture_service not in ("capture", "tv.capture"):
            raise ObserverError("Unsupported capture service")
        self.host = host
        self.user = user
        self.port = port
        self.capture_service = capture_service

    def execute(self, command, terminal=True):
        arguments = [
            "ssh", "-tt" if terminal else "-T",
            "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
            "-o", "ConnectTimeout=6", "-o", "ConnectionAttempts=1",
            "-o", "ServerAliveInterval=5", "-o", "ServerAliveCountMax=1",
            "-o", "LogLevel=ERROR", "-p", str(self.port),
            self.user + "@" + self.host, command,
        ]
        try:
            result = subprocess.run(
                arguments, stdin=subprocess.DEVNULL, capture_output=True,
                timeout=15, check=False,
            )
        except subprocess.TimeoutExpired as error:
            raise ObserverError("SSH timed out; no automatic retry or power cycle") from error
        except OSError as error:
            raise ObserverError("Cannot run SSH: " + str(error)) from error
        if result.returncode:
            raise ObserverError(
                "TV command failed (exit " + str(result.returncode) + "): "
                + result.stderr.decode("utf-8", errors="replace").strip()
            )
        return result.stdout.decode("utf-8").replace("\r\n", "\n")

    def call(self, uri, payload):
        return response_object(self.execute(luna_command(uri, payload)))

    def foreground(self):
        response = self.call("luna://com.webos.applicationManager/getForegroundAppInfo", {})
        if not isinstance(response.get("appId"), str) or not response["appId"]:
            raise ObserverError("Cannot identify the foreground app")
        return response["appId"]

    def installed_app(self):
        try:
            metadata = json.loads(self.execute(
                "cat " + shell_quote(APP_DIRECTORY + "/appinfo.json"), terminal=False
            ))
        except ValueError as error:
            raise ObserverError("Installed app metadata is unreadable") from error
        if not isinstance(metadata, dict) or metadata.get("id") != APP_ID:
            raise ObserverError("Installed app identity does not match")
        return metadata

    def capture(self, directory, label):
        foreground_before = self.foreground()
        remote_payload = {
            "path": "PLACEHOLDER", "method": "DISPLAY", "format": "PNG",
            "width": 1920, "height": 1080,
        }
        # Only the fresh private directory is interpolated remotely. Do not accept
        # a device path from the caller or copy any scripts onto the TV.
        payload = shell_quote(json.dumps(remote_payload, separators=(",", ":")))
        command = (
            "set -eu; umask 077; "
            "capture_dir=$(mktemp -d /tmp/lgtv-observer.XXXXXX); "
            "trap 'rm -f \"$capture_dir/screen.png\"; rmdir \"$capture_dir\"' EXIT; "
            "payload=" + payload + "; "
            "payload=$(printf '%s' \"$payload\" | sed \"s|PLACEHOLDER|$capture_dir/screen.png|\"); "
            "luna-send -n 1 -w 5000 "
            + shell_quote("luna://com.webos.service." + self.capture_service + "/executeOneShot")
            + " \"$payload\"; "
            "test -s \"$capture_dir/screen.png\"; "
            "printf '\\n@@PNG-BEGIN@@\\n'; base64 \"$capture_dir/screen.png\"; "
            "printf '\\n@@PNG-END@@\\n'"
        )
        started = utc_now()
        output = self.execute(command)
        try:
            reply, encoded = output.split("@@PNG-BEGIN@@\n", 1)
            encoded, remainder = encoded.split("@@PNG-END@@", 1)
            if remainder.strip():
                raise ValueError("Unexpected capture trailer")
            capture_reply = response_object(reply)
            image = base64.b64decode("".join(encoded.split()), validate=True)
        except ValueError as error:
            raise ObserverError("Capture did not return a complete image") from error
        width, height = png_dimensions(image)
        if (width, height) != (1920, 1080):
            raise ObserverError("Capture dimensions differ from the requested 1920x1080")
        foreground_after = self.foreground()
        image_path = directory / (label + ".png")
        image_path.write_bytes(image)
        observation = {
            "started_at": started, "finished_at": utc_now(),
            "foreground_before": foreground_before, "foreground_after": foreground_after,
            "foreground_stable": foreground_before == foreground_after,
            "image": image_path.name, "sha256": hashlib.sha256(image).hexdigest(),
            "width": width, "height": height, "capture_reply": capture_reply,
            "acceptance": "UNVERIFIED: inspect the image; capture success is not an app test pass",
        }
        (directory / (label + ".json")).write_text(json.dumps(observation, indent=2) + "\n")
        return observation

    def press(self, key, allow_activation=False):
        if key not in DIRECTION_KEYS + ACTIVATION_KEYS:
            raise ObserverError("Unsupported remote key")
        if key in ACTIVATION_KEYS and not allow_activation:
            raise ObserverError("ENTER/BACK require --allow-activation and separate action authorization")
        if self.foreground() != APP_ID:
            raise ObserverError("Refusing remote input: LG TV Blocklist is not in the foreground")
        # One controller only: a foreground check cannot exclude another person's
        # key press or a system overlay appearing immediately after the check.
        return self.call("luna://com.webos.service.networkinput/sendSpecialKey", {"key": key})

    def launch(self):
        return self.call("luna://com.webos.service.applicationManager/launch", {"id": APP_ID})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default=os.environ.get("LGTV_HOST"), help="TV IP/SSH alias, or LGTV_HOST")
    parser.add_argument("--user", default="root")
    parser.add_argument("--port", type=int, default=22)
    parser.add_argument("--capture-service", choices=("capture", "tv.capture"), default="capture")
    commands = parser.add_subparsers(dest="action", required=True)
    commands.add_parser("capture", help="Observe the current screen without input")
    commands.add_parser("launch", help="Launch only LG TV Blocklist, then observe")
    key_parser = commands.add_parser("key", help="One guarded remote key, with before/after captures")
    key_parser.add_argument("key", choices=DIRECTION_KEYS + ACTIVATION_KEYS)
    key_parser.add_argument("--allow-activation", action="store_true")
    commands.add_parser("smoke", help="Four direction keys with captures; no ENTER or app acceptance claim")
    arguments = parser.parse_args()
    os.umask(0o077)
    directory = None
    record = {"started_at": utc_now(), "action": arguments.action, "device_acceptance": "UNVERIFIED"}
    try:
        observer = TVObserver(arguments.host, arguments.user, arguments.port, arguments.capture_service)
        state_root = Path(os.environ.get("XDG_STATE_HOME", str(Path.home() / ".local/state")))
        evidence_root = state_root / "lg-tv-blocklist-tv"
        evidence_root.mkdir(mode=0o700, parents=True, exist_ok=True)
        directory = Path(tempfile.mkdtemp(prefix="observation-", dir=evidence_root))
        record.update({"host": arguments.host, "user": arguments.user, "port": arguments.port})
        record["installed_app"] = observer.installed_app()
        record["observations"] = []
        if arguments.action == "launch":
            record["launch_reply"] = observer.launch()
            time.sleep(1)
        record["observations"].append(observer.capture(directory, "00-before"))
        keys = DIRECTION_KEYS if arguments.action == "smoke" else (
            (arguments.key,) if arguments.action == "key" else ()
        )
        record["keys"] = []
        for index, key in enumerate(keys, 1):
            reply = observer.press(key, getattr(arguments, "allow_activation", False))
            record["keys"].append({"key": key, "reply": reply, "at": utc_now()})
            time.sleep(0.4)
            record["observations"].append(observer.capture(directory, f"{index:02d}-{key.lower()}"))
            if record["observations"][-1]["foreground_after"] != APP_ID:
                raise ObserverError("Foreground changed after input; stopping")
        record["transport_result"] = "completed; visual/behavioral acceptance is not inferred"
        return_code = 0
    except (ObserverError, OSError, UnicodeError) as error:
        record["error"] = str(error)
        print("tv-observer: " + str(error), file=sys.stderr)
        return_code = 1
    except KeyboardInterrupt:
        record["error"] = "Interrupted by operator; no automatic recovery action"
        return_code = 130
    finally:
        if directory is not None:
            record["finished_at"] = utc_now()
            (directory / "session.json").write_text(json.dumps(record, indent=2) + "\n")
            print(directory)
    return return_code


if __name__ == "__main__":
    sys.exit(main())
