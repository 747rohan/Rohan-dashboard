import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import './styles.css';
import { watchForNewBuild } from './buildWatch.js';

createApp(App).use(createPinia()).mount('#app');
watchForNewBuild();
