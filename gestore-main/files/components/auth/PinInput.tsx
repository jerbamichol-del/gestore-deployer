import React from 'react';
import { BackspaceIcon } from '../icons/BackspaceIcon';

interface PinInputProps {
  pin: string;
  onPinChange: (newPin: string) => void;
  pinLength?: number;
}

const PinInput: React.FC<PinInputProps> = ({ pin, onPinChange, pinLength = 4 }) => {
  const handleNumberClick = (num: string) => {
    if (pin.length < pinLength) {
      onPinChange(pin + num);
    }
  };

  const handleBackspace = () => {
    if (pin.length > 0) {
        onPinChange(pin.slice(0, -1));
    }
  };

  const PinDots = () => (
    <div className="flex justify-center space-x-4 my-6">
      {Array.from({ length: pinLength }).map((_, index) => (
        <div
          key={index}
          className={`w-4 h-4 rounded-full border-2 transition-colors duration-200 ${
            index < pin.length ? 'bg-indigo-600 border-indigo-600' : 'bg-white border-slate-300'
          }`}
        />
      ))}
    </div>
  );

  const NumberPad = () => {
    const buttons = [
      '1', '2', '3',
      '4', '5', '6',
      '7', '8', '9',
      '', '0', 'backspace'
    ];

    return (
      <div className="grid grid-cols-3 gap-4">
        {buttons.map((btn, index) => {
          if (btn === '') return <div key={index} />;
          if (btn === 'backspace') {
            return (
              <button
                key={index}
                type="button"
                onClick={handleBackspace}
                className="w-16 h-16 mx-auto rounded-full text-slate-700 active:bg-slate-200 transition-colors flex justify-center items-center text-2xl font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500 border-2 border-slate-200"
                aria-label="Cancella"
              >
                <BackspaceIcon className="w-7 h-7" />
              </button>
            );
          }
          return (
            <button
              key={index}
              type="button"
              onClick={() => handleNumberClick(btn)}
              className="w-16 h-16 mx-auto rounded-full text-slate-700 active:bg-slate-200 transition-colors text-2xl font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500 border-2 border-slate-200"
            >
              {btn}
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div>
      <PinDots />
      <NumberPad />
    </div>
  );
};

export default PinInput;