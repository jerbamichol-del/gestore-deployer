import React, { useState } from 'react';
import AuthLayout from '../components/auth/AuthLayout';
import { forgotPassword } from '../utils/api';
import { EnvelopeIcon } from '../components/icons/EnvelopeIcon';
import { SpinnerIcon } from '../components/icons/SpinnerIcon';

interface ForgotPasswordScreenProps {
  onBackToLogin: () => void;
  onRequestSent: (email: string) => void;
}

const ForgotPasswordScreen: React.FC<ForgotPasswordScreenProps> = ({ onBackToLogin, onRequestSent }) => {
    const [email, setEmail] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email) return;
        setIsLoading(true);
        setError(null);
        const response = await forgotPassword(email);
        setIsLoading(false);
        if (response.success) {
            onRequestSent(email);
        } else {
            setError(response.message);
        }
    };
    
    const inputStyles = "block w-full rounded-md border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 sm:text-sm";

    return (
        <AuthLayout>
            <div className="text-center">
                 <h2 className="text-xl font-bold text-slate-800 mb-2">Reimposta PIN</h2>
                 <>
                    <p className="text-slate-500 mb-6">Inserisci la tua email e ti invieremo un link per reimpostare il tuo PIN.</p>
                    {error && <p className="text-red-600 text-sm mb-4 bg-red-100 p-3 rounded-md">{error}</p>}
                    <form onSubmit={handleSubmit}>
                       <div className="mb-4">
                           <label htmlFor="email-forgot" className="sr-only">Email</label>
                           <div className="relative">
                              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                                  <EnvelopeIcon className="h-5 w-5 text-slate-400" aria-hidden="true" />
                              </div>
                              <input
                                  type="email"
                                  id="email-forgot"
                                  autoComplete="email"
                                  value={email}
                                  onChange={(e) => setEmail(e.target.value)}
                                  className={inputStyles}
                                  placeholder="La tua email"
                                  required
                                  disabled={isLoading}
                              />
                           </div>
                       </div>
                       <button
                           type="submit"
                           disabled={isLoading || !email}
                           className="w-full px-4 py-3 text-sm font-semibold text-white bg-indigo-600 rounded-lg shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-colors disabled:bg-indigo-300 flex justify-center items-center"
                       >
                           {isLoading ? <SpinnerIcon className="w-5 h-5"/> : 'Invia Link di Reset'}
                       </button>
                    </form>
                    <button
                      onClick={onBackToLogin}
                      className="mt-6 w-full text-center text-sm font-semibold text-indigo-600 hover:text-indigo-500"
                    >
                      Annulla
                    </button>
                 </>
            </div>
        </AuthLayout>
    );
};

export default ForgotPasswordScreen;