/* ============================================================
   firebase-config.js — mismo proyecto de Firebase que
   onboarding-uneq (misma base de datos, nodo agendamiento/ aparte).
   Se duplica acá a propósito para que esta carpeta siga totalmente
   separada de la app de alumnos, sin importar nada entre carpetas.
   Estos valores no son secretos — son la configuración pública del
   cliente; la seguridad real la dan las reglas de la base de datos.
   ============================================================ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";

export const firebaseConfig = {
  apiKey: "AIzaSyClu2_ZQXflm4QqyUM9B9PLpaQTnxNoobA",
  authDomain: "onboarding-uneq.firebaseapp.com",
  databaseURL: "https://onboarding-uneq-default-rtdb.firebaseio.com/",
  projectId: "onboarding-uneq",
  storageBucket: "onboarding-uneq.firebasestorage.app",
  messagingSenderId: "165589582297",
  appId: "1:165589582297:web:65f689e5ec7716d15999c8"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);
