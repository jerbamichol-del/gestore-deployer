import React, { useEffect, useState } from 'react';
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
  const { icon: Icon, bgColor, textColor, iconColor, ringColor } = toastConfig[type];

  useEffect(() => {
    const timer = setTimeout(() => {
      handleClose();
    }, 3000); // Auto-close after 3 seconds

    return () => clearTimeout(timer);
  }, []);

  const handleClose = () => {
    setIsAnimatingOut(true);
    setTimeout(onClose, 300); // Wait for animation to finish
  };

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`fixed z-50 transition-all duration-300 ease-in-out transform ${
        isAnimatingOut ? 'translate-y-full opacity-0' : 'translate-y-0 opacity-100'
      } animate-fade-in-up`}
      style={{
        bottom: `calc(2.25rem + env(safe-area-inset-bottom, 0px))`,
        left: `calc(1.5rem + env(safe-area-inset-left, 0px))`,
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
};

export default Toast;