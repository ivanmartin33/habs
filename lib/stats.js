// Pure JS helpers to compute habit statistics from entries.
// All "completion" logic depends on the habit type:
//   bool  -> done when value >= 1
//   count -> done when value >= target (objective)
//   scale -> done when value >= target (success threshold, default 3)

export function dateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export const todayKey = () => dateKey(new Date());

// The last check-in of a given day wins (highest timestamp).
export function lastEntryForDay(entries, habitId, key) {
  let best = null;
  for (const e of entries) {
    if (e.habitId === habitId && e.date === key) {
      if (!best || e.ts > best.ts) best = e;
    }
  }
  return best;
}

export function successThreshold(habit) {
  if (habit.type === 'bool') return 1;
  if (habit.type === 'count') return habit.target || 1;
  if (habit.type === 'scale') return habit.target || 3;
  return 1;
}

export function isCompleted(habit, entry) {
  if (!entry) return false;
  return Number(entry.value) >= successThreshold(habit);
}

export function isDayCompleted(habit, entries, key) {
  return isCompleted(habit, lastEntryForDay(entries, habit.id, key));
}

// Consecutive completed days ending today. A missing/incomplete *today*
// does not break a streak that was alive yesterday.
export function currentStreak(habit, entries) {
  let streak = 0;
  const d = new Date();
  if (!isDayCompleted(habit, entries, dateKey(d))) {
    d.setDate(d.getDate() - 1); // grace for today
  }
  while (isDayCompleted(habit, entries, dateKey(d))) {
    streak += 1;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

// Fraction (0..1) of the last `days` days that were completed.
export function completionRate(habit, entries, days = 30) {
  let done = 0;
  const d = new Date();
  for (let i = 0; i < days; i += 1) {
    if (isDayCompleted(habit, entries, dateKey(d))) done += 1;
    d.setDate(d.getDate() - 1);
  }
  return done / days;
}

// Oldest -> newest list of the last `n` days for the mini chart.
export function lastNDays(habit, entries, n = 14) {
  const out = [];
  const d = new Date();
  for (let i = 0; i < n; i += 1) {
    const key = dateKey(d);
    const entry = lastEntryForDay(entries, habit.id, key);
    out.push({
      date: key,
      value: entry ? Number(entry.value) : 0,
      done: isCompleted(habit, entry),
    });
    d.setDate(d.getDate() - 1);
  }
  return out.reverse();
}

// --- Helpers pour le type "tally" (consommation = somme des incréments) ---

// Total cumulé d'un jour (somme des valeurs, contrairement au "dernier gagne").
export function dayTotal(entries, habitId, key) {
  let total = 0;
  for (const e of entries) {
    if (e.habitId === habitId && e.date === key) total += Number(e.value) || 0;
  }
  return total;
}

// Somme des incréments depuis un timestamp donné.
export function sumSince(entries, habitId, sinceTs) {
  let total = 0;
  for (const e of entries) {
    if (e.habitId === habitId && e.ts >= sinceTs) total += Number(e.value) || 0;
  }
  return total;
}

// Oldest -> newest des totaux quotidiens, pour le graphe de consommation.
export function lastNDaysTotals(habitId, entries, n = 14) {
  const out = [];
  const d = new Date();
  for (let i = 0; i < n; i += 1) {
    const key = dateKey(d);
    out.push({ date: key, total: Math.max(0, dayTotal(entries, habitId, key)) });
    d.setDate(d.getDate() - 1);
  }
  return out.reverse();
}

// "il y a 2 h" / "il y a 5 min" / "à l'instant".
export function relTime(ts) {
  const min = Math.round((Date.now() - ts) / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  return `il y a ${h} h`;
}
