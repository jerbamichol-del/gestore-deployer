// CalculatorContainer.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Expense, Account } from '../types';
import CalculatorInputScreen from './CalculatorInputScreen';
import TransactionDetailPage from './TransactionDetailPage';
import { useSwipe } from '../hooks/useSwipe';
import { useTapBridge } from '../hooks/useTapBridge';

interface CalculatorContainerProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: Omit<Expense, 'id'>) => void;
  accounts: Account[];
  expenses?: Expense[];
  onEditExpense?: (expense: Expense) => void;
  onDeleteExpense?: (id: string) => void;
  onMenuStateChange?: (isOpen: boolean) => void;
}

const useMediaQuery = (query: string) => {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false
  );
  useEffect(() => {
    const media = window.matchMedia(query);
    const listener = () => setMatches(media.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [query]);
  return matches;
};

// UTC-safe utilities
const toYYYYMMDD = (date: Date) => {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const getCurrentTime = () =>
  new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });

const CalculatorContainer: React.FC<CalculatorContainerProps> = ({
  isOpen,
  onClose,
  onSubmit,
  accounts,
  onMenuStateChange = (_isOpen: boolean) => {},
}) => {
  const [isAnimating, setIsAnimating] = useState(false);
  const [view, setView] = useState<'calculator' | 'details'>('calculator');
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [dateError, setDateError] = useState(false);

  // NEW: gate per riattivare lo swipe a ogni apertura
  const [swipeReady, setSwipeReady] = useState(false);

  const timeoutsRef = useRef<number[]>([]);
  const tapBridgeHandlers = useTapBridge();

  const addTimeout = useCallback((timeout: number) => {
    timeoutsRef.current.push(timeout);
    return timeout;
  }, []);

  const resetFormData = useCallback(
    (): Partial<Omit<Expense, 'id'>> => ({
      amount: 0,
      description: '',
      date: toYYYYMMDD(new Date()),
      time: getCurrentTime(),
      accountId: accounts[0]?.id || '',
      category: '',
      subcategory: undefined,
      frequency: undefined,
      recurrence: undefined,
      monthlyRecurrenceType: 'dayOfMonth',
      recurrenceInterval: undefined,
      recurrenceDays: undefined,
      recurrenceEndType: 'forever',
      recurrenceEndDate: undefined,
      recurrenceCount: undefined,
    }),
    [accounts]
  );

  const [formData, setFormData] = useState<Partial<Omit<Expense, 'id'>>>(resetFormData);
  const isDesktop = useMediaQuery('(min-width: 768px)');

  // VisualViewport per tastiera
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv || !isOpen) return;

    // reset stato tastiera all'apertura
    setKeyboardOpen(false);

    const handleResize = () => {
      const isKeyboardVisible = window.innerHeight - vv.height > 120;
      setKeyboardOpen(isKeyboardVisible);
    };
    vv.addEventListener('resize', handleResize);
    return () => vv.removeEventListener('resize', handleResize);
  }, [isOpen]);

  // Animazioni + reset + (NEW) swipeReady
  useEffect(() => {
    if (isOpen) {
      setFormData(resetFormData());
      setDateError(false);
      setView('calculator');
      // gate: disabilita e riabilita swipe dopo breve delay per forzare rebind
      setSwipeReady(false);
      const t1 = addTimeout(window.setTimeout(() => setIsAnimating(true), 10));
      const t2 = addTimeout(window.setTimeout(() => setSwipeReady(true), 50));
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    } else {
      setIsAnimating(false);
      setSwipeReady(false);
      const t = addTimeout(window.setTimeout(() => {
        setFormData(resetFormData());
        setDateError(false);
      }, 300));
      return () => clearTimeout(t);
    }
  }, [isOpen, resetFormData, addTimeout]);

  // Cleanup timeouts
  useEffect(() => {
    return () => timeoutsRef.current.forEach(clearTimeout);
  }, []);

  const containerRef = useRef<HTMLDivElement>(null);

  const navigateTo = useCallback((next: 'calculator' | 'details') => {
    if (view === next) return;
    (document.activeElement as HTMLElement | null)?.blur?.();
    setView(next);
    window.dispatchEvent(new CustomEvent('page-activated', { detail: next }));
    // chiudi tastiera in background (se serve), senza bloccare i tap
    setTimeout(() => {
      const vv: any = (window as any).visualViewport;
      const start = Date.now();
      const check = () => {
        if (!vv || Date.now() - start > 200) return;
        requestAnimationFrame(check);
      };
      check();
    }, 0);
  }, [view]);

  // Swipe handler (abilitato solo quando swipeReady è true)
  const { progress, isSwiping } = useSwipe(
    containerRef,
    {
      onSwipeLeft: view === 'calculator' ? () => navigateTo('details') : undefined,
      onSwipeRight: view === 'details' ? () => navigateTo('calculator') : undefined,
    },
    {
      enabled: swipeReady && !isDesktop && isOpen && !isMenuOpen && !keyboardOpen,
      threshold: 36,
      slop: 10,
    }
  );

  useEffect(() => {
    onMenuStateChange(isMenuOpen || keyboardOpen);
  }, [isMenuOpen, keyboardOpen, onMenuStateChange]);

  const handleFormChange = useCallback((patch: Partial<Omit<Expense, 'id'>>) => {
    if ('date' in patch && patch.date) setDateError(false);
    setFormData(prev => ({ ...prev, ...patch }));
  }, []);

  const handleAttemptSubmit = useCallback((data: Omit<Expense, 'id'>) => {
    if (!data.date) {
      navigateTo('details');
      setDateError(true);
      const t = addTimeout(window.setTimeout(() => document.getElementById('date')?.focus(), 150));
      return;
    }
    setDateError(false);
    onSubmit(data);
  }, [navigateTo, onSubmit, addTimeout]);

  if (!isOpen) return null;

  const baseTranslate = view === 'calculator' ? 0 : -50;
  const dragTranslate = progress * 50;
  const finalTranslate = baseTranslate + dragTranslate;

  const transformStyle = isDesktop ? {} : {
    transform: `translateX(${finalTranslate}%)`,
    transition: isSwiping ? 'none' : 'transform 0.25s ease-out',
    willChange: 'transform',
  };

  return (
    <div
      className={`fixed inset-0 z-50 bg-slate-100 transform transition-transform duration-300 ease-in-out ${
        isAnimating ? 'translate-y-0' : 'translate-y-full'
      }`}
      aria-modal="true"
      role="dialog"
      style={{ touchAction: 'pan-y' }}
      {...tapBridgeHandlers}
    >
      <div
        ref={containerRef}
        className="relative h-full w-full overflow-hidden"
        style={{ touchAction: 'pan-y' }}
      >
        <div
          className="absolute inset-0 flex w-[200%] md:w-full md:grid md:grid-cols-2"
          style={transformStyle}
        >
          <div
            className={`w-1/2 md:w-auto h-full relative overflow-hidden ${view === 'calculator' ? 'z-10' : 'z-0'}`}
            aria-hidden={!isDesktop && view !== 'calculator'}
          >
            <CalculatorInputScreen
              formData={formData}
              onFormChange={handleFormChange}
              onClose={onClose}
              onSubmit={handleAttemptSubmit}
              accounts={accounts}
              onNavigateToDetails={() => navigateTo('details')}
              onMenuStateChange={setIsMenuOpen}
              isDesktop={isDesktop}
            />
          </div>

          <div
            className={`w-1/2 md:w-auto h-full relative overflow-hidden ${view === 'details' ? 'z-10' : 'z-0'}`}
            aria-hidden={!isDesktop && view !== 'details'}
          >
            <TransactionDetailPage
              formData={formData}
              onFormChange={handleFormChange}
              accounts={accounts}
              onClose={() => navigateTo('calculator')}
              onSubmit={handleAttemptSubmit}
              isDesktop={isDesktop}
              onMenuStateChange={setIsMenuOpen}
              dateError={dateError}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default CalculatorContainer;
