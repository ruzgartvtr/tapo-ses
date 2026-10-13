# Tapo Ses

Windows ve macOS uygulaması. Tapo **C210** ve diğer iki yönlü sesli Tapo kameraların hoparlöründen kendi MP3 dosyanı çalar.

Uygulama dosyayı 8 kHz mono PCMA’ya çevirir ve kameranın konuşma kanalına gönderir. Bilgisayar kamerayla aynı ev ağında olmalıdır.

## Geliştirme

```bash
npm install
npm run dev
```

## Kurulum dosyası

Bulunduğun sistem için:

```bash
npm run dist
```

Yalnız Windows (kurulum sihirbazı ve zip):

```bash
npm run dist:win
```

Yalnız macOS (zip ve dmg):

```bash
npm run dist:mac
```

Çıktı `release/` klasöründedir:

- Windows: `Tapo Ses-0.1.0-win.zip` içindeki `Tapo Ses.exe`
- macOS Apple silicon: `Tapo Ses-0.1.0-arm64-mac.zip`
- macOS Intel: `Tapo Ses-0.1.0-mac.zip`

Zip’i açıp uygulamayı çalıştır. macOS ilk açılışta imzasız uygulama uyarısı verebilir; paket bir Mac’te `npm run dist:mac` ile üretilirse dmg de çıkar. Kameraya **Tapo bulut şifresini** yaz; RTSP şifresi işe yaramaz.

C210 hoparlörü telefon kalitesindedir. Kısa anonslar en temiz sonucu verir. Tek seferde en fazla 90 saniye çalınır.
