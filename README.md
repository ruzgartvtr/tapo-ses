# Tapo Ses

Play your own audio through a Tapo camera speaker. C210 is the primary model. The app also works with other Tapo cameras that use the same talk channel.

The interface language follows the system. English is the default. Turkish is used when the system language is Turkish.

## Install

Packages: https://github.com/ruzgartvtr/tapo-ses/releases/tag/v0.2.0

- Android: `Tapo.Ses-0.2.0.apk`
- Windows x64: `Tapo.Ses-0.2.0-win.zip`
- Linux x64: `Tapo.Ses-0.2.0-x86_64.AppImage` and `Tapo.Ses-0.2.0-amd64.deb`
- Linux arm64: `Tapo.Ses-0.2.0-arm64.AppImage` and `Tapo.Ses-0.2.0-arm64.deb`
- macOS Apple silicon: `Tapo.Ses-0.2.0-arm64-mac.zip`
- macOS Intel: `Tapo.Ses-0.2.0-mac.zip`

On Android, install the APK. The phone and the camera must be on the same network. On macOS, if Gatekeeper reports the app as damaged, right-click `Ac.command` and choose Open.

## What it does

- MP3, WAV, M4A, and OGG are converted to 8 kHz mono PCMA.
- Audio is sent on the camera talk channel, TCP port 8800.
- The computer or phone and the camera must be on the same network.
- Sign in with the Tapo account password. The RTSP password is not accepted. The password stays on the device.
- Camera list, sound library, and level (0–150) stay on the device.
- Built-in sounds: Bell, Alert, Welcome.
- One playback can run for up to one hour.
- Models: C210 (primary), C200, C220, C225, C100, C110, C310, C320WS, C500, C510W, D230.

The C210 speaker is telephone quality. Short announcements are clearer.

## Source

```bash
npm install
npm run dev
npm run dist
```
