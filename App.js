import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';

import {
  COLORS,
  DEFAULT_SETTINGS,
  getEntries,
  getHabits,
  getSettings,
  saveEntries,
  saveHabits,
  saveSettings,
  uid,
} from './lib/storage';
import {
  completionRate,
  currentStreak,
  isDayCompleted,
  lastEntryForDay,
  lastNDays,
  todayKey,
} from './lib/stats';
import { rescheduleAll, setupNotifications } from './lib/notifications';
import { exportCSV } from './lib/export';

const TABS = [
  { key: 'today', label: "Aujourd'hui" },
  { key: 'habits', label: 'Habitudes' },
  { key: 'stats', label: 'Stats' },
  { key: 'settings', label: 'Réglages' },
];

const TYPE_LABELS = { bool: 'Oui / Non', count: 'Compteur', scale: 'Échelle 1-5' };

export default function App() {
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState('today');
  const [habits, setHabits] = useState([]);
  const [entries, setEntries] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);

  // Keep latest values for the AppState listener without re-subscribing.
  const latest = useRef({ habits, settings });
  latest.current = { habits, settings };

  // Initial load + permission request + first schedule.
  useEffect(() => {
    (async () => {
      const [h, e, s] = await Promise.all([getHabits(), getEntries(), getSettings()]);
      setHabits(h);
      setEntries(e);
      setSettings(s);
      setReady(true);
      await setupNotifications();
      await rescheduleAll(h, s);
    })();
  }, []);

  // Re-plan the sliding window every time the app returns to the foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        const { habits: h, settings: s } = latest.current;
        rescheduleAll(h, s);
      }
    });
    return () => sub.remove();
  }, []);

  const persistHabits = useCallback(async (next) => {
    setHabits(next);
    await saveHabits(next);
    await rescheduleAll(next, latest.current.settings);
  }, []);

  const persistEntries = useCallback(async (next) => {
    setEntries(next);
    await saveEntries(next);
  }, []);

  const persistSettings = useCallback(async (next) => {
    setSettings(next);
    await saveSettings(next);
    await rescheduleAll(latest.current.habits, next);
  }, []);

  const checkIn = useCallback(
    (habit, value) => {
      const entry = {
        id: uid(),
        habitId: habit.id,
        date: todayKey(),
        ts: Date.now(),
        value,
      };
      persistEntries([...entries, entry]);
    },
    [entries, persistEntries]
  );

  if (!ready) {
    return (
      <View style={[styles.app, styles.center]}>
        <StatusBar style="light" />
        <Text style={styles.muted}>Chargement…</Text>
      </View>
    );
  }

  return (
    <View style={styles.app}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Text style={styles.title}>{TABS.find((t) => t.key === tab).label}</Text>
      </View>

      <View style={styles.body}>
        {tab === 'today' && (
          <TodayScreen habits={habits} entries={entries} onCheckIn={checkIn} />
        )}
        {tab === 'habits' && (
          <HabitsScreen habits={habits} onChange={persistHabits} entries={entries} onEntriesChange={persistEntries} />
        )}
        {tab === 'stats' && <StatsScreen habits={habits} entries={entries} />}
        {tab === 'settings' && (
          <SettingsScreen
            settings={settings}
            onChange={persistSettings}
            habits={habits}
            entries={entries}
          />
        )}
      </View>

      <View style={styles.tabBar}>
        {TABS.map((t) => (
          <Pressable key={t.key} style={styles.tabButton} onPress={() => setTab(t.key)}>
            <Text style={[styles.tabLabel, tab === t.key && styles.tabLabelActive]}>
              {t.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/* ----------------------------- Today ----------------------------- */

function TodayScreen({ habits, entries, onCheckIn }) {
  if (habits.length === 0) {
    return (
      <EmptyState text="Aucune habitude. Ajoute-en dans l'onglet « Habitudes »." />
    );
  }

  const key = todayKey();

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      {habits.map((habit) => {
        const last = lastEntryForDay(entries, habit.id, key);
        const done = isDayCompleted(habit, entries, key);
        return (
          <View key={habit.id} style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <View style={[styles.dot, { backgroundColor: habit.color }]} />
              <Text style={styles.cardTitle}>{habit.name}</Text>
              {done && <Text style={styles.badgeDone}>✓</Text>}
            </View>
            <TodayControl habit={habit} last={last} onCheckIn={onCheckIn} />
          </View>
        );
      })}
    </ScrollView>
  );
}

function TodayControl({ habit, last, onCheckIn }) {
  if (habit.type === 'bool') {
    const done = last && Number(last.value) >= 1;
    return (
      <Pressable
        style={[styles.bigButton, done && styles.bigButtonDone]}
        onPress={() => onCheckIn(habit, 1)}
      >
        <Text style={styles.bigButtonText}>
          {done ? 'Fait ✓ (re-marquer)' : 'Marquer comme fait'}
        </Text>
      </Pressable>
    );
  }

  if (habit.type === 'count') {
    const value = last ? Number(last.value) : 0;
    return (
      <View style={styles.stepperRow}>
        <Pressable
          style={styles.stepButton}
          onPress={() => onCheckIn(habit, Math.max(0, value - 1))}
        >
          <Text style={styles.stepButtonText}>−</Text>
        </Pressable>
        <Text style={styles.stepValue}>
          {value} / {habit.target || 1}
        </Text>
        <Pressable style={styles.stepButton} onPress={() => onCheckIn(habit, value + 1)}>
          <Text style={styles.stepButtonText}>+</Text>
        </Pressable>
      </View>
    );
  }

  // scale 1..5
  const value = last ? Number(last.value) : 0;
  return (
    <View style={styles.scaleRow}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable
          key={n}
          style={[styles.scaleButton, value === n && styles.scaleButtonActive]}
          onPress={() => onCheckIn(habit, n)}
        >
          <Text style={[styles.scaleText, value === n && styles.scaleTextActive]}>{n}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/* ----------------------------- Habits ----------------------------- */

function HabitsScreen({ habits, onChange, entries, onEntriesChange }) {
  const [name, setName] = useState('');
  const [type, setType] = useState('bool');
  const [target, setTarget] = useState('1');

  const addHabit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      Alert.alert('Nom requis', "Donne un nom à l'habitude.");
      return;
    }
    let parsedTarget = 1;
    if (type === 'count') parsedTarget = Math.max(1, parseInt(target, 10) || 1);
    if (type === 'scale') parsedTarget = Math.min(5, Math.max(1, parseInt(target, 10) || 3));

    const habit = {
      id: uid(),
      name: trimmed,
      type,
      target: parsedTarget,
      color: COLORS[habits.length % COLORS.length],
      createdAt: Date.now(),
    };
    onChange([...habits, habit]);
    setName('');
    setType('bool');
    setTarget('1');
  };

  const removeHabit = (habit) => {
    Alert.alert('Supprimer', `Supprimer « ${habit.name} » et ses check-ins ?`, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: () => {
          onChange(habits.filter((h) => h.id !== habit.id));
          onEntriesChange(entries.filter((e) => e.habitId !== habit.id));
        },
      },
    ]);
  };

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.card}>
        <Text style={styles.label}>Nom</Text>
        <TextInput
          style={styles.input}
          placeholder="Ex : Méditer, Boire de l'eau…"
          placeholderTextColor="#6b7280"
          value={name}
          onChangeText={setName}
        />

        <Text style={styles.label}>Type de check-in</Text>
        <View style={styles.typeRow}>
          {['bool', 'count', 'scale'].map((t) => (
            <Pressable
              key={t}
              style={[styles.typeButton, type === t && styles.typeButtonActive]}
              onPress={() => {
                setType(t);
                setTarget(t === 'scale' ? '3' : '1');
              }}
            >
              <Text style={[styles.typeText, type === t && styles.typeTextActive]}>
                {TYPE_LABELS[t]}
              </Text>
            </Pressable>
          ))}
        </View>

        {type !== 'bool' && (
          <>
            <Text style={styles.label}>
              {type === 'count' ? 'Objectif (par jour)' : 'Seuil de réussite (1-5)'}
            </Text>
            <TextInput
              style={styles.input}
              keyboardType="number-pad"
              value={target}
              onChangeText={setTarget}
            />
          </>
        )}

        <Pressable style={styles.bigButton} onPress={addHabit}>
          <Text style={styles.bigButtonText}>Ajouter l'habitude</Text>
        </Pressable>
      </View>

      {habits.length === 0 ? (
        <EmptyState text="Aucune habitude pour l'instant." />
      ) : (
        habits.map((habit) => (
          <View key={habit.id} style={styles.rowCard}>
            <View style={[styles.dot, { backgroundColor: habit.color }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{habit.name}</Text>
              <Text style={styles.muted}>
                {TYPE_LABELS[habit.type]}
                {habit.type !== 'bool' ? ` · cible ${habit.target}` : ''}
              </Text>
            </View>
            <Pressable onPress={() => removeHabit(habit)} hitSlop={10}>
              <Text style={styles.delete}>Suppr.</Text>
            </Pressable>
          </View>
        ))
      )}
    </ScrollView>
  );
}

/* ----------------------------- Stats ----------------------------- */

function StatsScreen({ habits, entries }) {
  if (habits.length === 0) {
    return <EmptyState text="Ajoute des habitudes pour voir des statistiques." />;
  }

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      {habits.map((habit) => {
        const streak = currentStreak(habit, entries);
        const rate = Math.round(completionRate(habit, entries, 30) * 100);
        const series = lastNDays(habit, entries, 14);
        return (
          <View key={habit.id} style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <View style={[styles.dot, { backgroundColor: habit.color }]} />
              <Text style={styles.cardTitle}>{habit.name}</Text>
            </View>
            <View style={styles.statRow}>
              <Stat label="Série" value={`${streak} j`} />
              <Stat label="Complétion 30 j" value={`${rate} %`} />
            </View>
            <Text style={styles.label}>14 derniers jours</Text>
            <MiniChart series={series} color={habit.color} />
          </View>
        );
      })}
    </ScrollView>
  );
}

function Stat({ label, value }) {
  return (
    <View style={styles.statBox}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.muted}>{label}</Text>
    </View>
  );
}

