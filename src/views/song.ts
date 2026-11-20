import { getSong } from '../db';
import { units } from '../lessons';
import { h, go, setBar } from '../ui';
import { t } from '../i18n';

const OFFSETS = [0, 52, 78, 52, 0, -52, -78, -52];

export async function songView(root: HTMLElement, id: string) {
  const song = await getSong(id);
  if (!song) { go('/'); return; }
  setBar(song.title, '/');
  const us = units(song);
  root.append(h('div', { class: 'row wrap', style: 'justify-content:center' },
    h('button', { class: 'secondary', onclick: () => go(`/library/${song.id}`) }, t('bestTakes')),
    h('button', { class: 'ghost', onclick: () => go(`/edit/${song.id}`) }, t('editLines')),
  ));
  if (us.length === 0) {
    root.append(h('div', { class: 'card center', style: 'margin-top:16px' },
      h('p', null, t('noLines')),
      h('button', { onclick: () => go(`/tap/${song.id}`) }, t('tapToMark'))));
    return;
  }
  // The first lesson not yet done is highlighted as "next"; every lesson stays open.
  const firstOpen = us.flatMap((u) => u.lessons).find((l) => !song.completed[l.key]);
  let i = 0;
  for (const u of us) {
    const done = u.lessons.filter((l) => song.completed[l.key]).length;
    root.append(h('div', { class: 'unit-header' },
      h('div', { style: 'font-weight:700;font-size:17px' }, u.title),
      h('div', { class: 'muted' }, t('doneOf', { d: done, n: u.lessons.length }))));
    const path = h('div', { class: 'path' });
    for (const l of u.lessons) {
      const state = song.completed[l.key] ? 'done' : l === firstOpen ? 'next' : 'open';
      const icon = state === 'done' ? '✓' : state === 'next' ? '▶' : l.segIds.length > 1 ? '♫' : '♪';
      path.append(h('div', { class: `node ${state}`, style: `transform:translateX(${OFFSETS[i % OFFSETS.length]}px)` },
        h('button', { 'aria-label': l.label, onclick: () => go(`/lesson/${song.id}/${encodeURIComponent(l.key)}`) }, icon),
        h('div', { class: 'label' }, l.label)));
      i++;
    }
    root.append(path);
  }
}
