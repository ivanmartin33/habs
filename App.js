import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
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
import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';

import {
  COLORS,
  DEFAULT_SETTINGS,
  getEntries,
  getHabits,
  getLastReminder,
  getSettings,
  saveEntries,
  saveHabits,
  saveLastReminder,
  saveSettings,
  uid,
} from './lib/storage';
import {
  ageInDays,
  completionStats,
  currentStreak,
  dayTotal,
  isDayCompleted,
  isDayNoted,
  lastEntryForDay,
  lastNDays,
  lastNDaysTotals,
  relTime,
  sumSince,
  todayKey,
} from './lib/stats';
import { rescheduleAll, setupNotifications } from './lib/notifications';
import { exportCSV } from './lib/export';

/* ============================== THEME ============================== */
// Palette sobre, inspirée du dark mode iOS.
const ACCENT = '#0a84ff';
const BG = '#000000';
const SURFACE = '#1c1c1e';
const SURFACE2 = '#2c2c2e';
const SEP = 'rgba(84,84,88,0.55)';
const LABEL = '#ffffff';
const LABEL2 = 'rgba(235,235,245,0.6)';
const DANGER = '#ff453a';
const SUCCESS = '#30d158';

const SCROLL_TOP = 132;
const SCROLL_BOTTOM = 116; // barre flottante (bottom 28 + hauteur ~56) + marge

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
function frDateLabel(d) {
  const s = `${JOURS[d.getDay()]} ${d.getDate()} ${MOIS[d.getMonth()]}`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const JOURS_COURT = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const MOIS_COURT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
// "mar. 5 août" à partir d'une clé YYYY-MM-DD.
function frShortDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return `${JOURS_COURT[date.getDay()]} ${d} ${MOIS_COURT[m - 1]}`;
}

