@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"

if not exist ".env.local" (
  echo [.env.local not found] Please create .env.local in the project root first.
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$envFile = '.env.local';" ^
  "Get-Content $envFile | ForEach-Object {" ^
  "  if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }" ^
  "  $parts = $_ -split '=', 2;" ^
  "  if ($parts.Length -eq 2) {" ^
  "    [System.Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim(), 'Process')" ^
  "  }" ^
  "};" ^
  "npx vercel dev"
