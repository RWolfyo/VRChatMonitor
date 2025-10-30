@echo off
REM Refresh Windows Icon Cache
REM Run this script if the .exe icon doesn't show in File Explorer

echo.
echo ========================================
echo  Refreshing Windows Icon Cache
echo ========================================
echo.

echo [1/3] Using ie4uinit.exe...
ie4uinit.exe -show
if %errorlevel% equ 0 (
    echo       SUCCESS: Icon cache refreshed
) else (
    echo       WARNING: ie4uinit failed
)
echo.

echo [2/3] Deleting icon cache files...
del /f /q "%LOCALAPPDATA%\Microsoft\Windows\Explorer\iconcache*.db" 2>nul
del /f /q "%LOCALAPPDATA%\IconCache.db" 2>nul
echo       Icon cache files deleted
echo.

echo [3/3] Restarting Explorer...
set /p RESTART="Restart Windows Explorer? (y/n): "
if /i "%RESTART%"=="y" (
    echo       Stopping Explorer...
    taskkill /f /im explorer.exe >nul 2>&1
    timeout /t 2 /nobreak >nul
    echo       Starting Explorer...
    start explorer.exe
    echo       SUCCESS: Explorer restarted
) else (
    echo       SKIPPED: Explorer not restarted
    echo       You may need to log off/on to see the icon
)

echo.
echo ========================================
echo  Icon cache refresh complete!
echo ========================================
echo.
echo If the icon still doesn't appear:
echo   1. Log off and log back on
echo   2. Restart your computer
echo   3. Check that assets/VRCM.ico exists
echo.
pause
