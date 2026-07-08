#!/usr/bin/env bash
# ─── Swarm Stash setup ────────────────────────────────────────────────────────
# Gets the game running from a bare checkout on any distro:
#   1. finds or installs Node ≥ 22.18 — tries the system package manager first,
#      falls back to the official Node binary tarball in ./.node (no root)
#   2. installs npm dependencies through Corepack/pnpm
#   3. writes .env with a fresh SESSION_SECRET (+ optional Discord OAuth creds)
#   4. starts the server — or installs a systemd user service with --service
#
# Usage:  ./setup.sh [--start] [--service] [--no-install]
#   --start       start the server when setup finishes (no prompt)
#   --service     install + enable a systemd *user* service instead
#   --no-install  never install anything; fail if Node ≥ 22.18 is missing
# On NixOS you don't need this script: use `nix run` (see README).

set -euo pipefail
cd "$(dirname "$0")"

MIN_MAJOR=22
MIN_MINOR=18
NODE=""
NODE_DIR=""

c()    { printf '\033[%sm%s\033[0m\n' "$1" "$2"; }
say()  { c '1;35' "🐝 $*"; }
ok()   { c '1;32' "  ✓ $*"; }
warn() { c '1;33' "  ⚠ $*"; }
die()  { c '1;31' "  ✖ $*" >&2; exit 1; }

DO_START=0 DO_SERVICE=0 NO_INSTALL=0
for arg in "$@"; do
  case "$arg" in
    --start)      DO_START=1 ;;
    --service)    DO_SERVICE=1 ;;
    --no-install) NO_INSTALL=1 ;;
    -h|--help)    sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)            die "unknown option: $arg (see --help)" ;;
  esac
done

fetch() { # fetch <url> — curl or wget, whichever exists
  if command -v curl >/dev/null 2>&1; then curl -fsSL "$1"
  elif command -v wget >/dev/null 2>&1; then wget -qO- "$1"
  else die "need curl or wget to download — install one and re-run"
  fi
}

version_ok() {
  local v major minor
  v="$("$1" --version 2>/dev/null)" || return 1
  v="${v#v}"
  major="${v%%.*}"
  minor="$(printf '%s' "$v" | cut -d. -f2)"
  [ "$major" -gt "$MIN_MAJOR" ] 2>/dev/null ||
    { [ "$major" -eq "$MIN_MAJOR" ] && [ "$minor" -ge "$MIN_MINOR" ]; } 2>/dev/null
}

find_node() {
  local cand
  for cand in "$PWD/.node/bin/node" node; do
    if command -v "$cand" >/dev/null 2>&1 && version_ok "$cand"; then
      NODE="$(command -v "$cand")"
      return 0
    fi
  done
  return 1
}

try_package_manager() {
  if command -v apt-get >/dev/null 2>&1; then
    say "Debian/Ubuntu detected — installing Node 22 via NodeSource (needs sudo)…"
    fetch https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs
  elif command -v dnf >/dev/null 2>&1; then
    say "Fedora/RHEL detected — installing Node 22 via dnf (needs sudo)…"
    sudo dnf install -y nodejs22 || sudo dnf install -y nodejs
  elif command -v pacman >/dev/null 2>&1; then
    say "Arch detected — installing Node via pacman (needs sudo)…"
    sudo pacman -S --needed --noconfirm nodejs
  elif command -v zypper >/dev/null 2>&1; then
    say "openSUSE detected — installing Node 22 via zypper (needs sudo)…"
    sudo zypper install -y nodejs22 || sudo zypper install -y nodejs
  elif command -v apk >/dev/null 2>&1; then
    say "Alpine detected — installing Node via apk (needs sudo)…"
    sudo apk add nodejs
  elif command -v brew >/dev/null 2>&1; then
    say "Homebrew detected — installing Node 22…"
    brew install node@22 2>/dev/null || brew install node
  else
    return 1
  fi
}

