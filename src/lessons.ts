import type { Section, Segment, Song } from './db';
import { t } from './i18n';

export interface Lesson {
  key: string; // segment ids joined by '+'
  label: string;
  sectionId: string | null; // null = whole song
  segIds: string[];
  start: number;
  end: number;
}
export interface Unit { title: string; sectionId: string | null; lessons: Lesson[]; }

const mk = (segs: Segment[], label: string, sectionId: string | null): Lesson => ({
  key: segs.map((s) => s.id).join('+'),
  label,
  sectionId,
  segIds: segs.map((s) => s.id),
  start: segs[0].start,
  end: segs[segs.length - 1].end,
});

// Drill order: line 1, line 2, lines 1+2, line 3, line 4, lines 3+4, ... then the whole section.
export function sectionLessons(sec: Section): Lesson[] {
  const s = sec.segments;
  const out: Lesson[] = [];
  for (let i = 0; i < s.length; i += 2) {
    out.push(mk([s[i]], t('line', { n: i + 1 }), sec.id));
    if (i + 1 < s.length) {
      out.push(mk([s[i + 1]], t('line', { n: i + 2 }), sec.id));
      out.push(mk([s[i], s[i + 1]], t('lines', { a: i + 1, b: i + 2 }), sec.id));
    }
  }
  if (s.length > 2) out.push(mk(s, t('allLines', { n: s.length }), sec.id));
  return out;
}

export function units(song: Song): Unit[] {
  const res: Unit[] = song.sections
    .filter((sec) => sec.segments.length > 0)
    .map((sec) => ({ title: sec.name, sectionId: sec.id, lessons: sectionLessons(sec) }));
  const all = song.sections.flatMap((s) => s.segments);
  if (all.length > 1) res.push({ title: t('wholeSong'), sectionId: null, lessons: [mk(all, t('wholeSong'), null)] });
  return res;
}

export function allLessons(song: Song): Lesson[] { return units(song).flatMap((u) => u.lessons); }

export function findLesson(song: Song, key: string): Lesson | undefined {
  return allLessons(song).find((l) => l.key === key);
}

export function allSegments(song: Song): Segment[] { return song.sections.flatMap((s) => s.segments); }

export function segName(song: Song, id: string): string {
  for (const sec of song.sections) {
    const i = sec.segments.findIndex((s) => s.id === id);
    if (i >= 0) return sec.segments[i].name || `${sec.name} – ${t('line', { n: i + 1 })}`;
  }
  return t('line', { n: 1 });
}
