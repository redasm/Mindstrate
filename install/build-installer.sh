#!/usr/bin/env bash
# Build a self-contained installer bundle for the Mindstrate MCP Server.
#
# Output: install/dist/  —— upload to your internal Nginx and team members
# can install with one curl command.
#
# After the v0.2 architecture refactor, the MCP server is a single
# self-contained JS bundle (~1.2 MB). No more tarball, no node_modules,
# no native modules, no symlinks. Just one file.

set -euo pipefail

cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./packages/mcp-server/package.json').version")
OUT_DIR="install/dist"

echo "==> Building bundle (esbuild)"
( cd packages/mcp-server && npm run build )

echo "==> Preparing distribution"
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

cp packages/mcp-server/bundle/mindstrate-mcp.js "$OUT_DIR/mindstrate-mcp.js"
cp install/install.sh  "$OUT_DIR/install.sh"
cp install/install.ps1 "$OUT_DIR/install.ps1"

# Normalize line endings — build may run on Windows (Git Bash) where the
# repo has CRLF; team members on Linux/macOS otherwise see `$'\r': command
# not found` the moment they `bash install.sh`.
if command -v dos2unix >/dev/null 2>&1; then
  dos2unix -q "$OUT_DIR/install.sh"
else
  # Portable sed-in-place dance: BSD sed needs `-i ''`, GNU sed wants `-i`.
  sed -i.bak 's/\r$//' "$OUT_DIR/install.sh" 2>/dev/null && rm -f "$OUT_DIR/install.sh.bak"
fi
chmod +x "$OUT_DIR/install.sh" 2>/dev/null || true

# Compute SHA256 for integrity verification.
if command -v sha256sum >/dev/null; then
  SHA=$(sha256sum "$OUT_DIR/mindstrate-mcp.js" | awk '{print $1}')
elif command -v shasum >/dev/null; then
  SHA=$(shasum -a 256 "$OUT_DIR/mindstrate-mcp.js" | awk '{print $1}')
else
  SHA="(sha256 unavailable — install scripts will skip integrity check)"
fi

cat > "$OUT_DIR/manifest.json" <<EOF
{
  "version": "${VERSION}",
  "bundle": "mindstrate-mcp.js",
  "sha256": "${SHA}",
  "builtAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

# Offline-friendly README so a teammate who downloads the zip from
# Feishu / shared drive / email can install without reading docs.
cat > "$OUT_DIR/README.txt" <<EOF
Mindstrate MCP Server — offline installer (version ${VERSION})
=============================================================

Requirements: Node.js 18 or newer.

Linux / macOS:
  bash install.sh
  # follow prompts (Team Server URL, API Key, AI tool)

Windows:
  Right-click install.ps1 -> "Run with PowerShell"
  (or from a PowerShell prompt:  .\install.ps1)

The installer copies mindstrate-mcp.js into ~/.mindstrate-mcp/ and
wires it into the AI tool you pick (OpenCode / Cursor / Claude Desktop).
Restart the AI tool after install to pick up the new MCP config.

To upgrade: replace this folder with a newer one and re-run the installer.
EOF

# Build a single-file zip for Feishu / shared-drive distribution.
# Skip silently if zip isn't available — the dist/ tree is still usable as-is.
ZIP_NAME="mindstrate-installer-${VERSION}.zip"
ZIP_PATH="install/${ZIP_NAME}"
rm -f "$ZIP_PATH"
if command -v zip >/dev/null 2>&1; then
  ( cd install && zip -qrj "$ZIP_NAME" "dist/" )
  echo "  Zip: $ZIP_PATH"
elif command -v powershell.exe >/dev/null 2>&1; then
  # Windows fallback (Git Bash without zip).
  powershell.exe -NoProfile -Command \
    "Compress-Archive -Path 'install/dist/*' -DestinationPath 'install/${ZIP_NAME}' -Force" \
    && echo "  Zip: $ZIP_PATH"
else
  echo "  Zip: (skipped — no zip/powershell available)"
fi

SIZE=$(du -h "$OUT_DIR/mindstrate-mcp.js" | awk '{print $1}')
echo
echo "Built into $OUT_DIR:"
ls -la "$OUT_DIR"
echo
echo "Bundle: ${SIZE}"
echo "SHA256: $SHA"
echo
echo "Next steps:"
echo "  Option A — HTTP distribution (Nginx):"
echo "    1. rsync -avz $OUT_DIR/ user@nginx:/var/www/share/mindstrate/"
echo "    2. curl -fsSL http://<nginx>/mindstrate/install.sh \\"
echo "         | TEAM_SERVER_URL=http://<server>:3388 TEAM_API_KEY=... bash"
echo
echo "  Option B — Offline / Feishu zip distribution:"
echo "    1. Upload $ZIP_PATH to your Feishu doc / shared drive."
echo "    2. Teammates download, unzip, run install.sh (Linux/macOS)"
echo "       or right-click install.ps1 -> Run with PowerShell (Windows)."