install_tarball() {
  local os arch file
  case "$(uname -s)" in
    Linux)  os=linux ;;
    Darwin) os=darwin ;;
    *) die "unsupported OS: $(uname -s) — install Node ≥ ${MIN_MAJOR}.${MIN_MINOR} manually" ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64)  arch=x64 ;;
    aarch64|arm64) arch=arm64 ;;
    armv7l)        arch=armv7l ;;
    *) die "unsupported CPU: $(uname -m) — install Node ≥ ${MIN_MAJOR}.${MIN_MINOR} manually" ;;
  esac
  if [ "$os" = linux ] && ldd --version 2>&1 | grep -qi musl; then
    die "musl libc detected — official Node tarballs need glibc; use your package manager (apk add nodejs)"
  fi
  say "Downloading the official Node 22 build into ./.node (no root needed)…"
  file="$(fetch "https://nodejs.org/dist/latest-v22.x/" | grep -o "node-v22[0-9.]*-$os-$arch\.tar\.gz" | head -1)"
  [ -n "$file" ] || die "could not find a Node 22 build for $os-$arch on nodejs.org"
  rm -rf .node .node.tmp
  mkdir -p .node.tmp
  fetch "https://nodejs.org/dist/latest-v22.x/$file" | tar -xz -C .node.tmp --strip-components=1
  mv .node.tmp .node
  ok "installed $file → ./.node"
}

# ── 1. Node ───────────────────────────────────────────────────────────────────
say "Swarm Stash setup"
if find_node; then
  ok "found Node $("$NODE" --version) at $NODE"
else
  [ "$NO_INSTALL" = 1 ] && die "Node ≥ ${MIN_MAJOR}.${MIN_MINOR} not found (--no-install given)"
  command -v node >/dev/null 2>&1 &&
    warn "found Node $(node --version), but ≥ v${MIN_MAJOR}.${MIN_MINOR} is required (node:sqlite + native TypeScript)"
  try_package_manager || install_tarball
  find_node || install_tarball
  find_node || die "still no usable Node — install Node ≥ ${MIN_MAJOR}.${MIN_MINOR} manually and re-run"
  ok "using Node $("$NODE" --version) at $NODE"
fi
NODE_DIR="$(dirname "$NODE")"

# ── 2. dependencies ───────────────────────────────────────────────────────────
say "Installing dependencies…"
"$NODE_DIR/corepack" pnpm install
ok "dependencies installed"

# ── 3. .env ───────────────────────────────────────────────────────────────────
if [ -f .env ]; then
  ok ".env already exists — leaving it untouched"
else
  say "Creating .env…"
  cp .env.example .env
  "$NODE" -e '
    const fs = require("fs");
    const secret = require("crypto").randomBytes(32).toString("hex");
    fs.writeFileSync(".env", fs.readFileSync(".env", "utf8")
      .replace(/^SESSION_SECRET=.*$/m, "SESSION_SECRET=" + secret));
  '
  ok "generated SESSION_SECRET"
  if [ -t 0 ]; then
    printf '  Discord OAuth client ID (leave empty to use the dev login): '
    read -r cid
    if [ -n "$cid" ]; then
      printf '  Discord OAuth client secret: '
      read -r csec
      CID="$cid" CSEC="$csec" "$NODE" -e '
        const fs = require("fs");
        fs.writeFileSync(".env", fs.readFileSync(".env", "utf8")
          .replace(/^DISCORD_CLIENT_ID=.*$/m,     "DISCORD_CLIENT_ID=" + process.env.CID)
          .replace(/^DISCORD_CLIENT_SECRET=.*$/m, "DISCORD_CLIENT_SECRET=" + process.env.CSEC));
      '
      ok "Discord OAuth configured — add <BASE_URL>/auth/discord/callback as a redirect in the Discord app"
    else
      ok "no Discord app — the pick-a-name dev login stays enabled"
    fi
  else
    ok "non-interactive shell — edit .env later to add Discord OAuth"
  fi
fi

# ── 4. run it ─────────────────────────────────────────────────────────────────
if [ "$DO_SERVICE" = 1 ]; then
  command -v systemctl >/dev/null 2>&1 || die "--service requires systemd"
  mkdir -p "$HOME/.config/systemd/user"
  cat > "$HOME/.config/systemd/user/swarm-stash.service" <<EOF
[Unit]
Description=Swarm Stash — Neuro-sama meme TCG
After=network.target

[Service]
WorkingDirectory=$PWD
ExecStart=$NODE_DIR/corepack pnpm start
Restart=on-failure

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now swarm-stash
  ok "systemd user service installed and started (journalctl --user -u swarm-stash -f)"
  warn "to keep it running after you log out: sudo loginctl enable-linger $USER"
  exit 0
fi

say "Setup complete."
echo "  start the server with:  $NODE_DIR/corepack pnpm start"
echo "  then open:              http://localhost:3000"
if [ "$DO_START" = 1 ]; then
  exec "$NODE_DIR/corepack" pnpm start
elif [ -t 0 ]; then
  printf '  Start it now? [Y/n] '
  read -r yn
  case "$yn" in
    [nN]*) ;;
    *) exec "$NODE_DIR/corepack" pnpm start ;;
  esac
fi
