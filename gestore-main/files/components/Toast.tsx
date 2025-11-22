import React, { useEffect, useState, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { CheckCircleIcon } from './icons/CheckCircleIcon';
import { InformationCircleIcon } from './icons/InformationCircleIcon';
import { ExclamationTriangleIcon } from './icons/ExclamationTriangleIcon';
import { XMarkIcon } from './icons/XMarkIcon';

interface ToastProps {
  message: string;
  type: 'success' | 'info' | 'error';
  onClose: () => void;
}

const toastConfig = {
  success: {
    icon: CheckCircleIcon,
    bgColor: 'bg-green-600',
    textColor: 'text-white',
    iconColor: 'text-white',
    ringColor: 'focus:ring-green-400',
  },
  info: {
    icon: InformationCircleIcon,
    bgColor: 'bg-sky-600',
    textColor: 'text-white',
    iconColor: 'text-white',
    ringColor: 'focus:ring-sky-400',
  },
  error: {
    icon: ExclamationTriangleIcon,
    bgColor: 'bg-red-600',
    textColor: 'text-white',
    iconColor: 'text-white',
    ringColor: 'focus:ring-red-400',
  },
};

const Toast: React.FC<ToastProps> = ({ message, type, onClose }) => {
  const [isAnimatingOut, setIsAnimatingOut] = useState(false);
  const [portalNode, setPortalNode] = useState<HTMLElement | null>(null);

  useEffect(() => {
    // Il portale è disponibile solo dopo il mount del componente sul client
    setPortalNode(document.getElementById('toast-portal'));
  }, []);

  const { icon: Icon, bgColor, textColor, iconColor, ringColor } = toastConfig[type];

  const handleClose = useCallback(() => {
    setIsAnimatingOut(true);
    setTimeout(onClose, 300); // Attendi la fine dell'animazione
  }, [onClose]);

  useEffect(() => {
    const timer = setTimeout(handleClose, 3000); // Chiusura automatica dopo 3 secondi
    return () => clearTimeout(timer);
  }, [handleClose]);

  const toastContent = (
    <div
      role="alert"
      aria-live="assertive"
      className={`fixed transition-all duration-300 ease-in-out transform ${
        isAnimatingOut ? 'translate-y-full opacity-0' : 'translate-y-0 opacity-100'
      } animate-fade-in-up`}
      style={{
        zIndex: 9999,
        bottom: `calc(1.5rem + env(safe-area-inset-bottom, 0px))`,
        left: `calc(1.5rem + env(safe-area-inset-left, 0px))`,
        right: `calc(1.5rem + env(safe-area-inset-right, 0px))`,
        pointerEvents: 'auto',
        maxWidth: '400px',
        marginLeft: 'auto',
        marginRight: 'auto',
      }}
    >
      <div className={`rounded-lg shadow-lg p-2 grid grid-cols-[auto_1fr_auto] items-center gap-2 ${bgColor}`}>
        <div className="flex-shrink-0">
          <Icon className={`h-5 w-5 ${iconColor}`} aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className={`text-sm font-medium break-words ${textColor}`}>{message}</p>
        </div>
        <div className="flex-shrink-0 flex">
          <button
            type="button"
            onClick={handleClose}
            className={`inline-flex rounded-md p-1 transition-colors active:bg-black/20 focus:outline-none focus:ring-2 focus:ring-offset-2 ${ringColor} ${bgColor.replace('bg-','focus:ring-offset-')}`}
          >
            <span className="sr-only">Chiudi</span>
            <XMarkIcon className={`h-5 w-5 ${textColor}`} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );

  if (!portalNode) {
    return null; // Non renderizzare nulla finché il portale non è pronto
  }

  return ReactDOM.createPortal(toastContent, portalNode);
};

export default Toast;