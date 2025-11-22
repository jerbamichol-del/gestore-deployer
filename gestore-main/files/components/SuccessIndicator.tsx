import React from 'react';
import { CheckIcon } from './icons/CheckIcon';

interface SuccessIndicatorProps {
  show: boolean;
}

const SuccessIndicator: React.FC<SuccessIndicatorProps> = ({ show }) => {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed flex items-center justify-center w-12 h-12 bg-green-400 text-white rounded-full shadow-lg z-30
        ${show ? 'opacity-100 scale-100' : 'opacity-0 scale-90 pointer-events-none'}`}
      style={{
        bottom: `calc(2rem + env(safe-area-inset-bottom, 0px))`,
        right: `calc(6.5rem + env(safe-area-inset-right, 0px))`,
        transition: 'transform 0.25s cubic-bezier(0.22, 0.61, 0.36, 1), opacity 0.25s ease-in-out, transform 0.25s ease-in-out',
      }}
    >
      <CheckIcon className="w-10 h-10" />
    </div>
  );
};

export default SuccessIndicator;
