import AsyncStorage from '@react-native-async-storage/async-storage';

// AsyncStorage keys
const HABITS_KEY = 'habits.v1';
const ENTRIES_KEY = 'entries.v1';
const SETTINGS_KEY = 'settings.v1';

export const DEFAULT_SETTINGS = {
  perDay: 3,
  mode: 'random', // 'random' | 'fixed'
  windowStart: '09:00',
  windowEnd: '21:00',
  fixedTimes: ['09:00', '13:00', '19:00'],
  horizonDays: 7,
};

// Palette used when creating habits.
export const COLORS = [
  '#4f8cff',
  '#34d399',
  '#fbbf24',
  '#f87171',
  '#a78bfa',
  '#f472b6',
  '#22d3ee',
  '#fb923c',
];

// Short, collision-resistant id good enough for a local-only app.
export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

async function load(key, fallback) {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw != null ? JSON.parse(raw) : fallback;
  } catch (e) {
    console.warn('storage load failed for', key, e);
    return fallback;
  }
}

async function save(key, value) {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn('storage save failed for', key, e);
  }
}

export const getHabits = () => load(HABITS_KEY, []);
export const saveHabits = (habits) => save(HABITS_KEY, habits);

export const getEntries = () => load(ENTRIES_KEY, []);
export const saveEntries = (entries) => save(ENTRIES_KEY, entries);

export const getSettings = async () => ({
  ...DEFAULT_SETTINGS,
  ...(await load(SETTINGS_KEY, {})),
});
export const saveSettings = (settings) => save(SETTINGS_KEY, settings);
