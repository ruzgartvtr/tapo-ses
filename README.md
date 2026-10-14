# Tapo Ses

Play your own audio through a Tapo camera speaker. C210 is the primary model. The app also works with other Tapo cameras that use the same talk channel.

The interface language follows the system. English is the default. Turkish is used when the system language is Turkish.

## Install

Desktop packages: https://github.com/ruzgartvtr/tapo-ses/releases/tag/v0.1.0

- Windows x64: `Tapo.Ses-0.1.0-win.zip`
- macOS Apple silicon: `Tapo.Ses-0.1.0-arm64-mac.zip`
- macOS Intel: `Tapo.Ses-0.1.0-mac.zip`

On macOS, if Gatekeeper reports the app as damaged, right-click `Ac.command` and choose Open.

Linux packages are built from this repository:

```bash
npm install
npm run dist:linux
```

That produces an AppImage and a `.deb` for x64 and arm64.

Android 0.2.0: https://github.com/ruzgartvtr/tapo-ses/releases/download/v0.2.0/Tapo.Ses-0.2.0.apk

Install the APK on the phone. The phone and the camera must be on the same network. English is the default; Turkish follows the phone language. Source is in the `android` directory.

## What it does

- MP3, WAV, M4A, and OGG are converted to 8 kHz mono PCMA.
- Audio is sent on the camera talk channel, TCP port 8800.
- The computer or phone and the camera must be on the same network.
- Sign in with the Tapo account password. The RTSP password is not accepted. The password stays on the device.
- Camera list, sound library, and level (0–150) stay on the device.
- Built-in sounds: Bell, Alert, Welcome.
- One playback is limited to 90 seconds.
- Models: C210 (primary), C200, C220, C225, C100, C110, C310, C320WS, C500, C510W, D230.

The C210 speaker is telephone quality. Short announcements are clearer.

## Source

```bash
npm install
npm run dev
npm run dist
```
