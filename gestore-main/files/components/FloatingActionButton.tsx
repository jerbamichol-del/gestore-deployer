import React, { useState, useEffect, useRef } from 'react';
import { PlusIcon } from './icons/PlusIcon';
import { MicrophoneIcon } from './icons/MicrophoneIcon';
import { PhotoIcon } from './icons/PhotoIcon';
import { PencilIcon } from './icons/PencilIcon';
import { useTapBridge } from '../hooks/useTapBridge';

interface FloatingActionButtonProps {
  onAddManually: () => void;
  onAddFromImage: () => void;
  onAddFromVoice: () => void;
  style?: React.CSSProperties;
}

const FloatingActionButton: React.FC<FloatingActionButtonProps> = ({ onAddManually, onAddFromImage, onAddFromVoice, style }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [isMounted, setIsMounted] = useState(false);
    const [renderActions, setRenderActions] = useState(false); // State to control rendering for animations
    const timerRef = useRef<number | null>(null);
    const animationTimerRef = useRef<number | null>(null);
    const tapBridge = useTapBridge();

    useEffect(() => {
        // Trigger the entrance animation shortly after the component mounts
        const timer = setTimeout(() => setIsMounted(true), 100);
        return () => clearTimeout(timer);
    }, []);

    // Effect to manage rendering for animations
    useEffect(() => {
        if (isOpen) {
            setRenderActions(true);
        } else {
            if (animationTimerRef.current) clearTimeout(animationTimerRef.current);
            // Wait for the animation to finish before removing elements from the DOM
            animationTimerRef.current = window.setTimeout(() => {
                setRenderActions(false);
            }, 300); // This duration must match the CSS transition duration
        }
        return () => {
            if (animationTimerRef.current) clearTimeout(animationTimerRef.current);
        };
    }, [isOpen]);

    // Autoclose timer
    useEffect(() => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
        }
        if (isOpen) {
            timerRef.current = window.setTimeout(() => {
                setIsOpen(false);
            }, 5000);
        }
        return () => {
            if (timerRef.current) {
                clearTimeout(timerRef.current);
            }
        };
    }, [isOpen]);

    const handleActionClick = (action: () => void) => {
        action();
        setIsOpen(false);
    };
    
    const actions = [
        { label: 'Aggiungi Manualmente', icon: <PencilIcon className="w-7 h-7" />, onClick: () => handleActionClick(onAddManually), bgColor: 'bg-indigo-500', hoverBgColor: 'hover:bg-indigo-600' },
        { label: 'Aggiungi da Immagine', icon: <PhotoIcon className="w-7 h-7" />, onClick: () => handleActionClick(onAddFromImage), bgColor: 'bg-sky-600', hoverBgColor: 'hover:bg-sky-700' },
        { label: 'Aggiungi con Voce', icon: <MicrophoneIcon className="w-7 h-7" />, onClick: () => handleActionClick(onAddFromVoice), bgColor: 'bg-purple-600', hoverBgColor: 'hover:bg-purple-700' },
    ];

    const baseStyle: React.CSSProperties = {
        bottom: `calc(1.5rem + env(safe-area-inset-bottom, 0px))`,
        right: `calc(1.5rem + env(safe-area-inset-right, 0px))`,
    };
    
    const finalStyle: React.CSSProperties = { ...baseStyle, ...style };

    return (
        <div 
            className="fixed z-40 flex flex-col items-center"
            style={finalStyle}
        >
            {/* Action buttons are only in the DOM when they should be visible or animating out */}
            <div className="flex flex-col-reverse items-center gap-4 mb-4">
                {renderActions && actions.map((action, index) => (
                    <div 
                         key={action.label} 
                         className={`transition-all duration-300 ease-in-out ${isOpen ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}
                         style={{ transitionDelay: isOpen ? `${(actions.length - 1 - index) * 50}ms` : '0ms' }}
                    >
                        <button
                            onClick={action.onClick}
                            tabIndex={isOpen ? 0 : -1}
                            className={`flex justify-center items-center w-14 h-14 ${action.bgColor} text-white rounded-full shadow-lg ${action.hoverBgColor} focus:outline-none`}
                            aria-label={action.label}
                            {...tapBridge}
                        >
                            {action.icon}
                        </button>
                    </div>
                ))}
            </div>
            
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`pointer-events-auto flex justify-center items-center w-16 h-16 bg-indigo-600 text-white rounded-full shadow-lg hover:bg-indigo-700 transition-all transform duration-500 ease-in-out focus:outline-none ${isMounted ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-16 scale-90'}`}
                aria-expanded={isOpen}
                aria-label={isOpen ? "Chiudi menu azioni" : "Apri menu azioni"}
                {...tapBridge}
            >
                 <div className={`transition-transform duration-300 ease-in-out ${isOpen ? 'rotate-45' : ''}`}>
                     <PlusIcon className="w-8 h-8" />
                </div>
            </button>
        </div>
    );
};

export default FloatingActionButton;