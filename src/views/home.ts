import { getSongs } from '../db';
import { allLessons } from '../lessons';
import { h, go, setBar } from '../ui';
import { summary } from '../stats';
import { t } from '../i18n';

export async function homeView(root: HTMLElement) {
  setBar('', null);
  const songs = await getSongs();
  const st = await summary();
  const max = Math.max(1, ...st.week.map((d) => d.min));
  const dayNames = t('days').split(',');
  root.append(
    h('div', { class: 'card' },
      h('h3', { style: 'margin:0' }, t('thisWeek')),
      h('div', { class: 'muted' }, t('weekLine', { w: st.weekMin, d: st.todayMin, s: st.streak })),
      h('div', { class: 'row', style: 'align-items:flex-end;height:70px;margin-top:10px;gap:6px' },
        ...st.week.map((d, i) => h('div', { class: 'grow center' },
          h('div', { style: `height:${Math.max(4, (d.min / max) * 48)}px;background:var(--accent);border-radius:8px` }),
          h('div', { class: 'small muted' }, dayNames[i])))),
    ),
  );
  root.append(h('h2', null, t('yourSongs')));
  if (songs.length === 0) {
    root.append(h('div', { class: 'card center' },
      h('h3', null, t('firstSongTitle')),
      h('p', { class: 'muted' }, t('firstSongBody')),
      h('button', { onclick: () => go('/new') }, t('addSong'))));
    return;
  }
  for (const s of songs) {
    const lessons = allLessons(s);
    const done = lessons.filter((l) => s.completed[l.key]).length;
    const pct = lessons.length ? Math.round((done / lessons.length) * 100) : 0;
    root.append(h('div', { class: 'unit-header', style: 'cursor:pointer', onclick: () => go(lessons.length ? `/song/${s.id}` : `/tap/${s.id}`) },
      h('div', { class: 'row' },
        h('div', { class: 'grow' },
          h('div', { style: 'font-weight:700;font-size:18px' }, s.title),
          h('div', { class: 'muted' }, lessons.length ? t('lessonsDone', { d: done, n: lessons.length }) : t('linesNotMarked'))),
        h('div', { style: 'font-size:26px' }, '›')),
      h('div', { class: 'progress', style: 'margin-top:8px;background:rgba(255,255,255,0.3)' }, h('div', { style: `width:${pct}%;background:#fff` })),
    ));
  }
  root.append(h('div', { class: 'center', style: 'margin-top:18px' }, h('button', { class: 'blue', onclick: () => go('/new') }, '+ ' + t('addSong'))));
}
