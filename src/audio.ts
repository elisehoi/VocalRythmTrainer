import { SoundTouch, SimpleFilter, WebAudioBufferSource } from 'soundtouchjs';
import { getBlob, type Song, type Take, type StemKey, type Settings } from './db';
import { getLang } from './i18n';

let _ctx: AudioContext | null = null;
export function ctx(): AudioContext {
  if (!_ctx) _ctx = new AudioContext({ latencyHint: 'interactive' });
  if (_ctx.state === 'suspended') void _ctx.resume();
  return _ctx;
}

export async function decodeBlob(b: Blob): Promise<AudioBuffer> {
  return ctx().decodeAudioData(await b.arrayBuffer());
}

// ---------- Song stems ----------
export type Stems = Partial<Record<StemKey, AudioBuffer>>;
let cache: { id: string; stems: Stems } | null = null;
const unitCache = new Map<string, Stems>();

export function clearStemCache() { cache = null; unitCache.clear(); }

export class StemMissingError extends Error {}

export async function loadStems(song: Song): Promise<Stems> {
  if (cache?.id === song.id) return cache.stems;
  unitCache.clear();
  const stems: Stems = {};
  for (const [name, key] of Object.entries(song.stems) as [StemKey, string | undefined][]) {
    if (!key) continue;
    const b = await getBlob(key);
    if (!b) throw new StemMissingError(name);
    stems[name] = await decodeBlob(b);
  }
  cache = { id: song.id, stems };
  return stems;
}

/** The longest stem decides the song length. */
export const stemsDuration = (s: Stems) => Math.max(0, ...Object.values(s).map((b) => b?.duration ?? 0));

export function slice(b: AudioBuffer, start: number, end: number): AudioBuffer {
  const sr = b.sampleRate;
  const s = Math.max(0, Math.floor(start * sr));
  const e = Math.min(b.length, Math.ceil(end * sr));
  const out = ctx().createBuffer(b.numberOfChannels, Math.max(1, e - s), sr);
  for (let c = 0; c < b.numberOfChannels; c++) out.getChannelData(c).set(b.getChannelData(c).subarray(s, e));
  return out;
}

// Time-stretch without changing pitch.
export function stretch(b: AudioBuffer, speed: number): AudioBuffer {
  if (speed === 1) return b;
  let src = b;
  if (b.numberOfChannels < 2) { // SoundTouch reads two channels
    src = ctx().createBuffer(2, b.length, b.sampleRate);
    src.getChannelData(0).set(b.getChannelData(0));
    src.getChannelData(1).set(b.getChannelData(0));
  }
  const st = new SoundTouch();
  st.tempo = speed;
  const filter = new SimpleFilter(new WebAudioBufferSource(src), st);
  const outLen = Math.ceil(b.length / speed) + 8192;
  const L = new Float32Array(outLen), R = new Float32Array(outLen);
  const chunk = 4096;
  const tmp = new Float32Array(chunk * 2);
  let pos = 0;
  for (;;) {
    const n = filter.extract(tmp, chunk);
    if (n <= 0) break;
    for (let i = 0; i < n && pos < outLen; i++, pos++) { L[pos] = tmp[i * 2]; R[pos] = tmp[i * 2 + 1]; }
    if (pos >= outLen) break;
  }
  const out = ctx().createBuffer(2, Math.max(1, pos), b.sampleRate);
  out.getChannelData(0).set(L.subarray(0, pos));
  out.getChannelData(1).set(R.subarray(0, pos));
  return out;
}

export function unitStems(stems: Stems, start: number, end: number, speed: number): Stems {
  const k = `${start.toFixed(3)}-${end.toFixed(3)}x${speed}`;
  const hit = unitCache.get(k);
  if (hit) return hit;
  const u: Stems = {};
  for (const [name, b] of Object.entries(stems) as [StemKey, AudioBuffer | undefined][]) {
    if (b) u[name] = stretch(slice(b, start, end), speed);
  }
  unitCache.set(k, u);
  return u;
}

// ---------- Beat grid ----------
export interface Grid { beat: number; offset: number; perBar: number; }
export const gridFor = (song: Song): Grid => ({ beat: 60 / song.bpm, offset: song.beatOffset ?? 0, perBar: song.beatsPerBar });
export function beatsBetween(g: Grid, a: number, b: number): number[] {
  const out: number[] = [];
  let n = Math.ceil((a - g.offset) / g.beat - 1e-6);
  for (let t = g.offset + n * g.beat; t < b; n++, t = g.offset + n * g.beat) out.push(t);
  return out;
}
/** Count-in: perBar beats just before the first beat at or after the line start. */
export function countInTimes(g: Grid, lineStart: number): number[] {
  const first = g.offset + Math.ceil((lineStart - 0.03 - g.offset) / g.beat) * g.beat;
  const out: number[] = [];
  for (let i = g.perBar; i >= 1; i--) out.push(first - i * g.beat);
  return out;
}

