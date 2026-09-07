@echo off
REM Starts the Vite dev server on http://localhost:5173

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

pnpm run dev
