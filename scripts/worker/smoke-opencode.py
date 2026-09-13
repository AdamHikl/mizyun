#!/usr/bin/env python3
"""Exercise real OpenCode streaming tool calls in a disposable directory."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import uuid


def main():
    root = Path(__file__).resolve().parents[2]
    config = json.loads((root / "opencode.json").read_text())
    config["permission"] = {"*": "deny", "read": "allow", "edit": "allow"}
    config["agent"] = {
        "smoke": {
            "mode": "primary",
            "prompt": "Follow the test task exactly. Use read and write tools only.",
            "steps": 5,
        }
    }
    expected = "LOCAL-" + uuid.uuid4().hex
    with tempfile.TemporaryDirectory(prefix="mizyun-opencode-") as directory:
        work = Path(directory)
        (work / "opencode.json").write_text(json.dumps(config))
        (work / "input.txt").write_text(f"Test value: {expected}\n")
        started = time.monotonic()
        result = subprocess.run(
            [
                "opencode", "run", "--pure", "--dir", directory,
                "--agent", "smoke", "--format", "json",
                "Read input.txt using a tool. Write output.txt containing only "
                "the test value from that file. Read output.txt to verify it. "
                "Then reply DONE.",
            ],
            capture_output=True, text=True,
            timeout=int(os.environ.get("OPENCODE_SMOKE_TIMEOUT", "300")),
        )
        events = [json.loads(line) for line in result.stdout.splitlines() if line.strip()]
        completed = [
            e["part"] for e in events
            if e.get("type") == "tool_use"
            and e.get("part", {}).get("state", {}).get("status") == "completed"
        ]
        names = [part["tool"] for part in completed]
        output = work / "output.txt"
        passed = (
            result.returncode == 0
            and not any(e.get("type") == "error" for e in events)
            and names.count("read") >= 2
            and "write" in names
            and output.exists()
            and output.read_text().strip() == expected
        )
        if not passed:
            print(result.stderr)
            print(result.stdout)
            raise SystemExit("FAIL: expected completed read/write/read tools and exact file value")
        print(f"PASS: OpenCode read/write/read, exact output, {time.monotonic() - started:.1f}s")


if __name__ == "__main__":
    main()
