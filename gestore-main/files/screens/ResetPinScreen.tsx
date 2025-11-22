import React, { useState, useEffect } from 'react';
import AuthLayout from '../components/auth/AuthLayout';
import PinInput from '../components/auth/PinInput';
import { resetPin, getUsers, saveUsers, forgotPassword } from '../utils/api';
import { hashPinWithSalt } from '../utils/auth';
import { SpinnerIcon } from '../components/icons/SpinnerIcon';

interface ResetPinScreenProps {
  email: string;
  token: string;
  onResetSuccess: () => void;
}

const ResetPinScreen: React.FC<ResetPinScreenProps> = ({ email, token, onResetSuccess }) => {
  const [step, setStep] = useState<'new_pin' | 'confirm_pin'>('new_pin');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  // Stato per link scaduto
  const [expired, setExpired] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  const [resendDone, setResendDone] = useState(false);
  const [cooldownLeft, setCooldownLeft] = useState(0); // secondi

  useEffect(() => {
    if (cooldownLeft <= 0) return;
    const id = window.setInterval(() => {
      setCooldownLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(id);
  }, [cooldownLeft]);

  const handleResend = async () => {
    if (resendBusy || cooldownLeft > 0) return;
    try {
      setResendBusy(true);
      await forgotPassword(email);
      setResendDone(true);
      setCooldownLeft(30); // cooldown 30s per evitare spam
    } finally {
      setResendBusy(false);
    }
  };

  const handleReset = async () => {
    setIsLoading(true);
    setError(null);

    const response = await resetPin(email, token, pin);

    if (response.success) {
      try {
        // Aggiorna anche il mock DB locale così il login funziona subito
        const users = getUsers();
        const normalizedEmail = email.toLowerCase();
        if (users[normalizedEmail]) {
          const { hash, salt } = await hashPinWithSalt(pin);
          users[normalizedEmail].pinHash = hash;
          users[normalizedEmail].pinSalt = salt;
          saveUsers(users);

          setSuccessMessage(response.message);
          setTimeout(() => {
            onResetSuccess();
          }, 1500);
        } else {
          setError('Utente non trovato nel database locale. Sincronizzazione fallita.');
          setIsLoading(false);
        }
      } catch (e) {
        console.error('Failed to update local PIN', e);
        setError("Errore durante l'aggiornamento del PIN locale.");
        setIsLoading(false);
      }
    } else {
      // Se il token è scaduto o non valido → mostra la vista dedicata
      const msg = (response.message || '').toLowerCase();
      if (msg.includes('invalid') || msg.includes('scadut') || msg.includes('non valido')) {
        setExpired(true);
        setIsLoading(false);
        return;
      }
      // Altri errori: reset flusso PIN
      setError(response.message);
      setIsLoading(false);
      setTimeout(() => {
        setPin('');
        setConfirmPin('');
        setError(null);
        setStep('new_pin');
      }, 2000);
    }
  };

  useEffect(() => {
    if (step === 'new_pin' && pin.length === 4) {
      setStep('confirm_pin');
    }
  }, [pin, step]);

  useEffect(() => {
    if (step === 'confirm_pin' && confirmPin.length === 4) {
      if (pin === confirmPin) {
        setError(null);
        handleReset();
      } else {
        setError('I PIN non corrispondono. Riprova.');
        setTimeout(() => {
          setPin('');
          setConfirmPin('');
          setError(null);
          setStep('new_pin');
        }, 1500);
      }
    }
  }, [confirmPin, pin, step]);

  // ====== RENDER ======
  // 1) Vista "link scaduto / non valido"
  if (expired) {
    return (
      <AuthLayout>
        <div className="text-center">
          <h2 className="text-xl font-bold text-slate-800 mb-2">Link scaduto o non valido</h2>
          <p className="text-slate-500 mb-6">
            Il link di reset non è più valido.<br />
            Puoi richiederne uno nuovo per <strong className="text-slate-700">{email}</strong>.
          </p>

          <button
            onClick={handleResend}
            disabled={resendBusy || cooldownLeft > 0}
            className={`w-full px-4 py-3 text-sm font-semibold rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-colors
              ${resendBusy || cooldownLeft > 0
                ? 'bg-slate-300 text-slate-600 cursor-not-allowed'
                : 'bg-indigo-600 text-white hover:bg-indigo-700'
              }`}
          >
            {resendBusy ? 'Invio in corso…' : cooldownLeft > 0 ? `Richiedi nuovo link (${cooldownLeft}s)` : 'Richiedi nuovo link'}
          </button>

          {resendDone && (
            <p className="mt-4 text-sm text-green-600">
              Se l'email è registrata, riceverai a breve un nuovo link.
            </p>
          )}
        </div>
      </AuthLayout>
    );
  }

  // 2) Vista caricamento operazioni di reset
  if (isLoading) {
    return (
      <AuthLayout>
        <div className="text-center min-h-[300px] flex flex-col justify-center items-center">
          <SpinnerIcon className="w-12 h-12 text-indigo-600 mx-auto" />
          <p className="mt-4 text-slate-500">Aggiornamento PIN in corso...</p>
        </div>
      </AuthLayout>
    );
  }

  // 3) Vista successo
  if (successMessage) {
    return (
      <AuthLayout>
        <div className="text-center min-h-[300px] flex flex-col justify-center items-center">
          <p className="text-lg font-semibold text-green-600">{successMessage}</p>
          <p className="mt-2 text-slate-500">Verrai reindirizzato al login.</p>
        </div>
      </AuthLayout>
    );
  }

  // 4) Vista standard: nuovo PIN / conferma
  const isConfirming = step === 'confirm_pin';
  return (
    <AuthLayout>
      <div className="text-center">
        <h2 className="text-xl font-bold text-slate-800 mb-2">
          {isConfirming ? 'Conferma il nuovo PIN' : 'Crea un nuovo PIN'}
        </h2>
        <p className={`text-slate-500 h-10 flex items-center justify-center transition-colors ${error ? 'text-red-500' : ''}`}>
          {error || (isConfirming ? 'Inseriscilo di nuovo per conferma.' : 'Il tuo nuovo PIN di 4 cifre.')}
        </p>
        <PinInput
          pin={isConfirming ? confirmPin : pin}
          onPinChange={isConfirming ? setConfirmPin : setPin}
        />
        {/* Tip utile: permetti di richiedere subito un nuovo link se l’utente ha dubbi */}
        <div className="mt-6">
          <button
            onClick={handleResend}
            disabled={resendBusy || cooldownLeft > 0}
            className={`text-sm font-semibold transition-colors
              ${resendBusy || cooldownLeft > 0 ? 'text-slate-400' : 'text-indigo-600 hover:text-indigo-500'}`}
          >
            {resendBusy ? 'Invio in corso…' : cooldownLeft > 0 ? `Link non arrivato? Reinvia (${cooldownLeft}s)` : 'Link non arrivato? Reinvia'}
          </button>
          {resendDone && (
            <p className="mt-2 text-xs text-green-600">
              Se l'email è registrata, riceverai a breve un nuovo link.
            </p>
          )}
        </div>
      </div>
    </AuthLayout>
  );
};

export default ResetPinScreen;
