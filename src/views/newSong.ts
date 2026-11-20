import { getSong, putSong, putBlob, deleteBlob, uid, type Song, type Mode, type StemKey } from '../db';
import { decodeBlob, clearStemCache } from '../audio';
import { h, go, setBar, toast, filePicker, tabs } from '../ui';
import { t, tl } from '../i18n';

const FILES: Record<Mode, { key: StemKey; label: Parameters<typeof t>[0]; required: boolean }[]> = {
  simple: [
    { key: 'full', label: 'fileFull', required: true },
    { key: 'inst', label: 'fileInst', required: true },
  ],
  complete: [
    { key: 'vocals', label: 'fileVocals', required: true },
    { key: 'drums', label: 'fileDrums', required: true },
    { key: 'bass', label: 'fileBass', required: false },
    { key: 'other', label: 'fileOther', required: true },
  ],
};

export function stemGuide(): HTMLElement {
  const steps = (items: string[]) => h('ol', { class: 'guide' }, ...items.map((s) => h('li', null, s)));
  return h('details', { class: 'card guide-box' },
    h('summary', null, t('howToGet')),
    h('p', { class: 'small' }, t('guideIntro')),
    h('h3', null, '📱 ' + t('guideMoisesTitle')),
    steps(tl('guideMoisesSteps')),
    h('p', { class: 'small' }, h('a', { href: 'https://moises.ai', target: '_blank', rel: 'noopener' }, 'moises.ai')),
    h('h3', null, '💻 ' + t('guideUvrTitle')),
    steps(tl('guideUvrSteps')),
    h('p', { class: 'small' },
      h('a', { href: 'https://ultimatevocalremover.com', target: '_blank', rel: 'noopener' }, 'ultimatevocalremover.com'), ' · ',
      h('a', { href: 'https://github.com/Anjok07/ultimatevocalremovergui', target: '_blank', rel: 'noopener' }, 'GitHub (Linux)')),
  );
}

// Used both to add a song and (with an id) to change its details or replace its files.
export async function newSongView(root: HTMLElement, id?: string) {
  const existing = id ? await getSong(id) : undefined;
  setBar(existing ? t('songDetails') : t('addSongTitle'), existing ? `/edit/${existing.id}` : '/');
  let mode: Mode = existing?.mode ?? 'simple';
  const files: Partial<Record<StemKey, File>> = {};
  const title = h('input', { type: 'text', placeholder: t('songNamePh'), value: existing?.title ?? '' }) as HTMLInputElement;
  const bpm = h('input', { type: 'number', min: '30', max: '300', value: String(existing?.bpm ?? 100) }) as HTMLInputElement;
  const bpb = h('input', { type: 'number', min: '1', max: '8', value: String(existing?.beatsPerBar ?? 4) }) as HTMLInputElement;

  const filesBox = h('div');
  const modeDesc = h('p', { class: 'muted small' });
  const drawFiles = () => {
    modeDesc.textContent = t(mode === 'simple' ? 'simpleDesc' : 'completeDesc');
    filesBox.replaceChildren(...FILES[mode].map((f) => filePicker(t(f.label), 'audio/*,.wav,.mp3,.flac,.m4a,.ogg',
      (file) => { files[f.key] = file; },
      files[f.key]?.name ?? (existing?.stems[f.key] ? t('keepFile') : undefined))));
  };
  drawFiles();

  const save = h('button', { class: 'full' }, existing ? t('save') : t('next')) as HTMLButtonElement;
  save.addEventListener('click', async () => {
    const name = title.value.trim();
    if (!name) { toast(t('needName')); return; }
    const missing = FILES[mode].some((f) => f.required && !files[f.key] && !existing?.stems[f.key]);
    if (missing) { toast(t(mode === 'simple' ? 'needFilesSimple' : 'needFilesComplete')); return; }
    save.disabled = true;
    save.textContent = t('saving');
    try {
      const song: Song = existing ?? {
        id: uid(), title: name, mode, bpm: 100, beatsPerBar: 4, beatOffset: null, duration: 0, createdAt: Date.now(),
        sections: [], stems: {}, best: {}, completed: {},
      };
      song.title = name;
      song.mode = mode;
      song.bpm = Math.max(30, Math.min(300, Number(bpm.value) || 100));
      song.beatsPerBar = Math.max(1, Math.min(8, Math.round(Number(bpb.value) || 4)));
      // Drop files that don't belong to the chosen mode.
      for (const k of Object.keys(song.stems) as StemKey[]) {
        if (!FILES[mode].some((f) => f.key === k)) { await deleteBlob(song.stems[k]!); delete song.stems[k]; }
      }
      let duration = 0;
      for (const f of FILES[mode]) {
        const file = files[f.key];
        if (!file) continue;
        const buf = await decodeBlob(file); // also checks the file is readable
        duration = Math.max(duration, buf.duration);
        const key = `stem:${song.id}:${f.key}`;
        await putBlob(key, file);
        song.stems[f.key] = key;
      }
      if (duration) song.duration = duration;
      await putSong(song);
      clearStemCache();
      go(existing ? `/edit/${song.id}` : `/tap/${song.id}`);
    } catch (e) {
      console.error(e);
      toast(t('badFile'));
      save.disabled = false;
      save.textContent = existing ? t('save') : t('next');
    }
  });

  root.append(h('div', { class: 'card' },
    h('label', { class: 'field' }, t('songName')), title,
    h('label', { class: 'field' }, t('setupMode')),
    tabs<Mode>([{ id: 'simple', label: t('simple') }, { id: 'complete', label: t('complete') }], mode, (m) => { mode = m; drawFiles(); }),
    modeDesc,
  ));
  root.append(stemGuide());
  root.append(h('div', { class: 'card' },
    existing ? h('h3', { style: 'margin-top:0' }, t('replaceFiles')) : null,
    filesBox,
  ));
  root.append(h('div', { class: 'card' },
    h('div', { class: 'row' },
      h('div', { class: 'grow' }, h('label', { class: 'field' }, t('tempo')), bpm),
      h('div', { style: 'width:130px' }, h('label', { class: 'field' }, t('beatsPerBar')), bpb)),
    h('p', { class: 'muted small' }, t('tempoHint')),
  ));
  root.append(h('div', { style: 'margin-top:14px' }, save));
}
