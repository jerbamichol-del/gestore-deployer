// ForgotPasswordSuccessScreen.tsx
import React, { useEffect, useRef, useState } from 'react';
import AuthLayout from '../components/auth/AuthLayout';
import { EnvelopeIcon } from '../components/icons/EnvelopeIcon';
import { forgotPassword } from '../utils/api';

interface ForgotPasswordSuccessScreenProps {
  email: string;
  onBackToLogin: () => void;
}

const COOLDOWN_SECONDS = 60;

const ForgotPasswordSuccessScreen: React.FC<ForgotPasswordSuccessScreenProps> = ({ email, onBackToLogin }) => {
  const [cooldown, setCooldown] = useState<number>(0);
  const [sending, setSending] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    // cleanup timer on unmount
    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const startCooldown = () => {
    setCooldown(COOLDOWN_SECONDS);
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) {
          if (timerRef.current) {
            window.clearInterval(timerRef.current);
            timerRef.current = null;
          }
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  };

  const handleResend = async () => {
    if (sending || cooldown > 0) return;
    try {
      setSending(true);
      await forgotPassword(email); // usa la tua API esistente
      startCooldown();
    } finally {
      setSending(false);
    }
  };

  return (
    <AuthLayout>
      <div className="text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100 mb-4">
          <EnvelopeIcon className="h-6 w-6 text-green-600" aria-hidden="true" />
        </div>

        <h2 className="text-xl font-bold text-slate-800 mb-2">Controlla la tua Email</h2>

        <p className="text-slate-500 mb-6">
          Abbiamo inviato un link per il reset del PIN a <br />
          <strong className="text-slate-700">{email}</strong>.
          <br /><br />
          Apri il link per continuare. Se non lo trovi, controlla la cartella spam.
        </p>

        <div className="space-y-3">
          <button
            onClick={onBackToLogin}
            className="w-full px-4 py-3 text-sm font-semibold text-white bg-indigo-600 rounded-lg shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-colors"
          >
            Torna al Login
          </button>

          <div className="text-sm text-slate-600">
            Non hai ricevuto l’email?{' '}
            <button
              onClick={handleResend}
              disabled={sending || cooldown > 0}
              className="font-semibold text-indigo-600 hover:text-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {sending
                ? 'Invio…'
                : cooldown > 0
                ? `Reinvia tra ${cooldown}s`
                : 'Reinvia link'}
            </button>
          </div>
        </div>
      </div>
    </AuthLayout>
  );
};

export default ForgotPasswordSuccessScreen;
