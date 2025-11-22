import React, { useState, useEffect, useRef } from 'react';
import AuthLayout from '../components/auth/AuthLayout';
import PinInput from '../components/auth/PinInput';
import { login } from '../utils/api';
import { SpinnerIcon } from '../components/icons/SpinnerIcon';
import { useLocalStorage } from '../hooks/useLocalStorage';
import LoginEmail from '../components/auth/LoginEmail';

// biometria
import {
  isBiometricsAvailable,
  isBiometricsEnabled,
  unlockWithBiometric,
  registerBiometric,
  shouldOfferBiometricEnable,
  setBiometricsOptOut,
} from '../services/biometrics';

type BioHelpers = {
  isBiometricSnoozed: () => boolean;
  setBiometricSnooze: () => void;
  clearBiometricSnooze: () => void;
};

// lock di sessione per evitare doppio avvio (StrictMode / re-render)
const BIO_AUTOPROMPT_LOCK_KEY = 'bio.autoprompt.lock';
const hasAutoPromptLock = () => {
  try {
    return sessionStorage.getItem(BIO_AUTOPROMPT_LOCK_KEY) === '1';
  } catch {
    return false;
  }
};
const setAutoPromptLock = () => {
  try {
    sessionStorage.setItem(BIO_AUTOPROMPT_LOCK_KEY, '1');
  } catch {}
};

// email usata con la biometria (per auto-prompt anche sulla schermata email)
const BIOMETRIC_LAST_EMAIL_KEY = 'bio.last_email';

interface LoginScreenProps {
  onLoginSuccess: (token: string, email: string) => void;
  onGoToRegister: () => void;
  onGoToForgotPassword: () => void;
  onGoToForgotEmail: () => void;
}

