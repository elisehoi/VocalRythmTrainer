import { summary } from './stats';
import { t } from './i18n';

type Child = Node | string | null | undefined | false;
type Props = Record<string, unknown> & { class?: string; style?: string };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else if (k === 'class') el.className = String(v);
      else if (k === 'style') el.setAttribute('style', String(v));
      else if (k in el && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v;
      else el.setAttribute(k, String(v));
    }
  }
  for (const c of children) if (c != null && c !== false) el.append(c);
  return el;
}

export function toast(msg: string, ms = 2600) {
  document.querySelectorAll('.toast').forEach((x) => x.remove());
  const t = h('div', { class: 'toast' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}

export function go(path: string) { location.hash = '#' + path; }

export const fmt = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m}:${sec.toFixed(1).padStart(4, '0')}`;
};

let barTitle = '';
let barBack: string | null = null;

export async function renderBar() {
  const root = document.getElementById('topbar')!;
  const st = await summary();
  root.replaceChildren(
    h('div', { class: 'bar' },
      barBack ? h('button', { class: 'icon', 'aria-label': t('back'), onclick: () => go(barBack!) }, '‹') : null,
      h('div', { class: 'title' }, barTitle || t('appName')),
      h('div', { class: 'chip', title: t('dayStreak') }, '🔥 ', String(st.streak)),
      h('div', { class: 'chip', title: t('minutesWeek') }, '⏱ ', `${st.weekMin}m`),
      h('button', { class: 'icon', 'aria-label': t('settings'), onclick: () => go('/settings') }, '⚙'),
    ),
  );
}
window.addEventListener('stats-changed', () => void renderBar());

export function setBar(title: string, back: string | null) {
  barTitle = title;
  barBack = back;
  void renderBar();
}

export function filePicker(label: string, accept: string, onPick: (f: File) => void, current?: string): HTMLElement {
  const name = h('span', null, current ?? t('noFile'));
  const input = h('input', { type: 'file', accept, class: 'hidden' }) as HTMLInputElement;
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (f) { name.textContent = f.name; onPick(f); }
  });
  return h('div', null,
    h('label', { class: 'field' }, label),
    h('div', { class: 'file-pick' }, name, h('button', { class: 'secondary', onclick: () => input.click() }, t('choose')), input),
  );
}

export function stars(value: number | null, onSet: (v: number) => void): HTMLElement {
  const wrap = h('div', { class: 'stars' });
  const draw = (v: number | null) => {
    wrap.replaceChildren(...[1, 2, 3, 4, 5].map((n) =>
      h('button', { class: v != null && n <= v ? 'lit' : '', 'aria-label': `${n} stars`, onclick: () => { draw(n); onSet(n); } }, '★')));
  };
  draw(value);
  return wrap;
}

/** Press once = one step; hold = repeat, faster and faster. */
export function holdRepeat(btn: HTMLElement, fn: (mult: number) => void | Promise<void>) {
  let timer = 0;
  let started = 0;
  const stop = () => { window.clearTimeout(timer); timer = 0; };
  const loop = () => {
    const held = performance.now() - started;
    void fn(held > 2500 ? 8 : held > 1200 ? 3 : 1);
    timer = window.setTimeout(loop, held > 600 ? 60 : 110);
  };
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    started = performance.now();
    void fn(1);
    timer = window.setTimeout(loop, 380);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(ev, stop);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
}

export function tabs<T extends string>(options: { id: T; label: string }[], value: T, onChange: (v: T) => void): HTMLElement {
  const wrap = h('div', { class: 'tabs' });
  const draw = (v: T) => wrap.replaceChildren(...options.map((o) =>
    h('button', { class: o.id === v ? 'tab on' : 'tab', onclick: () => { draw(o.id); onChange(o.id); } }, o.label)));
  draw(value);
  return wrap;
}

export const fmtMs = (s: number) => `${Math.round(s * 1000)} ms`;
