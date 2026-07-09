@echo off
echo === Premiere Pro MCP Bridge Installer ===
echo.

REM Enable unsigned CEP extensions (required for development)
reg add "HKCU\Software\Adobe\CSXS.11" /v PlayerDebugMode /t REG_SZ /d 1 /f
reg add "HKCU\Software\Adobe\CSXS.12" /v PlayerDebugMode /t REG_SZ /d 1 /f
echo [OK] Enabled CEP debug mode

REM Create junction for CEP extension (works without admin/Developer Mode, unlike /D symlinks)
set CEP_DIR=%APPDATA%\Adobe\CEP\extensions\com.mcp.premiere.bridge
if not exist "%APPDATA%\Adobe\CEP\extensions" mkdir "%APPDATA%\Adobe\CEP\extensions"
if exist "%CEP_DIR%" (
  rmdir "%CEP_DIR%"
  echo [OK] Removed existing extension link
)

mklink /J "%CEP_DIR%" "%~dp0cep"
if errorlevel 1 (
  echo [FAIL] Could not create extension link at %CEP_DIR%
) else (
  echo [OK] Created extension link at %CEP_DIR%
)

REM Create config.json from example if it doesn't exist
if not exist "%~dp0config.json" (
  if exist "%~dp0config.example.json" (
    copy "%~dp0config.example.json" "%~dp0config.json" >nul
    echo [OK] Created config.json from config.example.json
  )
)

REM Install Node.js dependencies
echo.
echo Installing dependencies...
cd /d "%~dp0"
call npm install
echo [OK] Dependencies installed

REM Build TypeScript
echo.
echo Building MCP server...
call npm run build
echo [OK] Build complete

REM Configure Claude Desktop
echo.
set CLAUDE_DESKTOP_CONFIG=%APPDATA%\Claude\claude_desktop_config.json
set SERVER_PATH=%~dp0dist\server.js
REM Convert backslashes to forward slashes for JSON (avoids double-escape issues)
set SERVER_PATH_JSON=%SERVER_PATH:\=/%

if exist "%CLAUDE_DESKTOP_CONFIG%" (
  echo Found existing Claude Desktop config at %CLAUDE_DESKTOP_CONFIG%
  findstr /C:"premiere-pro" "%CLAUDE_DESKTOP_CONFIG%" >nul 2>&1
  if errorlevel 1 (
    echo Adding premiere-pro MCP server to Claude Desktop config...
    powershell -Command "$cfg = Get-Content '%CLAUDE_DESKTOP_CONFIG%' -Raw | ConvertFrom-Json; if (-not $cfg.mcpServers) { $cfg | Add-Member -NotePropertyName 'mcpServers' -NotePropertyValue ([PSCustomObject]@{}) }; $cfg.mcpServers | Add-Member -NotePropertyName 'premiere-pro' -NotePropertyValue ([PSCustomObject]@{ command='node'; args=@('%SERVER_PATH_JSON%') }) -Force; $cfg | ConvertTo-Json -Depth 10 | Set-Content '%CLAUDE_DESKTOP_CONFIG%' -Encoding UTF8"
    echo [OK] Added premiere-pro to Claude Desktop config
  ) else (
    echo [SKIP] premiere-pro already exists in Claude Desktop config
  )
) else (
  echo Creating Claude Desktop config at %CLAUDE_DESKTOP_CONFIG%
  if not exist "%APPDATA%\Claude" mkdir "%APPDATA%\Claude"
  echo { "mcpServers": { "premiere-pro": { "command": "node", "args": ["%SERVER_PATH_JSON%"] } } } > "%CLAUDE_DESKTOP_CONFIG%"
  powershell -Command "Get-Content '%CLAUDE_DESKTOP_CONFIG%' -Raw | ConvertFrom-Json | ConvertTo-Json -Depth 10 | Set-Content '%CLAUDE_DESKTOP_CONFIG%' -Encoding UTF8"
  echo [OK] Created Claude Desktop config with premiere-pro server
)

REM Configure Claude Code (CLI) - uses ~/.claude.json (not settings.json)
echo.
set CLAUDE_CODE_CONFIG=%USERPROFILE%\.claude.json

if exist "%CLAUDE_CODE_CONFIG%" (
  findstr /C:"premiere-pro" "%CLAUDE_CODE_CONFIG%" >nul 2>&1
  if errorlevel 1 (
    echo Adding premiere-pro MCP server to Claude Code config...
    powershell -Command "$cfg = Get-Content '%CLAUDE_CODE_CONFIG%' -Raw | ConvertFrom-Json; if (-not $cfg.mcpServers) { $cfg | Add-Member -NotePropertyName 'mcpServers' -NotePropertyValue ([PSCustomObject]@{}) }; $cfg.mcpServers | Add-Member -NotePropertyName 'premiere-pro' -NotePropertyValue ([PSCustomObject]@{ command='node'; args=@('%SERVER_PATH_JSON%') }) -Force; $cfg | ConvertTo-Json -Depth 10 | Set-Content '%CLAUDE_CODE_CONFIG%' -Encoding UTF8"
    echo [OK] Added premiere-pro to Claude Code config
  ) else (
    echo [SKIP] premiere-pro already exists in Claude Code config
  )
) else (
  echo Creating Claude Code config at %CLAUDE_CODE_CONFIG%
  powershell -Command "$cfg = [PSCustomObject]@{ mcpServers = [PSCustomObject]@{ 'premiere-pro' = [PSCustomObject]@{ command='node'; args=@('%SERVER_PATH_JSON%') } } }; $cfg | ConvertTo-Json -Depth 10 | Set-Content '%CLAUDE_CODE_CONFIG%' -Encoding UTF8"
  echo [OK] Created Claude Code config with premiere-pro server
)

echo.
echo ============================================
echo   Installation complete!
echo ============================================
echo.
echo Configured for:
echo   [x] Claude Desktop  (%CLAUDE_DESKTOP_CONFIG%)
echo   [x] Claude Code     (%USERPROFILE%\.claude.json)
echo.
echo Next steps:
echo   1. Restart Premiere Pro
echo   2. Open Window ^> Extensions ^> MCP Bridge
echo   3. The panel should show "Connected"
echo   4. Restart Claude Desktop / Claude Code
echo   5. Start using Premiere Pro tools!
echo.
pause
