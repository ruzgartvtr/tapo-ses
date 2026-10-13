import { useEffect, useRef, useState } from "react";

import { TAPO_MODELS, modelById } from "@/lib/models";

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
const DB_NAME = "tapo-ses";
const STORE = "sounds";

export function Studio() {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [sounds, setSounds] = useState<Sound[]>([]);
  const [soundId, setSoundId] = useState<string>("");
  const [volume, setVolume] = useState(100);
  const [ffmpegReady, setFfmpegReady] = useState<boolean | null>(null);
  const [status, setStatus] = useState("Hazır");
  const [tone, setTone] = useState<"ok" | "error" | "">("");
  const [busy, setBusy] = useState(false);
  const [hot, setHot] = useState(false);
  const [draft, setDraft] = useState({
    name: "Salon",
    model: "C210",
    host: "",
    password: "",
    passwordIsHash: false,
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
  const model = modelById(camera?.model || draft.model);

  function addCamera() {
    if (!draft.host.trim() || !draft.password) {
      setTone("error");
      setStatus("Kamera adresi ve bulut şifresi gerekli.");
      return;
    }
    const next: Camera = { id: crypto.randomUUID(), ...draft, name: draft.name.trim() || draft.model };
    setCameras((current) => [...current, next]);
    setSelectedId(next.id);
    setDraft((current) => ({ ...current, host: "", password: "" }));
    setTone("ok");
    setStatus(`${next.name} eklendi. Şifre yalnız bu bilgisayarda durur.`);
  }

  function removeCamera(id: string) {
    setCameras((current) => current.filter((item) => item.id !== id));
    if (selectedId === id) setSelectedId("");
  }

  async function addFiles(files: FileList | File[]) {
    const list = [...files].filter((file) => file.size > 0 && file.size <= 8_000_000);
    if (list.length === 0) {
      setTone("error");
      setStatus("Dosya boş ya da 8 MB üzerinde.");
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
    setStatus(`${created.length} ses kitaplığa alındı.`);
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
    setStatus("Önizleme bu bilgisayarın hoparlöründe.");
  }

  async function playOnCamera() {
    if (!camera || !sound) {
      setTone("error");
      setStatus("Önce bir kamera ve bir ses seç.");
      return;
    }
    if (!window.tapo) {
      setTone("error");
      setStatus("Ses motoru yalnız masaüstü uygulamasında çalışır.");
      return;
    }
    stopRequested.current = false;
    setBusy(true);
    setTone("");
    setStatus(`${camera.model} hoparlörüne gönderiliyor…`);
    try {
      const body = await window.tapo.play({
        host: camera.host,
        password: camera.password,
        passwordIsHash: camera.passwordIsHash,
        volume,
        file: new Uint8Array(sound.bytes),
      });
      if (stopRequested.current) {
        setTone("");
        setStatus("Çalma durduruldu.");
        return;
      }
      setTone("ok");
      const seconds = Math.round((body.durationMs ?? sound.durationMs) / 100) / 10;
      setStatus(
        body.truncated
          ? `${camera.name} ilk 90 saniyeyi çaldı.`
          : `${camera.name} sesi çaldı (${seconds} sn, PCMA 8 kHz).`,
      );
    } catch (error) {
      const raw = error instanceof Error ? error.message : "Ses çalınamadı";
      const message = raw.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
      if (stopRequested.current || message.includes("durduruldu")) {
        setTone("");
        setStatus("Çalma durduruldu.");
      } else {
        setTone("error");
        setStatus(message);
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
    setStatus("Çalma durduruldu.");
  }

  return (
    <main className="studio">
      <header className="topbar">
        <div>
          <div className="mark">
            <div className="mark-badge" aria-hidden>
              <svg width="22" height="22" viewBox="0 0 22 22">
                <circle cx="11" cy="11" r="8" stroke="#E7FF6A" fill="none" />
                <circle cx="11" cy="11" r="2.5" fill="#E7FF6A" />
              </svg>
            </div>
            <p className="eyebrow">Tapo Ses · C210</p>
          </div>
          <h1>Kameradan kendi sesin çıksın.</h1>
        </div>
        <p className="lede">
          Windows ve macOS uygulaması. MP3 dosyan C210 hoparlörünün anladığı biçime çevrilir ve kamerayla aynı ağdan çalar.
        </p>
      </header>

      <p className={ffmpegReady === false ? "status error" : "status"} role="status">
        {ffmpegReady === false
          ? "Ses motoru bulunamadı. Uygulamayı yeniden kur."
          : "Bilgisayar kamerayla aynı ev ağında olmalı."}
      </p>

      <section className="stage">
        <aside className="camera-col">
          <div className="row">
            <p className="label">Kameralar</p>
            <span className="meta">{cameras.length}</span>
          </div>
          <div className="camera-list">
            {cameras.map((item) => (
              <button
                key={item.id}
                type="button"
                className={item.id === selectedId ? "camera-card active" : "camera-card"}
                onClick={() => setSelectedId(item.id)}
              >
                <span className="chip">{item.model}</span>
                <strong>{item.name}</strong>
                <span className="meta">{item.host}</span>
              </button>
            ))}
            {cameras.length === 0 && <p className="note">Henüz kamera yok. C210 ile başla.</p>}
          </div>
          <div className="camera-form">
            <label className="field">
              <span>Ad</span>
              <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </label>
            <label className="field">
              <span>Model</span>
              <select value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })}>
                {TAPO_MODELS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                    {item.featured ? " · öncelikli" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Adres</span>
              <input
                value={draft.host}
                placeholder="192.168.1.40"
                onChange={(event) => setDraft({ ...draft, host: event.target.value })}
              />
            </label>
            <label className="field">
              <span>Bulut şifresi</span>
              <input
                type="password"
                value={draft.password}
                autoComplete="new-password"
                onChange={(event) => setDraft({ ...draft, password: event.target.value })}
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={draft.passwordIsHash}
                onChange={(event) => setDraft({ ...draft, passwordIsHash: event.target.checked })}
              />
              Şifre zaten MD5 veya SHA256 özeti
            </label>
            <div className="actions">
              <button className="primary" type="button" onClick={addCamera}>
                Kamerayı ekle
              </button>
              {camera && (
                <button className="ghost" type="button" onClick={() => removeCamera(camera.id)}>
                  Sil
                </button>
              )}
            </div>
          </div>
        </aside>

        <div className="well">
          <div className="well-head">
            <div>
              <span className="chip">{model.id === "C210" ? "Öncelikli model" : model.label}</span>
              <h2>{camera?.name || "C210"}</h2>
              <p className="note">{model.blurb}</p>
            </div>
            <p className="meta">{camera?.host || "Adres bekleniyor"}</p>
          </div>

          <div className={busy ? "device live" : "device"} aria-hidden>
            <CameraGlyph />
          </div>

          <div>
            <div className="actions">
              <button className="primary" type="button" disabled={busy} onClick={() => void playOnCamera()}>
                {busy ? "Çalıyor…" : "Kamerada çal"}
              </button>
              <button className="copper" type="button" disabled={!sound} onClick={preview}>
                Önizle
              </button>
              <button className="ghost" type="button" disabled={!busy} onClick={() => void stop()}>
                Durdur
              </button>
              <label className="field volume">
                <span>Seviye {volume}</span>
                <input
                  type="range"
                  min={0}
                  max={150}
                  value={volume}
                  onChange={(event) => setVolume(Number(event.target.value))}
                  aria-label="Ses seviyesi"
                />
              </label>
            </div>
            <p className={tone ? `status ${tone}` : "status"}>{status}</p>
          </div>
        </div>
      </section>

      <section className="library">
        <div className="library-head">
          <div>
            <p className="eyebrow">Kitaplık</p>
            <h2 className="display" style={{ margin: 0, fontSize: 32 }}>
              Özel sesler
            </h2>
          </div>
          <label className="copper" style={{ display: "inline-block" }}>
            MP3 yükle
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
          MP3, WAV, M4A veya OGG bırak. C210 bunu 8 kHz A-law olarak duyar; kısa anonslar en temiz sonucu verir.
        </div>
        <div className="sounds">
          {sounds.map((item) => (
            <article key={item.id} className={item.id === soundId ? "sound-card selected" : "sound-card"}>
              <button type="button" className="pick" onClick={() => setSoundId(item.id)}>
                <strong>{item.name}</strong>
                <span className="meta">{formatDuration(item.durationMs)}</span>
              </button>
              <button className="text-btn" type="button" onClick={() => void removeSound(item.id)}>
                Kaldır
              </button>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function CameraGlyph() {
  return (
    <svg viewBox="0 0 320 320" role="img" aria-label="Tapo C210">
      <rect x="78" y="46" width="164" height="228" rx="82" fill="#ece7df" />
      <rect x="96" y="64" width="128" height="150" rx="64" fill="#1b1d18" />
      <circle className="ring" cx="160" cy="132" r="46" fill="none" stroke="#E7FF6A" strokeWidth="3" strokeDasharray="8 10" />
      <circle cx="160" cy="132" r="28" fill="#2a2e26" />
      <circle className="pupil" cx="160" cy="132" r="12" fill="#E7FF6A" />
      <circle cx="168" cy="124" r="4" fill="#fff8" />
      <rect x="132" y="214" width="56" height="8" rx="4" fill="#c8c2b6" />
      <rect x="118" y="236" width="84" height="18" rx="9" fill="#d7d1c6" />
    </svg>
  );
}

function formatDuration(durationMs: number) {
  if (!durationMs) return "Süre bilinmiyor";
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
