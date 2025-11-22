import React, { useState, useEffect, useRef } from 'react';
import { XMarkIcon } from './icons/XMarkIcon';
import { CheckCircleIcon } from './icons/CheckCircleIcon';
import { useSheetDragControlled } from '../hooks/useSheetDragControlled';

interface Option {
    value: string;
    label: string;
    Icon?: React.FC<React.SVGProps<SVGSVGElement>>;
    color?: string;
    bgColor?: string;
}

interface SelectionMenuProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  options: Option[];
  selectedValue: string;
  onSelect: (value: string) => void;
}

const SelectionMenu: React.FC<SelectionMenuProps> = ({ isOpen, onClose, title, options, selectedValue, onSelect }) => {
  const [isMounted, setIsMounted] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const { dragY, transitionMs, easing, handleTransitionEnd } =
    useSheetDragControlled(menuRef, { onClose }, {
      triggerPercent: 0.25,
      elastic: 0.92,
      topGuardPx: 2,
      scrollableSelector: '[data-scrollable]'
    });

  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => setIsMounted(true));
    } else {
      setIsMounted(false);
    }
  }, [isOpen]);

  const handleManualClose = () => setIsMounted(false);
  
  const onInternalTransitionEnd = (e: React.TransitionEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && e.propertyName === 'transform') {
      // The hook's handler is stateful and can be called on every transition.
      // It will call onClose internally only if it was a successful swipe-close action.
      handleTransitionEnd(e.nativeEvent as any);
      
      // If the transition ended because of a manual close (e.g., clicking X),
      // we must call onClose to unmount the component.
      if (!isMounted) {
        onClose();
      }
    }
  };

  if (!isOpen) return null;

  // The hook is active if the user is dragging (dragY > 0) or a release animation is running (transitionMs > 0).
  const isHookActive = dragY > 0 || transitionMs > 0;

  let transformStyle: string;
  let transitionStyle: string;
  const openCloseEasing = 'cubic-bezier(0.22, 0.61, 0.36, 1)'; // A standard ease-out

  if (isHookActive) {
    // While dragging or animating a release, the hook controls the style.
    transformStyle = `translate3d(0, ${dragY}px, 0)`;
    transitionStyle = `transform ${transitionMs}ms ${easing}`;
  } else {
    // When idle, opening, or closing manually, the component controls its own animation.
    const h = menuRef.current?.clientHeight ?? window.innerHeight;
    transformStyle = `translate3d(0, ${isMounted ? 0 : h}px, 0)`;
    transitionStyle = `transform 250ms ${openCloseEasing}`;
  }

  return (
    <div
      className="absolute inset-0 z-[60]"
      aria-modal="true"
      role="dialog"
    >
      <div
        className={`absolute inset-0 bg-slate-900/60 transition-opacity duration-300 ease-in-out ${isMounted ? 'opacity-100' : 'opacity-0'}`}
        onClick={handleManualClose}
      />
      <div
        ref={menuRef}
        onTransitionEnd={onInternalTransitionEnd}
        onClick={(e) => e.stopPropagation()}
        className="absolute bottom-0 left-0 right-0 z-10 bg-slate-50 rounded-t-2xl shadow-xl max-h-[80vh] flex flex-col"
        style={{
          transform: transformStyle,
          transition: transitionStyle,
          touchAction: 'pan-y',
          willChange: 'transform',
          overscrollBehaviorY: 'contain'
        }}
      >
        <header className="flex justify-between items-center p-4 border-b border-slate-200 flex-shrink-0">
          <div className="flex-1 text-center">
             <div className="inline-block h-1.5 w-10 rounded-full bg-slate-300 absolute top-2 left-1/2 -translate-x-1/2" />
             <h2 className="text-lg font-bold text-slate-800 pointer-events-none mt-2">{title}</h2>
          </div>
          <button
            type="button"
            onClick={handleManualClose}
            className="text-slate-500 hover:text-slate-800 transition-colors p-2 rounded-full hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 absolute top-2 right-2"
            aria-label="Chiudi"
          >
            <XMarkIcon className="w-6 h-6" />
          </button>
        </header>
        <div data-scrollable className="overflow-y-auto p-2" style={{ overscrollBehavior: 'contain' }}>
          <ul>
            {options.map((option) => {
              const isSelected = selectedValue === option.value;
              return (
                <li key={option.value}>
                  <button
                    onClick={() => onSelect(option.value)}
                    style={{ touchAction: 'manipulation' }}
                    className={`w-full text-left p-4 flex items-center justify-between gap-4 transition-colors rounded-lg ${
                      isSelected ? 'bg-indigo-100' : 'hover:bg-slate-200'
                    }`}
                  >
                    <span className="flex items-center gap-4 min-w-0">
                      {option.Icon && option.bgColor && (
                        <span className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${option.bgColor}`}>
                          <option.Icon className={`w-7 h-7 ${option.color}`} />
                        </span>
                      )}
                      <span className={`font-medium text-lg truncate ${isSelected ? 'text-indigo-700' : 'text-slate-800'}`}>
                        {option.label}
                      </span>
                    </span>
                    {isSelected && <CheckCircleIcon className="w-7 h-7 text-indigo-600 flex-shrink-0" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
};

export default SelectionMenu;