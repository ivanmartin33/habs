// Pure JS helpers to compute habit statistics from entries.
// All "completion" logic depends on the habit type:
//   bool  -> done when value >= 1
//   count -> done when value >= target (objective)
//   scale -> done when value >= target (success threshold, default 3)
//
// Distinction clé pour ne pas fausser les stats :
//   - jour SANS check-in  -> "non renseigné" (on ne sait pas, exclu des taux)
//   - jour AVEC check-in  -> "renseigné", même si la valeur est un 0 explicite
// Un 0 explicite (bouton "Rien" / "Pas fait") compte comme renseigné-échoué,
// alors qu'une absence d'entrée ne compte ni en succès ni en échec.

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

// Un jour est "renseigné" dès qu'il possède au moins un check-in (même 0).
export function isDayNoted(entries, habitId, key) {
  for (const e of entries) {
    if (e.habitId === habitId && e.date === key) return true;
  }
  return false;
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

// Âge de l'habitude en jours (aujourd'hui inclus), borné à `cap`.
// Sert à ne pas compter les jours d'avant la création dans les fenêtres.
export function ageInDays(habit, cap = Infinity) {
  if (!habit.createdAt) return cap === Infinity ? 1 : cap;
  const c = new Date(habit.createdAt);
  c.setHours(0, 0, 0, 0);
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  const days = Math.floor((t - c) / 86400000) + 1;
  return Math.max(1, Math.min(cap, days));
}

// Stats de complétion sur les `days` derniers jours, en distinguant
// renseigné / non renseigné :
//   window -> jours observables (borné par la date de création)
//   noted  -> jours avec au moins un check-in
//   done   -> jours renseignés ET réussis
// Le taux de réussite honnête est done / noted, pas done / window.
export function completionStats(habit, entries, days = 30) {
  const windowDays = ageInDays(habit, days);
  let done = 0;
  let noted = 0;
  const d = new Date();
  for (let i = 0; i < windowDays; i += 1) {
    const key = dateKey(d);
    if (isDayNoted(entries, habit.id, key)) {
      noted += 1;
      if (isDayCompleted(habit, entries, key)) done += 1;
    }
    d.setDate(d.getDate() - 1);
  }
  return { done, noted, window: windowDays };
}

// Oldest -> newest list of the last `n` days for the bar chart.
export function lastNDays(habit, entries, n = 14) {
  const out = [];
  const d = new Date();
  for (let i = 0; i < n; i += 1) {
    const key = dateKey(d);
    const entry = lastEntryForDay(entries, habit.id, key);
    out.push({
      date: key,
      value: entry ? Number(entry.value) : 0,
      noted: !!entry,
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

// Somme des incréments depuis un timestamp donné. `onDate` (clé YYYY-MM-DD)
// restreint aux entrées de ce jour : une correction d'un jour passé (ts
// récent mais date ancienne) ne doit pas gonfler "depuis le dernier rappel".
export function sumSince(entries, habitId, sinceTs, onDate = null) {
  let total = 0;
  for (const e of entries) {
    if (e.habitId !== habitId || e.ts < sinceTs) continue;
    if (onDate && e.date !== onDate) continue;
    total += Number(e.value) || 0;
  }
  return total;
}

// Oldest -> newest des totaux quotidiens, pour le graphe de consommation.
// `noted` distingue un vrai 0 (renseigné) d'un jour sans donnée.
export function lastNDaysTotals(habitId, entries, n = 14) {
  const out = [];
  const d = new Date();
  for (let i = 0; i < n; i += 1) {
    const key = dateKey(d);
    out.push({
      date: key,
      total: Math.max(0, dayTotal(entries, habitId, key)),
      noted: isDayNoted(entries, habitId, key),
    });
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
