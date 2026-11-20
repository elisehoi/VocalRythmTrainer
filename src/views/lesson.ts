import { getSong, putSong, getTakes, putTake, putBlob, deleteTake, getSettings, uid, type Take, type StemKey } from '../db';
import {
  ctx, loadStems, unitStems, play, startCapture, openMic, closeMic, drawWave, takeBuffer, takeOffset, normalize, micLevel, micCfg,
  gridFor, beatsBetween, countInTimes, StemMissingError, type Playing, type PlayTrack, type Stems,
} from '../audio';
import { encodeWav } from '../wav';
import { findLesson } from '../lessons';
import { addPractice, flush } from '../stats';
import { h, go, setBar, toast, stars, holdRepeat } from '../ui';
import { t } from '../i18n';

type Key = 'orig' | 'bg' | 'mine' | 'drums' | 'bass' | 'other' | 'inst' | 'metro';
type On = Record<Key, boolean>;

const STEPS = [
  { name: 'stepListen', icon: '🎧' },
  { name: 'stepCopy', icon: '🥁' },
  { name: 'stepPerform', icon: '🎤' },
] as const;

function defaults(mode: 'simple' | 'complete', step: number): On {
  const base: On = { orig: false, bg: true, mine: true, drums: false, bass: false, other: false, inst: false, metro: false };
  if (mode === 'complete') {
    if (step === 0) return { ...base, orig: true, mine: false, drums: true, bass: true, other: true };
    if (step === 1) return { ...base, drums: true, bass: true };
    return { ...base, drums: true, bass: true, other: true };
  }
  if (step === 0) return { ...base, orig: true, bg: false, mine: false };
  if (step === 1) return { ...base, metro: true };
  return { ...base, inst: true };
}

