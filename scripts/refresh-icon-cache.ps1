# Refresh Windows Icon Cache
# Run this script if the .exe icon doesn't show in File Explorer

Write-Host "🔄 Refreshing Windows Icon Cache..." -ForegroundColor Cyan
Write-Host ""

# Method 1: Use ie4uinit.exe (built into Windows)
Write-Host "Method 1: Using ie4uinit.exe..." -ForegroundColor Yellow
try {
    Start-Process "ie4uinit.exe" -ArgumentList "-show" -Wait -NoNewWindow
    Write-Host "✓ Icon cache refreshed with ie4uinit" -ForegroundColor Green
} catch {
    Write-Host "✗ ie4uinit failed" -ForegroundColor Red
}

Write-Host ""

# Method 2: Delete icon cache files (more aggressive)
Write-Host "Method 2: Deleting icon cache files..." -ForegroundColor Yellow

$iconCachePaths = @(
    "$env:LOCALAPPDATA\Microsoft\Windows\Explorer\iconcache*.db",
    "$env:LOCALAPPDATA\IconCache.db"
)

$deletedCount = 0
foreach ($pattern in $iconCachePaths) {
    $files = Get-ChildItem -Path $pattern -ErrorAction SilentlyContinue
    foreach ($file in $files) {
        try {
            Remove-Item $file.FullName -Force -ErrorAction Stop
            Write-Host "  ✓ Deleted: $($file.Name)" -ForegroundColor Green
            $deletedCount++
        } catch {
            Write-Host "  ✗ Could not delete: $($file.Name)" -ForegroundColor Red
        }
    }
}

if ($deletedCount -eq 0) {
    Write-Host "  No icon cache files found (already clean)" -ForegroundColor Gray
} else {
    Write-Host "  Deleted $deletedCount icon cache file(s)" -ForegroundColor Green
}

Write-Host ""

# Method 3: Restart Windows Explorer
Write-Host "Method 3: Restarting Windows Explorer..." -ForegroundColor Yellow
$confirmation = Read-Host "Restart Explorer now? This will close all Explorer windows. (y/n)"

if ($confirmation -eq 'y' -or $confirmation -eq 'Y') {
    try {
        # Kill Explorer
        Stop-Process -Name explorer -Force -ErrorAction Stop
        Start-Sleep -Seconds 2

        # Restart Explorer
        Start-Process explorer.exe
        Write-Host "✓ Explorer restarted" -ForegroundColor Green
    } catch {
        Write-Host "✗ Could not restart Explorer" -ForegroundColor Red
        Write-Host "  Please restart Explorer manually" -ForegroundColor Yellow
    }
} else {
    Write-Host "⚠ Skipped Explorer restart" -ForegroundColor Yellow
    Write-Host "  You may need to restart Explorer manually or log off/on" -ForegroundColor Gray
}

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "✅ Icon cache refresh complete!" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "If the icon still doesn't appear:" -ForegroundColor Yellow
Write-Host "  1. Log off and log back on" -ForegroundColor Gray
Write-Host "  2. Restart your computer" -ForegroundColor Gray
Write-Host "  3. Check that assets/VRCM.ico exists and is a valid .ico file" -ForegroundColor Gray
Write-Host ""
