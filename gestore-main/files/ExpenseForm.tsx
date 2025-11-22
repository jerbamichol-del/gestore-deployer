import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Expense, Account, CATEGORIES } from '../types';
import { XMarkIcon } from './icons/XMarkIcon';
import { DocumentTextIcon } from './icons/DocumentTextIcon';
import { CurrencyEuroIcon } from './icons/CurrencyEuroIcon';
import { CalendarIcon } from './icons/CalendarIcon';
import { TagIcon } from './icons/TagIcon';
import { CreditCardIcon } from './icons/CreditCardIcon';
import SelectionMenu from './SelectionMenu';
import { getCategoryStyle } from '../utils/categoryStyles';
import { ClockIcon } from './icons/ClockIcon';
import { CalendarDaysIcon } from './icons/CalendarDaysIcon';
import { ChevronDownIcon } from './icons/ChevronDownIcon';
import { formatDate } from './icons/formatters';
import ConfirmationModal from './ConfirmationModal';


interface ExpenseFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: Omit<Expense, 'id'> | Expense) => void;
  initialData?: Expense;
  prefilledData?: Partial<Omit<Expense, 'id'>>;
  accounts: Account[];
  isForRecurringTemplate?: boolean;
}

const toYYYYMMDD = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const getCurrentTime = () => new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

const getTodayString = () => toYYYYMMDD(new Date());

interface FormInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  id: string;
  name: string;
  label: string;
  value: string | number | readonly string[] | undefined;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  icon: React.ReactNode;
}

const FormInput = React.memo(React.forwardRef<HTMLInputElement, FormInputProps>(({ id, name, label, value, onChange, icon, ...props }, ref) => {
  return (
    <div>
      <label htmlFor={id} className="block text-base font-medium text-slate-700 mb-1">{label}</label>
      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
          {icon}
        </div>
        <input
          ref={ref}
          id={id}
          name={name}
          value={value || ''}
          onChange={onChange}
          className="block w-full rounded-md border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-base"
          {...props}
        />
      </div>
    </div>
  );
}));
FormInput.displayName = 'FormInput';

const parseLocalYYYYMMDD = (dateString: string | null): Date | null => {
  if (!dateString) return null;
  const parts = dateString.split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]); // locale 00:00
};

// FIX: Changed type to be more specific to fix type inference issues.
const recurrenceLabels: Record<'daily' | 'weekly' | 'monthly' | 'yearly', string> = {
  daily: 'Giornaliera',
  weekly: 'Settimanale',
  monthly: 'Mensile',
  yearly: 'Annuale',
};
const daysOfWeekLabels = { 0: 'Dom', 1: 'Lun', 2: 'Mar', 3: 'Mer', 4: 'Gio', 5: 'Ven', 6: 'Sab' };
const dayOfWeekNames = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
const ordinalSuffixes = ['primo', 'secondo', 'terzo', 'quarto', 'ultimo'];

const formatShortDate = (dateString: string | undefined): string => {
    if (!dateString) return '';
    const date = parseLocalYYYYMMDD(dateString);
    if (!date) return '';
    return new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' }).format(date);
};

const getRecurrenceSummary = (expense: Partial<Expense>): string => {
    if (expense.frequency !== 'recurring' || !expense.recurrence) {
        return 'Imposta ricorrenza';
    }
    const { recurrence, recurrenceInterval = 1, recurrenceDays, monthlyRecurrenceType, date: dateString, recurrenceEndType = 'forever', recurrenceEndDate, recurrenceCount } = expense;
    let summary = '';
    if (recurrenceInterval === 1) { summary = recurrenceLabels[recurrence]; } 
    else {
        switch (recurrence) {
            case 'daily': summary = `Ogni ${recurrenceInterval} giorni`; break;
            case 'weekly': summary = `Ogni ${recurrenceInterval} sett.`; break;
            case 'monthly': summary = `Ogni ${recurrenceInterval} mesi`; break;
            case 'yearly': summary = `Ogni ${recurrenceInterval} anni`; break;
        }
    }
    if (recurrence === 'weekly' && recurrenceDays && recurrenceDays.length > 0) {
        const orderedDays = [...recurrenceDays].sort((a, b) => (a === 0 ? 7 : a) - (b === 0 ? 7 : b));
        const dayLabels = orderedDays.map(d => daysOfWeekLabels[d as keyof typeof daysOfWeekLabels]);
        summary += `: ${dayLabels.join(', ')}`;
    }
    if (recurrence === 'monthly' && monthlyRecurrenceType === 'dayOfWeek' && dateString) {
        const date = parseLocalYYYYMMDD(dateString);
        if (date) {
            const dayOfMonth = date.getDate(); const dayOfWeek = date.getDay();
            const weekOfMonth = Math.floor((dayOfMonth - 1) / 7);
            const dayName = dayOfWeekNames[dayOfWeek].substring(0, 3);
            const ordinal = ordinalSuffixes[weekOfMonth];
            summary += ` (${ordinal} ${dayName}.)`;
        }
    }
    if (recurrenceEndType === 'date' && recurrenceEndDate) { summary += `, fino al ${formatShortDate(recurrenceEndDate)}`; } 
    else if (recurrenceEndType === 'count' && recurrenceCount && recurrenceCount > 0) { summary += `, ${recurrenceCount} volte`; }
    return summary;
};