const LoginScreen: React.FC<LoginScreenProps> = ({
  onLoginSuccess,
  onGoToRegister,
  onGoToForgotPassword,
  onGoToForgotEmail,
}) => {
  const [activeEmail, setActiveEmail] = useLocalStorage<string | null>(
    'last_active_user_email',
    null,
  );
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // biometria
  const [bioSupported, setBioSupported] = useState(false);
  const [bioEnabled, setBioEnabled] = useState(false);
  const [showEnableBox, setShowEnableBox] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);
  const autoStartedRef = useRef(false);

  // email salvata assieme alla biometria (es. da un login precedente)
  const [biometricEmail, setBiometricEmail] = useState<string | null>(null);

  // carica/stabilisce l'email da usare per la biometria
  useEffect(() => {
    // se abbiamo già un utente attivo, quella è l'email biometrica
    if (activeEmail) {
      setBiometricEmail(activeEmail);
      return;
    }

    // siamo sulla schermata email → proviamo a leggere l'ultima email biometrica salvata
    try {
      if (typeof window === 'undefined') return;
      const raw = window.localStorage.getItem(BIOMETRIC_LAST_EMAIL_KEY);
      if (!raw || raw === 'null' || raw === 'undefined') {
        setBiometricEmail(null);
      } else {
        setBiometricEmail(raw);
      }
    } catch {
      setBiometricEmail(null);
    }
  }, [activeEmail]);

  // verifica stato biometria (supporto / enabled / se mostrare il box)
  useEffect(() => {
    let mounted = true;

    (async () => {
      const supported = await isBiometricsAvailable();
      const enabled = isBiometricsEnabled();

      let shouldShow = false;

      if (supported) {
        if (enabled) {
          // già attivata → mostra direttamente il pulsante impronta
          shouldShow = true;
        } else if (activeEmail) {
          // decide se proporre l'abilitazione (funzione senza argomenti)
          try {
            const offer = await shouldOfferBiometricEnable();
            shouldShow = offer;
          } catch {
            shouldShow = false;
          }
        }
      }

      if (!mounted) return;

      setBioSupported(supported);
      setBioEnabled(enabled);
      setShowEnableBox(shouldShow);
    })();

    return () => {
      mounted = false;
    };
  }, [activeEmail]);

  // email effettiva da usare per l'auto-prompt (PIN o schermata email)
  const autoPromptEmail = activeEmail ?? biometricEmail ?? null;

  // Autoprompt biometrico: 1 solo tentativo totale per sessione.
  // Ora funziona anche se siamo sulla schermata EMAIL, usando autoPromptEmail.
  useEffect(() => {
    if (!autoPromptEmail) return;
    if (!bioSupported || !bioEnabled) return;
    if (autoStartedRef.current) return;
    if (hasAutoPromptLock()) return;

    autoStartedRef.current = true;
    setAutoPromptLock();

    (async () => {
      const { isBiometricSnoozed, setBiometricSnooze, clearBiometricSnooze } =
        (await import('../services/biometrics')) as unknown as BioHelpers;

      if (isBiometricSnoozed()) return;

      try {
        setBioBusy(true);
        const ok = await unlockWithBiometric('Sblocca con impronta / FaceID');
        setBioBusy(false);
        if (ok) {
          clearBiometricSnooze();

          const normalized = autoPromptEmail.toLowerCase();

          // Salva email biometrica dedicata
          try {
            if (typeof window !== 'undefined') {
              window.localStorage.setItem(BIOMETRIC_LAST_EMAIL_KEY, normalized);
            }
          } catch {}

          // Se eravamo sulla schermata email, settiamo anche l'activeEmail
          if (!activeEmail) {
            setActiveEmail(normalized);
          }

          onLoginSuccess('biometric-local', normalized);
        }
      } catch (err: any) {
        setBioBusy(false);
        const name = err?.name || '';
        const msg = String(err?.message || '');
        if (name === 'NotAllowedError' || name === 'AbortError' || /timeout/i.test(msg)) {
          setBiometricSnooze();
        }
        // resta sulla schermata corrente
      }
    })();
  }, [autoPromptEmail, activeEmail, bioSupported, bioEnabled, onLoginSuccess, setActiveEmail]);

  // Verifica PIN
  useEffect(() => {
    if (pin.length === 4 && activeEmail) {
      handlePinVerify();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, activeEmail]);

  const handleEmailSubmit = (email: string) => {
    if (email) {
      const normalized = email.toLowerCase();
      setActiveEmail(normalized);
      setError(null);
      setBiometricEmail(normalized);
    }
  };

  const handlePinVerify = async () => {
    if (isLoading || !activeEmail) return;
    setIsLoading(true);
    setError(null);
    const response = await login(activeEmail, pin);
    if (response.success && response.token) {
      onLoginSuccess(response.token, activeEmail);
    } else {
      setError(response.message);
      setTimeout(() => {
        setPin('');
        setError(null);
        setIsLoading(false);
      }, 1500);
    }
  };

  const loginWithBiometrics = async () => {
    const emailForBio = activeEmail ?? biometricEmail;
    if (!emailForBio) return;

    try {
      setBioBusy(true);
      // FIX: Removed typo 'clearBiometricSnoozed' and duplicate 'clearBiometricSnooze'
      const { clearBiometricSnooze, setBiometricSnooze } =
        (await import('../services/biometrics')) as unknown as BioHelpers;

      // login richiesto esplicitamente → azzero lo snooze
      clearBiometricSnooze();

      const ok = await unlockWithBiometric('Sblocca con impronta / FaceID');
      setBioBusy(false);

      if (ok) {
        const normalized = emailForBio.toLowerCase();

        // salva anche qui la mail biometrica
        try {
          if (typeof window !== 'undefined') {
            window.localStorage.setItem(BIOMETRIC_LAST_EMAIL_KEY, normalized);
          }
        } catch {}

        if (!activeEmail) {
          setActiveEmail(normalized);
        }
        setBiometricEmail(normalized);

        onLoginSuccess('biometric-local', normalized);
      }
    } catch (err) {
      setBioBusy(false);
      console.error('Login biometrico fallito', err);
      const name = (err as any)?.name || '';
      const msg = String((err as any)?.message || '');
      if (name === 'NotAllowedError' || name === 'AbortError' || /timeout/i.test(msg)) {
        const { setBiometricSnooze } =
          (await import('../services/biometrics')) as unknown as BioHelpers;
        setBiometricSnooze();
      }
    }
  };

  const enableBiometricsNow = async () => {
    const emailForBio = activeEmail ?? biometricEmail;
    if (!emailForBio) return;

    try {
      setBioBusy(true);
      await registerBiometric('Profilo locale');
      setBioEnabled(true);
      setBioBusy(false);

      const normalized = emailForBio.toLowerCase();

      // salva email biometrica dedicata
      try {
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(BIOMETRIC_LAST_EMAIL_KEY, normalized);
        }
      } catch {}

      if (!activeEmail) {
        setActiveEmail(normalized);
      }
      setBiometricEmail(normalized);

      // Tentativo manuale subito dopo l’abilitazione
      await loginWithBiometrics();
    } catch {
      setBioBusy(false);
      // se annulla in registrazione, resta tutto com’è
    }
  };

  const optOutBiometrics = () => {
    try {
      // funzione definita come setBiometricsOptOut(boolean)
      setBiometricsOptOut(true);
    } catch {
      // se fallisce non è la fine del mondo
    }
    setShowEnableBox(false);
  };

  const handleSwitchUser = () => {
    setActiveEmail(null);
    setPin('');
    setError(null);
    autoStartedRef.current = false;
    // non resetto il lock globale: niente altro auto-prompt in questa sessione
  };

  const renderContent = () => {
    // —— SCHERMATA EMAIL ——
    if (!activeEmail) {
      return (
        <div className="text-center">
          <h2 className="text-xl font-bold text-slate-800 mb-2">Bentornato!</h2>
          <p className="text-slate-500 mb-6">Inserisci la tua email per continuare.</p>

          <LoginEmail onSubmit={handleEmailSubmit} />

          <div className="mt-3">
            <button
              onClick={onGoToForgotEmail}
              className="text-sm font-semibold text-indigo-600 hover:text-indigo-500"
            >
              Email dimenticata?
            </button>
          </div>

          <p className="text-sm text-slate-500 mt-4">
            Non hai un account?{' '}
            <button
              onClick={onGoToRegister}
              className="font-semibold text-indigo-600 hover:text-indigo-500"
            >
              Registrati
            </button>
          </p>
        </div>
      );
    }

    // —— SCHERMATA PIN ——
    return (
      <div className="text-center">
        <p className="text-sm text-slate-600 mb-2 truncate" title={activeEmail}>
          {activeEmail}
        </p>
        <h2 className="text-xl font-bold text-slate-800 mb-2">Inserisci il PIN</h2>
        <p
          className={`h-10 flex items-center justify-center transition-colors ${
            error ? 'text-red-500' : 'text-slate-500'
          }`}
        >
          {isLoading ? (
            <SpinnerIcon className="w-6 h-6 text-indigo-600" />
          ) : (
            error ||
            (bioEnabled && bioSupported
              ? 'Puoi anche usare l’impronta.'
              : 'Inserisci il tuo PIN di 4 cifre.')
          )}
        </p>

        <PinInput pin={pin} onPinChange={setPin} />

        <div className="mt-4 flex flex-col items-center justify-center gap-y-3">
          <div className="flex w-full items-center justify-between">
            <button
              onClick={handleSwitchUser}
              className="text-sm font-semibold text-indigo-600 hover:text-indigo-500"
            >
              Cambia Utente
            </button>
            <button
              onClick={onGoToForgotPassword}
              className="text-sm font-semibold text-indigo-600 hover:text-indigo-500"
            >
              PIN Dimenticato?
            </button>
          </div>

          {showEnableBox && (
            <div className="mt-3 flex flex-col items-center gap-2">
              <button
                onClick={bioEnabled ? loginWithBiometrics : enableBiometricsNow}
                disabled={bioBusy}
                className="text-sm font-semibold text-indigo-600 hover:text-indigo-500 disabled:opacity-60"
              >
                {bioBusy
                  ? 'Attendere...'
                  : bioEnabled
                  ? 'Accedi con impronta'
                  : 'Abilita impronta'}
              </button>

              {!bioEnabled && (
                <button
                  type="button"
                  onClick={optOutBiometrics}
                  className="text-xs text-slate-400 hover:text-slate-500"
                >
                  Non ora
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return <AuthLayout>{renderContent()}</AuthLayout>;
};

export default LoginScreen;
