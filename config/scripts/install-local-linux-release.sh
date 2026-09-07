#!/usr/bin/env bash
# Local AppImage install for this host. Never download. Never run from Orca.
set -euo pipefail

DEST=/opt/orca/orca-linux.AppImage
VER_DEST=/opt/orca/VERSION
BACKUP_DIR=/opt/orca/backups
LOCK=/opt/orca/install.lock
HEALTH_DEADLINE_SEC=30
PORT=6768

usage() {
  cat <<'EOF'
Install a local Linux AppImage into /opt/orca (local artifact only; no download).

Usage:
  install-local-linux-release.sh --artifact PATH --version VER --sha256 HEX --preflight
  install-local-linux-release.sh --artifact PATH --version VER --sha256 HEX --dry-run
  install-local-linux-release.sh --artifact PATH --version VER --sha256 HEX --apply --confirm=INSTALL

Required:
  --artifact PATH   Existing AppImage on this machine
  --version VER     Marker like v1.4.197 or v1.4.197-kukapu.1
  --sha256 HEX      SHA-256 of that artifact (64 hex chars):
                    sha256sum /path/to/orca-linux.AppImage

Modes:
  --help       This text (no mutation)
  --preflight  Verify artifact/hash/ELF/version and print the plan (no mutation)
  --dry-run    Same as preflight plus backup/lock/swap/restart/health commands
  --apply      Mutate /opt/orca. Requires Linux, root, --confirm=INSTALL, and
               an executor outside orca-server.service and outside the Orca env.

Apply refuses even under sudo when /proc/self/cgroup (or $PPID) contains
orca-server.service, or when ORCA_PANE_KEY, ORCA_OPENCODE_CONFIG_DIR, or
ORCA_TERMINAL_HANDLE is set. There is no override flag.

Apply serializes on /opt/orca/install.lock, stages unique files, re-hashes the
staged binary before mv, and restores both binary and VERSION from verified
backups if the swap cannot finish. Restart happens only after both files match.
Health is a deadline poll of is-active and port 6768, not a fixed sleep.

Rollback of sqlite/orchestration state is not performed. Take a separate state
backup if the release migrates databases.

Template (fill HEX after the new artifact exists; do not reuse an old hash):
  sudo bash config/scripts/install-local-linux-release.sh \
    --artifact /path/to/orca-linux.AppImage \
    --version vX.Y.Z-kukapu.N \
    --sha256 HEX \
    --apply --confirm=INSTALL
EOF
}

die() {
  printf '%s\n' "$1" >&2
  exit 1
}

ARTIFACT=
VERSION=
SHA256=
MODE=
CONFIRM=

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h | --help)
      usage
      exit 0
      ;;
    --artifact)
      ARTIFACT=${2:-}
      [[ -n "$ARTIFACT" ]] || die "Missing --artifact PATH."
      shift 2
      ;;
    --version)
      VERSION=${2:-}
      [[ -n "$VERSION" ]] || die "Missing --version VER."
      shift 2
      ;;
    --sha256)
      SHA256=${2:-}
      [[ -n "$SHA256" ]] || die "Missing --sha256 HEX."
      shift 2
      ;;
    --preflight | --dry-run | --apply)
      [[ -z "$MODE" ]] || die "Choose one of --preflight, --dry-run, --apply."
      MODE=${1#--}
      shift
      ;;
    --confirm=INSTALL)
      CONFIRM=INSTALL
      shift
      ;;
    --confirm)
      die "Confirmation must be exactly --confirm=INSTALL."
      ;;
    --force | --yes | -f | --i-know | --bypass*)
      die "No override flags. Run from a shell outside Orca."
      ;;
    *)
      die "Unknown argument: $1"
      ;;
  esac
done

