/* ============================================================
   firebase-config.js
   Inicialización de Firebase (Auth + Realtime Database + Storage).
   Se importa vía CDN con módulos ES — el proyecto no usa npm ni
   build step, así que este es el SDK modular v9+ cargado directo
   desde gstatic, no el paquete "firebase" de npm.
   ============================================================ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-storage.js";

export const firebaseConfig = {
  apiKey: "AIzaSyClu2_ZQXflm4QqyUM9B9PLpaQTnxNoobA",
  authDomain: "onboarding-uneq.firebaseapp.com",
  databaseURL: "https://onboarding-uneq-default-rtdb.firebaseio.com/",
  projectId: "onboarding-uneq",
  storageBucket: "onboarding-uneq.firebasestorage.app",
  messagingSenderId: "165589582297",
  appId: "1:165589582297:web:65f689e5ec7716d15999c8"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getDatabase(app);
export const storage = getStorage(app);
