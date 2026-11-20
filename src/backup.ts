import { zipSync, unzipSync, strToU8, strFromU8, type Zippable } from 'fflate';
import { getSongs, getAllTakes, getSettings, getStats, getBlob, putSong, putTake, putBlob, putSettings, putStats, stemKeys, allBlobKeys, type Song, type Take } from './db';
import { t } from './i18n';
import { shareFile } from './native';

interface Manifest { version: 1; createdAt: number; songs: Song[]; takes: Take[]; settings: unknown; stats: unknown; withStems: boolean; }

const safe = (k: string) => k.replace(/[^a-zA-Z0-9_.-]/g, '_');

export async function exportBackup(withStems: boolean) {
  const songs = await getSongs();
  const takes = await getAllTakes();
  const files: Zippable = {};
  const blobMap: Record<string, string> = {};
  const add = async (key: string) => {
    const b = await getBlob(key);
    if (!b) return;
    const path = 'blobs/' + safe(key);
    blobMap[path] = key;
    files[path] = [new Uint8Array(await b.arrayBuffer()), { level: 0 }];
  };
  for (const tk of takes) await add('take:' + tk.id);
  for (const k of await allBlobKeys()) if (k.startsWith('count:own:')) await add(k);
  if (withStems) for (const s of songs) for (const k of stemKeys(s)) await add(k);
  const manifest: Manifest & { blobMap: Record<string, string> } = {
    version: 1, createdAt: Date.now(), songs, takes,
    settings: await getSettings(), stats: await getStats(), withStems, blobMap,
  };
  files['manifest.json'] = strToU8(JSON.stringify(manifest));
  const zip = zipSync(files);
  const d = new Date();
  const name = `rhythm-backup-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.zip`;
  await shareFile(name, new Blob([zip], { type: 'application/zip' }), 'Rhythm Trainer backup');
}

export async function importBackup(file: File): Promise<string> {
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const raw = files['manifest.json'];
  if (!raw) throw new Error(t('notBackup'));
  const m = JSON.parse(strFromU8(raw)) as Manifest & { blobMap: Record<string, string> };
  for (const [path, key] of Object.entries(m.blobMap)) {
    const data = files[path];
    if (data) await putBlob(key, new Blob([data.slice()], { type: key.startsWith('take:') ? 'audio/wav' : 'application/octet-stream' }));
  }
  for (const s of m.songs) await putSong(s);
  for (const tk of m.takes) await putTake(tk);
  const cur = await getSettings();
  await putSettings({ ...(m.settings as object), lang: (m.settings as { lang?: string }).lang ?? cur.lang } as never);
  await putStats(m.stats as never);
  return t(m.withStems ? 'restored' : 'restoredNoStems', { s: m.songs.length, t: m.takes.length });
}