[[ -n "$MODE" ]] || die "Missing mode: --preflight, --dry-run, or --apply."
[[ -n "$ARTIFACT" ]] || die "Missing --artifact PATH."
[[ -n "$VERSION" ]] || die "Missing --version VER."
[[ -n "$SHA256" ]] || die "Missing --sha256 HEX."
SHA256=${SHA256,,}
[[ "$SHA256" =~ ^[0-9a-f]{64}$ ]] || die "SHA-256 must be 64 hex characters."
[[ "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9][A-Za-z0-9.-]{0,40})?$ ]] \
  || die "VERSION must look like v1.2.3 or v1.2.3-kukapu.N."
[[ "$(uname -s)" == Linux ]] || die "Linux only."

in_orca_cgroup() {
  local file pid
  for pid in "$$" "${PPID:-}"; do
    [[ -n "$pid" ]] || continue
    file=/proc/$pid/cgroup
    [[ -r "$file" ]] || continue
    grep -F -q 'orca-server.service' "$file" && return 0
  done
  return 1
}

in_orca_env() {
  [[ -n "${ORCA_PANE_KEY:-}" || -n "${ORCA_OPENCODE_CONFIG_DIR:-}" || -n "${ORCA_TERMINAL_HANDLE:-}" ]]
}

file_sha256() {
  local got
  got=$(sha256sum -- "$1")
  printf '%s' "${got%% *}"
}

verify_hash() {
  local got
  got=$(file_sha256 "$1")
  [[ "$got" == "$2" ]] || die "SHA-256 mismatch for $1. Refusing to touch dest."
}

verify_artifact() {
  [[ -f "$ARTIFACT" ]] || die "Artifact not found: $ARTIFACT"
  command -v sha256sum >/dev/null || die "sha256sum is required."
  verify_hash "$ARTIFACT" "$SHA256"
  command -v file >/dev/null || die "file(1) is required."
  LC_ALL=C file "$ARTIFACT" | grep -q 'ELF 64-bit LSB\( pie\)\? executable' \
    || die "Artifact is not an ELF 64-bit LSB executable."
}

print_plan() {
  cat <<EOF
plan:
  artifact=$ARTIFACT
  version=$VERSION
  dest=$DEST
  version_file=$VER_DEST
  lock=$LOCK
  backups=$BACKUP_DIR/<binary-and-VERSION>.<UTC>
  stage=unique .stage.<stamp>.<pid> on the dest filesystem, re-hashed before mv
  swap=both files, restore both backups if either mv fails, restart only after
  services=orca-xvfb.service orca-server.service (unchanged units)
  health=is-active + :$PORT within ${HEALTH_DEADLINE_SEC}s
  cgroup_blocked=$(in_orca_cgroup && echo yes || echo no)
  orca_env_blocked=$(in_orca_env && echo yes || echo no)
EOF
}

wait_healthy() {
  local deadline=$((SECONDS + HEALTH_DEADLINE_SEC))
  while ((SECONDS < deadline)); do
    if systemctl is-active --quiet orca-xvfb.service \
      && systemctl is-active --quiet orca-server.service \
      && ss -ltn | grep -qE ":${PORT}\b"; then
      echo "health: active :$PORT"
      return 0
    fi
    sleep 0.2
  done
  die "health: deadline ${HEALTH_DEADLINE_SEC}s exceeded (is-active / :$PORT)."
}

unique_stamp() {
  local stamp
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  while [[ -e "$BACKUP_DIR/orca-linux.AppImage.$stamp" || -e "$BACKUP_DIR/VERSION.$stamp" ]]; do
    stamp=$(date -u +%Y%m%dT%H%M%S%NZ)
  done
  printf '%s' "$stamp"
}

restore_pair() {
  local backup_bin=$1 backup_ver=$2 had_bin=$3 had_ver=$4
  local bin_ok=0 ver_ok=0
  if [[ "$had_bin" == 1 ]]; then
    cp -a "$backup_bin" "$DEST" && bin_ok=1
  else
    rm -f "$DEST" && bin_ok=1
  fi
  if [[ "$had_ver" == 1 ]]; then
    cp -a "$backup_ver" "$VER_DEST" && ver_ok=1
  else
    rm -f "$VER_DEST" && ver_ok=1
  fi
  if [[ "$bin_ok" != 1 || "$ver_ok" != 1 ]]; then
    die "Restore incomplete (binary_ok=$bin_ok version_ok=$ver_ok). Inspect $backup_bin $backup_ver."
  fi
}

apply_install() {
  [[ "$CONFIRM" == INSTALL ]] || die "Apply requires --confirm=INSTALL."
  [[ $(id -u) -eq 0 ]] || die "Run as root from a shell outside Orca: sudo bash $0 ..."
  in_orca_cgroup && die "Refusing apply inside cgroup orca-server.service (restart would kill this session)."
  in_orca_env && die "Refusing apply inside the Orca environment. Use a login shell outside Orca."
  verify_artifact
  command -v install >/dev/null || die "install(1) is required."
  command -v flock >/dev/null || die "flock is required."
  command -v systemctl >/dev/null || die "systemctl is required."
  command -v ss >/dev/null || die "ss is required."
  local dest_dir stamp backup_bin backup_ver dest_dev stage_bin stage_ver
  local had_bin=0 had_ver=0
  dest_dir=$(dirname "$DEST")
  [[ -d "$dest_dir" ]] || die "Missing $dest_dir"
  dest_dev=$(stat -c %d "$dest_dir")
  exec 9>"$LOCK"
  flock -n 9 || die "Another installer holds $LOCK."
  install -d -m 755 "$BACKUP_DIR"
  stamp=$(unique_stamp)
  backup_bin="$BACKUP_DIR/orca-linux.AppImage.$stamp"
  backup_ver="$BACKUP_DIR/VERSION.$stamp"
  stage_bin="$dest_dir/orca-linux.AppImage.stage.$stamp.$$"
  stage_ver="$dest_dir/VERSION.stage.$stamp.$$"
  rm -f "$stage_bin" "$stage_ver"
  if [[ -f "$DEST" ]]; then
    had_bin=1
    cp -a "$DEST" "$backup_bin"
    [[ "$(file_sha256 "$backup_bin")" == "$(file_sha256 "$DEST")" ]] \
      || die "Binary backup failed verification."
    echo "backup_binary=$backup_bin"
  fi
  if [[ -f "$VER_DEST" ]]; then
    had_ver=1
    cp -a "$VER_DEST" "$backup_ver"
    [[ "$(cat "$backup_ver")" == "$(cat "$VER_DEST")" ]] \
      || die "VERSION backup failed verification."
    echo "backup_version=$backup_ver"
  fi
  install -o root -g root -m 755 "$ARTIFACT" "$stage_bin"
  printf '%s' "$VERSION" >"$stage_ver"
  chown root:root "$stage_ver"
  chmod 644 "$stage_ver"
  [[ "$(stat -c %d "$stage_bin")" == "$dest_dev" && "$(stat -c %d "$stage_ver")" == "$dest_dev" ]] \
    || {
      rm -f "$stage_bin" "$stage_ver"
      die "Staged files are not on the dest filesystem."
    }
  verify_hash "$stage_bin" "$SHA256"
  [[ "$(cat "$stage_ver")" == "$VERSION" ]] || {
    rm -f "$stage_bin" "$stage_ver"
    die "Staged VERSION does not match --version."
  }
  if ! mv -f "$stage_bin" "$DEST"; then
    rm -f "$stage_bin" "$stage_ver"
    die "Binary swap failed; dest unchanged."
  fi
  if ! mv -f "$stage_ver" "$VER_DEST"; then
    restore_pair "$backup_bin" "$backup_ver" "$had_bin" "$had_ver"
    rm -f "$stage_ver"
    die "VERSION swap failed; binary and VERSION restored from backups."
  fi
  [[ "$(file_sha256 "$DEST")" == "$SHA256" ]] || {
    restore_pair "$backup_bin" "$backup_ver" "$had_bin" "$had_ver"
    die "Installed binary hash mismatch; pair restored from backups."
  }
  [[ "$(cat "$VER_DEST")" == "$VERSION" ]] || {
    restore_pair "$backup_bin" "$backup_ver" "$had_bin" "$had_ver"
    die "Installed VERSION mismatch; pair restored from backups."
  }
  echo "VERSION=$(cat "$VER_DEST")"
  systemctl reset-failed orca-xvfb.service orca-server.service || true
  systemctl restart orca-xvfb.service orca-server.service
  wait_healthy
}

verify_artifact
print_plan
case "$MODE" in
  preflight | dry-run)
    echo "mode=$MODE (no mutation)"
    ;;
  apply)
    apply_install
    ;;
esac
