#!/usr/bin/env bash
# Mindstrate MCP Server — one-liner installer for Linux/macOS
#
# Quick install (with env vars):
#   curl -fsSL http://<nginx>/mindstrate/install.sh \
#     | TEAM_SERVER_URL=http://10.103.231.74:3388 \
#       TEAM_API_KEY=...your-key... \
#       TOOL=opencode \
#       bash
#
# Interactive install:
#   curl -fsSL http://<nginx>/mindstrate/install.sh -o install.sh
#   bash install.sh   # will prompt for missing values
#
# Re-running upgrades the bundle in place. Safe.

set -u

# ----- defaults (override via env) -----
INSTALL_DIR="${INSTALL_DIR:-$HOME/.mindstrate-mcp}"
NGINX_BASE="${NGINX_BASE:-http://CHANGE_ME/mindstrate}"   # >>>>> EDIT before publishing <<<<<
TEAM_SERVER_URL="${TEAM_SERVER_URL:-}"
TEAM_API_KEY="${TEAM_API_KEY:-}"
TOOL="${TOOL:-}"   # opencode | cursor | claude-desktop | all | none
NODE_MIN_MAJOR=18

if [ -t 1 ]; then
  C_GREEN='\033[32m'; C_YELLOW='\033[33m'; C_RED='\033[31m'; C_BOLD='\033[1m'; C_RESET='\033[0m'
else
  C_GREEN=''; C_YELLOW=''; C_RED=''; C_BOLD=''; C_RESET=''
fi
say()  { printf "${C_GREEN}==>${C_RESET} %s\n" "$*"; }
warn() { printf "${C_YELLOW}!! ${C_RESET} %s\n" "$*"; }
die()  { printf "${C_RED}xx ${C_RESET} %s\n" "$*" >&2; exit 1; }

say "Source: $NGINX_BASE"

# ----- 1. node check -----
command -v node >/dev/null 2>&1 || die "Node.js is required. Install >= ${NODE_MIN_MAJOR} from https://nodejs.org/"
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
[ "$NODE_MAJOR" -ge "$NODE_MIN_MAJOR" ] || die "Node.js >= ${NODE_MIN_MAJOR} required, got $(node -v)"
say "Node.js: $(node -v) ✓"

# ----- 2. download manifest + bundle -----
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
curl -fsSL "$NGINX_BASE/manifest.json" -o "$TMP/manifest.json" \
  || die "Cannot fetch $NGINX_BASE/manifest.json"

VERSION=$(node -e "console.log(require('$TMP/manifest.json').version)")
BUNDLE=$(node -e "console.log(require('$TMP/manifest.json').bundle)")
EXPECTED_SHA=$(node -e "console.log(require('$TMP/manifest.json').sha256)")

say "Installing version $VERSION"
curl -fsSL "$NGINX_BASE/$BUNDLE" -o "$TMP/$BUNDLE" \
  || die "Cannot download $NGINX_BASE/$BUNDLE"

# Integrity check.
case "$EXPECTED_SHA" in
  '(sha256'*) warn "manifest.sha256 unavailable — skipping integrity check" ;;
  '') warn "manifest has no sha256 — skipping" ;;
  *)
    if command -v sha256sum >/dev/null; then
      ACTUAL=$(sha256sum "$TMP/$BUNDLE" | awk '{print $1}')
    elif command -v shasum >/dev/null; then
      ACTUAL=$(shasum -a 256 "$TMP/$BUNDLE" | awk '{print $1}')
    else
      ACTUAL=""; warn "no sha256sum/shasum — skipping integrity check"
    fi
    if [ -n "$ACTUAL" ] && [ "$ACTUAL" != "$EXPECTED_SHA" ]; then
      die "SHA256 mismatch! expected $EXPECTED_SHA, got $ACTUAL"
    fi
    ;;
esac

# ----- 3. install -----
say "Installing into $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
# Clean up legacy v0.1 layout (packages/, node_modules/, package-lock.json)
# but preserve the user's .env if they wrote one.
find "$INSTALL_DIR" -mindepth 1 -maxdepth 1 \
  ! -name '.env' \
  -exec rm -rf {} +
cp "$TMP/$BUNDLE" "$INSTALL_DIR/mindstrate-mcp.js"
chmod +x "$INSTALL_DIR/mindstrate-mcp.js" 2>/dev/null || true
ENTRY="$INSTALL_DIR/mindstrate-mcp.js"

# ----- 4. interactive prompts -----
prompt() {
  local __var="$1"; local __q="$2"; local __default="${3:-}"
  local __cur="${!__var:-}"
  if [ -z "$__cur" ]; then
    if [ -t 0 ]; then
      printf "%s%s%s%s: " "$C_BOLD" "$__q" "$C_RESET" \
        "$([ -n "$__default" ] && echo " [$__default]")"
      read -r __cur < /dev/tty || true
      [ -z "$__cur" ] && __cur="$__default"
    else
      __cur="$__default"
    fi
    eval "$__var=\"\$__cur\""
  fi
}
prompt TEAM_SERVER_URL "Team Server URL (e.g. http://10.103.231.74:3388)"
prompt TEAM_API_KEY    "Team Server API Key"
prompt TOOL            "Wire up which AI tool? [opencode|cursor|claude-desktop|all|none]" "opencode"

