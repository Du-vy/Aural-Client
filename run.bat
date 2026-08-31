@echo off
REM Starts the Vite dev server on http://localhost:5173

cd /d "%~dp0"

if not exist "node_modules\" (
    echo Dependencies are missing. Running npm install first...
    call npm install || exit /b 1
)

npm run dev
