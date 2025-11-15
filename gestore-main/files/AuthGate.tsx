import React, { useState, useEffect, useRef, useCallback } from 'react';
import App from './App';
import LoginScreen from './screens/LoginScreen';
import SetupScreen from './screens/SetupScreen';
import ForgotPasswordScreen from './screens/ForgotPasswordScreen';
import ForgotPasswordSuccessScreen from './screens/ForgotPasswordSuccessScreen';
import ResetPinScreen from './screens/ResetPinScreen';
import { useLocalStorage } from './hooks/useLocalStorage';

type AuthView = 'login' | 'register' | 'forgotPassword' | 'forgotPasswordSuccess';
type ResetContext = { token: string; email: string; } | null;

const LOCK_TIMEOUT_MS = 30000; // 30 secondi

const AuthGate: React.FC = () => {
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [, setLastActiveUser] = useLocalStorage<string | null>('last_active_user_email', null);
  const [resetContext, setResetContext] = useState<ResetContext>(null);
  const hiddenTimestampRef = useRef<number | null>(null);
  const [emailForReset, setEmailForReset] = useState<string>('');
  
  // Controlla se esiste un database di utenti per decidere la schermata iniziale.
  const hasUsers = () => {
    try {
        const users = localStorage.getItem('users_db');
        return users !== null && users !== '{}';
    } catch (e) {
        return false;
    }
  };

  const [authView, setAuthView] = useState<AuthView>(hasUsers() ? 'login' : 'register');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('resetToken');
    const email = params.get('email');

    if (token && email) {
        setResetContext({ token, email });
        // Pulisce l'URL per evitare che il reset venga riattivato al refresh della pagina
        window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const handleAuthSuccess = (token: string, email: string) => {
    setSessionToken(token);
    setLastActiveUser(email.toLowerCase());
  };
  
  const handleResetSuccess = () => {
    setResetContext(null);
    setAuthView('login'); // Torna alla schermata di login dopo il reset
  };

  const handleLogout = useCallback(() => {
    setSessionToken(null);
    setLastActiveUser(null);
    setAuthView(hasUsers() ? 'login' : 'register');
  }, [setLastActiveUser]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        if (sessionToken) {
           hiddenTimestampRef.current = Date.now();
        }
      } else if (document.visibilityState === 'visible') {
        if (sessionStorage.getItem('preventAutoLock') === 'true') {
            sessionStorage.removeItem('preventAutoLock');
            hiddenTimestampRef.current = null; // Reset timestamp to prevent logout
            return;
        }

        if (sessionToken && hiddenTimestampRef.current) {
          const elapsed = Date.now() - hiddenTimestampRef.current;
          if (elapsed > LOCK_TIMEOUT_MS) {
            handleLogout();
          }
        }
        hiddenTimestampRef.current = null;
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [sessionToken, handleLogout]);
  
  if (resetContext) {
    return (
      <ResetPinScreen
        email={resetContext.email}
        token={resetContext.token}
        onResetSuccess={handleResetSuccess}
      />
    );
  }

  if (sessionToken) {
    return <App onLogout={handleLogout} />;
  }
  
  // Forziamo la vista di registrazione se non ci sono utenti
  if (!hasUsers() && authView !== 'register') {
      setAuthView('register');
  }

  switch (authView) {
    case 'register':
      return <SetupScreen onSetupSuccess={handleAuthSuccess} onGoToLogin={() => setAuthView('login')} />;
    case 'forgotPassword':
      return <ForgotPasswordScreen 
        onBackToLogin={() => setAuthView('login')} 
        onRequestSent={(email) => {
            setEmailForReset(email);
            setAuthView('forgotPasswordSuccess');
        }} 
      />;
    case 'forgotPasswordSuccess':
      return <ForgotPasswordSuccessScreen 
        email={emailForReset}
        onBackToLogin={() => setAuthView('login')} 
      />;
    case 'login':
    default:
      return (
        <LoginScreen 
            onLoginSuccess={handleAuthSuccess}
            onGoToRegister={() => setAuthView('register')}
            onGoToForgotPassword={() => setAuthView('forgotPassword')}
            // FIX: Add missing onGoToForgotEmail prop to satisfy LoginScreenProps.
            onGoToForgotEmail={() => setAuthView('forgotPassword')}
        />
      );
  }
};

export default AuthGate;