import React, { useState, useEffect } from 'react'; 
import AuthLayout from '../components/auth/AuthLayout';
import PinInput from '../components/auth/PinInput';
import { register, login } from '../utils/api';
import { EnvelopeIcon } from '../components/icons/EnvelopeIcon';
import { SpinnerIcon } from '../components/icons/SpinnerIcon';

// biometria
import {
  isBiometricsAvailable,
  registerBiometric,
  setBiometricsOptOut,
} from '../services/biometrics';

// ——— Snooze di sessione per evitare auto-prompt dopo “Annulla” ———
const BIO_SNOOZE_KEY = 'bio.snooze';
const clearBiometricSnooze = () => { try { sessionStorage.removeItem(BIO_SNOOZE_KEY); } catch {} };

interface SetupScreenProps {
  onSetupSuccess: (token: string, email: string) => void;
  onGoToLogin: () => void;
}

type Step = 'email' | 'pin_setup' | 'pin_confirm' | 'bio_offer' | 'processing';

const SetupScreen: React.FC<SetupScreenProps> = ({ onSetupSuccess, onGoToLogin }) => {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [bioSupported, setBioSupported] = useState<boolean | null>(null);
  const [bioBusy, setBioBusy] = useState(false);

  const handleEmailSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (email.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError(null);
      setStep('pin_setup');
    } else {
      setError('Inserisci un indirizzo email valido.');
    }
  };

  // flusso finale: registrazione + login
  const doRegisterAndLogin = async () => {
    setStep('processing');
    setIsLoading(true);
    setError(null);
    const normalizedEmail = email.toLowerCase();

    // Registrazione
    const regResponse = await register(normalizedEmail, pin);
    if (!regResponse.success) {
      setError(regResponse.message);
      setIsLoading(false);
      setTimeout(() => {
        setPin('');
        setConfirmPin('');
        setError(null);
        setStep('email');
      }, 2000);
      return;
    }

    // Login automatico
    const loginResponse = await login(normalizedEmail, pin);
    if (loginResponse.success && loginResponse.token) {
      onSetupSuccess(loginResponse.token, normalizedEmail);
    } else {
      setIsLoading(false);
      setError('Login automatico fallito. Vai alla pagina di login.');
      setTimeout(() => onGoToLogin(), 2000);
    }
  };

  // Passaggio da pin_setup a pin_confirm
  useEffect(() => {
    if (step === 'pin_setup' && pin.length === 4) {
      setStep('pin_confirm');
    }
  }, [pin, step]);

  // Dopo la conferma PIN corretta → mostra bio_offer se supportato, altrimenti procedi
  useEffect(() => {
    (async () => {
      if (step === 'pin_confirm' && confirmPin.length === 4) {
        if (pin === confirmPin) {
          setError(null);
          const supported = await isBiometricsAvailable();
          setBioSupported(supported);
          if (supported) {
            setStep('bio_offer');
          } else {
            // niente biometria → procedi direttamente
            await doRegisterAndLogin();
          }
        } else {
          setError('I PIN non corrispondono. Riprova.');
          setTimeout(() => {
            setPin('');
            setConfirmPin('');
            setError(null);
            setStep('pin_setup');
          }, 1500);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmPin, pin, step]);

  const inputStyles =
    'block w-full rounded-md border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 sm:text-sm';

  const renderContent = () => {
    if (step === 'processing' || isLoading) {
      return (
        <div className="text-center min-h-[300px] flex flex-col justify-center items-center">
          <SpinnerIcon className="w-12 h-12 text-indigo-600 mx-auto" />
          <p className="mt-4 text-slate-500">Creazione account in corso...</p>
        </div>
      );
    }

    switch (step) {
      case 'email':
        return (
          <div className="text-center">
            <h2 className="text-xl font-bold text-slate-800 mb-2">Crea un Account</h2>
            <p className="text-slate-500 mb-6 h-10 flex items-center justify-center">{error || 'Inizia inserendo i tuoi dati.'}</p>
            <form onSubmit={handleEmailSubmit} className="space-y-4">
              <div>
                <label htmlFor="email-register" className="sr-only">Email</label>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                    <EnvelopeIcon className="h-5 w-5 text-slate-400" aria-hidden="true" />
                  </div>
                  <input
                    type="email"
                    id="email-register"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={inputStyles}
                    placeholder="La tua email"
                    required
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={!email}
                className="w-full px-4 py-3 text-sm font-semibold text-white bg-indigo-600 rounded-lg shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-colors disabled:bg-indigo-300"
              >
                Continua
              </button>
            </form>
            <p className="text-sm text-slate-500 mt-6">
              Hai già an account?{' '}
              <button onClick={onGoToLogin} className="font-semibold text-indigo-600 hover:text-indigo-500">
                Accedi
              </button>
            </p>
          </div>
        );

      case 'pin_setup':
      case 'pin_confirm': {
        const isConfirming = step === 'pin_confirm';
        return (
          <div className="text-center">
            <h2 className="text-xl font-bold text-slate-800 mb-2">
              {isConfirming ? 'Conferma il tuo PIN' : 'Crea un PIN di 4 cifre'}
            </h2>
            <p className={`text-slate-500 h-10 flex items-center justify-center transition-colors ${error ? 'text-red-500' : ''}`}>
              {error || (isConfirming ? 'Inseriscilo di nuovo per conferma.' : 'Servirà per accedere al tuo account.')}
            </p>
            <PinInput pin={isConfirming ? confirmPin : pin} onPinChange={isConfirming ? setConfirmPin : setPin} />
          </div>
        );
      }

      case 'bio_offer': {
        return (
          <div className="text-center">
            <h2 className="text-xl font-bold text-slate-800 mb-2">Vuoi abilitare l’impronta / FaceID?</h2>
            <p className="text-slate-500 h-10 flex items-center justify-center">
              Potrai sbloccare l’app senza inserire il PIN.
            </p>

            <div className="mt-4 p-3 rounded-lg border border-slate-200 bg-slate-50 text-left inline-block">
              <p className="text-sm text-slate-700">Abilita ora lo sblocco biometrico su questo dispositivo?</p>
              <div className="flex gap-3 mt-2">
                <button
                  onClick={async () => {
                    if (!bioSupported) { await doRegisterAndLogin(); return; }
                    try {
                      setBioBusy(true);
                      await registerBiometric('Profilo locale');
                      // registrazione riuscita: eventuale auto-prompt verrà gestito dalla Login
                      clearBiometricSnooze(); // assicura che non resti in stato “annullato”
                      setBioBusy(false);
                    } catch {
                      setBioBusy(false);
                      // anche se annulla la registrazione, proseguiamo col flusso
                    } finally {
                      await doRegisterAndLogin();
                    }
                  }}
                  disabled={bioBusy}
                  className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-indigo-300"
                >
                  {bioBusy ? 'Attivo…' : 'Abilita e continua'}
                </button>

                <button
                  onClick={async () => {
                    setBiometricsOptOut(true); // non riproporre in login
                    await doRegisterAndLogin();
                  }}
                  disabled={bioBusy}
                  className="px-4 py-2 text-sm font-semibold text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-100"
                >
                  Non ora
                </button>
              </div>
            </div>
          </div>
        );
      }
    }
  };

  return <AuthLayout>{renderContent()}</AuthLayout>;
};

export default SetupScreen;
