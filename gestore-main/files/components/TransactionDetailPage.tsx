// TransactionDetailPage.tsx
import React, { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import { Expense, Account } from '../types';
import { ArrowLeftIcon } from './icons/ArrowLeftIcon';
import { DocumentTextIcon } from './icons/DocumentTextIcon';
import { CalendarIcon } from './icons/CalendarIcon';
import { CreditCardIcon } from './icons/CreditCardIcon';
import { ClockIcon } from './icons/ClockIcon';
import { ChevronDownIcon } from './icons/ChevronDownIcon';
import { XMarkIcon } from './icons/XMarkIcon';
import { formatCurrency } from './icons/formatters';
import SelectionMenu from './SelectionMenu';

interface TransactionDetailPageProps {
  formData: Partial<Omit<Expense, 'id'>>;
  onFormChange: (newData: Partial<Omit<Expense, 'id'>>) => void;
  accounts: Account[];
  onClose: () => void;
  onSubmit: (data: Omit<Expense, 'id'>) => void;
  isDesktop: boolean;
  onMenuStateChange: (isOpen: boolean) => void;
  dateError: boolean;
}

// UTC-safe date utilities
const toYYYYMMDD = (date: Date) => {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const parseLocalYYYYMMDD = (s?: string | null) => {
  if (!s) return null;
  const [Y, M, D] = s.split('-').map(Number);
  return new Date(Date.UTC(Y, M - 1, D));
};

const recurrenceLabels = {
  daily: 'Giornaliera',
  weekly: 'Settimanale',
  monthly: 'Mensile',
  yearly: 'Annuale',
} as const;

const daysOfWeekLabels = { 0: 'Dom', 1: 'Lun', 2: 'Mar', 3: 'Mer', 4: 'Gio', 5: 'Ven', 6: 'Sab' } as const;
const dayOfWeekNames = ['domenica','lunedì','martedì','mercoledì','giovedì','venerdì','sabato'];
const ordinalSuffixes = ['primo','secondo','terzo','quarto','ultimo'];

const formatShortDate = (s?: string) => {
  const d = parseLocalYYYYMMDD(s);
  if (!d) return '';
  return new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(d)
    .replace('.', '');
};

// Componente Modal riutilizzabile
const Modal = memo<{
  isOpen: boolean;
  isAnimating: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  className?: string;
}>(({ isOpen, isAnimating, onClose, title, children, className }) => {
  if (!isOpen && !isAnimating) return null;
  
  return (
    <div
      className={`absolute inset-0 z-[60] flex justify-center items-center p-4 transition-opacity duration-300 ${isAnimating ? 'opacity-100' : 'opacity-0'} bg-slate-900/60 backdrop-blur-sm`}
      onClick={onClose}
      aria-modal="true"
      role="dialog"
    >
      <div
        className={`bg-white rounded-lg shadow-xl w-full max-w-sm transform transition-all duration-300 ${isAnimating ? 'scale-100 opacity-100' : 'scale-95 opacity-0'} ${className || ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center p-4 border-b border-slate-200">
          <h2 className="text-lg font-bold text-slate-800">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-slate-800 p-1 rounded-full hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            aria-label="Chiudi"
          >
            <XMarkIcon className="w-6 h-6" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
});
Modal.displayName = 'Modal';

const daysOfWeekForPicker = [
  { label: 'Lun', value: 1 }, { label: 'Mar', value: 2 }, { label: 'Mer', value: 3 },
  { label: 'Gio', value: 4 }, { label: 'Ven', value: 5 }, { label: 'Sab', value: 6 },
  { label: 'Dom', value: 0 },
];

// Utility spostata fuori per coerenza
const getRecurrenceSummary = (e: Partial<Expense>) => {
  if (e.frequency !== 'recurring' || !e.recurrence) return 'Imposta ricorrenza';

  const {
    recurrence,
    recurrenceInterval = 1,
    recurrenceDays,
    monthlyRecurrenceType,
    date: startDate,
    recurrenceEndType = 'forever',
    recurrenceEndDate,
    recurrenceCount,
  } = e;

  let s = '';
  if (recurrenceInterval === 1) {
    s = recurrenceLabels[recurrence];
  } else {
    s =
      recurrence === 'daily'   ? `Ogni ${recurrenceInterval} giorni` :
      recurrence === 'weekly'  ? `Ogni ${recurrenceInterval} sett.` :
      recurrence === 'monthly' ? `Ogni ${recurrenceInterval} mesi` :
                                 `Ogni ${recurrenceInterval} anni`;
  }

  if (recurrence === 'weekly' && recurrenceDays?.length) {
    const ordered = [...recurrenceDays].sort(
      (a, b) => (a === 0 ? 7 : a) - (b === 0 ? 7 : b)
    );
    const labels = ordered.map(d => daysOfWeekLabels[d as keyof typeof daysOfWeekLabels]);
    s += `: ${labels.join(', ')}`;
  }

  if (recurrence === 'monthly' && monthlyRecurrenceType === 'dayOfWeek' && startDate) {
    const d = parseLocalYYYYMMDD(startDate);
    if (d) {
      const dom = d.getUTCDate();
      const dow = d.getUTCDay();
      const wom = Math.floor((dom - 1) / 7);
      s += ` (${ordinalSuffixes[wom]} ${dayOfWeekNames[dow].slice(0,3)}.)`;
    }
  }

  if (recurrenceEndType === 'date' && recurrenceEndDate) {
    s += `, fino al ${formatShortDate(recurrenceEndDate)}`;
  } else if (recurrenceEndType === 'count' && recurrenceCount && recurrenceCount > 0) {
    s += `, ${recurrenceCount} volte`;
  }

  return s;
};

const getIntervalLabel = (
  recurrence?: 'daily'|'weekly'|'monthly'|'yearly',
  n?: number
) => {
  const c = n || 1;
  switch (recurrence) {
    case 'daily':   return c === 1 ? 'giorno'     : 'giorni';
    case 'weekly':  return c === 1 ? 'settimana'  : 'settimane';
    case 'monthly': return c === 1 ? 'mese'       : 'mesi';
    case 'yearly':  return c === 1 ? 'anno'       : 'anni';
    default:        return 'mese';
  }
};

const TransactionDetailPage: React.FC<TransactionDetailPageProps> = ({
  formData,
  onFormChange,
  accounts,
  onClose,
  onSubmit,
  isDesktop,
  onMenuStateChange,
  dateError,
}) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const descriptionInputRef = useRef<HTMLInputElement>(null);

  const [activeMenu, setActiveMenu] = useState<'account' | null>(null);

  const [isFrequencyModalOpen, setIsFrequencyModalOpen] = useState(false);
  const [isFrequencyModalAnimating, setIsFrequencyModalAnimating] = useState(false);

  const [isRecurrenceModalOpen, setIsRecurrenceModalOpen] = useState(false);
  const [isRecurrenceModalAnimating, setIsRecurrenceModalAnimating] = useState(false);
  const [isRecurrenceOptionsOpen, setIsRecurrenceOptionsOpen] = useState(false);
  const [isRecurrenceEndOptionsOpen, setIsRecurrenceEndOptionsOpen] = useState(false);

  const [tempRecurrence, setTempRecurrence] = useState(formData.recurrence);
  const [tempRecurrenceInterval, setTempRecurrenceInterval] = useState<number | undefined>(formData.recurrenceInterval);
  const [tempRecurrenceDays, setTempRecurrenceDays] = useState<number[] | undefined>(formData.recurrenceDays);
  const [tempMonthlyRecurrenceType, setTempMonthlyRecurrenceType] = useState(formData.monthlyRecurrenceType);

  const isSingleRecurring =
    formData.frequency === 'recurring' &&
    formData.recurrenceEndType === 'count' &&
    formData.recurrenceCount === 1;

  // Inizializza time in useEffect per evitare hydration mismatch
  useEffect(() => {
    if (!formData.time && !formData.frequency) {
      const time = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
      onFormChange({ time });
    }
  }, []); // Solo al mount

  // Debounced keyboard close handler
  const handleKeyboardClose = useRef<(() => void) | null>(null);
  
  useEffect(() => {
    handleKeyboardClose.current = () => {
      const activeEl = document.activeElement;
      if (activeEl === descriptionInputRef.current) {
        (activeEl as HTMLElement).blur();
      }
    };
  }, []);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    let lastHeight = vv.height;
    const handleResize = () => {
      const heightIncrease = vv.height - lastHeight;
      if (heightIncrease > 100 && handleKeyboardClose.current) {
        handleKeyboardClose.current();
      }
      lastHeight = vv.height;
    };

    vv.addEventListener('resize', handleResize);
    return () => vv.removeEventListener('resize', handleResize);
  }, []);

  // blocca swipe container quando modali/menu aperti
  useEffect(() => {
    const anyOpen = !!(activeMenu || isFrequencyModalOpen || isRecurrenceModalOpen);
    onMenuStateChange(anyOpen);
  }, [activeMenu, isFrequencyModalOpen, isRecurrenceModalOpen, onMenuStateChange]);

  // animazioni modali
  useEffect(() => {
    if (isFrequencyModalOpen) {
      const t = setTimeout(() => setIsFrequencyModalAnimating(true), 10);
      return () => clearTimeout(t);
    } else {
      setIsFrequencyModalAnimating(false);
    }
  }, [isFrequencyModalOpen]);

  useEffect(() => {
    if (isRecurrenceModalOpen) {
      setTempRecurrence(formData.recurrence || 'monthly');
      setTempRecurrenceInterval(formData.recurrenceInterval || 1);
      setTempRecurrenceDays(formData.recurrenceDays || []);
      setTempMonthlyRecurrenceType(formData.monthlyRecurrenceType || 'dayOfMonth');
      setIsRecurrenceOptionsOpen(false);
      const t = setTimeout(() => setIsRecurrenceModalAnimating(true), 10);
      return () => clearTimeout(t);
    } else {
      setIsRecurrenceModalAnimating(false);
    }
  }, [isRecurrenceModalOpen, formData.recurrence, formData.recurrenceInterval, formData.recurrenceDays, formData.monthlyRecurrenceType]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;

    if (name === 'recurrenceEndDate') {
      if (value === '') {
        onFormChange({ recurrenceEndType: 'forever', recurrenceEndDate: undefined });
      } else {
        onFormChange({ recurrenceEndDate: value });
      }
      return;
    }

    if (name === 'recurrenceCount') {
      const num = parseInt(value, 10);
      onFormChange({ [name]: isNaN(num) || num <= 0 ? undefined : num } as any);
      return;
    }

    onFormChange({ [name]: value });
  };

  const handleAccountSelect = (accountId: string) => {
    onFormChange({ accountId });
    setActiveMenu(null);
  };

  const handleFrequencySelect = (frequency: 'none' | 'single' | 'recurring') => {
    const up: Partial<Expense> = {};
    if (frequency === 'none') {
      Object.assign(up, {
        frequency: undefined,
        date: toYYYYMMDD(new Date()),
        time: undefined,
        recurrence: undefined,
        monthlyRecurrenceType: undefined,
        recurrenceInterval: undefined,
        recurrenceDays: undefined,
        recurrenceEndType: 'forever',
        recurrenceEndDate: undefined,
        recurrenceCount: undefined,
      });
    } else if (frequency === 'single') {
        up.frequency = 'recurring';
        up.recurrence = undefined;
        up.recurrenceInterval = undefined;
        up.recurrenceDays = undefined;
        up.monthlyRecurrenceType = undefined;
        up.recurrenceEndType = 'count';
        up.recurrenceCount = 1;
        up.recurrenceEndDate = undefined;
    } else { // recurring
      up.frequency = 'recurring';
      up.time = undefined;
      if (!formData.recurrence) up.recurrence = 'monthly';
      up.recurrenceEndType = 'forever';
      up.recurrenceCount = undefined;
      up.recurrenceEndDate = undefined;
    }
    onFormChange(up);
    setIsFrequencyModalOpen(false);
    setIsFrequencyModalAnimating(false);
  };

  const handleApplyRecurrence = () => {
    onFormChange({
      recurrence: tempRecurrence as any,
      recurrenceInterval: tempRecurrenceInterval || 1,
      recurrenceDays: tempRecurrence === 'weekly' ? tempRecurrenceDays : undefined,
      monthlyRecurrenceType: tempRecurrence === 'monthly' ? tempMonthlyRecurrenceType : undefined,
    });
    setIsRecurrenceModalOpen(false);
    setIsRecurrenceModalAnimating(false);
  };

  const dynamicMonthlyDayOfWeekLabel = useMemo(() => {
    const ds = formData.date;
    if (!ds) return 'Seleziona una data di inizio valida';
    const d = parseLocalYYYYMMDD(ds);
    if (!d) return 'Data non valida';
    const dom = d.getUTCDate();
    const dow = d.getUTCDay();
    const wom = Math.floor((dom - 1) / 7);
    return `Ogni ${ordinalSuffixes[wom]} ${dayOfWeekNames[dow]} del mese`;
  }, [formData.date]);

  const getRecurrenceEndLabel = () => {
    const t = formData.recurrenceEndType;
    if (!t || t === 'forever') return 'Per sempre';
    if (t === 'date') return 'Fino a...';
    if (t === 'count') return 'Numero di volte';
    return 'Per sempre';
  };

  if (typeof formData.amount !== 'number') {
    return (
      <div
        ref={rootRef}
        tabIndex={-1}
        className="flex flex-col h-full bg-slate-100 items-center justify-center p-4"
      >
        <header className="p-4 flex items-center gap-4 text-slate-800 bg-white shadow-sm absolute top-0 left-0 right-0 z-10">
          {!isDesktop && (
            <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-200" aria-label="Torna alla calcolatrice">
              <ArrowLeftIcon className="w-6 h-6" />
            </button>
          )}
          <h2 className="text-xl font-bold">Aggiungi Dettagli</h2>
        </header>
        <p className="text-slate-500 text-center">Nessun dato dall'importo. Torna indietro e inserisci una spesa.</p>
      </div>
    );
  }

  const isFrequencySet = !!formData.frequency;
  const selectedAccountLabel = accounts.find(a => a.id === formData.accountId)?.name;
  const accountOptions = useMemo(() => 
    accounts.map(a => ({ value: a.id, label: a.name })),
    [accounts]
  );

  const DateTimeInputs = useMemo(() => (
    <div className={`grid ${!formData.frequency ? 'grid-cols-2' : 'grid-cols-1'} gap-4`}>
      <div>
        <label htmlFor="date" className={`block text-base font-medium mb-1 ${dateError ? 'text-red-600' : 'text-slate-700'}`}>
          {isSingleRecurring ? 'Data del Pagamento' : formData.frequency === 'recurring' ? 'Data di inizio' : 'Data'}
        </label>
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <CalendarIcon className="h-5 w-5 text-slate-400" />
          </div>
          <input
            id="date"
            name="date"
            type="date"
            value={formData.date || ''}
            onChange={handleInputChange}
            className={`block w-full rounded-md bg-white py-2.5 pl-10 pr-3 text-base text-slate-900 placeholder:text-slate-400 focus:outline-none ${dateError ? 'border-red-500 ring-1 ring-red-500' : 'border border-slate-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500'}`}
            enterKeyHint="done"
            onKeyDown={(e) => { if (e.key === 'Enter') { (e.currentTarget as HTMLInputElement).blur(); e.preventDefault(); } }}
            onFocus={(e) => e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'center' })}
          />
        </div>
        {dateError && <p className="mt-1 text-sm text-red-600">Per favore, imposta una data.</p>}
      </div>

      {!formData.frequency && (
        <div>
          <label htmlFor="time" className="block text-base font-medium text-slate-700 mb-1">Ora</label>
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
              <ClockIcon className="h-5 w-5 text-slate-400" />
            </div>
            <input
              id="time"
              name="time"
              type="time"
              value={formData.time || ''}
              onChange={handleInputChange}
              className="block w-full rounded-md border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              enterKeyHint="done"
              onKeyDown={(e) => { if (e.key === 'Enter') { (e.currentTarget as HTMLInputElement).blur(); e.preventDefault(); } }}
              onFocus={(e) => e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'center' })}
            />
          </div>
        </div>
      )}
    </div>
  ), [formData.frequency, formData.date, dateError, formData.time, isSingleRecurring]);

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      className="flex flex-col h-full bg-slate-100 focus:outline-none"
      style={{ touchAction: 'pan-y' }}
    >
      <header className="p-4 flex items-center justify-between gap-4 text-slate-800 bg-white shadow-sm sticky top-0 z-10">
        <div className="flex items-center gap-4">
          {!isDesktop && (
            <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-200" aria-label="Torna alla calcolatrice">
              <ArrowLeftIcon className="w-6 h-6" />
            </button>
          )}
          <h2 className="text-xl font-bold">Aggiungi Dettagli</h2>
        </div>
        <div className="w-11 h-11" />
      </header>

      <main className="flex-1 p-4 flex flex-col overflow-y-auto" style={{ touchAction: 'pan-y' }}>
        <div className="space-y-2">
          {/* Importo Display */}
          <div className="flex justify-center items-center py-0">
            <div className="relative flex items-baseline justify-center text-indigo-600">
                <span className="text-[2.6rem] leading-none font-bold tracking-tighter relative z-10">
                    {formatCurrency(formData.amount || 0).replace(/[^0-9,.]/g, '')}
                </span>
                <span className="text-3xl font-medium text-indigo-400 opacity-70 absolute" style={{ right: '100%', marginRight: '8px', top: '4px' }}>
                    €
                </span>
            </div>
          </div>

          {/* Descrizione */}
          <div>
            <label htmlFor="description" className="block text-base font-medium text-slate-700 mb-1">Descrizione</label>
            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                <DocumentTextIcon className="h-5 w-5 text-slate-400" />
              </div>
              <input
                ref={descriptionInputRef}
                id="description"
                name="description"
                type="text"
                value={formData.description || ''}
                onChange={handleInputChange}
                className="block w-full rounded-md border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                placeholder="Es. Caffè al bar"
                enterKeyHint="done"
                onKeyDown={(e) => { if (e.key === 'Enter') { (e.currentTarget as HTMLInputElement).blur(); e.preventDefault(); } }}
              />
            </div>
          </div>

          <div>
            <label className="block text-base font-medium text-slate-700 mb-1">Conto</label>
            <button
              type="button"
              onClick={() => setActiveMenu('account')}
              className="w-full flex items-center text-left gap-2 px-3 py-2.5 text-base rounded-lg border shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors bg-white border-slate-300 text-slate-800 hover:bg-slate-50"
            >
              <CreditCardIcon className="h-5 w-5 text-slate-400" />
              <span className="truncate flex-1">{selectedAccountLabel || 'Seleziona'}</span>
              <ChevronDownIcon className="w-5 h-5 text-slate-500" />
            </button>
          </div>

          {!isFrequencySet && DateTimeInputs}

          <div className="bg-white p-4 rounded-lg border border-slate-200 space-y-4">
            <div>
              <label className="block text-base font-medium text-slate-700 mb-1">Frequenza</label>
              <button
                type="button"
                onClick={() => setIsFrequencyModalOpen(true)}
                className={`w-full flex items-center justify-between text-left gap-2 px-3 py-2.5 text-base rounded-lg border shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors ${
                  isFrequencySet
                    ? 'bg-white border-slate-300 text-slate-800 hover:bg-slate-50'
                    : 'bg-slate-100 border-slate-200 text-slate-500 hover:bg-slate-200'
                }`}
              >
                <span className="truncate flex-1 capitalize">
                  {isSingleRecurring ? 'Singolo' : formData.frequency === 'recurring' ? 'Ricorrente' : 'Nessuna'}
                </span>
                <ChevronDownIcon className="w-5 h-5 text-slate-500" />
              </button>
            </div>

            {isFrequencySet && DateTimeInputs}

            {formData.frequency === 'recurring' && !isSingleRecurring && (
              <div>
                <label className="block text-base font-medium text-slate-700 mb-1">Ricorrenza</label>
                <button
                  type="button"
                  onClick={() => setIsRecurrenceModalOpen(true)}
                  className="w-full flex items-center justify-between text-left gap-2 px-3 py-2.5 text-base rounded-lg border shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors bg-white border-slate-300 text-slate-800 hover:bg-slate-50"
                >
                  <span className="truncate flex-1">{getRecurrenceSummary(formData)}</span>
                  <ChevronDownIcon className="w-5 h-5 text-slate-500" />
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="mt-auto pt-6">
          <button
            type="button"
            onClick={() => onSubmit(formData as Omit<Expense, 'id'>)}
            disabled={(formData.amount ?? 0) <= 0}
            className="w-full px-4 py-3 text-base font-semibold text-white bg-indigo-600 rounded-lg shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-colors disabled:bg-indigo-300 disabled:cursor-not-allowed disabled:active:scale-100"
          >
            Aggiungi Spesa
          </button>
        </div>
      </main>

      <SelectionMenu
        isOpen={activeMenu === 'account'}
        onClose={() => setActiveMenu(null)}
        title="Seleziona un Conto"
        options={accountOptions}
        selectedValue={formData.accountId || ''}
        onSelect={handleAccountSelect}
      />

      <Modal
        isOpen={isFrequencyModalOpen}
        isAnimating={isFrequencyModalAnimating}
        onClose={() => { setIsFrequencyModalOpen(false); setIsFrequencyModalAnimating(false); }}
        title="Seleziona Frequenza"
      >
        <div className="p-4 space-y-2">
          <button onClick={() => handleFrequencySelect('none')} className="w-full px-4 py-3 text-base font-semibold rounded-lg bg-slate-100 text-slate-800 hover:bg-indigo-100 hover:text-indigo-800">Nessuna</button>
          <button onClick={() => handleFrequencySelect('single')} className="w-full px-4 py-3 text-base font-semibold rounded-lg bg-slate-100 text-slate-800 hover:bg-indigo-100 hover:text-indigo-800">Singolo</button>
          <button onClick={() => handleFrequencySelect('recurring')} className="w-full px-4 py-3 text-base font-semibold rounded-lg bg-slate-100 text-slate-800 hover:bg-indigo-100 hover:text-indigo-800">Ricorrente</button>
        </div>
      </Modal>

      <Modal
        isOpen={isRecurrenceModalOpen}
        isAnimating={isRecurrenceModalAnimating}
        onClose={() => { setIsRecurrenceModalOpen(false); setIsRecurrenceModalAnimating(false); }}
        title="Imposta Ricorrenza"
      >
        <main className="p-4 space-y-4">
          <div className="relative">
            <button
              onClick={() => { setIsRecurrenceOptionsOpen(v => !v); setIsRecurrenceEndOptionsOpen(false); }}
              className="w-full flex items-center justify-between text-left gap-2 px-3 py-2.5 text-base rounded-lg border shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 bg-white border-slate-300 text-slate-800 hover:bg-slate-50"
            >
              <span className="truncate flex-1 capitalize">
                {recurrenceLabels[(tempRecurrence || 'monthly') as keyof typeof recurrenceLabels]}
              </span>
              <ChevronDownIcon className={`w-5 h-5 text-slate-500 transition-transform ${isRecurrenceOptionsOpen ? 'rotate-180' : ''}`} />
            </button>

            {isRecurrenceOptionsOpen && (
              <div className="absolute top-full mt-1 w-full bg-white border border-slate-200 shadow-lg rounded-lg z-20 p-2 space-y-1">
                {(Object.keys(recurrenceLabels) as Array<keyof typeof recurrenceLabels>).map((k) => (
                  <button
                    key={k}
                    onClick={() => { setTempRecurrence(k as any); setIsRecurrenceOptionsOpen(false); }}
                    className="w-full text-left px-4 py-3 text-base font-semibold rounded-lg bg-slate-50 text-slate-800 hover:bg-indigo-100 hover:text-indigo-800"
                  >
                    {recurrenceLabels[k]}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="pt-2">
            <div className="flex items-center justify-center gap-2 bg-slate-100 p-3 rounded-lg">
              <span className="text-base text-slate-700">Ogni</span>
              <input
                type="number"
                value={tempRecurrenceInterval || ''}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '') setTempRecurrenceInterval(undefined);
                  else {
                    const n = parseInt(v, 10);
                    if (!isNaN(n) && n > 0) setTempRecurrenceInterval(n);
                  }
                }}
                onFocus={(e) => e.currentTarget.select()}
                className="w-12 text-center text-lg font-bold text-slate-800 bg-transparent border-0 border-b-2 border-slate-400 focus:ring-0 focus:outline-none focus:border-indigo-600 p-0"
                min={1}
              />
              <span className="text-base text-slate-700">{getIntervalLabel(tempRecurrence as any, tempRecurrenceInterval)}</span>
            </div>
          </div>

          {tempRecurrence === 'weekly' && (
            <div className="pt-2">
              <div className="flex flex-wrap justify-center gap-2">
                {daysOfWeekForPicker.map(d => (
                  <button
                    key={d.value}
                    onClick={() => {
                      setTempRecurrenceDays(prev => {
                        const arr = prev || [];
                        const next = arr.includes(d.value)
                          ? arr.filter(x => x !== d.value)
                          : [...arr, d.value];
                        return next.sort((a,b) => (a === 0 ? 7 : a) - (b === 0 ? 7 : b));
                      });
                    }}
                    className={`w-14 h-14 rounded-full text-sm font-semibold border-2 transition-colors ${
                      (tempRecurrenceDays || []).includes(d.value)
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white text-slate-800 border-indigo-400 hover:bg-indigo-50'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {tempRecurrence === 'monthly' && (
            <div className="pt-4 space-y-2 border-t border-slate-200">
              <div
                role="radio"
                aria-checked={tempMonthlyRecurrenceType === 'dayOfMonth'}
                onClick={() => setTempMonthlyRecurrenceType('dayOfMonth')}
                className="flex items-center gap-3 p-2 cursor-pointer rounded-lg hover:bg-slate-100"
              >
                <div className="w-5 h-5 rounded-full border-2 border-slate-400 flex items-center justify-center flex-shrink-0">{tempMonthlyRecurrenceType === 'dayOfMonth' && <div className="w-2.5 h-2.5 bg-indigo-600 rounded-full" />}</div>
                <span className="text-sm font-medium text-slate-700">Lo stesso giorno di ogni mese</span>
              </div>

              <div
                role="radio"
                aria-checked={tempMonthlyRecurrenceType === 'dayOfWeek'}
                onClick={() => setTempMonthlyRecurrenceType('dayOfWeek')}
                className="flex items-center gap-3 p-2 cursor-pointer rounded-lg hover:bg-slate-100"
              >
                <div className="w-5 h-5 rounded-full border-2 border-slate-400 flex items-center justify-center flex-shrink-0">{tempMonthlyRecurrenceType === 'dayOfWeek' && <div className="w-2.5 h-2.5 bg-indigo-600 rounded-full" />}</div>
                <span className="text-sm font-medium text-slate-700">{dynamicMonthlyDayOfWeekLabel}</span>
              </div>
            </div>
          )}

          <div className="pt-4 border-t border-slate-200">
            <div className="grid grid-cols-2 gap-4 items-end">
              <div className={`relative ${!formData.recurrenceEndType || formData.recurrenceEndType === 'forever' ? 'col-span-2' : ''}`}>
                <button
                  type="button"
                  onClick={() => { setIsRecurrenceEndOptionsOpen(v => !v); setIsRecurrenceOptionsOpen(false); }}
                  className="w-full flex items-center justify-between text-left gap-2 px-3 py-2.5 text-base rounded-lg border shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 bg-white border-slate-300 text-slate-800 hover:bg-slate-50"
                >
                  <span className="truncate flex-1 capitalize">
                    {getRecurrenceEndLabel()}
                  </span>
                  <ChevronDownIcon className={`w-5 h-5 text-slate-500 transition-transform ${isRecurrenceEndOptionsOpen ? 'rotate-180' : ''}`} />
                </button>

                {isRecurrenceEndOptionsOpen && (
                  <div className="absolute top-full mt-1 w-full bg-white border border-slate-200 shadow-lg rounded-lg z-20 p-2 space-y-1 animate-fade-in-down">
                    {(['forever','date','count'] as const).map(k => (
                      <button
                        key={k}
                        onClick={() => {
                          if (k === 'forever') onFormChange({ recurrenceEndType: 'forever', recurrenceEndDate: undefined, recurrenceCount: undefined });
                          if (k === 'date')    onFormChange({ recurrenceEndType: 'date',    recurrenceEndDate: formData.recurrenceEndDate || toYYYYMMDD(new Date()), recurrenceCount: undefined });
                          if (k === 'count')   onFormChange({ recurrenceEndType: 'count',   recurrenceCount: formData.recurrenceCount || 1, recurrenceEndDate: undefined });
                          setIsRecurrenceEndOptionsOpen(false);
                        }}
                        className="w-full text-left px-4 py-3 text-base font-semibold rounded-lg bg-slate-50 text-slate-800 hover:bg-indigo-100 hover:text-indigo-800"
                      >
                        {k === 'forever' ? 'Per sempre' : k === 'date' ? 'Fino a...' : 'Numero di volte'}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {formData.recurrenceEndType === 'date' && (
                <div>
                  <label htmlFor="recurrence-end-date" className="block text-sm font-medium text-slate-700 mb-1">Data fine</label>
                  <input
                    id="recurrence-end-date"
                    name="recurrenceEndDate"
                    type="date"
                    value={formData.recurrenceEndDate || ''}
                    onChange={handleInputChange}
                    className="block w-full rounded-md border border-slate-300 bg-white py-2.5 px-3 text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    enterKeyHint="done"
                    onKeyDown={(e) => { if (e.key === 'Enter') { (e.currentTarget as HTMLInputElement).blur(); e.preventDefault(); } }}
                  />
                </div>
              )}

              {formData.recurrenceEndType === 'count' && (
                <div>
                  <label htmlFor="recurrence-count" className="block text-sm font-medium text-slate-700 mb-1">N. volte</label>
                  <input
                    id="recurrence-count"
                    name="recurrenceCount"
                    type="number"
                    value={formData.recurrenceCount || ''}
                    onChange={handleInputChange}
                    className="block w-full rounded-md border border-slate-300 bg-white py-2.5 px-3 text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    min={1}
                    enterKeyHint="done"
                    onKeyDown={(e) => { if (e.key === 'Enter') { (e.currentTarget as HTMLInputElement).blur(); e.preventDefault(); } }}
                  />
                </div>
              )}
            </div>
          </div>
        </main>

        <footer className="p-4 bg-slate-100 border-t border-slate-200 flex justify-end">
          <button
            type="button"
            onClick={handleApplyRecurrence}
            className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
          >
            Applica
          </button>
        </footer>
      </Modal>
    </div>
  );
};

export default TransactionDetailPage;
