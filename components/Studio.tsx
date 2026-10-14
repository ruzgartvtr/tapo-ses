import { useEffect, useRef, useState } from "react";

import { TAPO_MODELS } from "@/lib/models";
import { useI18n } from "@/src/i18n";

type Camera = {
  id: string;
  name: string;
  model: string;
  host: string;
  password: string;
  passwordIsHash: boolean;
};

type Sound = {
  id: string;
  name: string;
  bytes: ArrayBuffer;
  durationMs: number;
  createdAt: number;
};

const CAMERA_KEY = "tapo-ses-cameras";
const SETTINGS_KEY = "tapo-ses-settings";
const ACCOUNT_KEY = "tapo-ses-account";
const DB_NAME = "tapo-ses";
const STORE = "sounds";

type Account = {
  email: string;
  password: string;
};

export function Studio() {
  const { locale, setLocale, t } = useI18n();
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [sounds, setSounds] = useState<Sound[]>([]);
  const [soundId, setSoundId] = useState<string>("");
  const [volume, setVolume] = useState(100);
  const [ffmpegReady, setFfmpegReady] = useState<boolean | null>(null);
  const [status, setStatus] = useState("");
  const [tone, setTone] = useState<"ok" | "error" | "">("");
  const [busy, setBusy] = useState(false);
  const [hot, setHot] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);
  const [accountReady, setAccountReady] = useState(false);
  const [login, setLogin] = useState({ email: "", password: "", code: "" });
  const [needsCode, setNeedsCode] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [draft, setDraft] = useState({
    name: "Salon",
    model: "C210",
    host: "",
  });
  const previewRef = useRef<HTMLAudioElement | null>(null);
  const stopRequested = useRef(false);

  useEffect(() => {
    const stored = localStorage.getItem(CAMERA_KEY);
    const settings = localStorage.getItem(SETTINGS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Camera[];
      setCameras(parsed);
      setSelectedId(parsed[0]?.id ?? "");
    }
    if (settings) {
      const parsed = JSON.parse(settings) as { volume?: number };
      setVolume(parsed.volume ?? 100);
    }
    const savedAccount = localStorage.getItem(ACCOUNT_KEY);
    let saved: Account | null = null;
    if (savedAccount) {
      const parsed = JSON.parse(savedAccount) as Account;
      if (parsed.email?.includes("@") && parsed.password) saved = parsed;
    }
    setAccountReady(true);
    if (saved) {
      setLogin({ email: saved.email, password: saved.password, code: "" });
      void connectAccount(saved.email, saved.password);
    }
    void loadSounds().then((items) => {
      setSounds(items);
      setSoundId(items[0]?.id ?? "");
    });
    void window.tapo?.health().then((body) => setFfmpegReady(body.ffmpeg)).catch(() => setFfmpegReady(false));
  }, []);

  useEffect(() => {
    localStorage.setItem(CAMERA_KEY, JSON.stringify(cameras));
  }, [cameras]);

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ volume }));
  }, [volume]);

  const camera = cameras.find((item) => item.id === selectedId) ?? null;
  const sound = sounds.find((item) => item.id === soundId) ?? null;

  async function connectAccount(email: string, password: string, code?: string) {
    if (!window.tapo?.connect) {
      setTone("error");
      setStatus(t("auth.desktopOnly"));
      return;
    }
    setConnecting(true);
    setTone("");
    setStatus(t("auth.working"));
    try {
      const result = await window.tapo.connect({ email, password, code });
      if (!result.ok) {
        setNeedsCode(Boolean(result.mfa));
        setTone("error");
        setStatus(shown(result.error || t("auth.failed")));
        return;
      }
      const next = { email, password };
      localStorage.setItem(ACCOUNT_KEY, JSON.stringify(next));
      const found = (result.cameras ?? []).map((item) => ({
        ...item,
        password,
        passwordIsHash: false,
      }));
      if (found.length > 0) {
        setCameras(found);
        setSelectedId(found[0]!.id);
      }
      setAccount(next);
      setNeedsCode(false);
      setLogin({ email, password: "", code: "" });
      setTone(found.length > 0 ? "ok" : "error");
      const missing = found.filter((item) => !item.host).length;
      setStatus(
        found.length === 0
          ? t("auth.connectedNone")
          : missing > 0
            ? t("auth.connectedMissing", { count: found.length })
            : t("auth.connected", { count: found.length }),
      );
    } catch (error) {
      const raw = error instanceof Error ? error.message : t("auth.failed");
      setTone("error");
      setStatus(shown(raw.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "")));
    } finally {
      setConnecting(false);
    }
  }

  function saveAccount() {
    const email = login.email.trim();
    if (!email.includes("@") || !login.password) {
      setTone("error");
      setStatus(t("auth.required"));
      return;
    }
    void connectAccount(email, login.password, needsCode ? login.code : undefined);
  }

  function signOut() {
    localStorage.removeItem(ACCOUNT_KEY);
    setAccount(null);
    setLogin({ email: "", password: "", code: "" });
    setNeedsCode(false);
    setTone("");
    setStatus(t("account.ready"));
  }

  function addCamera() {
    if (!account) return;
    if (!draft.host.trim()) {
      setTone("error");
      setStatus(t("cameras.addressNeeded"));
      return;
    }
    const next: Camera = {
      id: crypto.randomUUID(),
      name: draft.name.trim() || draft.model,
      model: draft.model,
      host: draft.host.trim(),
      password: account.password,
      passwordIsHash: false,
    };
    setCameras((current) => [...current, next]);
    setSelectedId(next.id);
    setDraft((current) => ({ ...current, host: "" }));
    setTone("ok");
    setStatus(t("cameras.added", { name: next.name }));
  }

  function removeCamera(id: string) {
    setCameras((current) => current.filter((item) => item.id !== id));
    if (selectedId === id) setSelectedId("");
  }

  async function addFiles(files: FileList | File[]) {
    const list = [...files].filter((file) => file.size > 0 && file.size <= 8_000_000);
    if (list.length === 0) {
      setTone("error");
      setStatus(t("library.badFile"));
      return;
    }
    const created: Sound[] = [];
    for (const file of list) {
      const bytes = await file.arrayBuffer();
      const durationMs = await durationOf(bytes);
      created.push({
        id: crypto.randomUUID(),
        name: file.name.replace(/\.[^.]+$/, ""),
        bytes,
        durationMs,
        createdAt: Date.now(),
      });
    }
    await Promise.all(created.map((item) => putSound(item)));
    setSounds((current) => [...created, ...current]);
    setSoundId(created[0]!.id);
    setTone("ok");
    setStatus(t("library.added", { count: created.length }));
  }

  async function removeSound(id: string) {
    await deleteSound(id);
    setSounds((current) => current.filter((item) => item.id !== id));
    if (soundId === id) setSoundId("");
  }

  function preview() {
    if (!sound) return;
    previewRef.current?.pause();
    const url = URL.createObjectURL(new Blob([sound.bytes]));
    const audio = new Audio(url);
    previewRef.current = audio;
    audio.onended = () => URL.revokeObjectURL(url);
    void audio.play();
    setTone("");
    setStatus(t("player.previewLocal"));
  }

  async function playOnCamera() {
    if (!account || !camera || !sound) {
      setTone("error");
      setStatus(t("player.needSelection"));
      return;
    }
    if (!window.tapo) {
      setTone("error");
      setStatus(t("player.desktopOnly"));
      return;
    }
    stopRequested.current = false;
    setBusy(true);
    setTone("");
    setStatus(t("player.sending", { model: camera.model }));
    try {
      const body = await window.tapo.play({
        host: camera.host,
        password: account.password,
        passwordIsHash: false,
        volume,
        file: new Uint8Array(sound.bytes),
      });
      if (stopRequested.current) {
        setTone("");
        setStatus(t("player.stopped"));
        return;
      }
      setTone("ok");
      const seconds = Math.round((body.durationMs ?? sound.durationMs) / 100) / 10;
      setStatus(
        body.truncated
          ? t("player.truncated", { name: camera.name })
          : t("player.played", { name: camera.name, seconds }),
      );
    } catch (error) {
      const raw = error instanceof Error ? error.message : t("auth.failed");
      const cleaned = raw.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
      if (stopRequested.current || cleaned.includes("Stopped")) {
        setTone("");
        setStatus(t("player.stopped"));
      } else {
        setTone("error");
        setStatus(shown(cleaned));
      }
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    stopRequested.current = true;
    setBusy(false);
    if (!camera) return;
    await window.tapo?.stop(camera.host).catch(() => undefined);
    setStatus(t("player.stopped"));
  }

  function labelFor(item: Sound) {
    if (item.id === "preset-Zil") return t("sound.bell");
    if (item.id === "preset-Uyarı") return t("sound.alert");
    if (item.id === "preset-Hoş geldin") return t("sound.welcome");
    return item.name;
  }

  function shown(message: string) {
    if (locale === "en") return message;
    const exact: Record<string, string> = {
      "Email or password was rejected.": "E-posta veya şifre kabul edilmedi.",
      "Tapo account was not found.": "Tapo hesabı bulunamadı.",
      "Could not read the Tapo server.": "Tapo sunucusu okunamadı.",
      "Audio engine missing. Reinstall the app.": "Ses motoru yok. Uygulamayı yeniden kur.",
      "Camera address is invalid.": "Kamera adresi geçersiz.",
      "This address cannot be used.": "Bu adres kullanılamaz.",
      "Camera port is invalid.": "Kamera portu geçersiz.",
      "The camera closed the connection.": "Kamera bağlantıyı kapattı.",
      "The camera did not start a talk session.": "Kameradan konuşma oturumu gelmedi.",
      "Cloud password required.": "Bulut şifresi gerekli.",
      "The audio file is empty.": "Ses dosyası boş.",
      "The camera does not use digest authentication.": "Kamera Digest kimlik doğrulaması istemiyor.",
      "Password rejected. Use the Tapo account password, not the RTSP password.":
        "Şifre kabul edilmedi. RTSP şifresi değil, Tapo hesap şifresi gerekli.",
      "Stopped.": "Durduruldu.",
      "The camera timed out.": "Kamera zaman aşımına uğradı.",
      "Connecting to the camera timed out.": "Kameraya bağlanırken zaman aşımı.",
    };
    if (exact[message]) return exact[message];
    const patterns: Array<[RegExp, (match: RegExpMatchArray) => string]> = [
      [/^Tapo rejected the connection \((.+)\).$/, (match) => `Tapo bağlantıyı reddetti (${match[1]}).`],
      [/^The camera rejected the talk request \((.+)\).$/, (match) => `Kamera konuşma isteğini reddetti (${match[1]}).`],
      [/^The camera did not ask for a password \((.+)\).$/, (match) => `Kamera kimlik doğrulaması vermedi (${match[1]}).`],
      [/^The camera did not open the stream \((.+)\).$/, (match) => `Kamera akışı açılmadı (${match[1]}).`],
      [/^Could not reach the camera \((.+)\). It must be on this network with port 8800 open.$/, (match) => `Kameraya ulaşılamadı (${match[1]}). Aynı ağda olmalı ve 8800 portu açık olmalı.`],
    ];
    for (const [pattern, format] of patterns) {
      const match = message.match(pattern);
      if (match) return format(match);
    }
    return message;
  }

  if (!accountReady) return null;

  const langs = (
    <div className="langs" role="group" aria-label="Language">
      <button type="button" className={locale === "en" ? "active" : ""} onClick={() => setLocale("en")}>
        {t("lang.en")}
      </button>
      <button type="button" className={locale === "tr" ? "active" : ""} onClick={() => setLocale("tr")}>
        {t("lang.tr")}
      </button>
    </div>
  );

  if (!account) {
    return (
      <main className="gate">
        <form
          className="card"
          onSubmit={(event) => {
            event.preventDefault();
            saveAccount();
          }}
        >
          <div className="card-top">
            <strong>{t("app.name")}</strong>
            {langs}
          </div>
          <h1>{t("auth.title")}</h1>
          <p className="lead">{t("auth.lead")}</p>
          <label>
            {t("auth.email")}
            <input
              type="email"
              autoComplete="username"
              inputMode="email"
              value={login.email}
              onChange={(event) => setLogin({ ...login, email: event.target.value })}
            />
          </label>
          <label>
            {t("auth.password")}
            <input
              type="password"
              autoComplete="current-password"
              value={login.password}
              onChange={(event) => setLogin({ ...login, password: event.target.value })}
            />
          </label>
          {needsCode && (
            <label>
              {t("auth.code")}
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                value={login.code}
                onChange={(event) => setLogin({ ...login, code: event.target.value })}
              />
            </label>
          )}
          <button className="btn-primary" type="submit" disabled={connecting}>
            {connecting ? t("auth.working") : needsCode ? t("auth.verify") : t("auth.submit")}
          </button>
          {(connecting || tone === "error") && (
            <p className={tone === "error" ? "status error" : "status"}>{status}</p>
          )}
        </form>
      </main>
    );
  }

  return (
    <main className="app">
      <header className="toolbar">
        <strong>{t("app.name")}</strong>
        {langs}
        <span className="spacer" />
        <span className="account">{account.email}</span>
        <button className="btn" type="button" onClick={signOut}>
          {t("account.signOut")}
        </button>
      </header>
      <div className="workspace">
        <aside className="sidebar">
          <p className="section-label">{t("cameras")}</p>
          <div className="camera-list">
            {cameras.map((item) => (
              <button
                key={item.id}
                type="button"
                className={item.id === selectedId ? "row-btn active" : "row-btn"}
                onClick={() => setSelectedId(item.id)}
              >
                <strong>{item.name}</strong>
                <span>
                  {item.model} · {item.host || t("cameras.waiting")}
                </span>
              </button>
            ))}
            {cameras.length === 0 && <p className="note">{t("cameras.empty")}</p>}
          </div>
          <div className="form">
            <label>
              {t("cameras.name")}
              <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </label>
            <label>
              {t("cameras.model")}
              <select value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })}>
                {TAPO_MODELS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("cameras.address")}
              <input
                value={draft.host}
                placeholder="192.168.1.40"
                onChange={(event) => setDraft({ ...draft, host: event.target.value })}
              />
            </label>
            <p className="note">{t("cameras.usesAccount")}</p>
            <button className="btn-primary" type="button" onClick={addCamera}>
              {t("cameras.add")}
            </button>
            {camera && (
              <button className="btn" type="button" onClick={() => removeCamera(camera.id)}>
                {t("cameras.remove")}
              </button>
            )}
          </div>
        </aside>
        <section className="main">
          <div className="player">
            <div>
              <h1>{camera?.name || draft.model}</h1>
              <p className="note">{camera ? `${camera.model} · ${camera.host || t("cameras.waiting")}` : t("cameras.empty")}</p>
            </div>
            <p className={ffmpegReady === false ? "status error" : "status"}>
              {ffmpegReady === false ? t("player.noEngine") : t("player.sameNetwork")}
            </p>
            <div className="controls">
              <button className="btn-primary" type="button" disabled={busy} onClick={() => void playOnCamera()}>
                {busy ? t("player.playing") : t("player.play")}
              </button>
              <button className="btn" type="button" disabled={!sound} onClick={preview}>
                {t("player.preview")}
              </button>
              <button className="btn" type="button" disabled={!busy} onClick={() => void stop()}>
                {t("player.stop")}
              </button>
              <label className="volume">
                {t("player.level", { value: volume })}
                <input
                  type="range"
                  min={0}
                  max={150}
                  value={volume}
                  onChange={(event) => setVolume(Number(event.target.value))}
                  aria-label={t("player.volume")}
                />
              </label>
            </div>
            <p className={tone ? `status ${tone}` : "status"}>{status}</p>
          </div>
          <section className="library">
            <div className="library-head">
              <p className="section-label">{t("library")}</p>
              <label className="btn">
                {t("library.add")}
                <input
                  hidden
                  type="file"
                  accept="audio/*,.mp3,.wav,.m4a,.ogg"
                  multiple
                  onChange={(event) => {
                    if (event.target.files) void addFiles(event.target.files);
                    event.target.value = "";
                  }}
                />
              </label>
            </div>
            <div
              className={hot ? "drop hot" : "drop"}
              onDragOver={(event) => {
                event.preventDefault();
                setHot(true);
              }}
              onDragLeave={() => setHot(false)}
              onDrop={(event) => {
                event.preventDefault();
                setHot(false);
                void addFiles(event.dataTransfer.files);
              }}
            >
              {t("library.drop")}
            </div>
            <div className="sound-list">
              {sounds.length === 0 && <p className="note">{t("library.empty")}</p>}
              {sounds.map((item) => (
                <div key={item.id} className={item.id === soundId ? "sound-row active" : "sound-row"}>
                  <button type="button" className="pick" onClick={() => setSoundId(item.id)}>
                    <strong>{labelFor(item)}</strong>
                    <span>{formatDuration(item.durationMs, t("library.unknownDuration"))}</span>
                  </button>
                  <button className="quiet" type="button" onClick={() => void removeSound(item.id)}>
                    {t("library.remove")}
                  </button>
                </div>
              ))}
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}

