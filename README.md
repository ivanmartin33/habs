# Habits — suivi d'habitudes 100% local (Expo / React Native)

Application mobile **sans serveur** : elle envoie plusieurs notifications locales
par jour pour demander « où en es-tu », tu fais un check-in rapide, elle calcule
des statistiques et exporte tout en CSV. Cible **iOS + Android**, testable via
**Expo Go**.

## Fonctionnalités

- **4 onglets** (navigation par état, sans `react-navigation`) :
  - **Aujourd'hui** — un check-in par habitude, contrôle adapté au type.
  - **Habitudes** — ajout (nom + type + objectif), liste, suppression.
  - **Stats** — série (streak), taux de réussite sur les jours renseignés,
    couverture (« Renseigné x/N j »), graphe interactif des 14 derniers jours
    (toucher une barre → détail du jour, correction ou effacement).
  - **Réglages** — nombre de rappels/jour, mode aléatoire ou fixe, export CSV.
- **Jours « non renseignés » vs 0 explicite** : un jour sans check-in est
  compté comme « non renseigné » (exclu des taux et moyennes), alors qu'un 0
  noté explicitement (« Pas fait », « Rien aujourd'hui », bouton « Rien » de la
  notification) compte comme un échec renseigné. Les barres grises du graphe
  signalent les jours sans donnée.
- **4 types d'habitude**, chacune avec son propre check-in :
  - `bool` → boutons « Fait » / « Pas fait » (0 explicite)
  - `count` → stepper −/+ avec `valeur / objectif`
  - `scale` → boutons 1 à 5 (seuil de réussite, défaut 3)
  - `tally` (Consommation) → bouton +1 cumulatif pour suivre une consommation
    (ex : cigarettes), plus « Rien aujourd'hui (noter 0) » tant que le jour est
    vide. Affiche le total du jour et « depuis le dernier rappel » ;
    stats = total/jour + moyenne sur les jours renseignés.
- **Notifications locales** avec **fenêtre glissante** (7 jours d'avance, plafond
  60 notifications pour rester sous la limite iOS de 64), replanifiées à chaque
  retour de l'app au premier plan.
- **Export CSV** via le partage natif.
- Données persistées en local avec **AsyncStorage** (aucun réseau).

## Modèle de données

```js
Habit    { id, name, type:'bool'|'count'|'scale', target, color, createdAt }
Entry    { id, habitId, date:'YYYY-MM-DD', ts, value }   // le dernier check-in du jour fait foi
Settings { perDay, mode:'random'|'fixed', windowStart, windowEnd, fixedTimes[], horizonDays }
```

## Structure

```
App.js                 # UI + navigation par onglets (état)
index.js               # point d'entrée Expo
app.json               # config Expo (plugin notifications, permissions, dark mode)
lib/storage.js         # persistance AsyncStorage
lib/notifications.js   # permissions, channel Android, planification glissante
lib/stats.js           # streak, taux de complétion, séries
lib/export.js          # génération + partage du CSV
.claude/skills/        # skills officiels Expo (github.com/expo/skills) pour
                       # les sessions Claude Code : expo-native-ui,
                       # expo-project-structure, expo-dev-client, expo-upgrade
```

## Installation

Ce dépôt contient déjà tout le code source. Deux options :

### Option A — cloner ce dépôt

```bash
git clone <ce-repo>
cd habs
npm install
npx expo start
```

### Option B — repartir d'un template neuf

```bash
# 1. Créer un projet blank (JavaScript)
npx create-expo-app@latest habits --template blank
cd habits

# 2. Installer les dépendances alignées sur le SDK
npx expo install expo-notifications @react-native-async-storage/async-storage \
  expo-file-system expo-sharing

# 3. Copier les fichiers de ce dépôt :
#    App.js, index.js, app.json, et le dossier lib/

# 4. Lancer
npx expo start
```

## Lancer et tester

```bash
npx expo start
```

1. Installe **Expo Go** sur ton téléphone (App Store / Google Play).
2. Scanne le **QR code** affiché dans le terminal.
3. Accepte la demande de **permission notifications** au démarrage.

> ⚠️ **Teste sur un vrai téléphone.** Les notifications locales programmées ne
> fonctionnent pas de façon fiable sur les simulateurs/émulateurs. Sur iOS, les
> notifications ne s'affichent pas quand l'app est au premier plan : mets l'app
> en arrière-plan pour les voir arriver.

## Notes techniques

- **Liquid Glass (iOS 26+)** : l'en-tête et la barre d'onglets flottante
  utilisent `expo-glass-effect` (`GlassView`, introduit avec le SDK 54) quand
  `isLiquidGlassAvailable()` est vrai — vrai verre système, y compris dans
  Expo Go. Fallback automatique sur `expo-blur` (Android, iOS < 26, ou
  « Réduire la transparence » activé).
- **Handler** : `setNotificationHandler` avec `shouldShowBanner`, `shouldShowList`
  et `shouldPlaySound` à `true` (API actuelle de `expo-notifications`).
- **Trigger par date** :
  `trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date }`.
- **Android** : le channel `reminders` (importance `HIGH`) est créé **avant**
  toute planification.
- **Fenêtre glissante** : `cancelAllScheduledNotificationsAsync()` puis
  replanification de `horizonDays` jours (plafond 60), à chaque passage au
  premier plan (`AppState`).
- **Mode aléatoire** : la plage `windowStart`–`windowEnd` est découpée en
  `perDay` créneaux ; une heure est tirée au hasard dans chaque créneau pour
  éviter les rappels collés. **Mode fixe** : utilise `fixedTimes`.
- **Export** : `expo-file-system` (import `legacy` pour `documentDirectory` +
  `writeAsStringAsync`) puis `expo-sharing`. Colonnes :
  `date, heure, habitude, type, valeur, timestamp`.
- **Notifications interactives** : catégories `tally` (boutons +1/+3/« Rien »/+5 ;
  Android n'affiche que les 3 premiers) et `done` (« Fait » / « Pas fait »),
  gérées via `setNotificationCategoryAsync` +
  `addNotificationResponseReceivedListener`. « Rien » / « Pas fait »
  enregistrent un 0 explicite pour que le jour compte comme renseigné. En Expo
  Go le bouton ouvre l'app pour appliquer l'incrément ; le vrai traitement en
  arrière-plan nécessite un build EAS.
- **Correction depuis les Stats** : toucher une barre du graphe montre la
  valeur du jour ; « Corriger » ajoute une entrée datée de ce jour (le dernier
  check-in fait foi ; pour `tally`, on ajoute un delta pour atteindre le
  nouveau total). « Effacer le jour » supprime les entrées du jour, qui
  redevient « non renseigné ».
