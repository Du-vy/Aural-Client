@echo off
REM Starts the Tauri desktop app. Needs Rust and the MSVC build tools.
REM The first build compiles 400+ crates and takes a few minutes.

cd /d "%~dp0"

REM pnpm, not npm: dependency install scripts do not run unless the repo names
REM the package in pnpm-workspace.yaml. `corepack enable` is what puts it on
REM PATH, using the version package.json pins.
where pnpm >nul 2>nul
if errorlevel 1 (
    echo pnpm was not found. Enable it with:  corepack enable
    exit /b 1
)

if not exist "node_modules\" (
    echo Dependencies are missing. Running pnpm install first...
    call pnpm install || exit /b 1
)

REM A Windows build needs icons\icon.ico even in debug: it goes into the
REM executable's resource file, and cargo only complains after compiling
REM everything else.
if not exist "src-tauri\icons\icon.ico" (
    echo Generating the icon set...
    call pnpm run icons || exit /b 1
)

pnpm run tauri:dev
