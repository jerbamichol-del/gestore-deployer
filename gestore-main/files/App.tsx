import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Expense, Account } from './types';
import { useLocalStorage } from './hooks/useLocalStorage';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { getQueuedImages, deleteImageFromQueue, OfflineImage, addImageToQueue } from './utils/db';
import { parseExpensesFromImage } from './utils/ai';
import { DEFAULT_ACCOUNTS } from './utils/defaults';

import Header from './components/Header';
import Dashboard from './components/Dashboard';
import ExpenseForm from './components/ExpenseForm';
import FloatingActionButton from './components/FloatingActionButton';
import VoiceInputModal from './components/VoiceInputModal';
import ConfirmationModal from './components/ConfirmationModal';
import MultipleExpensesModal from './components/MultipleExpensesModal';
import PendingImages from './components/PendingImages';
import Toast from './components/Toast';
import HistoryScreen from './screens/HistoryScreen';
import RecurringExpensesScreen from './screens/RecurringExpensesScreen';
import ImageSourceCard from './components/ImageSourceCard';
import { CameraIcon } from './components/icons/CameraIcon';
import { ComputerDesktopIcon } from './components/icons/ComputerDesktopIcon';
import { XMarkIcon } from './components/icons/XMarkIcon';
import { SpinnerIcon } from './components/icons/SpinnerIcon';
import CalculatorContainer from './components/CalculatorContainer';
import SuccessIndicator from './components/SuccessIndicator';
import { PEEK_PX } from './components/HistoryFilterCard';

type ToastMessage = { message: string; type: 'success' | 'info' | 'error' };

// ================== Helper date / base64 locali ==================
const toISODate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseISODate = (value: string | null | undefined): Date | null => {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
};

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Impossibile leggere il file.'));
        return;
      }
      // result è tipo "data:image/jpeg;base64,AAAA..."
      const commaIndex = result.indexOf(',');
      const base64 = commaIndex >= 0 ? result.slice(commaIndex + 1) : result;
      resolve(base64);
    };
    reader.onerror = () => {
      reject(reader.error || new Error('Errore durante la lettura del file.'));
    };
    reader.readAsDataURL(file);
  });
};

// ================== Picker immagine ==================
const pickImage = (source: 'camera' | 'gallery'): Promise<File> => {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';

    if (source === 'camera') {
      (input as any).capture = 'environment';
    }

    const handleOnChange = (event: Event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      cleanup();
      if (file) {
        resolve(file);
      } else {
        reject(new Error('Nessun file selezionato.'));
      }
    };

    const handleCancel = () => {
      setTimeout(() => {
        if (document.body.contains(input)) {
          cleanup();
          reject(new Error('Selezione immagine annullata.'));
        }
      }, 300);
    };

    const cleanup = () => {
      input.removeEventListener('change', handleOnChange);
      window.removeEventListener('focus', handleCancel);
      if (document.body.contains(input)) {
        document.body.removeChild(input);
      }
    };

    input.addEventListener('change', handleOnChange);
    window.addEventListener('focus', handleCancel, { once: true });

    input.style.display = 'none';
    document.body.appendChild(input);
    input.click();
  });
};

const calculateNextDueDate = (template: Expense, fromDate: Date): Date | null => {
  if (template.frequency !== 'recurring' || !template.recurrence) return null;
  const interval = template.recurrenceInterval || 1;
  const nextDate = new Date(fromDate);

  switch (template.recurrence) {
    case 'daily':
      nextDate.setDate(nextDate.getDate() + interval);
      break;
    case 'weekly':
      nextDate.setDate(nextDate.getDate() + 7 * interval);
      break;
    case 'monthly':
      nextDate.setMonth(nextDate.getMonth() + interval);
      break;
    case 'yearly':
      nextDate.setFullYear(nextDate.getFullYear() + interval);
      break;
    default:
      return null;
  }
  return nextDate;
};