// Version translucide d'une couleur hex (barres "renseigné mais pas réussi").
function dim(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// Liquid Glass (iOS 26+, SDK 54+). try/catch : un client Expo Go trop ancien
// sans le module natif ne doit pas faire crasher l'app au démarrage.
let LIQUID_GLASS = false;
try {
  LIQUID_GLASS = isLiquidGlassAvailable();
} catch (e) {
  LIQUID_GLASS = false;
}

// En-tête / barre d'onglets : vrai Liquid Glass quand dispo, sinon flou
// expo-blur (Android, iOS < 26, "Réduire la transparence" activé…).
function GlassChrome({ style, fallbackStyle, isInteractive, children }) {
  if (LIQUID_GLASS) {
    return (
      <GlassView glassEffectStyle="regular" colorScheme="dark" isInteractive={isInteractive} style={style}>
        {children}
      </GlassView>
    );
  }
  return (
    <BlurView intensity={50} tint="dark" experimentalBlurMethod="dimezisBlurView" style={[style, fallbackStyle]}>
      {children}
    </BlurView>
  );
}

const TABS = [
  { key: 'today', label: "Aujourd'hui", icon: 'today', iconOutline: 'today-outline' },
  { key: 'habits', label: 'Habitudes', icon: 'list', iconOutline: 'list-outline' },
  { key: 'stats', label: 'Stats', icon: 'stats-chart', iconOutline: 'stats-chart-outline' },
  { key: 'settings', label: 'Réglages', icon: 'settings', iconOutline: 'settings-outline' },
];
const TYPE_LABELS = { bool: 'Oui / Non', count: 'Compteur', scale: 'Échelle 1-5', tally: 'Consommation' };

export default function App() {
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState('today');
  const [habits, setHabits] = useState([]);
  const [entries, setEntries] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [lastReminderAt, setLastReminderAt] = useState(0);

  const latest = useRef({ habits, settings, entries });
  latest.current = { habits, settings, entries };

  // Animation de transition entre onglets (fondu + léger glissement).
  const anim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    anim.setValue(0);
    Animated.timing(anim, { toValue: 1, duration: 240, useNativeDriver: true }).start();
  }, [tab]);

  useEffect(() => {
    (async () => {
      const [h, e, s, r] = await Promise.all([
        getHabits(),
        getEntries(),
        getSettings(),
        getLastReminder(),
      ]);
      setHabits(h);
      setEntries(e);
      setSettings(s);
      setLastReminderAt(r || 0);
      setReady(true);
      await setupNotifications();
      await rescheduleAll(h, s);
    })();
  }, []);

  // Mémorise quand un rappel arrive / est tapé → pour "depuis le dernier rappel",
  // et applique les boutons d'action (+1/+3/+5, Fait) tapés depuis la notif.
  useEffect(() => {
    const mark = () => {
      const ts = Date.now();
      setLastReminderAt(ts);
      saveLastReminder(ts);
    };
    const recv = Notifications.addNotificationReceivedListener(mark);
    const resp = Notifications.addNotificationResponseReceivedListener((response) => {
      mark();
      setTab('today'); // ouvrir sur Aujourd'hui pour voir le check-in appliqué
      const action = response.actionIdentifier;
      const habitId = response?.notification?.request?.content?.data?.habitId;
      // 'zero' / 'notdone' enregistrent un 0 explicite : le jour devient
      // "renseigné" au lieu de rester un trou dans les données.
      const ACTION_VALUES = { plus1: 1, plus3: 3, plus5: 5, done: 1, zero: 0, notdone: 0 };
      const value = ACTION_VALUES[action];
      if (value !== undefined && habitId) {
        const { habits: h, entries: e } = latest.current;
        if (h.some((x) => x.id === habitId)) {
          const entry = { id: uid(), habitId, date: todayKey(), ts: Date.now(), value };
          const next = [...e, entry];
          setEntries(next);
          saveEntries(next);
        }
      }
    });
    return () => {
      recv.remove();
      resp.remove();
    };
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
      const entry = { id: uid(), habitId: habit.id, date: todayKey(), ts: Date.now(), value };
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

  const animStyle = {
    opacity: anim,
    transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
  };

  return (
    <View style={styles.app}>
      <StatusBar style="light" />

      <Animated.View style={[styles.body, animStyle]}>
        {tab === 'today' && (
          <TodayScreen habits={habits} entries={entries} lastReminderAt={lastReminderAt} onCheckIn={checkIn} />
        )}
        {tab === 'habits' && (
          <HabitsScreen habits={habits} onChange={persistHabits} entries={entries} onEntriesChange={persistEntries} />
        )}
        {tab === 'stats' && <StatsScreen habits={habits} entries={entries} onEntriesChange={persistEntries} />}
        {tab === 'settings' && (
          <SettingsScreen settings={settings} onChange={persistSettings} habits={habits} entries={entries} />
        )}
      </Animated.View>

      {/* En-tête en verre (Liquid Glass si dispo, sinon flou) */}
      <GlassChrome style={styles.header} fallbackStyle={styles.headerFallback}>
        <Text style={styles.title}>{TABS.find((t) => t.key === tab).label}</Text>
        {tab === 'today' && <Text style={styles.headerSubtitle}>{frDateLabel(new Date())}</Text>}
      </GlassChrome>

      {/* Barre d'onglets flottante en verre, façon iOS 26 */}
      <GlassChrome style={styles.tabBar} fallbackStyle={styles.tabBarFallback} isInteractive>
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <Pressable
              key={t.key}
              style={({ pressed }) => [styles.tabButton, pressed && styles.pressed]}
              onPress={() => setTab(t.key)}
            >
              <Ionicons name={active ? t.icon : t.iconOutline} size={24} color={active ? ACCENT : LABEL2} />
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </GlassChrome>
    </View>
  );
}

/* ----------------------------- Today ----------------------------- */

function TodayScreen({ habits, entries, lastReminderAt, onCheckIn }) {
  if (habits.length === 0) {
    return <EmptyState text="Aucune habitude. Ajoute-en dans l'onglet « Habitudes »." />;
  }
  const key = todayKey();
  return (
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      {habits.map((habit) => {
        const last = lastEntryForDay(entries, habit.id, key);
        const done = habit.type !== 'tally' && isDayCompleted(habit, entries, key);
        return (
          <View key={habit.id} style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <View style={[styles.dot, { backgroundColor: habit.color }]} />
              <Text style={styles.cardTitle}>{habit.name}</Text>
              {done && <Ionicons name="checkmark-circle" size={22} color={SUCCESS} style={{ marginLeft: 'auto' }} />}
            </View>
            <TodayControl
              habit={habit}
              last={last}
              entries={entries}
              lastReminderAt={lastReminderAt}
              onCheckIn={onCheckIn}
            />
          </View>
        );
      })}
    </ScrollView>
  );
}

function TodayControl({ habit, last, entries, lastReminderAt, onCheckIn }) {
  if (habit.type === 'tally') {
    const key = todayKey();
    const noted = isDayNoted(entries, habit.id, key);
    const total = Math.max(0, dayTotal(entries, habit.id, key));
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const reminderTs = lastReminderAt && lastReminderAt >= startOfDay.getTime() ? lastReminderAt : 0;
    const sinceReminder = reminderTs ? Math.max(0, sumSince(entries, habit.id, reminderTs, key)) : null;
    return (
      <View>
        <View style={styles.tallyRow}>
          <Pressable
            style={({ pressed }) => [styles.circleBtn, pressed && styles.pressed]}
            onPress={() => total > 0 && onCheckIn(habit, -1)}
          >
            <Ionicons name="remove" size={22} color={LABEL} />
          </Pressable>
          <View style={styles.tallyCenter}>
            <Text style={styles.tallyTotal}>{total}</Text>
            <Text style={styles.tallyCaption}>aujourd'hui</Text>
          </View>
          <Pressable
            style={({ pressed }) => [styles.tallyPlus, pressed && styles.pressed]}
            onPress={() => onCheckIn(habit, 1)}
          >
            <Text style={styles.tallyPlusText}>+1</Text>
          </Pressable>
        </View>
        {!noted && (
          <Pressable
            style={({ pressed }) => [styles.ghostBtn, pressed && styles.pressed]}
            onPress={() => onCheckIn(habit, 0)}
          >
            <Text style={styles.ghostBtnText}>Rien aujourd'hui (noter 0)</Text>
          </Pressable>
        )}
        <Text style={[styles.muted, { textAlign: 'center', marginTop: 8 }]}>
          {sinceReminder != null
            ? `Depuis le dernier rappel : ${sinceReminder} (${relTime(reminderTs)})`
            : 'Depuis le dernier rappel : —'}
        </Text>
      </View>
    );
  }

  if (habit.type === 'bool') {
    const done = last && Number(last.value) >= 1;
    const notDone = !!last && !done; // 0 explicite ("pas fait")
    return (
      <View style={styles.boolRow}>
        <Pressable
          style={({ pressed }) => [styles.bigButton, styles.boolBtn, done && styles.bigButtonDone, pressed && styles.pressed]}
          onPress={() => onCheckIn(habit, 1)}
        >
          <Text style={styles.bigButtonText}>{done ? 'Fait ✓' : 'Fait'}</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.ghostBtn, styles.boolGhost, notDone && styles.ghostBtnActive, pressed && styles.pressed]}
          onPress={() => onCheckIn(habit, 0)}
        >
          <Text style={[styles.ghostBtnText, notDone && styles.ghostBtnTextActive]}>Pas fait</Text>
        </Pressable>
      </View>
    );
  }
  if (habit.type === 'count') {
    const value = last ? Number(last.value) : 0;
    return (
      <View style={styles.stepperRow}>
        <Pressable
          style={({ pressed }) => [styles.circleBtn, pressed && styles.pressed]}
          onPress={() => onCheckIn(habit, Math.max(0, value - 1))}
        >
          <Ionicons name="remove" size={22} color={LABEL} />
        </Pressable>
        <Text style={styles.stepValue}>{value} / {habit.target || 1}</Text>
        <Pressable
          style={({ pressed }) => [styles.circleBtn, pressed && styles.pressed]}
          onPress={() => onCheckIn(habit, value + 1)}
        >
          <Ionicons name="add" size={22} color={LABEL} />
        </Pressable>
      </View>
    );
  }
  const value = last ? Number(last.value) : 0;
  return (
    <View style={styles.scaleRow}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable
          key={n}
          style={({ pressed }) => [styles.scaleButton, value === n && styles.scaleButtonActive, pressed && styles.pressed]}
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
    let parsedTarget = 0; // tally = pas de limite (version simple)
    if (type === 'bool') parsedTarget = 1;
    else if (type === 'count') parsedTarget = Math.max(1, parseInt(target, 10) || 1);
    else if (type === 'scale') parsedTarget = Math.min(5, Math.max(1, parseInt(target, 10) || 3));
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
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <View style={styles.card}>
        <Text style={styles.label}>Nom</Text>
        <TextInput
          style={styles.input}
          placeholder="Ex : Méditer, Boire de l'eau…"
          placeholderTextColor={LABEL2}
          value={name}
          onChangeText={setName}
        />
        <Text style={styles.label}>Type de check-in</Text>
        <View style={styles.typeRowWrap}>
          {['bool', 'count', 'scale', 'tally'].map((t) => (
            <Pressable
              key={t}
              style={({ pressed }) => [styles.typeChip, type === t && styles.chipActive, pressed && styles.pressed]}
              onPress={() => {
                setType(t);
                setTarget(t === 'scale' ? '3' : '1');
              }}
            >
              <Text style={[styles.typeText, type === t && styles.typeTextActive]}>{TYPE_LABELS[t]}</Text>
            </Pressable>
          ))}
        </View>
        {(type === 'count' || type === 'scale') && (
          <>
            <Text style={styles.label}>{type === 'count' ? 'Objectif (par jour)' : 'Seuil de réussite (1-5)'}</Text>
            <TextInput style={styles.input} keyboardType="number-pad" value={target} onChangeText={setTarget} />
          </>
        )}
        {type === 'tally' && (
          <Text style={styles.muted}>Compteur de consommation : +1 à chaque fois, total cumulé par jour.</Text>
        )}
        <Pressable style={({ pressed }) => [styles.bigButton, pressed && styles.pressed]} onPress={addHabit}>
          <Text style={styles.bigButtonText}>Ajouter l'habitude</Text>
        </Pressable>
      </View>

      {habits.length === 0 ? (
        <EmptyState text="Aucune habitude pour l'instant." inline />
      ) : (
        habits.map((habit) => (
          <View key={habit.id} style={styles.rowCard}>
            <View style={[styles.dot, { backgroundColor: habit.color }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{habit.name}</Text>
              <Text style={styles.muted}>
                {TYPE_LABELS[habit.type]}{habit.type === 'count' || habit.type === 'scale' ? ` · cible ${habit.target}` : ''}
              </Text>
            </View>
            <Pressable onPress={() => removeHabit(habit)} hitSlop={10} style={({ pressed }) => pressed && styles.pressed}>
              <Ionicons name="trash-outline" size={22} color={DANGER} />
            </Pressable>
          </View>
        ))
      )}
    </ScrollView>
  );
}

/* ----------------------------- Stats ----------------------------- */

function StatsScreen({ habits, entries, onEntriesChange }) {
  if (habits.length === 0) {
    return <EmptyState text="Ajoute des habitudes pour voir des statistiques." />;
  }

  // Correction d'un jour passé depuis le graphe. Pour "tally" on ajoute un
  // delta (les entrées sont des incréments), sinon une entrée "dernier gagne".
  const setDayValue = (habit, key, value) => {
    if (habit.type === 'tally') {
      const current = Math.max(0, dayTotal(entries, habit.id, key));
      const delta = value - current;
      if (delta === 0 && isDayNoted(entries, habit.id, key)) return;
      onEntriesChange([...entries, { id: uid(), habitId: habit.id, date: key, ts: Date.now(), value: delta }]);
    } else {
      onEntriesChange([...entries, { id: uid(), habitId: habit.id, date: key, ts: Date.now(), value }]);
    }
  };

  // Effacer toutes les entrées du jour → il redevient "non renseigné".
  const clearDay = (habit, key) => {
    onEntriesChange(entries.filter((e) => !(e.habitId === habit.id && e.date === key)));
  };

  return (
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      {habits.map((habit) => (
        <HabitStatsCard key={habit.id} habit={habit} entries={entries} onSetDay={setDayValue} onClearDay={clearDay} />
      ))}
    </ScrollView>
  );
}

function HabitStatsCard({ habit, entries, onSetDay, onClearDay }) {
  const [selected, setSelected] = useState(null); // index de la barre touchée
  const [editing, setEditing] = useState(false);
  const isTally = habit.type === 'tally';

  const series = isTally
    ? lastNDaysTotals(habit.id, entries, 14).map((t) => ({ date: t.date, value: t.total, noted: t.noted, done: t.noted }))
    : lastNDays(habit, entries, 14);

  const onSelect = (i) => {
    setSelected(i === selected ? null : i);
    setEditing(false);
  };

  return (
    <View style={styles.card}>
      <View style={styles.cardHeaderRow}>
        <View style={[styles.dot, { backgroundColor: habit.color }]} />
        <Text style={styles.cardTitle}>{habit.name}</Text>
      </View>

      {isTally ? <TallyStatsRow habit={habit} entries={entries} series={series} /> : <ClassicStatsRow habit={habit} entries={entries} />}

      <Text style={styles.label}>14 derniers jours</Text>
      <BarChart series={series} color={habit.color} selected={selected} onSelect={onSelect} />
      {selected != null && (
        <DayDetail
          key={series[selected].date}
          habit={habit}
          day={series[selected]}
          editing={editing}
          onEdit={() => setEditing(true)}
          onCancel={() => setEditing(false)}
          onSave={(v) => {
            onSetDay(habit, series[selected].date, v);
            setEditing(false);
          }}
          onClear={() => {
            onClearDay(habit, series[selected].date);
            setEditing(false);
          }}
        />
      )}
      <Text style={styles.chartHint}>Barre grise = non renseigné · touche une barre pour voir / corriger</Text>
    </View>
  );
}

// Les taux sont calculés sur les jours renseignés uniquement, pour ne pas
// confondre "rien noté" (donnée manquante) et "0 explicite" (échec noté).
function ClassicStatsRow({ habit, entries }) {
  const streak = currentStreak(habit, entries);
  const cs = completionStats(habit, entries, 30);
  const rate = cs.noted ? `${Math.round((cs.done / cs.noted) * 100)} %` : '—';
  return (
    <View style={styles.statRow}>
      <Stat label="Série" value={`${streak} j`} />
      <Stat label="Réussite" value={rate} />
      <Stat label="Renseigné" value={`${cs.noted}/${cs.window} j`} />
    </View>
  );
}

function TallyStatsRow({ habit, entries, series }) {
  const window = ageInDays(habit, 14);
  const observable = series.slice(-window);
  const notedDays = observable.filter((d) => d.noted);
  const today = series[series.length - 1].value;
  const avg = notedDays.length
    ? (notedDays.reduce((a, d) => a + d.value, 0) / notedDays.length).toFixed(1)
    : '—';
  return (
    <View style={styles.statRow}>
      <Stat label="Aujourd'hui" value={`${today}`} />
      <Stat label="Moy. / j noté" value={`${avg}`} />
      <Stat label="Renseigné" value={`${notedDays.length}/${window} j`} />
    </View>
  );
}

function Stat({ label, value }) {
  return (
    <View style={styles.statBox}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

// Barres : couleur pleine = réussi, couleur atténuée = renseigné sans succès,
// gris = jour non renseigné. Chaque colonne est tapable (détail + correction).
function BarChart({ series, color, selected, onSelect }) {
  const max = Math.max(1, ...series.map((d) => (d.noted ? d.value : 0)));
  return (
    <View style={styles.chartRow}>
      {series.map((d, i) => {
        const h = d.noted ? Math.max(3, Math.round((d.value / max) * 54)) : 3;
        const bg = !d.noted ? SURFACE2 : d.done ? color : dim(color, 0.45);
        const isSel = selected === i;
        return (
          <Pressable key={d.date} style={styles.chartCol} onPress={() => onSelect(i)}>
            <View style={[styles.bar, { height: h, backgroundColor: bg }]} />
            <View style={[styles.barDot, isSel && { backgroundColor: color }]} />
          </Pressable>
        );
      })}
    </View>
  );
}

function dayValueLabel(habit, day) {
  if (!day.noted) return 'non renseigné';
  const v = Number(day.value);
  if (habit.type === 'bool') return v >= 1 ? 'fait ✓' : 'pas fait';
  if (habit.type === 'count') return `${v} / ${habit.target || 1}`;
  if (habit.type === 'scale') return `${v} / 5`;
  return `${v}`;
}

function DayDetail({ habit, day, editing, onEdit, onCancel, onSave, onClear }) {
  if (!editing) {
    return (
      <View style={styles.dayDetailRow}>
        <Text style={styles.dayDetailText}>
          {frShortDate(day.date)} · {dayValueLabel(habit, day)}
        </Text>
        <Pressable onPress={onEdit} hitSlop={8} style={({ pressed }) => pressed && styles.pressed}>
          <Text style={styles.dayDetailEdit}>Corriger</Text>
        </Pressable>
      </View>
    );
  }
  return <DayEditor habit={habit} day={day} onCancel={onCancel} onSave={onSave} onClear={onClear} />;
}

function DayEditor({ habit, day, onCancel, onSave, onClear }) {
  const [draft, setDraft] = useState(day.noted ? Math.max(0, Number(day.value)) : 0);
  const isStepper = habit.type === 'count' || habit.type === 'tally';
  return (
    <View style={styles.editorBlock}>
      {habit.type === 'bool' && (
        <View style={styles.editorRow}>
          <EditChip label="Fait ✓" active={day.noted && Number(day.value) >= 1} onPress={() => onSave(1)} />
          <EditChip label="Pas fait" active={day.noted && Number(day.value) < 1} onPress={() => onSave(0)} />
        </View>
      )}
      {habit.type === 'scale' && (
        <View style={styles.editorRow}>
          {[1, 2, 3, 4, 5].map((n) => (
            <EditChip key={n} label={String(n)} active={day.noted && Number(day.value) === n} onPress={() => onSave(n)} />
          ))}
        </View>
      )}
      {isStepper && (
        <View style={styles.editorRow}>
          <Pressable
            style={({ pressed }) => [styles.smallCircleBtn, pressed && styles.pressed]}
            onPress={() => setDraft(Math.max(0, draft - 1))}
          >
            <Ionicons name="remove" size={18} color={LABEL} />
          </Pressable>
          <Text style={styles.editorValue}>{draft}</Text>
          <Pressable
            style={({ pressed }) => [styles.smallCircleBtn, pressed && styles.pressed]}
            onPress={() => setDraft(draft + 1)}
          >
            <Ionicons name="add" size={18} color={LABEL} />
          </Pressable>
          <Pressable style={({ pressed }) => [styles.editorOk, pressed && styles.pressed]} onPress={() => onSave(draft)}>
            <Text style={styles.editorOkText}>OK</Text>
          </Pressable>
        </View>
      )}
      <View style={styles.editorFooter}>
        {day.noted && (
          <Pressable onPress={onClear} hitSlop={8} style={({ pressed }) => pressed && styles.pressed}>
            <Text style={styles.editorClear}>Effacer le jour</Text>
          </Pressable>
        )}
        <Pressable onPress={onCancel} hitSlop={8} style={({ pressed }) => [{ marginLeft: 'auto' }, pressed && styles.pressed]}>
          <Text style={styles.editorCancel}>Annuler</Text>
        </Pressable>
      </View>
    </View>
  );
}

function EditChip({ label, active, onPress }) {
  return (
    <Pressable style={({ pressed }) => [styles.editChip, active && styles.chipActive, pressed && styles.pressed]} onPress={onPress}>
      <Text style={[styles.typeText, active && styles.typeTextActive]}>{label}</Text>
    </Pressable>
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
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <View style={styles.card}>
        <Text style={styles.label}>Rappels par jour</Text>
        <View style={styles.stepperRow}>
          <Pressable
            style={({ pressed }) => [styles.circleBtn, pressed && styles.pressed]}
            onPress={() => set({ perDay: Math.max(1, settings.perDay - 1) })}
          >
            <Ionicons name="remove" size={26} color={LABEL} />
          </Pressable>
          <Text style={styles.stepValue}>{settings.perDay}</Text>
          <Pressable
            style={({ pressed }) => [styles.circleBtn, pressed && styles.pressed]}
            onPress={() => set({ perDay: Math.min(12, settings.perDay + 1) })}
          >
            <Ionicons name="add" size={26} color={LABEL} />
          </Pressable>
        </View>

        <Text style={styles.label}>Mode</Text>
        <View style={styles.segment}>
          {[{ k: 'random', l: 'Aléatoire' }, { k: 'fixed', l: 'Fixe' }].map((m) => (
            <Pressable
              key={m.k}
              style={({ pressed }) => [styles.segmentItem, settings.mode === m.k && styles.segmentItemActive, pressed && styles.pressed]}
              onPress={() => set({ mode: m.k })}
            >
              <Text style={[styles.typeText, settings.mode === m.k && styles.typeTextActive]}>{m.l}</Text>
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
                placeholderTextColor={LABEL2}
                onChangeText={(v) => set({ windowStart: v })}
              />
            </View>
            <View style={styles.inlineCol}>
              <Text style={styles.label}>Fin</Text>
              <TextInput
                style={styles.input}
                value={settings.windowEnd}
                placeholder="21:00"
                placeholderTextColor={LABEL2}
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
              placeholderTextColor={LABEL2}
              onChangeText={(v) => set({ fixedTimes: v.split(',').map((s) => s.trim()).filter(Boolean) })}
            />
          </>
        )}

        <Text style={styles.muted}>
          Fenêtre glissante de {settings.horizonDays} jours · max 60 notifications.
        </Text>
      </View>

      <View style={styles.card}>
        <Pressable style={({ pressed }) => [styles.bigButton, pressed && styles.pressed]} onPress={onExport}>
          <Ionicons name="share-outline" size={18} color="#fff" style={{ marginRight: 8 }} />
          <Text style={styles.bigButtonText}>Exporter en CSV</Text>
        </Pressable>
        <Text style={[styles.muted, { marginTop: 10 }]}>{entries.length} check-in(s) enregistré(s).</Text>
      </View>
    </ScrollView>
  );
}

/* ----------------------------- Shared ----------------------------- */

function EmptyState({ text, inline }) {
  return (
    <View style={[inline ? styles.emptyInline : styles.emptyFull]}>
      <Ionicons name="leaf-outline" size={40} color={LABEL2} style={{ marginBottom: 12 }} />
      <Text style={[styles.muted, { textAlign: 'center', fontSize: 15 }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: BG },
  center: { alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1 },
  scroll: { paddingHorizontal: 16, paddingTop: SCROLL_TOP, paddingBottom: SCROLL_BOTTOM },

  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 64,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  headerFallback: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: SEP,
    backgroundColor: 'rgba(0,0,0,0.2)',
    overflow: 'hidden',
  },
  title: { color: LABEL, fontSize: 34, fontWeight: '700', letterSpacing: 0.35 },
  headerSubtitle: { color: LABEL2, fontSize: 14, marginTop: 2 },

  card: {
    backgroundColor: SURFACE,
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
  },
  rowCard: {
    backgroundColor: SURFACE,
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 8 },
  cardTitle: { color: LABEL, fontSize: 16, fontWeight: '600', flexShrink: 1 },
  dot: { width: 10, height: 10, borderRadius: 5 },

  muted: { color: LABEL2, fontSize: 13 },
  label: { color: LABEL2, fontSize: 13, marginTop: 8, marginBottom: 4, fontWeight: '500' },

  input: {
    backgroundColor: SURFACE2,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: LABEL,
    fontSize: 16,
  },

  bigButton: {
    backgroundColor: ACCENT,
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    marginTop: 10,
  },
  bigButtonDone: { backgroundColor: '#1f6f4f' },
  bigButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },

  pressed: { opacity: 0.55 },

  boolRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  boolBtn: { flex: 1.6, marginTop: 0 },
  boolGhost: { flex: 1, marginTop: 0 },

  ghostBtn: {
    backgroundColor: SURFACE2,
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  ghostBtnText: { color: LABEL2, fontSize: 14, fontWeight: '600' },
  ghostBtnActive: { backgroundColor: 'rgba(255,69,58,0.22)' },
  ghostBtnTextActive: { color: '#ff6961' },

  stepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20, marginTop: 2 },
  circleBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: SURFACE2,
    alignItems: 'center', justifyContent: 'center',
  },
  stepValue: { color: LABEL, fontSize: 18, fontWeight: '600', minWidth: 72, textAlign: 'center' },

  scaleRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  scaleButton: { flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: SURFACE2, alignItems: 'center' },
  scaleButtonActive: { backgroundColor: ACCENT },
  scaleText: { color: LABEL, fontSize: 16, fontWeight: '700' },
  scaleTextActive: { color: '#fff' },

  typeRowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeChip: { flexGrow: 1, flexBasis: '45%', paddingVertical: 11, borderRadius: 10, backgroundColor: SURFACE2, alignItems: 'center' },
  chipActive: { backgroundColor: ACCENT },
  typeText: { color: LABEL, fontSize: 14, fontWeight: '600' },
  typeTextActive: { color: '#fff' },

  segment: { flexDirection: 'row', backgroundColor: SURFACE2, borderRadius: 10, padding: 3, gap: 3 },
  segmentItem: { flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center' },
  segmentItemActive: { backgroundColor: ACCENT },

  tallyRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  tallyCenter: { flex: 1, alignItems: 'center' },
  tallyPlus: { backgroundColor: ACCENT, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 28, alignItems: 'center' },
  tallyPlusText: { color: '#fff', fontSize: 20, fontWeight: '800' },
  tallyTotal: { color: LABEL, fontSize: 24, fontWeight: '700' },
  tallyCaption: { color: LABEL2, fontSize: 11 },

  statRow: { flexDirection: 'row', gap: 8, marginBottom: 6 },
  statBox: { flex: 1, backgroundColor: SURFACE2, borderRadius: 10, padding: 10, alignItems: 'center' },
  statValue: { color: LABEL, fontSize: 17, fontWeight: '700', marginBottom: 2 },
  statLabel: { color: LABEL2, fontSize: 11 },

  chartRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 64, marginTop: 4 },
  chartCol: { flex: 1, justifyContent: 'flex-end', alignItems: 'center' },
  bar: { width: '100%', borderRadius: 3 },
  barDot: { width: 4, height: 4, borderRadius: 2, marginTop: 3, backgroundColor: 'transparent' },
  chartHint: { color: LABEL2, fontSize: 11, marginTop: 6 },

  dayDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    backgroundColor: SURFACE2,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  dayDetailText: { color: LABEL, fontSize: 14, fontWeight: '600', flex: 1 },
  dayDetailEdit: { color: ACCENT, fontSize: 14, fontWeight: '600' },

  editorBlock: { marginTop: 8, backgroundColor: SURFACE2, borderRadius: 10, padding: 10 },
  editorRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  editorFooter: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  smallCircleBtn: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(118,118,128,0.24)',
    alignItems: 'center', justifyContent: 'center',
  },
  editorValue: { color: LABEL, fontSize: 18, fontWeight: '700', minWidth: 44, textAlign: 'center' },
  editorOk: { marginLeft: 'auto', backgroundColor: ACCENT, borderRadius: 9, paddingVertical: 8, paddingHorizontal: 20 },
  editorOkText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  editorClear: { color: DANGER, fontSize: 13, fontWeight: '600' },
  editorCancel: { color: LABEL2, fontSize: 13, fontWeight: '600' },
  editChip: {
    flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: 'center',
    backgroundColor: 'rgba(118,118,128,0.24)',
  },

  inlineRow: { flexDirection: 'row', gap: 12 },
  inlineCol: { flex: 1 },

  emptyFull: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, paddingTop: SCROLL_TOP },
  emptyInline: { alignItems: 'center', justifyContent: 'center', padding: 32 },

  tabBar: {
    position: 'absolute',
    bottom: 28,
    left: 16,
    right: 16,
    flexDirection: 'row',
    borderRadius: 32,
    paddingVertical: 8,
    paddingHorizontal: 6,
    overflow: 'hidden',
  },
  tabBarFallback: {
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: SEP,
  },
  tabButton: { flex: 1, alignItems: 'center', gap: 3, paddingVertical: 2 },
  tabLabel: { color: LABEL2, fontSize: 10, fontWeight: '600' },
  tabLabelActive: { color: ACCENT },
});
