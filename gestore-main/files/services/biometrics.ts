// src/services/biometrics.ts
// Sblocco con impronta/FaceID via WebAuthn (Passkey) lato PWA/TWA

const KEY_ENABLED = 'bio.enabled';
const KEY_CRED_ID = 'bio.credId';       // base64url del rawId
const KEY_USER_ID = 'bio.userId';       // id utente locale per la passkey
const KEY_OPTOUT  = 'bio.optOut';       // utente ha detto "non ora"

// Snooze di sessione: dopo annullo/timeout non autopromptare fino a riapertura app
const KEY_SNOOZE  = 'bio.snooze';       // sessionStorage: '1' = non auto-promptare

// RP ID (dominio)
const RP_ID = location.hostname;

// --- base64url helpers ---
const toB64Url = (buf: ArrayBuffer) => {
  const b = String.fromCharCode(...new Uint8Array(buf));
  return btoa(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};
const fromB64Url = (s: string) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const arr = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) arr[i] = b.charCodeAt(i);
  return arr.buffer;
};

// ——— Snooze helpers ———
export function isBiometricSnoozed(): boolean {
  try { return sessionStorage.getItem(KEY_SNOOZE) === '1'; } catch { return false; }
}
export function setBiometricSnooze(): void {
  try { sessionStorage.setItem(KEY_SNOOZE, '1'); } catch {}
}
export function clearBiometricSnooze(): void {
  try { sessionStorage.removeItem(KEY_SNOOZE); } catch {}
}
export function canAutoPromptBiometric(): boolean {
  try {
    return !isBiometricSnoozed() && localStorage.getItem(KEY_ENABLED) === '1' && !!localStorage.getItem(KEY_CRED_ID);
  } catch { return false; }
}

// Supporto dispositivo
export async function isBiometricsAvailable(): Promise<boolean> {
  if (!('PublicKeyCredential' in window)) return false;
  try {
    const ok = await (window as any).PublicKeyCredential
      .isUserVerifyingPlatformAuthenticatorAvailable?.();
    return !!ok;
  } catch {
    return false;
  }
}

// Stato locale
export function isBiometricsEnabled(): boolean {
  return localStorage.getItem(KEY_ENABLED) === '1' && !!localStorage.getItem(KEY_CRED_ID);
}

// Opt-out prompt
export function isBiometricsOptedOut(): boolean {
  return localStorage.getItem(KEY_OPTOUT) === '1';
}
export function setBiometricsOptOut(v: boolean) {
  if (v) localStorage.setItem(KEY_OPTOUT, '1');
  else localStorage.removeItem(KEY_OPTOUT);
}

// Disabilita
export function disableBiometrics() {
  localStorage.removeItem(KEY_ENABLED);
  localStorage.removeItem(KEY_CRED_ID);
  clearBiometricSnooze();
}

// Registra passkey (abilitazione)
export async function registerBiometric(displayName = 'Utente'): Promise<boolean> {
  if (!(await isBiometricsAvailable())) throw new Error('Biometria non disponibile su questo dispositivo');

  let userIdStr = localStorage.getItem(KEY_USER_ID);
  if (!userIdStr) {
    const rnd = crypto.getRandomValues(new Uint8Array(32));
    userIdStr = toB64Url(rnd.buffer);
    localStorage.setItem(KEY_USER_ID, userIdStr);
  }
  const userId = fromB64Url(userIdStr);

  const challenge = crypto.getRandomValues(new Uint8Array(32));

  const publicKey: PublicKeyCredentialCreationOptions = {
    challenge,
    rp: { name: 'Gestore Spese', id: RP_ID },
    user: {
      id: new Uint8Array(userId),
      name: 'local@gestore',
      displayName,
    },
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 },   // ES256
      { type: 'public-key', alg: -257 }, // RS256
    ],
    timeout: 60000,
    attestation: 'none',
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      residentKey: 'preferred',
      userVerification: 'required',
    },
  };

  const cred = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential | null;
  if (!cred) throw new Error('Creazione passkey annullata');

  const credIdB64 = toB64Url(cred.rawId);
  localStorage.setItem(KEY_CRED_ID, credIdB64);
  localStorage.setItem(KEY_ENABLED, '1');
  clearBiometricSnooze();        // nuova attivazione ⇒ togli eventuale blocco sessione
  setBiometricsOptOut(false);    // rimuovi opt-out
  return true;
}

// Sblocco — se l’utente ANNULLA o scade: metti SNOOZE e lancia NotAllowed/Abort (verrà intercettato dallo screen)
export async function unlockWithBiometric(reason = 'Sblocca Gestore Spese'): Promise<boolean> {
  if (!(await isBiometricsAvailable())) throw new Error('Biometria non disponibile');
  const credIdB64 = localStorage.getItem(KEY_CRED_ID);
  if (!credIdB64) throw new Error('Biometria non configurata');

  try { (document.activeElement as HTMLElement | null)?.blur?.(); } catch {}

  const allowId = fromB64Url(credIdB64);
  const challenge = crypto.getRandomValues(new Uint8Array(32));

  const publicKey: PublicKeyCredentialRequestOptions = {
    challenge,
    rpId: RP_ID,
    timeout: 60000,
    userVerification: 'required',
    allowCredentials: [{ id: new Uint8Array(allowId), type: 'public-key' }],
  };

  try {
    const assertion = (await navigator.credentials.get({ publicKey })) as PublicKeyCredential | null;
    if (!assertion) {
      // raro, ma trattalo come annullo
      setBiometricSnooze();
      const err = new DOMException('User cancelled', 'NotAllowedError');
      throw err;
    }
    clearBiometricSnooze(); // successo ⇒ ok ai futuri auto-prompt
    return true;
  } catch (e: any) {
    const name = String(e?.name || '');
    const msg  = String(e?.message || '');
    // Cancel/dismiss/timeout → metti in snooze e rilancia per far interrompere l’autoprompt
    if (name === 'NotAllowedError' || name === 'AbortError' || /timeout/i.test(msg)) {
      setBiometricSnooze();
    }
    throw e; // il caller decide cosa fare (noi abbiamo già messo lo snooze)
  }
}

// Suggerire offerta attivazione?
export async function shouldOfferBiometricEnable(): Promise<boolean> {
  const supported = await isBiometricsAvailable();
  return supported && !isBiometricsEnabled() && !isBiometricsOptedOut();
}
