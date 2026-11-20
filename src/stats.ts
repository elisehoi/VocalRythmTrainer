import { getStats, putStats } from './db';

export const dayKey = (d = new Date()) => {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
};

let pending = 0;
let flushTimer = 0;

// Count seconds spent playing or recording.
export function addPractice(seconds: number) {
  if (seconds <= 0) return;
  pending += seconds;
  window.clearTimeout(flushTimer);
  flushTimer = window.setTimeout(flush, 1500);
}

export async function flush() {
  if (pending <= 0) return;
  const s = await getStats();
  const k = dayKey();
  s.days[k] = (s.days[k] ?? 0) + pending;
  pending = 0;
  await putStats(s);
  window.dispatchEvent(new Event('stats-changed'));
}

const MIN_DAY_SECONDS = 60;

export async function summary(): Promise<{ streak: number; todayMin: number; weekMin: number; week: { day: string; min: number }[] }> {
  const s = await getStats();
  const d = new Date();
  const todaySec = s.days[dayKey(d)] ?? 0;
  // Streak: consecutive days with >= 1 minute, counting today only if already practised.
  let streak = 0;
  const cur = new Date(d);
  if (todaySec < MIN_DAY_SECONDS) cur.setDate(cur.getDate() - 1);
  while ((s.days[dayKey(cur)] ?? 0) >= MIN_DAY_SECONDS) { streak++; cur.setDate(cur.getDate() - 1); }
  // This week, Monday to Sunday.
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const week: { day: string; min: number }[] = [];
  let weekSec = 0;
  for (let i = 0; i < 7; i++) {
    const x = new Date(monday);
    x.setDate(monday.getDate() + i);
    const sec = s.days[dayKey(x)] ?? 0;
    weekSec += sec;
    week.push({ day: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i], min: Math.round(sec / 60) });
  }
  return { streak, todayMin: Math.round(todaySec / 60), weekMin: Math.round(weekSec / 60), week };
}