// ---------- Clicks and spoken count ----------
const clickCache = new Map<string, AudioBuffer>();
export function click(accent: boolean): AudioBuffer {
  const key = accent ? 'a' : 'b';
  const hit = clickCache.get(key);
  if (hit) return hit;
  const c = ctx();
  const len = Math.floor(c.sampleRate * 0.05);
  const b = c.createBuffer(1, len, c.sampleRate);
  const d = b.getChannelData(0);
  const f = accent ? 1600 : 1100;
  for (let i = 0; i < len; i++) d[i] = Math.sin((2 * Math.PI * f * i) / c.sampleRate) * Math.exp(-i / (len / 6)) * 0.6;
  clickCache.set(key, b);
  return b;
}

let words: { key: string; bufs: AudioBuffer[] } | null = null;
export function resetCountWords() { words = null; }
async function countWords(own: boolean): Promise<AudioBuffer[]> {
  const key = own ? 'own' : getLang();
  if (words?.key === key) return words.bufs;
  const bufs: AudioBuffer[] = [];
  for (let i = 1; i <= 8; i++) {
    let blob: Blob | undefined;
    if (own) blob = await getBlob(`count:own:${i}`);
    if (!blob) {
      const r = await fetch(`./count/${getLang()}${i}.wav`);
      blob = await r.blob();
    }
    bufs.push(await decodeBlob(blob));
  }
  words = { key, bufs };
  return bufs;
}

// ---------- Playback ----------
export interface PlayTrack { key: string; buffer: AudioBuffer; offset?: number; group?: string; }
export interface PlayOpts {
  tracks: PlayTrack[];
  on: Record<string, boolean>; // track keys, group names and 'metro'
  duration: number; // seconds of the unit at this speed
  countIn?: { times: number[]; voice: boolean; own: boolean } | null; // times relative to t0 (negative)
  metro?: { times: number[]; group?: string } | null; // clicks during the unit, relative to t0
  tail?: number;
}
export interface Playing {
  t0: number;
  duration: number;
  setOn(key: string, on: boolean): void;
  stop(): void;
  done: Promise<void>;
}

export async function play(o: PlayOpts): Promise<Playing> {
  const c = ctx();
  const voice = o.countIn?.voice ? await countWords(o.countIn.own) : null;
  const earliest = Math.min(0, ...(o.countIn?.times ?? [0]));
  const t0 = c.currentTime + 0.15 - earliest;
  const sources: AudioScheduledSourceNode[] = [];
  const gains = new Map<string, GainNode>();
  const gainFor = (key: string, parent: AudioNode): GainNode => {
    let g = gains.get(key);
    if (!g) {
      g = c.createGain();
      g.gain.value = o.on[key] === false ? 0 : 1;
      g.connect(parent);
      gains.set(key, g);
    }
    return g;
  };
  const out = (group?: string) => (group ? gainFor(group, c.destination) : c.destination);

  // Count-in (always audible)
  o.countIn?.times.forEach((t, i) => {
    const s = c.createBufferSource();
    s.buffer = voice ? voice[i % voice.length] : click(i === 0);
    s.connect(c.destination);
    s.start(t0 + t);
    sources.push(s);
  });
  // Metronome during the unit
  if (o.metro) {
    const g = gainFor('metro', out(o.metro.group));
    o.metro.times.forEach((t, i) => {
      const s = c.createBufferSource();
      s.buffer = click(i === 0);
      s.connect(g);
      s.start(t0 + t);
      sources.push(s);
    });
  }
  for (const tr of o.tracks) {
    const g = gainFor(tr.key, out(tr.group));
    const s = c.createBufferSource();
    s.buffer = tr.buffer;
    s.connect(g);
    const off = tr.offset ?? 0;
    if (off >= 0) s.start(t0, off); else s.start(t0 - off);
    sources.push(s);
  }
  const total = t0 - c.currentTime + o.duration + (o.tail ?? 0);
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((r) => { resolveDone = r; });
  const timer = window.setTimeout(() => resolveDone(), total * 1000);
  return {
    t0,
    duration: o.duration,
    setOn(key, on) { gains.get(key)?.gain.setTargetAtTime(on ? 1 : 0, c.currentTime, 0.01); },
    stop() {
      for (const s of sources) { try { s.stop(); } catch { /* already stopped */ } }
      window.clearTimeout(timer);
      resolveDone();
    },
    done,
  };
}

