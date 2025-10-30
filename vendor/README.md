# Vendor Binaries

This directory should contain the following binaries for full functionality:

## Required Files

### ffplay.exe
- **Purpose**: Audio playback for alert sounds
- **Source**: FFmpeg static builds from https://ffmpeg.org/download.html
- **Download**: Get the "essentials" build which includes ffplay.exe
- **File**: Place `ffplay.exe` in this directory

### SnoreToast.exe
- **Purpose**: Windows 10/11 desktop notifications
- **Source**: https://github.com/KDE/snoretoast/releases
- **Download**: Get the latest release of SnoreToast
- **File**: Place `SnoreToast.exe` in this directory

## Directory Structure

```
vendor/
├── ffplay.exe          (for audio alerts)
├── SnoreToast.exe      (for desktop notifications)
└── README.md           (this file)
```

## Notes

- Both binaries are optional but recommended for full functionality
- Without ffplay.exe, audio alerts will be disabled
- Without SnoreToast.exe, desktop notifications will use fallback methods
- These binaries are Windows-only (this application is Windows-only)
