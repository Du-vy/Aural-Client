@echo off
REM Starts the Tauri desktop app. Needs Rust and the MSVC build tools.
REM The first build compiles 400+ crates and takes a few minutes.

cd /d "%~dp0"

if not exist "node_modules\" (
    echo Dependencies are missing. Running npm install first...
    call npm install || exit /b 1
)

REM A Windows build needs icons\icon.ico even in debug: it goes into the
REM executable's resource file, and cargo only complains after compiling
REM everything else.
if not exist "src-tauri\icons\icon.ico" (
    echo Generating the icon set...
    call npm run icons || exit /b 1
)

npm run tauri:dev
