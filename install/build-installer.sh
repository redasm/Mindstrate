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

SIZE=$(du -h "$OUT_DIR/mindstrate-mcp.js" | awk '{print $1}')
echo
echo "Built into $OUT_DIR:"
ls -la "$OUT_DIR"
echo
echo "Bundle: ${SIZE}"
echo "SHA256: $SHA"
echo
echo "Next steps:"
echo "  1. Upload to your internal Nginx, e.g.:"
echo "       rsync -avz $OUT_DIR/ user@nginx:/var/www/share/mindstrate/"
echo "  2. Tell team members to run:"
echo "       curl -fsSL http://<nginx>/mindstrate/install.sh | TEAM_SERVER_URL=http://<server>:3388 TEAM_API_KEY=... bash"
echo "       (or install.ps1 on Windows)"
