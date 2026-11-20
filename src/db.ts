// Tiny IndexedDB wrapper. Everything stays on the phone.

export interface Segment { id: string; start: number; end: number; name: string; }
export interface Section { id: string; name: string; segments: Segment[]; }
export type Mode = 'simple' | 'complete';
export type StemKey = 'full' | 'inst' | 'vocals' | 'drums' | 'bass' | 'other';
export interface Song {
  id: string;
  title: string;
  mode: Mode;
  bpm: number;
  beatsPerBar: number;
  beatOffset: number | null; // song time (s) of a beat; null = not tapped yet
  duration: number;
  createdAt: number;
  sections: Section[];
  stems: Partial<Record<StemKey, string>>; // blob keys
  best: Record<string, string>; // unitKey -> takeId
  completed: Record<string, boolean>; // lessonKey -> done
}
export interface Take {
  id: string;
  songId: string;
  unitKey: string; // segment ids joined by '+'
  createdAt: number;
  rating: number | null;
  note: string;
  speed: number;
  step: number; // 0 Listen, 1 Copy, 2 Perform
  sampleRate: number;
  leadIn: number; // seconds of take audio before the unit's first moment
  length: number; // samples
  shift?: number; // manual sync correction in seconds (+ = play the take earlier)
  schema?: number;
}
export type Route = 'speaker' | 'wired' | 'bluetooth';
export interface Settings {
  lang: 'en' | 'fr' | null;
  route: Route;
  latency: Record<Route, number>; // ms
  cleanup: Record<Route, boolean>;
  micId: string;
  passStars: number;
  countIn: boolean;
  countVoice: boolean;
  ownCount: boolean;
  rotateHint: boolean;
  reminder: { on: boolean; hour: number; minute: number };
}
export interface Stats { days: Record<string, number>; } // yyyy-mm-dd -> seconds practised

const DB_NAME = 'rhythm-trainer';
let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('songs', { keyPath: 'id' });
      const takes = db.createObjectStore('takes', { keyPath: 'id' });
      takes.createIndex('songId', 'songId');
      db.createObjectStore('blobs');
      db.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name: string, mode: IDBTransactionMode = 'readonly') {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

// Songs
// Version 1 songs had { vocals, drums, inst: [bass?, other] } and no mode.
function migrateSong(s: Song | undefined): Song | undefined {
  if (!s) return s;
  const st = s.stems as unknown as { vocals?: string; drums?: string; inst?: string[] | string };
  if (Array.isArray(st.inst)) {
    const out: Partial<Record<StemKey, string>> = { vocals: st.vocals, drums: st.drums };
    for (const k of st.inst) out[k.endsWith(':bass') ? 'bass' : 'other'] = k;
    s.stems = out;
  }
  s.mode ??= 'complete';
  if (s.beatOffset === undefined) s.beatOffset = null;
  return s;
}
export async function getSongs(): Promise<Song[]> {
  const all = (await wrap((await store('songs')).getAll()) as Song[]).map((s) => migrateSong(s)!);
  return all.sort((a, b) => a.createdAt - b.createdAt);
}
export async function getSong(id: string): Promise<Song | undefined> {
  return migrateSong(await wrap((await store('songs')).get(id)) as Song | undefined);
}
export async function putSong(s: Song) { await wrap((await store('songs', 'readwrite')).put(s)); }
export const stemKeys = (s: Song) => Object.values(s.stems).filter((k): k is string => !!k);
export async function deleteSong(s: Song) {
  for (const k of stemKeys(s)) await deleteBlob(k);
  for (const t of await getTakes(s.id)) await deleteTake(t.id);
  await wrap((await store('songs', 'readwrite')).delete(s.id));
}

// Blobs (stems and take audio)
export async function putBlob(key: string, b: Blob) { await wrap((await store('blobs', 'readwrite')).put(b, key)); }
export async function getBlob(key: string): Promise<Blob | undefined> { return wrap((await store('blobs')).get(key)) as Promise<Blob | undefined>; }
export async function deleteBlob(key: string) { await wrap((await store('blobs', 'readwrite')).delete(key)); }
export async function allBlobKeys(): Promise<string[]> { return wrap((await store('blobs')).getAllKeys()) as Promise<string[]>; }

// Takes
// Version 1 had 4 steps (Listen, Copy, Listen full, Perform); version 2 has 3.
const V1_STEP = [0, 1, 0, 2];
function migrateTake(t: Take): Take {
  if (!t.schema) { t.step = V1_STEP[t.step] ?? 1; t.schema = 2; }
  return t;
}
export async function getTakes(songId: string): Promise<Take[]> {
  const s = await store('takes');
  const all = (await wrap(s.index('songId').getAll(songId)) as Take[]).map(migrateTake);
  return all.sort((a, b) => b.createdAt - a.createdAt);
}
export async function getAllTakes(): Promise<Take[]> { return ((await wrap((await store('takes')).getAll())) as Take[]).map(migrateTake); }
export async function putTake(t: Take) { await wrap((await store('takes', 'readwrite')).put(t)); }
export async function deleteTake(id: string) {
  await deleteBlob('take:' + id);
  await wrap((await store('takes', 'readwrite')).delete(id));
}

// Meta
async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const v = await wrap((await store('meta')).get(key));
  return (v as T) ?? fallback;
}
async function putMeta(key: string, v: unknown) { await wrap((await store('meta', 'readwrite')).put(v, key)); }

export const defaultSettings: Settings = {
  lang: null, route: 'speaker',
  latency: { speaker: 0, wired: 0, bluetooth: 200 },
  cleanup: { speaker: true, wired: false, bluetooth: false },
  micId: '', passStars: 4, countIn: true, countVoice: true, ownCount: false, rotateHint: true,
  reminder: { on: false, hour: 19, minute: 0 },
};
export async function getSettings(): Promise<Settings> {
  const s = await getMeta<Partial<Settings> & { latencyMs?: number }>('settings', {});
  const out: Settings = {
    ...defaultSettings, ...s,
    latency: { ...defaultSettings.latency, ...(s.latency ?? {}) },
    cleanup: { ...defaultSettings.cleanup, ...(s.cleanup ?? {}) },
    reminder: { ...defaultSettings.reminder, ...(s.reminder ?? {}) },
  };
  if (s.latencyMs != null && !s.latency) { out.latency.wired = s.latencyMs; out.route = 'wired'; } // from version 1
  delete (out as { latencyMs?: number }).latencyMs;
  return out;
}
export async function putSettings(s: Settings) { await putMeta('settings', s); }
export async function getStats(): Promise<Stats> { return getMeta<Stats>('stats', { days: {} }); }
export async function putStats(s: Stats) { await putMeta('stats', s); }
