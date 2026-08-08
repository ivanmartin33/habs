import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App).
// It also sets up the environment for Expo Go and standalone builds.
registerRootComponent(App);

// Expo Snack rend l'export par défaut du point d'entrée déclaré dans
// package.json ("main") : sans cette ligne il affiche
// « No default export of 'index.js' to render! ». Sans effet en local.
export default App;
