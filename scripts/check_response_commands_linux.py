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
mkdir -p /etc/profile.d /root /etc/systemd/system/fixture.target.wants
printf '%s\n' '# PROFILE_D_FIXTURE' 'touch /tmp/profile-executed' > /etc/profile.d/response-fixture.sh
printf '%s\n' '# ENVIRONMENT_FIXTURE' > /etc/environment
printf '%s\n' '# BASH_PROFILE_FIXTURE' > /root/.bash_profile
printf '%s\n' '# synthetic unit, never executed' > /etc/systemd/system/response-fixture.service
ln -s /etc/systemd/system/response-fixture.service /etc/systemd/system/fixture.target.wants/response-fixture.service
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
# Extra coverage is synthetic: the image is not booted with systemd as PID 1.
/bin/sh /commands/linux-startup-scripts.sh > /tmp/startup-output
for marker in PROFILE_D_FIXTURE ENVIRONMENT_FIXTURE BASH_PROFILE_FIXTURE; do
  if ! grep -q "$marker" /tmp/startup-output; then
    printf 'FAIL: missing startup configuration %s\n' "$marker"
    FAILED=1
  fi
done
if [ -e /tmp/profile-executed ]; then
  printf '%s\n' 'FAIL: startup configuration was executed instead of read'
  FAILED=1
fi
/bin/sh /commands/linux-system-cron.sh > /tmp/cron-output
if grep -q '未发现这些常见 cron' /tmp/cron-output; then
  printf '%s\n' 'FAIL: missing-cron warning appeared despite existing configuration'
  FAILED=1
fi
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
# Force cp to fail, without changing the source or touching host data.
/bin/mkdir -p /tmp/failing-bin /tmp/optional-bin
/bin/cat > /tmp/failing-bin/cp <<'MOCK_CP'
#!/bin/sh
printf '%s\n' 'synthetic cp failure' >&2
exit 1
MOCK_CP
/bin/chmod +x /tmp/failing-bin/cp
PATH="/tmp/failing-bin:$PATH" /bin/sh /commands/copy-failure.sh > /tmp/copy-output 2> /tmp/copy-error || true
if ! grep -q '复制失败' /tmp/copy-output || grep -q '日志已复制到' /tmp/copy-output; then
  printf '%s\n' 'FAIL: copy failure lacked an explicit result'
  FAILED=1
fi
# Optional systemctl and lastb are interface substitutes, not real service/log acceptance.
/bin/cat > /tmp/optional-bin/systemctl <<'MOCK_SYSTEMCTL'
#!/bin/sh
printf '%s\n' "$*" >> /tmp/systemctl-calls
if [ "${MOCK_SYSTEMCTL_FAIL:-0}" -eq 1 ]; then
  printf '%s\n' 'synthetic systemctl failure' >&2
  exit 1
fi
case "$1" in
  list-unit-files) printf '%s\n' 'SYSTEMD_ENABLED_FIXTURE' ;;
  list-timers) printf '%s\n' 'SYSTEMD_TIMER_FIXTURE' ;;
  *) exit 2 ;;
esac
MOCK_SYSTEMCTL
/bin/cat > /tmp/optional-bin/lastb <<'MOCK_LASTB'
#!/bin/sh
printf '%s\n' 'LASTB_FIXTURE'
MOCK_LASTB
/bin/chmod +x /tmp/optional-bin/systemctl /tmp/optional-bin/lastb
# An available binary alone must not trigger systemd queries.
PATH="/tmp/optional-bin:$PATH" /bin/sh /commands/linux-startup-services.sh > /tmp/service-output
if [ -f /tmp/systemctl-calls ] || ! grep -q 'fixture.target.wants' /tmp/service-output; then
  printf '%s\n' 'FAIL: systemd guard or nested enablement directory listing failed'
  FAILED=1
fi
/bin/mkdir -p /run/systemd/system
PATH="/tmp/optional-bin:$PATH" /bin/sh /commands/linux-startup-services.sh > /tmp/service-output
if ! grep -q '^list-unit-files --type=service --state=enabled --no-pager$' /tmp/systemctl-calls ||
   ! grep -q '^list-timers --all --no-pager$' /tmp/systemctl-calls ||
   ! grep -q SYSTEMD_ENABLED_FIXTURE /tmp/service-output ||
   ! grep -q SYSTEMD_TIMER_FIXTURE /tmp/service-output; then
  printf '%s\n' 'FAIL: optional systemd query coverage was lost'
  FAILED=1
fi
MOCK_SYSTEMCTL_FAIL=1 PATH="/tmp/optional-bin:$PATH" /bin/sh /commands/linux-startup-services.sh > /tmp/service-output 2> /tmp/service-error
if ! grep -q '查询失败' /tmp/service-output || [ ! -s /tmp/service-error ]; then
  printf '%s\n' 'FAIL: optional systemd failure was hidden'
  FAILED=1
fi
# No btmp: skip lastb even when a decoder is available.
/bin/rm -f /var/log/btmp
PATH="/tmp/optional-bin:$PATH" /bin/sh /commands/linux-login-failure.sh > /tmp/auth-output
if grep -q LASTB_FIXTURE /tmp/auth-output; then
  printf '%s\n' 'FAIL: lastb was called without a readable btmp'
  FAILED=1
fi
# Text logs absent: still consult an available lastb for readable btmp.
/bin/rm /var/log/auth.log /var/log/messages
: > /var/log/btmp
PATH="/tmp/optional-bin:$PATH" /bin/sh /commands/linux-login-failure.sh > /tmp/auth-output
if ! grep -q LASTB_FIXTURE /tmp/auth-output; then
  printf '%s\n' 'FAIL: optional lastb evidence path was lost'
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


def replace_assignment(script, name, value):
    """Fail closed when snippet edits invalidate a test's parameter override."""
    changed, count = re.subn(
        rf"^{re.escape(name)}=.*$", lambda _: f"{name}={value}", script, flags=re.M,
    )
    if count != 1:
        raise ValueError(f"Expected exactly one {name} assignment, found {count}")
    return changed


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
        write("copy-existing.sh", replace_assignment(copy, "EVIDENCE_DIR", "/tmp/evidence-existing"))
        write("copy-failure.sh", replace_assignment(copy, "EVIDENCE_DIR", "/tmp/copy-failed"))
        copy_missing = replace_assignment(copy, "SOURCE_LOG", "/tmp/missing-source")
        copy_missing = replace_assignment(copy_missing, "EVIDENCE_DIR", "/tmp/missing-copy-output")
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