// ---------- Microphone ----------
interface MicCfg { cleanup: boolean; micId: string; }
let mic: { cfg: MicCfg; stream: MediaStream; src: MediaStreamAudioSourceNode; cap: AudioWorkletNode; an: AnalyserNode } | null = null;
let workletLoaded = false;

export async function openMic(cfg: MicCfg): Promise<void> {
  const c = ctx();
  if (mic && mic.cfg.cleanup === cfg.cleanup && mic.cfg.micId === cfg.micId && mic.stream.active) return;
  closeMic();
  if (!workletLoaded) {
    await c.audioWorklet.addModule('./capture-worklet.js');
    workletLoaded = true;
  }
  const audio: MediaTrackConstraints = {
    echoCancellation: cfg.cleanup, noiseSuppression: cfg.cleanup, autoGainControl: cfg.cleanup, channelCount: 1,
  };
  if (cfg.micId) audio.deviceId = { exact: cfg.micId };
  let stream: MediaStream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio }); }
  catch (e) {
    if (!cfg.micId) throw e;
    delete audio.deviceId; // chosen mic is gone: use the default one
    stream = await navigator.mediaDevices.getUserMedia({ audio });
  }
  const src = c.createMediaStreamSource(stream);
  const cap = new AudioWorkletNode(c, 'capture', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
  const an = c.createAnalyser();
  an.fftSize = 1024;
  const silent = c.createGain();
  silent.gain.value = 0;
  src.connect(cap);
  src.connect(an);
  cap.connect(silent);
  silent.connect(c.destination);
  mic = { cfg: { ...cfg }, stream, src, cap, an };
}

export function closeMic() {
  if (!mic) return;
  mic.stream.getTracks().forEach((t) => t.stop());
  mic.src.disconnect();
  mic.cap.disconnect();
  mic = null;
}

/** 0..1 input level, for the live meter. */
export function micLevel(): number {
  if (!mic) return 0;
  const d = new Float32Array(mic.an.fftSize);
  mic.an.getFloatTimeDomainData(d);
  let m = 0;
  for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
  return Math.min(1, m * 1.4);
}

export async function listMics(): Promise<{ id: string; label: string }[]> {
  const devs = await navigator.mediaDevices.enumerateDevices();
  return devs.filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default')
    .map((d) => ({ id: d.deviceId, label: d.label }));
}

export interface CaptureResult { data: Float32Array; firstTime: number; backup: boolean; }
export interface Capture { stop(): Promise<CaptureResult>; }

const peakOf = (d: Float32Array) => { let m = 0; for (let i = 0; i < d.length; i += 4) m = Math.max(m, Math.abs(d[i])); return m; };

// Records through the AudioWorklet (sample-accurate timing). A MediaRecorder runs alongside as a
// backup in case the worklet path delivers silence on some phones.
export async function startCapture(cfg: MicCfg): Promise<Capture> {
  await openMic(cfg);
  const m = mic!;
  const c = ctx();
  const chunks: Float32Array[] = [];
  let firstFrame = -1;
  let resolveStop: (v: { data: Float32Array; firstTime: number }) => void = () => {};
  m.cap.port.onmessage = (e) => {
    const msg = e.data;
    if (msg.type === 'data') {
      if (firstFrame < 0) firstFrame = msg.frame;
      chunks.push(msg.data);
    } else if (msg.type === 'stopped') {
      const len = chunks.reduce((a, b) => a + b.length, 0);
      const data = new Float32Array(len);
      let o = 0;
      for (const ch of chunks) { data.set(ch, o); o += ch.length; }
      resolveStop({ data, firstTime: Math.max(0, firstFrame) / c.sampleRate });
    }
  };
  let rec: MediaRecorder | null = null;
  const recChunks: Blob[] = [];
  let recStart = 0;
  try {
    rec = new MediaRecorder(m.stream);
    rec.ondataavailable = (e) => { if (e.data.size) recChunks.push(e.data); };
    rec.onstart = () => { recStart = c.currentTime; };
    recStart = c.currentTime;
    rec.start();
  } catch { rec = null; }
  m.cap.port.postMessage('start');
  return {
    stop: async () => {
      const main = await new Promise<{ data: Float32Array; firstTime: number }>((r) => { resolveStop = r; m.cap.port.postMessage('stop'); });
      let backupData: Float32Array | null = null;
      if (rec && rec.state !== 'inactive') {
        await new Promise<void>((r) => { rec!.onstop = () => r(); rec!.stop(); });
        if (peakOf(main.data) < 1e-4 && recChunks.length) {
          try {
            const b = await decodeBlob(new Blob(recChunks, { type: rec.mimeType }));
            backupData = b.getChannelData(0);
          } catch { /* no usable backup */ }
        }
      }
      if (backupData && peakOf(backupData) > 1e-4) return { data: backupData, firstTime: recStart, backup: true };
      return { ...main, backup: false };
    },
  };
}

