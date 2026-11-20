import { getSong, getTakes, type Song, type Take, type StemKey } from '../db';
import { ctx, loadStems, takeBuffer, takeOffset, StemMissingError, type Stems } from '../audio';
import { allSegments, segName } from '../lessons';
import { bufferToWav } from '../wav';
import { shareFile } from '../native';
import { addPractice } from '../stats';
import { h, go, setBar, toast, fmt } from '../ui';
import { t } from '../i18n';

const FADE = 0.015;
type Best = Map<string, { take: Take; buf: AudioBuffer }>;

// Builds the run-through: for every line either your best take or the original voice, over the background.
function schedule(c: BaseAudioContext, song: Song, stems: Stems, best: Best, at: number, duration: number) {
  const sources: AudioScheduledSourceNode[] = [];
  const clip = (buf: AudioBuffer | undefined, from: number, to: number, bufOffset = from) => {
    if (!buf || to - from < 0.01) return;
    const g = c.createGain();
    g.connect(c.destination);
    const t0 = at + from, dur = to - from;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(1, t0 + FADE);
    g.gain.setValueAtTime(1, t0 + dur - FADE);
    g.gain.linearRampToValueAtTime(0, t0 + dur);
    const s = c.createBufferSource();
    s.buffer = buf;
    s.connect(g);
    if (bufOffset >= 0) s.start(t0, bufOffset, dur); else s.start(t0 - bufOffset, 0, dur + bufOffset);
    sources.push(s);
  };
  const full: StemKey[] = song.mode === 'simple' ? ['full'] : ['vocals', 'drums', 'bass', 'other'];
  const bg: StemKey[] = song.mode === 'simple' ? ['inst'] : ['drums', 'bass', 'other'];
  const segs = allSegments(song).sort((a, b) => a.start - b.start);
  if (!segs.length) return sources;
  // Before the first line and after the last one: the original song.
  for (const k of full) { clip(stems[k], 0, segs[0].start); clip(stems[k], segs[segs.length - 1].end, duration); }
  for (const seg of segs) {
    const mine = best.get(seg.id);
    if (mine) {
      for (const k of bg) clip(stems[k], seg.start, seg.end);
      clip(mine.buf, seg.start, seg.end, takeOffset(mine.take));
    } else {
      for (const k of full) clip(stems[k], seg.start, seg.end);
    }
  }
  return sources;
}

export async function libraryView(root: HTMLElement, id: string) {
  const song = await getSong(id);
  if (!song) { go('/'); return; }
  setBar(t('libTitle'), `/song/${id}`);
  const takes = await getTakes(song.id);
  const segs = allSegments(song);
  const best: Best = new Map();
  for (const seg of segs) {
    const tk = takes.find((x) => x.id === song.best[seg.id] && x.speed === 1);
    if (tk) { const buf = await takeBuffer(tk); if (buf) best.set(seg.id, { take: tk, buf }); }
  }
  let sources: AudioScheduledSourceNode[] = [];
  let timer = 0;
  const playBtn = h('button', { class: 'full' }, t('libPlay')) as HTMLButtonElement;
  const stop = () => { sources.forEach((s) => { try { s.stop(); } catch { /* */ } }); sources = []; window.clearTimeout(timer); playBtn.textContent = t('libPlay'); };
  const load = async () => {
    try { return await loadStems(song); } catch (e) { toast(e instanceof StemMissingError ? t('stemMissing') : (e as Error).message); return null; }
  };
  playBtn.addEventListener('click', async () => {
    if (sources.length) { stop(); return; }
    const stems = await load();
    if (!stems) return;
    const c = ctx();
    sources = schedule(c, song, stems, best, c.currentTime + 0.2, song.duration);
    playBtn.textContent = t('libStop');
    const started = performance.now();
    timer = window.setTimeout(() => { addPractice((performance.now() - started) / 1000); stop(); }, (song.duration + 0.5) * 1000);
  });
  const exportBtn = h('button', { class: 'secondary full', style: 'margin-top:10px' }, t('libExport')) as HTMLButtonElement;
  exportBtn.addEventListener('click', async () => {
    const stems = await load();
    if (!stems) return;
    exportBtn.disabled = true;
    exportBtn.textContent = t('rendering');
    try {
      const sr = ctx().sampleRate;
      const off = new OfflineAudioContext(2, Math.ceil(song.duration * sr), sr);
      schedule(off, song, stems, best, 0, song.duration);
      const out = await off.startRendering();
      await shareFile(`${song.title.replace(/[^\w-]+/g, '_')}-best-takes.wav`, bufferToWav(out), song.title);
    } catch (e) { console.error(e); toast(t('exportFailed')); }
    exportBtn.disabled = false;
    exportBtn.textContent = t('libExport');
  });

  root.append(h('div', { class: 'card' },
    h('p', { class: 'muted small', style: 'margin-top:0' }, t('libInfo', { b: best.size, n: segs.length })),
    playBtn, exportBtn));
  for (const sec of song.sections) {
    root.append(h('h3', null, sec.name));
    for (const seg of sec.segments) {
      const b = best.get(seg.id);
      root.append(h('div', { class: 'list-item' },
        h('div', { class: 'grow' },
          h('div', { style: 'font-weight:700' }, segName(song, seg.id)),
          h('div', { class: 'small muted' }, `${fmt(seg.start)} · ${b ? t('yourBest', { r: b.take.rating ?? '–' }) : t('original')}`)),
        h('button', { class: b ? '' : 'secondary', onclick: () => go(`/lesson/${song.id}/${encodeURIComponent(seg.id)}`) }, b ? '★' : '🎤')));
    }
  }
  return stop;
}