[ -n "$TEAM_SERVER_URL" ] || die "TEAM_SERVER_URL is required"
[ -n "$TEAM_API_KEY" ]    || die "TEAM_API_KEY is required"

# ----- 5. write MCP config(s) -----
NODE_BIN=$(command -v node)

merge_or_write() {
  local file="$1"; local jq_filter="$2"; local fresh="$3"
  if [ -f "$file" ] && command -v jq >/dev/null 2>&1; then
    local tmp; tmp=$(mktemp)
    jq "$jq_filter" "$file" > "$tmp" && mv "$tmp" "$file"
    say "Merged into $file"
  else
    [ -f "$file" ] && warn "$file exists but jq missing — overwriting"
    mkdir -p "$(dirname "$file")"
    printf '%s\n' "$fresh" > "$file"
    say "Wrote $file"
  fi
}

case "$TOOL" in
  opencode|all)
    OC_PATH="${OPENCODE_CONFIG:-$HOME/.config/opencode/config.json}"
    OC_ENTRY=$(cat <<EOF
{
  "type": "local",
  "command": ["$NODE_BIN", "$ENTRY"],
  "environment": {
    "TEAM_SERVER_URL": "$TEAM_SERVER_URL",
    "TEAM_API_KEY":    "$TEAM_API_KEY"
  }
}
EOF
)
    FRESH=$(cat <<EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "mcp": { "mindstrate": $OC_ENTRY }
}
EOF
)
    merge_or_write "$OC_PATH" '.mcp["mindstrate"] = '"$OC_ENTRY" "$FRESH"
    ;;
esac

case "$TOOL" in
  cursor|all)
    CUR_PATH="${CURSOR_CONFIG:-$HOME/.cursor/mcp.json}"
    CUR_ENTRY=$(cat <<EOF
{
  "command": "$NODE_BIN",
  "args": ["$ENTRY"],
  "env": {
    "TEAM_SERVER_URL": "$TEAM_SERVER_URL",
    "TEAM_API_KEY":    "$TEAM_API_KEY"
  }
}
EOF
)
    FRESH=$(cat <<EOF
{ "mcpServers": { "mindstrate": $CUR_ENTRY } }
EOF
)
    merge_or_write "$CUR_PATH" '.mcpServers["mindstrate"] = '"$CUR_ENTRY" "$FRESH"
    ;;
esac

case "$TOOL" in
  claude-desktop|all)
    if [ "$(uname)" = "Darwin" ]; then
      CD_PATH="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
    else
      CD_PATH="${CLAUDE_DESKTOP_CONFIG:-$HOME/.config/Claude/claude_desktop_config.json}"
    fi
    CD_ENTRY=$(cat <<EOF
{
  "command": "$NODE_BIN",
  "args": ["$ENTRY"],
  "env": {
    "TEAM_SERVER_URL": "$TEAM_SERVER_URL",
    "TEAM_API_KEY":    "$TEAM_API_KEY"
  }
}
EOF
)
    FRESH=$(cat <<EOF
{ "mcpServers": { "mindstrate": $CD_ENTRY } }
EOF
)
    merge_or_write "$CD_PATH" '.mcpServers["mindstrate"] = '"$CD_ENTRY" "$FRESH"
    ;;
esac

case "$TOOL" in
  none|"") say "Skipped MCP config (TOOL=none). You can re-run anytime." ;;
esac

# ----- 6. smoke test -----
say "Smoke test (3s)..."
( TEAM_SERVER_URL="$TEAM_SERVER_URL" TEAM_API_KEY="$TEAM_API_KEY" \
  timeout 3 node "$ENTRY" </dev/null 2>"$TMP/stderr" || true )
if grep -q "Team Server is not reachable" "$TMP/stderr"; then
  warn "Bundle started, but cannot reach Team Server. Check URL and network."
elif grep -q "MCP Server started" "$TMP/stderr"; then
  say "MCP Server started OK."
fi

# ----- 7. done -----
echo
printf "${C_GREEN}${C_BOLD}Done.${C_RESET}\n"
echo "  Installed:   $INSTALL_DIR/mindstrate-mcp.js  (version $VERSION)"
echo "  Team Server: $TEAM_SERVER_URL"
echo
echo "Restart your AI tool (OpenCode / Cursor / Claude Desktop) to load the new MCP config."
echo "To upgrade later, just re-run this installer."
echo "To uninstall: rm -rf \"$INSTALL_DIR\" and remove the 'mindstrate' entry from your tool's MCP config."