/** Scale a take so its loudest point sits just below full scale (max ×20). */
export function normalize(d: Float32Array): Float32Array {
  const p = peakOf(d);
  if (p < 1e-4) return d;
  const g = Math.min(20, 0.89 / p);
  const out = new Float32Array(d.length);
  for (let i = 0; i < d.length; i++) out[i] = d[i] * g;
  return out;
}

// ---------- Latency calibration ----------
// Plays clicks and measures when they come back through the mic (cleanup off, or it would cancel them).
export async function calibrate(micId: string): Promise<number | null> {
  const c = ctx();
  const cap = await startCapture({ cleanup: false, micId });
  const times: number[] = [];
  const base = c.currentTime + 0.6;
  for (let i = 0; i < 8; i++) {
    const s = c.createBufferSource();
    s.buffer = click(true);
    s.connect(c.destination);
    const t = base + i * 0.6;
    s.start(t);
    times.push(t);
  }
  await new Promise((r) => setTimeout(r, (base - c.currentTime + 8 * 0.6 + 0.7) * 1000));
  const { data, firstTime } = await cap.stop();
  closeMic();
  const sr = c.sampleRate;
  const delays: number[] = [];
  for (const t of times) {
    const from = Math.floor((t - firstTime) * sr);
    const to = Math.min(data.length, from + Math.floor(0.5 * sr));
    if (from < 0 || from >= data.length) continue;
    let max = 0;
    for (let i = from; i < to; i++) max = Math.max(max, Math.abs(data[i]));
    if (max < 0.01) continue;
    const thr = max * 0.3;
    for (let i = from; i < to; i++) {
      if (Math.abs(data[i]) >= thr) { delays.push((i - from) / sr); break; }
    }
  }
  if (delays.length < 5) return null;
  delays.sort((a, b) => a - b);
  const med = delays[Math.floor(delays.length / 2)];
  const spread = delays[delays.length - 2] - delays[1];
  if (spread > 0.04) return null;
  return Math.round(med * 1000);
}

export const micCfg = (s: Settings): MicCfg => ({ cleanup: s.cleanup[s.route], micId: s.micId });

// ---------- Waveform ----------
export function drawWave(canvas: HTMLCanvasElement, b: AudioBuffer | null, opts: { offset?: number; span: number; color: string; playhead?: number | null }) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth * dpr, h = canvas.clientHeight * dpr;
  if (!w || !h) return;
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const g = canvas.getContext('2d')!;
  g.clearRect(0, 0, w, h);
  if (b) {
    const d = b.getChannelData(0);
    const sr = b.sampleRate;
    const off = opts.offset ?? 0;
    let peak = 0.001;
    for (let i = 0; i < d.length; i += 64) peak = Math.max(peak, Math.abs(d[i]));
    g.fillStyle = opts.color;
    const step = Math.max(2 * dpr, 3);
    for (let x = 0; x < w; x += step) {
      const t0 = off + (x / w) * opts.span, t1 = off + ((x + step) / w) * opts.span;
      const i0 = Math.floor(t0 * sr), i1 = Math.floor(t1 * sr);
      let m = 0;
      for (let i = Math.max(0, i0); i < Math.min(d.length, i1); i += 8) m = Math.max(m, Math.abs(d[i]));
      const bh = Math.max(dpr, (m / peak) * (h * 0.9));
      g.fillRect(x, (h - bh) / 2, step - dpr, bh);
    }
  }
  if (opts.playhead != null && opts.playhead >= 0) {
    g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#000';
    g.fillRect((opts.playhead / opts.span) * w, 0, 2 * dpr, h);
  }
}

// ---------- Take audio ----------
export async function takeBuffer(t: Take): Promise<AudioBuffer | null> {
  const b = await getBlob('take:' + t.id);
  return b ? decodeBlob(b) : null;
}
export const takeOffset = (t: Take) => t.leadIn + (t.shift ?? 0);