const getIntervalLabel = (recurrence?: 'daily' | 'weekly' | 'monthly' | 'yearly', interval?: number) => {
    const count = interval || 1;
    switch (recurrence) {
        case 'daily': return count === 1 ? 'giorno' : 'giorni';
        case 'weekly': return count === 1 ? 'settimana' : 'settimane';
        case 'monthly': return count === 1 ? 'mese' : 'mesi';
        case 'yearly': return count === 1 ? 'anno' : 'anni';
        default: return 'mese';
    }
};

const daysOfWeekForPicker = [ { label: 'Lun', value: 1 }, { label: 'Mar', value: 2 }, { label: 'Mer', value: 3 }, { label: 'Gio', value: 4 }, { label: 'Ven', value: 5 }, { label: 'Sab', value: 6 }, { label: 'Dom', value: 0 }];

const ExpenseForm: React.FC<ExpenseFormProps> = ({ isOpen, onClose, onSubmit, initialData, prefilledData, accounts, isForRecurringTemplate = false }) => {
  const [isAnimating, setIsAnimating] = useState(false);
  const [isClosableByBackdrop, setIsClosableByBackdrop] = useState(false);
  const [formData, setFormData] = useState<Partial<Omit<Expense, 'id' | 'amount'>> & { amount?: number | string }>({});
  const [error, setError] = useState<string | null>(null);
  
  const [activeMenu, setActiveMenu] = useState<'category' | 'subcategory' | 'account' | 'frequency' | null>(null);

  const [originalExpenseState, setOriginalExpenseState] = useState<Partial<Expense> | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [isConfirmCloseOpen, setIsConfirmCloseOpen] = useState(false);
  
  // Recurrence Modal State
  const [isRecurrenceModalOpen, setIsRecurrenceModalOpen] = useState(false);
  const [isRecurrenceModalAnimating, setIsRecurrenceModalAnimating] = useState(false);
  const [isRecurrenceOptionsOpen, setIsRecurrenceOptionsOpen] = useState(false);
  const [isRecurrenceEndOptionsOpen, setIsRecurrenceEndOptionsOpen] = useState(false);
  const [tempRecurrence, setTempRecurrence] = useState(formData.recurrence);
  const [tempRecurrenceInterval, setTempRecurrenceInterval] = useState<number | undefined>(formData.recurrenceInterval);
  const [tempRecurrenceDays, setTempRecurrenceDays] = useState<number[] | undefined>(formData.recurrenceDays);
  const [tempMonthlyRecurrenceType, setTempMonthlyRecurrenceType] = useState(formData.monthlyRecurrenceType);

  const amountInputRef = useRef<HTMLInputElement>(null);
  const descriptionInputRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  const isEditing = !!initialData;
  const isSingleRecurring = formData.frequency === 'recurring' && formData.recurrenceEndType === 'count' && formData.recurrenceCount === 1;
  
  const dynamicMonthlyDayOfWeekLabel = useMemo(() => {
    const dateString = formData.date;
    if (!dateString) return "Seleziona una data di inizio valida";
    const date = parseLocalYYYYMMDD(dateString);
    if (!date) return "Data non valida";
    const dayOfMonth = date.getDate(); const dayOfWeek = date.getDay();
    const weekOfMonth = Math.floor((dayOfMonth - 1) / 7);
    return `Ogni ${ordinalSuffixes[weekOfMonth]} ${dayOfWeekNames[dayOfWeek]} del mese`;
  }, [formData.date]);

  const resetForm = useCallback(() => {
    const defaultAccountId = accounts.length > 0 ? accounts[0].id : '';
    setFormData({
      description: '',
      amount: '',
      date: getTodayString(),
      time: getCurrentTime(),
      category: '',
      subcategory: '',
      accountId: defaultAccountId,
      frequency: 'single',
    });
    setError(null);
    setOriginalExpenseState(null);
  }, [accounts]);
  
  const forceClose = () => {
    setIsAnimating(false);
    setTimeout(onClose, 300);
  };
  
  const handleClose = () => {
    if (isEditing && hasChanges) {
        setIsConfirmCloseOpen(true);
    } else {
        forceClose();
    }
  };
  
  const handleBackdropClick = () => {
    if (isClosableByBackdrop) {
      handleClose();
    }
  };

  useEffect(() => {
    if (isOpen) {
      if (initialData) {
        const dataWithTime = {
            ...initialData,
            time: initialData.time || getCurrentTime(),
            frequency: isForRecurringTemplate ? 'recurring' : (initialData.frequency || 'single')
        };
        setFormData(dataWithTime);
        setOriginalExpenseState(dataWithTime);
      } else if (prefilledData) {
        const defaultAccountId = accounts.length > 0 ? accounts[0].id : '';
        setFormData({
          description: prefilledData.description || '',
          amount: prefilledData.amount || '',
          date: prefilledData.date || getTodayString(),
          time: prefilledData.time || getCurrentTime(),
          category: prefilledData.category || '',
          subcategory: prefilledData.subcategory || '',
          accountId: prefilledData.accountId || defaultAccountId,
          frequency: 'single',
        });
        setOriginalExpenseState(null);
      } else {
        resetForm();
      }
      setHasChanges(false);
      
      const animTimer = setTimeout(() => {
        setIsAnimating(true);
        titleRef.current?.focus();
      }, 50);
      
      const closableTimer = setTimeout(() => {
        setIsClosableByBackdrop(true);
      }, 300);
      
      return () => {
        clearTimeout(animTimer);
        clearTimeout(closableTimer);
        setIsClosableByBackdrop(false);
      };
    } else {
      setIsAnimating(false);
      setIsClosableByBackdrop(false);
    }
  }, [isOpen, initialData, prefilledData, resetForm, accounts, isForRecurringTemplate]);
  
    useEffect(() => {
    if (isRecurrenceModalOpen) {
      setTempRecurrence(formData.recurrence || 'monthly');
      setTempRecurrenceInterval(formData.recurrenceInterval || 1);
      setTempRecurrenceDays(formData.recurrenceDays || []);
      setTempMonthlyRecurrenceType(formData.monthlyRecurrenceType || 'dayOfMonth');
      setIsRecurrenceOptionsOpen(false);
      const timer = setTimeout(() => setIsRecurrenceModalAnimating(true), 10);
      return () => clearTimeout(timer);
    } else {
      setIsRecurrenceModalAnimating(false);
    }
  }, [isRecurrenceModalOpen, formData.recurrence, formData.recurrenceInterval, formData.recurrenceDays, formData.monthlyRecurrenceType]);

  useEffect(() => {
    if (!isEditing || !originalExpenseState) {
        setHasChanges(false);
        return;
    }

    const currentAmount = parseFloat(String(formData.amount || '0').replace(',', '.'));
    const originalAmount = originalExpenseState.amount || 0;
    const amountChanged = Math.abs(currentAmount - originalAmount) > 0.001;
    const descriptionChanged = (formData.description || '') !== (originalExpenseState.description || '');
    const dateChanged = formData.date !== originalExpenseState.date;
    const timeChanged = !isForRecurringTemplate && ((formData.time || '') !== (originalExpenseState.time || ''));
    const categoryChanged = (formData.category || '') !== (originalExpenseState.category || '');
    const subcategoryChanged = (formData.subcategory || '') !== (originalExpenseState.subcategory || '');
    const accountIdChanged = formData.accountId !== originalExpenseState.accountId;
    const frequencyChanged = formData.frequency !== originalExpenseState.frequency;
    
    const recurrenceChanged = formData.recurrence !== originalExpenseState.recurrence ||
                              formData.recurrenceInterval !== originalExpenseState.recurrenceInterval ||
                              JSON.stringify(formData.recurrenceDays) !== JSON.stringify(originalExpenseState.recurrenceDays) ||
                              formData.monthlyRecurrenceType !== originalExpenseState.monthlyRecurrenceType ||
                              formData.recurrenceEndType !== originalExpenseState.recurrenceEndType ||
                              formData.recurrenceEndDate !== originalExpenseState.recurrenceEndDate ||
                              formData.recurrenceCount !== originalExpenseState.recurrenceCount;

    const changed = amountChanged || descriptionChanged || dateChanged || timeChanged || categoryChanged || subcategoryChanged || accountIdChanged || frequencyChanged || recurrenceChanged;
    
    setHasChanges(changed);

  }, [formData, originalExpenseState, isEditing, isForRecurringTemplate]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === 'recurrenceEndDate' && value === '') {
        setFormData(prev => ({...prev, recurrenceEndType: 'forever', recurrenceEndDate: undefined }));
        return;
    }
    if (name === 'recurrenceCount') {
      const num = parseInt(value, 10);
      setFormData(prev => ({...prev, [name]: isNaN(num) || num <= 0 ? undefined : num }));
    } else {
      setFormData(prev => ({ ...prev, [name]: value }));
    }
  }, []);
  
  const handleSelectChange = (field: keyof Omit<Expense, 'id'>, value: string) => {
    setFormData(currentData => {
      const newData = { ...currentData, [field]: value };
      if (field === 'category') {
        newData.subcategory = '';
      }
      return newData;
    });
    setActiveMenu(null);
  };

  const handleFrequencyOptionSelect = (value: 'none' | 'single' | 'recurring') => {
      const updates: Partial<Omit<Expense, 'id'>> = {};
      if (value === 'none') {
          updates.frequency = 'single';
          updates.recurrence = undefined;
          updates.recurrenceInterval = undefined;
          updates.recurrenceDays = undefined;
          updates.recurrenceEndType = undefined;
          updates.recurrenceEndDate = undefined;
          updates.recurrenceCount = undefined;
          updates.monthlyRecurrenceType = undefined;
      } else if (value === 'single') {
          updates.frequency = 'recurring';
          updates.recurrence = undefined;
          updates.recurrenceInterval = undefined;
          updates.recurrenceDays = undefined;
          updates.monthlyRecurrenceType = undefined;
          updates.recurrenceEndType = 'count';
          updates.recurrenceCount = 1;
          updates.recurrenceEndDate = undefined;
      } else { // recurring
          updates.frequency = 'recurring';
          updates.recurrence = formData.recurrence || 'monthly';
          updates.recurrenceEndType = 'forever';
          updates.recurrenceCount = undefined;
          updates.recurrenceEndDate = undefined;
      }
      setFormData(prev => ({ ...prev, ...updates }));
      setActiveMenu(null);
  };
  
    const handleCloseRecurrenceModal = () => {
        setIsRecurrenceModalAnimating(false);
        setIsRecurrenceModalOpen(false);
    };

    const handleApplyRecurrence = () => {
        setFormData(prev => ({
            ...prev,
            recurrence: tempRecurrence as any,
            recurrenceInterval: tempRecurrenceInterval || 1,
            recurrenceDays: tempRecurrence === 'weekly' ? tempRecurrenceDays : undefined,
            monthlyRecurrenceType: tempRecurrence === 'monthly' ? tempMonthlyRecurrenceType : undefined,
        }));
        handleCloseRecurrenceModal();
    };

    const handleRecurrenceEndTypeSelect = (type: 'forever' | 'date' | 'count') => {
        const updates: Partial<Expense> = { recurrenceEndType: type };
        if (type === 'forever') {
            updates.recurrenceEndDate = undefined;
            updates.recurrenceCount = undefined;
        } else if (type === 'date') {
            updates.recurrenceEndDate = formData.recurrenceEndDate || toYYYYMMDD(new Date());
            updates.recurrenceCount = undefined;
        } else if (type === 'count') {
            updates.recurrenceEndDate = undefined;
            updates.recurrenceCount = formData.recurrenceCount || 1;
        }
        setFormData(prev => ({...prev, ...updates}));
        setIsRecurrenceEndOptionsOpen(false);
    };

    const handleToggleDay = (dayValue: number) => {
        setTempRecurrenceDays(prevDays => {
            const currentDays = prevDays || [];
            const newDays = currentDays.includes(dayValue)
                ? currentDays.filter(d => d !== dayValue)
                : [...currentDays, dayValue];
            return newDays.sort((a, b) => (a === 0 ? 7 : a) - (b === 0 ? 7 : b));
        });
    };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const amountAsString = String(formData.amount).replace(',', '.').trim();
    const amountAsNumber = parseFloat(amountAsString);
    
    if (amountAsString === '' || isNaN(amountAsNumber) || amountAsNumber <= 0) {
      setError('Inserisci un importo valido.');
      return;
    }
    
    const finalDate = formData.date || getTodayString();
    
    if (!formData.accountId) {
      setError('Seleziona un conto.');
      return;
    }
    
    setError(null);

    const dataToSubmit: Partial<Expense> = {
      ...formData,
      amount: amountAsNumber,
      date: finalDate,
      time: formData.time || undefined,
      description: formData.description || '',
      category: formData.category || '',
      subcategory: formData.subcategory || undefined,
    };
    
    if (dataToSubmit.frequency === 'recurring') {
        delete dataToSubmit.time;
    }
    
    if (isEditing) {
        onSubmit({ ...initialData, ...dataToSubmit } as Expense);
    } else {
        onSubmit(dataToSubmit as Omit<Expense, 'id'>);
    }
  };

  const handleAmountEnter = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const el = e.currentTarget as HTMLInputElement;
    el.blur();
  }, []);

  if (!isOpen) return null;

  const categoryOptions = Object.keys(CATEGORIES).map(cat => {
    const style = getCategoryStyle(cat);
    return {
      value: cat,
      label: style.label,
      Icon: style.Icon,
      color: style.color,
      bgColor: style.bgColor,
    };
  });

  const subcategoryOptions = formData.category && CATEGORIES[formData.category]
    ? CATEGORIES[formData.category].map(sub => ({ value: sub, label: sub }))
    : [];
    
  const accountOptions = accounts.map(acc => ({
      value: acc.id,
      label: acc.name,
  }));

  const frequencyOptions = [
    { value: 'none', label: 'Nessuna' },
    { value: 'single', label: 'Singolo' },
    { value: 'recurring', label: 'Ricorrente' },
  ];

  const isSubcategoryDisabled = !formData.category || formData.category === 'Altro' || subcategoryOptions.length === 0;

  const SelectionButton = ({ label, value, onClick, placeholder, ariaLabel, disabled, icon }: { label: string, value?: string, onClick: () => void, placeholder: string, ariaLabel: string, disabled?: boolean, icon: React.ReactNode }) => {
    const hasValue = value && value !== placeholder && value !== '';
    return (
      <div>
        <label className={`block text-base font-medium mb-1 transition-colors ${disabled ? 'text-slate-400' : 'text-slate-700'}`}>{label}</label>
        <button
          type="button"
          onClick={onClick}
          aria-label={ariaLabel}
          disabled={disabled}
          className={`w-full flex items-center justify-center text-center gap-2 px-3 py-2.5 text-base font-semibold rounded-lg border shadow-sm focus:outline-none focus:ring-0 transition-colors ${
            disabled
              ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
              : hasValue
                ? 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100'
                : 'bg-white border-slate-300 text-slate-500 hover:bg-slate-50'
          }`}
        >
          {icon}
          <span className="truncate">
            {value || placeholder}
          </span>
        </button>
      </div>
    );
  };
  
    const getRecurrenceEndLabel = () => {
    const { recurrenceEndType } = formData;
    if (!recurrenceEndType || recurrenceEndType === 'forever') return 'Per sempre';
    if (recurrenceEndType === 'date') return 'Fino a';
    if (recurrenceEndType === 'count') return 'Numero di volte';
    return 'Per sempre';
  };

  const selectedAccountLabel = accounts.find(a => a.id === formData.accountId)?.name;
  const selectedCategoryLabel = formData.category ? getCategoryStyle(formData.category).label : undefined;
  
  return (
    <div
      className={`fixed inset-0 z-[51] transition-opacity duration-300 ease-in-out ${isAnimating ? 'opacity-100' : 'opacity-0'} bg-slate-900/60 backdrop-blur-sm`}
      onClick={handleBackdropClick}
      aria-modal="true"
      role="dialog"
    >
      <div
        className={`bg-slate-50 w-full h-full flex flex-col absolute bottom-0 transform transition-transform duration-300 ease-in-out ${isAnimating ? 'translate-y-0' : 'translate-y-full'}`}
        onClick={(e) => e.stopPropagation()}
        style={{ touchAction: 'pan-y' }}
      >
        <header className="flex justify-between items-center p-6 border-b border-slate-200 flex-shrink-0">
          <h2 ref={titleRef} tabIndex={-1} className="text-2xl font-bold text-slate-800 focus:outline-none">{isEditing ? 'Modifica Spesa' : 'Aggiungi Spesa'}</h2>
          <button
            type="button"
            onClick={handleClose}
            className="text-slate-500 hover:text-slate-800 transition-colors p-1 rounded-full hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            aria-label="Chiudi"
          >
            <XMarkIcon className="w-6 h-6" />
          </button>
        </header>
        <form onSubmit={handleSubmit} noValidate className="flex-1 flex flex-col overflow-hidden">
          <div className="p-6 space-y-4 flex-1 overflow-y-auto">
               <FormInput
                  ref={descriptionInputRef}
                  id="description"
                  name="description"
                  label="Descrizione (opzionale)"
                  value={formData.description || ''}
                  onChange={handleInputChange}
                  icon={<DocumentTextIcon className="h-5 w-5 text-slate-400" />}
                  type="text"
                  placeholder="Es. Caffè al bar"
               />

               <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                 <FormInput
                     ref={amountInputRef}
                     id="amount"
                     name="amount"
                     label="Importo"
                     value={formData.amount || ''}
                     onChange={handleInputChange}
                     onKeyDown={handleAmountEnter}
                     icon={<CurrencyEuroIcon className="h-5 w-5 text-slate-400" />}
                     type="text"
                     inputMode="decimal"
                     pattern="[0-9]*[.,]?[0-9]*"
                     placeholder="0.00"
                     required
                     autoComplete="off"
                  />
                  <div className={`grid ${formData.frequency === 'recurring' ? 'grid-cols-1' : 'grid-cols-2'} gap-2`}>
                      <div>
                          <label htmlFor="date" className="block text-base font-medium text-slate-700 mb-1">{isSingleRecurring ? 'Data del Pagamento' : formData.frequency === 'recurring' ? 'Data di Inizio' : 'Data'}</label>
                          <div className="relative">
                              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                                  <CalendarIcon className="h-5 w-5 text-slate-400" />
                              </div>
                              <input
                                  id="date"
                                  name="date"
                                  value={formData.date || ''}
                                  onChange={handleInputChange}
                                  className="block w-full rounded-md border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-base"
                                  type="date"
                              />
                          </div>
                      </div>
                      {formData.frequency !== 'recurring' && (
                        <div>
                            <label htmlFor="time" className="block text-base font-medium text-slate-700 mb-1">Ora (opz.)</label>
                            <div className="relative">
                                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                                    <ClockIcon className="h-5 w-5 text-slate-400" />
                                </div>
                                <input
                                    id="time"
                                    name="time"
                                    value={formData.time || ''}
                                    onChange={handleInputChange}
                                    className="block w-full rounded-md border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-base"
                                    type="time"
                                />
                            </div>
                        </div>
                      )}
                  </div>
               </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <SelectionButton 
                    label="Conto"
                    value={selectedAccountLabel}
                    onClick={() => setActiveMenu('account')}
                    placeholder="Seleziona"
                    ariaLabel="Seleziona conto di pagamento"
                    icon={<CreditCardIcon className="h-5 w-5" />}
                />
                <SelectionButton 
                    label="Categoria (opzionale)"
                    value={selectedCategoryLabel}
                    onClick={() => setActiveMenu('category')}
                    placeholder="Seleziona"
                    ariaLabel="Seleziona categoria"
                    icon={<TagIcon className="h-5 w-5" />}
                />
                <SelectionButton 
                    label="Sottocategoria (opzionale)"
                    value={formData.subcategory}
                    onClick={() => setActiveMenu('subcategory')}
                    placeholder="Seleziona"
                    ariaLabel="Seleziona sottocategoria"
                    disabled={isSubcategoryDisabled}
                    icon={<TagIcon className="h-5 w-5" />}
                />
              </div>
              
              {isForRecurringTemplate && (
                 <div className="bg-white p-4 rounded-lg border border-slate-200 space-y-4">
                    <div>
                        <label className="block text-base font-medium text-slate-700 mb-1">Frequenza</label>
                         <button
                            type="button"
                            onClick={() => setActiveMenu('frequency')}
                            className="w-full flex items-center justify-between text-left gap-2 px-3 py-2.5 text-base rounded-lg border shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors bg-white border-slate-300 text-slate-800 hover:bg-slate-50"
                        >
                          <span className="truncate flex-1 capitalize">
                            {isSingleRecurring ? 'Singolo' : formData.frequency !== 'recurring' ? 'Nessuna' : 'Ricorrente'}
                          </span>
                          <ChevronDownIcon className="w-5 h-5 text-slate-500" />
                        </button>
                    </div>

                    {formData.frequency === 'recurring' && !isSingleRecurring && (
                      <div className="animate-fade-in-up">
                        <label className="block text-base font-medium text-slate-700 mb-1">Ricorrenza</label>
                        <button
                          type="button"
                          onClick={() => setIsRecurrenceModalOpen(true)}
                          className="w-full flex items-center justify-between text-left gap-2 px-3 py-2.5 text-base rounded-lg border shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors bg-white border-slate-300 text-slate-800 hover:bg-slate-50"
                        >
                          <span className="truncate flex-1">
                            {/* FIX: Cast formData to Partial<Expense> to resolve type mismatch on `amount` which is not used here. */}
                            {getRecurrenceSummary(formData as Partial<Expense>)}
                          </span>
                          <ChevronDownIcon className="w-5 h-5 text-slate-500" />
                        </button>
                      </div>
                    )}
                 </div>
              )}

               {error && <p className="text-base text-red-600 bg-red-100 p-3 rounded-md">{error}</p>}
          </div>
          <footer className={`px-6 py-4 bg-slate-100 border-t border-slate-200 flex flex-shrink-0 ${isEditing && !hasChanges ? 'justify-stretch' : 'justify-end gap-3'}`}>
              {isEditing && !hasChanges ? (
                  <button
                    type="button"
                    onClick={handleClose}
                    className="w-full px-4 py-2 text-base font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg shadow-sm hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-colors"
                  >
                    Chiudi
                  </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleClose}
                    className="px-4 py-2 text-base font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg shadow-sm hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-colors"
                  >
                    Annulla
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 text-base font-semibold text-white bg-indigo-600 rounded-lg shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-colors"
                  >
                    {isEditing ? 'Salva Modifiche' : 'Aggiungi Spesa'}
                  </button>
                </>
              )}
          </footer>
        </form>
      </div>

      <SelectionMenu 
        isOpen={activeMenu === 'account'}
        onClose={() => setActiveMenu(null)}
        title="Seleziona un Conto"
        options={accountOptions}
        selectedValue={formData.accountId || ''}
        onSelect={(value) => handleSelectChange('accountId', value)}
      />

      <SelectionMenu 
        isOpen={activeMenu === 'category'}
        onClose={() => setActiveMenu(null)}
        title="Seleziona una Categoria"
        options={categoryOptions}
        selectedValue={formData.category || ''}
        onSelect={(value) => handleSelectChange('category', value)}
      />

      <SelectionMenu 
        isOpen={activeMenu === 'subcategory'}
        onClose={() => setActiveMenu(null)}
        title="Seleziona Sottocategoria"
        options={subcategoryOptions}
        selectedValue={formData.subcategory || ''}
        onSelect={(value) => handleSelectChange('subcategory', value)}
      />

      <SelectionMenu
          isOpen={activeMenu === 'frequency'}
          onClose={() => setActiveMenu(null)}
          title="Imposta Frequenza"
          options={frequencyOptions}
          selectedValue={isSingleRecurring ? 'single' : formData.frequency !== 'recurring' ? 'none' : 'recurring'}
          onSelect={handleFrequencyOptionSelect as (value: string) => void}
      />
      
      {isRecurrenceModalOpen && (
        <div className={`fixed inset-0 z-[60] flex justify-center items-center p-4 transition-opacity duration-300 ease-in-out ${isRecurrenceModalAnimating ? 'opacity-100' : 'opacity-0'} bg-slate-900/60 backdrop-blur-sm`} onClick={handleCloseRecurrenceModal} aria-modal="true" role="dialog">
          <div className={`bg-white rounded-lg shadow-xl w-full max-w-sm transform transition-all duration-300 ease-in-out ${isRecurrenceModalAnimating ? 'scale-100 opacity-100' : 'scale-95 opacity-0'}`} onClick={(e) => e.stopPropagation()}>
            <header className="flex justify-between items-center p-4 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-800">Imposta Ricorrenza</h2>
              <button type="button" onClick={handleCloseRecurrenceModal} className="text-slate-500 hover:text-slate-800 transition-colors p-1 rounded-full hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500" aria-label="Chiudi"><XMarkIcon className="w-6 h-6" /></button>
            </header>
            <main className="p-4 space-y-4">
              <div className="relative">
                <button onClick={() => { setIsRecurrenceOptionsOpen(prev => !prev); setIsRecurrenceEndOptionsOpen(false); }} className="w-full flex items-center justify-between text-left gap-2 px-3 py-2.5 text-base rounded-lg border shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors bg-white border-slate-300 text-slate-800 hover:bg-slate-50">
                  <span className="truncate flex-1 capitalize">{recurrenceLabels[tempRecurrence as keyof typeof recurrenceLabels] || 'Seleziona'}</span>
                  <ChevronDownIcon className={`w-5 h-5 text-slate-500 transition-transform ${isRecurrenceOptionsOpen ? 'rotate-180' : ''}`} />
                </button>
                {isRecurrenceOptionsOpen && (
                  <div className="absolute top-full mt-1 w-full bg-white border border-slate-200 shadow-lg rounded-lg z-20 p-2 space-y-1 animate-fade-in-down">
                    {(Object.keys(recurrenceLabels) as Array<keyof typeof recurrenceLabels>).map((key) => (<button key={key} onClick={() => { setTempRecurrence(key); setIsRecurrenceOptionsOpen(false); }} className="w-full text-left px-4 py-3 text-base font-semibold rounded-lg transition-colors bg-slate-50 text-slate-800 hover:bg-indigo-100 hover:text-indigo-800">{recurrenceLabels[key]}</button>))}
                  </div>
                )}
              </div>
              <div className="animate-fade-in-up pt-2" style={{animationDuration: '200ms'}}>
                <div className="flex items-center justify-center gap-2 bg-slate-100 p-3 rounded-lg">
                  <span className="text-base text-slate-700">Ogni</span>
                  <input type="number" value={tempRecurrenceInterval || ''} onChange={(e) => { const val = e.target.value; if (val === '') { setTempRecurrenceInterval(undefined); } else { const num = parseInt(val, 10); if (!isNaN(num) && num > 0) { setTempRecurrenceInterval(num); } } }} onFocus={(e) => e.currentTarget.select()} className="w-12 text-center text-lg font-bold text-slate-800 bg-transparent border-0 border-b-2 border-slate-400 focus:ring-0 focus:outline-none focus:border-indigo-600 p-0" min="1" />
                  <span className="text-base text-slate-700">{getIntervalLabel(tempRecurrence as any, tempRecurrenceInterval)}</span>
                </div>
              </div>
              {tempRecurrence === 'weekly' && (<div className="animate-fade-in-up pt-2"><div className="flex flex-wrap justify-center gap-2">{daysOfWeekForPicker.map(day => (<button key={day.value} onClick={() => handleToggleDay(day.value)} className={`w-14 h-14 rounded-full text-sm font-semibold transition-colors focus:outline-none border-2 ${(tempRecurrenceDays || []).includes(day.value) ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-800 border-indigo-400 hover:bg-indigo-50'}`}>{day.label}</button>))}</div></div>)}
              {tempRecurrence === 'monthly' && (<div className="animate-fade-in-up pt-4 space-y-2 border-t border-slate-200"><div role="radio" aria-checked={tempMonthlyRecurrenceType === 'dayOfMonth'} onClick={() => setTempMonthlyRecurrenceType('dayOfMonth')} className="flex items-center gap-3 p-2 cursor-pointer rounded-lg hover:bg-slate-100"><div className="w-5 h-5 rounded-full border-2 border-slate-400 flex items-center justify-center flex-shrink-0">{tempMonthlyRecurrenceType === 'dayOfMonth' && <div className="w-2.5 h-2.5 bg-indigo-600 rounded-full" />}</div><label className="text-sm font-medium text-slate-700 cursor-pointer">Lo stesso giorno di ogni mese</label></div><div role="radio" aria-checked={tempMonthlyRecurrenceType === 'dayOfWeek'} onClick={() => setTempMonthlyRecurrenceType('dayOfWeek')} className="flex items-center gap-3 p-2 cursor-pointer rounded-lg hover:bg-slate-100"><div className="w-5 h-5 rounded-full border-2 border-slate-400 flex items-center justify-center flex-shrink-0">{tempMonthlyRecurrenceType === 'dayOfWeek' && <div className="w-2.5 h-2.5 bg-indigo-600 rounded-full" />}</div><label className="text-sm font-medium text-slate-700 cursor-pointer">{dynamicMonthlyDayOfWeekLabel}</label></div></div>)}
              <div className="pt-4 border-t border-slate-200">
                <div className="grid grid-cols-2 gap-4 items-end">
                  <div className={`relative ${!formData.recurrenceEndType || formData.recurrenceEndType === 'forever' ? 'col-span-2' : ''}`}>
                    <button type="button" onClick={() => { setIsRecurrenceEndOptionsOpen(prev => !prev); setIsRecurrenceOptionsOpen(false); }} className="w-full flex items-center justify-between text-left gap-2 px-3 py-2.5 text-base rounded-lg border shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors bg-white border-slate-300 text-slate-800 hover:bg-slate-50">
                        <span className="truncate flex-1 capitalize">{getRecurrenceEndLabel()}</span>
                        <ChevronDownIcon className={`w-5 h-5 text-slate-500 transition-transform ${isRecurrenceEndOptionsOpen ? 'rotate-180' : ''}`} />
                    </button>
                     {isRecurrenceEndOptionsOpen && (<div className="absolute top-full mt-1 w-full bg-white border border-slate-200 shadow-lg rounded-lg z-10 p-2 space-y-1 animate-fade-in-down">{(['forever', 'date', 'count'] as const).map(key => (<button key={key} onClick={() => handleRecurrenceEndTypeSelect(key)} className="w-full text-left px-4 py-3 text-base font-semibold rounded-lg transition-colors bg-slate-50 text-slate-800 hover:bg-indigo-100 hover:text-indigo-800">{key === 'forever' ? 'Per sempre' : key === 'date' ? 'Fino a' : 'Numero di volte'}</button>))}</div>)}
                  </div>
                  {formData.recurrenceEndType === 'date' && (<div className="animate-fade-in-up"><label htmlFor="recurrence-end-date" className="relative w-full flex items-center justify-center gap-2 px-3 py-2.5 text-base rounded-lg focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-indigo-500 text-indigo-600 hover:bg-indigo-100 font-semibold cursor-pointer h-[46.5px]"><CalendarIcon className="w-5 h-5"/><span>{formData.recurrenceEndDate ? formatDate(parseLocalYYYYMMDD(formData.recurrenceEndDate)!) : 'Seleziona'}</span><input type="date" id="recurrence-end-date" name="recurrenceEndDate" value={formData.recurrenceEndDate || ''} onChange={(e) => setFormData(prev => ({...prev, recurrenceEndDate: e.target.value, recurrenceEndType: 'date' }))} className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"/></label></div>)}
                  {formData.recurrenceEndType === 'count' && (<div className="animate-fade-in-up"><div className="relative"><input type="number" id="recurrence-count" name="recurrenceCount" value={formData.recurrenceCount || ''} onChange={handleInputChange} className="block w-full text-center rounded-md border border-slate-300 bg-white py-2.5 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-base" placeholder="N." min="1"/></div></div>)}
                </div>
              </div>
            </main>
            <footer className="p-4 bg-slate-100 border-t border-slate-200 flex justify-end"><button type="button" onClick={handleApplyRecurrence} className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-colors">Applica</button></footer>
          </div>
        </div>
      )}
      
      <ConfirmationModal
        isOpen={isConfirmCloseOpen}
        onClose={() => setIsConfirmCloseOpen(false)}
        onConfirm={() => {
            setIsConfirmCloseOpen(false);
            forceClose();
        }}
        title="Annullare le modifiche?"
        message="Sei sicuro di voler chiudere senza salvare? Le modifiche andranno perse."
        variant="danger"
        confirmButtonText="Sì, annulla"
        cancelButtonText="No, continua"
      />
    </div>
  );
};

export default ExpenseForm;