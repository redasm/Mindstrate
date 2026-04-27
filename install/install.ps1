#!/usr/bin/env pwsh
# Mindstrate MCP Server — one-liner installer for Windows (PowerShell 5.1+)
#
# Quick install:
#   $env:TEAM_SERVER_URL = "http://10.103.231.74:3388"
#   $env:TEAM_API_KEY    = "...your-key..."
#   $env:TOOL            = "opencode"
#   iwr http://<nginx>/mindstrate/install.ps1 -UseBasicParsing | iex
#
# Re-running upgrades the bundle in place.

[CmdletBinding()]
param(
  [string]$NginxBase     = $env:NGINX_BASE,
  [string]$InstallDir    = $env:INSTALL_DIR,
  [string]$TeamServerUrl = $env:TEAM_SERVER_URL,
  [string]$TeamApiKey    = $env:TEAM_API_KEY,
  [ValidateSet("opencode","cursor","claude-desktop","all","none","")]
  [string]$Tool          = $env:TOOL
)

$ErrorActionPreference = "Stop"

function Say($m)  { Write-Host "==> " -ForegroundColor Green  -NoNewline; Write-Host $m }
function Warn($m) { Write-Host "!!  " -ForegroundColor Yellow -NoNewline; Write-Host $m }
function Die($m)  { Write-Host "xx  " -ForegroundColor Red    -NoNewline; Write-Host $m; exit 1 }

if (-not $NginxBase)  { $NginxBase  = "http://CHANGE_ME/mindstrate" }   # >>>>> EDIT before publishing <<<<<
if (-not $InstallDir) { $InstallDir = Join-Path $env:USERPROFILE ".mindstrate-mcp" }
if (-not $Tool)       { $Tool = "opencode" }

Say "Source: $NginxBase"

# ---- 1. node check ----
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) { Die "Node.js is required. Install >= 18 from https://nodejs.org/" }
$nodeVersion = (& node -v) -replace '^v',''
if ([int]($nodeVersion.Split('.')[0]) -lt 18) { Die "Node.js >= 18 required, got v$nodeVersion" }
Say "Node.js: v$nodeVersion ✓"
$nodeBin = $nodeCmd.Source

