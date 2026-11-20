import './styles.css';
import { homeView } from './views/home';
import { songView } from './views/song';
import { newSongView } from './views/newSong';
import { tapView } from './views/tap';
import { editView } from './views/edit';
import { lessonView } from './views/lesson';
import { libraryView } from './views/library';
import { settingsView } from './views/settings';
import { flush } from './stats';
import { getSettings, putSettings } from './db';
import { setReminder } from './native';
import { setLang, t, type Lang } from './i18n';
import { h, setBar } from './ui';

type Cleanup = (() => void) | void | undefined;
let cleanup: Cleanup;

async function route() {
  if (typeof cleanup === 'function') cleanup();
  cleanup = undefined;
  const app = document.getElementById('app')!;
  app.replaceChildren();
  window.scrollTo(0, 0);
  const parts = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const [page, a, b] = parts;
  document.body.dataset.page = page || 'home';
  try {
    switch (page) {
      case '': case undefined: cleanup = await homeView(app); break;
      case 'song': cleanup = await songView(app, a); break;
      case 'new': cleanup = await newSongView(app); break;
      case 'details': cleanup = await newSongView(app, a); break;
      case 'tap': cleanup = await tapView(app, a); break;
      case 'edit': cleanup = await editView(app, a); break;
      case 'lesson': cleanup = await lessonView(app, a, b); break;
      case 'library': cleanup = await libraryView(app, a); break;
      case 'settings': cleanup = await settingsView(app); break;
      default: location.hash = '#/';
    }
  } catch (e) {
    console.error(e);
    app.textContent = t('error', { m: (e as Error).message });
  }
}

function languageScreen(): Promise<Lang> {
  return new Promise((resolve) => {
    setBar('Rhythm Trainer', null);
    const app = document.getElementById('app')!;
    const pick = (l: Lang) => () => resolve(l);
    app.replaceChildren(h('div', { class: 'card center', style: 'margin-top:30px' },
      h('div', { style: 'font-size:44px' }, '🎤'),
      h('h2', null, 'Choose your language · Choisis ta langue'),
      h('div', { class: 'stack', style: 'max-width:280px;margin:18px auto' },
        h('button', { onclick: pick('en') }, '🇬🇧 English'),
        h('button', { class: 'blue', onclick: pick('fr') }, '🇫🇷 Français')),
      h('p', { class: 'muted small' }, 'You can change it later in Settings. · Tu pourras la changer dans les réglages.')));
  });
}

function rotateBanner() {
  const portrait = window.matchMedia('(orientation: portrait)');
  if (!portrait.matches) return;
  const el = h('div', { class: 'rotate-banner' },
    h('span', { style: 'font-size:22px' }, '📱↻'),
    h('span', { class: 'grow' }, t('rotateHint')),
    h('button', { class: 'ghost small-btn', onclick: async () => { el.remove(); const s = await getSettings(); s.rotateHint = false; await putSettings(s); } }, t('dontShowAgain')),
    h('button', { class: 'icon ghost', 'aria-label': 'Close', onclick: () => el.remove() }, '×'));
  document.body.append(el);
  const onChange = () => { if (!portrait.matches) el.remove(); };
  portrait.addEventListener('change', onChange);
  setTimeout(() => el.remove(), 12000);
}

async function boot() {
  const s = await getSettings();
  if (!s.lang) {
    s.lang = await languageScreen();
    await putSettings(s);
  }
  setLang(s.lang);
  window.addEventListener('hashchange', route);
  document.addEventListener('visibilitychange', () => { if (document.hidden) void flush(); });
  await route();
  if (s.rotateHint) rotateBanner();
  // Re-arm the daily reminder at start-up (Android drops scheduled notifications on some updates).
  if (s.reminder.on) void setReminder(true, s.reminder.hour, s.reminder.minute);
}
void boot();
