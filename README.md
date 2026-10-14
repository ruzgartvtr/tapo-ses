# Tapo Ses 0.1.0

Windows ve macOS uygulaması. Tapo C210 ve aynı konuşma kanalını kullanan Tapo kameraların hoparlöründen ses dosyası çalar.

## Bu sürüm

- MP3, WAV, M4A ve OGG dosyaları 8 kHz mono PCMA’ya çevrilir.
- Ses, kameranın konuşma kanalına gider (TCP 8800).
- Bilgisayar ile kamera aynı ağda olmalıdır.
- Giriş Tapo bulut şifresiyle yapılır. RTSP şifresi geçersizdir. Şifre yalnız o bilgisayarda durur.
- Kamera listesi, ses kitapliğı ve seviye (0–150) yerelde tutulur.
- Hazır sesler: Zil, Uyarı, Hoş geldin.
- Bir çalma en fazla 90 saniyedir.
- Modeller: C210 (birincil), C200, C220, C225, C100, C110, C310, C320WS, C500, C510W, D230.

C210 hoparlörü telefon kalitesindedir. Kısa anonslar daha net duyulur.

## Paket

Kurulum dosyası bu sürümle birlikte yüklenmedi. Paket kaynak koddan çıkar:

```bash
npm install
npm run dist
```

- Windows x64: `Tapo Ses-0.1.0-win.zip`
- macOS Apple silicon: `Tapo Ses-0.1.0-arm64-mac.zip`
- macOS Intel: `Tapo Ses-0.1.0-mac.zip`

macOS paketleri imzasızdır. İlk açılışta sistem uyarısı çıkar.