# ---- 2. fetch manifest + bundle ----
$tmp = New-Item -ItemType Directory -Path (Join-Path $env:TEMP "mindstrate-install-$(Get-Random)")
try {
  $manifestPath = Join-Path $tmp "manifest.json"
  try { Invoke-WebRequest -Uri "$NginxBase/manifest.json" -OutFile $manifestPath -UseBasicParsing }
  catch { Die "Cannot fetch $NginxBase/manifest.json — wrong URL or server down? ($_)" }

  $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
  Say "Installing version $($manifest.version)"

  $bundlePath = Join-Path $tmp $manifest.bundle
  Invoke-WebRequest -Uri "$NginxBase/$($manifest.bundle)" -OutFile $bundlePath -UseBasicParsing

  if ($manifest.sha256 -and $manifest.sha256 -notmatch '^\(') {
    $actual = (Get-FileHash $bundlePath -Algorithm SHA256).Hash.ToLower()
    if ($actual -ne $manifest.sha256.ToLower()) {
      Die "SHA256 mismatch! expected $($manifest.sha256), got $actual"
    }
  }

  # ---- 3. install ----
  Say "Installing into $InstallDir"
  if (-not (Test-Path $InstallDir)) { New-Item -ItemType Directory -Path $InstallDir | Out-Null }
  $entry = Join-Path $InstallDir "mindstrate-mcp.js"
  Copy-Item -Force $bundlePath $entry

  # ---- 4. interactive prompts ----
  if (-not $TeamServerUrl) { $TeamServerUrl = Read-Host "Team Server URL (e.g. http://10.103.231.74:3388)" }
  if (-not $TeamApiKey)    { $TeamApiKey    = Read-Host "Team Server API Key" }
  if (-not $TeamServerUrl) { Die "TEAM_SERVER_URL is required" }
  if (-not $TeamApiKey)    { Die "TEAM_API_KEY is required" }

  # ---- 5. write MCP config(s) ----
  function Merge-Mcp($path, $key, $entry, $rootKey) {
    $cfg = if (Test-Path $path) {
      try { Get-Content $path -Raw | ConvertFrom-Json } catch { Warn "$path malformed JSON, overwriting"; [ordered]@{} }
    } else { [ordered]@{} }
    if (-not $cfg.$rootKey) { $cfg | Add-Member -MemberType NoteProperty -Name $rootKey -Value ([ordered]@{}) -Force }
    $cfg.$rootKey | Add-Member -MemberType NoteProperty -Name $key -Value $entry -Force
    $dir = Split-Path -Parent $path
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    ($cfg | ConvertTo-Json -Depth 16) | Set-Content -Path $path -Encoding UTF8
    Say "Wrote $path"
  }

  $envBlock = [ordered]@{
    "TEAM_SERVER_URL" = $TeamServerUrl
    "TEAM_API_KEY"    = $TeamApiKey
  }

  if ($Tool -in @("opencode","all")) {
    $opPath = if ($env:OPENCODE_CONFIG) { $env:OPENCODE_CONFIG } else { Join-Path $env:USERPROFILE ".config\opencode\config.json" }
    Merge-Mcp $opPath "mindstrate" ([ordered]@{
      "type"        = "local"
      "command"     = @($nodeBin, $entry)
      "environment" = $envBlock
    }) "mcp"
  }

  if ($Tool -in @("cursor","all")) {
    $curPath = if ($env:CURSOR_CONFIG) { $env:CURSOR_CONFIG } else { Join-Path $env:USERPROFILE ".cursor\mcp.json" }
    Merge-Mcp $curPath "mindstrate" ([ordered]@{
      "command" = $nodeBin
      "args"    = @($entry)
      "env"     = $envBlock
    }) "mcpServers"
  }

  if ($Tool -in @("claude-desktop","all")) {
    $cdPath = if ($env:CLAUDE_DESKTOP_CONFIG) { $env:CLAUDE_DESKTOP_CONFIG } else { Join-Path $env:APPDATA "Claude\claude_desktop_config.json" }
    Merge-Mcp $cdPath "mindstrate" ([ordered]@{
      "command" = $nodeBin
      "args"    = @($entry)
      "env"     = $envBlock
    }) "mcpServers"
  }

  if ($Tool -eq "none") { Say "Skipped MCP config." }

  # ---- 6. smoke test ----
  Say "Smoke test (3s)..."
  $env:TEAM_SERVER_URL = $TeamServerUrl
  $env:TEAM_API_KEY    = $TeamApiKey
  $proc = Start-Process -FilePath $nodeBin -ArgumentList $entry -PassThru `
    -RedirectStandardError (Join-Path $tmp "stderr.log") `
    -RedirectStandardOutput (Join-Path $tmp "stdout.log") `
    -WindowStyle Hidden
  Start-Sleep -Seconds 3
  if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force }
  $stderr = Get-Content (Join-Path $tmp "stderr.log") -Raw -ErrorAction SilentlyContinue
  if ($stderr -match "Team Server is not reachable") { Warn "Bundle started, but cannot reach Team Server." }
  elseif ($stderr -match "MCP Server started")       { Say "MCP Server started OK." }

  Write-Host ""
  Write-Host "Done." -ForegroundColor Green
  Write-Host "  Installed:   $entry  (version $($manifest.version))"
  Write-Host "  Team Server: $TeamServerUrl"
  Write-Host ""
  Write-Host "Restart your AI tool (OpenCode / Cursor / Claude Desktop) to load the new MCP config."
  Write-Host "To upgrade later, just re-run this installer."
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