function formatDuration(durationMs: number, unknown: string) {
  if (!durationMs) return unknown;
  const total = Math.round(durationMs / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

async function durationOf(bytes: ArrayBuffer) {
  try {
    const context = new AudioContext();
    const audio = await context.decodeAudioData(bytes.slice(0));
    const durationMs = Math.round(audio.duration * 1000);
    await context.close();
    return durationMs;
  } catch {
    return 0;
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadSounds(): Promise<Sound[]> {
  const db = await openDb();
  const existing = await readAll(db);
  if (existing.length > 0) {
    db.close();
    return existing.sort((a, b) => b.createdAt - a.createdAt);
  }
  const presets = createPresets();
  for (const preset of presets) await writeSound(db, preset);
  db.close();
  return presets;
}

function readAll(db: IDBDatabase): Promise<Sound[]> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result as Sound[]);
    request.onerror = () => reject(request.error);
  });
}

function writeSound(db: IDBDatabase, sound: Sound) {
  return new Promise<void>((resolve, reject) => {
    const request = db.transaction(STORE, "readwrite").objectStore(STORE).put(sound);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function putSound(sound: Sound) {
  const db = await openDb();
  await writeSound(db, sound);
  db.close();
}

async function deleteSound(id: string) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(STORE, "readwrite").objectStore(STORE).delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  db.close();
}

function createPresets(): Sound[] {
  const now = Date.now();
  return [
    preset("Zil", synth([{ freq: 659, start: 0, dur: 0.18 }, { freq: 880, start: 0.2, dur: 0.28 }], 0.7), now),
    preset(
      "Uyarı",
      synth(
        [
          { freq: 740, start: 0, dur: 0.16, gain: 0.45 },
          { freq: 620, start: 0.2, dur: 0.16, gain: 0.45 },
          { freq: 494, start: 0.4, dur: 0.24, gain: 0.45 },
        ],
        0.8,
      ),
      now + 1,
    ),
    preset(
      "Hoş geldin",
      synth(
        [
          { freq: 523, start: 0, dur: 0.18 },
          { freq: 659, start: 0.16, dur: 0.18 },
          { freq: 784, start: 0.32, dur: 0.32 },
        ],
        0.85,
      ),
      now + 2,
    ),
  ];
}

function preset(name: string, samples: Float32Array, createdAt: number): Sound {
  const bytes = wavFromSamples(samples, 22050);
  return { id: `preset-${name}`, name, bytes, durationMs: Math.round((samples.length / 22050) * 1000), createdAt };
}

function synth(notes: { freq: number; start: number; dur: number; gain?: number }[], total: number) {
  const rate = 22050;
  const samples = new Float32Array(Math.floor(total * rate));
  for (const note of notes) {
    const from = Math.floor(note.start * rate);
    const length = Math.floor(note.dur * rate);
    for (let i = 0; i < length && from + i < samples.length; i++) {
      const envelope = Math.sin((Math.PI * i) / length);
      samples[from + i]! += Math.sin((2 * Math.PI * note.freq * i) / rate) * envelope * (note.gain ?? 0.35);
    }
  }
  return samples;
}

function wavFromSamples(samples: Float32Array, rate: number) {
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]!));
    pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  const buffer = new ArrayBuffer(44 + pcm.byteLength);
  const view = new DataView(buffer);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + pcm.byteLength, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, pcm.byteLength, true);
  new Uint8Array(buffer, 44).set(new Uint8Array(pcm.buffer));
  return buffer;
}
