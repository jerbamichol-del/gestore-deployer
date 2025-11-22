// utils/api.ts
import { hashPinWithSalt, verifyPin } from './auth';

// --- MOCK USER DATABASE in localStorage ---
// (Solo demo: NON sicuro per produzione)
export const getUsers = () => {
  try {
    return JSON.parse(localStorage.getItem('users_db') || '{}');
  } catch {
    return {};
  }
};
export const saveUsers = (users: any) => localStorage.setItem('users_db', JSON.stringify(users));

// URL Apps Script (web app "exec") — usato SOLO per inviare la mail
const SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbzmq-PTrMcMdrYqCRX29_S034zCaj5ttyc3tZhdhjV77wF6n99LKricFgzy7taGqKOo/exec';

// ------ Helpers ------
function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}
function buildResetRedirect(): string {
  // La tua pagina /reset su GitHub Pages
  return 'https://jerbamichol-del.github.io/gestore/reset/';
}
// Facoltativo: helper POST JSON (al momento non usato dopo la modifica)
async function postJSON<T = any>(url: string, data: any): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const out = await res.json().catch(() => ({}));
  const ok = out && (out.ok === true || out.success === true);
  return { ...out, ok, success: !!ok } as T;
}

// ------ API MOCK + integrazioni ------

/** Registra un nuovo utente (mock locale). */
export const register = async (
  email: string,
  pin: string
): Promise<{ success: boolean; message: string }> => {
  return new Promise(resolve => {
    setTimeout(async () => {
      const users = getUsers();
      const normalizedEmail = normalizeEmail(email);
      if (users[normalizedEmail]) {
        resolve({ success: false, message: 'Un utente con questa email esiste già.' });
        return;
      }
      const { hash, salt } = await hashPinWithSalt(pin);
      users[normalizedEmail] = { email: normalizedEmail, pinHash: hash, pinSalt: salt };
      saveUsers(users);
      resolve({ success: true, message: 'Registrazione completata.' });
    }, 1000);
  });
};

/** Login (mock locale). */
export const login = async (
  email: string,
  pin: string
): Promise<{ success: boolean; message: string; token?: string }> => {
  return new Promise(resolve => {
    setTimeout(async () => {
      const users = getUsers();
      const normalizedEmail = normalizeEmail(email);
      const user = users[normalizedEmail];
      if (!user) {
        resolve({ success: false, message: 'Nessun account trovato per questa email.' });
        return;
      }
      const isPinValid = await verifyPin(pin, user.pinHash, user.pinSalt);
      if (isPinValid) {
        const mockToken = `mock_token_${Date.now()}`;
        resolve({ success: true, message: 'Login effettuato con successo.', token: mockToken });
      } else {
        resolve({ success: false, message: 'PIN errato.' });
      }
    }, 1000);
  });
};

/**
 * Invia l’email di reset PIN.
 * Il tuo Apps Script si aspetta **GET ?action=request&email=...&redirect=...**
 */
export const forgotPassword = async (email: string): Promise<{ success: boolean; message: string }> => {
  const normalizedEmail = normalizeEmail(email);
  const redirect = buildResetRedirect();
  const url =
    `${SCRIPT_URL}?action=request` +
    `&email=${encodeURIComponent(normalizedEmail)}` +
    `&redirect=${encodeURIComponent(redirect)}`;

  try {
    // fire-and-forget: non ci interessa leggere la risposta
    await fetch(url, { method: 'GET', mode: 'no-cors', cache: 'no-store' });
  } catch (err) {
    console.warn('forgotPassword (fire-and-forget) warning:', err);
  }
  return { success: true, message: "Se l'email è registrata, riceverai un link per il reset." };
};

/**
 * Reimposta il PIN **in locale**.
 * Il token è già stato validato/consumato nella pagina /reset, quindi qui NON chiamiamo Apps Script.
 */
export const resetPin = async (
  email: string,
  _token: string,          // ignorato: già consumato in /reset
  newPin: string
): Promise<{ success: boolean; message: string }> => {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !newPin || newPin.length !== 4) {
    return { success: false, message: 'Dati non validi.' };
  }

  const users = getUsers();
  const user = users[normalizedEmail];
  if (!user) {
    return { success: false, message: 'Utente non trovato.' };
  }

  try {
    const { hash, salt } = await hashPinWithSalt(newPin);
    user.pinHash = hash;
    user.pinSalt = salt;
    users[normalizedEmail] = user;
    saveUsers(users);
    return { success: true, message: 'PIN aggiornato con successo.' };
  } catch (e) {
    console.error('Errore aggiornando il PIN locale:', e);
    return { success: false, message: 'Errore durante l’aggiornamento del PIN.' };
  }
};
