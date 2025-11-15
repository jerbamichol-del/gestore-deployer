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

// helper snooze/lock dal service (li importo a runtime per evitare cicli in build)
type BioHelpers = {
  isBiometricSnoozed: () => boolean;
  setBiometricSnooze: () => void;
  clearBiometricSnooze: () => void;
};

// lock di sessione per evitare doppio avvio (StrictMode / re-render)
const BIO_AUTOPROMPT_LOCK_KEY = 'bio.autoprompt.lock';
const hasAutoPromptLock = () => {
  try { return sessionStorage.getItem(BIO_AUTOPROMPT_LOCK_KEY) === '1'; } catch { return false; }
};
const setAutoPromptLock = () => { try { sessionStorage.setItem(BIO_AUTOPROMPT_LOCK_KEY, '1'); } catch {} };

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
  const [activeEmail, setActiveEmail] = useLocalStorage<string | null>('last_active_user_email', null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // biometria
  const [bioSupported, setBioSupported] = useState(false);
  const [bioEnabled, setBioEnabled] = useState(false);
  const [showEnableBox, setShowEnableBox] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);
  const autoStartedRef = useRef(false);

  // verifica stato biometria quando entri nella schermata PIN
  useEffect(() => {
    let mounted = true;
    (async () => {
      const supported = await isBiometricsAvailable();
      const enabled = isBiometricsEnabled();
      const offer = await shouldOfferBiometricEnable();
      if (!mounted) return;
      setBioSupported(supported);
      setBioEnabled(enabled);
      setShowEnableBox(offer);
    })();
    return () => { mounted = false; };
  }, [activeEmail]);

  // Autoprompt biometrico: 1 solo tentativo totale per sessione.
  // Gli "altri 2 tentativi" li gestisce il foglio di sistema dentro lo stesso prompt.
  useEffect(() => {
    if (!activeEmail) return;
    if (!bioSupported || !bioEnabled) return;
    if (autoStartedRef.current) return;
    if (hasAutoPromptLock()) return;

    autoStartedRef.current = true;
    setAutoPromptLock(); // blocca eventuale secondo run (StrictMode)

    (async () => {
      const { isBiometricSnoozed, setBiometricSnooze, clearBiometricSnooze } =
        (await import('../services/biometrics')) as unknown as BioHelpers;

      if (isBiometricSnoozed()) return;

      try {
        setBioBusy(true);
        const ok = await unlockWithBiometric('Sblocca con impronta / FaceID'); // timeout 60s gestisce retry interno
        setBioBusy(false);
        if (ok) {
          clearBiometricSnooze();
          onLoginSuccess('biometric-local', activeEmail);
        }
      } catch (err: any) {
        setBioBusy(false);
        // Qualsiasi annullo/timeout/chiusura: metti in snooze e non ripresentare
        const name = err?.name || '';
        const msg  = String(err?.message || '');
        if (name === 'NotAllowedError' || name === 'AbortError' || /timeout/i.test(msg)) {
          setBiometricSnooze();
        }
        // resta su PIN, nessun altro prompt automatico
      }
    })();
  }, [activeEmail, bioSupported, bioEnabled, onLoginSuccess]);

  // Verifica PIN
  useEffect(() => {
    if (pin.length === 4 && activeEmail) {
      handlePinVerify();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, activeEmail]);

  const handleEmailSubmit = (email: string) => {
    if (email) {
      setActiveEmail(email.toLowerCase());
      setError(null);
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

  // Abilita ora (box interno) — tenta 1 prompt manuale; se annulla, niente ripresentazione
  const enableBiometricsNow = async () => {
    try {
      setBioBusy(true);
      await registerBiometric('Profilo locale');
      setBioEnabled(true);
      setShowEnableBox(false);
      setBioBusy(false);

      // Tentativo manuale singolo subito dopo l’abilitazione
      try {
        const { clearBiometricSnooze, setBiometricSnooze } =
          (await import('../services/biometrics')) as unknown as BioHelpers;
        clearBiometricSnooze(); // consenti il prompt adesso
        const ok = await unlockWithBiometric('Sblocca con impronta / FaceID');
        if (ok && activeEmail) {
          onLoginSuccess('biometric-local', activeEmail);
          return;
        }
      } catch (err: any) {
        const name = err?.name || '';
        const msg  = String(err?.message || '');
        if (name === 'NotAllowedError' || name === 'AbortError' || /timeout/i.test(msg)) {
          const { setBiometricSnooze } =
            (await import('../services/biometrics')) as unknown as BioHelpers;
          setBiometricSnooze();
        }
        // resta su PIN
      }
    } catch {
      setBioBusy(false);
      // se annulla in registrazione, resta tutto com’è
    }
  };

  // Non ora (non riproporre il box)
  const denyBiometricsOffer = () => {
    setBiometricsOptOut(true);
    setShowEnableBox(false);
  };

  const handleSwitchUser = () => {
    setActiveEmail(null);
    setPin('');
    setError(null);
    autoStartedRef.current = false;
    // non resetto il lock: in questa sessione niente altro auto-prompt
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
            error || (bioEnabled && bioSupported ? 'Puoi anche usare l’impronta.' : 'Inserisci il tuo PIN di 4 cifre.')
          )}
        </p>

        <PinInput pin={pin} onPinChange={setPin} />

        {/* Box abilitazione biometria (solo se disponibile, non abilitata, non opt-out) */}
        {showEnableBox && (
          <div className="mt-4 p-3 rounded-lg border border-slate-200 bg-slate-50 text-left">
            <p className="text-sm text-slate-700">
              Vuoi abilitare lo sblocco con impronta / FaceID su questo dispositivo?
            </p>
            <div className="flex gap-3 mt-2">
              <button
                onClick={enableBiometricsNow}
                disabled={bioBusy}
                className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-indigo-300"
              >
                {bioBusy ? 'Attivo…' : 'Abilita ora'}
              </button>
              <button
                onClick={denyBiometricsOffer}
                disabled={bioBusy}
                className="px-4 py-2 text-sm font-semibold text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-100"
              >
                Non ora
              </button>
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-col sm:flex-row justify-between items-center gap-2">
          <button
            onClick={handleSwitchUser}
            className="text-sm font-semibold text-slate-500 hover:text-slate-800"
          >
            Cambia Utente
          </button>
          <div className="flex gap-4">
            <button
              onClick={onGoToForgotPassword}
              className="text-sm font-semibold text-indigo-600 hover:text-indigo-500"
            >
              PIN Dimenticato?
            </button>
          </div>
        </div>
      </div>
    );
  };

  return <AuthLayout>{renderContent()}</AuthLayout>;
};

export default LoginScreen;
