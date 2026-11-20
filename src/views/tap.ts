import { getSong, putSong, getSettings, uid, type Section, type Song } from '../db';
import { ctx, loadStems, play, beatsBetween, gridFor, stemsDuration, StemMissingError, type Playing, type PlayTrack, type Stems } from '../audio';
import { h, go, setBar, toast, fmt, holdRepeat } from '../ui';
import { t } from '../i18n';

type Mark = { t: number; section: boolean };

export function fullMixTracks(song: Song, stems: Stems, offset: number): PlayTrack[] {
  const keys = song.mode === 'simple' ? ['full'] as const : ['vocals', 'drums', 'bass', 'other'] as const;
  return keys.filter((k) => stems[k]).map((k) => ({ key: k, buffer: stems[k]!, offset }));
}

export async function tapView(root: HTMLElement, id: string) {
  const song = await getSong(id);
  if (!song) { go('/'); return; }
  setBar(t('markTitle'), song.sections.length ? `/edit/${id}` : '/');
  const settings = await getSettings();
  const outLat = settings.latency[settings.route] / 2000; // what you hear lags behind the playhead by about this
  root.append(h('p', { class: 'muted center' }, t('loading')));
  let stems: Stems;
  try { stems = await loadStems(song); } catch (e) { root.replaceChildren(h('p', null, e instanceof StemMissingError ? t('stemMissing') : String((e as Error).message))); return; }
  root.replaceChildren();
  const duration = song.duration || stemsDuration(stems);

  // Existing lines become marks again so they can be adjusted.
  const marks: Mark[] = [];
  song.sections.forEach((sec, si) => sec.segments.forEach((seg, li) => {
    if (seg.start > 0.01) marks.push({ t: seg.start, section: li === 0 && si > 0 });
  }));
  const beatTaps: number[] = [];
  let metroOn = false;
  let playing: Playing | null = null;
  let pos = 0;
  let raf = 0;
  const now = () => (playing ? Math.min(duration, Math.max(0, ctx().currentTime - playing.t0) + pos) : pos);

  // ---- Transport ----
  const timeEl = h('div', { style: 'font-size:26px;font-weight:700;font-variant-numeric:tabular-nums' }, fmt(0));
  const scrub = h('input', { type: 'range', min: '0', max: String(duration), step: '0.01', value: '0', class: 'scrub' }) as HTMLInputElement;
  const ticks = h('div', { class: 'ticks' });
  const playBtn = h('button', { class: 'blue' }, t('play')) as HTMLButtonElement;
  const drawTicks = () => ticks.replaceChildren(...marks.map((m) => h('span', { class: m.section ? 'tick sec' : 'tick', style: `left:${(m.t / duration) * 100}%` })));
  const showPos = (p: number) => { timeEl.textContent = fmt(p); if (document.activeElement !== scrub) scrub.value = String(p); };
  const tick = () => { showPos(now()); raf = requestAnimationFrame(tick); };
  const stop = () => {
    if (playing) { pos = now(); playing.stop(); playing = null; }
    cancelAnimationFrame(raf);
    playBtn.textContent = t('play');
    showPos(pos);
  };
  const start = async () => {
    const grid = gridFor(song);
    const p = await play({
      tracks: fullMixTracks(song, stems, pos),
      on: { metro: metroOn },
      duration: duration - pos,
      metro: { times: beatsBetween(grid, pos, duration).map((b) => b - pos) },
    });
    playing = p;
    p.done.then(() => { if (playing === p) { pos = duration; stop(); } });
    playBtn.textContent = t('pause');
    tick();
  };
  const seek = (p: number) => {
    const was = !!playing;
    stop();
    pos = Math.max(0, Math.min(duration, p));
    showPos(pos);
    if (was) void start();
  };
  playBtn.addEventListener('click', () => (playing ? stop() : void start()));
  scrub.addEventListener('change', () => seek(Number(scrub.value)));
  scrub.addEventListener('input', () => { timeEl.textContent = fmt(Number(scrub.value)); });

  // ---- Beat ----
  const beatInfo = h('div', { class: 'small muted center', style: 'margin:6px 0' });
  const drawBeat = () => {
    beatInfo.textContent = song.beatOffset != null ? t('beatResult', { bpm: Math.round(song.bpm * 10) / 10 }) : t('beatNotYet', { bpm: song.bpm });
  };
  drawBeat();
  const beatBtn = h('button', { class: 'big', style: 'width:110px;height:110px;font-size:20px' }, t('beat'));
  beatBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (!playing) { toast(t('pressPlay')); return; }
    beatTaps.push(now() - outLat);
    const fit = fitBeat(beatTaps);
    if (fit) { song.bpm = fit.bpm; song.beatOffset = fit.offset; void putSong(song); drawBeat(); }
  });
  const metroBox = h('input', { type: 'checkbox' }) as HTMLInputElement;
  metroBox.addEventListener('change', () => { metroOn = metroBox.checked; playing?.setOn('metro', metroOn); });
  const shiftL = h('button', { class: 'secondary' }, '−10 ms');
  const shiftR = h('button', { class: 'secondary' }, '+10 ms');
  const shiftBeat = async (d: number) => {
    song.beatOffset = (song.beatOffset ?? 0) + d;
    await putSong(song);
    drawBeat();
    if (playing && metroOn) seek(now());
  };
  holdRepeat(shiftL, (m) => shiftBeat(-0.01 * m));
  holdRepeat(shiftR, (m) => shiftBeat(0.01 * m));

  // ---- Lines ----
  const log = h('div', { class: 'muted small center' });
  const counts = () => {
    const secs = 1 + marks.filter((m) => m.section).length;
    log.textContent = marks.length ? t('marksCount', { l: marks.length + 1, s: secs }) : t('noMarks');
    drawTicks();
  };
  counts();
  const add = (section: boolean) => {
    const at = Math.max(0, now() - (playing ? outLat : 0));
    if (at < 0.3) return;
    marks.push({ t: at, section });
    marks.sort((a, b) => a.t - b.t);
    counts();
  };
  const endBtn = h('button', { style: 'width:150px;height:150px;font-size:20px' }, t('lineEnds'));
  endBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); add(false); });
  const secBtn = h('button', { class: 'blue' }, t('newSection'));
  secBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); add(true); });

  root.append(
    h('div', { class: 'card center tap-transport' },
      timeEl,
      h('div', { class: 'scrub-wrap' }, ticks, scrub),
      h('div', { class: 'row', style: 'justify-content:center;margin-top:10px' },
        h('button', { class: 'ghost', onclick: () => seek(now() - 5) }, '−5 s'),
        playBtn,
        h('button', { class: 'ghost', onclick: () => seek(now() + 5) }, '+5 s')),
      h('div', { style: 'margin-top:6px' }, h('button', { class: 'ghost', onclick: () => seek(0) }, t('fromStart'))),
    ),
    h('div', { class: 'tap-grid' },
      h('div', { class: 'card' },
        h('h3', { style: 'margin-top:0' }, t('beatStep')),
        h('p', { class: 'muted small' }, t('beatHelp')),
        h('div', { class: 'tap-zone' }, beatBtn),
        beatInfo,
        h('div', { class: 'row wrap', style: 'justify-content:center' },
          h('label', { class: 'row small' }, metroBox, t('beatCheck'))),
        h('div', { class: 'row wrap', style: 'justify-content:center;margin-top:8px' },
          h('span', { class: 'small muted' }, t('shiftBeat')), shiftL, shiftR,
          h('button', { class: 'ghost', onclick: async () => { beatTaps.length = 0; song.beatOffset = null; await putSong(song); drawBeat(); } }, t('beatReset'))),
      ),
      h('div', { class: 'card' },
        h('h3', { style: 'margin-top:0' }, t('linesStep')),
        h('p', { class: 'muted small' }, t('linesHelp')),
        h('div', { class: 'tap-zone' }, endBtn),
        h('div', { class: 'row', style: 'justify-content:center' },
          secBtn,
          h('button', { class: 'ghost', onclick: () => {
            // Undo the mark closest before the playhead (or the last one).
            if (!marks.length) return;
            const p = now();
            let i = marks.length - 1;
            for (let k = marks.length - 1; k >= 0; k--) if (marks[k].t <= p + 0.05) { i = k; break; }
            marks.splice(i, 1);
            counts();
          } }, t('undo'))),
        h('div', { style: 'margin:12px 0' }, log),
      ),
    ),
    h('button', { class: 'full', onclick: async () => {
      stop();
      if (!marks.length) { toast(t('needMark')); return; }
      if (song.sections.length && !confirm(t('replaceLines'))) return;
      song.sections = build(marks, duration);
      song.completed = {};
      if (!song.duration) song.duration = duration;
      await putSong(song);
      go(`/edit/${song.id}`);
    } }, t('done')),
  );
  return () => stop();
}

