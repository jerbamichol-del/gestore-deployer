
import React, { useState, useEffect, useRef } from 'react';
import { Expense } from '../types';
import { createLiveSession, createBlob } from '../utils/ai';
import { XMarkIcon } from './icons/XMarkIcon';
import { MicrophoneIcon } from './icons/MicrophoneIcon';
import { LiveServerMessage } from '@google/genai';

interface VoiceInputModalProps {
  isOpen: boolean;
  onClose: () => void;
  onParsed: (data: Partial<Omit<Expense, 'id'>>) => void;
}

const VoiceInputModal: React.FC<VoiceInputModalProps> = ({ isOpen, onClose, onParsed }) => {
  const [isAnimating, setIsAnimating] = useState(false);
  const [status, setStatus] = useState<'idle' | 'listening' | 'processing' | 'error'>('idle');
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);

  const sessionPromise = useRef<Promise<any> | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const scriptProcessor = useRef<ScriptProcessorNode | null>(null);
  const stream = useRef<MediaStream | null>(null);

  const cleanUp = () => {
    stream.current?.getTracks().forEach(track => track.stop());
    scriptProcessor.current?.disconnect();
    audioContext.current?.close();
    sessionPromise.current?.then((session: any) => session.close());
    sessionPromise.current = null;
    audioContext.current = null;
    scriptProcessor.current = null;
    stream.current = null;
  };

  const startSession = async () => {
    cleanUp();
    setTranscript('');
    setError(null);
    setStatus('listening');

    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });

      sessionPromise.current = createLiveSession({
        onopen: async () => { // Nota: aggiungi async qui
          const AudioContextCtor =
            window.AudioContext || (window as any).webkitAudioContext;
          if (!AudioContextCtor) {
            setError("Il tuo browser non supporta l'input vocale.");
            setStatus('error');
            return;
          }

          // 1. RIMUOVI { sampleRate: 16000 }. Lascia decidere all'hardware.
          audioContext.current = new AudioContextCtor();

          // 2. FIX PER IOS: Se il contesto è sospeso, riattivalo esplicitamente
          if (audioContext.current.state === 'suspended') {
            await audioContext.current.resume();
          }

          // 3. Ottieni il sample rate REALE del dispositivo (es. 44100 o 48000)
          const realSampleRate = audioContext.current.sampleRate;

          const source = audioContext.current.createMediaStreamSource(stream.current!);
          scriptProcessor.current = audioContext.current.createScriptProcessor(4096, 1, 1);

          scriptProcessor.current.onaudioprocess = (audioProcessingEvent) => {
            const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
            
            // 4. Passa il sample rate reale alla funzione createBlob
            const pcmBlob = createBlob(inputData, realSampleRate);

            sessionPromise.current?.then((session: any) => {
              session.sendRealtimeInput({ media: pcmBlob });
            });
          };

          source.connect(scriptProcessor.current);
          scriptProcessor.current.connect(audioContext.current.destination);
        },
        onmessage: (message: LiveServerMessage) => {
          if (message.serverContent?.inputTranscription) {
            setTranscript(prev => prev + message.serverContent.inputTranscription.text);
          }
          if (message.toolCall?.functionCalls) {
            setStatus('processing');
            const args = message.toolCall.functionCalls[0].args;
            onParsed({
              description: args.description as string,
              amount: args.amount as number,
              category: args.category as string,
            });
            cleanUp();
          }
        },
        onerror: (e: ErrorEvent) => {
          console.error(e);
          setError("Si è verificato un errore durante la sessione vocale.");
          setStatus('error');
          cleanUp();
        },
        onclose: () => {
          // Session closed
        }
      });

    } catch (err) {
      console.error(err);
      setError("Accesso al microfono negato. Controlla le autorizzazioni del browser.");
      setStatus('error');
    }
  };

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => setIsAnimating(true), 10);
      startSession();
      return () => {
        clearTimeout(timer);
        cleanUp();
      };
    } else {
      setIsAnimating(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const getStatusContent = () => {
    switch (status) {
      case 'listening':
        return {
          icon: (
            <div className="w-24 h-24 rounded-full bg-red-500 animate-pulse flex items-center justify-center">
              <MicrophoneIcon className="w-12 h-12 text-white" />
            </div>
          ),
          text: 'In ascolto...',
          subtext: 'Descrivi la tua spesa, ad esempio "25 euro per una cena al ristorante".'
        };
      case 'processing':
        return {
          icon: (
            <div className="w-24 h-24 rounded-full bg-indigo-500 flex items-center justify-center">
              <div className="w-12 h-12 text-white animate-spin rounded-full border-4 border-t-transparent border-white"></div>
            </div>
          ),
          text: 'Elaborazione...',
          subtext: 'Sto analizzando la tua richiesta.'
        };
      case 'error':
        return {
          icon: (
            <div className="w-24 h-24 rounded-full bg-red-100 flex items-center justify-center">
              <XMarkIcon className="w-12 h-12 text-red-500" />
            </div>
          ),
          text: 'Errore',
          subtext: error
        };
      default:
        return { icon: null, text: '', subtext: '' };
    }
  };

  const { icon, text, subtext } = getStatusContent();

  return (
    <div
      className={`fixed inset-0 z-50 flex justify-center items-center p-4 transition-opacity duration-300 ease-in-out ${
        isAnimating ? 'opacity-100' : 'opacity-0'
      } bg-slate-900/50 backdrop-blur-sm`}
      onClick={onClose}
      aria-modal="true"
      role="dialog"
    >
      <div
        className={`bg-slate-50 rounded-lg shadow-xl w-full max-w-lg transform transition-all duration-300 ease-in-out ${
          isAnimating ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center p-6 border-b border-slate-200">
          <h2 className="text-xl font-bold text-slate-800">Aggiungi con Voce</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-slate-800 transition-colors p-1 rounded-full hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            aria-label="Chiudi"
          >
            <XMarkIcon className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6 flex flex-col items-center justify-center min-h-[300px] text-center">
          {icon}
          <p className="text-xl font-semibold text-slate-800 mt-6">{text}</p>
          <p className="text-slate-500 mt-2">{subtext}</p>
          {transcript && (
            <div className="mt-6 p-3 bg-slate-100 rounded-md w-full text-left">
              <p className="text-sm text-slate-600 font-medium">Trascrizione:</p>
              <p className="text-slate-800">{transcript}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default VoiceInputModal;