function MiniChart({ series, color }) {
  const max = Math.max(1, ...series.map((d) => d.value));
  return (
    <View style={styles.chartRow}>
      {series.map((d) => {
        const h = Math.max(4, Math.round((d.value / max) * 60));
        return (
          <View key={d.date} style={styles.chartCol}>
            <View
              style={[
                styles.bar,
                { height: h, backgroundColor: d.done ? color : '#374151' },
              ]}
            />
          </View>
        );
      })}
    </View>
  );
}

/* ----------------------------- Settings ----------------------------- */

function SettingsScreen({ settings, onChange, habits, entries }) {
  const set = (patch) => onChange({ ...settings, ...patch });

  const onExport = async () => {
    if (entries.length === 0) {
      Alert.alert('Rien à exporter', 'Fais quelques check-ins avant.');
      return;
    }
    try {
      await exportCSV(habits, entries);
    } catch (e) {
      Alert.alert('Export impossible', String(e?.message || e));
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.card}>
        <Text style={styles.label}>Rappels par jour</Text>
        <View style={styles.stepperRow}>
          <Pressable
            style={styles.stepButton}
            onPress={() => set({ perDay: Math.max(1, settings.perDay - 1) })}
          >
            <Text style={styles.stepButtonText}>−</Text>
          </Pressable>
          <Text style={styles.stepValue}>{settings.perDay}</Text>
          <Pressable
            style={styles.stepButton}
            onPress={() => set({ perDay: Math.min(12, settings.perDay + 1) })}
          >
            <Text style={styles.stepButtonText}>+</Text>
          </Pressable>
        </View>

        <Text style={styles.label}>Mode</Text>
        <View style={styles.typeRow}>
          {[
            { k: 'random', l: 'Aléatoire' },
            { k: 'fixed', l: 'Fixe' },
          ].map((m) => (
            <Pressable
              key={m.k}
              style={[styles.typeButton, settings.mode === m.k && styles.typeButtonActive]}
              onPress={() => set({ mode: m.k })}
            >
              <Text style={[styles.typeText, settings.mode === m.k && styles.typeTextActive]}>
                {m.l}
              </Text>
            </Pressable>
          ))}
        </View>

        {settings.mode === 'random' ? (
          <View style={styles.inlineRow}>
            <View style={styles.inlineCol}>
              <Text style={styles.label}>Début</Text>
              <TextInput
                style={styles.input}
                value={settings.windowStart}
                placeholder="09:00"
                placeholderTextColor="#6b7280"
                onChangeText={(v) => set({ windowStart: v })}
              />
            </View>
            <View style={styles.inlineCol}>
              <Text style={styles.label}>Fin</Text>
              <TextInput
                style={styles.input}
                value={settings.windowEnd}
                placeholder="21:00"
                placeholderTextColor="#6b7280"
                onChangeText={(v) => set({ windowEnd: v })}
              />
            </View>
          </View>
        ) : (
          <>
            <Text style={styles.label}>Heures fixes (séparées par des virgules)</Text>
            <TextInput
              style={styles.input}
              value={(settings.fixedTimes || []).join(', ')}
              placeholder="09:00, 13:00, 19:00"
              placeholderTextColor="#6b7280"
              onChangeText={(v) =>
                set({
                  fixedTimes: v
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
            />
          </>
        )}

        <Text style={styles.muted}>
          Fenêtre glissante de {settings.horizonDays} jours · max 60 notifications.
        </Text>
      </View>

      <View style={styles.card}>
        <Pressable style={styles.bigButton} onPress={onExport}>
          <Text style={styles.bigButtonText}>Exporter en CSV</Text>
        </Pressable>
        <Text style={styles.muted}>
          {entries.length} check-in(s) enregistré(s).
        </Text>
      </View>
    </ScrollView>
  );
}

/* ----------------------------- Shared ----------------------------- */

function EmptyState({ text }) {
  return (
    <View style={[styles.center, { flex: 1, padding: 32 }]}>
      <Text style={[styles.muted, { textAlign: 'center' }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: '#0b0f17', paddingTop: 48 },
  center: { alignItems: 'center', justifyContent: 'center' },
  header: { paddingHorizontal: 20, paddingBottom: 12 },
  title: { color: '#f9fafb', fontSize: 28, fontWeight: '700' },
  body: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 32 },

  card: {
    backgroundColor: '#151b27',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
  },
  rowCard: {
    backgroundColor: '#151b27',
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 10 },
  cardTitle: { color: '#f9fafb', fontSize: 18, fontWeight: '600', flexShrink: 1 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  badgeDone: { color: '#34d399', fontSize: 18, marginLeft: 'auto', fontWeight: '700' },

  muted: { color: '#9ca3af', fontSize: 13 },
  label: { color: '#cbd5e1', fontSize: 14, marginTop: 8, marginBottom: 6, fontWeight: '500' },

  input: {
    backgroundColor: '#0b0f17',
    borderColor: '#2a3344',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#f9fafb',
    fontSize: 16,
  },

  bigButton: {
    backgroundColor: '#4f8cff',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 12,
  },
  bigButtonDone: { backgroundColor: '#1f6f4f' },
  bigButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },

  stepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24 },
  stepButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#1f2937',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepButtonText: { color: '#f9fafb', fontSize: 26, fontWeight: '700' },
  stepValue: { color: '#f9fafb', fontSize: 20, fontWeight: '600', minWidth: 90, textAlign: 'center' },

  scaleRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  scaleButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: '#1f2937',
    alignItems: 'center',
  },
  scaleButtonActive: { backgroundColor: '#4f8cff' },
  scaleText: { color: '#cbd5e1', fontSize: 18, fontWeight: '700' },
  scaleTextActive: { color: '#fff' },

  typeRow: { flexDirection: 'row', gap: 8 },
  typeButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#1f2937',
    alignItems: 'center',
  },
  typeButtonActive: { backgroundColor: '#4f8cff' },
  typeText: { color: '#cbd5e1', fontSize: 13, fontWeight: '600' },
  typeTextActive: { color: '#fff' },

  delete: { color: '#f87171', fontWeight: '600' },

  statRow: { flexDirection: 'row', gap: 12, marginBottom: 8 },
  statBox: {
    flex: 1,
    backgroundColor: '#0b0f17',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
  },
  statValue: { color: '#f9fafb', fontSize: 22, fontWeight: '700', marginBottom: 2 },

  chartRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 70, marginTop: 6 },
  chartCol: { flex: 1, justifyContent: 'flex-end', alignItems: 'center' },
  bar: { width: '100%', borderRadius: 3 },

  inlineRow: { flexDirection: 'row', gap: 12 },
  inlineCol: { flex: 1 },

  tabBar: {
    flexDirection: 'row',
    borderTopColor: '#1f2937',
    borderTopWidth: 1,
    backgroundColor: '#0b0f17',
    paddingBottom: 24,
    paddingTop: 8,
  },
  tabButton: { flex: 1, alignItems: 'center', paddingVertical: 6 },
  tabLabel: { color: '#6b7280', fontSize: 12, fontWeight: '600' },
  tabLabelActive: { color: '#4f8cff' },
});
