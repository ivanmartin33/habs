// CSV export using the legacy expo-file-system API (documentDirectory +
// writeAsStringAsync) followed by the native share sheet.
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

function escapeCsv(value) {
  const s = value == null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

// Columns: date, heure, habitude, type, valeur, timestamp
export function buildCsv(habits, entries) {
  const habitById = {};
  for (const h of habits) habitById[h.id] = h;

  const rows = [['date', 'heure', 'habitude', 'type', 'valeur', 'timestamp']];
  const sorted = [...entries].sort((a, b) => a.ts - b.ts);

  for (const e of sorted) {
    const habit = habitById[e.habitId];
    const d = new Date(e.ts);
    const heure = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
    rows.push([
      e.date,
      heure,
      habit ? habit.name : '(habitude supprimée)',
      habit ? habit.type : '',
      e.value,
      e.ts,
    ]);
  }

  return rows.map((r) => r.map(escapeCsv).join(',')).join('\n');
}

export async function exportCSV(habits, entries) {
  const csv = buildCsv(habits, entries);
  const uri = `${FileSystem.documentDirectory}habits-export.csv`;

  await FileSystem.writeAsStringAsync(uri, csv, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: 'text/csv',
      dialogTitle: 'Exporter les check-ins',
      UTI: 'public.comma-separated-values-text',
    });
  }

  return uri;
}
