import { getSong, putSong, deleteSong, uid, type Segment } from '../db';
import { loadStems, play, StemMissingError, type Playing } from '../audio';
import { h, go, setBar, toast, fmt, holdRepeat } from '../ui';
import { t } from '../i18n';
import { fullMixTracks } from './tap';

const NUDGE = 0.05;

export async function editView(root: HTMLElement, id: string) {
  const song = await getSong(id);
  if (!song) { go('/'); return; }
  setBar(t('editTitle'), `/song/${id}`);
  let playing: Playing | null = null;
  const stopAll = () => { playing?.stop(); playing = null; };
  let saveTimer = 0;
  let deleted = false;
  const save = () => { window.clearTimeout(saveTimer); saveTimer = window.setTimeout(() => void putSong(song), 250); };

  const preview = async (seg: Segment) => {
    stopAll();
    try {
      const stems = await loadStems(song);
      playing = await play({ tracks: fullMixTracks(song, stems, seg.start), on: {}, duration: seg.end - seg.start });
    } catch (e) { toast(e instanceof StemMissingError ? t('stemMissing') : (e as Error).message); }
  };

  const all = () => song.sections.flatMap((s) => s.segments);
  // Lines touch each other: moving one boundary moves the neighbour too.
  const move = (seg: Segment, which: 'start' | 'end', d: number) => {
    const segs = all();
    const i = segs.indexOf(seg);
    const prev = segs[i - 1], next = segs[i + 1];
    if (which === 'start') {
      const v = Math.max(prev ? prev.start + 0.2 : 0, Math.min(seg.end - 0.2, seg.start + d));
      if (prev && Math.abs(prev.end - seg.start) < 0.001) prev.end = v;
      seg.start = v;
    } else {
      const v = Math.min(next ? next.end - 0.2 : song.duration, Math.max(seg.start + 0.2, seg.end + d));
      if (next && Math.abs(next.start - seg.end) < 0.001) next.start = v;
      seg.end = v;
    }
  };

  const render = () => {
    root.replaceChildren();
    root.append(h('div', { class: 'row wrap', style: 'justify-content:center;margin-bottom:8px' },
      h('button', { onclick: () => go(`/song/${id}`) }, t('startPractising')),
      h('button', { class: 'secondary', onclick: () => go(`/tap/${id}`) }, t('reTap')),
      h('button', { class: 'ghost', onclick: () => go(`/details/${id}`) }, t('details')),
    ));
    root.append(h('p', { class: 'muted small center' }, t('editHelp')));
    const timeEls: { seg: Segment; el: HTMLElement }[] = [];
    const refreshTimes = () => timeEls.forEach(({ seg, el }) => { el.textContent = `${fmt(seg.start)}–${fmt(seg.end)}`; });
    song.sections.forEach((sec, si) => {
      const name = h('input', { type: 'text', value: sec.name }) as HTMLInputElement;
      name.addEventListener('change', () => { sec.name = name.value.trim() || t('section', { n: si + 1 }); save(); });
      const card = h('div', { class: 'card' },
        h('div', { class: 'row' }, h('div', { class: 'grow' }, name),
          si > 0 ? h('button', { class: 'ghost', onclick: () => {
            song.sections[si - 1].segments.push(...sec.segments);
            song.sections.splice(si, 1);
            save(); render();
          } }, t('mergeUp')) : null),
      );
      sec.segments.forEach((seg, li) => {
        const times = h('span', { class: 't' });
        timeEls.push({ seg, el: times });
        const nameIn = h('input', { type: 'text', value: seg.name, placeholder: t('line', { n: li + 1 }), style: 'padding:6px 10px' }) as HTMLInputElement;
        nameIn.addEventListener('change', () => { seg.name = nameIn.value.trim(); save(); });
        const nb = (which: 'start' | 'end', dir: number) => {
          const b = h('button', { class: 'secondary nudge' }, dir < 0 ? '−' : '+');
          holdRepeat(b, (mult) => { move(seg, which, dir * NUDGE * mult); refreshTimes(); save(); });
          return b;
        };
        const isLastInSection = li === sec.segments.length - 1;
        card.append(h('div', { class: 'seg-row', style: 'flex-direction:column;align-items:stretch' },
          h('div', { class: 'row' }, h('button', { class: 'blue', onclick: () => preview(seg) }, '▶'), h('div', { class: 'grow' }, nameIn), times),
          h('div', { class: 'row wrap', style: 'gap:6px' },
            h('span', { class: 'small muted' }, t('start')), nb('start', -1), nb('start', 1),
            h('span', { class: 'small muted' }, t('end')), nb('end', -1), nb('end', 1),
            h('span', { class: 'grow' }),
            !isLastInSection ? h('button', { class: 'ghost', title: t('mergeNext'), onclick: () => {
              const nxt = sec.segments[li + 1];
              seg.end = nxt.end;
              sec.segments.splice(li + 1, 1);
              save(); render();
            } }, '⤓ ' + t('mergeNext')) : null,
            li > 0 ? h('button', { class: 'ghost', title: t('splitHere'), onclick: () => {
              const moved = sec.segments.splice(li);
              song.sections.splice(si + 1, 0, { id: uid(), name: t('section', { n: song.sections.length + 1 }), segments: moved });
              save(); render();
            } }, '✂') : null,
            h('button', { class: 'danger', onclick: () => {
              if (!confirm(t('deleteLine'))) return;
              sec.segments.splice(li, 1);
              song.sections = song.sections.filter((s) => s.segments.length);
              save(); render();
            } }, '🗑'),
          )));
      });
      root.append(card);
    });
    refreshTimes();
    root.append(h('hr'), h('button', { class: 'danger full', onclick: async () => {
      if (!confirm(t('deleteSongQ', { t: song.title }))) return;
      stopAll();
      window.clearTimeout(saveTimer);
      deleted = true;
      await deleteSong(song);
      go('/');
    } }, t('deleteSong')));
  };
  render();
  return () => { stopAll(); window.clearTimeout(saveTimer); if (!deleted) void putSong(song); };
}