const App: React.FC<{ onLogout: () => void }> = ({ onLogout }) => {
  const [expenses, setExpenses] = useLocalStorage<Expense[]>('expenses_v2', []);
  const [recurringExpenses, setRecurringExpenses] = useLocalStorage<Expense[]>('recurring_expenses_v1', []);
  const [accounts, setAccounts] = useLocalStorage<Account[]>('accounts_v1', DEFAULT_ACCOUNTS);

  // ================== Migrazione dati localStorage (vecchie chiavi) ==================
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const migrate = (targetKey: string, legacyKeys: string[], setter: (val: any) => void, currentValue: any[]) => {
      if (!currentValue || currentValue.length === 0) {
        for (const key of legacyKeys) {
          const raw = window.localStorage.getItem(key);
          if (!raw) continue;
          try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0) {
              console.log(`[MIGRAZIONE] Trovati dati su ${key} → migrazione in ${targetKey}`);
              setter(parsed);
              break;
            }
          } catch (e) {
            console.warn(`[MIGRAZIONE] Errore leggendo ${key}`, e);
          }
        }
      }
    };

    migrate('expenses_v2', ['expenses_v1', 'expenses', 'spese', 'spese_v1'], setExpenses, expenses);
    migrate('accounts_v1', ['accounts', 'conti'], setAccounts, accounts === DEFAULT_ACCOUNTS ? [] : accounts);
    migrate(
      'recurring_expenses_v1',
      ['recurring_expenses', 'ricorrenti', 'recurring'],
      setRecurringExpenses,
      recurringExpenses
    );
  }, []); // Run once on mount

  // Modal States
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isCalculatorContainerOpen, setIsCalculatorContainerOpen] = useState(false);
  const [isImageSourceModalOpen, setIsImageSourceModalOpen] = useState(false);
  const [isVoiceModalOpen, setIsVoiceModalOpen] = useState(false);
  const [isConfirmDeleteModalOpen, setIsConfirmDeleteModalOpen] = useState(false);
  const [isMultipleExpensesModalOpen, setIsMultipleExpensesModalOpen] = useState(false);
  const [isParsingImage, setIsParsingImage] = useState(false);
  const [isDateModalOpen, setIsDateModalOpen] = useState(false);
  const [isRecurringScreenOpen, setIsRecurringScreenOpen] = useState(false);
  const [isHistoryScreenOpen, setIsHistoryScreenOpen] = useState(false);
  const [isHistoryFilterPanelOpen, setIsHistoryFilterPanelOpen] = useState(false);

  // Data for Modals
  const [editingExpense, setEditingExpense] = useState<Expense | undefined>(undefined);
  const [editingRecurringExpense, setEditingRecurringExpense] = useState<Expense | undefined>(undefined);
  const [prefilledData, setPrefilledData] = useState<Partial<Omit<Expense, 'id'>> | undefined>(undefined);
  const [expenseToDeleteId, setExpenseToDeleteId] = useState<string | null>(null);
  const [multipleExpensesData, setMultipleExpensesData] = useState<Partial<Omit<Expense, 'id'>>[]>([]);
  const [imageForAnalysis, setImageForAnalysis] = useState<OfflineImage | null>(null);

  // Offline & Sync States
  const isOnline = useOnlineStatus();
  const [pendingImages, setPendingImages] = useState<OfflineImage[]>([]);
  const [syncingImageId, setSyncingImageId] = useState<string | null>(null);
  const prevIsOnlineRef = useRef<boolean | undefined>(undefined);

  // UI State
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const pendingImagesCountRef = useRef(0);
  const [installPromptEvent, setInstallPromptEvent] = useState<any>(null);
  const backPressExitTimeoutRef = useRef<number | null>(null);
  const [showSuccessIndicator, setShowSuccessIndicator] = useState(false);
  const successIndicatorTimerRef = useRef<number | null>(null);

  // ================== Generazione spese programmate ==================
  useEffect(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const newExpenses: Expense[] = [];
    const templatesToUpdate: Expense[] = [];

    recurringExpenses.forEach(template => {
      if (!template.date) return;

      const cursorDateString = template.lastGeneratedDate || template.date;
      let cursor = parseISODate(cursorDateString);
      if (!cursor) return;

      let updatedTemplate = { ...template };

      let nextDue = !template.lastGeneratedDate
        ? parseISODate(template.date)
        : calculateNextDueDate(template, cursor);

      while (nextDue && nextDue <= today) {
        const totalGenerated =
          expenses.filter(e => e.recurringExpenseId === template.id).length +
          newExpenses.filter(e => e.recurringExpenseId === template.id).length;

        if (
          template.recurrenceEndType === 'date' &&
          template.recurrenceEndDate &&
          toISODate(nextDue) > template.recurrenceEndDate
        ) {
          break;
        }

        if (
          template.recurrenceEndType === 'count' &&
          template.recurrenceCount &&
          totalGenerated >= template.recurrenceCount
        ) {
          break;
        }

        const nextDueDateString = toISODate(nextDue);
        const instanceExists =
          expenses.some(
            exp => exp.recurringExpenseId === template.id && exp.date === nextDueDateString
          ) ||
          newExpenses.some(
            exp => exp.recurringExpenseId === template.id && exp.date === nextDueDateString
          );

        if (!instanceExists) {
          newExpenses.push({
            ...template,
            id: crypto.randomUUID(),
            date: nextDueDateString,
            frequency: 'single',
            recurringExpenseId: template.id,
            lastGeneratedDate: undefined,
          });
        }

        cursor = nextDue;
        updatedTemplate.lastGeneratedDate = toISODate(cursor);
        nextDue = calculateNextDueDate(template, cursor);
      }

      if (
        updatedTemplate.lastGeneratedDate &&
        updatedTemplate.lastGeneratedDate !== template.lastGeneratedDate
      ) {
        templatesToUpdate.push(updatedTemplate);
      }
    });

    if (newExpenses.length > 0) {
      setExpenses(prev => [...newExpenses, ...prev]);
    }
    if (templatesToUpdate.length > 0) {
      setRecurringExpenses(prev =>
        prev.map(t => templatesToUpdate.find(ut => ut.id === t.id) || t)
      );
    }
  }, [recurringExpenses, expenses, setExpenses, setRecurringExpenses]);

  // ================== Success indicator ==================
  const triggerSuccessIndicator = useCallback(() => {
    if (successIndicatorTimerRef.current) {
      clearTimeout(successIndicatorTimerRef.current);
    }
    setShowSuccessIndicator(true);
    successIndicatorTimerRef.current = window.setTimeout(() => {
      setShowSuccessIndicator(false);
      successIndicatorTimerRef.current = null;
    }, 2000);
  }, []);

  const showToast = useCallback((toastMessage: ToastMessage) => {
    setToast(toastMessage);
  }, []);

  // Back / popstate
  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      event.preventDefault();
      const pushStateAfterHandling = () => window.history.pushState({ view: 'home' }, '');

      if (isHistoryScreenOpen) {
        setIsHistoryScreenOpen(false);
        pushStateAfterHandling();
        return;
      }
      if (isRecurringScreenOpen) {
        setIsRecurringScreenOpen(false);
        pushStateAfterHandling();
        return;
      }
      if (!!imageForAnalysis) {
        setImageForAnalysis(null);
        pushStateAfterHandling();
        return;
      }
      if (isCalculatorContainerOpen) {
        setIsCalculatorContainerOpen(false);
        pushStateAfterHandling();
        return;
      }
      if (isFormOpen) {
        setIsFormOpen(false);
        pushStateAfterHandling();
        return;
      }
      if (isImageSourceModalOpen) {
        setIsImageSourceModalOpen(false);
        pushStateAfterHandling();
        return;
      }
      if (isVoiceModalOpen) {
        setIsVoiceModalOpen(false);
        pushStateAfterHandling();
        return;
      }
      if (isConfirmDeleteModalOpen) {
        setIsConfirmDeleteModalOpen(false);
        setExpenseToDeleteId(null);
        pushStateAfterHandling();
        return;
      }
      if (isMultipleExpensesModalOpen) {
        setIsMultipleExpensesModalOpen(false);
        pushStateAfterHandling();
        return;
      }
      if (backPressExitTimeoutRef.current) {
        clearTimeout(backPressExitTimeoutRef.current);
        backPressExitTimeoutRef.current = null;
        try {
          window.close();
        } catch (e) {
          console.log('Window close prevented', e);
        }
      } else {
        showToast({ message: 'Premi di nuovo per uscire.', type: 'info' });
        backPressExitTimeoutRef.current = window.setTimeout(() => {
          backPressExitTimeoutRef.current = null;
        }, 2000);
        pushStateAfterHandling();
      }
    };

    window.history.pushState({ view: 'home' }, '');
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      if (backPressExitTimeoutRef.current) clearTimeout(backPressExitTimeoutRef.current);
    };
  }, [
    showToast,
    isCalculatorContainerOpen,
    isFormOpen,
    isImageSourceModalOpen,
    isVoiceModalOpen,
    isConfirmDeleteModalOpen,
    isMultipleExpensesModalOpen,
    imageForAnalysis,
    isRecurringScreenOpen,
    isHistoryScreenOpen,
  ]);

  // ================== Install PWA ==================
  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPromptEvent(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!installPromptEvent) return;
    installPromptEvent.prompt();
    const { outcome } = await installPromptEvent.userChoice;
    setInstallPromptEvent(null);
    if (outcome === 'accepted') {
      showToast({ message: 'App installata!', type: 'success' });
    } else {
      showToast({ message: 'Installazione annullata.', type: 'info' });
    }
  };

  // ================== Pending images (offline queue) ==================
  const refreshPendingImages = useCallback(() => {
    getQueuedImages().then(images => {
      setPendingImages(images);
      if (images.length > pendingImagesCountRef.current) {
        showToast({ message: "Immagine salvata! Pronta per l'analisi.", type: 'info' });
      }
      pendingImagesCountRef.current = images.length;
    });
  }, [showToast]);

  useEffect(() => {
    refreshPendingImages();
    const handleStorageChange = () => {
      refreshPendingImages();
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [refreshPendingImages]);

  useEffect(() => {
    if (prevIsOnlineRef.current === false && isOnline && pendingImages.length > 0) {
      showToast({ message: `Sei online! ${pendingImages.length} immagini in attesa.`, type: 'info' });
    }
    prevIsOnlineRef.current = isOnline;
  }, [isOnline, pendingImages.length, showToast]);

  // ================== CRUD Spese ==================
  const addExpense = (newExpense: Omit<Expense, 'id'>) => {
    const expenseWithId: Expense = { ...newExpense, id: crypto.randomUUID() };
    setExpenses(prev => [expenseWithId, ...prev]);
    triggerSuccessIndicator();
  };

  const addRecurringExpense = (newExpenseData: Omit<Expense, 'id'>) => {
    const newTemplate: Expense = { ...newExpenseData, id: crypto.randomUUID() };
    setRecurringExpenses(prev => [newTemplate, ...prev]);
    triggerSuccessIndicator();
  };

  const updateExpense = (updatedExpense: Expense) => {
    setExpenses(prev => prev.map(e => (e.id === updatedExpense.id ? updatedExpense : e)));
    triggerSuccessIndicator();
  };

  const updateRecurringExpense = (updatedTemplate: Expense) => {
    setRecurringExpenses(prev => prev.map(e => (e.id === updatedTemplate.id ? updatedTemplate : e)));
    triggerSuccessIndicator();
  };

  const handleFormSubmit = (data: Omit<Expense, 'id'> | Expense) => {
    if (
      editingRecurringExpense &&
      'id' in data &&
      data.id === editingRecurringExpense.id &&
      data.frequency !== 'recurring'
    ) {
      // convertita da programmata a singola
      setRecurringExpenses(prev => prev.filter(e => e.id !== editingRecurringExpense.id));

      const newSingleExpenseData: Omit<Expense, 'id'> = {
        ...data,
        frequency: 'single',
        recurrence: undefined,
        monthlyRecurrenceType: undefined,
        recurrenceInterval: undefined,
        recurrenceDays: undefined,
        recurrenceEndType: undefined,
        recurrenceEndDate: undefined,
        recurrenceCount: undefined,
        recurringExpenseId: undefined,
        lastGeneratedDate: undefined,
      };

      const { id, ...rest } = newSingleExpenseData as Expense;
      addExpense(rest);
      showToast({ message: 'Spesa convertita in singola.', type: 'success' });
    } else if (data.frequency === 'recurring') {
      if ('id' in data) {
        updateRecurringExpense(data);
      } else {
        addRecurringExpense(data);
      }
    } else {
      if ('id' in data) {
        updateExpense(data);
      } else {
        addExpense(data as Omit<Expense, 'id'>);
      }
    }

    setIsFormOpen(false);
    setIsCalculatorContainerOpen(false);
    setEditingExpense(undefined);
    setEditingRecurringExpense(undefined);
    setPrefilledData(undefined);
  };

  const handleMultipleExpensesSubmit = (expensesToAdd: Omit<Expense, 'id'>[]) => {
    const expensesWithIds: Expense[] = expensesToAdd.map(exp => ({ ...exp, id: crypto.randomUUID() }));
    setExpenses(prev => [...expensesWithIds, ...prev]);
    setIsMultipleExpensesModalOpen(false);
    setMultipleExpensesData([]);
    triggerSuccessIndicator();
  };

  const openEditForm = (expense: Expense) => {
    setEditingExpense(expense);
    setIsFormOpen(true);
  };

  const openRecurringEditForm = (expense: Expense) => {
    setEditingRecurringExpense(expense);
    setIsFormOpen(true);
  };

  const handleDeleteRequest = (id: string) => {
    setExpenseToDeleteId(id);
    setIsConfirmDeleteModalOpen(true);
  };

  const confirmDelete = () => {
    if (expenseToDeleteId) {
      setExpenses(prev => prev.filter(e => e.id !== expenseToDeleteId));
      setExpenseToDeleteId(null);
      setIsConfirmDeleteModalOpen(false);
      setToast({ message: 'Spesa eliminata.', type: 'info' });
    }
  };

  const deleteRecurringExpense = (id: string) => {
    setRecurringExpenses(prev => prev.filter(e => e.id !== id));
    setToast({ message: 'Spesa programmata eliminata.', type: 'info' });
  };

  const deleteExpenses = (ids: string[]) => {
    setExpenses(prev => prev.filter(e => !ids.includes(e.id)));
    setToast({ message: `${ids.length} spese eliminate.`, type: 'info' });
  };

  const deleteRecurringExpenses = (ids: string[]) => {
    setRecurringExpenses(prev => prev.filter(e => !ids.includes(e.id)));
    setToast({ message: `${ids.length} spese programmate eliminate.`, type: 'info' });
  };

  // ================== Immagini / AI ==================
  const handleImagePick = async (source: 'camera' | 'gallery') => {
    setIsImageSourceModalOpen(false);
    sessionStorage.setItem('preventAutoLock', 'true');
    try {
      const file = await pickImage(source);
      const base64Image = await fileToBase64(file);
      const newImage: OfflineImage = { id: crypto.randomUUID(), base64Image, mimeType: file.type };
      if (isOnline) {
        setImageForAnalysis(newImage);
      } else {
        await addImageToQueue(newImage);
        refreshPendingImages();
      }
    } catch (error) {
      if (!(error instanceof Error && error.message.includes('annullata'))) {
        console.error('Errore selezione immagine:', error);
        showToast({ message: "Errore durante la selezione dell'immagine.", type: 'error' });
      }
    } finally {
      setTimeout(() => sessionStorage.removeItem('preventAutoLock'), 2000);
    }
  };

  const handleAnalyzeImage = async (image: OfflineImage, fromQueue: boolean = true) => {
    if (!isOnline) {
      showToast({ message: 'Connettiti a internet per analizzare le immagini.', type: 'error' });
      return;
    }
    setSyncingImageId(image.id);
    setIsParsingImage(true);
    try {
      const parsedData = await parseExpensesFromImage(image.base64Image, image.mimeType);
      if (parsedData.length === 0) {
        showToast({ message: "Nessuna spesa trovata nell'immagine.", type: 'info' });
      } else if (parsedData.length === 1) {
        setPrefilledData(parsedData[0]);
        setIsFormOpen(true);
      } else {
        setMultipleExpensesData(parsedData);
        setIsMultipleExpensesModalOpen(true);
      }
      if (fromQueue) {
        await deleteImageFromQueue(image.id);
        refreshPendingImages();
      }
    } catch (error) {
      console.error("Error durante l'analisi AI:", error);
      showToast({ message: "Errore durante l'analisi dell'immagine.", type: 'error' });
    } finally {
      setIsParsingImage(false);
      setSyncingImageId(null);
    }
  };

  const handleVoiceParsed = (data: Partial<Omit<Expense, 'id'>>) => {
    setIsVoiceModalOpen(false);
    setPrefilledData(data);
    setIsFormOpen(true);
  };

  const isEditingOrDeletingInHistory =
    (isFormOpen && !!editingExpense) || isConfirmDeleteModalOpen;

  const isHistoryScreenOverlayed =
    isCalculatorContainerOpen ||
    isFormOpen ||
    isImageSourceModalOpen ||
    isVoiceModalOpen ||
    isConfirmDeleteModalOpen ||
    isMultipleExpensesModalOpen ||
    isParsingImage ||
    !!imageForAnalysis;

  // ================== Layout / animazioni ==================
  const isAnyModalOpenForFab =
    isCalculatorContainerOpen ||
    isFormOpen ||
    isImageSourceModalOpen ||
    isVoiceModalOpen ||
    isConfirmDeleteModalOpen ||
    isMultipleExpensesModalOpen ||
    isDateModalOpen ||
    isParsingImage ||
    !!imageForAnalysis ||
    isRecurringScreenOpen ||
    (isHistoryScreenOpen && isHistoryFilterPanelOpen);

  const FAB_MARGIN_ABOVE_PEEK = 12;

  const fabStyle: React.CSSProperties = {
    bottom: isHistoryScreenOpen
      ? `calc(${PEEK_PX + FAB_MARGIN_ABOVE_PEEK}px + env(safe-area-inset-bottom, 0px))`
      : `calc(1.5rem + env(safe-area-inset-bottom, 0px))`,
    opacity: isAnyModalOpenForFab ? 0 : 1,
    visibility: isAnyModalOpenForFab ? 'hidden' : 'visible',
    pointerEvents: isAnyModalOpenForFab ? 'none' : 'auto',
    transition:
      'opacity 0.2s ease-out, visibility 0s linear ' +
      (isAnyModalOpenForFab ? '0.2s' : '0s') +
      ', bottom 0.3s ease-in-out',
  };

  return (
    <div
      className="h-full w-full bg-slate-100 flex flex-col font-sans"
      style={{ touchAction: 'pan-y' }}
    >
      <div className="flex-shrink-0 z-20">
        <Header
          pendingSyncs={pendingImages.length}
          isOnline={isOnline}
          onInstallClick={handleInstallClick}
          installPromptEvent={installPromptEvent}
          onLogout={onLogout}
        />
      </div>

      <main className="flex-grow bg-slate-100">
        <div className="w-full h-full overflow-y-auto space-y-6" style={{ touchAction: 'pan-y' }}>
          <Dashboard
            expenses={expenses}
            recurringExpenses={recurringExpenses}
            onNavigateToRecurring={() => setIsRecurringScreenOpen(true)}
            onNavigateToHistory={() => setIsHistoryScreenOpen(true)}
          />
          <PendingImages
            images={pendingImages}
            onAnalyze={image => handleAnalyzeImage(image, true)}
            onDelete={async id => {
              await deleteImageFromQueue(id);
              refreshPendingImages();
            }}
            isOnline={isOnline}
            syncingImageId={syncingImageId}
          />
        </div>
      </main>

      {!isCalculatorContainerOpen && (
        <FloatingActionButton
          onAddManually={() => setIsCalculatorContainerOpen(true)}
          onAddFromImage={() => setIsImageSourceModalOpen(true)}
          onAddFromVoice={() => setIsVoiceModalOpen(true)}
          style={fabStyle}
        />
      )}

      <SuccessIndicator show={showSuccessIndicator && !isAnyModalOpenForFab} />

      <CalculatorContainer
        isOpen={isCalculatorContainerOpen}
        onClose={() => setIsCalculatorContainerOpen(false)}
        onSubmit={handleFormSubmit}
        accounts={accounts}
        expenses={expenses}
        onEditExpense={openEditForm}
        onDeleteExpense={handleDeleteRequest}
        onMenuStateChange={() => {}}
      />

      <ExpenseForm
        isOpen={isFormOpen}
        onClose={() => {
          setIsFormOpen(false);
          setEditingExpense(undefined);
          setEditingRecurringExpense(undefined);
          setPrefilledData(undefined);
        }}
        onSubmit={handleFormSubmit}
        initialData={editingExpense || editingRecurringExpense}
        prefilledData={prefilledData}
        accounts={accounts}
        isForRecurringTemplate={!!editingRecurringExpense}
      />

      {isImageSourceModalOpen && (
        <div
          className="fixed inset-0 z-50 flex justify-center items-end p-4 transition-opacity duration-75 ease-in-out bg-slate-900/60 backdrop-blur-sm"
          onClick={() => setIsImageSourceModalOpen(false)}
          aria-modal="true"
          role="dialog"
        >
          <div
            className="bg-slate-50 rounded-lg shadow-xl w-full max-w-lg transform transition-all duration-75 ease-in-out animate-fade-in-up"
            onClick={e => e.stopPropagation()}
          >
            <header className="flex justify-between items-center p-6 border-b border-slate-200">
              <h2 className="text-xl font-bold text-slate-800">Aggiungi da Immagine</h2>
              <button
                type="button"
                onClick={() => setIsImageSourceModalOpen(false)}
                className="text-slate-500 hover:text-slate-800 transition-colors p-1 rounded-full hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                aria-label="Chiudi"
              >
                <XMarkIcon className="w-6 h-6" />
              </button>
            </header>
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              <ImageSourceCard
                icon={<CameraIcon className="w-8 h-8" />}
                title="Scatta Foto"
                description="Usa la fotocamera per una nuova ricevuta."
                onClick={() => handleImagePick('camera')}
              />
              <ImageSourceCard
                icon={<ComputerDesktopIcon className="w-8 h-8" />}
                title="Scegli da Galleria"
                description="Carica un'immagine già salvata sul dispositivo."
                onClick={() => handleImagePick('gallery')}
              />
            </div>
          </div>
        </div>
      )}

      {isParsingImage && (
        <div className="fixed inset-0 bg-white/80 backdrop-blur-md flex flex-col items-center justify-center z-[100]">
          <SpinnerIcon className="w-12 h-12 text-indigo-600" />
          <p className="mt-4 text-lg font-semibold text-slate-700 animate-pulse-subtle">
            Analisi in corso...
          </p>
        </div>
      )}

      <VoiceInputModal
        isOpen={isVoiceModalOpen}
        onClose={() => setIsVoiceModalOpen(false)}
        onParsed={handleVoiceParsed}
      />

      <ConfirmationModal
        isOpen={isConfirmDeleteModalOpen}
        onClose={() => {
          setIsConfirmDeleteModalOpen(false);
          setExpenseToDeleteId(null);
        }}
        onConfirm={confirmDelete}
        title="Conferma Eliminazione"
        message={
          <>
            Sei sicuro di voler eliminare questa spesa? <br />
            L'azione è irreversibile.
          </>
        }
        variant="danger"
      />

      <ConfirmationModal
        isOpen={!!imageForAnalysis}
        onClose={() => {
          if (imageForAnalysis) {
            addImageToQueue(imageForAnalysis).then(() => {
              refreshPendingImages();
              setImageForAnalysis(null);
            });
          }
        }}
        onConfirm={() => {
          if (imageForAnalysis) {
            handleAnalyzeImage(imageForAnalysis, false);
            setImageForAnalysis(null);
          }
        }}
        title="Analizza Immagine"
        message="Vuoi analizzare subito questa immagine per rilevare le spese?"
        variant="info"
        confirmButtonText="Analizza Ora"
        cancelButtonText="Più Tardi"
      />

      <MultipleExpensesModal
        isOpen={isMultipleExpensesModalOpen}
        onClose={() => setIsMultipleExpensesModalOpen(false)}
        expenses={multipleExpensesData}
        accounts={accounts}
        onConfirm={handleMultipleExpensesSubmit}
      />

      {isHistoryScreenOpen && (
        <HistoryScreen
          expenses={expenses}
          accounts={accounts}
          onClose={() => {
            setIsHistoryScreenOpen(false);
          }}
          onEditExpense={openEditForm}
          onDeleteExpense={handleDeleteRequest}
          onDeleteExpenses={deleteExpenses}
          isEditingOrDeleting={isEditingOrDeletingInHistory}
          isOverlayed={isHistoryScreenOverlayed}
          onDateModalStateChange={setIsDateModalOpen}
          onFilterPanelOpenStateChange={setIsHistoryFilterPanelOpen}
        />
      )}

      {isRecurringScreenOpen && (
        <RecurringExpensesScreen
          recurringExpenses={recurringExpenses}
          expenses={expenses}
          accounts={accounts}
          onClose={() => {
            setIsRecurringScreenOpen(false);
          }}
          onEdit={openRecurringEditForm}
          onDelete={deleteRecurringExpense}
          onDeleteRecurringExpenses={deleteRecurringExpenses}
        />
      )}

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
};

export default App;
