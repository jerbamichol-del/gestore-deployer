
import React, { useState, useEffect } from 'react';
import { XMarkIcon } from './icons/XMarkIcon';
import { InformationCircleIcon } from './icons/InformationCircleIcon';
import { ClipboardDocumentIcon } from './icons/ClipboardDocumentIcon';
import { ClipboardDocumentCheckIcon } from './icons/ClipboardDocumentCheckIcon';


interface InstallPwaModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const InstallPwaModal: React.FC<InstallPwaModalProps> = ({ isOpen, onClose }) => {
  const [isAnimating, setIsAnimating] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setCopied(false);
      const timer = setTimeout(() => setIsAnimating(true), 10);
      return () => clearTimeout(timer);
    } else {
      setIsAnimating(false);
    }
  }, [isOpen]);

  const handleCopy = () => {
    navigator.clipboard.writeText(window.location.href).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    });
  };

  if (!isOpen) return null;

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
  const isAndroid = /Android/.test(navigator.userAgent);

  const getInstallInstructions = () => {
    if (isIOS) {
      return <>Tocca l'icona <strong>Condividi</strong> <img src="https://img.icons8.com/ios-glyphs/30/000000/share--v1.png" alt="Share Icon" className="inline w-5 h-5 mx-1 align-text-bottom"/> e poi seleziona <strong>"Aggiungi alla schermata Home"</strong>.</>;
    }
    if (isAndroid) {
      return <>Tocca i tre puntini <strong className="text-xl align-middle mx-1">⋮</strong> nel menu del browser e seleziona <strong>"Installa app"</strong> o <strong>"Aggiungi a schermata Home"</strong>.</>;
    }
    return 'Usa il menu del tuo browser per aggiungere questo sito alla tua schermata principale o per installare l\'app.';
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex justify-center items-center p-4 transition-opacity duration-300 ease-in-out ${isAnimating ? 'opacity-100' : 'opacity-0'} bg-slate-900/60 backdrop-blur-sm`}
      onClick={onClose}
      aria-modal="true"
      role="dialog"
    >
      <div
        className={`bg-white rounded-lg shadow-xl w-full max-w-lg transform transition-all duration-300 ease-in-out ${isAnimating ? 'scale-100 opacity-100' : 'scale-95 opacity-0'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center p-6 border-b border-slate-200">
          <h2 className="text-xl font-bold text-slate-800">Installa l'App</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1 rounded-full hover:bg-slate-200">
            <XMarkIcon className="w-6 h-6" />
          </button>
        </div>
        <div className="p-6 space-y-4">
            <div className="text-sm text-slate-600 bg-slate-100 p-3 rounded-md flex items-start gap-2">
                <InformationCircleIcon className="w-5 h-5 text-slate-500 flex-shrink-0 mt-0.5" />
                <span>L'ambiente di anteprima può limitare l'installazione diretta. Per un'esperienza ottimale, apri l'app nel tuo browser principale seguendo questi passaggi.</span>
            </div>
            <div className="bg-white p-4 rounded-lg border border-slate-200">
                <p className="font-bold text-slate-800 mb-2">1. Copia l'URL dell'App</p>
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={window.location.href}
                        readOnly
                        className="flex-grow bg-slate-100 text-slate-700 rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                    <button
                        onClick={handleCopy}
                        className={`w-[110px] flex-shrink-0 flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold rounded-md transition-all duration-200 ${
                            copied 
                                ? 'bg-green-600 text-white' 
                                : 'bg-indigo-600 text-white hover:bg-indigo-700'
                        }`}
                    >
                        {copied ? <ClipboardDocumentCheckIcon className="w-5 h-5" /> : <ClipboardDocumentIcon className="w-5 h-5" />}
                        <span>{copied ? 'Copiato!' : 'Copia'}</span>
                    </button>
                </div>
            </div>

             <div className="bg-white p-4 rounded-lg border border-slate-200">
                <p className="font-bold text-slate-800 mb-2">2. Apri in una nuova scheda</p>
                <p className="text-sm text-slate-600">
                  Apri una nuova scheda nel tuo browser e <strong>incolla l'URL</strong>.
                </p>
            </div>

             <div className="bg-indigo-100 p-4 rounded-lg border border-indigo-200">
                <p className="font-bold text-indigo-800 mb-2">3. Aggiungi alla Home</p>
                <p className="text-sm text-indigo-700">
                  {getInstallInstructions()}
                </p>
            </div>
        </div>
        <div className="px-6 py-4 bg-slate-50 flex justify-end">
            <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-base font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg shadow-sm hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-colors"
              >
                Ho Capito
            </button>
        </div>
      </div>
    </div>
  );
};

export default InstallPwaModal;