/** Tempo from the median gap between taps, phase from the average position of the taps within a beat. */
function fitBeat(taps: number[]): { bpm: number; offset: number } | null {
  if (taps.length < 4) return null;
  const gaps = taps.slice(1).map((v, i) => v - taps[i]).filter((g) => g > 0.2 && g < 2);
  if (gaps.length < 3) return null;
  const sorted = [...gaps].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  const good = gaps.filter((g) => g > med * 0.75 && g < med * 1.25);
  const beat = good.reduce((a, b) => a + b, 0) / good.length;
  let sx = 0, sy = 0;
  for (const tp of taps) { const ph = (2 * Math.PI * tp) / beat; sx += Math.cos(ph); sy += Math.sin(ph); }
  let phase = (Math.atan2(sy, sx) / (2 * Math.PI)) * beat;
  if (phase < 0) phase += beat;
  return { bpm: Math.round((60 / beat) * 10) / 10, offset: phase };
}

function build(marks: Mark[], duration: number): Section[] {
  const sorted = [...marks].sort((a, b) => a.t - b.t).filter((m, i, arr) => i === 0 || m.t - arr[i - 1].t > 0.25);
  const sections: Section[] = [];
  let cur: Section = { id: uid(), name: t('section', { n: 1 }), segments: [] };
  sections.push(cur);
  let start = 0;
  for (const m of sorted) {
    if (m.t - start > 0.25) cur.segments.push({ id: uid(), start, end: m.t, name: '' });
    start = m.t;
    if (m.section) { cur = { id: uid(), name: t('section', { n: sections.length + 1 }), segments: [] }; sections.push(cur); }
  }
  if (duration - start > 1) cur.segments.push({ id: uid(), start, end: duration, name: '' });
  return sections.filter((s) => s.segments.length > 0);
}