export async function lessonView(root: HTMLElement, songId: string, key: string) {
  const song = await getSong(songId);
  const lesson = song ? findLesson(song, key) : undefined;
  if (!song || !lesson) { go(song ? `/song/${songId}` : '/'); return; }
  setBar(lesson.label, `/song/${songId}`);
  const settings = await getSettings();
  root.append(h('p', { class: 'muted center' }, t('loading')));
  let stems: Stems;
  try { stems = await loadStems(song); } catch (e) {
    root.replaceChildren(h('p', null, e instanceof StemMissingError ? t('stemMissing') : (e as Error).message),
      h('button', { onclick: () => go(`/details/${song.id}`) }, t('details')));
    return;
  }
  root.replaceChildren();
  const mode = song.mode;
  const origKey: StemKey = mode === 'simple' ? 'full' : 'vocals';
  const bgParts: { key: Key; label: string }[] = mode === 'simple'
    ? [{ key: 'inst', label: t('instrumental') }, { key: 'metro', label: t('metronome') }]
    : [
      { key: 'drums', label: t('drums') },
      ...(stems.bass ? [{ key: 'bass' as Key, label: t('bass') }] : []),
      { key: 'other', label: t('music') },
      { key: 'metro', label: t('metronome') },
    ];

  const state = {
    step: 1,
    speed: 1,
    loop: false,
    on: defaults(mode, 1),
    playing: null as Playing | null,
    recording: false,
    takes: [] as Take[],
    selected: null as Take | null,
    selectedBuf: null as AudioBuffer | null,
  };
  let raf = 0;
  let alive = true;
  let userStopped = false;
  const unitDur = lesson.end - lesson.start;
  const grid = gridFor(song);

  // ---------- Elements ----------
  const stepsEl = h('div', { class: 'steps' });
  const hint = h('p', { class: 'muted center small' });
  const takeCanvas = h('canvas', { class: 'wave' }) as HTMLCanvasElement;
  const origBar = h('div', { class: 'flat-track' }, h('div', { class: 'flat-head' }));
  const takeLabel = h('span', { class: 'small muted' });
  const rowsEl = h('div', { class: 'tracks' });
  const playBtn = h('button', { class: 'big blue', 'aria-label': 'Play' }, '▶') as HTMLButtonElement;
  const recBtn = h('button', { class: 'big', 'aria-label': t('record') }, '●') as HTMLButtonElement;
  const loopBtn = h('button', { class: 'icon secondary', 'aria-label': 'Loop', title: 'Loop' }, '🔁') as HTMLButtonElement;
  const speedEl = h('div', { class: 'mixer' });
  const meterFill = h('div');
  const meter = h('div', { class: 'meter hidden' }, h('span', { class: 'small' }, t('micLevel')), h('div', { class: 'meter-bar' }, meterFill));
  const status = h('div', { class: 'center small muted', style: 'min-height:20px' });
  const takesEl = h('div');

  // ---------- Drawing ----------
  const drawTake = (playhead: number | null = null) => {
    const css = getComputedStyle(document.documentElement);
    const tk = state.selected;
    drawWave(takeCanvas, state.selectedBuf, {
      offset: tk ? takeOffset(tk) : 0,
      span: tk ? unitDur / tk.speed : unitDur,
      color: css.getPropertyValue('--accent-2').trim(),
      playhead: playhead != null && tk ? playhead / tk.speed : playhead,
    });
    (origBar.firstChild as HTMLElement).style.left = playhead != null ? `${(playhead / unitDur) * 100}%` : '-10px';
  };

  const toggle = (k: Key) => {
    state.on[k] = !state.on[k];
    state.playing?.setOn(k, state.on[k]);
    renderRows();
  };
  const muteBtn = (k: Key) => h('button', { class: `icon mute ${state.on[k] ? '' : 'off'}`, 'aria-label': k, onclick: () => toggle(k) }, state.on[k] ? '🔊' : '🔇');

  const renderRows = () => {
    const sync = h('div', { class: 'row wrap', style: 'gap:6px;margin-top:6px' });
    if (state.selected) {
      const l = h('button', { class: 'secondary nudge', title: t('earlier') }, '◀');
      const r = h('button', { class: 'secondary nudge', title: t('later') }, '▶');
      const val = h('span', { class: 'small muted', style: 'min-width:58px;text-align:center' }, `${Math.round((state.selected.shift ?? 0) * -1000)} ms`);
      const shift = async (d: number) => {
        const tk = state.selected;
        if (!tk) return;
        tk.shift = (tk.shift ?? 0) + d;
        val.textContent = `${Math.round(tk.shift * -1000)} ms`;
        drawTake();
        await putTake(tk);
      };
      holdRepeat(l, (m) => shift(0.005 * m)); // earlier = start further into the take
      holdRepeat(r, (m) => shift(-0.005 * m));
      sync.append(h('span', { class: 'small muted' }, t('syncTake')), l, val, r);
    }
    rowsEl.replaceChildren(
      h('div', { class: 'track-row' },
        h('div', { class: 'row' }, muteBtn('bg'), h('div', { class: 'track-label' }, t('trackBackground'))),
        h('div', { class: 'chips' }, ...bgParts.map((p) => h('button', {
          class: state.on[p.key] ? 'chip-btn on' : 'chip-btn', onclick: () => toggle(p.key),
        }, p.label)))),
      h('div', { class: 'track-row' },
        h('div', { class: 'row' }, muteBtn('orig'), h('div', { class: 'track-label' }, t('trackOriginal'))),
        origBar),
      h('div', { class: 'track-row' },
        h('div', { class: 'row' }, muteBtn('mine'), h('div', { class: 'track-label' }, t('trackMine')), takeLabel),
        takeCanvas, sync),
    );
    requestAnimationFrame(() => drawTake());
  };

  const renderSteps = () => {
    stepsEl.replaceChildren(...STEPS.map((s, i) => h('div', { class: `step ${i === state.step ? 'active' : ''}` },
      h('button', { 'aria-label': t(s.name), onclick: () => {
        if (state.recording) return;
        stopPlaying();
        state.step = i; state.on = defaults(mode, i);
        if (!state.selected) state.on.mine = false;
        renderAll();
      } }, s.icon),
      h('div', { class: 'label' }, `${i + 1}. ${t(s.name)}`))));
    hint.textContent = t(state.step === 0 ? 'hintListen' : state.step === 2 ? 'hintPerform' : mode === 'simple' ? 'hintCopySimple' : 'hintCopy');
    recBtn.classList.toggle('hidden', state.step === 0);
  };
  const renderSpeed = () => {
    speedEl.replaceChildren(h('span', { class: 'small muted' }, t('speed')), ...[0.75, 0.9, 1].map((sp) => h('button', {
      class: sp === state.speed ? '' : 'secondary',
      onclick: () => { if (state.playing) return; state.speed = sp; renderSpeed(); },
    }, `${Math.round(sp * 100)}%`)));
    loopBtn.classList.toggle('on', state.loop);
  };
  const renderAll = () => { renderSteps(); renderRows(); renderSpeed(); };

  // ---------- Playback ----------
  const stopPlaying = () => {
    userStopped = true;
    const p = state.playing;
    state.playing = null;
    p?.stop();
    cancelAnimationFrame(raf);
    drawTake(null);
    playBtn.textContent = '▶';
  };

  const run = async (opts: { record?: boolean; countIn?: boolean; tail?: number; on?: Partial<On> }) => {
    const tk = state.selected;
    const on: On = { ...state.on, ...(opts.on ?? {}) };
    if (opts.record) on.mine = false;
    // A take only lines up at the speed it was recorded at.
    const speed = !opts.record && on.mine && tk && state.selectedBuf ? tk.speed : state.speed;
    const u = unitStems(stems, lesson.start, lesson.end, speed);
    const tracks: PlayTrack[] = [];
    if (u[origKey]) tracks.push({ key: 'orig', buffer: u[origKey]! });
    for (const p of bgParts) if (p.key !== 'metro' && u[p.key as StemKey]) tracks.push({ key: p.key, buffer: u[p.key as StemKey]!, group: 'bg' });
    if (!opts.record && tk && state.selectedBuf) tracks.push({ key: 'mine', buffer: state.selectedBuf, offset: takeOffset(tk) });
    const withCount = (opts.countIn ?? true) && settings.countIn;
    const p = await play({
      tracks, on, duration: unitDur / speed, tail: opts.tail,
      countIn: withCount ? { times: countInTimes(grid, lesson.start).map((c) => (c - lesson.start) / speed), voice: settings.countVoice, own: settings.ownCount } : null,
      metro: { times: beatsBetween(grid, lesson.start, lesson.end).map((b) => (b - lesson.start) / speed), group: 'bg' },
    });
    state.playing = p;
    playBtn.textContent = '■';
    cancelAnimationFrame(raf);
    const frame = () => {
      const el = ctx().currentTime - p.t0;
      drawTake(el >= 0 ? Math.min(el * speed, unitDur) : null);
      if (state.recording) meterFill.style.width = `${Math.round(micLevel() * 100)}%`;
      if (state.playing === p) raf = requestAnimationFrame(frame);
      else drawTake(null);
    };
    frame();
    const startedAt = performance.now();
    await p.done;
    addPractice((performance.now() - startedAt) / 1000);
    if (state.playing === p) { state.playing = null; playBtn.textContent = '▶'; drawTake(null); }
    return p;
  };

  playBtn.addEventListener('click', async () => {
    if (state.recording) return;
    if (state.playing) { stopPlaying(); return; }
    userStopped = false;
    do { await run({}); } while (alive && state.loop && !userStopped && !state.recording);
  });
  loopBtn.addEventListener('click', () => { state.loop = !state.loop; renderSpeed(); });

  recBtn.addEventListener('click', async () => {
    if (state.recording) { stopPlaying(); return; } // tap again to cancel
    if (state.playing) stopPlaying();
    const cfg = micCfg(settings);
    try { await openMic(cfg); } catch { toast(t('allowMic')); return; }
    state.recording = true;
    userStopped = false;
    recBtn.classList.add('rec');
    meter.classList.remove('hidden');
    status.textContent = t('recording');
    const speed = state.speed;
    const cap = await startCapture(cfg);
    const p = await run({ record: true, tail: 0.6 });
    const res = await cap.stop();
    state.recording = false;
    recBtn.classList.remove('rec');
    meter.classList.add('hidden');
    status.textContent = '';
    if (!alive || userStopped) return; // cancelled: discard
    const sr = ctx().sampleRate;
    let leadIn = p.t0 + settings.latency[settings.route] / 1000 - res.firstTime;
    const trim = Math.max(0, Math.floor((leadIn - 0.5) * sr));
    leadIn -= trim / sr;
    const raw = res.data.subarray(trim);
    if (raw.length < sr * 0.3) { toast(t('takeTooShort')); return; }
    let peak = 0;
    for (let i = 0; i < raw.length; i += 4) peak = Math.max(peak, Math.abs(raw[i]));
    const pcm = normalize(raw);
    const take: Take = {
      id: uid(), songId: song.id, unitKey: lesson.key, createdAt: Date.now(), rating: null, note: '',
      speed, step: state.step, sampleRate: sr, leadIn, length: pcm.length, shift: 0, schema: 2,
    };
    await putBlob('take:' + take.id, encodeWav([pcm], sr));
    await putTake(take);
    await loadTakes();
    state.on.mine = true;
    await select(take);
    toast(peak < 1e-3 ? t('silentTake') : res.backup ? t('backupMode') : t('takeSaved'), 4000);
  });

  // ---------- Takes ----------
  const fmtDate = (ms: number) => new Date(ms).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
  const select = async (tk: Take | null) => {
    state.selected = tk;
    state.selectedBuf = tk ? await takeBuffer(tk) : null;
    takeLabel.textContent = tk ? `· ${fmtDate(tk.createdAt)}${tk.speed !== 1 ? ` · ${Math.round(tk.speed * 100)}%` : ''}` : `· ${t('noTakeYet')}`;
    renderRows();
    renderTakes();
  };
  const loadTakes = async () => { state.takes = (await getTakes(song.id)).filter((x) => x.unitKey === lesson.key); };
  const bestTake = () => state.takes.find((x) => x.id === song.best[lesson.key]) ?? null;

  const maybeComplete = async (tk: Take) => {
    if (tk.step === 2 && tk.speed === 1 && (tk.rating ?? 0) >= settings.passStars && !song.completed[lesson.key]) {
      song.completed[lesson.key] = true;
      await putSong(song);
      toast(t('lessonComplete'));
    }
  };

  const abCompare = async (tk: Take) => {
    if (state.recording) return;
    stopPlaying();
    userStopped = false;
    if (tk.id !== state.selected?.id) await select(tk);
    status.textContent = 'A · ' + t('trackOriginal');
    await run({ countIn: false, on: { orig: true, mine: false } });
    if (!alive || userStopped) { status.textContent = ''; return; }
    status.textContent = 'B · ' + t('trackMine');
    await run({ countIn: false, on: { orig: false, mine: true } });
    status.textContent = '';
  };

  const renderTakes = () => {
    takesEl.replaceChildren(h('h3', null, t('takesFor', { n: state.takes.length })));
    const best = bestTake();
    if (!state.takes.length) { takesEl.append(h('p', { class: 'muted small' }, t('noTakes'))); return; }
    for (const tk of state.takes) {
      const isBest = tk.id === best?.id;
      const isSel = tk.id === state.selected?.id;
      const cmp = h('div', { class: 'small muted' });
      const updCmp = () => {
        if (isBest) cmp.textContent = t('isBest');
        else if (best && tk.rating != null && best.rating != null) {
          cmp.textContent = tk.rating > best.rating ? t('betterThanBest', { b: best.rating }) : tk.rating === best.rating ? t('sameAsBest', { b: best.rating }) : t('bestIs', { b: best.rating });
        } else cmp.textContent = best ? t('bestIs', { b: best.rating ?? '–' }) : t('noBest');
      };
      updCmp();
      const note = h('input', { type: 'text', value: tk.note, placeholder: t('notePh'), style: 'padding:6px 10px;font-size:14px' }) as HTMLInputElement;
      note.addEventListener('change', async () => { tk.note = note.value; await putTake(tk); });
      takesEl.append(h('div', { class: 'card', style: isSel ? 'outline:3px solid var(--accent-2)' : '' },
        h('div', { style: 'font-weight:700;cursor:pointer', onclick: () => select(tk) },
          fmtDate(tk.createdAt), ' ',
          isBest ? h('span', { class: 'pill' }, t('best')) : null, ' ',
          tk.speed !== 1 ? h('span', { class: 'pill' }, `${Math.round(tk.speed * 100)}%`) : null, ' ',
          h('span', { class: 'pill' }, t(STEPS[tk.step]?.name ?? 'stepCopy'))),
        h('div', { style: 'margin:8px 0' }, stars(tk.rating, async (v) => { tk.rating = v; await putTake(tk); updCmp(); await maybeComplete(tk); })),
        cmp,
        h('div', { class: 'row wrap', style: 'margin-top:8px;gap:6px' },
          h('button', { class: 'secondary', onclick: async () => {
            if (state.recording) return;
            stopPlaying();
            if (tk.id !== state.selected?.id) await select(tk);
            state.on.mine = true; renderRows();
            userStopped = false;
            await run({ countIn: false });
          } }, '▶'),
          h('button', { class: 'secondary', onclick: () => abCompare(tk) }, 'A/B'),
          !isBest ? h('button', { class: 'blue', onclick: async () => {
            if (tk.speed !== 1) { toast(t('onlyFullSpeed')); return; }
            song.best[lesson.key] = tk.id; await putSong(song); renderTakes();
          } }, t('makeBest')) : null,
          h('button', { class: 'danger', onclick: async () => {
            if (!confirm(t('deleteTake'))) return;
            if (isBest) { delete song.best[lesson.key]; await putSong(song); }
            await deleteTake(tk.id); await loadTakes();
            await select(state.selected?.id === tk.id ? state.takes[0] ?? null : state.selected);
          } }, '🗑'),
        ),
        h('div', { style: 'margin-top:8px' }, note),
      ));
    }
  };

  // ---------- Layout ----------
  const sectionName = lesson.sectionId ? song.sections.find((s) => s.id === lesson.sectionId)?.name ?? '' : song.title;
  root.append(h('div', { class: 'lesson' },
    h('div', { class: 'lesson-main' },
      h('div', { class: 'center muted small' }, sectionName),
      stepsEl, hint,
      rowsEl,
      meter,
      h('div', { class: 'row', style: 'justify-content:center;gap:18px;margin:12px 0' }, loopBtn, playBtn, recBtn),
      status,
      speedEl,
      settings.route === 'speaker' ? h('p', { class: 'muted small center' }, t('recTip')) : null,
      h('p', { class: 'muted small center' }, t('completeRule', { n: settings.passStars })),
    ),
    h('div', { class: 'lesson-side' }, takesEl),
  ));
  await loadTakes();
  renderAll();
  await select(state.takes[0] ?? null);
  if (!state.selected) { state.on.mine = false; renderRows(); }
  const onResize = () => drawTake();
  window.addEventListener('resize', onResize);

  return () => {
    alive = false;
    stopPlaying();
    closeMic();
    window.removeEventListener('resize', onResize);
    void flush();
  };
}
