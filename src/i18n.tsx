import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Locale = "en" | "tr";

const STORAGE_KEY = "tapo-ses-locale";

const messages = {
  en: {
    "app.name": "Tapo Ses",
    "auth.title": "Sign in",
    "auth.lead": "Use the email and password from the Tapo app. The RTSP password will not work.",
    "auth.email": "Email",
    "auth.password": "Password",
    "auth.code": "Verification code",
    "auth.submit": "Sign in",
    "auth.verify": "Verify code",
    "auth.working": "Signing in…",
    "auth.desktopOnly": "Sign-in runs in the desktop app.",
    "auth.required": "Enter your Tapo email and password.",
    "auth.connectedNone": "Signed in. No camera is on this account.",
    "auth.connectedMissing": "Signed in. {count} cameras found. Enter the address of any camera that has none.",
    "auth.connected": "Signed in. {count} cameras found.",
    "auth.failed": "Could not sign in.",
    "account.signOut": "Sign out",
    "account.ready": "Ready",
    "cameras": "Cameras",
    "cameras.empty": "No cameras yet.",
    "cameras.name": "Name",
    "cameras.model": "Model",
    "cameras.address": "Address",
    "cameras.addressNeeded": "Address required.",
    "cameras.add": "Add camera",
    "cameras.remove": "Remove",
    "cameras.added": "{name} added. The password stays on this device.",
    "cameras.usesAccount": "Uses the signed-in Tapo password.",
    "cameras.waiting": "No address",
    "player.play": "Play",
    "player.playing": "Playing…",
    "player.preview": "Preview",
    "player.stop": "Stop",
    "player.volume": "Volume",
    "player.level": "Level {value}",
    "player.needSelection": "Choose a camera and a sound.",
    "player.desktopOnly": "Playback runs in the desktop app.",
    "player.sending": "Sending to {model}…",
    "player.stopped": "Stopped.",
    "player.truncated": "{name} played the first hour.",
    "player.played": "{name} played ({seconds} s).",
    "player.previewLocal": "Preview is playing on this computer.",
    "player.sameNetwork": "This computer must be on the same network as the camera.",
    "player.noEngine": "Audio engine missing. Reinstall the app.",
    "library": "Sounds",
    "library.add": "Add audio",
    "library.empty": "No sounds yet.",
    "library.drop": "Drop an audio file here, or use Add audio.",
    "library.added": "{count} added to the library.",
    "library.badFile": "The file is empty or larger than 8 MB.",
    "library.remove": "Remove",
    "library.unknownDuration": "Unknown length",
    "sound.bell": "Bell",
    "sound.alert": "Alert",
    "sound.welcome": "Welcome",
    "lang.en": "EN",
    "lang.tr": "TR",
  },
  tr: {
    "app.name": "Tapo Ses",
    "auth.title": "Giriş",
    "auth.lead": "Tapo uygulamasındaki e-posta ve şifre. RTSP şifresi geçmez.",
    "auth.email": "E-posta",
    "auth.password": "Şifre",
    "auth.code": "Doğrulama kodu",
    "auth.submit": "Giriş",
    "auth.verify": "Kodu doğrula",
    "auth.working": "Giriş yapılıyor…",
    "auth.desktopOnly": "Giriş masaüstü uygulamasında yapılır.",
    "auth.required": "Tapo e-postası ve şifresi gerekli.",
    "auth.connectedNone": "Giriş yapıldı. Bu hesapta kamera yok.",
    "auth.connectedMissing": "Giriş yapıldı. {count} kamera bulundu. Adresi boş olana ev ağındaki adresi yaz.",
    "auth.connected": "Giriş yapıldı. {count} kamera bulundu.",
    "auth.failed": "Giriş yapılamadı.",
    "account.signOut": "Çıkış",
    "account.ready": "Hazır",
    "cameras": "Kameralar",
    "cameras.empty": "Henüz kamera yok.",
    "cameras.name": "Ad",
    "cameras.model": "Model",
    "cameras.address": "Adres",
    "cameras.addressNeeded": "Adres gerekli.",
    "cameras.add": "Kamera ekle",
    "cameras.remove": "Kaldır",
    "cameras.added": "{name} eklendi. Şifre bu cihazda kalır.",
    "cameras.usesAccount": "Giriş yapılan Tapo şifresi kullanılır.",
    "cameras.waiting": "Adres yok",
    "player.play": "Çal",
    "player.playing": "Çalıyor…",
    "player.preview": "Önizle",
    "player.stop": "Durdur",
    "player.volume": "Ses",
    "player.level": "Seviye {value}",
    "player.needSelection": "Bir kamera ve bir ses seç.",
    "player.desktopOnly": "Çalma masaüstü uygulamasında yapılır.",
    "player.sending": "{model} hoparlörüne gönderiliyor…",
    "player.stopped": "Durduruldu.",
    "player.truncated": "{name} ilk 1 saati çaldı.",
    "player.played": "{name} çaldı ({seconds} sn).",
    "player.previewLocal": "Önizleme bu bilgisayarın hoparlöründe.",
    "player.sameNetwork": "Bilgisayar kamerayla aynı ağda olmalı.",
    "player.noEngine": "Ses motoru yok. Uygulamayı yeniden kur.",
    "library": "Sesler",
    "library.add": "Ses ekle",
    "library.empty": "Henüz ses yok.",
    "library.drop": "Ses dosyasını buraya bırak veya Ses ekle’yi kullan.",
    "library.added": "{count} ses kitaplığa eklendi.",
    "library.badFile": "Dosya boş ya da 8 MB üzerinde.",
    "library.remove": "Kaldır",
    "library.unknownDuration": "Süre yok",
    "sound.bell": "Zil",
    "sound.alert": "Uyarı",
    "sound.welcome": "Hoş geldin",
    "lang.en": "EN",
    "lang.tr": "TR",
  },
} as const;

export type MessageKey = keyof (typeof messages)["en"];

function detectLocale(): Locale {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "en" || saved === "tr") return saved;
  return navigator.language.toLowerCase().startsWith("tr") ? "tr" : "en";
}

type I18nValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
    localStorage.setItem(STORAGE_KEY, locale);
  }, [locale]);

  const value = useMemo<I18nValue>(() => {
    const t = (key: MessageKey, vars?: Record<string, string | number>) => {
      const template = messages[locale][key] ?? messages.en[key];
      if (!vars) return template;
      return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? ""));
    };
    return { locale, setLocale: setLocaleState, t };
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("I18nProvider missing");
  return value;
}
