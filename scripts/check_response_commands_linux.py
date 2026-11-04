#!/usr/bin/env python3
"""Exercise the shipped Linux snippets in disposable, offline containers.

Requires Node.js with --experimental-strip-types, Docker, and pre-pulled official
busybox:1.37 / debian:bookworm-slim images. No host evidence or config is mounted.
"""
import json
from pathlib import Path
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
HARNESS = r'''#!/bin/sh
set -eu
# All fixtures and command writes are confined to this disposable container.
mkdir -p /var/log /var/spool/cron/crontabs /etc/cron.d /etc/periodic/daily /tmp/evidence-existing
printf '%s\n' 'Nov 4 10:00:00 host sshd[42]: Failed password for root from 192.0.2.10' > /var/log/auth.log
printf '%s\n' 'Nov 4 10:00:01 host sshd[42]: Accepted password for root from 192.0.2.10' >> /var/log/auth.log
printf '%s\n' 'synthetic system event' > /var/log/messages
printf '%s\n' '# synthetic, never executed' > /var/spool/cron/crontabs/root
printf '%s\n' '# synthetic system cron' > /etc/crontab
printf '%s\n' '# synthetic startup script' > /etc/rc.local
: > /var/log/wtmp
printf '%s\n' 'KEEP EXISTING EVIDENCE' > /tmp/evidence-existing/auth.log
if [ "$MODE" = minimal ]; then
  mkdir -p /minimal-bin
  for tool in awk cat cp date find grep head id ls mkdir sed tail tr uname; do
    ln -s /bin/busybox "/minimal-bin/$tool"
  done
  # Also exercise a ps implementation without extended formatting options.
  printf '%s\n' '#!/bin/sh' '[ "$#" -eq 0 ] || exit 2' 'exec /bin/busybox ps' > /minimal-bin/ps
  chmod +x /minimal-bin/ps
  export PATH=/minimal-bin
fi
cd /tmp
FAILED=0
COUNT=0
for script in /commands/linux-*.sh; do
  COUNT=$((COUNT + 1))
  if ! /bin/sh -n "$script"; then FAILED=1; continue; fi
  if /bin/sh "$script" > /tmp/command-output 2> /tmp/command-error; then
    if [ -s /tmp/command-error ] || [ ! -s /tmp/command-output ]; then
      printf 'FAIL (stderr or empty output): %s\n' "$script"
      cat /tmp/command-error
      FAILED=1
    else
      printf 'PASS: %s\n' "${script##*/}"
    fi
  else
    printf 'FAIL (exit status): %s\n' "$script"
    cat /tmp/command-error
    FAILED=1
  fi
done
# Verify copying cannot replace an already existing evidence directory/file.
/bin/sh /commands/copy-existing.sh > /tmp/copy-output 2> /tmp/copy-error || true
if ! grep -q 'KEEP EXISTING EVIDENCE' /tmp/evidence-existing/auth.log; then
  printf '%s\n' 'FAIL: existing evidence was overwritten'
  FAILED=1
fi
# Missing evidence must be reported and must not create an output directory.
/bin/sh /commands/copy-missing.sh > /tmp/copy-output 2> /tmp/copy-error || true
if [ -d /tmp/missing-copy-output ] || ! grep -q 'SOURCE_LOG' /tmp/copy-output; then
  printf '%s\n' 'FAIL: missing source was not handled correctly'
  FAILED=1
fi
# last must not try to open a missing wtmp file, even when the tool exists.
/bin/rm /var/log/wtmp
if ! /bin/sh /commands/linux-login-success.sh > /tmp/login-output 2> /tmp/login-error; then
  FAILED=1
fi
if [ -s /tmp/login-error ] || ! grep -q 'wtmp' /tmp/login-output; then
  printf '%s\n' 'FAIL: missing wtmp was not reported cleanly'
  FAILED=1
fi
if [ "$COUNT" -ne 24 ]; then FAILED=1; fi
printf 'Checked %s Linux commands (%s).\n' "$COUNT" "$MODE"
exit "$FAILED"
'''


def main():
    module = ROOT / "crates/analyzer-gui/frontend/src/lib/commands.ts"
    javascript = (
        f"import {{ responseCommands }} from {json.dumps(module.as_uri())};"
        'console.log(JSON.stringify(responseCommands.filter(c => c.platform === "linux")));'
    )
    commands = json.loads(subprocess.check_output(
        ["node", "--experimental-strip-types", "--input-type=module", "-e", javascript],
        cwd=ROOT, text=True, encoding="utf-8",
    ))
    # Docker Desktop shares /private/tmp on macOS. Other hosts use their default temp directory.
    temp_root = "/private/tmp" if Path("/private/tmp").is_dir() else None
    with tempfile.TemporaryDirectory(prefix="easy-analyzer-commands-", dir=temp_root) as work:
        directory = Path(work)

        def write(name, text):
            (directory / name).write_text(text, encoding="utf-8", newline="\n")

        for command in commands:
            write(f'{command["id"]}.sh', command["command"] + "\n")
        copy = next(c["command"] for c in commands if c["id"] == "linux-copy-logs")
        write("copy-existing.sh", re.sub(
            r"^EVIDENCE_DIR=.*$", "EVIDENCE_DIR=/tmp/evidence-existing", copy, flags=re.M,
        ))
        copy_missing = re.sub(
            r"^SOURCE_LOG=.*$", "SOURCE_LOG=/tmp/missing-source", copy, flags=re.M,
        )
        copy_missing = re.sub(
            r"^EVIDENCE_DIR=.*$", "EVIDENCE_DIR=/tmp/missing-copy-output", copy_missing, flags=re.M,
        )
        write("copy-missing.sh", copy_missing)
        write("check.sh", HARNESS)
        environments = [
            ("busybox:1.37", "full"),
            ("busybox:1.37", "minimal"),
            ("debian:bookworm-slim", "full"),
        ]
        for image, mode in environments:
            print(f"Checking {image}, mode={mode}", flush=True)
            subprocess.run([
                "docker", "run", "--rm", "--pull=never", "--network=none",
                "--cap-drop=ALL", "--security-opt=no-new-privileges", "--memory=128m",
                "--cpus=1", "-v", f"{directory}:/commands:ro", "-e", f"MODE={mode}",
                image, "/bin/sh", "/commands/check.sh",
            ], check=True, timeout=90)


if __name__ == "__main__":
    main()
