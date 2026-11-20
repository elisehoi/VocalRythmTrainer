import { getSettings, putSettings, putBlob, deleteBlob, type Route } from '../db';
import { calibrate, closeMic, openMic, micLevel, listMics, startCapture, micCfg, ctx, normalize, resetCountWords } from '../audio';
import { setReminder, isNative } from '../native';
import { exportBackup, importBackup } from '../backup';
import { encodeWav } from '../wav';
import { h, setBar, toast, tabs } from '../ui';
import { t, setLang, type Lang } from '../i18n';

export async function settingsView(root: HTMLElement) {
  setBar(t('settings'), '/');
  const s = await getSettings();
  const save = () => putSettings(s);
  let meterRaf = 0;
  let testing = false;
  const cleanupFns: (() => void)[] = [];

  // ---------- Language ----------
  const langTabs = tabs<Lang>([{ id: 'en', label: 'English' }, { id: 'fr', label: 'Français' }], (s.lang ?? 'en') as Lang, async (l) => {
    s.lang = l; await save(); setLang(l); resetCountWords();
    root.replaceChildren(); void settingsView(root);
  });

  // ---------- Recording ----------
  const routeLabel = (r: Route) => t(r === 'speaker' ? 'routeSpeaker' : r === 'wired' ? 'routeWired' : 'routeBluetooth');
  const routeBox = h('div');
  const drawRoute = () => {
    const latVal = h('span', { style: 'font-weight:700' }, `${s.latency[s.route]} ms`);
    const lat = h('input', { type: 'range', min: '0', max: '500', step: '5', value: String(s.latency[s.route]) }) as HTMLInputElement;
    lat.addEventListener('input', () => { s.latency[s.route] = Number(lat.value); latVal.textContent = `${lat.value} ms`; });
    lat.addEventListener('change', save);
    const calBtn = h('button', { class: 'full' }, t('measure')) as HTMLButtonElement;
    calBtn.addEventListener('click', async () => {
      calBtn.disabled = true;
      calBtn.textContent = t('listening');
      try {
        const ms = await calibrate(s.micId);
        if (ms == null) toast(t('calFail'), 4000);
        else { s.latency[s.route] = ms; lat.value = String(ms); latVal.textContent = `${ms} ms`; await save(); toast(t('calOk', { ms })); }
      } catch { toast(t('allowMic')); }
      calBtn.disabled = false;
      calBtn.textContent = t('measure');
    });
    const clean = h('input', { type: 'checkbox', checked: s.cleanup[s.route] }) as HTMLInputElement;
    clean.addEventListener('change', async () => { s.cleanup[s.route] = clean.checked; await save(); closeMic(); });
    routeBox.replaceChildren(...[
      s.route === 'bluetooth' ? h('p', { class: 'small warn' }, t('btWarning')) : null,
      h('div', { class: 'row', style: 'margin-top:10px' }, h('div', { class: 'grow' }, t('cleanup')), clean),
      h('p', { class: 'muted small' }, t('cleanupHelp')),
      h('hr'),
      h('h3', null, t('latencyTitle', { route: routeLabel(s.route) })),
      h('p', { class: 'muted small' }, t(s.route === 'speaker' ? 'latencyHelpSpeaker' : 'latencyHelpPhones')),
      calBtn,
      h('label', { class: 'field' }, t('byEar'), latVal), lat,
      h('p', { class: 'muted small' }, t('byEarHelp')),
    ].filter((x): x is NonNullable<typeof x> => !!x));
  };
  drawRoute();
  const routeTabs = tabs<Route>([
    { id: 'speaker', label: t('routeSpeaker') },
    { id: 'wired', label: t('routeWired') },
    { id: 'bluetooth', label: t('routeBluetooth') },
  ], s.route, async (r) => { s.route = r; await save(); closeMic(); drawRoute(); });

  // Microphone choice
  const micSel = h('select') as HTMLSelectElement;
  const fillMics = async () => {
    let mics: { id: string; label: string }[] = [];
    try { mics = await listMics(); } catch { /* not available */ }
    micSel.replaceChildren(h('option', { value: '' }, t('micDefault')),
      ...mics.map((m, i) => h('option', { value: m.id, selected: m.id === s.micId }, m.label || t('micPhone', { n: i + 1 }))));
  };
  micSel.addEventListener('change', async () => { s.micId = micSel.value; await save(); closeMic(); });
  void fillMics();

  // Mic test
  const meterFill = h('div');
  const meter = h('div', { class: 'meter' }, h('span', { class: 'small' }, t('micLevel')), h('div', { class: 'meter-bar' }, meterFill));
  const testBtn = h('button', { class: 'secondary full' }, t('testMic')) as HTMLButtonElement;
  const tickMeter = () => { meterFill.style.width = `${Math.round(micLevel() * 100)}%`; meterRaf = requestAnimationFrame(tickMeter); };
  testBtn.addEventListener('click', async () => {
    if (testing) return;
    testing = true;
    testBtn.textContent = t('recording');
    try {
      const cfg = micCfg(s);
      await openMic(cfg);
      await fillMics(); // labels appear once permission is granted
      tickMeter();
      const cap = await startCapture(cfg);
      await new Promise((r) => setTimeout(r, 3000));
      const res = await cap.stop();
      cancelAnimationFrame(meterRaf);
      meterFill.style.width = '0%';
      const c = ctx();
      const b = c.createBuffer(1, res.data.length, c.sampleRate);
      b.getChannelData(0).set(normalize(res.data));
      const src = c.createBufferSource();
      src.buffer = b;
      src.connect(c.destination);
      src.start();
      testBtn.textContent = '▶ …';
      await new Promise((r) => { src.onended = r; });
    } catch { toast(t('allowMic')); }
    closeMic();
    testing = false;
    testBtn.textContent = t('testMic');
  });
  cleanupFns.push(() => { cancelAnimationFrame(meterRaf); closeMic(); });

  // ---------- Lessons ----------
  const pass = h('select') as HTMLSelectElement;
  for (let i = 1; i <= 5; i++) pass.append(h('option', { value: String(i), selected: i === s.passStars }, `${i}★`));
  pass.addEventListener('change', async () => { s.passStars = Number(pass.value); await save(); });
  const countIn = h('input', { type: 'checkbox', checked: s.countIn }) as HTMLInputElement;
  countIn.addEventListener('change', async () => { s.countIn = countIn.checked; await save(); });
  const voice = h('input', { type: 'checkbox', checked: s.countVoice }) as HTMLInputElement;
  voice.addEventListener('change', async () => { s.countVoice = voice.checked; await save(); });
  const rotate = h('input', { type: 'checkbox', checked: s.rotateHint }) as HTMLInputElement;
  rotate.addEventListener('change', async () => { s.rotateHint = rotate.checked; await save(); });

  // Own count-in words
  const ownBox = h('div', { class: 'row wrap', style: 'gap:6px' });
  const drawOwn = () => {
    ownBox.replaceChildren(...[...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => {
      const b = h('button', { class: 'secondary' }, String(n)) as HTMLButtonElement;
      b.addEventListener('click', async () => {
        try {
          const cfg = { cleanup: true, micId: s.micId };
          await openMic(cfg);
          b.textContent = '●';
          const cap = await startCapture(cfg);
          await new Promise((r) => setTimeout(r, 1100));
          const res = await cap.stop();
          closeMic();
          const word = trimWord(res.data, ctx().sampleRate);
          if (!word) { toast(t('takeTooShort')); b.textContent = String(n); return; }
          await putBlob(`count:own:${n}`, encodeWav([normalize(word)], ctx().sampleRate));
          s.ownCount = true; await save(); resetCountWords();
          b.textContent = `${n} ✓`;
        } catch { toast(t('allowMic')); b.textContent = String(n); }
      });
      return b;
    }), s.ownCount ? h('button', { class: 'ghost', onclick: async () => {
      for (let n = 1; n <= 8; n++) await deleteBlob(`count:own:${n}`);
      s.ownCount = false; await save(); resetCountWords(); drawOwn();
    } }, t('ownCountDelete')) : null].filter((x): x is HTMLButtonElement => !!x));
  };
  drawOwn();

  // ---------- Reminder ----------
  const remOn = h('input', { type: 'checkbox', checked: s.reminder.on }) as HTMLInputElement;
  const remTime = h('input', { type: 'time', value: `${String(s.reminder.hour).padStart(2, '0')}:${String(s.reminder.minute).padStart(2, '0')}` }) as HTMLInputElement;
  const applyRem = async () => {
    const [hh, mm] = remTime.value.split(':').map(Number);
    s.reminder = { on: remOn.checked, hour: hh || 0, minute: mm || 0 };
    await save();
    const err = await setReminder(s.reminder.on, s.reminder.hour, s.reminder.minute);
    if (err) toast(err, 3500); else if (s.reminder.on) toast(t('remSet', { t: remTime.value }));
  };
  remOn.addEventListener('change', applyRem);
  remTime.addEventListener('change', applyRem);

  // ---------- Backup ----------
  const withStems = h('input', { type: 'checkbox' }) as HTMLInputElement;
  const backupBtn = h('button', { class: 'full' }, t('backup')) as HTMLButtonElement;
  backupBtn.addEventListener('click', async () => {
    backupBtn.disabled = true; backupBtn.textContent = t('packing');
    try { await exportBackup(withStems.checked); } catch (e) { console.error(e); toast(t('backupFailed')); }
    backupBtn.disabled = false; backupBtn.textContent = t('backup');
  });
  const restoreInput = h('input', { type: 'file', accept: '.zip,application/zip', class: 'hidden' }) as HTMLInputElement;
  restoreInput.addEventListener('change', async () => {
    const f = restoreInput.files?.[0];
    if (!f) return;
    if (!confirm(t('restoreQ'))) return;
    try { toast(await importBackup(f), 5000); } catch (e) { toast((e as Error).message || 'Restore failed.'); }
  });

  const card = (title: string, ...kids: (Node | null)[]) => h('div', { class: 'card' }, h('h3', { style: 'margin-top:0' }, title), ...kids);
  const line = (label: string, input: HTMLElement) => h('div', { class: 'row', style: 'margin-top:10px' }, h('div', { class: 'grow' }, label), input);

  root.append(h('div', { class: 'settings-grid' },
    card(t('language'), langTabs),
    card(t('recordingTitle'),
      h('label', { class: 'field' }, t('listenWith')), routeTabs,
      h('p', { class: 'muted small' }, t('routeHelp')),
      h('label', { class: 'field' }, t('recordWith')), micSel,
      h('p', { class: 'muted small' }, t('micListHint')),
      h('div', { style: 'margin:10px 0' }, meter),
      testBtn,
      h('p', { class: 'muted small' }, t('testMicHelp')),
      routeBox,
    ),
    card(t('lessonsTitle'),
      line(t('starsToPass'), h('div', { style: 'width:90px' }, pass)),
      line(t('countInClicks'), countIn),
      line(t('countInVoice'), voice),
      h('label', { class: 'field' }, t('ownCount')),
      h('p', { class: 'muted small' }, t('ownCountHelp')),
      ownBox,
      line(t('rotateSetting'), rotate),
    ),
    card(t('reminderTitle'),
      line(t('remindMe'), remOn),
      h('label', { class: 'field' }, t('time')), remTime,
      !isNative() ? h('p', { class: 'muted small' }, t('remOnlyApp')) : null,
    ),
    card(t('backupTitle'),
      h('p', { class: 'muted small' }, t('backupHelp')),
      line(t('withStems'), withStems),
      h('div', { style: 'margin-top:10px' }, backupBtn),
      h('div', { style: 'margin-top:10px' }, h('button', { class: 'secondary full', onclick: () => restoreInput.click() }, t('restore')), restoreInput),
    ),
  ));
  return () => cleanupFns.forEach((f) => f());
}

/** Keep just the spoken word: from where it gets loud to where it fades out. */
function trimWord(d: Float32Array, sr: number): Float32Array | null {
  let peak = 0;
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  if (peak < 0.01) return null;
  const thr = peak * 0.12;
  let s = 0; while (s < d.length && Math.abs(d[s]) < thr) s++;
  let e = d.length - 1; while (e > s && Math.abs(d[e]) < thr) e--;
  const out = d.slice(Math.max(0, s - Math.floor(sr * 0.005)), Math.min(d.length, e + Math.floor(sr * 0.08)));
  return out.length > sr * 0.05 ? out : null;
}
