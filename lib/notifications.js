import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const CHANNEL_ID = 'reminders';
const MAX_SCHEDULED = 60; // iOS hard limit is 64, keep headroom.

// Current expo-notifications handler API (SDK 53+).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const MESSAGES_DEFAULT = [
  (name) => `Où en es-tu sur "${name}" ?`,
  (name) => `Petit point sur "${name}" ?`,
  (name) => `C'est le moment pour "${name}".`,
  (name) => `As-tu avancé sur "${name}" ?`,
  (name) => `Check-in rapide : "${name}".`,
];

const MESSAGES_TALLY = [
  (name) => `Depuis le dernier rappel, combien de fois pour "${name}" ?`,
  (name) => `Point conso « ${name} » : combien depuis tout à l'heure ?`,
  (name) => `Note ta conso de "${name}" depuis le dernier rappel.`,
];

function messageFor(habit) {
  const set = habit.type === 'tally' ? MESSAGES_TALLY : MESSAGES_DEFAULT;
  return set[Math.floor(Math.random() * set.length)](habit.name);
}

function parseHM(s) {
  const [h, m] = String(s).split(':').map((n) => parseInt(n, 10));
  return { h: h || 0, m: m || 0 };
}

// Creates the Android channel (must exist BEFORE scheduling) and asks for
// permission. Returns true when notifications are allowed.
export async function setupNotifications() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Rappels',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
      lightColor: '#4f8cff',
    });
  }

  // Notifications interactives : boutons d'action.
  // opensAppToForeground:true → fiable en Expo Go (ouvre l'app pour appliquer).
  // "Rien" enregistre un 0 explicite : le jour devient "renseigné" au lieu
  // d'un trou dans les données (Android n'affiche que les 3 premiers boutons,
  // iOS les 4).
  await Notifications.setNotificationCategoryAsync('tally', [
    { identifier: 'plus1', buttonTitle: '+1', options: { opensAppToForeground: true } },
    { identifier: 'plus3', buttonTitle: '+3', options: { opensAppToForeground: true } },
    { identifier: 'zero', buttonTitle: 'Rien', options: { opensAppToForeground: true } },
    { identifier: 'plus5', buttonTitle: '+5', options: { opensAppToForeground: true } },
  ]);
  await Notifications.setNotificationCategoryAsync('done', [
    { identifier: 'done', buttonTitle: 'Fait', options: { opensAppToForeground: true } },
    { identifier: 'notdone', buttonTitle: 'Pas fait', options: { opensAppToForeground: true } },
  ]);

  const current = await Notifications.getPermissionsAsync();
  let status = current.status;
  if (status !== 'granted') {
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  return status === 'granted';
}

// Returns the list of Date objects at which to fire reminders on `date`.
function reminderTimesForDay(date, settings) {
  const times = [];

  if (settings.mode === 'fixed') {
    for (const t of settings.fixedTimes || []) {
      const { h, m } = parseHM(t);
      const d = new Date(date);
      d.setHours(h, m, 0, 0);
      times.push(d);
    }
    return times;
  }

  // Random mode: split [windowStart, windowEnd] into perDay slots and pick a
  // random minute inside each slot so reminders never stack up together.
  const start = parseHM(settings.windowStart);
  const end = parseHM(settings.windowEnd);
  const startMin = start.h * 60 + start.m;
  const endMin = end.h * 60 + end.m;
  const span = Math.max(0, endMin - startMin);
  const perDay = Math.max(1, settings.perDay || 1);
  const slot = span / perDay;

  for (let i = 0; i < perDay; i += 1) {
    const slotStart = startMin + slot * i;
    const minutes = Math.round(slotStart + Math.random() * slot);
    const d = new Date(date);
    d.setHours(0, minutes, 0, 0);
    times.push(d);
  }
  return times;
}

// Sliding window: cancel everything, then re-plan `horizonDays` ahead, capping
// at MAX_SCHEDULED. Call this on launch and whenever the app returns to the
// foreground (AppState) so the window keeps sliding.
export async function rescheduleAll(habits, settings) {
  await Notifications.cancelAllScheduledNotificationsAsync();

  if (!habits || habits.length === 0) return 0;

  const now = new Date();
  const horizon = Math.max(1, settings.horizonDays || 7);
  let scheduled = 0;

  for (let day = 0; day < horizon && scheduled < MAX_SCHEDULED; day += 1) {
    const date = new Date();
    date.setDate(now.getDate() + day);

    const times = reminderTimesForDay(date, settings).sort((a, b) => a - b);

    for (const time of times) {
      if (scheduled >= MAX_SCHEDULED) break;
      if (time <= now) continue; // never schedule in the past

      const habit = habits[Math.floor(Math.random() * habits.length)];
      const categoryIdentifier =
        habit.type === 'tally' ? 'tally' : habit.type === 'bool' ? 'done' : undefined;

      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Habits',
          body: messageFor(habit),
          data: { habitId: habit.id },
          categoryIdentifier,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: time,
          channelId: CHANNEL_ID,
        },
      });
      scheduled += 1;
    }
  }

  return scheduled;
}
