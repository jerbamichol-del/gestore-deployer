# CATALOG_MAIN (testo)
Embed testo (<= 1048576 bytes per file)


---

## `./.github/workflows/sync-from-ai-repo.yml`

```yml
name: Sync from AI Studio source

on:
  workflow_dispatch: {}

jobs:
  sync:
    runs-on: ubuntu-latest

    env:
      SOURCE_REPO: jerbamichol-del/gestore-ai-studio-source
      SOURCE_BRANCH: main

    steps:
      - name: Checkout gestore
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Configura git
        run: |
          git config user.name "ai-studio-sync"
          git config user.email "ai-studio-sync@users.noreply.github.com"

      - name: Clona repo AI Studio in cartella esterna
        run: |
          rm -rf ../ai_src
          git clone --depth=1 \
            https://x-access-token:${{ secrets.SOURCE_REPO_TOKEN }}@github.com/${SOURCE_REPO}.git \
            ../ai_src

      - name: Sincronizza file dalla repo AI Studio
        run: |
          rsync -av --delete \
            --exclude=".git" \
            --exclude=".github" \
            ../ai_src/ ./

      - name: Commit & push se ci sono modifiche
        run: |
          if git status --porcelain | grep .; then
            git add .
            git commit -m "Sync from AI Studio source"
            git push origin HEAD
          else
            echo "Nessuna modifica da sincronizzare."
          fi

```


---

## `./App.tsx`

```tsx
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

```


---

## `./AuthGate.tsx`

```tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import App from './App';
import LoginScreen from './screens/LoginScreen';
import SetupScreen from './screens/SetupScreen';
import ForgotPasswordScreen from './screens/ForgotPasswordScreen';
import ForgotPasswordSuccessScreen from './screens/ForgotPasswordSuccessScreen';
import ResetPinScreen from './screens/ResetPinScreen';
import { useLocalStorage } from './hooks/useLocalStorage';

type AuthView = 'login' | 'register' | 'forgotPassword' | 'forgotPasswordSuccess';
type ResetContext = { token: string; email: string; } | null;

const LOCK_TIMEOUT_MS = 30000; // 30 secondi

const AuthGate: React.FC = () => {
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [, setLastActiveUser] = useLocalStorage<string | null>('last_active_user_email', null);
  const [resetContext, setResetContext] = useState<ResetContext>(null);
  const hiddenTimestampRef = useRef<number | null>(null);
  const [emailForReset, setEmailForReset] = useState<string>('');
  
  // Controlla se esiste un database di utenti per decidere la schermata iniziale.
  const hasUsers = () => {
    try {
        const users = localStorage.getItem('users_db');
        return users !== null && users !== '{}';
    } catch (e) {
        return false;
    }
  };

  const [authView, setAuthView] = useState<AuthView>(hasUsers() ? 'login' : 'register');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('resetToken');
    const email = params.get('email');

    if (token && email) {
        setResetContext({ token, email });
        // Pulisce l'URL per evitare che il reset venga riattivato al refresh della pagina
        window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const handleAuthSuccess = (token: string, email: string) => {
    setSessionToken(token);
    setLastActiveUser(email.toLowerCase());
  };
  
  const handleResetSuccess = () => {
    setResetContext(null);
    setAuthView('login'); // Torna alla schermata di login dopo il reset
  };

  const handleLogout = useCallback(() => {
    setSessionToken(null);
    setLastActiveUser(null);
    setAuthView(hasUsers() ? 'login' : 'register');
  }, [setLastActiveUser]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        if (sessionToken) {
           hiddenTimestampRef.current = Date.now();
        }
      } else if (document.visibilityState === 'visible') {
        if (sessionStorage.getItem('preventAutoLock') === 'true') {
            sessionStorage.removeItem('preventAutoLock');
            hiddenTimestampRef.current = null; // Reset timestamp to prevent logout
            return;
        }

        if (sessionToken && hiddenTimestampRef.current) {
          const elapsed = Date.now() - hiddenTimestampRef.current;
          if (elapsed > LOCK_TIMEOUT_MS) {
            handleLogout();
          }
        }
        hiddenTimestampRef.current = null;
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [sessionToken, handleLogout]);
  
  if (resetContext) {
    return (
      <ResetPinScreen
        email={resetContext.email}
        token={resetContext.token}
        onResetSuccess={handleResetSuccess}
      />
    );
  }

  if (sessionToken) {
    return <App onLogout={handleLogout} />;
  }
  
  // Forziamo la vista di registrazione se non ci sono utenti
  if (!hasUsers() && authView !== 'register') {
      setAuthView('register');
  }

  switch (authView) {
    case 'register':
      return <SetupScreen onSetupSuccess={handleAuthSuccess} onGoToLogin={() => setAuthView('login')} />;
    case 'forgotPassword':
      return <ForgotPasswordScreen 
        onBackToLogin={() => setAuthView('login')} 
        onRequestSent={(email) => {
            setEmailForReset(email);
            setAuthView('forgotPasswordSuccess');
        }} 
      />;
    case 'forgotPasswordSuccess':
      return <ForgotPasswordSuccessScreen 
        email={emailForReset}
        onBackToLogin={() => setAuthView('login')} 
      />;
    case 'login':
    default:
      return (
        <LoginScreen 
            onLoginSuccess={handleAuthSuccess}
            onGoToRegister={() => setAuthView('register')}
            onGoToForgotPassword={() => setAuthView('forgotPassword')}
            // FIX: Add missing onGoToForgotEmail prop to satisfy LoginScreenProps.
            onGoToForgotEmail={() => setAuthView('forgotPassword')}
        />
      );
  }
};

export default AuthGate;
```


---

## `./CalculatorContainer.tsx`

```tsx
// CalculatorContainer.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Expense, Account } from '../types';
import CalculatorInputScreen from './CalculatorInputScreen';
import TransactionDetailPage from './TransactionDetailPage';
import { useSwipe } from '../hooks/useSwipe';

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
```


---

## `./ExpenseForm.tsx`

```tsx
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
```


---

## `./README.md`

```md
<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/19t8cUWYrVJLD1tMEZuQqyZs52OuuSQ0R

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

```


---

## `./SelectionMenu.tsx`

```tsx
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
```


---

## `./components/BottomNavigationBar.tsx`

```tsx

```


---

## `./components/CalculatorContainer.tsx`

```tsx
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

```


---

## `./components/CalculatorInputScreen.tsx`

```tsx
// CalculatorInputScreen.tsx
import React, { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { Expense, Account, CATEGORIES } from '../types';
import { ArrowLeftIcon } from './icons/ArrowLeftIcon';
import { XMarkIcon } from './icons/XMarkIcon';
import { CheckIcon } from './icons/CheckIcon';
import { BackspaceIcon } from './icons/BackspaceIcon';
import SelectionMenu from './SelectionMenu';
import { getCategoryStyle } from '../utils/categoryStyles';
import { ChevronLeftIcon } from './icons/ChevronLeftIcon';
import SmoothPullTab from './SmoothPullTab';

interface CalculatorInputScreenProps {
  onClose: () => void;
  onSubmit: (data: Omit<Expense, "id">) => void;
  accounts: Account[];
  formData: Partial<Omit<Expense, 'id'>>;
  onFormChange: (newData: Partial<Omit<Expense, 'id'>>) => void;
  onMenuStateChange: (isOpen: boolean) => void;
  isDesktop: boolean;
  onNavigateToDetails: () => void;
}

// Memoized formatter
const formatAmountForDisplay = (numStr: string): string => {
  const sanitizedStr = String(numStr || '0').replace('.', ',');
  const [integerPart, decimalPart] = sanitizedStr.split(',');
  const formattedIntegerPart = (integerPart || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return decimalPart !== undefined ? `${formattedIntegerPart},${decimalPart}` : formattedIntegerPart;
};

const getAmountFontSize = (value: string): string => {
  const len = value.length;
  if (len <= 4) return 'text-9xl';
  if (len <= 6) return 'text-8xl';
  if (len <= 8) return 'text-7xl';
  if (len <= 11) return 'text-6xl';
  return 'text-5xl';
};

// Optimized Keypad Button
const KeypadButton: React.FC<React.HTMLAttributes<HTMLDivElement> & {
  children: React.ReactNode;
  onClick?: () => void;
}> = ({ children, onClick, className = '', ...rest }) => {
  const blurSelf = (el: EventTarget | null) => {
    if (el && (el as HTMLElement).blur) (el as HTMLElement).blur();
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={typeof children === 'string' ? `Tasto ${children}` : 'Tasto'}
      aria-pressed="false"
      onClick={(e) => { onClick?.(); blurSelf(e.currentTarget); }}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && onClick) {
          e.preventDefault();
          onClick();
          blurSelf(e.currentTarget);
        }
      }}
      onPointerUp={(e) => blurSelf(e.currentTarget)}
      onMouseDown={(e) => e.preventDefault()}
      className={`flex items-center justify-center text-5xl font-light focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400 transition-colors duration-150 select-none cursor-pointer active:scale-95 ${className}`}
      style={{
        WebkitTapHighlightColor: 'transparent',
        touchAction: 'manipulation',
        WebkitTouchCallout: 'none',
        userSelect: 'none',
      } as React.CSSProperties}
      {...rest}
    >
      <span className="pointer-events-none">{children}</span>
    </div>
  );
};

const OperatorButton: React.FC<{ children: React.ReactNode; onClick: () => void }> = ({ children, onClick }) => {
  const blurSelf = (el: EventTarget | null) => {
    if (el && (el as HTMLElement).blur) (el as HTMLElement).blur();
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Operatore ${children}`}
      aria-pressed="false"
      onClick={(e) => { onClick(); blurSelf(e.currentTarget); }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); blurSelf(e.currentTarget); } }}
      onPointerUp={(e) => blurSelf(e.currentTarget)}
      onMouseDown={(e) => e.preventDefault()}
      className="flex-1 w-full text-5xl text-indigo-600 font-light active:bg-slate-300/80 transition-colors duration-150 flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400 select-none cursor-pointer active:scale-95"
      style={{ WebkitTapHighlightColor: 'transparent', touchAction: 'manipulation' } as React.CSSProperties}
    >
      <span className="pointer-events-none">{children}</span>
    </div>
  );
};

const CalculatorInputScreen = React.forwardRef<HTMLDivElement, CalculatorInputScreenProps>(({
  onClose, onSubmit, accounts,
  formData, onFormChange, onMenuStateChange, isDesktop, onNavigateToDetails
}, ref) => {
  const [currentValue, setCurrentValue] = useState('0');
  const [previousValue, setPreviousValue] = useState<string | null>(null);
  const [operator, setOperator] = useState<string | null>(null);
  const [shouldResetCurrentValue, setShouldResetCurrentValue] = useState(false);
  const [justCalculated, setJustCalculated] = useState(false);
  const [activeMenu, setActiveMenu] = useState<'account' | 'category' | 'subcategory' | null>(null);

  const isSyncingFromParent = useRef(false);
  const typingSinceActivationRef = useRef(false);

  // 🔧 SEMPLIFICATO: Rimosso tap bridge complesso che blocca eventi
  useEffect(() => {
    onMenuStateChange(activeMenu !== null);
  }, [activeMenu, onMenuStateChange]);

  useEffect(() => {
    const onActivated = (e: Event) => {
      const ce = e as CustomEvent;
      if (ce.detail === 'calculator') {
        typingSinceActivationRef.current = false;
        setShouldResetCurrentValue(false);
        setJustCalculated(false);
      }
    };
    window.addEventListener('page-activated', onActivated as EventListener);
    return () => window.removeEventListener('page-activated', onActivated as EventListener);
  }, []);

  // Sync bidirezionale con debounce
  // FIX: Changed type from global.NodeJS.Timeout to number for browser compatibility.
  const syncTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    // Dal parent allo schermo
    const parentAmount = formData.amount ?? 0;
    const currentAmount = parseFloat(currentValue.replace(/\./g, '').replace(',', '.')) || 0;
    
    if (Math.abs(parentAmount - currentAmount) > 0.01 && !typingSinceActivationRef.current) {
      isSyncingFromParent.current = true;
      setCurrentValue(String(parentAmount).replace('.', ','));
      setPreviousValue(null);
      setOperator(null);
      setShouldResetCurrentValue(false);
      setJustCalculated(false);
    }
  }, [formData.amount, currentValue]);

  useEffect(() => {
    if (isSyncingFromParent.current) {
      isSyncingFromParent.current = false;
      return;
    }
    
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    syncTimeoutRef.current = window.setTimeout(() => {
      const amount = parseFloat(currentValue.replace(/\./g, '').replace(',', '.')) || 0;
      if (Math.abs(amount - (formData.amount ?? 0)) > 0.01) {
        onFormChange({ amount });
      }
    }, 300);

    return () => {
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    };
  }, [currentValue, formData.amount, onFormChange]);

  const handleClearAmount = useCallback(() => {
    typingSinceActivationRef.current = true;
    setCurrentValue('0');
    setJustCalculated(false);
  }, []);

  const handleSingleBackspace = useCallback(() => {
    typingSinceActivationRef.current = true;
    if (justCalculated) {
      handleClearAmount();
      return;
    }
    if (shouldResetCurrentValue) {
      setCurrentValue('0');
      setPreviousValue(null);
      setOperator(null);
      setShouldResetCurrentValue(false);
      return;
    }
    setCurrentValue(prev => {
      const valNoDots = prev.replace(/\./g, '');
      return valNoDots.length > 1 ? valNoDots.slice(0, -1) : '0';
    });
  }, [justCalculated, shouldResetCurrentValue, handleClearAmount]);

  // Long press su ⌫
  const delTimerRef = useRef<number | null>(null);
  const delDidLongRef = useRef(false);
  const delStartXRef = useRef(0);
  const delStartYRef = useRef(0);

  const DEL_HOLD_MS = 450;
  const DEL_SLOP_PX = 8;

  const clearDelTimer = useCallback(() => {
    if (delTimerRef.current !== null) {
      window.clearTimeout(delTimerRef.current);
      delTimerRef.current = null;
    }
  }, []);

  const onDelPointerDownCapture = useCallback<React.PointerEventHandler<HTMLDivElement>>((e) => {
    delDidLongRef.current = false;
    delStartXRef.current = e.clientX ?? 0;
    delStartYRef.current = e.clientY ?? 0;
    try { (e.currentTarget as any).setPointerCapture?.((e as any).pointerId ?? 1); } catch {}
    clearDelTimer();
    delTimerRef.current = window.setTimeout(() => {
      delDidLongRef.current = true;
      clearDelTimer();
      handleClearAmount();
      if (navigator.vibrate) navigator.vibrate(10);
    }, DEL_HOLD_MS);
  }, [clearDelTimer, handleClearAmount]);

  const onDelPointerMoveCapture = useCallback<React.PointerEventHandler<HTMLDivElement>>((e) => {
    if (!delTimerRef.current) return;
    const dx = Math.abs((e.clientX ?? 0) - delStartXRef.current);
    const dy = Math.abs((e.clientY ?? 0) - delStartYRef.current);
    if (dx > DEL_SLOP_PX || dy > DEL_SLOP_PX) {
      clearDelTimer();
    }
  }, [clearDelTimer]);

  const onDelPointerUpCapture = useCallback<React.PointerEventHandler<HTMLDivElement>>(() => {
    const didLong = delDidLongRef.current;
    clearDelTimer();
    if (didLong) {
      delDidLongRef.current = false;
      return;
    }
    handleSingleBackspace();
  }, [clearDelTimer, handleSingleBackspace]);

  const onDelPointerCancelCapture = useCallback<React.PointerEventHandler<HTMLDivElement>>(() => {
    clearDelTimer();
  }, [clearDelTimer]);

  useEffect(() => {
    const cancel = () => clearDelTimer();
    window.addEventListener('numPad:cancelLongPress', cancel);
    return () => window.removeEventListener('numPad:cancelLongPress', cancel);
  }, [clearDelTimer]);

  const calculate = useCallback((): string => {
    const prev = parseFloat((previousValue || '0').replace(/\./g, '').replace(',', '.'));
    const current = parseFloat(currentValue.replace(/\./g, '').replace(',', '.'));
    let result = 0;
    switch (operator) {
      case '+': result = prev + current; break;
      case '-': result = prev - current; break;
      case '×': result = prev * current; break;
      case '÷': if (current === 0) return 'Error'; result = prev / current; break;
      default: return currentValue.replace('.', ',');
    }
    setJustCalculated(true);
    const resultStr = String(parseFloat(result.toPrecision(12)));
    return resultStr.replace('.', ',');
  }, [currentValue, previousValue, operator]);

  const handleKeyPress = useCallback((key: string) => {
    typingSinceActivationRef.current = true;

    if (['÷', '×', '-', '+'].includes(key)) {
      if (operator && previousValue && !shouldResetCurrentValue) {
        const result = calculate(); setPreviousValue(result); setCurrentValue(result);
      } else { setPreviousValue(currentValue); }
      setOperator(key); setShouldResetCurrentValue(true); setJustCalculated(false);
    } else if (key === '=') {
      if (operator && previousValue) {
        const result = calculate(); setCurrentValue(result);
        setPreviousValue(null); setOperator(null); setShouldResetCurrentValue(true);
      }
    } else {
      setJustCalculated(false);
      if (shouldResetCurrentValue) { setCurrentValue(key === ',' ? '0,' : key); setShouldResetCurrentValue(false); return; }
      setCurrentValue(prev => {
        const valNoDots = prev.replace(/\./g, '');
        if (key === ',' && valNoDots.includes(',')) return prev;
        const maxLength = 12;
        if (valNoDots.replace(',', '').length >= maxLength) return prev;
        if (valNoDots === '0' && key !== ',') return key;
        if (valNoDots.includes(',') && valNoDots.split(',')[1]?.length >= 2) return prev;
        return valNoDots + key;
      });
    }
  }, [currentValue, operator, previousValue, shouldResetCurrentValue, calculate]);

  const canSubmit = useMemo(() => (parseFloat(currentValue.replace(/\./g, '').replace(',', '.')) || 0) > 0, [currentValue]);

  const handleSubmit = useCallback(() => {
    const amount = parseFloat(currentValue.replace(/\./g, '').replace(',', '.')) || 0;
    if (amount > 0) {
      onSubmit({ ...formData, amount, category: formData.category || 'Altro' } as Omit<Expense, 'id'>);
    }
  }, [currentValue, formData, onSubmit]);

  const handleSelectChange = useCallback((field: keyof Omit<Expense, 'id'>, value: string) => {
    const updated = { [field]: value } as Partial<Omit<Expense, 'id'>>;
    if (field === 'category') (updated as any).subcategory = '';
    onFormChange(updated);
    setActiveMenu(null);
  }, [onFormChange]);

  const categoryOptions = useMemo(() => 
    Object.keys(CATEGORIES).map(cat => ({
      value: cat,
      label: getCategoryStyle(cat).label,
      Icon: getCategoryStyle(cat).Icon,
      color: getCategoryStyle(cat).color,
      bgColor: getCategoryStyle(cat).bgColor,
    })),
    []
  );

  const subcategoryOptions = useMemo(() => 
    formData.category ? (CATEGORIES[formData.category]?.map(sub => ({ value: sub, label: sub })) || []) : [],
    [formData.category]
  );

  const accountOptions = useMemo(() => 
    accounts.map(acc => ({ value: acc.id, label: acc.name })),
    [accounts]
  );

  const displayValue = useMemo(() => formatAmountForDisplay(currentValue), [currentValue]);
  const smallDisplayValue = useMemo(() => 
    previousValue && operator ? `${formatAmountForDisplay(previousValue)} ${operator}` : ' ',
    [previousValue, operator]
  );
  const fontSizeClass = useMemo(() => getAmountFontSize(displayValue), [displayValue]);

  return (
    <div
      ref={ref}
      tabIndex={-1}
      className="bg-slate-100 w-full h-full flex flex-col focus:outline-none"
      style={{ touchAction: 'pan-y' }}
    >
      <div className="flex-1 flex flex-col">
        <header className="flex items-center justify-between p-4 flex-shrink-0">
          <button
            // FIX: This onClick handler was implicitly passing a MouseEvent to a prop expecting no arguments.
            // Wrapping it in a lambda function prevents the type mismatch.
            onClick={() => onClose()}
            aria-label="Chiudi calcolatrice"
            className="w-11 h-11 flex items-center justify-center border border-red-300 text-red-600 bg-red-50 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 rounded-full transition-colors"
          >
            <XMarkIcon className="w-6 h-6" />
          </button>
          <h2 className="text-xl font-bold text-slate-800">Nuova Spesa</h2>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            aria-label="Conferma spesa"
            className={`w-11 h-11 flex items-center justify-center border rounded-full transition-colors
              border-green-500 bg-green-200 text-green-800 hover:bg-green-300 
              focus:outline-none focus:ring-2 focus:ring-green-500 
              disabled:bg-slate-100 disabled:border-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed
              ${isDesktop ? 'hidden' : ''}`}
          >
            <CheckIcon className="w-7 h-7" />
          </button>
          {isDesktop && <div className="w-11 h-11" />}
        </header>

        <main className="flex-1 flex flex-col overflow-hidden relative" style={{ touchAction: 'pan-y' }}>
          <div className="flex-1 flex flex-col justify-center items-center p-4 pt-0">
            <div className="w-full px-4 text-center">
              <span className="text-slate-500 text-2xl font-light h-8 block">{smallDisplayValue}</span>
              <div className={`relative inline-block text-slate-800 font-light tracking-tighter whitespace-nowrap transition-all leading-none ${fontSizeClass}`}>
                {displayValue}
                <span className="absolute right-full top-1/2 -translate-y-1/2 opacity-75" style={{ fontSize: '0.6em', marginRight: '0.2em' }}>€</span>
              </div>
            </div>
          </div>
          
          <div
            role="button"
            tabIndex={0}
            aria-label="Aggiungi dettagli alla spesa"
            aria-hidden={isDesktop}
            // FIX: Use onNavigateToDetails prop.
            onClick={onNavigateToDetails}
            // FIX: Use onNavigateToDetails prop.
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onNavigateToDetails(); }}
            className={`absolute top-1/2 -right-px w-8 h-[148px] flex items-center justify-center cursor-pointer ${isDesktop ? 'hidden' : ''}`}
            style={{ transform: 'translateY(calc(-50% + 2px))' }}
          >
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="transform -rotate-90">
                <SmoothPullTab
                  width="148"
                  height="32"
                  fill="rgba(199, 210, 254, 0.8)"
                />
              </div>
            </div>
            <ChevronLeftIcon className="relative z-10 w-6 h-6 text-indigo-600 transition-colors" />
          </div>
        </main>
      </div>
      
      <div className="flex-shrink-0 flex flex-col" style={{ height: '52vh' }}>
        <div className="flex justify-between items-center my-2 w-full px-4" style={{ touchAction: 'pan-y' }}>
          <button
            onClick={() => setActiveMenu('account')}
            className="font-semibold text-indigo-600 hover:text-indigo-800 text-lg w-1/3 truncate p-2 rounded-lg focus:outline-none focus:ring-0 text-left"
            aria-label="Seleziona conto"
          >
            {accounts.find(a => a.id === formData.accountId)?.name || 'Conto'}
          </button>
          <button
            onClick={() => setActiveMenu('category')}
            className="font-semibold text-indigo-600 hover:text-indigo-800 text-lg w-1/3 truncate p-2 rounded-lg focus:outline-none focus:ring-0 text-center"
            aria-label="Seleziona categoria"
          >
            {formData.category ? getCategoryStyle(formData.category).label : 'Categoria'}
          </button>
          <button
            onClick={() => setActiveMenu('subcategory')}
            disabled={!formData.category || subcategoryOptions.length === 0}
            className="font-semibold text-lg w-1/3 truncate p-2 rounded-lg focus:outline-none focus:ring-0 disabled:cursor-not-allowed disabled:text-slate-400 text-indigo-600 hover:text-indigo-800 transition-colors text-right"
            aria-label="Seleziona sottocategoria"
            aria-disabled={!formData.category || subcategoryOptions.length === 0}
          >
            {formData.subcategory || 'Sottocateg.'}
          </button>
        </div>

        <div className="flex-1 p-2 flex flex-row gap-2 px-4 pb-4">
          <div className="h-full w-4/5 grid grid-cols-3 grid-rows-4 gap-2 num-pad">
            <KeypadButton className="text-slate-800" onClick={() => handleKeyPress('7')}>7</KeypadButton>
            <KeypadButton className="text-slate-800" onClick={() => handleKeyPress('8')}>8</KeypadButton>
            <KeypadButton className="text-slate-800" onClick={() => handleKeyPress('9')}>9</KeypadButton>
            <KeypadButton className="text-slate-800" onClick={() => handleKeyPress('4')}>4</KeypadButton>
            <KeypadButton className="text-slate-800" onClick={() => handleKeyPress('5')}>5</KeypadButton>
            <KeypadButton className="text-slate-800" onClick={() => handleKeyPress('6')}>6</KeypadButton>
            <KeypadButton className="text-slate-800" onClick={() => handleKeyPress('1')}>1</KeypadButton>
            <KeypadButton className="text-slate-800" onClick={() => handleKeyPress('2')}>2</KeypadButton>
            <KeypadButton className="text-slate-800" onClick={() => handleKeyPress('3')}>3</KeypadButton>
            <KeypadButton className="text-slate-800" onClick={() => handleKeyPress(',')}>,</KeypadButton>
            <KeypadButton className="text-slate-800" onClick={() => handleKeyPress('0')}>0</KeypadButton>
            <KeypadButton
              // FIX: Correctly type props for KeypadButton and remove invalid ones from the component's internal div.
              title="Tocca: cancella una cifra — Tieni premuto: cancella tutto"
              aria-label="Cancella"
              onPointerDownCapture={onDelPointerDownCapture}
              onPointerMoveCapture={onDelPointerMoveCapture}
              onPointerUpCapture={onDelPointerUpCapture}
              onPointerCancelCapture={onDelPointerCancelCapture}
              onContextMenu={(e) => e.preventDefault()}
            >
              {/* 🔧 FIX: Aggiunta classe colore esplicita */}
              <BackspaceIcon className="w-8 h-8 text-slate-800" />
            </KeypadButton>
          </div>

          <div 
            className="h-full w-1/5 flex flex-col gap-2 bg-slate-200 rounded-2xl p-1"
            style={{ touchAction: 'pan-y' }}
          >
            <OperatorButton onClick={() => handleKeyPress('÷')}>÷</OperatorButton>
            <OperatorButton onClick={() => handleKeyPress('×')}>×</OperatorButton>
            <OperatorButton onClick={() => handleKeyPress('-')}>-</OperatorButton>
            <OperatorButton onClick={() => handleKeyPress('+')}>+</OperatorButton>
            <OperatorButton onClick={() => handleKeyPress('=')}>=</OperatorButton>
          </div>
        </div>
      </div>

      <SelectionMenu
        isOpen={activeMenu === 'account'} onClose={() => setActiveMenu(null)}
        title="Seleziona un Conto"
        options={accountOptions}
        selectedValue={formData.accountId || ''}
        onSelect={(value) => handleSelectChange('accountId', value)}
      />
      <SelectionMenu
        isOpen={activeMenu === 'category'} onClose={() => setActiveMenu(null)}
        title="Seleziona una Categoria"
        options={categoryOptions}
        selectedValue={formData.category || ''}
        onSelect={(value) => handleSelectChange('category', value)}
      />
      <SelectionMenu
        isOpen={activeMenu === 'subcategory'} onClose={() => setActiveMenu(null)}
        title="Seleziona Sottocategoria"
        options={subcategoryOptions}
        selectedValue={formData.subcategory || ''}
        onSelect={(value) => handleSelectChange('subcategory', value)}
      />
    </div>
  );
});

CalculatorInputScreen.displayName = 'CalculatorInputScreen';

export default CalculatorInputScreen;

```


---

## `./components/CategoryFilter.tsx`

```tsx

```


---

## `./components/ConfirmationModal.tsx`

```tsx
import React, { useState, useEffect } from 'react';
import { ExclamationTriangleIcon } from './icons/ExclamationTriangleIcon';
import { InformationCircleIcon } from './icons/InformationCircleIcon';

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: React.ReactNode;
  variant?: 'danger' | 'info';
  confirmButtonText?: string;
  cancelButtonText?: string;
}

const ConfirmationModal: React.FC<ConfirmationModalProps> = ({ 
  isOpen, 
  onClose, 
  onConfirm, 
  title, 
  message, 
  variant = 'danger',
  confirmButtonText = 'Conferma',
  cancelButtonText = 'Annulla'
}) => {
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => setIsAnimating(true), 10);
      return () => clearTimeout(timer);
    } else {
      setIsAnimating(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const config = {
      danger: {
          icon: ExclamationTriangleIcon,
          iconColor: 'text-red-600',
          bgColor: 'bg-red-100',
          confirmButtonClasses: 'bg-red-600 hover:bg-red-700 focus:ring-red-500',
      },
      info: {
          icon: InformationCircleIcon,
          iconColor: 'text-indigo-600',
          bgColor: 'bg-indigo-100',
          confirmButtonClasses: 'bg-indigo-600 hover:bg-indigo-700 focus:ring-indigo-500',
      }
  }
  const { icon: Icon, iconColor, bgColor, confirmButtonClasses } = config[variant];

  return (
    <div
      className={`fixed inset-0 z-50 flex justify-center items-center p-4 transition-opacity duration-75 ease-in-out ${isAnimating ? 'opacity-100' : 'opacity-0'} bg-slate-900/60 backdrop-blur-sm`}
      onClick={onClose}
      aria-modal="true"
      role="dialog"
      aria-labelledby="modal-title"
    >
      <div
        className={`bg-white rounded-lg shadow-xl w-full max-w-md transform transition-all duration-75 ease-in-out ${isAnimating ? 'scale-100 opacity-100' : 'scale-95 opacity-0'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          <div className="sm:flex sm:items-start">
            <div className={`mx-auto flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full ${bgColor} sm:mx-0 sm:h-10 sm:w-10`}>
              <Icon className={`h-6 w-6 ${iconColor}`} aria-hidden="true" />
            </div>
            <div className="mt-3 text-center sm:ml-4 sm:mt-0 sm:text-left">
              <h3 className="text-lg font-semibold leading-6 text-slate-900" id="modal-title">
                {title}
              </h3>
              <div className="mt-2">
                <p className="text-sm text-slate-500">
                  {message}
                </p>
              </div>
            </div>
          </div>
        </div>
        <div className="px-6 py-4 bg-slate-50 flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto px-4 py-2 text-sm font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg shadow-sm hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-colors"
          >
            {cancelButtonText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`w-full sm:w-auto px-4 py-2 text-sm font-semibold text-white rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors ${confirmButtonClasses}`}
          >
            {confirmButtonText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmationModal;
```


---

## `./components/CustomSelect.tsx`

```tsx
import React, { useState, useRef, useEffect } from 'react';
import { ChevronDownIcon } from './icons/ChevronDownIcon';

interface Option {
    value: string;
    label: string;
    Icon?: React.FC<React.SVGProps<SVGSVGElement>>;
    color?: string;
    bgColor?: string;
}

interface CustomSelectProps {
  options: Option[];
  selectedValue: string;
  onSelect: (value: string) => void;
  placeholder: string;
  disabled?: boolean;
  icon?: React.ReactNode;
}

const CustomSelect: React.FC<CustomSelectProps> = ({ options, selectedValue, onSelect, placeholder, disabled = false, icon }) => {
  const [isOpen, setIsOpen] = useState(false);
  const selectRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (selectRef.current && !selectRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleSelect = (value: string) => {
    onSelect(value);
    setIsOpen(false);
  };

  const selectedOption = options.find(opt => opt.value === selectedValue);

  return (
    <div className="relative" ref={selectRef}>
      <div className="relative">
        {icon && (
             <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
               {icon}
             </div>
        )}
        <button
            type="button"
            onClick={() => !disabled && setIsOpen(!isOpen)}
            className={`w-full flex items-center justify-between pl-10 pr-4 py-2 text-sm text-left rounded-lg border border-slate-300 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500
            ${disabled ? 'bg-slate-50 cursor-not-allowed' : 'hover:bg-slate-50'}`}
            aria-haspopup="true"
            aria-expanded={isOpen}
            disabled={disabled}
        >
            {selectedOption ? (
                 <span className="flex items-center gap-3">
                    {selectedOption.Icon && selectedOption.bgColor && (
                        <span className={`w-6 h-6 rounded-md flex items-center justify-center ${selectedOption.bgColor}`}>
                            <selectedOption.Icon className={`w-4 h-4 ${selectedOption.color}`} />
                        </span>
                    )}
                    <span className="text-slate-900">{selectedOption.label}</span>
                </span>
            ) : (
                <span className="text-slate-400">{placeholder}</span>
            )}
            <ChevronDownIcon className={`w-5 h-5 text-slate-500 transition-transform duration-200 ${isOpen ? 'transform rotate-180' : ''}`} />
        </button>
      </div>

      {isOpen && !disabled && (
        <div className="absolute z-10 mt-1 w-full bg-white rounded-md shadow-lg border border-slate-200 max-h-60 overflow-y-auto">
          <ul className="py-1">
            {options.map((option) => {
              const isSelected = selectedValue === option.value;
              return (
                <li key={option.value}>
                  <button
                    onClick={() => handleSelect(option.value)}
                    className={`w-full text-left px-4 py-2 text-sm flex items-center gap-3 transition-colors ${
                      isSelected ? 'bg-indigo-500 text-white' : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                     {option.Icon && option.bgColor && (
                        <span className={`w-6 h-6 rounded-md flex items-center justify-center ${isSelected ? 'bg-white/20' : option.bgColor}`}>
                            <option.Icon className={`w-4 h-4 ${isSelected ? 'text-white' : option.color}`} />
                        </span>
                     )}
                    {option.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
};

export default CustomSelect;
```


---

## `./components/Dashboard.tsx`

```tsx

import React, { useMemo, useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Sector } from 'recharts';
import { Expense } from '../types';
import { formatCurrency } from './icons/formatters';
import { getCategoryStyle } from '../utils/categoryStyles';
import { useTapBridge } from '../hooks/useTapBridge';
import { ChevronLeftIcon } from './icons/ChevronLeftIcon';
import { ChevronRightIcon } from './icons/ChevronRightIcon';

const categoryHexColors: Record<string, string> = {
    'Alimentari': '#16a34a', // green-600
    'Trasporti': '#2563eb', // blue-600
    'Casa': '#ea580c', // orange-600
    'Shopping': '#db2777', // pink-600
    'Tempo Libero': '#9333ea', // purple-600
    'Salute': '#dc2626', // red-600
    'Istruzione': '#ca8a04', // yellow-600
    'Lavoro': '#4f46e5', // indigo-600
    'Altro': '#4b5563', // gray-600
};
const DEFAULT_COLOR = '#4b5563';

const renderActiveShape = (props: any) => {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill, payload, percent } = props;

  if (!payload) return null;

  return (
    <g>
      <text x={cx} y={cy - 12} textAnchor="middle" fill="#1e293b" className="text-base font-bold">
        {payload.name}
      </text>
      <text x={cx} y={cy + 12} textAnchor="middle" fill={fill} className="text-xl font-extrabold">
        {formatCurrency(payload.value)}
      </text>
      <text x={cx} y={cy + 32} textAnchor="middle" fill="#64748b" className="text-xs">
        {`(${(percent * 100).toFixed(2)}%)`}
      </text>
      
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={innerRadius}
        outerRadius={outerRadius + 6}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
        stroke="none"
      />
    </g>
  );
};

interface DashboardProps {
  expenses: Expense[];
  recurringExpenses: Expense[];
  onNavigateToRecurring: () => void;
  onNavigateToHistory: () => void;
}

const parseLocalYYYYMMDD = (s: string): Date => {
  const p = s.split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
};

const toYYYYMMDD = (date: Date) => date.toISOString().split('T')[0];

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

type ViewMode = 'weekly' | 'monthly' | 'yearly';

const Dashboard: React.FC<DashboardProps> = ({ expenses, recurringExpenses, onNavigateToRecurring, onNavigateToHistory }) => {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('monthly');
  const tapBridge = useTapBridge();
  const activeIndex = selectedIndex;

  const handleLegendItemClick = (index: number, event: React.MouseEvent) => {
    event.stopPropagation();
    setSelectedIndex(current => (current === index ? null : index));
  };
  
  const handleChartBackgroundClick = () => {
    setSelectedIndex(null);
  };

  const cycleViewMode = (direction: 'prev' | 'next') => {
    setViewMode(prev => {
      if (direction === 'next') {
        if (prev === 'weekly') return 'monthly';
        if (prev === 'monthly') return 'yearly';
        return 'weekly';
      } else {
        if (prev === 'weekly') return 'yearly';
        if (prev === 'monthly') return 'weekly';
        return 'monthly';
      }
    });
    setSelectedIndex(null); // Reset selection on view change
  };

  const { totalExpenses, dailyTotal, categoryData, recurringCountInPeriod, periodLabel } = useMemo(() => {
    const validExpenses = expenses.filter(e => e.amount != null && !isNaN(Number(e.amount)));
    const now = new Date();
    
    // Calculate Daily Total regardless of view mode
    const todayString = now.toISOString().split('T')[0];
    const daily = validExpenses
        .filter(expense => expense.date === todayString)
        .reduce((acc, expense) => acc + Number(expense.amount), 0);

    let start: Date, end: Date, label: string;

    if (viewMode === 'weekly') {
        const day = now.getDay(); // 0 is Sunday
        const diff = now.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
        start = new Date(now);
        start.setDate(diff);
        start.setHours(0, 0, 0, 0);
        
        end = new Date(start);
        end.setDate(start.getDate() + 6);
        end.setHours(23, 59, 59, 999);
        
        label = "Spesa Settimanale";
    } else if (viewMode === 'yearly') {
        start = new Date(now.getFullYear(), 0, 1);
        end = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
        label = "Spesa Annuale";
    } else {
        // Monthly default
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
        label = "Spesa Mensile";
    }
    
    const periodExpenses = validExpenses.filter(e => {
        const expenseDate = parseLocalYYYYMMDD(e.date);
        return expenseDate >= start && expenseDate <= end;
    });
        
    const total = periodExpenses.reduce((acc, expense) => acc + Number(expense.amount), 0);
    
    // Calculate recurring expenses in this period
    let recurringCount = 0;
    recurringExpenses.forEach(template => {
        if (!template.date) return;

        let nextDue = parseLocalYYYYMMDD(template.date);
        const totalGenerated = expenses.filter(e => e.recurringExpenseId === template.id).length;
        let generatedThisRun = 0;

        while (nextDue) {
            if (nextDue > end) {
                break;
            }

            if (template.recurrenceEndType === 'date' && template.recurrenceEndDate && toYYYYMMDD(nextDue) > template.recurrenceEndDate) {
                break;
            }
            if (template.recurrenceEndType === 'count' && template.recurrenceCount && (totalGenerated + generatedThisRun) >= template.recurrenceCount) {
                break;
            }

            if (nextDue >= start) {
                recurringCount++;
                generatedThisRun++;
            }
            
            nextDue = calculateNextDueDate(template, nextDue);
        }
    });
        
    const categoryTotals = periodExpenses.reduce((acc: Record<string, number>, expense) => {
      const category = expense.category || 'Altro';
      acc[category] = (acc[category] || 0) + Number(expense.amount);
      return acc;
    }, {} as Record<string, number>);

    const sortedCategoryData = Object.entries(categoryTotals)
        .map(([name, value]) => ({ name, value: value as number }))
        .sort((a, b) => b.value - a.value);

    return { 
        totalExpenses: total, 
        dailyTotal: daily,
        categoryData: sortedCategoryData,
        recurringCountInPeriod: recurringCount,
        periodLabel: label
    };
  }, [expenses, recurringExpenses, viewMode]);
  
  return (
    <div className="p-4 md:p-6 space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-1 bg-white p-6 rounded-2xl shadow-lg flex flex-col justify-between">
                <div>
                    <div className="flex justify-between items-center mb-4">
                        <button 
                            onClick={() => cycleViewMode('prev')}
                            className="p-2 rounded-full hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition-colors"
                        >
                            <ChevronLeftIcon className="w-5 h-5" />
                        </button>
                        
                        <h3 className="text-xl font-bold text-slate-700 text-center flex-1">{periodLabel}</h3>

                        <button 
                            onClick={() => cycleViewMode('next')}
                            className="p-2 rounded-full hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition-colors"
                        >
                            <ChevronRightIcon className="w-5 h-5" />
                        </button>
                    </div>
                    <div className="flex justify-between items-baseline">
                        <p className="text-4xl font-extrabold text-indigo-600">{formatCurrency(totalExpenses)}</p>
                        {recurringCountInPeriod > 0 && (
                            <span className="text-base font-bold text-slate-600 bg-slate-100 px-2.5 py-1 rounded-lg" title={`${recurringCountInPeriod} spese programmate previste in questo periodo`}>
                                {recurringCountInPeriod} P
                            </span>
                        )}
                    </div>
                </div>
                <div className="mt-4 pt-4 border-t border-slate-200">
                    <div>
                        <h4 className="text-sm font-medium text-slate-500">Oggi</h4>
                        <p className="text-xl font-bold text-slate-800">{formatCurrency(dailyTotal)}</p>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3">
                        <button
                            onClick={onNavigateToRecurring}
                            style={{ touchAction: 'manipulation' }}
                            className="flex items-center justify-center py-2 px-3 text-center font-semibold text-slate-900 bg-amber-100 rounded-xl hover:bg-amber-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-amber-500 transition-all border border-amber-400"
                            {...tapBridge}
                        >
                            <span className="text-sm">S. Programmate</span>
                        </button>

                        <button
                            onClick={onNavigateToHistory}
                            style={{ touchAction: 'manipulation' }}
                            className="flex items-center justify-center py-2 px-3 text-center font-semibold text-slate-900 bg-amber-100 rounded-xl hover:bg-amber-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-amber-500 transition-all border border-amber-400"
                            {...tapBridge}
                        >
                            <span className="text-sm">Storico Spese</span>
                        </button>
                    </div>
                </div>
            </div>

            <div className="lg:col-span-2 bg-white p-6 rounded-2xl shadow-lg flex flex-col">
                <h3 className="text-xl font-bold text-slate-700 mb-4">Riepilogo Categorie</h3>
                {categoryData.length > 0 ? (
                    <div className="space-y-4 flex-grow">
                        {categoryData.map(cat => {
                            const style = getCategoryStyle(cat.name);
                            const percentage = totalExpenses > 0 ? (cat.value / totalExpenses) * 100 : 0;
                            return (
                                <div key={cat.name} className="flex items-center gap-4 text-base">
                                    <span className={`w-10 h-10 rounded-xl flex items-center justify-center ${style.bgColor}`}>
                                        <style.Icon className={`w-6 h-6 ${style.color}`} />
                                    </span>
                                    <div className="flex-grow">
                                        <div className="flex justify-between items-center mb-1">
                                            <span className="font-semibold text-slate-700">{style.label}</span>
                                            <span className="font-bold text-slate-800">{formatCurrency(cat.value)}</span>
                                        </div>
                                        <div className="w-full bg-slate-200 rounded-full h-2.5">
                                            <div className="bg-indigo-500 h-2.5 rounded-full" style={{ width: `${percentage}%` }}></div>
                                        </div>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                ) : <p className="text-center text-slate-500 flex-grow flex items-center justify-center">Nessuna spesa registrata.</p>}
            </div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-lg">
            <h3 className="text-xl font-bold text-slate-700 mb-2 text-center">Spese per Categoria</h3>
            {categoryData.length > 0 ? (
                <div className="relative cursor-pointer" onClick={handleChartBackgroundClick}>
                    <ResponsiveContainer width="100%" height={300}>
                        <PieChart>
                        <Pie
                            data={categoryData}
                            cx="50%"
                            cy="50%"
                            innerRadius={68}
                            outerRadius={102}
                            fill="#8884d8"
                            paddingAngle={2}
                            dataKey="value"
                            nameKey="name"
                            activeIndex={activeIndex ?? undefined}
                            activeShape={renderActiveShape}
                        >
                            {categoryData.map((entry) => (
                            <Cell key={`cell-${entry.name}`} fill={categoryHexColors[entry.name] || DEFAULT_COLOR} />
                            ))}
                        </Pie>
                        </PieChart>
                    </ResponsiveContainer>
                    {activeIndex === null && (
                        <div className="absolute inset-0 flex flex-col justify-center items-center pointer-events-none">
                            <span className="text-slate-500 text-sm">Totale Periodo</span>
                            <span className="text-2xl font-extrabold text-slate-800 mt-1">
                                {formatCurrency(totalExpenses)}
                            </span>
                        </div>
                    )}
                </div>
            ) : <p className="text-center text-slate-500 py-16">Nessun dato da visualizzare.</p>}

            {categoryData.length > 0 && (
                <div className="mt-4 pt-4 border-t border-slate-200">
                    <div className="flex flex-wrap justify-center gap-x-4 gap-y-3">
                    {categoryData.map((entry, index) => {
                        const style = getCategoryStyle(entry.name);
                        return (
                        <button
                            key={`item-${index}`}
                            onClick={(e) => handleLegendItemClick(index, e)}
                            style={{ touchAction: 'manipulation' }}
                            data-legend-item
                            className={`flex items-center gap-3 p-2 rounded-full text-left transition-all duration-200 bg-slate-100 hover:bg-slate-200`}
                        >
                            <span className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${style.bgColor}`}>
                                <style.Icon className={`w-4 h-4 ${style.color}`} />
                            </span>
                            <div className="min-w-0 pr-2">
                                <p className={`font-semibold text-sm truncate text-slate-700`}>{style.label}</p>
                            </div>
                        </button>
                        );
                    })}
                    </div>
                </div>
            )}
        </div>
    </div>
  );
};

export default Dashboard;

```


---

## `./components/DateRangePickerModal.tsx`

```tsx
import React, { useState, useEffect } from 'react';
import { XMarkIcon } from './icons/XMarkIcon';
import { CalendarIcon } from './icons/CalendarIcon';

interface DateRangePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (range: { start: string, end: string }) => void;
  initialRange: { start: string | null, end: string | null };
}

export const DateRangePickerModal: React.FC<DateRangePickerModalProps> = ({ isOpen, onClose, onApply, initialRange }) => {
  const [start, setStart] = useState(initialRange.start || '');
  const [end, setEnd] = useState(initialRange.end || '');
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setStart(initialRange.start || '');
      setEnd(initialRange.end || '');
      // Piccola attesa per permettere il mount prima dell'animazione
      const timer = setTimeout(() => setIsAnimating(true), 10);
      return () => clearTimeout(timer);
    } else {
      setIsAnimating(false);
    }
  }, [isOpen, initialRange]);

  const handleApply = () => {
    if (start && end) {
      onApply({ start, end });
    }
  };

  const handleBackdropClick = () => {
    setIsAnimating(false);
    setTimeout(onClose, 300);
  };

  if (!isOpen && !isAnimating) return null;

  return (
    <div
      className={`fixed inset-0 z-[60] flex justify-center items-center p-4 transition-opacity duration-300 ease-in-out ${isAnimating ? 'opacity-100' : 'opacity-0'} bg-slate-900/60 backdrop-blur-sm`}
      onClick={handleBackdropClick}
      aria-modal="true"
      role="dialog"
    >
      <div
        className={`bg-white rounded-lg shadow-xl w-full max-w-sm transform transition-all duration-300 ease-in-out ${isAnimating ? 'scale-100 opacity-100' : 'scale-95 opacity-0'}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="flex justify-between items-center p-4 border-b border-slate-200">
          <h2 className="text-lg font-bold text-slate-800">Seleziona Periodo</h2>
          <button
            type="button"
            onClick={handleBackdropClick}
            className="text-slate-500 hover:text-slate-800 transition-colors p-1 rounded-full hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            aria-label="Chiudi"
          >
            <XMarkIcon className="w-6 h-6" />
          </button>
        </header>

        {/* Body */}
        <div className="p-6 space-y-5">
          <div>
            <label htmlFor="start-date" className="block text-sm font-medium text-slate-700 mb-1">Dal</label>
            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                <CalendarIcon className="h-5 w-5 text-slate-400" />
              </div>
              <input
                type="date"
                id="start-date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="block w-full rounded-md border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div>
            <label htmlFor="end-date" className="block text-sm font-medium text-slate-700 mb-1">Al</label>
            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                <CalendarIcon className="h-5 w-5 text-slate-400" />
              </div>
              <input
                type="date"
                id="end-date"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="block w-full rounded-md border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="p-4 bg-slate-100 border-t border-slate-200 flex justify-end gap-3 rounded-b-lg">
          <button
            type="button"
            onClick={handleBackdropClick}
            className="px-4 py-2 text-sm font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg shadow-sm hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-colors"
          >
            Annulla
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={!start || !end}
            className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-colors disabled:bg-indigo-300 disabled:cursor-not-allowed"
          >
            Applica
          </button>
        </footer>
      </div>
    </div>
  );
};

```


---

## `./components/EdgeSwipeCatcher.tsx`

```tsx

```


---

## `./components/ExpenseForm.tsx`

```tsx

// ExpenseForm.tsx
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
          onClick={(e) => { e.stopPropagation(); onClick(); }}
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

```


---

## `./components/ExpenseList.tsx`

```tsx

```


---

## `./components/FilterToggle.tsx`

```tsx
import React from 'react';

interface FilterToggleProps<T extends string> {
  options: { value: T; label: string }[];
  activeOption: T;
  onSelect: (option: T) => void;
}

const FilterToggle = <T extends string>({ options, activeOption, onSelect }: FilterToggleProps<T>) => {
  return (
    <div className="bg-slate-200 p-1 rounded-lg flex items-center w-full">
      {options.map(option => (
        <button
          key={option.value}
          onClick={() => onSelect(option.value)}
          className={`w-full py-1.5 px-2 text-sm font-semibold rounded-md transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2 focus:ring-offset-slate-100
            ${activeOption === option.value ? 'bg-white text-indigo-600 shadow' : 'bg-transparent text-slate-600 hover:bg-slate-300/50'}
          `}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
};

export default FilterToggle;
```


---

## `./components/FloatingActionButton.tsx`

```tsx
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
```


---

## `./components/Header.tsx`

```tsx

import React from 'react';
import { PhotoIcon } from './icons/PhotoIcon';
import { ArrowDownOnSquareIcon } from './icons/ArrowDownOnSquareIcon';
import { LockClosedIcon } from './icons/LockClosedIcon';

interface HeaderProps {
    pendingSyncs: number;
    isOnline: boolean;
    onInstallClick: () => void;
    installPromptEvent: any;
    onLogout: () => void;
}

const Header: React.FC<HeaderProps> = ({ pendingSyncs, isOnline, onInstallClick, installPromptEvent, onLogout }) => {
  return (
    <header className="bg-white shadow-md sticky top-0 z-20">
      <div>
        <div className="py-2 flex items-center justify-between gap-3 px-4 md:px-8 h-[58px]">
          <h1 className="text-xl font-bold text-slate-800">Gestore Spese</h1>
          <div className="flex items-center gap-4">
              {!isOnline && (
                  <div className="flex items-center gap-2 text-sm font-semibold text-amber-600 bg-amber-100 px-3 py-1.5 rounded-full">
                      <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-500 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                      </span>
                      <span className="hidden sm:inline">Offline</span>
                  </div>
              )}
              {pendingSyncs > 0 && (
                  <div className="flex items-center gap-2 text-sm font-semibold text-indigo-600 bg-indigo-100 px-3 py-1.5 rounded-full" title={`${pendingSyncs} immagini in attesa di analisi`}>
                      <PhotoIcon className="w-5 h-5" />
                      <span>{pendingSyncs}</span>
                  </div>
              )}
              {installPromptEvent && (
                  <button
                      onClick={onInstallClick}
                      className="flex items-center gap-2 text-sm font-semibold text-indigo-600 bg-indigo-100 px-3 py-1.5 rounded-full hover:bg-indigo-200 transition-colors"
                      aria-label="Installa App"
                      title="Installa App"
                  >
                      <ArrowDownOnSquareIcon className="w-5 h-5" />
                      <span className="hidden sm:inline">Installa</span>
                  </button>
              )}
              <button
                  onClick={onLogout}
                  className="p-2 text-slate-500 hover:text-indigo-600 hover:bg-indigo-100 rounded-full transition-colors"
                  aria-label="Logout"
                  title="Logout"
              >
                  <LockClosedIcon className="w-6 h-6" />
              </button>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;

```


---

## `./components/HistoryFilterCard.tsx`

```tsx
import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useLayoutEffect,
  useMemo,
} from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeftIcon } from './icons/ChevronLeftIcon';
import { ChevronRightIcon } from './icons/ChevronRightIcon';
import { ChevronDownIcon } from './icons/ChevronDownIcon';
import { CreditCardIcon } from './icons/CreditCardIcon';
import { TagIcon } from './icons/TagIcon';
import { CurrencyEuroIcon } from './icons/CurrencyEuroIcon';
import { MagnifyingGlassIcon } from './icons/MagnifyingGlassIcon';
import { useTapBridge } from '../hooks/useTapBridge';
import SmoothPullTab from './SmoothPullTab';
import { Account, CATEGORIES } from '../types';
import { getCategoryStyle } from '../utils/categoryStyles';
import { ArrowLeftIcon } from './icons/ArrowLeftIcon';
import { CheckIcon } from './icons/CheckIcon';

type DateFilter = 'all' | '7d' | '30d' | '6m' | '1y';
type PeriodType = 'day' | 'week' | 'month' | 'year';

// Internal View State for the panel content
type PanelView = 'main' | 'account_selection' | 'category_selection';

interface HistoryFilterCardProps {
  // Date Filters
  onSelectQuickFilter: (value: DateFilter) => void;
  currentQuickFilter: DateFilter;
  onCustomRangeChange: (range: { start: string | null; end: string | null }) => void;
  currentCustomRange: { start: string | null; end: string | null };
  isCustomRangeActive: boolean;
  onDateModalStateChange: (isOpen: boolean) => void;
  isActive: boolean; // true SOLO nella pagina "Storico"
  onSelectPeriodType: (type: PeriodType) => void;
  onSetPeriodDate: (date: Date) => void;
  periodType: PeriodType;
  periodDate: Date;
  onActivatePeriodFilter: () => void;
  isPeriodFilterActive: boolean;
  onOpenStateChange: (isOpen: boolean) => void;

  // Expanded Filters
  accounts: Account[];
  selectedAccountId: string | null;
  onSelectAccount: (id: string | null) => void;
  
  // Multi-Select Categories
  selectedCategoryFilters: Set<string>;
  onToggleCategoryFilter: (key: string) => void;
  onClearCategoryFilters: () => void;
  
  descriptionQuery: string;
  onDescriptionChange: (text: string) => void;
  amountRange: { min: string; max: string };
  onAmountRangeChange: (range: { min: string; max: string }) => void;
}

/* -------------------- Checkbox Component -------------------- */
const Checkbox: React.FC<{ checked: boolean; onChange: () => void }> = ({ checked, onChange }) => (
    <div 
        className={`w-6 h-6 rounded border flex items-center justify-center transition-colors cursor-pointer ${checked ? 'bg-indigo-600 border-black' : 'bg-white border-black'}`}
        onClick={(e) => { e.stopPropagation(); onChange(); }}
    >
        {checked && <CheckIcon className="w-4 h-4 text-white" strokeWidth={3} />}
    </div>
);


/* -------------------- QuickFilterControl -------------------- */
const QuickFilterControl: React.FC<{
  onSelect: (value: DateFilter) => void;
  currentValue: DateFilter;
  isActive: boolean;
}> = ({ onSelect, currentValue, isActive }) => {
  const filters: { value: DateFilter; label: string }[] = [
    { value: '7d', label: '7G' },
    { value: '30d', label: '30G' },
    { value: '6m', label: '6M' },
    { value: '1y', label: '1A' },
  ];

  return (
    <div
      className={
        'w-full h-10 flex border rounded-lg overflow-hidden transition-colors ' +
        (isActive ? 'border-indigo-600' : 'border-slate-400')
      }
    >
      {filters.map((f, i) => {
        const active = isActive && currentValue === f.value;
        return (
          <button
            key={f.value}
            onClick={() => onSelect(f.value)}
            type="button"
            className={
              'flex-1 flex items-center justify-center px-2 text-center font-semibold text-sm transition-colors duration-200 focus:outline-none ' +
              (i > 0 ? 'border-l ' : '') +
              (active
                ? 'bg-indigo-600 text-white border-indigo-600'
                : `bg-slate-100 text-slate-700 hover:bg-slate-200 ${
                    isActive ? 'border-indigo-600' : 'border-slate-400'
                  }`)
            }
          >
            {f.label}
          </button>
        );
      })}
    </div>
  );
};

/* -------------------- CustomDateRangeInputs -------------------- */
const CustomDateRangeInputs: React.FC<{
  range: { start: string | null; end: string | null };
  onChange: (range: { start: string | null; end: string | null }) => void;
  isActive: boolean;
}> = ({ range, onChange, isActive }) => {
  const textColor = isActive ? 'text-indigo-700' : 'text-slate-700';
  const textSize = 'text-sm font-semibold';

  const formatDate = (iso: string) => {
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString('it-IT', {
      day: 'numeric',
      month: 'short',
      year: '2-digit'
    });
  };

  const handleChange = (field: 'start' | 'end', value: string) => {
      onChange({ ...range, [field]: value || null });
  };

  const handleInputClick = (e: React.MouseEvent<HTMLInputElement>) => {
    try {
      if (typeof (e.currentTarget as any).showPicker === 'function') {
        (e.currentTarget as any).showPicker();
      }
    } catch (err) {
      // Ignore
    }
  };

  return (
    <div
      className={
        'w-full h-10 flex border rounded-lg overflow-hidden transition-colors relative ' +
        (isActive ? 'border-indigo-600 bg-indigo-50' : 'border-slate-400 bg-slate-100')
      }
    >
      <label className="relative flex-1 h-full group cursor-pointer block">
         <div className={`absolute inset-0 flex items-center justify-center z-0 pointer-events-none ${textSize} ${textColor}`}>
            {range.start ? formatDate(range.start) : 'Dal'}
         </div>
         <input
          type="date"
          value={range.start || ''}
          onChange={(e) => handleChange('start', e.target.value)}
          onClick={handleInputClick}
          onBlur={(e) => e.target.blur()}
          className="absolute inset-0 w-full h-full opacity-0 z-20 cursor-pointer"
          style={{ touchAction: 'none' }}
        />
      </label>
      <div className={`w-px my-1 ${isActive ? 'bg-indigo-200' : 'bg-slate-300'}`} />
      <label className="relative flex-1 h-full group cursor-pointer block">
        <div className={`absolute inset-0 flex items-center justify-center z-0 pointer-events-none ${textSize} ${textColor}`}>
            {range.end ? formatDate(range.end) : 'Al'}
         </div>
         <input
          type="date"
          value={range.end || ''}
          onChange={(e) => handleChange('end', e.target.value)}
          onClick={handleInputClick}
          onBlur={(e) => e.target.blur()}
          className="absolute inset-0 w-full h-full opacity-0 z-20 cursor-pointer"
          style={{ touchAction: 'none' }}
        />
      </label>
    </div>
  );
};

/* -------------------- PeriodNavigator -------------------- */
const PeriodNavigator: React.FC<{
  periodType: PeriodType;
  periodDate: Date;
  onTypeChange: (type: PeriodType) => void;
  onDateChange: (date: Date) => void;
  isActive: boolean;
  onActivate: () => void;
  isMenuOpen: boolean;
  onMenuToggle: (isOpen: boolean) => void;
  isPanelOpen: boolean;
}> = ({
  periodType,
  periodDate,
  onTypeChange,
  onDateChange,
  isActive,
  onActivate,
  isMenuOpen,
  onMenuToggle,
  isPanelOpen,
}) => {
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (ev: PointerEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(ev.target as Node)) {
        onMenuToggle(false);
      }
    };
    if (isMenuOpen) {
      document.addEventListener('pointerdown', handler, { capture: true });
    }
    return () => {
      document.removeEventListener(
        'pointerdown',
        handler as any,
        { capture: true } as any,
      );
    };
  }, [isMenuOpen, onMenuToggle]);

  const step = (sign: 1 | -1) => {
    onActivate();
    const d = new Date(periodDate);
    if (periodType === 'day') d.setDate(d.getDate() + sign);
    else if (periodType === 'week') d.setDate(d.getDate() + 7 * sign);
    else if (periodType === 'month') d.setMonth(d.getMonth() + sign);
    else d.setFullYear(d.getFullYear() + sign);
    onDateChange(d);
  };

  const label = (() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    const s = new Date(periodDate);
    s.setHours(0, 0, 0, 0);

    if (periodType === 'day') {
      if (+s === +t) return 'Oggi';
      const y = new Date(t);
      y.setDate(t.getDate() - 1);
      if (+s === +y) return 'Ieri';
      return periodDate
        .toLocaleDateString('it-IT', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })
        .replace('.', '');
    }

    if (periodType === 'month') {
      const cm = t.getMonth();
      const cy = t.getFullYear();
      if (periodDate.getMonth() === cm && periodDate.getFullYear() === cy)
        return 'Questo Mese';
      const pm = cm === 0 ? 11 : cm - 1;
      const py = cm === 0 ? cy - 1 : cy;
      if (periodDate.getMonth() === pm && periodDate.getFullYear() === py)
        return 'Mese Scorso';
      return periodDate.toLocaleDateString('it-IT', {
        month: 'long',
        year: 'numeric',
      });
    }

    if (periodType === 'year') {
      if (periodDate.getFullYear() === t.getFullYear()) return "Quest'Anno";
      if (periodDate.getFullYear() === t.getFullYear() - 1) return 'Anno Scorso';
      return String(periodDate.getFullYear());
    }

    // week
    const sow = new Date(periodDate);
    const day = sow.getDay();
    const diff = sow.getDate() - day + (day === 0 ? -6 : 1);
    sow.setDate(diff);
    sow.setHours(0, 0, 0, 0);

    const eow = new Date(sow);
    eow.setDate(sow.getDate() + 6);

    const tsow = new Date(t);
    const tday = tsow.getDay();
    const tdiff = tsow.getDate() - tday + (tday === 0 ? -6 : 1);
    tsow.setDate(tdiff);
    tsow.setHours(0, 0, 0, 0);

    if (+sow === +tsow) return 'Questa Settimana';
    const last = new Date(tsow);
    last.setDate(tsow.getDate() - 7);
    if (+sow === +last) return 'Settimana Scorsa';

    return `${sow.toLocaleDateString('it-IT', {
      day: 'numeric',
      month: 'short',
    })} - ${eow.toLocaleDateString('it-IT', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })}`;
  })();

  return (
    <div
      ref={wrapperRef}
      className={
        'relative w-full h-10 flex items-center justify-between border rounded-lg bg-white ' +
        (isActive ? 'border-indigo-600' : 'border-slate-400')
      }
    >
      <button
        onClick={() => step(-1)}
        type="button"
        className="h-full px-4 hover:bg-slate-100 rounded-l-lg"
        aria-label="Periodo precedente"
      >
        <ChevronLeftIcon className="w-5 h-5 text-slate-700" />
      </button>
      <button
        onClick={() => onMenuToggle(!isMenuOpen)}
        type="button"
        className={
          'flex-1 h-full text-sm font-semibold ' +
          (isActive
            ? 'bg-indigo-100 text-indigo-700'
            : 'bg-slate-100 text-slate-700') +
          ' hover:bg-slate-200'
        }
      >
        {label}
      </button>
      <button
        onClick={() => step(+1)}
        type="button"
        className="h-full px-4 hover:bg-slate-100 rounded-r-lg"
        aria-label="Periodo successivo"
      >
        <ChevronRightIcon className="w-5 h-5 text-slate-700" />
      </button>

      {isMenuOpen && (
        <div
          className={`absolute left-0 right-0 mx-auto w-40 bg-white border border-slate-200 shadow-lg rounded-lg z-[1000] p-2 space-y-1 ${
            isPanelOpen ? 'top-full mt-1' : 'bottom-full mb-2'
          }`}
        >
          {(['day', 'week', 'month', 'year'] as PeriodType[]).map((v) => (
            <button
              key={v}
              onClick={(e) => {
                e.stopPropagation();
                onActivate();
                onTypeChange(v);
                onMenuToggle(false);
              }}
              type="button"
              className={
                'w-full text-left px-4 py-2 text-sm font-semibold rounded-lg ' +
                (isActive && periodType === v
                  ? 'bg-indigo-100 text-indigo-800'
                  : 'bg-slate-50 text-slate-800 hover:bg-slate-200')
              }
            >
              {v === 'day'
                ? 'Giorno'
                : v === 'week'
                ? 'Settimana'
                : v === 'month'
                ? 'Mese'
                : 'Anno'}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/* -------------------- HistoryFilterCard (bottom sheet) -------------------- */

export const PEEK_PX = 70;

export const HistoryFilterCard: React.FC<HistoryFilterCardProps> = (props) => {
  const [isPeriodMenuOpen, setIsPeriodMenuOpen] = useState(false);
  const [activeViewIndex, setActiveViewIndex] = useState(0);
  
  // --- Internal Navigation State ---
  const [currentView, setCurrentView] = useState<PanelView>('main');
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  const tapBridge = useTapBridge();

  // Altezza pannello dinamica in base alla view
  const OPEN_HEIGHT_VH = currentView === 'category_selection' ? 92 : 40; 
  
  const [openHeight, setOpenHeight] = useState(0);
  const [closedY, setClosedY] = useState(0);
  const [translateY, setTranslateY] = useState(0);
  const [laidOut, setLaidOut] = useState(false);
  const [anim, setAnim] = useState(false);
  
  // Track if panel is open for resize logic
  const isPanelOpenRef = useRef(false);

  // Stato swipe orizzontale
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isSwipeAnimating, setIsSwipeAnimating] = useState(false);
  
  const isPanelOpen = laidOut && translateY < (closedY || 0) / 2;

  // Update ref whenever calculation updates
  useEffect(() => {
     isPanelOpenRef.current = isPanelOpen;
  }, [isPanelOpen]);

  // Reset view when user swipes to another filter "tab" (Quick/Period/Custom)
  useEffect(() => {
    setIsPeriodMenuOpen(false);
  }, [activeViewIndex]);

  // Initialize state for category accordion based on first selected category (optional)
  useEffect(() => {
    // Only expand on first load if exactly one category is selected to avoid clutter
    if (currentView === 'category_selection' && props.selectedCategoryFilters.size === 1 && expandedCategory === null) {
        const selected = Array.from(props.selectedCategoryFilters)[0] as string;
        const [cat] = selected.split(':');
        if (CATEGORIES[cat] && CATEGORIES[cat].length > 0) {
            setExpandedCategory(cat);
        }
    }
  }, [currentView, props.selectedCategoryFilters, expandedCategory]);

  // drag stato unificato (verticale e orizzontale)
  const dragRef = useRef<{
    active: boolean;
    direction: 'none' | 'vertical' | 'horizontal';
    startX: number;
    startY: number;
    startTranslateY: number; // per verticale
    lastY: number;
    lastT: number;
  }>({
    active: false,
    direction: 'none',
    startX: 0,
    startY: 0,
    startTranslateY: 0,
    lastY: 0,
    lastT: 0,
  });

  // misura e calcola posizione chiusa
  useLayoutEffect(() => {
    if (!props.isActive) {
      setLaidOut(false);
      return;
    }

    const update = () => {
      const vh = typeof window !== 'undefined' ? window.innerHeight : 0;
      const oh = (OPEN_HEIGHT_VH / 100) * vh;
      const closed = Math.max(oh - PEEK_PX, 0);

      setOpenHeight(oh);
      setClosedY(closed);

      setTranslateY((prev) => {
        if (!laidOut) {
            return closed; 
        }
        
        // Robust check: if it was open before resize, keep it open (0).
        if (isPanelOpenRef.current) {
            return 0;
        } else {
            return closed;
        }
      });

      setLaidOut(true);
    };

    update();
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('resize', update);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.isActive, OPEN_HEIGHT_VH]);

  const SPEED = 0.05;
  const MIN_TOGGLE_DRAG = 10;

  const clampY = useCallback(
    (y: number) => {
      const min = 0;
      const max = closedY || 0;
      return Math.max(min, Math.min(max, y));
    },
    [closedY],
  );

  const snapTo = useCallback(
    (vy: number, overridePos?: number) => {
      if (!laidOut) return;
      const max = closedY || 0;
      const currentPos =
        typeof overridePos === 'number' ? clampY(overridePos) : clampY(translateY);
      const ratio = max > 0 ? currentPos / max : 1;

      let target: number;
      if (vy <= -SPEED) {
        target = 0;
      } else if (vy >= SPEED) {
        target = max;
      } else {
        target = ratio < 0.5 ? 0 : max;
      }

      setAnim(true);
      setTranslateY(target);
    },
    [closedY, translateY, laidOut, SPEED, clampY],
  );

  const { onOpenStateChange } = props;
  useEffect(() => {
    onOpenStateChange(isPanelOpen);
  }, [isPanelOpen, onOpenStateChange]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!props.isActive) return;
    if ((e.target as HTMLElement).closest('[data-no-drag]')) return;

    tapBridge.onPointerDown(e as any);

    dragRef.current = {
      active: true,
      direction: 'none',
      startX: e.clientX,
      startY: e.clientY,
      startTranslateY: translateY,
      lastY: e.clientY,
      lastT: performance.now(),
    };

    if (anim) setAnim(false);
    if (isSwipeAnimating) setIsSwipeAnimating(false);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    tapBridge.onPointerMove(e as any);
    if (!props.isActive) return;

    const d = dragRef.current;
    if (!d.active) return;

    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;

    if (d.direction === 'none') {
      const dist2 = dx * dx + dy * dy;
      if (dist2 < 100) return; 
      
      if (Math.abs(dy) > Math.abs(dx)) {
        d.direction = 'vertical';
      } else {
        if (isPeriodMenuOpen || currentView !== 'main') { // Disable horizontal swipe in sub-views
            d.active = false;
            return;
        }
        d.direction = 'horizontal';
      }
    }

    if (d.direction === 'vertical') {
      if (e.cancelable) e.preventDefault();
      const now = performance.now();
      const newY = clampY(d.startTranslateY + dy);
      setTranslateY(newY);
      d.lastY = e.clientY;
      d.lastT = now;
    } else if (d.direction === 'horizontal') {
       if (e.cancelable) e.preventDefault();
       setSwipeOffset(dx);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    tapBridge.onPointerUp(e as any);
    const d = dragRef.current;
    
    if (!d.active) {
      d.direction = 'none';
      return;
    }

    d.active = false;

    if (d.direction === 'vertical') {
        const totalDy = e.clientY - d.startY;
        const startPos = d.startTranslateY;
        const max = closedY || 0;
        const endPos = clampY(startPos + totalDy);

        if (Math.abs(totalDy) >= MIN_TOGGLE_DRAG) {
            if (totalDy < 0 && startPos >= max * 0.7) {
                d.direction = 'none';
                setAnim(true);
                setTranslateY(0);
                return;
            }
            if (totalDy > 0 && startPos <= max * 0.3) {
                d.direction = 'none';
                setAnim(true);
                setTranslateY(max);
                return;
            }
        }

        const now = performance.now();
        const dt = Math.max(1, now - d.lastT);
        const vy = (e.clientY - d.lastY) / dt;
        snapTo(vy, endPos);
    } else if (d.direction === 'horizontal') {
        const dx = e.clientX - d.startX;
        const threshold = 40;
        
        if (dx < -threshold && activeViewIndex < 2) {
            setActiveViewIndex(prev => prev + 1);
        } else if (dx > threshold && activeViewIndex > 0) {
            setActiveViewIndex(prev => prev - 1);
        }
        
        setIsSwipeAnimating(true);
        setSwipeOffset(0);
    }

    d.direction = 'none';
  };

  const handlePointerCancel = (e: React.PointerEvent) => {
    tapBridge.onPointerCancel?.(e as any);
    const d = dragRef.current;
    d.active = false;
    d.direction = 'none';
    snapTo(0);
    setIsSwipeAnimating(true);
    setSwipeOffset(0);
  };

  const handleClickCapture = (e: React.MouseEvent) => {
    tapBridge.onClickCapture(e as any);
  };

  const handleQuickSelect = useCallback((v: DateFilter) => props.onSelectQuickFilter(v), [props]);
  const handlePeriodDateChange = useCallback((date: Date) => props.onSetPeriodDate(date), [props]);
  const handlePeriodTypeChange = useCallback((type: PeriodType) => props.onSelectPeriodType(type), [props]);
  const handleCustomRangeChange = useCallback((range: { start: string | null; end: string | null }) => props.onCustomRangeChange(range), [props]);

  const yForStyle = laidOut
    ? clampY(translateY)
    : openHeight || (typeof window !== 'undefined' ? (window.innerHeight * OPEN_HEIGHT_VH) / 100 : 0);
    
  const listTx = -activeViewIndex * (100 / 3);
  const listTransform = `translateX(calc(${listTx}% + ${swipeOffset}px))`;

  const isQuickFilterActive = !props.isPeriodFilterActive && !props.isCustomRangeActive;

  const selectedAccountLabel = props.selectedAccountId 
      ? props.accounts.find(a => a.id === props.selectedAccountId)?.name 
      : 'Conto';

  // Build the label for the Category Button
  const selectedCategoryLabel = useMemo(() => {
      const count = props.selectedCategoryFilters.size;
      if (count === 0) return 'Categoria';
      if (count === 1) {
          const key = Array.from(props.selectedCategoryFilters)[0] as string;
          const [cat, sub] = key.split(':');
          const style = getCategoryStyle(cat);
          if (sub) {
              return `${style.label}, ${sub}`;
          }
          return style.label;
      }
      return `${count} Categorie`;
  }, [props.selectedCategoryFilters]);
  
  const SelectedCategoryIcon = useMemo(() => {
      if (props.selectedCategoryFilters.size === 1) {
          const key = Array.from(props.selectedCategoryFilters)[0] as string;
          const [cat] = key.split(':');
          return getCategoryStyle(cat).Icon;
      }
      return TagIcon;
  }, [props.selectedCategoryFilters]);
      
  const handleCategoryClick = (cat: string) => {
      setExpandedCategory(prev => prev === cat ? null : cat);
  };

  // Reorganized Renders
  const renderHeaderInputs = () => (
    <div className="px-4 pb-2 space-y-3">
        {/* Search Description */}
        <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                <MagnifyingGlassIcon className="h-5 w-5 text-slate-400" />
            </div>
            <input 
                id="filter-desc"
                type="text"
                value={props.descriptionQuery}
                onChange={(e) => props.onDescriptionChange(e.target.value)}
                placeholder="Descrizione..."
                className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-10 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                {...tapBridge}
            />
        </div>

        {/* Amount Range Inputs - Min & Max */}
        <div className="flex gap-3">
             <div className="relative flex-1">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                    <CurrencyEuroIcon className={`h-5 w-5 ${props.amountRange.min ? 'text-indigo-600' : 'text-slate-400'}`} />
                </div>
                <input 
                    id="filter-amount-min"
                    type="number"
                    value={props.amountRange.min}
                    onChange={(e) => props.onAmountRangeChange({...props.amountRange, min: e.target.value})}
                    placeholder="Da"
                    className={`w-full rounded-lg border py-2 pl-10 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 ${props.amountRange.min ? 'bg-indigo-50 border-indigo-200 text-indigo-700 font-medium' : 'bg-white border-slate-300'}`}
                    {...tapBridge}
                />
            </div>
            <div className="relative flex-1">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                    <CurrencyEuroIcon className={`h-5 w-5 ${props.amountRange.max ? 'text-indigo-600' : 'text-slate-400'}`} />
                </div>
                <input 
                    id="filter-amount-max"
                    type="number"
                    value={props.amountRange.max}
                    onChange={(e) => props.onAmountRangeChange({...props.amountRange, max: e.target.value})}
                    placeholder="A"
                    className={`w-full rounded-lg border py-2 pl-10 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 ${props.amountRange.max ? 'bg-indigo-50 border-indigo-200 text-indigo-700 font-medium' : 'bg-white border-slate-300'}`}
                    {...tapBridge}
                />
            </div>
        </div>
    </div>
  );

  const renderBodyMain = () => (
    <div className="space-y-3 pt-2">
        {/* Account Button - Full Width */}
         <button
            type="button"
            onClick={() => setCurrentView('account_selection')}
            className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-lg border shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors text-left ${props.selectedAccountId ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'}`}
            {...tapBridge}
        >
            <div className="flex items-center gap-2 overflow-hidden">
                <CreditCardIcon className={`h-5 w-5 flex-shrink-0 ${props.selectedAccountId ? 'text-indigo-600' : 'text-slate-400'}`} />
                <span className="truncate font-medium">{selectedAccountLabel}</span>
            </div>
            <ChevronRightIcon className={`w-5 h-5 flex-shrink-0 ${props.selectedAccountId ? 'text-indigo-400' : 'text-slate-400'}`} />
        </button>

        {/* Category Button - Full Width */}
        <button
            type="button"
            onClick={() => setCurrentView('category_selection')}
            className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-lg border shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors text-left ${props.selectedCategoryFilters.size > 0 ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'}`}
            {...tapBridge}
        >
            <div className="flex items-center gap-2 overflow-hidden">
                <SelectedCategoryIcon className={`h-5 w-5 flex-shrink-0 ${props.selectedCategoryFilters.size > 0 ? 'text-indigo-600' : 'text-slate-400'}`} />
                <span className="truncate font-medium text-base font-bold">{selectedCategoryLabel}</span>
            </div>
            <ChevronRightIcon className={`w-5 h-5 flex-shrink-0 ${props.selectedCategoryFilters.size > 0 ? 'text-indigo-400' : 'text-slate-400'}`} />
        </button>
    </div>
  );

  const renderAccountSelection = () => (
      <div className="space-y-2">
          <div className="flex items-center gap-2 mb-3 pb-2 border-b border-slate-100">
              <button onClick={() => setCurrentView('main')} className="p-1 -ml-1 rounded-full hover:bg-slate-100 text-slate-500">
                  <ArrowLeftIcon className="w-5 h-5" />
              </button>
              <h3 className="text-base font-bold text-slate-800">Seleziona Conto</h3>
          </div>
          <div className="space-y-1">
             <button
                onClick={() => { props.onSelectAccount(null); setCurrentView('main'); }}
                className={`w-full flex items-center justify-between px-3 py-3 rounded-lg text-left text-sm transition-colors ${props.selectedAccountId === null ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-slate-700 hover:bg-slate-50'}`}
             >
                 <span>Tutti</span>
                 {props.selectedAccountId === null && <CheckIcon className="w-5 h-5" />}
             </button>
             {props.accounts.map(acc => (
                 <button
                    key={acc.id}
                    onClick={() => { props.onSelectAccount(acc.id); setCurrentView('main'); }}
                    className={`w-full flex items-center justify-between px-3 py-3 rounded-lg text-left text-sm transition-colors ${props.selectedAccountId === acc.id ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-slate-700 hover:bg-slate-50'}`}
                 >
                     <span>{acc.name}</span>
                     {props.selectedAccountId === acc.id && <CheckIcon className="w-5 h-5" />}
                 </button>
             ))}
          </div>
      </div>
  );

  const renderCategorySelection = () => (
      <div className="space-y-2">
          <div className="flex items-center gap-2 mb-3 pb-2 border-b border-slate-100 sticky top-0 bg-white z-10">
              <button onClick={() => setCurrentView('main')} className="p-1 -ml-1 rounded-full hover:bg-slate-100 text-slate-500">
                  <ArrowLeftIcon className="w-5 h-5" />
              </button>
              <div className="flex-1">
                <h3 className="text-base font-bold text-slate-800">Seleziona Categorie</h3>
                {props.selectedCategoryFilters.size > 0 && (
                    <p className="text-xs text-indigo-600 font-semibold">{props.selectedCategoryFilters.size} selezionate</p>
                )}
              </div>
              {props.selectedCategoryFilters.size > 0 && (
                <button 
                    onClick={props.onClearCategoryFilters}
                    className="text-xs font-semibold text-slate-500 hover:text-red-600 px-2 py-1 rounded bg-slate-100 hover:bg-red-50"
                >
                    Reset
                </button>
              )}
          </div>
          <div className="space-y-1 pb-4">
              {Object.keys(CATEGORIES).map(cat => {
                  const style = getCategoryStyle(cat);
                  const isExpanded = expandedCategory === cat;
                  
                  const isParentExplicitlySelected = props.selectedCategoryFilters.has(cat);
                  const hasAnySubcategorySelected = Array.from(props.selectedCategoryFilters).some(k => (k as string).startsWith(cat + ':'));
                  const isParentVisuallyChecked = isParentExplicitlySelected || hasAnySubcategorySelected;
                  
                  const subcategories = CATEGORIES[cat] || [];
                  
                  return (
                      <div key={cat} className="rounded-lg overflow-hidden border border-transparent hover:border-slate-100">
                          <div className={`w-full flex items-center px-3 py-2 gap-3 transition-colors ${isParentVisuallyChecked ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}>
                                <button 
                                    onClick={() => handleCategoryClick(cat)}
                                    className="flex items-center gap-3 flex-1 text-left min-w-0"
                                >
                                     <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${style.bgColor}`}>
                                        <style.Icon className={`w-5 h-5 ${style.color}`} />
                                    </div>
                                    <span className={`text-base font-bold truncate ${isParentVisuallyChecked ? 'text-indigo-800' : 'text-slate-700'}`}>{style.label}</span>
                                    {subcategories.length > 0 && (
                                        <ChevronDownIcon className={`w-5 h-5 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                    )}
                                </button>
                                
                                <Checkbox 
                                    checked={isParentVisuallyChecked} 
                                    onChange={() => props.onToggleCategoryFilter(cat)} 
                                />
                          </div>
                          
                          {isExpanded && subcategories.length > 0 && (
                              <div className="bg-slate-50 pl-16 pr-4 py-3 space-y-3 border-t border-slate-100 animate-fade-in-down">
                                  {subcategories.map(sub => {
                                      const key = `${cat}:${sub}`;
                                      const isSubVisuallyChecked = isParentExplicitlySelected || props.selectedCategoryFilters.has(key);
                                      
                                      return (
                                          <div key={sub} className="flex items-center justify-between">
                                              <span className={`text-base font-bold ${isSubVisuallyChecked ? 'text-indigo-700' : 'text-slate-600'}`}>{sub}</span>
                                              <Checkbox 
                                                checked={isSubVisuallyChecked} 
                                                onChange={() => {
                                                    if (isParentExplicitlySelected) {
                                                        props.onToggleCategoryFilter(cat);
                                                        props.onToggleCategoryFilter(key);
                                                    } else {
                                                        props.onToggleCategoryFilter(key);
                                                    }
                                                }} 
                                              />
                                          </div>
                                      );
                                  })}
                              </div>
                          )}
                      </div>
                  );
              })}
          </div>
      </div>
  );

  const panel = (
    <div
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onClickCapture={handleClickCapture}
      data-no-page-swipe="true"
      className="fixed bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-[0_-3px_4px_rgba(71,85,105,0.6)] z-[1000] flex flex-col"
      style={{
        height: `${OPEN_HEIGHT_VH}vh`,
        transform: `translate3d(0, ${yForStyle}px, 0)`,
        transition: anim ? 'transform 0.08s cubic-bezier(0.22, 0.61, 0.36, 1)' : 'transform 0.3s cubic-bezier(0.22, 0.61, 0.36, 1), height 0.3s cubic-bezier(0.22, 0.61, 0.36, 1)',
        touchAction: 'none', 
        backfaceVisibility: 'hidden',
        willChange: 'transform, height',
        opacity: laidOut ? 1 : 0,
        pointerEvents: laidOut ? 'auto' : 'none',
        display: 'flex',
        flexDirection: 'column'
      }}
      onTransitionEnd={() => setAnim(false)}
    >
      {/* Pull Tab */}
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 w-[88px] h-auto flex justify-center cursor-grab z-50"
        style={{ transform: 'translateX(-50%) translateY(-19px)' }}
        aria-hidden="true"
      >
        <SmoothPullTab width="88" height="19" fill="white" />
        <ChevronDownIcon
          className={
            'absolute w-5 h-5 text-slate-400 transition-transform duration-300 ' +
            (isPanelOpen ? 'rotate-0' : 'rotate-180')
          }
          style={{ top: '2px' }}
        />
      </div>

      {/* Header Content Wrapper */}
      <div className="flex-shrink-0 z-20 relative bg-white rounded-t-2xl">
        
        {/* Header: Date Filters - Highest Z-Index to allow dropdown over inputs */}
        <div className="pt-2 pb-1 relative z-30">
            <div className={'relative ' + (isPeriodMenuOpen ? 'overflow-visible' : 'overflow-hidden')}>
            <div
                className="w-[300%] flex"
                style={{
                transform: listTransform,
                transition: isSwipeAnimating ? 'transform 0.2s cubic-bezier(0.22, 0.61, 0.36, 1)' : 'none',
                }}
                onTransitionEnd={() => setIsSwipeAnimating(false)}
            >
                <div className="w-1/3 px-4 py-1">
                <QuickFilterControl
                    onSelect={handleQuickSelect}
                    currentValue={props.currentQuickFilter}
                    isActive={isQuickFilterActive}
                />
                </div>
                <div className="w-1/3 px-4 py-1">
                <PeriodNavigator
                    periodType={props.periodType}
                    periodDate={props.periodDate}
                    onTypeChange={handlePeriodTypeChange}
                    onDateChange={handlePeriodDateChange}
                    isActive={props.isPeriodFilterActive}
                    onActivate={props.onActivatePeriodFilter}
                    isMenuOpen={isPeriodMenuOpen}
                    onMenuToggle={setIsPeriodMenuOpen}
                    isPanelOpen={isPanelOpen}
                />
                </div>
                <div className="w-1/3 px-4 py-1">
                <CustomDateRangeInputs
                    range={props.currentCustomRange}
                    onChange={handleCustomRangeChange}
                    isActive={props.isCustomRangeActive}
                />
                </div>
            </div>
            </div>

            {/* Pagination Dots */}
            <div className="flex justify-center items-center pt-1 pb-2 gap-2">
            {[0, 1, 2].map((i) => (
                <button
                key={i}
                onClick={() => setActiveViewIndex(i)}
                type="button"
                className={
                    'w-2.5 h-2.5 rounded-full transition-colors ' +
                    (activeViewIndex === i
                    ? 'bg-indigo-600'
                    : 'bg-slate-300 hover:bg-slate-400')
                }
                aria-label={'Vai al filtro ' + (i + 1)}
                />
            ))}
            </div>
        </div>

        {/* Header Inputs (Desc & Amount) - Moved Below Date Filters, Lower Z-Index */}
        {currentView === 'main' && (
            <div className="pt-2 relative z-20">
                {renderHeaderInputs()}
            </div>
        )}
      </div>
      
      <div className="w-full h-px bg-slate-200 mb-2 flex-shrink-0 relative z-10" />

      {/* Scrollable Content Area */}
      <div 
        className="flex-1 overflow-y-auto px-4 pb-4 relative z-10"
        data-no-drag // Tell drag handler to ignore this area so we can scroll
        style={{
            overscrollBehaviorY: 'contain',
            touchAction: 'pan-y'
        }}
      >
          {currentView === 'main' && renderBodyMain()}
          {currentView === 'account_selection' && renderAccountSelection()}
          {currentView === 'category_selection' && renderCategorySelection()}
          
          {/* Spacer for Safe Area */}
          <div style={{ height: 'env(safe-area-inset-bottom, 20px)' }} />
      </div>
    </div>
  );

  if (typeof window === 'undefined') return null;

  return createPortal(panel, document.body);
};

```


---

## `./components/ImageParserModal.tsx`

```tsx

```


---

## `./components/ImageSourceCard.tsx`

```tsx
import React from 'react';

interface ImageSourceCardProps {
    icon: React.ReactNode;
    title: string;
    description: string;
    onClick: () => void;
}

const ImageSourceCard: React.FC<ImageSourceCardProps> = ({ icon, title, description, onClick }) => {
    return (
        <button
            onClick={onClick}
            className="bg-white p-6 rounded-lg shadow-md hover:shadow-lg hover:ring-2 hover:ring-indigo-500 transition-all duration-200 text-left w-full flex flex-col items-center text-center"
        >
            <div className="text-indigo-600 bg-indigo-100 p-4 rounded-full mb-4">
                {icon}
            </div>
            <h3 className="text-lg font-bold text-slate-800">{title}</h3>
            <p className="text-sm text-slate-500 mt-1">{description}</p>
        </button>
    )
}

export default ImageSourceCard;

```


---

## `./components/InstallPwaModal.tsx`

```tsx

import React, { useState, useEffect } from 'react';
import { XMarkIcon } from './icons/XMarkIcon';
import { InformationCircleIcon } from './icons/InformationCircleIcon';
import { ClipboardDocumentIcon } from './icons/ClipboardDocumentIcon';
import { ClipboardDocumentCheckIcon } from './icons/ClipboardDocumentCheckIcon';


interface InstallPwaModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const InstallPwaModal: React.FC<InstallPwaModalProps> = ({ isOpen, onClose }) => {
  const [isAnimating, setIsAnimating] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setCopied(false);
      const timer = setTimeout(() => setIsAnimating(true), 10);
      return () => clearTimeout(timer);
    } else {
      setIsAnimating(false);
    }
  }, [isOpen]);

  const handleCopy = () => {
    navigator.clipboard.writeText(window.location.href).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    });
  };

  if (!isOpen) return null;

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
  const isAndroid = /Android/.test(navigator.userAgent);

  const getInstallInstructions = () => {
    if (isIOS) {
      return <>Tocca l'icona <strong>Condividi</strong> <img src="https://img.icons8.com/ios-glyphs/30/000000/share--v1.png" alt="Share Icon" className="inline w-5 h-5 mx-1 align-text-bottom"/> e poi seleziona <strong>"Aggiungi alla schermata Home"</strong>.</>;
    }
    if (isAndroid) {
      return <>Tocca i tre puntini <strong className="text-xl align-middle mx-1">⋮</strong> nel menu del browser e seleziona <strong>"Installa app"</strong> o <strong>"Aggiungi a schermata Home"</strong>.</>;
    }
    return 'Usa il menu del tuo browser per aggiungere questo sito alla tua schermata principale o per installare l\'app.';
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex justify-center items-center p-4 transition-opacity duration-300 ease-in-out ${isAnimating ? 'opacity-100' : 'opacity-0'} bg-slate-900/60 backdrop-blur-sm`}
      onClick={onClose}
      aria-modal="true"
      role="dialog"
    >
      <div
        className={`bg-white rounded-lg shadow-xl w-full max-w-lg transform transition-all duration-300 ease-in-out ${isAnimating ? 'scale-100 opacity-100' : 'scale-95 opacity-0'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center p-6 border-b border-slate-200">
          <h2 className="text-xl font-bold text-slate-800">Installa l'App</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1 rounded-full hover:bg-slate-200">
            <XMarkIcon className="w-6 h-6" />
          </button>
        </div>
        <div className="p-6 space-y-4">
            <div className="text-sm text-slate-600 bg-slate-100 p-3 rounded-md flex items-start gap-2">
                <InformationCircleIcon className="w-5 h-5 text-slate-500 flex-shrink-0 mt-0.5" />
                <span>L'ambiente di anteprima può limitare l'installazione diretta. Per un'esperienza ottimale, apri l'app nel tuo browser principale seguendo questi passaggi.</span>
            </div>
            <div className="bg-white p-4 rounded-lg border border-slate-200">
                <p className="font-bold text-slate-800 mb-2">1. Copia l'URL dell'App</p>
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={window.location.href}
                        readOnly
                        className="flex-grow bg-slate-100 text-slate-700 rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                    <button
                        onClick={handleCopy}
                        className={`w-[110px] flex-shrink-0 flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold rounded-md transition-all duration-200 ${
                            copied 
                                ? 'bg-green-600 text-white' 
                                : 'bg-indigo-600 text-white hover:bg-indigo-700'
                        }`}
                    >
                        {copied ? <ClipboardDocumentCheckIcon className="w-5 h-5" /> : <ClipboardDocumentIcon className="w-5 h-5" />}
                        <span>{copied ? 'Copiato!' : 'Copia'}</span>
                    </button>
                </div>
            </div>

             <div className="bg-white p-4 rounded-lg border border-slate-200">
                <p className="font-bold text-slate-800 mb-2">2. Apri in una nuova scheda</p>
                <p className="text-sm text-slate-600">
                  Apri una nuova scheda nel tuo browser e <strong>incolla l'URL</strong>.
                </p>
            </div>

             <div className="bg-indigo-100 p-4 rounded-lg border border-indigo-200">
                <p className="font-bold text-indigo-800 mb-2">3. Aggiungi alla Home</p>
                <p className="text-sm text-indigo-700">
                  {getInstallInstructions()}
                </p>
            </div>
        </div>
        <div className="px-6 py-4 bg-slate-50 flex justify-end">
            <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-base font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg shadow-sm hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-colors"
              >
                Ho Capito
            </button>
        </div>
      </div>
    </div>
  );
};

export default InstallPwaModal;

```


---

## `./components/InteractiveLegend.tsx`

```tsx

```


---

## `./components/MultipleExpensesModal.tsx`

```tsx
import React, { useState, useEffect, useRef } from 'react';
import { Expense, Account, CATEGORIES } from '../types';
import { XMarkIcon } from './icons/XMarkIcon';
import { formatCurrency } from './icons/formatters';
import { getCategoryStyle } from '../utils/categoryStyles';
import { PencilSquareIcon } from './icons/PencilSquareIcon';
import { DocumentTextIcon } from './icons/DocumentTextIcon';
import { TagIcon } from './icons/TagIcon';
import { CreditCardIcon } from './icons/CreditCardIcon';
import SelectionMenu from './SelectionMenu';

interface MultipleExpensesModalProps {
  isOpen: boolean;
  onClose: () => void;
  expenses: Partial<Omit<Expense, 'id'>>[];
  accounts: Account[];
  onConfirm: (expenses: Omit<Expense, 'id'>[]) => void;
}

const toYYYYMMDD = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const getCurrentTime = () => new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

// A custom styled checkbox component
const CustomCheckbox = ({ checked, onChange, id, label }: { checked: boolean, onChange: () => void, id: string, label: string }) => (
    <div className="flex items-center">
        <input
            id={id}
            type="checkbox"
            checked={checked}
            onChange={onChange}
            className="h-5 w-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
        />
        <label htmlFor={id} className="ml-2 text-sm font-medium text-slate-700 sr-only">
            {label}
        </label>
    </div>
);

const SelectionButton = ({ label, value, onClick, placeholder, ariaLabel, disabled, icon }: { label: string, value?: string, onClick: () => void, placeholder: string, ariaLabel: string, disabled?: boolean, icon: React.ReactNode }) => {
    const hasValue = value && value !== placeholder && value !== '';
    return (
      <div>
        <label className={`block text-sm font-medium text-slate-700 mb-1 transition-colors ${disabled ? 'text-slate-400' : 'text-slate-700'}`}>{label}</label>
        <button
          type="button"
          onClick={onClick}
          aria-label={ariaLabel}
          disabled={disabled}
          className={`w-full flex items-center justify-between text-left gap-2 px-3 py-2.5 text-sm rounded-lg border shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors ${
            disabled
              ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
              : hasValue
                ? 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100'
                : 'bg-white border-slate-300 text-slate-500 hover:bg-slate-50'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            {icon}
            <span className="truncate">
              {value || placeholder}
            </span>
          </div>
        </button>
      </div>
    );
};


const MultipleExpensesModal: React.FC<MultipleExpensesModalProps> = ({ isOpen, onClose, expenses, accounts, onConfirm }) => {
  const [isAnimating, setIsAnimating] = useState(false);
  const [editableExpenses, setEditableExpenses] = useState<(Partial<Omit<Expense, 'id'>> & { accountId: string })[]>([]);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [activeMenu, setActiveMenu] = useState<{ index: number; type: 'category' | 'subcategory' | 'account' } | null>(null);

  useEffect(() => {
    if (isOpen) {
      const defaultAccountId = accounts.length > 0 ? accounts[0].id : '';
      const newEditableExpenses = expenses.map(e => ({
          ...e,
          accountId: e.accountId || defaultAccountId,
      }));
      setEditableExpenses(newEditableExpenses);
      setSelectedIndices(new Set(expenses.map((_, index) => index)));
      setExpandedIndex(null);
      setActiveMenu(null);
      
      const timer = setTimeout(() => setIsAnimating(true), 10);
      return () => clearTimeout(timer);
    } else {
      setIsAnimating(false);
    }
  }, [isOpen, expenses, accounts]);
  
  const handleToggleSelection = (index: number) => {
      const newSelection = new Set(selectedIndices);
      if (newSelection.has(index)) {
          newSelection.delete(index);
      } else {
          newSelection.add(index);
      }
      setSelectedIndices(newSelection);
  };

  const handleToggleSelectAll = () => {
      if (selectedIndices.size === editableExpenses.length) {
          setSelectedIndices(new Set());
      } else {
          setSelectedIndices(new Set(editableExpenses.map((_, index) => index)));
      }
  };

  const handleFieldChange = (index: number, field: keyof Omit<Expense, 'id'>, value: string) => {
    setEditableExpenses(prevExpenses =>
      prevExpenses.map((expense, i) => {
        if (i !== index) {
          return expense;
        }
        
        const updatedExpense = {
          ...expense,
          [field]: value,
        };

        if (field === 'category') {
          updatedExpense.subcategory = '';
        }
        
        return updatedExpense;
      })
    );
  };

  const handleSelection = (field: 'accountId' | 'category' | 'subcategory', value: string) => {
    if (activeMenu) {
        handleFieldChange(activeMenu.index, field, value);
        setActiveMenu(null);
    }
  };

  const handleToggleExpand = (index: number) => {
    setExpandedIndex(prevIndex => (prevIndex === index ? null : index));
  };


  const handleConfirm = () => {
    const expensesToAdd = editableExpenses
      .filter((_, index) => selectedIndices.has(index))
      .map(exp => ({
        description: exp.description || 'Senza descrizione',
        amount: exp.amount!,
        date: exp.date || toYYYYMMDD(new Date()),
        time: exp.time || getCurrentTime(),
        category: exp.category || 'Altro',
        subcategory: exp.subcategory || undefined,
        accountId: exp.accountId,
      }))
      .filter(exp => exp.amount > 0); 

    if (expensesToAdd.length > 0) {
        onConfirm(expensesToAdd);
    }
    onClose();
  };


  if (!isOpen) return null;
  
  const areAllSelected = selectedIndices.size === editableExpenses.length && editableExpenses.length > 0;
  const today = toYYYYMMDD(new Date());

  const categoryOptions = Object.keys(CATEGORIES).map(cat => ({
    value: cat,
    label: getCategoryStyle(cat).label,
    Icon: getCategoryStyle(cat).Icon,
    color: getCategoryStyle(cat).color,
    bgColor: getCategoryStyle(cat).bgColor,
  }));
  
  const accountOptions = accounts.map(acc => ({
      value: acc.id,
      label: acc.name,
  }));

  const activeExpense = activeMenu ? editableExpenses[activeMenu.index] : null;
  const subcategoryOptionsForActive = activeExpense?.category
    ? (CATEGORIES[activeExpense.category as keyof typeof CATEGORIES]?.map(sub => ({ value: sub, label: sub })) || [])
    : [];

  return (
    <div
      className={`fixed inset-0 z-50 flex justify-center items-start p-4 transition-opacity duration-75 ease-in-out ${isAnimating ? 'opacity-100' : 'opacity-0'} bg-slate-900/60 backdrop-blur-sm overflow-y-auto`}
      onClick={onClose}
      aria-modal="true"
      role="dialog"
    >
      <div
        className={`bg-slate-50 rounded-lg shadow-xl w-full max-w-3xl my-8 transform transition-all duration-75 ease-in-out ${isAnimating ? 'scale-100 opacity-100' : 'scale-95 opacity-0'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center p-6 border-b border-slate-200 sticky top-0 bg-slate-50/80 backdrop-blur-sm rounded-t-lg z-20">
          <div>
            <h2 className="text-xl font-bold text-slate-800">Spese Rilevate</h2>
            <p className="text-sm text-slate-500">Abbiamo trovato {expenses.length} spese. Seleziona e modifica i dettagli prima di aggiungerle.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-slate-800 transition-colors p-1 rounded-full hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            aria-label="Chiudi"
          >
            <XMarkIcon className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6 max-h-[60vh] overflow-y-auto">
            <div className="flex items-center bg-slate-100 p-2 rounded-md mb-4 border border-slate-200">
                <CustomCheckbox 
                    id="select-all" 
                    checked={areAllSelected} 
                    onChange={handleToggleSelectAll} 
                    label="Seleziona tutto"
                />
                <label htmlFor="select-all" className="ml-3 text-sm font-medium text-slate-700 cursor-pointer">
                    Seleziona / Deseleziona tutto
                </label>
            </div>
            <div className="space-y-3">
                {editableExpenses.map((expense, index) => {
                    const isSelected = selectedIndices.has(index);
                    const isExpanded = expandedIndex === index;
                    
                    const subcategoriesForCategory = expense.category ? CATEGORIES[expense.category as keyof typeof CATEGORIES] : [];
                    const selectedAccountLabel = accounts.find(a => a.id === expense.accountId)?.name;
                    const selectedCategoryLabel = expense.category ? getCategoryStyle(expense.category).label : undefined;

                    return (
                    <div 
                        key={index} 
                        className={`bg-white rounded-lg shadow-sm border ${isSelected ? 'border-indigo-400' : 'border-slate-200'} transition-all duration-300 animate-fade-in-up`} 
                        style={{ animationDelay: `${index * 50}ms`, zIndex: isExpanded ? 10 : 1 }}
                    >
                        <div className="p-3 flex items-center gap-3">
                           <CustomCheckbox 
                                id={`expense-${index}`} 
                                checked={isSelected} 
                                onChange={() => handleToggleSelection(index)}
                                label={`Seleziona spesa ${expense.description}`}
                            />
                            <input 
                                type="date"
                                value={expense.date || ''}
                                onChange={(e) => handleFieldChange(index, 'date', e.target.value)}
                                max={today}
                                className="text-sm rounded-md border border-slate-300 bg-white py-1.5 px-2 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                            />
                            <div className="flex-grow" />
                            <p className="text-lg font-bold text-indigo-600 shrink-0">
                                {formatCurrency(expense.amount || 0)}
                            </p>
                             <button onClick={() => handleToggleExpand(index)} className="p-2 text-slate-500 hover:text-indigo-600 hover:bg-indigo-100 rounded-full transition-colors flex-shrink-0" aria-label="Modifica dettagli spesa">
                                <PencilSquareIcon className="w-5 h-5" />
                            </button>
                        </div>
                        
                        {isExpanded && (
                            <div className="p-4 border-t border-slate-200 bg-slate-50/70 space-y-4">
                                <div>
                                    <label htmlFor={`description-${index}`} className="block text-sm font-medium text-slate-700 mb-1">Descrizione</label>
                                    <div className="relative">
                                        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                                            <DocumentTextIcon className="h-5 w-5 text-slate-400" aria-hidden="true" />
                                        </div>
                                        <input
                                            type="text"
                                            id={`description-${index}`}
                                            value={expense.description || ''}
                                            onChange={(e) => handleFieldChange(index, 'description', e.target.value)}
                                            className="block w-full rounded-md border border-slate-300 bg-white py-2 pl-10 pr-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 sm:text-sm"
                                            placeholder="Es. Spesa al supermercato"
                                        />
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                                     <SelectionButton
                                        label="Conto"
                                        value={selectedAccountLabel}
                                        onClick={() => setActiveMenu({ index, type: 'account' })}
                                        placeholder="Seleziona"
                                        ariaLabel="Seleziona conto di pagamento"
                                        icon={<CreditCardIcon className="h-5 w-5 text-slate-400" />}
                                    />
                                    <SelectionButton
                                        label="Categoria"
                                        value={selectedCategoryLabel}
                                        onClick={() => setActiveMenu({ index, type: 'category' })}
                                        placeholder="Seleziona"
                                        ariaLabel="Seleziona categoria"
                                        icon={<TagIcon className="h-5 w-5 text-slate-400" />}
                                    />
                                    <SelectionButton
                                        label="Sottocategoria"
                                        value={expense.subcategory}
                                        onClick={() => setActiveMenu({ index, type: 'subcategory' })}
                                        placeholder="Nessuna"
                                        ariaLabel="Seleziona sottocategoria"
                                        icon={<TagIcon className="h-5 w-5 text-slate-400" />}
                                        disabled={!expense.category || subcategoriesForCategory.length === 0}
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                    );
                })}
            </div>
        </div>
        
        <div className="px-6 py-4 bg-slate-100 border-t border-slate-200 flex justify-end gap-3 sticky bottom-0 rounded-b-lg">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg shadow-sm hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-colors"
            >
              Annulla
            </button>
           <button
              type="button"
              onClick={handleConfirm}
              disabled={selectedIndices.size === 0}
              className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-colors disabled:bg-indigo-300 disabled:cursor-not-allowed"
            >
              Aggiungi {selectedIndices.size} Spes{selectedIndices.size !== 1 ? 'e' : 'a'}
            </button>
        </div>
      </div>

      <SelectionMenu
        isOpen={activeMenu?.type === 'account'}
        onClose={() => setActiveMenu(null)}
        title="Seleziona un Conto"
        options={accountOptions}
        selectedValue={activeExpense?.accountId || ''}
        onSelect={(value) => handleSelection('accountId', value)}
      />

      <SelectionMenu
        isOpen={activeMenu?.type === 'category'}
        onClose={() => setActiveMenu(null)}
        title="Seleziona una Categoria"
        options={categoryOptions}
        selectedValue={activeExpense?.category || ''}
        onSelect={(value) => handleSelection('category', value)}
      />

      <SelectionMenu
        isOpen={activeMenu?.type === 'subcategory'}
        onClose={() => setActiveMenu(null)}
        title="Seleziona Sottocategoria"
        options={subcategoryOptionsForActive}
        selectedValue={activeExpense?.subcategory || ''}
        onSelect={(value) => handleSelection('subcategory', value)}
      />
    </div>
  );
};

export default MultipleExpensesModal;
```


---

## `./components/PendingImages.tsx`

```tsx
import React, { useState } from 'react';
import { OfflineImage } from '../utils/db';
import { SpinnerIcon } from './icons/SpinnerIcon';
import { TrashIcon } from './icons/TrashIcon';
import { ChevronDownIcon } from './icons/ChevronDownIcon';
import { useTapBridge } from '../hooks/useTapBridge';

interface PendingImagesProps {
  images: OfflineImage[];
  onAnalyze: (image: OfflineImage) => void;
  onDelete: (id: string) => void;
  isOnline: boolean;
  syncingImageId: string | null;
}

const PendingImages: React.FC<PendingImagesProps> = ({ images, onAnalyze, onDelete, isOnline, syncingImageId }) => {
  const [isOpen, setIsOpen] = useState(false);
  const tapBridge = useTapBridge();

  if (images.length === 0) {
    return null;
  }
  
  const isAnalyzing = !!syncingImageId;

  return (
    <div className="bg-white rounded-2xl shadow-lg">
      <button 
        className="w-full flex items-center justify-between p-6 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 rounded-2xl"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        {...tapBridge}
      >
        <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-slate-700">Immagini in Attesa</h2>
            <span className="flex items-center justify-center min-w-[24px] h-6 px-2 text-sm font-semibold text-white bg-indigo-500 rounded-full">
                {images.length}
            </span>
        </div>
        <ChevronDownIcon className={`w-6 h-6 text-slate-500 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="px-6 pb-6 animate-fade-in-up" style={{animationDuration: '300ms'}}>
          <p className="text-sm text-slate-500 mb-6 border-t border-slate-200 pt-6">
            Queste immagini sono state salvate mentre eri offline. Clicca su "Analizza" per processarle ora che sei online.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {images.map(image => (
              <div key={image.id} className="border border-slate-200 shadow-sm flex flex-col group rounded-lg">
                <div className="relative">
                  <img
                    src={`data:${image.mimeType};base64,${image.base64Image}`}
                    alt="Anteprima spesa offline"
                    className="w-full h-24 object-cover bg-slate-100 rounded-t-lg"
                  />
                  {syncingImageId === image.id && (
                    <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center rounded-t-lg">
                      <SpinnerIcon className="w-8 h-8 text-indigo-600" />
                      <span className="sr-only">Analisi in corso...</span>
                    </div>
                  )}
                </div>
                <div className="p-2 mt-auto flex items-center justify-center gap-2 bg-slate-50 rounded-b-lg">
                    <button
                      onClick={() => onAnalyze(image)}
                      disabled={!isOnline || isAnalyzing}
                      className="flex-1 px-2 py-1.5 text-xs font-semibold text-white bg-indigo-600 rounded-md shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-colors disabled:bg-indigo-400 disabled:cursor-not-allowed"
                      title={!isOnline ? "Connettiti a internet per analizzare" : "Analizza immagine"}
                      {...tapBridge}
                    >
                      Analizza
                    </button>
                    <button
                      onClick={() => onDelete(image.id)}
                      disabled={isAnalyzing}
                      className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-100 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      aria-label="Elimina immagine in attesa"
                      {...tapBridge}
                    >
                      <TrashIcon className="w-5 h-5" />
                    </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default PendingImages;
```


---

## `./components/SelectionMenu.tsx`

```tsx

import React, { useState, useEffect, useRef } from 'react';
import { XMarkIcon } from './icons/XMarkIcon';
import { CheckCircleIcon } from './icons/CheckCircleIcon';
import { useSheetDragControlled } from '../hooks/useSheetDragControlled';
import { useTapBridge } from '../hooks/useTapBridge';

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
  const tapBridgeHandlers = useTapBridge();

  const { dragY, transitionMs, easing, handleTransitionEnd } =
    useSheetDragControlled(menuRef, { onClose }, {
      triggerPercent: 0.25,
      elastic: 1,
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
        {...tapBridgeHandlers}
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

```


---

## `./components/SmoothPullTab.tsx`

```tsx
import React from "react";

type Props = {
  width?: string | number;
  height?: string | number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
};

/**
 * A smooth pull-tab shape with a uniform color and a pronounced drop shadow for a 3D effect.
 */
export default function SmoothPullTab({
  width = 192,
  height = 64,
  fill = "currentColor",
  stroke = "none",
  strokeWidth = 0,
}: Props) {
  const W = Number(width);
  const H = Number(height);
  const dropShadowFilterId = "smooth-pull-tab-shadow-filter";

  // The path calculation remains the same
  const topPlateauWidth = W * 0.35;
  const bulgeFactor = W * 0.25;
  const x1 = (W - topPlateauWidth) / 2;
  const x2 = x1 + topPlateauWidth;
  const d = [
    `M 0 ${H}`,
    `C ${bulgeFactor} ${H}, ${x1 - bulgeFactor} 0, ${x1} 0`,
    `L ${x2} 0`,
    `C ${x2 + bulgeFactor} 0, ${W - bulgeFactor} ${H}, ${W} ${H}`,
    "Z",
  ].join(" ");

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${W} ${H}`}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Linguetta morbida con effetto rilievo"
      style={{ overflow: 'visible' }} // Allow shadow to render outside the viewbox
    >
      <defs>
        {/* Filter for a more pronounced and directional drop shadow */}
        <filter id={dropShadowFilterId} x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow 
                dx="0" 
                dy="-3" 
                stdDeviation="2" 
                floodColor="#475569" // slate-600
                floodOpacity="0.6" 
            />
        </filter>
      </defs>
      
      {/* Apply the shadow filter to the group */}
      <g filter={`url(#${dropShadowFilterId})`}>
        {/* Single path for a uniform color fill */}
        <path
          d={d}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
        />
      </g>
    </svg>
  );
}
```


---

## `./components/SoftBumpBaseline.tsx`

```tsx

```


---

## `./components/SoftTab.tsx`

```tsx

```


---

## `./components/SuccessIndicator.tsx`

```tsx
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

```


---

## `./components/Toast.tsx`

```tsx
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
```


---

## `./components/TransactionDetailPage.tsx`

```tsx
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

```


---

## `./components/TrapezoidTab.tsx`

```tsx

```


---

## `./components/TrapezoidTabRight.tsx`

```tsx

```


---

## `./components/VoiceInputModal.tsx`

```tsx

import React, { useState, useEffect, useRef } from 'react';
import { Expense } from '../types';
import { createLiveSession, createBlob } from '../utils/ai';
import { XMarkIcon } from './icons/XMarkIcon';
import { MicrophoneIcon } from './icons/MicrophoneIcon';
import { LiveServerMessage } from '@google/genai';

interface VoiceInputModalProps {
  isOpen: boolean;
  onClose: () => void;
  onParsed: (data: Partial<Omit<Expense, 'id'>>) => void;
}

const VoiceInputModal: React.FC<VoiceInputModalProps> = ({ isOpen, onClose, onParsed }) => {
  const [isAnimating, setIsAnimating] = useState(false);
  const [status, setStatus] = useState<'idle' | 'listening' | 'processing' | 'error'>('idle');
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);

  const sessionPromise = useRef<Promise<any> | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const scriptProcessor = useRef<ScriptProcessorNode | null>(null);
  const stream = useRef<MediaStream | null>(null);

  const cleanUp = () => {
    stream.current?.getTracks().forEach(track => track.stop());
    scriptProcessor.current?.disconnect();
    audioContext.current?.close();
    sessionPromise.current?.then((session: any) => session.close());
    sessionPromise.current = null;
    audioContext.current = null;
    scriptProcessor.current = null;
    stream.current = null;
  };

  const startSession = async () => {
    cleanUp();
    setTranscript('');
    setError(null);
    setStatus('listening');

    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });

      sessionPromise.current = createLiveSession({
        onopen: async () => { // Nota: aggiungi async qui
          const AudioContextCtor =
            window.AudioContext || (window as any).webkitAudioContext;
          if (!AudioContextCtor) {
            setError("Il tuo browser non supporta l'input vocale.");
            setStatus('error');
            return;
          }

          // 1. RIMUOVI { sampleRate: 16000 }. Lascia decidere all'hardware.
          audioContext.current = new AudioContextCtor();

          // 2. FIX PER IOS: Se il contesto è sospeso, riattivalo esplicitamente
          if (audioContext.current.state === 'suspended') {
            await audioContext.current.resume();
          }

          // 3. Ottieni il sample rate REALE del dispositivo (es. 44100 o 48000)
          const realSampleRate = audioContext.current.sampleRate;

          const source = audioContext.current.createMediaStreamSource(stream.current!);
          scriptProcessor.current = audioContext.current.createScriptProcessor(4096, 1, 1);

          scriptProcessor.current.onaudioprocess = (audioProcessingEvent) => {
            const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
            
            // 4. Passa il sample rate reale alla funzione createBlob
            const pcmBlob = createBlob(inputData, realSampleRate);

            sessionPromise.current?.then((session: any) => {
              session.sendRealtimeInput({ media: pcmBlob });
            });
          };

          source.connect(scriptProcessor.current);
          scriptProcessor.current.connect(audioContext.current.destination);
        },
        onmessage: (message: LiveServerMessage) => {
          if (message.serverContent?.inputTranscription) {
            setTranscript(prev => prev + message.serverContent.inputTranscription.text);
          }
          if (message.toolCall?.functionCalls) {
            setStatus('processing');
            const args = message.toolCall.functionCalls[0].args;
            onParsed({
              description: args.description as string,
              amount: args.amount as number,
              category: args.category as string,
            });
            cleanUp();
          }
        },
        onerror: (e: ErrorEvent) => {
          console.error(e);
          setError("Si è verificato un errore durante la sessione vocale.");
          setStatus('error');
          cleanUp();
        },
        onclose: () => {
          // Session closed
        }
      });

    } catch (err) {
      console.error(err);
      setError("Accesso al microfono negato. Controlla le autorizzazioni del browser.");
      setStatus('error');
    }
  };

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => setIsAnimating(true), 10);
      startSession();
      return () => {
        clearTimeout(timer);
        cleanUp();
      };
    } else {
      setIsAnimating(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const getStatusContent = () => {
    switch (status) {
      case 'listening':
        return {
          icon: (
            <div className="w-24 h-24 rounded-full bg-red-500 animate-pulse flex items-center justify-center">
              <MicrophoneIcon className="w-12 h-12 text-white" />
            </div>
          ),
          text: 'In ascolto...',
          subtext: 'Descrivi la tua spesa, ad esempio "25 euro per una cena al ristorante".'
        };
      case 'processing':
        return {
          icon: (
            <div className="w-24 h-24 rounded-full bg-indigo-500 flex items-center justify-center">
              <div className="w-12 h-12 text-white animate-spin rounded-full border-4 border-t-transparent border-white"></div>
            </div>
          ),
          text: 'Elaborazione...',
          subtext: 'Sto analizzando la tua richiesta.'
        };
      case 'error':
        return {
          icon: (
            <div className="w-24 h-24 rounded-full bg-red-100 flex items-center justify-center">
              <XMarkIcon className="w-12 h-12 text-red-500" />
            </div>
          ),
          text: 'Errore',
          subtext: error
        };
      default:
        return { icon: null, text: '', subtext: '' };
    }
  };

  const { icon, text, subtext } = getStatusContent();

  return (
    <div
      className={`fixed inset-0 z-50 flex justify-center items-center p-4 transition-opacity duration-300 ease-in-out ${
        isAnimating ? 'opacity-100' : 'opacity-0'
      } bg-slate-900/50 backdrop-blur-sm`}
      onClick={onClose}
      aria-modal="true"
      role="dialog"
    >
      <div
        className={`bg-slate-50 rounded-lg shadow-xl w-full max-w-lg transform transition-all duration-300 ease-in-out ${
          isAnimating ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center p-6 border-b border-slate-200">
          <h2 className="text-xl font-bold text-slate-800">Aggiungi con Voce</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-slate-800 transition-colors p-1 rounded-full hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            aria-label="Chiudi"
          >
            <XMarkIcon className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6 flex flex-col items-center justify-center min-h-[300px] text-center">
          {icon}
          <p className="text-xl font-semibold text-slate-800 mt-6">{text}</p>
          <p className="text-slate-500 mt-2">{subtext}</p>
          {transcript && (
            <div className="mt-6 p-3 bg-slate-100 rounded-md w-full text-left">
              <p className="text-sm text-slate-600 font-medium">Trascrizione:</p>
              <p className="text-slate-800">{transcript}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default VoiceInputModal;

```


---

## `./components/auth/AuthLayout.tsx`

```tsx
import React from 'react';
import { AppLogoIcon } from '../icons/AppLogoIcon';

interface AuthLayoutProps {
  children: React.ReactNode;
}

/** Imposta --vh per altezze corrette su mobile e in iframe */
const useStableViewportHeight = () => {
  React.useEffect(() => {
    const setVH = () => {
      const h = (window.visualViewport?.height ?? window.innerHeight) * 0.01;
      document.documentElement.style.setProperty('--vh', `${h}px`);
    };
    setVH();
    addEventListener('resize', setVH);
    addEventListener('orientationchange', setVH);
    window.visualViewport?.addEventListener('resize', setVH);
    return () => {
      removeEventListener('resize', setVH);
      removeEventListener('orientationchange', setVH);
      window.visualViewport?.removeEventListener('resize', setVH);
    };
  }, []);
};

/** Rileva se siamo in iframe (AI Studio). Forzabile via ?studio=1 o window.__FORCE_STUDIO__ */
const useIsStudio = () => {
  const [isStudio, setIsStudio] = React.useState<boolean>(false);
  React.useEffect(() => {
    let forced =
      (typeof (window as any).__FORCE_STUDIO__ === 'boolean' && (window as any).__FORCE_STUDIO__) ||
      new URLSearchParams(location.search).has('studio');

    let inIframe = false;
    try {
      inIframe = window.self !== window.top;
    } catch {
      inIframe = true; // cross-origin → presumiamo iframe
    }
    setIsStudio(forced || inIframe);
  }, []);
  return isStudio;
};

const Card: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      background: '#fff',
      padding: 24,
      borderRadius: 16,
      boxShadow: '0 12px 28px rgba(0,0,0,0.12)',
      position: 'relative',
      overflow: 'visible', // niente clipping → autofill può estendersi
      opacity: 1,          // niente transform (no translate/scale)
    }}
  >
    {children}
  </div>
);

const Header: React.FC = () => (
  <div style={{ textAlign: 'center' }}>
    <div
      style={{
        margin: '0 auto 12px',
        width: 64,
        height: 64,
      }}
    >
      <AppLogoIcon
          style={{ width: '100%', height: '100%' }}
          aria-label="Logo Gestore Spese"
        />
    </div>
    <h1 style={{ fontSize: 28, fontWeight: 800, color: '#0f172a', margin: 0 }}>
      Gestore Spese
    </h1>
  </div>
);

const AuthLayout: React.FC<AuthLayoutProps> = ({ children }) => {
  useStableViewportHeight();
  const isStudio = useIsStudio();

  const mainContainerStyle: React.CSSProperties = {
    minHeight: 'calc(var(--vh, 1vh) * 100)',
    height: '100dvh',
    background: '#f1f5f9',
    fontFamily:
      'system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, sans-serif',
    WebkitTapHighlightColor: 'transparent',
    display: 'flex',
    flexDirection: 'column',
    padding: 16,
    overflow: 'auto', // Allow scrolling on small viewports
  };
  
  if (isStudio) {
    // FIX: Use type assertion as 'position' and 'inset' might not be recognized
    // by the version of TypeScript or React types used in this environment.
    (mainContainerStyle as any).position = 'fixed';
    (mainContainerStyle as any).inset = 0;
  }

  // ===== Layout unificato e centrato =====
  return (
    <div
      style={mainContainerStyle}
    >
      <div
        style={{
          display: 'flex',
          flex: 1,
          alignItems: 'center', // Centrato verticalmente
          justifyContent: 'center',
          overflow: 'visible',
          position: 'relative',
        }}
      >
        <div style={{ width: '100%', maxWidth: 480 }}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              marginBottom: 32,
            }}
          >
            <Header />
          </div>
          <Card>{children}</Card>
        </div>
      </div>
    </div>
  );
};

export default AuthLayout;

```


---

## `./components/auth/FingerprintProgress.tsx`

```tsx
import React from 'react';

const FingerprintProgress: React.FC = () => {
    return null;
};

export default FingerprintProgress;

```


---

## `./components/auth/LoginEmail.tsx`

```tsx
import React from 'react';

type Props = {
  onSubmit?: (email: string) => void;
};

const isValidEmail = (v: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

export default function LoginEmail({ onSubmit }: Props) {
  const edRef = React.useRef<HTMLDivElement>(null);
  const hiddenRef = React.useRef<HTMLInputElement>(null);
  const [err, setErr] = React.useState<string>('');

  // evita salti in iframe/mobile: niente scroll sul form
  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (e) => {
    e.preventDefault();
    const email = (edRef.current?.textContent || '').trim();
    if (!isValidEmail(email)) {
      setErr('Inserisci un’email valida');
      return;
    }
    if (hiddenRef.current) hiddenRef.current.value = email;
    setErr('');
    onSubmit?.(email);
    // fai il tuo login qui
    console.log('LOGIN email:', email);
  };

  const plainPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const t = e.clipboardData?.getData('text') || '';
    document.execCommand('insertText', false, t);
  };

  return (
    <form
      onSubmit={handleSubmit}
      autoComplete="off"
      data-lpignore="true"
      data-form-type="other"
      style={{ overflow: 'visible' }}
    >
      {/* decoy: assorbe eventuali heuristics di autofill */}
      <input
        type="text"
        autoComplete="off"
        tabIndex={-1}
        readOnly
        aria-hidden="true"
        style={{ position: 'absolute', left: -9999, top: -9999, height: 0, width: 0, opacity: 0 }}
      />

      {/* hidden “vero” per compatibilità con eventuale lettura DOM */}
      <input ref={hiddenRef} type="hidden" name="email" />

      <label htmlFor="ed-email" className="block text-sm font-medium text-slate-700 mb-2">
        Email
      </label>

      {/* Campo VISIBILE senza autofill del browser */}
      <div
        id="ed-email"
        ref={edRef}
        role="textbox"
        contentEditable
        suppressContentEditableWarning
        inputMode="email"
        aria-label="Email"
        spellCheck={false}
        // evita autocompletamento/auto-capitalize
        // (non servono su contenteditable ma non fanno male)
        // @ts-ignore
        autoCapitalize="off"
        autoCorrect="off"
        onPaste={plainPaste}
        onKeyDown={(e) => {
          // invia con Enter
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.currentTarget.closest('form') as HTMLFormElement)?.requestSubmit();
          }
        }}
        style={{
          display: 'block',
          width: '100%',
          minHeight: 44,
          fontSize: 16,
          padding: '10px 12px',
          border: '1px solid #cbd5e1',
          borderRadius: 10,
          outline: 'none',
          background: '#fff',
          color: '#0f172a',
          // evita formattazione ricca su mobile webkit
          WebkitUserModify: 'read-write-plaintext-only' as any,
        }}
        // placeholder “soft”
        data-placeholder="nome@dominio.it"
        onFocus={(e) => {
          // scroll “pulito” senza transform (se servisse)
          e.currentTarget.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }}
      />

      {/* placeholder CSS per contenteditable */}
      <style>{`
        #ed-email:empty:before {
          content: attr(data-placeholder);
          color: #94a3b8; /* slate-400 */
        }
      `}</style>

      {err && <p style={{ color: '#dc2626', fontSize: 13, marginTop: 8 }}>{err}</p>}

      <button
        type="submit"
        style={{
          marginTop: 16,
          width: '100%',
          minHeight: 44,
          borderRadius: 10,
          border: '1px solid #4f46e5',
          background: '#4f46e5',
          color: '#fff',
          fontWeight: 600,
        }}
      >
        Continua
      </button>

      {/* Note di sicurezza UI: niente transform/overflow sugli antenati */}
    </form>
  );
}
```


---

## `./components/auth/PinInput.tsx`

```tsx
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
```


---

## `./components/icons/AppLogoIcon.tsx`

```tsx
import React from 'react';

// Using React.SVGProps<SVGSVGElement> allows standard SVG attributes to be passed as props.
export const AppLogoIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
    <svg version="1.0" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" 
	 viewBox="0 0 64 64" enableBackground="new 0 0 64 64" xmlSpace="preserve" {...props}>
    <g>
        <path fill="#F9EBB2" d="M43.025,2.123c1.039-0.379,2.186,0.156,2.564,1.195L48.75,12h-6.098C41.826,9.671,39.611,8,37,8
            s-4.826,1.672-5.65,4H15.885L43.025,2.123z"/>
        <path fill="#F76D57" d="M40.445,12h-6.891c0.693-1.189,1.969-2,3.445-2S39.752,10.81,40.445,12z"/>
        <g>
            <path fill="#506C7F" d="M53.463,6.394c-0.527-0.471-1.342-0.4-1.348-0.4C52.045,6,50.816,6.128,48.814,6.332L50.879,12H54V8
                C54,7.253,53.82,6.712,53.463,6.394z"/>
            <path fill="#506C7F" d="M2.658,12.248C3.079,12.097,3.527,12,4,12h6.038l6.351-2.311c-5.357,0.561-9.894,1.039-12.278,1.305
                C3.432,11.07,2.972,11.599,2.658,12.248z"/>
        </g>
        <path fill="#45AAB8" d="M58,60c0,1.105-0.895,2-2,2H4c-1.104,0-2-0.895-2-2V16c0-1.104,0.896-2,2-2h52c1.105,0,2,0.896,2,2v16H42
            c-1.105,0-2,0.895-2,2v8c0,1.105,0.895,2,2,2h16V60z"/>
        <path fill="#B4CCB9" d="M62,41c0,0.553-0.447,1-1,1H43c-0.553,0-1-0.447-1-1v-6c0-0.553,0.447-1,1-1h18c0.553,0,1,0.447,1,1V41z"/>
        <g>
            <path fill="#394240" d="M62,32h-2V16c0-2.211-1.789-4-4-4V8c0-1.342-0.404-2.385-1.205-3.098c-1.186-1.059-2.736-0.91-2.896-0.896
                c-0.072,0.006-1.484,0.152-3.789,0.389l-0.641-1.76c-0.756-2.078-3.049-3.148-5.127-2.391L24.131,6.871
                C15.535,7.763,7.397,8.617,3.89,9.005C0.951,9.332,0.062,12.908,0,14.97C-0.003,15.103,0,60,0,60c0,2.211,1.789,4,4,4h52
                c2.211,0,4-1.789,4-4V44h2c1.105,0,2-0.895,2-2v-8C64,32.895,63.105,32,62,32z M52.115,5.994c0.006,0,0.82-0.07,1.348,0.4
                C53.82,6.712,54,7.253,54,8v4h-3.121l-2.064-5.668C50.816,6.128,52.045,6,52.115,5.994z M43.025,2.123
                c1.039-0.379,2.186,0.156,2.564,1.195L48.75,12h-6.098C41.826,9.671,39.611,8,37,8s-4.826,1.672-5.65,4H15.885L43.025,2.123z
                M40.445,12h-6.891c0.693-1.189,1.969-2,3.445-2S39.752,10.81,40.445,12z M4.111,10.994c2.385-0.266,6.921-0.744,12.278-1.305
                L10.039,12H4c-0.474,0-0.922,0.098-1.343,0.248C2.972,11.599,3.432,11.07,4.111,10.994z M58,60c0,1.105-0.895,2-2,2H4
                c-1.104,0-2-0.895-2-2V16c0-1.104,0.896-2,2-2h52c1.105,0,2,0.896,2,2v16H42c-1.105,0-2,0.895-2,2v8c0,1.105,0.895,2,2,2h16V60z
                M62,41c0,0.553-0.447,1-1,1H43c-0.553,0-1-0.447-1-1v-6c0-0.553,0.447-1,1-1h18c0.553,0,1,0.447,1,1V41z"/>
            <circle fill="#394240" cx="46" cy="38" r="2"/>
            <path fill="#394240" d="M53,20h2c0.553,0,1-0.447,1-1s-0.447-1-1-1h-2c-0.553,0-1,0.447-1,1S52.447,20,53,20z"/>
            <path fill="#394240" d="M47,20h2c0.553,0,1-0.447,1-1s-0.447-1-1-1h-2c-0.553,0-1,0.447-1,1S46.447,20,47,20z"/>
            <path fill="#394240" d="M41,20h2c0.553,0,1-0.447,1-1s-0.447-1-1-1h-2c-0.553,0-1,0.447-1,1S40.447,20,41,20z"/>
            <path fill="#394240" d="M37,18h-2c-0.553,0-1,0.447-1,1s0.447,1,1,1h2c0.553,0,1-0.447,1-1S37.553,18,37,18z"/>
            <path fill="#394240" d="M31,18h-2c-0.553,0-1,0.447-1,1s0.447,1,1,1h2c0.553,0,1-0.447,1-1S31.553,18,31,18z"/>
            <path fill="#394240" d="M25,18h-2c-0.553,0-1,0.447-1,1s0.447,1,1,1h2c0.553,0,1-0.447,1-1S25.553,18,25,18z"/>
            <path fill="#394240" d="M19,18h-2c-0.552,0-1,0.447-1,1s0.447,1,1,1h2c0.553,0,1-0.447,1-1S19.553,18,19,18z"/>
            <path fill="#394240" d="M13,18h-2c-0.553,0-1,0.447-1,1s0.447,1,1,1h2c0.553,0,1-0.447,1-1S13.553,18,13,18z"/>
            <path fill="#394240" d="M7,18H5c-0.553,0-1,0.447-1,1s0.447,1,1,1h2c0.553,0,1-0.447,1-1S7.553,18,7,18z"/>
            <path fill="#394240" d="M53,58h2c0.553,0,1-0.447,1-1s-0.447-1-1-1h-2c-0.553,0-1,0.447-1,1S52.447,58,53,58z"/>
            <path fill="#394240" d="M47,58h2c0.553,0,1-0.447,1-1s-0.447-1-1-1h-2c-0.553,0-1,0.447-1,1S46.447,58,47,58z"/>
            <path fill="#394240" d="M40,57c0,0.553,0.447,1,1,1h2c0.553,0,1-0.447,1-1s-0.447-1-1-1h-2C40.447,56,40,56.447,40,57z"/>
            <path fill="#394240" d="M37,56h-2c-0.553,0-1,0.447-1,1s0.447,1,1,1h2c0.553,0,1-0.447,1-1S37.553,56,37,56z"/>
            <path fill="#394240" d="M31,56h-2c-0.553,0-1,0.447-1,1s0.447,1,1,1h2c0.553,0,1-0.447,1-1S31.553,56,31,56z"/>
            <path fill="#394240" d="M25,56h-2c-0.553,0-1,0.447-1,1s0.447,1,1,1h2c0.553,0,1-0.447,1-1S25.553,56,25,56z"/>
            <path fill="#394240" d="M19,56h-2c-0.552,0-1,0.447-1,1s0.447,1,1,1h2c0.553,0,1-0.447,1-1S19.553,56,19,56z"/>
            <path fill="#394240" d="M13,56h-2c-0.553,0-1,0.447-1,1s0.447,1,1,1h2c0.553,0,1-0.447,1-1S13.553,56,13,56z"/>
            <path fill="#394240" d="M7,56H5c-0.553,0-1,0.447-1,1s0.447,1,1,1h2c0.553,0,1-0.447,1-1S7.553,56,7,56z"/>
        </g>
    </g>
    </svg>
);

```


---

## `./components/icons/ArchiveBoxIcon.tsx`

```tsx
import React from 'react';

export const ArchiveBoxIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 7.5h16.5v-1.5A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v1.5Z" />
  </svg>
);
```


---

## `./components/icons/ArrowDownOnSquareIcon.tsx`

```tsx

import React from 'react';

export const ArrowDownOnSquareIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 3.75H6.75a2.25 2.25 0 0 0-2.25 2.25v11.25c0 1.24 1.01 2.25 2.25 2.25h10.5a2.25 2.25 0 0 0 2.25-2.25V6.75a2.25 2.25 0 0 0-2.25-2.25H15M12 15V3.75m0 0L9.75 6m2.25-2.25L14.25 6" />
  </svg>
);

```


---

## `./components/icons/ArrowDownTrayIcon.tsx`

```tsx

import React from 'react';

export const ArrowDownTrayIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
  </svg>
);

```


---

## `./components/icons/ArrowLeftIcon.tsx`

```tsx
import React from 'react';

export const ArrowLeftIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
  </svg>
);
```


---

## `./components/icons/ArrowPathIcon.tsx`

```tsx

import React from 'react';

export const ArrowPathIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 11.667 0l3.181-3.183m-4.991-2.691L7.985 5.985m0 0A8.25 8.25 0 0 1 19.644 2.985l.005.005m-4.992 2.691h4.992" />
  </svg>
);

```


---

## `./components/icons/ArrowRightIcon.tsx`

```tsx
import React from 'react';

export const ArrowRightIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
  </svg>
);

```


---

## `./components/icons/ArrowUpTrayIcon.tsx`

```tsx
import React from 'react';

export const ArrowUpTrayIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
  </svg>
);

```


---

## `./components/icons/BackspaceIcon.tsx`

```tsx
import React from 'react';

export const BackspaceIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9.75 14.25 12m0 0 2.25 2.25M14.25 12l2.25-2.25M14.25 12 12 14.25m-2.58 4.92-6.374-6.375a1.125 1.125 0 0 1 0-1.59L9.42 4.83c.21-.211.497-.33.795-.33H19.5a2.25 2.25 0 0 1 2.25 2.25v10.5a2.25 2.25 0 0 1-2.25 2.25h-9.284c-.298 0-.585-.119-.795-.33Z" />
  </svg>
);
```


---

## `./components/icons/CalendarDaysIcon.tsx`

```tsx

import React from 'react';

export const CalendarDaysIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0h18M7.5 12h.008v.008H7.5V12Zm3 0h.008v.008H10.5V12Zm3 0h.008v.008H13.5V12Z" />
  </svg>
);

```


---

## `./components/icons/CalendarIcon.tsx`

```tsx
import React from 'react';

export const CalendarIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0h18" />
  </svg>
);
```


---

## `./components/icons/CameraIcon.tsx`

```tsx
import React from 'react';

export const CameraIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.776 48.776 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM18.75 10.5h.008v.008h-.008V10.5Z" />
  </svg>
);
```


---

## `./components/icons/ChartPieIcon.tsx`

```tsx
import React from 'react';

export const ChartPieIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6a7.5 7.5 0 1 0 7.5 7.5h-7.5V6Z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5H21A7.5 7.5 0 0 0 13.5 3v7.5Z" />
  </svg>
);
```


---

## `./components/icons/CheckCircleIcon.tsx`

```tsx

import React from 'react';

export const CheckCircleIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
  </svg>
);
```


---

## `./components/icons/CheckIcon.tsx`

```tsx

import React from 'react';

export const CheckIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
  </svg>
);

```


---

## `./components/icons/ChevronDownIcon.tsx`

```tsx



import React from 'react';

export const ChevronDownIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
  </svg>
);
```


---

## `./components/icons/ChevronLeftIcon.tsx`

```tsx

import React from 'react';

export const ChevronLeftIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
  </svg>
);

```


---

## `./components/icons/ChevronRightIcon.tsx`

```tsx
import React from 'react';

export const ChevronRightIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
  </svg>
);
```


---

## `./components/icons/ClipboardDocumentCheckIcon.tsx`

```tsx

import React from 'react';

export const ClipboardDocumentCheckIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M10.125 2.25h-4.5c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125v-9M10.125 2.25h.375a9 9 0 0 1 9 9v.375M10.125 2.25A3.375 3.375 0 0 1 13.5 5.625v1.5c0 .621.504 1.125 1.125 1.125h1.5a3.375 3.375 0 0 1 3.375 3.375M9 15l2.25 2.25L15 12" />
  </svg>
);

```


---

## `./components/icons/ClipboardDocumentIcon.tsx`

```tsx

import React from 'react';

export const ClipboardDocumentIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a2.25 2.25 0 0 1-2.25 2.25h-1.5a2.25 2.25 0 0 1-2.25-2.25v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" />
  </svg>
);

```


---

## `./components/icons/ClockIcon.tsx`

```tsx
import React from 'react';

export const ClockIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
  </svg>
);
```


---

## `./components/icons/CloudArrowUpIcon.tsx`

```tsx
import React from 'react';

export const CloudArrowUpIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75Z" />
  </svg>
);
```


---

## `./components/icons/ComputerDesktopIcon.tsx`

```tsx
import React from 'react';

export const ComputerDesktopIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25A2.25 2.25 0 0 1 5.25 3h13.5A2.25 2.25 0 0 1 21 5.25Z" />
  </svg>
);
```


---

## `./components/icons/CreditCardIcon.tsx`

```tsx

import React from 'react';

export const CreditCardIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15A2.25 2.25 0 0 0 2.25 6.75v10.5A2.25 2.25 0 0 0 4.5 19.5Z" />
  </svg>
);

```


---

## `./components/icons/CurrencyEuroIcon.tsx`

```tsx
import React from 'react';

export const CurrencyEuroIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M14.25 7.756a4.5 4.5 0 1 0 0 8.488M7.5 10.5h5.25m-5.25 3h5.25M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
  </svg>
);
```


---

## `./components/icons/DocumentTextIcon.tsx`

```tsx
import React from 'react';

export const DocumentTextIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
  </svg>
);
```


---

## `./components/icons/EnvelopeIcon.tsx`

```tsx
import React from 'react';

export const EnvelopeIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
  </svg>
);

```


---

## `./components/icons/ExclamationTriangleIcon.tsx`

```tsx
import React from 'react';

export const ExclamationTriangleIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
  </svg>
);
```


---

## `./components/icons/FilterIcon.tsx`

```tsx
import React from 'react';

export const FilterIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 0 1-.659 1.591l-5.432 5.432a2.25 2.25 0 0 0-.659 1.591v2.927a2.25 2.25 0 0 1-1.244 2.013L9.75 21v-6.572a2.25 2.25 0 0 0-.659-1.591L3.659 7.409A2.25 2.25 0 0 1 3 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0 1 12 3Z" />
  </svg>
);
```


---

## `./components/icons/FingerprintIcon.tsx`

```tsx
import React from 'react';

export const FingerprintIcon: React.FC<React.SVGProps<SVGSVGElement>> = () => null;

```


---

## `./components/icons/HomeNavIcon.tsx`

```tsx
import React from 'react';

export const HomeNavIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
  </svg>
);
```


---

## `./components/icons/InformationCircleIcon.tsx`

```tsx
import React from 'react';

export const InformationCircleIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
  </svg>
);
```


---

## `./components/icons/KeypadIcon.tsx`

```tsx
import React from 'react';

export const KeypadIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h3m-3 12h3m-10.5-6h18m-18 3h18m-18-6h18m-18 3h18M3 6.75h18M3 17.25h18" />
  </svg>
);
```


---

## `./components/icons/LockClosedIcon.tsx`

```tsx
import React from 'react';

export const LockClosedIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 0 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
  </svg>
);
```


---

## `./components/icons/MagnifyingGlassIcon.tsx`

```tsx

import React from 'react';

export const MagnifyingGlassIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
  </svg>
);

```


---

## `./components/icons/MicrophoneIcon.tsx`

```tsx
import React from 'react';

export const MicrophoneIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 0 1 6 0v8.25a3 3 0 0 1-3 3Z" />
  </svg>
);
```


---

## `./components/icons/PencilIcon.tsx`

```tsx

import React from 'react';

export const PencilIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" />
  </svg>
);
```


---

## `./components/icons/PencilSquareIcon.tsx`

```tsx
import React from 'react';

export const PencilSquareIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
  </svg>
);
```


---

## `./components/icons/PhoneIcon.tsx`

```tsx
import React from 'react';

export const PhoneIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
  </svg>
);
```


---

## `./components/icons/PhotoIcon.tsx`

```tsx
import React from 'react';

export const PhotoIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm16.5-16.5h.008v.008h-.008V4.5Z" />
  </svg>
);
```


---

## `./components/icons/PlusCircleIcon.tsx`

```tsx

import React from 'react';

export const PlusCircleIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v6m3-3H9m12 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
  </svg>
);
```


---

## `./components/icons/PlusIcon.tsx`

```tsx
import React from 'react';

export const PlusIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
  </svg>
);
```


---

## `./components/icons/SoundWaveIcon.tsx`

```tsx
import React from 'react';

export const SoundWaveIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 7.5V16.5M12 4.5V19.5M15.75 7.5V16.5M3.75 12H6M18 12h2.25" />
  </svg>
);
```


---

## `./components/icons/SpinnerIcon.tsx`

```tsx

import React from 'react';

export const SpinnerIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
    <svg 
        className="animate-spin" 
        xmlns="http://www.w3.org/2000/svg" 
        fill="none" 
        viewBox="0 0 24 24"
        {...props}
    >
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
);
```


---

## `./components/icons/TagIcon.tsx`

```tsx
import React from 'react';

export const TagIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3Z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6Z" />
  </svg>
);
```


---

## `./components/icons/TrashIcon.tsx`

```tsx

import React from 'react';

export const TrashIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
  </svg>
);
```


---

## `./components/icons/WalletIcon.tsx`

```tsx

import React from 'react';

export const WalletIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 12m18 0v6a2.25 2.25 0 0 1-2.25-2.25H5.25A2.25 2.25 0 0 1 3 18v-6m18 0V9M3 12V9m18 3a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 12m15.75 0-3.75-3.75" />
  </svg>
);
```


---

## `./components/icons/XMarkIcon.tsx`

```tsx
import React from 'react';

export const XMarkIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
  </svg>
);
```


---

## `./components/icons/categories/AllIcon.tsx`

```tsx

import React from 'react';

export const AllIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
  </svg>
);
```


---

## `./components/icons/categories/EducationIcon.tsx`

```tsx

import React from 'react';

export const EducationIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path d="M12 14l9-5-9-5-9 5 9 5z" />
    <path d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 14v6m-6-3.837V11.163m12 0v2.674" />
  </svg>
);
```


---

## `./components/icons/categories/FoodIcon.tsx`

```tsx

import React from 'react';

export const FoodIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 0 0-3 3h15.75m-12.75-3h11.218c.51 0 .962-.343 1.087-.835l.383-1.437M7.5 14.25V5.106c0-.612.501-1.106 1.106-1.106H15.894c.612 0 1.106.501 1.106 1.106v9.144M7.5 14.25h6.75" />
  </svg>
);
```


---

## `./components/icons/categories/HealthIcon.tsx`

```tsx

import React from 'react';

export const HealthIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z" />
  </svg>
);
```


---

## `./components/icons/categories/HomeIcon.tsx`

```tsx

import React from 'react';

export const HomeIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
  </svg>
);
```


---

## `./components/icons/categories/LeisureIcon.tsx`

```tsx

import React from 'react';

export const LeisureIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
  </svg>
);
```


---

## `./components/icons/categories/OtherIcon.tsx`

```tsx
import React from 'react';

export const OtherIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 8.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25v2.25A2.25 2.25 0 0 1 8.25 20.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6A2.25 2.25 0 0 1 15.75 3.75h2.25A2.25 2.25 0 0 1 20.25 6v2.25a2.25 2.25 0 0 1-2.25 2.25H15.75A2.25 2.25 0 0 1 13.5 8.25V6ZM13.5 15.75A2.25 2.25 0 0 1 15.75 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25v2.25A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z" />
  </svg>
);

```


---

## `./components/icons/categories/ShoppingIcon.tsx`

```tsx

import React from 'react';

export const ShoppingIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 1 0-7.5 0v4.5m11.356-1.993 1.263 12c.07.658-.463 1.243-1.119 1.243H4.25a1.125 1.125 0 0 1-1.12-1.243l1.264-12A1.125 1.125 0 0 1 5.513 7.5h12.974c.576 0 1.059.435 1.119 1.007ZM8.625 10.5a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm7.5 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
  </svg>
);
```


---

## `./components/icons/categories/TransportIcon.tsx`

```tsx

import React from 'react';

export const TransportIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 0 1-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h1.125c.621 0 1.125-.504 1.125-1.125V14.25m-17.25 4.5v-1.875a3.375 3.375 0 0 1 3.375-3.375h9.75a3.375 3.375 0 0 1 3.375 3.375v1.875M3.375 14.25v-2.625A3.375 3.375 0 0 1 6.75 8.25h9.75a3.375 3.375 0 0 1 3.375 3.375v2.625m-16.5 0h16.5" />
  </svg>
);
```


---

## `./components/icons/categories/WorkIcon.tsx`

```tsx

import React from 'react';

export const WorkIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.05a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V8.25a2.25 2.25 0 0 1 2.25-2.25h15.5a2.25 2.25 0 0 1 2.25 2.25v2.15m-15.75-6.04 4.03-3.11a2.25 2.25 0 0 1 2.86 0l4.03 3.11M18 9a3 3 0 1 0-6 0 3 3 0 0 0 6 0Z" />
  </svg>
);
```


---

## `./components/icons/formatters.ts`

```ts


export const formatCurrency = (amount: number): string => {
  const numericAmount = (typeof amount === 'number' && !isNaN(amount)) ? amount : 0;

  const isInteger = numericAmount % 1 === 0;

  const options: Intl.NumberFormatOptions = {
    style: 'decimal',
  };

  if (isInteger) {
    options.minimumFractionDigits = 0;
    options.maximumFractionDigits = 0;
  } else {
    options.minimumFractionDigits = 2;
    options.maximumFractionDigits = 2;
  }

  const formattedAmount = new Intl.NumberFormat('it-IT', options).format(numericAmount);
  return `€ ${formattedAmount}`;
};

export const formatDate = (date: Date): string => {
  const options: Intl.DateTimeFormatOptions = {
    year: '2-digit',
    month: 'short',
    day: 'numeric',
  };
  const formatter = new Intl.DateTimeFormat('it-IT', options);
  // Usiamo formatToParts per poter aggiungere il punto al mese abbreviato.
  // Questo approccio è robusto e rispetta l'ordine dei componenti della data per la lingua specificata.
  return formatter.formatToParts(date).map(({ type, value }) => {
    if (type === 'month') {
      return `${value}.`;
    }
    return value;
  }).join('');
};

```


---

## `./hooks/useLeftSwipeFromRightEdge.ts`

```ts

```


---

## `./hooks/useLeftSwipeFromRightEdge_v2.ts`

```ts

```


---

## `./hooks/useLocalStorage.ts`

```ts
import { useState, useEffect, Dispatch, SetStateAction } from 'react';

export function useLocalStorage<T>(key: string, initialValue: T): [T, Dispatch<SetStateAction<T>>] {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.error(error);
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(storedValue));
    } catch (error) {
      console.error(error);
    }
  }, [key, storedValue]);

  return [storedValue, setStoredValue];
}
```


---

## `./hooks/useLongPress.ts`

```ts

```


---

## `./hooks/useOnlineStatus.ts`

```ts
import { useState, useEffect } from 'react';

export const useOnlineStatus = () => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
};
```


---

## `./hooks/useSheetDragControlled.ts`

```ts
import { RefObject, useEffect, useRef, useState } from 'react';

type Options = {
  triggerPercent?: number;      // frazione H() oltre cui chiudere (solo su release)
  elastic?: number;             // 0..1, 1 = senza attrito
  closeSpeedPxMs?: number;      // velocità “percepita” di chiusura
  openSpeedPxMs?: number;       // velocità “percepita” di ritorno
  topGuardPx?: number;          // tolleranza per considerare scrollTop “in cima”
  scrollableSelector?: string;  // selettore per l’area scrollabile interna
};

type Handlers = { onClose: () => void };

function findScrollable(root: HTMLElement | null, selector?: string): HTMLElement | null {
  if (!root) return null;
  if (selector) {
    const el = root.querySelector<HTMLElement>(selector);
    if (el) return el;
  }
  const q: HTMLElement[] = [root];
  while (q.length) {
    const n = q.shift()!;
    if (n !== root) {
      const s = getComputedStyle(n);
      if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && n.scrollHeight > n.clientHeight) return n;
    }
    q.push(...(Array.from(n.children) as HTMLElement[]));
  }
  return null;
}

export function useSheetDragControlled<T extends HTMLElement>(
  sheetRef: RefObject<T>,
  { onClose }: Handlers,
  opts: Options = {}
) {
  const {
    triggerPercent = 0.25,
    elastic = 0.92,
    closeSpeedPxMs = 2.2,   // più alto = più veloce
    openSpeedPxMs = 2.8,
    topGuardPx = 2,
    scrollableSelector,
  } = opts;

  const [dragY, setDragY] = useState(0);
  const [transitionMs, setTransitionMs] = useState(0);
  const easing = 'cubic-bezier(0.22, 0.61, 0.36, 1)';

  const g = useRef({
    active: false,
    tookOver: false,
    startX: 0,
    startY: 0,
    lastY: 0,
    lastT: 0,
    vy: 0, // Velocity in px/ms
    scroller: null as HTMLElement | null,
    closing: false,
    isLocked: false, // For gesture direction
  }).current;

  const H = () => (sheetRef.current?.clientHeight || 1);

  const animate = (from: number, to: number, speedPxMs: number, closing: boolean) => {
    const dist = Math.max(1, Math.abs(to - from));
    const ms = Math.max(100, Math.min(420, Math.round(dist / speedPxMs)));
    g.closing = closing;
    setTransitionMs(0);
    setDragY(from);
    requestAnimationFrame(() => {
      setTransitionMs(ms);
      setDragY(to);
    });
  };

  const handleTransitionEnd = (e?: TransitionEvent) => {
    if (e && e.propertyName && e.propertyName !== 'transform') return;
    if (g.closing) {
      g.closing = false;
      setTransitionMs(0);
      setDragY(0);
      onClose();
    } else {
      setTransitionMs(0);
    }
  };

  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;

    const onStart = (x: number, y: number) => {
      g.active = true;
      g.tookOver = false;
      g.isLocked = false;
      g.startX = x;
      g.startY = y;
      g.lastY = y;
      g.lastT = performance.now();
      g.vy = 0;
      g.scroller = findScrollable(sheet, scrollableSelector);
    };

    const onMove = (x: number, y: number, e: Event) => {
      if (!g.active) return;
      
      const t = performance.now();
      const dt = t - g.lastT;
      const dyInstant = y - g.lastY;

      if (dt > 1) { // Sample to avoid noisy data
        const velocity = dyInstant / dt;
        g.vy = g.vy * 0.8 + velocity * 0.2; // EMA smoothing
      }
      g.lastY = y;
      g.lastT = t;
      
      const dx = x - g.startX;
      const dy = y - g.startY;

      if (!g.isLocked) {
        const SLOP = 10;
        if (Math.abs(dx) <= SLOP && Math.abs(dy) <= SLOP) return;

        const isVertical = Math.abs(dy) > Math.abs(dx);
        if (!isVertical) {
            // Horizontal gesture, bail out.
            g.active = false;
            return;
        }
        g.isLocked = true; // Lock to vertical gesture
      }


      const atTop = !g.scroller || g.scroller.scrollTop <= topGuardPx;
      const movingDown = dy > 0;

      if (!g.tookOver && movingDown && atTop) {
        g.tookOver = true;
      }

      if (g.tookOver) {
        if ('preventDefault' in e && (e as any).cancelable) e.preventDefault();
        setTransitionMs(0); // segue il dito 1:1 (con elastic)
        const current = Math.max(0, dy) * elastic;
        setDragY(Math.min(current, H() * 0.98));
      }
    };

    const onEnd = () => {
      if (!g.active) return;
      g.active = false;

      if (g.tookOver) {
        const h = H();
        const currentY = dragY;

        // Check velocity for "flick" gesture
        const FLICK_VELOCITY_THRESHOLD = 0.3; // px/ms; adjusted to be more sensitive
        const isFlickDown = g.vy > FLICK_VELOCITY_THRESHOLD;

        const draggedFarEnough = currentY >= h * triggerPercent;

        const shouldClose = draggedFarEnough || isFlickDown;

        if (shouldClose) {
          const speed = isFlickDown ? closeSpeedPxMs * 1.5 : closeSpeedPxMs;
          animate(currentY, h, speed, true);  // Close
        } else {
          animate(currentY, 0, openSpeedPxMs, false);  // Return to top
        }
      }
    };

    // Prefer TOUCH events for reliability
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      onStart(e.touches[0].clientX, e.touches[0].clientY);
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!g.active || e.touches.length !== 1) return;
      onMove(e.touches[0].clientX, e.touches[0].clientY, e);
    };
    const onTouchEnd = () => onEnd();
    const onTouchCancel = () => onEnd();

    // Pointer fallback
    const onPointerDown = (e: PointerEvent) => onStart(e.clientX, e.clientY);
    const onPointerMove = (e: PointerEvent) => onMove(e.clientX, e.clientY, e);
    const onPointerUp = () => onEnd();
    const onPointerCancel = () => onEnd();

    // Listeners
    sheet.addEventListener('touchstart', onTouchStart, { passive: true });
    sheet.addEventListener('touchmove', onTouchMove, { passive: false });
    sheet.addEventListener('touchend', onTouchEnd, { passive: true });
    sheet.addEventListener('touchcancel', onTouchCancel, { passive: true });

    sheet.addEventListener('pointerdown', onPointerDown, { passive: true });
    sheet.addEventListener('pointermove', onPointerMove, { passive: false });
    sheet.addEventListener('pointerup', onPointerUp, { passive: true });
    sheet.addEventListener('pointercancel', onPointerCancel, { passive: true });

    return () => {
      sheet.removeEventListener('touchstart', onTouchStart as any);
      sheet.removeEventListener('touchmove', onTouchMove as any);
      sheet.removeEventListener('touchend', onTouchEnd as any);
      sheet.removeEventListener('touchcancel', onTouchCancel as any);

      sheet.removeEventListener('pointerdown', onPointerDown as any);
      sheet.removeEventListener('pointermove', onPointerMove as any);
      sheet.removeEventListener('pointerup', onPointerUp as any);
      sheet.removeEventListener('pointercancel', onPointerCancel as any);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetRef, onClose, triggerPercent, elastic, topGuardPx, scrollableSelector, dragY, closeSpeedPxMs, openSpeedPxMs]);

  return { dragY, transitionMs, easing, handleTransitionEnd };
}
```


---

## `./hooks/useSwipe.ts`

```ts
import * as React from 'react';

type SwipeOpts = {
  enabled?: boolean;
  slop?: number;
  threshold?: number;
  ignoreSelector?: string;
  disableDrag?: (intent: 'left' | 'right') => boolean;
};

type SwipeState = {
  pointerId: number | null;
  startX: number;
  startY: number;
  isSwiping: boolean;
  dir: 'left' | 'right' | null;
  blockedByIgnore: boolean;
  blockedByDisable: boolean;
};

export function useSwipe(
  ref: React.RefObject<HTMLElement>,
  handlers: { onSwipeLeft?: () => void; onSwipeRight?: () => void },
  opts: SwipeOpts = {}
) {
  const {
    enabled = true,
    slop = 10,
    threshold = 80,
    ignoreSelector,
    disableDrag,
  } = opts;

  const [progress, setProgress] = React.useState(0);
  const [isSwiping, setIsSwiping] = React.useState(false);

  const stateRef = React.useRef<SwipeState>({
    pointerId: null,
    startX: 0,
    startY: 0,
    isSwiping: false,
    dir: null,
    blockedByIgnore: false,
    blockedByDisable: false,
  });

  const resetState = React.useCallback(() => {
    const s = stateRef.current;
    s.pointerId = null;
    s.startX = 0;
    s.startY = 0;
    s.isSwiping = false;
    s.dir = null;
    s.blockedByIgnore = false;
    s.blockedByDisable = false;
    setProgress(0);
    setIsSwiping(false);
  }, []);

  React.useEffect(() => {
    const root = ref.current;
    if (!root) return;

    if (!enabled) {
      resetState();
      return;
    }

    const onDown = (ev: PointerEvent) => {
      if (!enabled) return;

      const s = stateRef.current;
      if (s.pointerId !== null) return; // already a gesture in progress

      const target = ev.target as HTMLElement | null;
      if (ignoreSelector && target && target.closest(ignoreSelector)) {
        s.pointerId = ev.pointerId;
        s.blockedByIgnore = true;
        s.blockedByDisable = false;
        s.isSwiping = false;
        s.dir = null;
        return;
      }

      s.pointerId = ev.pointerId;
      s.startX = ev.clientX;
      s.startY = ev.clientY;
      s.isSwiping = false;
      s.dir = null;
      s.blockedByIgnore = false;
      s.blockedByDisable = false;
    };

    const onMove = (ev: PointerEvent) => {
      const s = stateRef.current;
      if (s.pointerId !== ev.pointerId) return;
      if (s.blockedByIgnore || s.blockedByDisable) return;
      if (!enabled) return;

      const dx = ev.clientX - s.startX;
      const dy = ev.clientY - s.startY;

      if (!s.isSwiping) {
        const dist = Math.hypot(dx, dy);
        if (dist < slop) return;

        // If vertical movement is dominant, let the browser handle scrolling
        if (Math.abs(dy) > Math.abs(dx) * 2) {
          resetState();
          return;
        }

        const intent: 'left' | 'right' = dx < 0 ? 'left' : 'right';

        if (disableDrag && disableDrag(intent)) {
          s.blockedByDisable = true;
          resetState();
          return;
        }

        s.isSwiping = true;
        s.dir = intent;
        setIsSwiping(true);
      }

      if (!s.isSwiping) return;
      
      const containerWidth = ref.current?.offsetWidth || window.innerWidth;
      if (containerWidth > 0) {
        const currentDx = ev.clientX - s.startX;
        const progressValue = currentDx / containerWidth;
        setProgress(progressValue);
      }
    };

    const onUp = (ev: PointerEvent) => {
      const s = stateRef.current;
      if (s.pointerId !== ev.pointerId) return;

      const canTrigger =
        s.isSwiping && !s.blockedByIgnore && !s.blockedByDisable;

      if (canTrigger) {
        const dx = ev.clientX - s.startX;
        if (Math.abs(dx) >= threshold) {
            if (dx < 0 && handlers.onSwipeLeft) {
                handlers.onSwipeLeft();
            } else if (dx > 0 && handlers.onSwipeRight) {
                handlers.onSwipeRight();
            }
        }
      }

      resetState();
    };

    const onCancel = (ev: PointerEvent) => {
      const s = stateRef.current;
      if (s.pointerId !== ev.pointerId) return;
      resetState();
    };

    root.addEventListener('pointerdown', onDown, { passive: true });
    root.addEventListener('pointermove', onMove, { passive: true });
    root.addEventListener('pointerup', onUp, { passive: true });
    root.addEventListener('pointercancel', onCancel, { passive: true });

    return () => {
      root.removeEventListener('pointerdown', onDown as any);
      root.removeEventListener('pointermove', onMove as any);
      root.removeEventListener('pointerup', onUp as any);
      root.removeEventListener('pointercancel', onCancel as any);
    };
  }, [
    ref,
    enabled,
    slop,
    threshold,
    ignoreSelector,
    disableDrag,
    handlers.onSwipeLeft,
    handlers.onSwipeRight,
    resetState,
  ]);

  return { progress, isSwiping };
}

```


---

## `./hooks/useSwipeDownCloseAtTop.ts`

```ts

```


---

## `./hooks/useTapBridge.ts`

```ts

import React, { useRef, useCallback } from 'react';

type Options = {
  slopPx?: number; // quanto puoi muoverti (in px) e restare un tap
  tapMs?: number;  // durata massima del tap
};

/**
 * TapBridge: gestisce i TAP (tocchi singoli)
 * - Evita il "primo tap a vuoto"
 * - Sopprime il doppio click nativo
 * - Gestisce il "Ghost Click" intercettando il click nativo successivo a livello globale
 */
export function useTapBridge(opts: Options = {}) {
  const SLOP = opts.slopPx ?? 10;
  const TAP_MS = opts.tapMs ?? 350;

  const stateRef = useRef({
    id: null as number | null,
    t0: 0,
    x0: 0,
    y0: 0,
    target: null as EventTarget | null,
  });

  // Strategia "Ghost Click Buster": intercetta il prossimo click nativo fidato e lo uccide.
  const preventGhostClick = useCallback(() => {
    const handler = (e: Event) => {
      // Interrompiamo solo i click "fidati" (generati dal browser/utente),
      // lasciando passare quelli sintetici (che non sono trusted).
      if (e.isTrusted) {
        e.stopPropagation();
        e.preventDefault();
        window.removeEventListener('click', handler, true);
      }
    };

    // Usa capture: true per intercettare l'evento prima che scenda nel DOM
    window.addEventListener('click', handler, { capture: true, once: false });

    // Rimuovi il listener dopo un tempo sufficiente a coprire il ritardo del browser (circa 300-400ms)
    setTimeout(() => {
      window.removeEventListener('click', handler, true);
    }, 600);
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const state = stateRef.current;

    if (state.id !== null && e.pointerId !== state.id) return;

    state.id = e.pointerId;
    state.t0 = performance.now();
    state.x0 = e.clientX;
    state.y0 = e.clientY;
    state.target = e.target;
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const state = stateRef.current;
    if (state.id !== e.pointerId) return;
    // NON facciamo nulla qui: gli swipe restano liberi
  }, []);

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const state = stateRef.current;
      if (state.id !== e.pointerId) return;

      const dt = performance.now() - state.t0;
      const dx = Math.abs(e.clientX - state.x0);
      const dy = Math.abs(e.clientY - state.y0);
      const target = state.target as HTMLElement | null;

      state.id = null;

      const isTap = dt < TAP_MS && dx <= SLOP && dy <= SLOP;

      if (isTap && target && !target.closest?.('[data-no-synthetic-click]')) {
        // 1. Previeni il comportamento predefinito se possibile (aiuta a sopprimere click e focus nativi indesiderati)
        if (e.cancelable) e.preventDefault();

        // 2. Attiva il buster globale per uccidere il click nativo ritardato che il browser potrebbe comunque generare
        preventGhostClick();

        // 3. Gestione Focus manuale per input
        if (
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          (target as any).isContentEditable
        ) {
          if (document.activeElement !== target) {
            target.focus();
          }
        }

        // 4. Dispatch evento Click Sintetico immediato
        const clickEvent = new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: window,
        });
        target.dispatchEvent(clickEvent);
      }

      state.target = null;
    },
    [SLOP, TAP_MS, preventGhostClick],
  );

  const onPointerCancel = useCallback((e: React.PointerEvent) => {
    const state = stateRef.current;
    if (state.id === e.pointerId) {
      state.id = null;
      state.target = null;
    }
  }, []);

  // onClickCapture non è più strettamente necessario con il buster globale,
  // ma lo lasciamo vuoto per mantenere l'interfaccia del hook.
  const onClickCapture = useCallback((e: React.MouseEvent) => {
    // No-op
  }, []);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onClickCapture,
  };
}

```


---

## `./icon-192.svg`

```svg
<?xml version="1.0" encoding="utf-8"?>
<!-- Uploaded to: SVG Repo, www.svgrepo.com, Generator: SVG Repo Mixer Tools -->
<svg version="1.0" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" 
	 width="192" height="192" viewBox="0 0 64 64" enable-background="new 0 0 64 64" xml:space="preserve">
<g>
	<path fill="#F9EBB2" d="M43.025,2.123c1.039-0.379,2.186,0.156,2.564,1.195L48.75,12h-6.098C41.826,9.671,39.611,8,37,8
		s-4.826,1.672-5.65,4H15.885L43.025,2.123z"/>
	<path fill="#F76D57" d="M40.445,12h-6.891c0.693-1.189,1.969-2,3.445-2S39.752,10.81,40.445,12z"/>
	<g>
		<path fill="#506C7F" d="M53.463,6.394c-0.527-0.471-1.342-0.4-1.348-0.4C52.045,6,50.816,6.128,48.814,6.332L50.879,12H54V8
			C54,7.253,53.82,6.712,53.463,6.394z"/>
		<path fill="#506C7F" d="M2.658,12.248C3.079,12.097,3.527,12,4,12h6.038l6.351-2.311c-5.357,0.561-9.894,1.039-12.278,1.305
			C3.432,11.07,2.972,11.599,2.658,12.248z"/>
	</g>
	<path fill="#45AAB8" d="M58,60c0,1.105-0.895,2-2,2H4c-1.104,0-2-0.895-2-2V16c0-1.104,0.896-2,2-2h52c1.105,0,2,0.896,2,2v16H42
		c-1.105,0-2,0.895-2,2v8c0,1.105,0.895,2,2,2h16V60z"/>
	<path fill="#B4CCB9" d="M62,41c0,0.553-0.447,1-1,1H43c-0.553,0-1-0.447-1-1v-6c0-0.553,0.447-1,1-1h18c0.553,0,1,0.447,1,1V41z"/>
	<g>
		<path fill="#394240" d="M62,32h-2V16c0-2.211-1.789-4-4-4V8c0-1.342-0.404-2.385-1.205-3.098c-1.186-1.059-2.736-0.91-2.896-0.896
			c-0.072,0.006-1.484,0.152-3.789,0.389l-0.641-1.76c-0.756-2.078-3.049-3.148-5.127-2.391L24.131,6.871
			C15.535,7.763,7.397,8.617,3.89,9.005C0.951,9.332,0.062,12.908,0,14.97C-0.003,15.103,0,60,0,60c0,2.211,1.789,4,4,4h52
			c2.211,0,4-1.789,4-4V44h2c1.105,0,2-0.895,2-2v-8C64,32.895,63.105,32,62,32z M52.115,5.994c0.006,0,0.82-0.07,1.348,0.4
			C53.82,6.712,54,7.253,54,8v4h-3.121l-2.064-5.668C50.816,6.128,52.045,6,52.115,5.994z M43.025,2.123
			c1.039-0.379,2.186,0.156,2.564,1.195L48.75,12h-6.098C41.826,9.671,39.611,8,37,8s-4.826,1.672-5.65,4H15.885L43.025,2.123z
			 M40.445,12h-6.891c0.693-1.189,1.969-2,3.445-2S39.752,10.81,40.445,12z M4.111,10.994c2.385-0.266,6.921-0.744,12.278-1.305
			L10.039,12H4c-0.474,0-0.922,0.098-1.343,0.248C2.972,11.599,3.432,11.07,4.111,10.994z M58,60c0,1.105-0.895,2-2,2H4
			c-1.104,0-2-0.895-2-2V16c0-1.104,0.896-2,2-2h52c1.105,0,2,0.896,2,2v16H42c-1.105,0-2,0.895-2,2v8c0,1.105,0.895,2,2,2h16V60z
			 M62,41c0,0.553-0.447,1-1,1H43c-0.553,0-1-0.447-1-1v-6c0-0.553,0.447-1,1-1h18c0.553,0,1,0.447,1,1V41z"/>
		<circle fill="#394240" cx="46" cy="38" r="2"/>
		<path fill="#394240" d="M53,20h2c0.553,0,1-0.447,1-1s-0.447-1-1-1h-2c-0.553,0-1,0.447-1,1S52.447,20,53,20z"/>
		<path fill="#394240" d="M47,20h2c0.553,0,1-0.447,1-1s-0.447-1-1-1h-2c-0.553,0-1,0.447-1,1S46.447,20,47,20z"/>
		<path fill="#394240" d="M41,20h2c0.553,0,1-0.447,1-1s-0.447-1-1-1h-2c-0.553,0-1,0.447-1,1S40.447,20,41,20z"/>
		<path fill="#394240" d="M37,18h-2c-0.553,0-1,0.447-1,1s0.447,1,1,1h2c0.553,0,1-0.447,1-1S37.553,18,37,18z"/>
		<path fill="#394240" d="M31,18h-2c-0.553,0-1,0.447-1,1s0.447,1,1,1h2c0.553,0,1-0.447,1-1S31.553,18,31,18z"/>
		<path fill="#394240" d="M25,18h-2c-0.553,0-1,0.447-1,1s0.447,1,1,1h2c0.553,0,1-0.447,1-1S25.553,18,25,18z"/>
		<path fill="#394240" d="M19,18h-2c-0.552,0-1,0.447-1,1s0.447,1,1,1h2c0.553,0,1-0.447,1-1S19.553,18,19,18z"/>
		<path fill="#394240" d="M13,18h-2c-0.553,0-1,0.447-1,1s0.447,1,1,1h2c0.553,0,1-0.447,1-1S13.553,18,13,18z"/>
		<path fill="#394240" d="M7,18H5c-0.553,0-1,0.447-1,1s0.447,1,1,1h2c0.553,0,1-0.447,1-1S7.553,18,7,18z"/>
		<path fill="#394240" d="M53,58h2c0.553,0,1-0.447,1-1s-0.447-1-1-1h-2c-0.553,0-1,0.447-1,1S52.447,58,53,58z"/>
		<path fill="#394240" d="M47,58h2c0.553,0,1-0.447,1-1s-0.447-1-1-1h-2c-0.553,0-1,0.447-1,1S46.447,58,47,58z"/>
		<path fill="#394240" d="M40,57c0,0.553,0.447,1,1,1h2c0.553,0,1-0.447,1-1s-0.447-1-1-1h-2C40.447,56,40,56.447,40,57z"/>
		<path fill="#394240" d="M37,56h-2c-0.553,0-1,0.447-1,1s0.447,1,1,1h2c0.553,0,1-0.447,1-1S37.553,56,37,56z"/>
		<path fill="#394240" d="M31,56h-2c-0.553,0-1,0.447-1,1s0.447,1,1,1h2c0.553,0,1-0.447,1-1S31.553,56,31,56z"/>
		<path fill="#394240" d="M25,56h-2c-0.553,0-1,0.447-1,1s0.447,1,1,1h2c0.553,0,1-0.447,1-1S25.553,56,25,56z"/>
		<path fill="#394240" d="M19,56h-2c-0.552,0-1,0.447-1,1s0.447,1,1,1h2c0.553,0,1-0.447,1-1S19.553,56,19,56z"/>
		<path fill="#394240" d="M13,56h-2c-0.553,0-1,0.447-1,1s0.447,1,1,1h2c0.553,0,1-0.447,1-1S13.553,56,13,56z"/>
		<path fill="#394240" d="M7,56H5c-0.553,0-1,0.447-1,1s0.447,1,1,1h2c0.553,0,1-0.447,1-1S7.553,56,7,56z"/>
	</g>
</g>
</svg>

```


---

## `./icon-512.svg`

```svg
<?xml version="1.0" encoding="utf-8"?>
<!-- Uploaded to: SVG Repo, www.svgrepo.com, Generator: SVG Repo Mixer Tools -->
<svg version="1.0" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" 
	 width="512" height="512" viewBox="0 0 64 64" enable-background="new 0 0 64 64" xml:space="preserve">
<g>
	<path fill="#F9EBB2" d="M43.025,2.123c1.039-0.379,2.186,0.156,2.564,1.195L48.75,12h-6.098C41.826,9.671,39.611,8,37,8
		s-4.826,1.672-5.65,4H15.885L43.025,2.123z"/>
	<path fill="#F76D57" d="M40.445,12h-6.891c0.693-1.189,1.969-2,3.445-2S39.752,10.81,40.445,12z"/>
	<g>
		<path fill="#506C7F" d="M53.463,6.394c-0.527-0.471-1.342-0.4-1.348-0.4C52.045,6,50.816,6.128,48.814,6.332L50.879,12H54V8
			C54,7.253,53.82,6.712,53.463,6.394z"/>
		<path fill="#506C7F" d="M2.658,12.248C3.079,12.097,3.527,12,4,12h6.038l6.351-2.311c-5.357,0.561-9.894,1.039-12.278,1.305
			C3.432,11.07,2.972,11.599,2.658,12.248z"/>
	</g>
	<path fill="#45AAB8" d="M58,60c0,1.105-0.895,2-2,2H4c-1.104,0-2-0.895-2-2V16c0-1.104,0.896-2,2-2h52c1.105,0,2,0.896,2,2v16H42
		c-1.105,0-2,0.895-2,2v8c0,1.105,0.895,2,2,2h16V60z"/>
	<path fill="#B4CCB9" d="M62,41c0,0.553-0.447,1-1,1H43c-0.553,0-1-0.447-1-1v-6c0-0.553,0.447-1,1-1h18c0.553,0,1,0.447,1,1V41z"/>
	<g>
		<path fill="#394240" d="M62,32h-2V16c0-2.211-1.789-4-4-4V8c0-1.342-0.404-2.385-1.205-3.098c-1.186-1.059-2.736-0.91-2.896-0.896
			c-0.072,0.006-1.484,0.152-3.789,0.389l-0.641-1.76c-0.756-2.078-3.049-3.148-5.127-2.391L24.131,6.871
			C15.535,7.763,7.397,8.617,3.89,9.005C0.951,9.332,0.062,12.908,0,14.97C-0.003,15.103,0,60,0,60c0,2.211,1.789,4,4,4h52
			c2.211,0,4-1.789,4-4V44h2c1.105,0,2-0.895,2-2v-8C64,32.895,63.105,32,62,32z M52.115,5.994c0.006,0,0.82-0.07,1.348,0.4
			C53.82,6.712,54,7.253,54,8v4h-3.121l-2.064-5.668C50.816,6.128,52.045,6,52.115,5.994z M43.025,2.123
			c1.039-0.379,2.186,0.156,2.564,1.195L48.75,12h-6.098C41.826,9.671,39.611,8,37,8s-4.826,1.672-5.65,4H15.885L43.025,2.123z
			 M40.445,12h-6.891c0.693-1.189,1.969-2,3.445-2S39.752,10.81,40.445,12z M4.111,10.994c2.385-0.266,6.921-0.744,12.278-1.305
			L10.039,12H4c-0.474,0-0.922,0.098-1.343,0.248C2.972,11.599,3.432,11.07,4.111,10.994z M58,60c0,1.105-0.895,2-2,2H4
			c-1.104,0-2-0.895-2-2V16c0-1.104,0.896-2,2-2h52c1.105,0,2,0.896,2,2v16H42c-1.105,0-2,0.895-2,2v8c0,1.105,0.895,2,2,2h16V60z
			 M62,41c0,0.553-0.447,1-1,1H43c-0.553,0-1-0.447-1-1v-6c0-0.553,0.447-1,1-1h18c0.553,0,1,0.447,1,1V41z"/>
		<circle fill="#394240" cx="46" cy="38" r="2"/>
		<path fill="#394240" d="M53,20h2c0.553,0,1-0.447,1-1s-0.447-1-1-1h-2c-0.553,0-1,0.447-1,1S52.447,20,53,20z"/>
		<path fill="#394240" d="M47,20h2c0.553,0,1-0.447,1-1s-0.447-1-1-1h-2c-0.553,0-1,0.447-1,1S46.447,20,47,20z"/>
		<path fill="#394240" d="M41,20h2c0.553,0,1-0.447,1-1s-0.447-1-1-1h-2c-0.553,0-1,0.447-1,1S40.447,20,41,20z"/>
		<path fill="#394240" d="M37,18h-2c-0.553,0-1,0.447-1,1s0.447,1,1,1h2c0.553,0,1-0.447,1-1S37.553,18,37,18z"/>
		<path fill="#394240" d="M31,18h-2c-0.553,0-1,0.447-1,1s0.447,1,1,1h2c0.553,0,1-0.447,1-1S31.553,18,31,18z"/>
		<path fill="#394240" d="M25,18h-2c-0.553,0-1,0.447-1,1s0.447,1,1,1h2c0.553,0,1-0.447,1-1S25.553,18,25,18z"/>
		<path fill="#394240" d="M19,18h-2c-0.552,0-1,0.447-1,1s0.447,1,1,1h2c0.553,0,1-0.447,1-1S19.553,18,19,18z"/>
		<path fill="#394240" d="M13,18h-2c-0.553,0-1,0.447-1,1s0.447,1,1,1h2c0.553,0,1-0.447,1-1S13.553,18,13,18z"/>
		<path fill="#394240" d="M7,18H5c-0.553,0-1,0.447-1,1s0.447,1,1,1h2c0.553,0,1-0.447,1-1S7.553,18,7,18z"/>
		<path fill="#394240" d="M53,58h2c0.553,0,1-0.447,1-1s-0.447-1-1-1h-2c-0.553,0-1,0.447-1,1S52.447,58,53,58z"/>
		<path fill="#394240" d="M47,58h2c0.553,0,1-0.447,1-1s-0.447-1-1-1h-2c-0.553,0-1,0.447-1,1S46.447,58,47,58z"/>
		<path fill="#394240" d="M40,57c0,0.553,0.447,1,1,1h2c0.553,0,1-0.447,1-1s-0.447-1-1-1h-2C40.447,56,40,56.447,40,57z"/>
		<path fill="#394240" d="M37,56h-2c-0.553,0-1,0.447-1,1s0.447,1,1,1h2c0.553,0,1-0.447,1-1S37.553,56,37,56z"/>
		<path fill="#394240" d="M31,56h-2c-0.553,0-1,0.447-1,1s0.447,1,1,1h2c0.553,0,1-0.447,1-1S31.553,56,31,56z"/>
		<path fill="#394240" d="M25,56h-2c-0.553,0-1,0.447-1,1s0.447,1,1,1h2c0.553,0,1-0.447,1-1S25.553,56,25,56z"/>
		<path fill="#394240" d="M19,56h-2c-0.552,0-1,0.447-1,1s0.447,1,1,1h2c0.553,0,1-0.447,1-1S19.553,56,19,56z"/>
		<path fill="#394240" d="M13,56h-2c-0.553,0-1,0.447-1,1s0.447,1,1,1h2c0.553,0,1-0.447,1-1S13.553,56,13,56z"/>
		<path fill="#394240" d="M7,56H5c-0.553,0-1,0.447-1,1s0.447,1,1,1h2c0.553,0,1-0.447,1-1S7.553,56,7,56z"/>
	</g>
</g>
</svg>

```


---

## `./index.html`

```html
<!DOCTYPE html>
<html lang="it">
  <head>
    <meta charset="UTF--8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <title>Gestore Spese - Nuovo Inizio</title>
    <link rel="manifest" href="/manifest.json" />
    <meta name="theme-color" content="#4f46e5" />
    <script src="https://cdn.tailwindcss.com"></script>
    <script type="importmap">
{
  "imports": {
    "react": "https://esm.sh/react@18.3.1",
    "react-dom/client": "https://esm.sh/react-dom@18.3.1/client",
    "react/": "https://esm.sh/react@18.3.1/",
    "react-dom/": "https://esm.sh/react-dom@18.3.1/",
    "@google/genai": "https://aistudiocdn.com/@google/genai@^1.21.0",
    "recharts": "https://esm.sh/recharts@2.12.7",
    "idb": "https://cdn.jsdelivr.net/npm/idb@8/+esm",
    "react-dom": "https://esm.sh/react-dom@18.3.1"
  }
}
</script>
    <style>
      html, body, #root {
        height: 100%;
        margin: 0;
        box-sizing: border-box;
      }
      body {
        padding-top: env(safe-area-inset-top, 0px);
        padding-right: env(safe-area-inset-right, 0px);
        padding-bottom: env(safe-area-inset-bottom, 0px);
        padding-left: env(safe-area-inset-left, 0px);
        overscroll-behavior-y: contain;
        touch-action: manipulation; /* Disables double-tap-to-zoom delay */
        -webkit-tap-highlight-color: transparent; /* Removes tap highlight on WebKit */
      }
      /* Fix for browser autofill background color */
      input:-webkit-autofill,
      input:-webkit-autofill:hover,
      input:-webkit-autofill:focus,
      input:-webkit-autofill:active {
          -webkit-box-shadow: 0 0 0 30px white inset !important;
          -webkit-text-fill-color: #0f172a !important; /* slate-900 */
      }
      @keyframes fade-in-up {
        from {
          opacity: 0;
          transform: translateY(20px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .animate-fade-in-up {
        animation: fade-in-up 0.08s ease-out forwards;
      }
      
      @keyframes fade-in-down {
        from {
          opacity: 0;
          transform: translateY(-20px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .animate-fade-in-down {
        animation: fade-in-down 0.08s ease-out forwards;
      }

      @keyframes pulse-subtle {
        0%, 100% {
          transform: scale(1) translateY(-50%);
          opacity: 0.8;
        }
        50% {
          transform: scale(1.05) translateY(-50%);
          opacity: 1;
        }
      }
      .animate-pulse-subtle {
        animation: pulse-subtle 2.5s ease-in-out infinite;
      }
      
      /* Definitive fix for Pie Chart focus outline */
      .recharts-pie-sector:focus,
      .recharts-pie-sector:focus-visible,
      .recharts-pie-sector path:focus,
      .recharts-pie-sector path:focus-visible {
        outline: none !important;
      }
      
      .swipe-container {
        display: flex;
        overflow-x: hidden;
        width: 100%;
        will-change: transform;
      }

      .swipe-view {
        width: 100%;
        flex-shrink: 0;
        will-change: transform;
      }

      /* Placeholder for contenteditable divs */
      [contenteditable][data-placeholder]:empty::before {
        content: attr(data-placeholder);
        color: #94a3b8; /* slate-400 */
        pointer-events: none;
      }

      .num-pad {
        touch-action: pan-y;
        overscroll-behavior-x: contain;
        -webkit-user-select: none;
        user-select: none;
      }

      /* Date Picker Swipe Animations */
      @keyframes slide-out-to-left {
        from { transform: translateX(0); }
        to { transform: translateX(-100%); }
      }
      @keyframes slide-in-from-right {
        from { transform: translateX(100%); }
        to { transform: translateX(0); }
      }
      @keyframes slide-out-to-right {
        from { transform: translateX(0); }
        to { transform: translateX(100%); }
      }
      @keyframes slide-in-from-left {
        from { transform: translateX(-100%); }
        to { transform: translateX(0); }
      }
      .animate-slide-out-left { animation: slide-out-to-left 0.08s ease-out forwards; }
      .animate-slide-in-from-right { animation: slide-in-from-right 0.08s ease-out forwards; }
      .animate-slide-out-right { animation: slide-out-to-right 0.08s ease-out forwards; }
      .animate-slide-in-from-left { animation: slide-in-from-left 0.08s ease-out forwards; }

    </style>
  <link rel="stylesheet" href="/index.css">
</head>
  <body class="bg-slate-100">
    <div id="root"></div>
    <div id="toast-portal"></div>
    <script type="module" src="/index.tsx"></script>
    <script>
      if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
          navigator.serviceWorker.register('/service-worker.js')
            .then(registration => {
              console.log('ServiceWorker registration successful with scope: ', registration.scope);
            })
            .catch(err => {
              console.log('ServiceWorker registration failed: ', err);
            });
        });
      }
    </script>
    <!-- Preview refresh trigger: 1719331041355 -->
  </body>
</html>
```


---

## `./index.tsx`

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import AuthGate from './AuthGate';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <AuthGate />
);
```


---

## `./manifest.json`

```json
{
  "name": "Gestore Spese Intuitivo",
  "short_name": "Gestore Spese",
  "description": "Una semplice applicazione per tracciare le spese, con funzionalità offline.",
  "start_url": "/",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#f1f5f9",
  "theme_color": "#4f46e5",
  "icons": [
    {
      "src": "icon-192.svg",
      "sizes": "192x192",
      "type": "image/svg+xml"
    },
    {
      "src": "icon-512.svg",
      "sizes": "512x512",
      "type": "image/svg+xml"
    }
  ],
  "share_target": {
    "action": "/share-target/",
    "method": "POST",
    "enctype": "multipart/form-data",
    "params": {
      "files": [
        {
          "name": "screenshot",
          "accept": ["image/*"]
        }
      ]
    }
  }
}
```


---

## `./metadata.json`

```json
{
  "name": "Copy of gestore-spese 3",
  "description": "Una semplice applicazione per tracciare le spese, ricreata da zero per garantire pulizia e funzionalità.",
  "requestFramePermissions": [
    "microphone",
    "camera"
  ]
}
```


---

## `./package.json`

```json
{
  "name": "copy-of-gestore-spese",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "postinstall": "patch-package || true"
  },
  "dependencies": {
    "@google/genai": "^1.21.0",
    "idb": "8",
    "react": "18.3.1",
    "react-dom": "18.3.1",
    "recharts": "2.12.7"
  },
  "devDependencies": {
    "@types/node": "^22.14.0",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^5.0.0",
    "patch-package": "^8.0.0",
    "typescript": "~5.8.2",
    "vite": "^6.2.0"
  }
}

```


---

## `./screens/CategoryDetailScreen.tsx`

```tsx

```


---

## `./screens/ChangePinScreen.tsx`

```tsx
// src/screens/ChangePinScreen.tsx
import React, { useEffect, useState } from 'react';
import AuthLayout from '../components/auth/AuthLayout';
import PinInput from '../components/auth/PinInput';
import { getUsers, saveUsers } from '../utils/api';
import { hashPinWithSalt, verifyPin } from '../utils/auth';
import { SpinnerIcon } from '../components/icons/SpinnerIcon';

interface ChangePinScreenProps {
  email: string;                 // email dell'utente loggato
  onSuccess: () => void;         // callback al termine (es. torna a Impostazioni/Login)
  onCancel?: () => void;         // opzionale: torna indietro senza salvare
}

type Step = 'current' | 'new' | 'confirm';

const ChangePinScreen: React.FC<ChangePinScreenProps> = ({ email, onSuccess, onCancel }) => {
  const [step, setStep] = useState<Step>('current');

  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const normalizedEmail = email.trim().toLowerCase();

  // avanzamento step automatico in base alla lunghezza PIN
  useEffect(() => {
    if (step === 'current' && currentPin.length === 4) {
      void checkCurrentThenNext();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPin, step]);

  useEffect(() => {
    if (step === 'new' && newPin.length === 4) {
      setStep('confirm');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newPin, step]);

  useEffect(() => {
    if (step === 'confirm' && confirmPin.length === 4) {
      if (newPin !== confirmPin) {
        fail('I PIN non corrispondono. Riprova.');
        resetTo('new');
        return;
      }
      if (currentPin === newPin) {
        fail('Il nuovo PIN non può essere uguale al PIN attuale.');
        resetTo('new');
        return;
      }
      void saveNewPin();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmPin, step]);

  const fail = (msg: string) => {
    setError(msg);
    setInfo(null);
  };
  const note = (msg: string) => {
    setInfo(msg);
    setError(null);
  };

  const resetTo = (to: Step) => {
    if (to === 'current') {
      setCurrentPin('');
    }
    if (to !== 'new') setNewPin('');
    setConfirmPin('');
    setStep(to);
  };

  const checkCurrentThenNext = async () => {
    setLoading(true);
    setError(null);
    try {
      const users = getUsers();
      const u = users[normalizedEmail];
      if (!u) {
        fail('Utente non trovato sul dispositivo.');
        resetTo('current');
        return;
      }
      const ok = await verifyPin(currentPin, u.pinHash, u.pinSalt);
      if (!ok) {
        fail('PIN attuale errato.');
        resetTo('current');
        return;
      }
      setStep('new');
      setInfo(null);
      setError(null);
    } catch {
      fail('Errore nella verifica del PIN attuale.');
      resetTo('current');
    } finally {
      setLoading(false);
    }
  };

  const saveNewPin = async () => {
    setLoading(true);
    setError(null);
    try {
      const users = getUsers();
      const u = users[normalizedEmail];
      if (!u) {
        fail('Utente non trovato sul dispositivo.');
        resetTo('current');
        return;
      }
      const { hash, salt } = await hashPinWithSalt(newPin);
      u.pinHash = hash;
      u.pinSalt = salt;
      users[normalizedEmail] = u;
      saveUsers(users);

      note('PIN aggiornato con successo.');
      setTimeout(() => onSuccess(), 800);
    } catch {
      fail('Errore durante il salvataggio del nuovo PIN.');
      resetTo('new');
    } finally {
      setLoading(false);
    }
  };

  const headline =
    step === 'current'
      ? 'Inserisci il PIN attuale'
      : step === 'new'
      ? 'Nuovo PIN'
      : 'Conferma nuovo PIN';

  const hint =
    step === 'current'
      ? 'Per continuare, verifica il PIN attuale.'
      : step === 'new'
      ? 'Scegli un nuovo PIN di 4 cifre.'
      : 'Reinserisci il nuovo PIN.';

  const pinValue = step === 'current' ? currentPin : step === 'new' ? newPin : confirmPin;
  const setPin =
    step === 'current' ? setCurrentPin : step === 'new' ? setNewPin : setConfirmPin;

  return (
    <AuthLayout>
      <div className="text-center">
        <h2 className="text-xl font-bold text-slate-800 mb-2">{headline}</h2>

        <p
          className={`min-h-[2.5rem] text-sm flex items-center justify-center ${
            error ? 'text-red-500' : 'text-slate-500'
          }`}
        >
          {error || info || hint}
        </p>

        {loading ? (
          <div className="min-h-[220px] flex flex-col items-center justify-center">
            <SpinnerIcon className="w-12 h-12 text-indigo-600" />
            <p className="mt-3 text-slate-500">Attendere…</p>
          </div>
        ) : (
          <div className="mt-2">
            <PinInput pin={pinValue} onPinChange={setPin} />
          </div>
        )}

        <div className="mt-6 grid grid-cols-2 gap-3">
          <button
            onClick={() => (onCancel ? onCancel() : onSuccess())}
            className="px-4 py-3 text-sm font-semibold rounded-lg bg-slate-200 text-slate-800 hover:bg-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-400"
          >
            Annulla
          </button>
          <button
            onClick={() => {
              if (step === 'current' && currentPin.length === 4) {
                void checkCurrentThenNext();
              } else if (step === 'new' && newPin.length === 4) {
                setStep('confirm');
              } else if (step === 'confirm' && confirmPin.length === 4) {
                void saveNewPin();
              }
            }}
            className="px-4 py-3 text-sm font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
            disabled={
              loading ||
              (step === 'current' && currentPin.length < 4) ||
              (step === 'new' && newPin.length < 4) ||
              (step === 'confirm' && confirmPin.length < 4)
            }
          >
            {step === 'confirm' ? 'Conferma' : 'Continua'}
          </button>
        </div>
      </div>
    </AuthLayout>
  );
};

export default ChangePinScreen;
```


---

## `./screens/ForgotEmailScreen.tsx`

```tsx

```


---

## `./screens/ForgotPasswordScreen.tsx`

```tsx
import React, { useState } from 'react';
import AuthLayout from '../components/auth/AuthLayout';
import { forgotPassword } from '../utils/api';
import { EnvelopeIcon } from '../components/icons/EnvelopeIcon';
import { SpinnerIcon } from '../components/icons/SpinnerIcon';

interface ForgotPasswordScreenProps {
  onBackToLogin: () => void;
  onRequestSent: (email: string) => void;
}

const ForgotPasswordScreen: React.FC<ForgotPasswordScreenProps> = ({ onBackToLogin, onRequestSent }) => {
    const [email, setEmail] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email) return;
        setIsLoading(true);
        setError(null);
        const response = await forgotPassword(email);
        setIsLoading(false);
        if (response.success) {
            onRequestSent(email);
        } else {
            setError(response.message);
        }
    };
    
    const inputStyles = "block w-full rounded-md border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 sm:text-sm";

    return (
        <AuthLayout>
            <div className="text-center">
                 <h2 className="text-xl font-bold text-slate-800 mb-2">Reimposta PIN</h2>
                 <>
                    <p className="text-slate-500 mb-6">Inserisci la tua email e ti invieremo un link per reimpostare il tuo PIN.</p>
                    {error && <p className="text-red-600 text-sm mb-4 bg-red-100 p-3 rounded-md">{error}</p>}
                    <form onSubmit={handleSubmit}>
                       <div className="mb-4">
                           <label htmlFor="email-forgot" className="sr-only">Email</label>
                           <div className="relative">
                              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                                  <EnvelopeIcon className="h-5 w-5 text-slate-400" aria-hidden="true" />
                              </div>
                              <input
                                  type="email"
                                  id="email-forgot"
                                  autoComplete="email"
                                  value={email}
                                  onChange={(e) => setEmail(e.target.value)}
                                  className={inputStyles}
                                  placeholder="La tua email"
                                  required
                                  disabled={isLoading}
                              />
                           </div>
                       </div>
                       <button
                           type="submit"
                           disabled={isLoading || !email}
                           className="w-full px-4 py-3 text-sm font-semibold text-white bg-indigo-600 rounded-lg shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-colors disabled:bg-indigo-300 flex justify-center items-center"
                       >
                           {isLoading ? <SpinnerIcon className="w-5 h-5"/> : 'Invia Link di Reset'}
                       </button>
                    </form>
                    <button
                      onClick={onBackToLogin}
                      className="mt-6 w-full text-center text-sm font-semibold text-indigo-600 hover:text-indigo-500"
                    >
                      Annulla
                    </button>
                 </>
            </div>
        </AuthLayout>
    );
};

export default ForgotPasswordScreen;
```


---

## `./screens/ForgotPasswordSuccessScreen.tsx`

```tsx
// ForgotPasswordSuccessScreen.tsx
import React, { useEffect, useRef, useState } from 'react';
import AuthLayout from '../components/auth/AuthLayout';
import { EnvelopeIcon } from '../components/icons/EnvelopeIcon';
import { forgotPassword } from '../utils/api';

interface ForgotPasswordSuccessScreenProps {
  email: string;
  onBackToLogin: () => void;
}

const COOLDOWN_SECONDS = 60;

const ForgotPasswordSuccessScreen: React.FC<ForgotPasswordSuccessScreenProps> = ({ email, onBackToLogin }) => {
  const [cooldown, setCooldown] = useState<number>(0);
  const [sending, setSending] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    // cleanup timer on unmount
    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const startCooldown = () => {
    setCooldown(COOLDOWN_SECONDS);
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) {
          if (timerRef.current) {
            window.clearInterval(timerRef.current);
            timerRef.current = null;
          }
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  };

  const handleResend = async () => {
    if (sending || cooldown > 0) return;
    try {
      setSending(true);
      await forgotPassword(email); // usa la tua API esistente
      startCooldown();
    } finally {
      setSending(false);
    }
  };

  return (
    <AuthLayout>
      <div className="text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100 mb-4">
          <EnvelopeIcon className="h-6 w-6 text-green-600" aria-hidden="true" />
        </div>

        <h2 className="text-xl font-bold text-slate-800 mb-2">Controlla la tua Email</h2>

        <p className="text-slate-500 mb-6">
          Abbiamo inviato un link per il reset del PIN a <br />
          <strong className="text-slate-700">{email}</strong>.
          <br /><br />
          Apri il link per continuare. Se non lo trovi, controlla la cartella spam.
        </p>

        <div className="space-y-3">
          <button
            onClick={onBackToLogin}
            className="w-full px-4 py-3 text-sm font-semibold text-white bg-indigo-600 rounded-lg shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-colors"
          >
            Torna al Login
          </button>

          <div className="text-sm text-slate-600">
            Non hai ricevuto l’email?{' '}
            <button
              onClick={handleResend}
              disabled={sending || cooldown > 0}
              className="font-semibold text-indigo-600 hover:text-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {sending
                ? 'Invio…'
                : cooldown > 0
                ? `Reinvia tra ${cooldown}s`
                : 'Reinvia link'}
            </button>
          </div>
        </div>
      </div>
    </AuthLayout>
  );
};

export default ForgotPasswordSuccessScreen;

```


---

## `./screens/HistoryScreen.tsx`

```tsx

// screens/HistoryScreen.tsx
import React, {
  useMemo,
  useState,
  useRef,
  useEffect,
  useCallback,
} from 'react';
import { Expense, Account, CATEGORIES } from '../types';
import { getCategoryStyle } from '../utils/categoryStyles';
import { formatCurrency } from '../components/icons/formatters';
import { TrashIcon } from '../components/icons/TrashIcon';
import { HistoryFilterCard } from '../components/HistoryFilterCard';
import { ArrowLeftIcon } from '../components/icons/ArrowLeftIcon';
import { CheckIcon } from '../components/icons/CheckIcon';
import ConfirmationModal from '../components/ConfirmationModal';
import { useTapBridge } from '../hooks/useTapBridge';

type DateFilter = 'all' | '7d' | '30d' | '6m' | '1y';
type PeriodType = 'day' | 'week' | 'month' | 'year';
type ActiveFilterMode = 'quick' | 'period' | 'custom';

interface ExpenseItemProps {
  expense: Expense;
  accounts: Account[];
  onEdit: (expense: Expense) => void;
  onDelete: (id: string) => void;
  isOpen: boolean;
  onOpen: (id: string) => void;
  isSelectionMode: boolean;
  isSelected: boolean;
  onToggleSelection: (id: string) => void;
  onLongPress: (id: string) => void;
}

const ACTION_WIDTH = 72;

/* ==================== ExpenseItem ==================== */
const ExpenseItem: React.FC<ExpenseItemProps> = ({
  expense,
  accounts,
  onEdit,
  onDelete,
  isOpen,
  onOpen,
  isSelectionMode,
  isSelected,
  onToggleSelection,
  onLongPress,
}) => {
  const style = getCategoryStyle(expense.category);
  const accountName =
    accounts.find((a) => a.id === expense.accountId)?.name || 'Sconosciuto';
  const itemRef = useRef<HTMLDivElement>(null);
  const tapBridge = useTapBridge();

  const isRecurringInstance = !!expense.recurringExpenseId;
  const itemBgClass = isSelected ? 'bg-indigo-50 ring-1 ring-inset ring-indigo-200' : isRecurringInstance ? 'bg-amber-50' : 'bg-white';

  // Long press logic
  const longPressTimer = useRef<number | null>(null);
  const handlePointerDownItem = (e: React.PointerEvent) => {
    if (isSelectionMode) return; // No long press needed if already selecting
    longPressTimer.current = window.setTimeout(() => {
        onLongPress(expense.id);
        if (navigator.vibrate) navigator.vibrate(50);
    }, 500);
  };

  const cancelLongPress = () => {
      if (longPressTimer.current) {
          clearTimeout(longPressTimer.current);
          longPressTimer.current = null;
      }
  };

  const dragState = useRef({
    isDragging: false,
    isLocked: false,
    startX: 0,
    startY: 0,
    startTime: 0,
    initialTranslateX: 0,
    pointerId: null as number | null,
    wasHorizontal: false,
  });

  const setTranslateX = useCallback((x: number, animated: boolean) => {
    if (!itemRef.current) return;
    itemRef.current.style.transition = animated
      ? 'transform 0.2s cubic-bezier(0.22,0.61,0.36,1)'
      : 'none';
    itemRef.current.style.transform = `translateX(${x}px)`;
  }, []);

  useEffect(() => {
    if (!dragState.current.isDragging) {
      setTranslateX(isOpen && !isSelectionMode ? -ACTION_WIDTH : 0, true);
    }
  }, [isOpen, isSelectionMode, setTranslateX]);

  const handlePointerDown = (e: React.PointerEvent) => {
    handlePointerDownItem(e);
    if ((e.target as HTMLElement).closest('button') || !itemRef.current) return;

    // Disable swipe in selection mode
    if (isSelectionMode) return;

    itemRef.current.style.transition = 'none';
    const m = new DOMMatrixReadOnly(
      window.getComputedStyle(itemRef.current).transform,
    );
    const currentX = m.m41;

    dragState.current = {
      isDragging: false,
      isLocked: false,
      startX: e.clientX,
      startY: e.clientY,
      startTime: performance.now(),
      initialTranslateX: currentX,
      pointerId: e.pointerId,
      wasHorizontal: false,
    };

    try {
      itemRef.current.setPointerCapture(e.pointerId);
    } catch (err) {
      console.warn('Could not capture pointer: ', err);
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const ds = dragState.current;
    
    // Cancel long press on significant move
    if (longPressTimer.current) {
        const dist = Math.hypot(e.clientX - ds.startX, e.clientY - ds.startY);
        if (dist > 10) cancelLongPress();
    }

    if (ds.pointerId !== e.pointerId) return;
    if (isSelectionMode) return; // Disable swipe in selection mode

    const dx = e.clientX - ds.startX;
    const dy = e.clientY - ds.startY;

    if (!ds.isDragging) {
      if (Math.hypot(dx, dy) > 8) {
        // Slop
        ds.isDragging = true;
        ds.isLocked = Math.abs(dx) > Math.abs(dy) * 2;
        if (!ds.isLocked) {
          if (ds.pointerId !== null)
            itemRef.current?.releasePointerCapture(ds.pointerId);
          ds.pointerId = null;
          ds.isDragging = false;
          return;
        } else {
          e.stopPropagation();
        }
      } else {
        return;
      }
    }

    if (ds.isDragging && ds.isLocked) {
      ds.wasHorizontal = true;
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();

      let x = ds.initialTranslateX + dx;
      if (x > 0) x = 0;
      if (x < -ACTION_WIDTH) x = -ACTION_WIDTH;
      setTranslateX(x, false);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    cancelLongPress();
    const ds = dragState.current;
    if (ds.pointerId !== e.pointerId) return;

    if (ds.pointerId !== null)
      itemRef.current?.releasePointerCapture(ds.pointerId);

    const wasDragging = ds.isDragging;
    const wasHorizontal = ds.wasHorizontal;

    // Reset state early per gestione click
    ds.isDragging = false;
    ds.pointerId = null;

    if (wasDragging && wasHorizontal) {
      const duration = performance.now() - ds.startTime;
      const dx = e.clientX - ds.startX;
      const endX = new DOMMatrixReadOnly(
        window.getComputedStyle(itemRef.current!).transform,
      ).m41;
      const velocity = dx / (duration || 1);
      const shouldOpen =
        endX < -ACTION_WIDTH / 2 || (velocity < -0.3 && dx < -20);
      onOpen(shouldOpen ? expense.id : '');
      setTranslateX(shouldOpen ? -ACTION_WIDTH : 0, true);
    }

    // Evita click subito dopo swipe
    setTimeout(() => {
      dragState.current.wasHorizontal = false;
    }, 0);
  };

  const handlePointerCancel = (e: React.PointerEvent) => {
    cancelLongPress();
    const ds = dragState.current;
    if (ds.pointerId !== e.pointerId) return;

    if (ds.pointerId !== null)
      itemRef.current?.releasePointerCapture(ds.pointerId);
    ds.isDragging = false;
    ds.isLocked = false;
    ds.pointerId = null;
    ds.wasHorizontal = false;
    setTranslateX(isOpen ? -ACTION_WIDTH : 0, true);
  };

  const handleClick = () => {
    if (dragState.current.isDragging || dragState.current.wasHorizontal) return;
    
    if (isSelectionMode) {
        onToggleSelection(expense.id);
    } else if (isOpen) {
        onOpen('');
    } else {
        onEdit(expense);
    }
  };

  return (
    <div className={`relative ${itemBgClass} overflow-hidden transition-colors duration-200`}>
      <div className="absolute top-0 right-0 h-full flex items-center z-0">
        <button
          onClick={() => onDelete(expense.id)}
          className="w-[72px] h-full flex flex-col items-center justify-center bg-red-600 text-white text-xs font-semibold focus:outline-none focus:visible:ring-2 focus:visible:ring-inset focus:visible:ring-white"
          aria-label="Elimina spesa"
          {...tapBridge}
        >
          <TrashIcon className="w-6 h-6" />
          <span className="text-xs mt-1">Elimina</span>
        </button>
      </div>
      <div
        ref={itemRef}
        data-expense-swipe="1"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onClick={handleClick}
        className={`relative flex items-center gap-4 py-3 px-4 ${itemBgClass} z-10 cursor-pointer transition-colors duration-200`}
        style={{ touchAction: 'pan-y' }}
      >
        {isRecurringInstance && !isSelectionMode && (
          <span className="absolute top-1.5 right-1.5 w-5 h-5 bg-amber-200 text-amber-800 text-xs font-bold rounded-full flex items-center justify-center border-2 border-amber-50" title="Spesa Programmata">
            P
          </span>
        )}
        
        {isSelected ? (
             <span className={`w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center bg-indigo-600 text-white transition-transform duration-200 transform scale-100`}>
                <CheckIcon className="w-6 h-6" strokeWidth={3} />
             </span>
        ) : (
            <span
              className={`w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center ${style.bgColor} transition-transform duration-200`}
            >
              <style.Icon className={`w-6 h-6 ${style.color}`} />
            </span>
        )}

        <div className="flex-grow min-w-0">
          <p className={`font-semibold truncate ${isSelected ? 'text-indigo-900' : 'text-slate-800'}`}>
            {expense.subcategory || style.label} • {accountName}
          </p>
          <p
            className={`text-sm truncate ${isSelected ? 'text-indigo-700' : 'text-slate-500'}`}
            title={expense.description}
          >
            {expense.description || 'Senza descrizione'}
          </p>
        </div>
        <p className={`font-bold text-lg text-right shrink-0 whitespace-nowrap min-w-[90px] ${isSelected ? 'text-indigo-900' : 'text-slate-900'}`}>
          {formatCurrency(Number(expense.amount) || 0)}
        </p>
      </div>
    </div>
  );
};

/* ==================== HistoryScreen ==================== */
interface HistoryScreenProps {
  expenses: Expense[];
  accounts: Account[];
  onEditExpense: (expense: Expense) => void;
  onDeleteExpense: (id: string) => void;
  onDeleteExpenses: (ids: string[]) => void; // For bulk delete
  isEditingOrDeleting: boolean;
  onDateModalStateChange: (isOpen: boolean) => void;
  onClose: () => void;
  onFilterPanelOpenStateChange: (isOpen: boolean) => void;
  isOverlayed: boolean;
}

interface ExpenseGroup {
  year: number;
  week: number;
  label: string;
  expenses: Expense[];
  total: number;
}

const getISOWeek = (date: Date): [number, number] => {
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
  );
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return [
    d.getUTCFullYear(),
    Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7),
  ];
};

const getWeekLabel = (y: number, w: number) => {
  const now = new Date();
  const [cy, cw] = getISOWeek(now);
  if (y === cy) {
    if (w === cw) return 'Questa Settimana';
    if (w === cw - 1) return 'Settimana Scorsa';
  }
  return `Settimana ${w}, ${y}`;
};

const parseLocalYYYYMMDD = (s: string) => {
  const p = s.split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
};

const HistoryScreen: React.FC<HistoryScreenProps> = ({
  expenses,
  accounts,
  onEditExpense,
  onDeleteExpense,
  onDeleteExpenses,
  isEditingOrDeleting,
  onDateModalStateChange,
  onClose,
  onFilterPanelOpenStateChange,
  isOverlayed,
}) => {
  const [isAnimatingIn, setIsAnimatingIn] = useState(false);
  
  // Date Filtering State
  const [activeFilterMode, setActiveFilterMode] = useState<ActiveFilterMode>('quick');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [customRange, setCustomRange] = useState<{ start: string | null; end: string | null; }>({ start: null, end: null });
  const [periodType, setPeriodType] = useState<PeriodType>('week');
  const [periodDate, setPeriodDate] = useState<Date>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });

  // Advanced Filtering State
  const [filterAccount, setFilterAccount] = useState<string | null>(null);
  const [filterCategories, setFilterCategories] = useState<Set<string>>(new Set());
  const [filterDescription, setFilterDescription] = useState('');
  const [filterAmountRange, setFilterAmountRange] = useState<{ min: string; max: string }>({ min: '', max: '' });

  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [isInternalDateModalOpen, setIsInternalDateModalOpen] = useState(false);

  // Selection State
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkDeleteModalOpen, setIsBulkDeleteModalOpen] = useState(false);

  const autoCloseRef = useRef<number | null>(null);
  const prevOpRef = useRef(isEditingOrDeleting);

  const isSelectionMode = selectedIds.size > 0;

  useEffect(() => {
    const timer = setTimeout(() => setIsAnimatingIn(true), 10);
    return () => clearTimeout(timer);
  }, []);

  const handleClose = () => {
    setOpenItemId(null);
    setIsAnimatingIn(false);
    setTimeout(onClose, 300);
  };

  const handleDateModalStateChange = useCallback(
    (isOpen: boolean) => {
      setIsInternalDateModalOpen(isOpen);
      onDateModalStateChange(isOpen);
    },
    [onDateModalStateChange],
  );

  // Quando finisce modifica/eliminazione (OK o Annulla), resettiamo card aperta
  useEffect(() => {
    if (prevOpRef.current && !isEditingOrDeleting) {
      setOpenItemId(null);
    }
    prevOpRef.current = isEditingOrDeleting;
  }, [isEditingOrDeleting]);

  useEffect(() => {
    if (!isAnimatingIn) {
      setOpenItemId(null);
    }
  }, [isAnimatingIn]);

  useEffect(() => {
    if (autoCloseRef.current) clearTimeout(autoCloseRef.current);
    if (openItemId && !isEditingOrDeleting) {
      autoCloseRef.current = window.setTimeout(() => setOpenItemId(null), 5000);
    }
    return () => {
      if (autoCloseRef.current) clearTimeout(autoCloseRef.current);
    };
  }, [openItemId, isEditingOrDeleting]);

  const filteredExpenses = useMemo(() => {
    let result = expenses;

    // 1. Date Filter
    if (activeFilterMode === 'period') {
      const start = new Date(periodDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(periodDate);
      end.setHours(23, 59, 59, 999);
      switch (periodType) {
        case 'day': break;
        case 'week': {
          const day = start.getDay();
          const diff = start.getDate() - day + (day === 0 ? -6 : 1);
          start.setDate(diff);
          end.setDate(start.getDate() + 6);
          break;
        }
        case 'month':
          start.setDate(1);
          end.setMonth(end.getMonth() + 1);
          end.setDate(0);
          break;
        case 'year':
          start.setMonth(0, 1);
          end.setFullYear(end.getFullYear() + 1);
          end.setMonth(0, 0);
          break;
      }
      const t0 = start.getTime();
      const t1 = end.getTime();
      result = result.filter((e) => {
        const d = parseLocalYYYYMMDD(e.date);
        if (isNaN(d.getTime())) return false;
        const t = d.getTime();
        return t >= t0 && t <= t1;
      });
    } else if (activeFilterMode === 'custom' && customRange.start && customRange.end) {
      const t0 = parseLocalYYYYMMDD(customRange.start).getTime();
      const endDay = parseLocalYYYYMMDD(customRange.end);
      endDay.setDate(endDay.getDate() + 1);
      const t1 = endDay.getTime();
      result = result.filter((e) => {
        const d = parseLocalYYYYMMDD(e.date);
        if (isNaN(d.getTime())) return false;
        const t = d.getTime();
        return t >= t0 && t < t1;
      });
    } else if (dateFilter !== 'all') {
      const startDate = new Date();
      startDate.setHours(0, 0, 0, 0);
      switch (dateFilter) {
        case '7d': startDate.setDate(startDate.getDate() - 6); break;
        case '30d': startDate.setDate(startDate.getDate() - 29); break;
        case '6m': startDate.setMonth(startDate.getMonth() - 6); break;
        case '1y': startDate.setFullYear(startDate.getFullYear() - 1); break;
      }
      const t0 = startDate.getTime();
      result = result.filter((e) => {
        const d = parseLocalYYYYMMDD(e.date);
        return !isNaN(d.getTime()) && d.getTime() >= t0;
      });
    }

    // 2. Advanced Filters
    if (filterAccount) {
        result = result.filter(e => e.accountId === filterAccount);
    }

    // New Multi-Category Filter Logic
    if (filterCategories.size > 0) {
        result = result.filter(e => {
            const wholeCategoryKey = e.category;
            const specificSubKey = `${e.category}:${e.subcategory || ''}`;
            if (filterCategories.has(wholeCategoryKey)) return true;
            if (e.subcategory && filterCategories.has(specificSubKey)) return true;
            return false;
        });
    }

    if (filterDescription.trim()) {
        const q = filterDescription.toLowerCase();
        result = result.filter(e => (e.description || '').toLowerCase().includes(q));
    }
    
    // Amount Range Filter
    if (filterAmountRange.min) {
        const min = parseFloat(filterAmountRange.min);
        if (!isNaN(min)) {
            result = result.filter(e => e.amount >= min);
        }
    }
    if (filterAmountRange.max) {
        const max = parseFloat(filterAmountRange.max);
        if (!isNaN(max)) {
            result = result.filter(e => e.amount <= max);
        }
    }

    return result;
  }, [expenses, activeFilterMode, dateFilter, customRange, periodType, periodDate, filterAccount, filterCategories, filterDescription, filterAmountRange]);

  const groupedExpenses = useMemo(() => {
    const sorted = [...filteredExpenses].sort((a, b) => {
      const db = parseLocalYYYYMMDD(b.date);
      const da = parseLocalYYYYMMDD(a.date);
      if (b.time) {
        const [h, m] = b.time.split(':').map(Number);
        if (!isNaN(h) && !isNaN(m)) db.setHours(h, m);
      }
      if (a.time) {
        const [h, m] = a.time.split(':').map(Number);
        if (!isNaN(h) && !isNaN(m)) da.setHours(h, m);
      }
      return db.getTime() - da.getTime();
    });

    return sorted.reduce<Record<string, ExpenseGroup>>((acc, e) => {
      const d = parseLocalYYYYMMDD(e.date);
      if (isNaN(d.getTime())) return acc;
      const [y, w] = getISOWeek(d);
      const key = `${y}-${w}`;
      if (!acc[key]) {
        acc[key] = {
          year: y,
          week: w,
          label: getWeekLabel(y, w),
          expenses: [],
          total: 0,
        };
      }
      acc[key].expenses.push(e);
      acc[key].total += Number(e.amount) || 0;
      return acc;
    }, {});
  }, [filteredExpenses]);

  const expenseGroups = (Object.values(groupedExpenses) as ExpenseGroup[]).sort(
    (a, b) => (a.year !== b.year ? b.year - a.year : b.week - a.week),
  );

  const handleOpenItem = (id: string) => setOpenItemId(id || null);
  
  const handleToggleCategoryFilter = (key: string) => {
      setFilterCategories(prev => {
          const next = new Set(prev);
          if (next.has(key)) {
              next.delete(key);
          } else {
              next.add(key);
          }
          return next;
      });
  };

  const handleClearCategoryFilters = () => setFilterCategories(new Set());

  // Selection Logic
  const handleLongPress = (id: string) => {
      setSelectedIds(new Set([id]));
      if (navigator.vibrate) navigator.vibrate(50);
  };

  const handleToggleSelection = (id: string) => {
      setSelectedIds(prev => {
          const next = new Set(prev);
          if (next.has(id)) {
              next.delete(id);
          } else {
              next.add(id);
          }
          return next;
      });
  };

  const handleCancelSelection = () => {
      setSelectedIds(new Set());
  };

  const handleBulkDeleteClick = () => {
      if (selectedIds.size > 0) {
          setIsBulkDeleteModalOpen(true);
      }
  };

  const handleConfirmBulkDelete = () => {
      onDeleteExpenses(Array.from(selectedIds));
      setIsBulkDeleteModalOpen(false);
      setSelectedIds(new Set());
  };

  return (
    <div
      className={`fixed inset-0 z-20 bg-slate-100 transform transition-transform duration-300 ease-in-out ${
        isAnimatingIn ? 'translate-y-0' : 'translate-y-full'
      }`}
      style={{ touchAction: 'pan-y' }}
    >
      <header className="sticky top-0 z-20 flex items-center gap-4 p-4 bg-white/80 backdrop-blur-sm shadow-sm h-[60px]">
        {isSelectionMode ? (
            <>
                <button
                    onClick={handleCancelSelection}
                    className="p-2 -ml-2 rounded-full hover:bg-slate-200 transition-colors text-slate-600"
                    aria-label="Annulla selezione"
                >
                    <ArrowLeftIcon className="w-6 h-6" />
                </button>
                <h1 className="text-xl font-bold text-indigo-800 flex-1">{selectedIds.size} Selezionati</h1>
                <button
                    onClick={handleBulkDeleteClick}
                    className="p-2 rounded-full hover:bg-red-100 text-red-600 transition-colors"
                    aria-label="Elimina selezionati"
                >
                    <TrashIcon className="w-6 h-6" />
                </button>
            </>
        ) : (
            <>
                <button
                  onClick={handleClose}
                  className="p-2 -ml-2 rounded-full hover:bg-slate-200 transition-colors"
                  aria-label="Indietro"
                >
                  <ArrowLeftIcon className="w-6 h-6 text-slate-700" />
                </button>
                <h1 className="text-xl font-bold text-slate-800 flex-1">Storico Spese</h1>
            </>
        )}
      </header>

      <main
        className="overflow-y-auto h-[calc(100%-60px)]"
        style={{ touchAction: 'pan-y' }}
      >
        <div
          className="flex-1 overflow-y-auto pb-36"
          style={{ touchAction: 'pan-y' }}
        >
          {expenseGroups.length > 0 ? (
            expenseGroups.map((group) => (
              <div key={group.label} className="mb-6 last:mb-0">
                <div className="flex items-center justify-between font-bold text-slate-800 text-lg px-4 py-2 sticky top-0 bg-slate-100/80 backdrop-blur-sm z-10">
                  <h2>{group.label}</h2>
                  <p className="font-bold text-indigo-600 text-xl">
                    {formatCurrency(group.total)}
                  </p>
                </div>

                <div className="bg-white rounded-xl shadow-md mx-2 overflow-hidden">
                  {group.expenses.map((expense, index) => (
                    <React.Fragment key={expense.id}>
                      {index > 0 && (
                        <hr className="border-t border-slate-200 ml-16" />
                      )}
                      <ExpenseItem
                        expense={expense}
                        accounts={accounts}
                        onEdit={onEditExpense}
                        onDelete={onDeleteExpense}
                        isOpen={openItemId === expense.id}
                        onOpen={handleOpenItem}
                        isSelectionMode={isSelectionMode}
                        isSelected={selectedIds.has(expense.id)}
                        onToggleSelection={handleToggleSelection}
                        onLongPress={handleLongPress}
                      />
                    </React.Fragment>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="text-center text-slate-500 pt-20 px-6">
              <p className="text-lg font-semibold">Nessuna spesa trovata</p>
              <p className="mt-2">
                Prova a modificare i filtri o aggiungi una nuova spesa dalla
                schermata Home.
              </p>
            </div>
          )}
        </div>
      </main>

      <HistoryFilterCard
        isActive={isAnimatingIn && !isInternalDateModalOpen && !isOverlayed && !isSelectionMode}
        
        // Date Filter Props
        onSelectQuickFilter={(value) => {
          setDateFilter(value);
          setActiveFilterMode('quick');
        }}
        currentQuickFilter={dateFilter}
        onCustomRangeChange={(range) => {
          setCustomRange(range);
          setActiveFilterMode('custom');
        }}
        currentCustomRange={customRange}
        isCustomRangeActive={activeFilterMode === 'custom'}
        onDateModalStateChange={handleDateModalStateChange}
        periodType={periodType}
        periodDate={periodDate}
        onSelectPeriodType={(type) => {
          setPeriodType(type);
          setPeriodDate(() => {
            const d = new Date();
            d.setHours(0, 0, 0, 0);
            return d;
          });
          setActiveFilterMode('period');
        }}
        onSetPeriodDate={setPeriodDate}
        isPeriodFilterActive={activeFilterMode === 'period'}
        onActivatePeriodFilter={() => setActiveFilterMode('period')}
        onOpenStateChange={onFilterPanelOpenStateChange}

        // Advanced Filter Props
        accounts={accounts}
        selectedAccountId={filterAccount}
        onSelectAccount={setFilterAccount}
        
        selectedCategoryFilters={filterCategories}
        onToggleCategoryFilter={handleToggleCategoryFilter}
        onClearCategoryFilters={handleClearCategoryFilters}
        
        descriptionQuery={filterDescription}
        onDescriptionChange={setFilterDescription}
        amountRange={filterAmountRange}
        onAmountRangeChange={setFilterAmountRange}
      />

      <ConfirmationModal
        isOpen={isBulkDeleteModalOpen}
        onClose={() => setIsBulkDeleteModalOpen(false)}
        onConfirm={handleConfirmBulkDelete}
        title="Elimina Selezionati"
        message={`Sei sicuro di voler eliminare ${selectedIds.size} elementi? L'azione è irreversibile.`}
        variant="danger"
        confirmButtonText="Elimina"
        cancelButtonText="Annulla"
      />
    </div>
  );
};

export default HistoryScreen;

```


---

## `./screens/LoginScreen.tsx`

```tsx
import React, { useState, useEffect, useRef } from 'react';
import AuthLayout from '../components/auth/AuthLayout';
import PinInput from '../components/auth/PinInput';
import { login } from '../utils/api';
import { SpinnerIcon } from '../components/icons/SpinnerIcon';
import { useLocalStorage } from '../hooks/useLocalStorage';
import LoginEmail from '../components/auth/LoginEmail';

// biometria
import {
  isBiometricsAvailable,
  isBiometricsEnabled,
  unlockWithBiometric,
  registerBiometric,
  shouldOfferBiometricEnable,
  setBiometricsOptOut,
} from '../services/biometrics';

type BioHelpers = {
  isBiometricSnoozed: () => boolean;
  setBiometricSnooze: () => void;
  clearBiometricSnooze: () => void;
};

// lock di sessione per evitare doppio avvio (StrictMode / re-render)
const BIO_AUTOPROMPT_LOCK_KEY = 'bio.autoprompt.lock';
const hasAutoPromptLock = () => {
  try {
    return sessionStorage.getItem(BIO_AUTOPROMPT_LOCK_KEY) === '1';
  } catch {
    return false;
  }
};
const setAutoPromptLock = () => {
  try {
    sessionStorage.setItem(BIO_AUTOPROMPT_LOCK_KEY, '1');
  } catch {}
};

// email usata con la biometria (per auto-prompt anche sulla schermata email)
const BIOMETRIC_LAST_EMAIL_KEY = 'bio.last_email';

interface LoginScreenProps {
  onLoginSuccess: (token: string, email: string) => void;
  onGoToRegister: () => void;
  onGoToForgotPassword: () => void;
  onGoToForgotEmail: () => void;
}

const LoginScreen: React.FC<LoginScreenProps> = ({
  onLoginSuccess,
  onGoToRegister,
  onGoToForgotPassword,
  onGoToForgotEmail,
}) => {
  const [activeEmail, setActiveEmail] = useLocalStorage<string | null>(
    'last_active_user_email',
    null,
  );
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // biometria
  const [bioSupported, setBioSupported] = useState(false);
  const [bioEnabled, setBioEnabled] = useState(false);
  const [showEnableBox, setShowEnableBox] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);
  const autoStartedRef = useRef(false);

  // email salvata assieme alla biometria (es. da un login precedente)
  const [biometricEmail, setBiometricEmail] = useState<string | null>(null);

  // carica/stabilisce l'email da usare per la biometria
  useEffect(() => {
    // se abbiamo già un utente attivo, quella è l'email biometrica
    if (activeEmail) {
      setBiometricEmail(activeEmail);
      return;
    }

    // siamo sulla schermata email → proviamo a leggere l'ultima email biometrica salvata
    try {
      if (typeof window === 'undefined') return;
      const raw = window.localStorage.getItem(BIOMETRIC_LAST_EMAIL_KEY);
      if (!raw || raw === 'null' || raw === 'undefined') {
        setBiometricEmail(null);
      } else {
        setBiometricEmail(raw);
      }
    } catch {
      setBiometricEmail(null);
    }
  }, [activeEmail]);

  // verifica stato biometria (supporto / enabled / se mostrare il box)
  useEffect(() => {
    let mounted = true;

    (async () => {
      const supported = await isBiometricsAvailable();
      const enabled = isBiometricsEnabled();

      let shouldShow = false;

      if (supported) {
        if (enabled) {
          // già attivata → mostra direttamente il pulsante impronta
          shouldShow = true;
        } else if (activeEmail) {
          // decide se proporre l'abilitazione (funzione senza argomenti)
          try {
            const offer = await shouldOfferBiometricEnable();
            shouldShow = offer;
          } catch {
            shouldShow = false;
          }
        }
      }

      if (!mounted) return;

      setBioSupported(supported);
      setBioEnabled(enabled);
      setShowEnableBox(shouldShow);
    })();

    return () => {
      mounted = false;
    };
  }, [activeEmail]);

  // email effettiva da usare per l'auto-prompt (PIN o schermata email)
  const autoPromptEmail = activeEmail ?? biometricEmail ?? null;

  // Autoprompt biometrico: 1 solo tentativo totale per sessione.
  // Ora funziona anche se siamo sulla schermata EMAIL, usando autoPromptEmail.
  useEffect(() => {
    if (!autoPromptEmail) return;
    if (!bioSupported || !bioEnabled) return;
    if (autoStartedRef.current) return;
    if (hasAutoPromptLock()) return;

    autoStartedRef.current = true;
    setAutoPromptLock();

    (async () => {
      const { isBiometricSnoozed, setBiometricSnooze, clearBiometricSnooze } =
        (await import('../services/biometrics')) as unknown as BioHelpers;

      if (isBiometricSnoozed()) return;

      try {
        setBioBusy(true);
        const ok = await unlockWithBiometric('Sblocca con impronta / FaceID');
        setBioBusy(false);
        if (ok) {
          clearBiometricSnooze();

          const normalized = autoPromptEmail.toLowerCase();

          // Salva email biometrica dedicata
          try {
            if (typeof window !== 'undefined') {
              window.localStorage.setItem(BIOMETRIC_LAST_EMAIL_KEY, normalized);
            }
          } catch {}

          // Se eravamo sulla schermata email, settiamo anche l'activeEmail
          if (!activeEmail) {
            setActiveEmail(normalized);
          }

          onLoginSuccess('biometric-local', normalized);
        }
      } catch (err: any) {
        setBioBusy(false);
        const name = err?.name || '';
        const msg = String(err?.message || '');
        if (name === 'NotAllowedError' || name === 'AbortError' || /timeout/i.test(msg)) {
          setBiometricSnooze();
        }
        // resta sulla schermata corrente
      }
    })();
  }, [autoPromptEmail, activeEmail, bioSupported, bioEnabled, onLoginSuccess, setActiveEmail]);

  // Verifica PIN
  useEffect(() => {
    if (pin.length === 4 && activeEmail) {
      handlePinVerify();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, activeEmail]);

  const handleEmailSubmit = (email: string) => {
    if (email) {
      const normalized = email.toLowerCase();
      setActiveEmail(normalized);
      setError(null);
      setBiometricEmail(normalized);
    }
  };

  const handlePinVerify = async () => {
    if (isLoading || !activeEmail) return;
    setIsLoading(true);
    setError(null);
    const response = await login(activeEmail, pin);
    if (response.success && response.token) {
      onLoginSuccess(response.token, activeEmail);
    } else {
      setError(response.message);
      setTimeout(() => {
        setPin('');
        setError(null);
        setIsLoading(false);
      }, 1500);
    }
  };

  const loginWithBiometrics = async () => {
    const emailForBio = activeEmail ?? biometricEmail;
    if (!emailForBio) return;

    try {
      setBioBusy(true);
      // FIX: Removed typo 'clearBiometricSnoozed' and duplicate 'clearBiometricSnooze'
      const { clearBiometricSnooze, setBiometricSnooze } =
        (await import('../services/biometrics')) as unknown as BioHelpers;

      // login richiesto esplicitamente → azzero lo snooze
      clearBiometricSnooze();

      const ok = await unlockWithBiometric('Sblocca con impronta / FaceID');
      setBioBusy(false);

      if (ok) {
        const normalized = emailForBio.toLowerCase();

        // salva anche qui la mail biometrica
        try {
          if (typeof window !== 'undefined') {
            window.localStorage.setItem(BIOMETRIC_LAST_EMAIL_KEY, normalized);
          }
        } catch {}

        if (!activeEmail) {
          setActiveEmail(normalized);
        }
        setBiometricEmail(normalized);

        onLoginSuccess('biometric-local', normalized);
      }
    } catch (err) {
      setBioBusy(false);
      console.error('Login biometrico fallito', err);
      const name = (err as any)?.name || '';
      const msg = String((err as any)?.message || '');
      if (name === 'NotAllowedError' || name === 'AbortError' || /timeout/i.test(msg)) {
        const { setBiometricSnooze } =
          (await import('../services/biometrics')) as unknown as BioHelpers;
        setBiometricSnooze();
      }
    }
  };

  const enableBiometricsNow = async () => {
    const emailForBio = activeEmail ?? biometricEmail;
    if (!emailForBio) return;

    try {
      setBioBusy(true);
      await registerBiometric('Profilo locale');
      setBioEnabled(true);
      setBioBusy(false);

      const normalized = emailForBio.toLowerCase();

      // salva email biometrica dedicata
      try {
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(BIOMETRIC_LAST_EMAIL_KEY, normalized);
        }
      } catch {}

      if (!activeEmail) {
        setActiveEmail(normalized);
      }
      setBiometricEmail(normalized);

      // Tentativo manuale subito dopo l’abilitazione
      await loginWithBiometrics();
    } catch {
      setBioBusy(false);
      // se annulla in registrazione, resta tutto com’è
    }
  };

  const optOutBiometrics = () => {
    try {
      // funzione definita come setBiometricsOptOut(boolean)
      setBiometricsOptOut(true);
    } catch {
      // se fallisce non è la fine del mondo
    }
    setShowEnableBox(false);
  };

  const handleSwitchUser = () => {
    setActiveEmail(null);
    setPin('');
    setError(null);
    autoStartedRef.current = false;
    // non resetto il lock globale: niente altro auto-prompt in questa sessione
  };

  const renderContent = () => {
    // —— SCHERMATA EMAIL ——
    if (!activeEmail) {
      return (
        <div className="text-center">
          <h2 className="text-xl font-bold text-slate-800 mb-2">Bentornato!</h2>
          <p className="text-slate-500 mb-6">Inserisci la tua email per continuare.</p>

          <LoginEmail onSubmit={handleEmailSubmit} />

          <div className="mt-3">
            <button
              onClick={onGoToForgotEmail}
              className="text-sm font-semibold text-indigo-600 hover:text-indigo-500"
            >
              Email dimenticata?
            </button>
          </div>

          <p className="text-sm text-slate-500 mt-4">
            Non hai un account?{' '}
            <button
              onClick={onGoToRegister}
              className="font-semibold text-indigo-600 hover:text-indigo-500"
            >
              Registrati
            </button>
          </p>
        </div>
      );
    }

    // —— SCHERMATA PIN ——
    return (
      <div className="text-center">
        <p className="text-sm text-slate-600 mb-2 truncate" title={activeEmail}>
          {activeEmail}
        </p>
        <h2 className="text-xl font-bold text-slate-800 mb-2">Inserisci il PIN</h2>
        <p
          className={`h-10 flex items-center justify-center transition-colors ${
            error ? 'text-red-500' : 'text-slate-500'
          }`}
        >
          {isLoading ? (
            <SpinnerIcon className="w-6 h-6 text-indigo-600" />
          ) : (
            error ||
            (bioEnabled && bioSupported
              ? 'Puoi anche usare l’impronta.'
              : 'Inserisci il tuo PIN di 4 cifre.')
          )}
        </p>

        <PinInput pin={pin} onPinChange={setPin} />

        <div className="mt-4 flex flex-col items-center justify-center gap-y-3">
          <div className="flex w-full items-center justify-between">
            <button
              onClick={handleSwitchUser}
              className="text-sm font-semibold text-indigo-600 hover:text-indigo-500"
            >
              Cambia Utente
            </button>
            <button
              onClick={onGoToForgotPassword}
              className="text-sm font-semibold text-indigo-600 hover:text-indigo-500"
            >
              PIN Dimenticato?
            </button>
          </div>

          {showEnableBox && (
            <div className="mt-3 flex flex-col items-center gap-2">
              <button
                onClick={bioEnabled ? loginWithBiometrics : enableBiometricsNow}
                disabled={bioBusy}
                className="text-sm font-semibold text-indigo-600 hover:text-indigo-500 disabled:opacity-60"
              >
                {bioBusy
                  ? 'Attendere...'
                  : bioEnabled
                  ? 'Accedi con impronta'
                  : 'Abilita impronta'}
              </button>

              {!bioEnabled && (
                <button
                  type="button"
                  onClick={optOutBiometrics}
                  className="text-xs text-slate-400 hover:text-slate-500"
                >
                  Non ora
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return <AuthLayout>{renderContent()}</AuthLayout>;
};

export default LoginScreen;

```


---

## `./screens/MonthlyTrendScreen.tsx`

```tsx
import React, { useState, useMemo, useEffect } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Sector } from 'recharts';
import { Expense } from '../types';
import { formatCurrency } from '../components/icons/formatters';
import { getCategoryStyle } from '../utils/categoryStyles';

const COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#3b82f6', '#ef4444', '#d97706', '#6366f1', '#6b7280'];

const renderActiveShape = (props: any) => {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill, payload, percent } = props;
  const style = getCategoryStyle(payload.name);

  return (
    <g>
      <text x={cx} y={cy - 12} textAnchor="middle" fill="#1e293b" className="text-base font-bold">
        {style.label}
      </text>
      <text x={cx} y={cy + 12} textAnchor="middle" fill={fill} className="text-xl font-extrabold">
        {formatCurrency(payload.value)}
      </text>
      <text x={cx} y={cy + 32} textAnchor="middle" fill="#64748b" className="text-xs">
        {`(${(percent * 100).toFixed(2)}%)`}
      </text>
      
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={innerRadius}
        outerRadius={outerRadius + 6}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
        stroke="none"
      />
    </g>
  );
};

interface MonthlyTrendScreenProps {
  expenses: Expense[];
}

const MonthlyTrendScreen: React.FC<MonthlyTrendScreenProps> = ({ expenses }) => {
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
    const [selectedIndex, setSelectedIndex] = useState<number | null>(0);

    const monthlyData = useMemo(() => {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

        const monthlyExpenses = expenses.filter(e => {
            const expenseDate = new Date(e.date);
            return expenseDate >= startOfMonth && expenseDate <= endOfMonth && e.amount != null && !isNaN(Number(e.amount));
        });
        
        const categoryTotals = monthlyExpenses.reduce((acc: Record<string, number>, expense) => {
            const category = expense.category || 'Altro';
            acc[category] = (acc[category] || 0) + Number(expense.amount);
            return acc;
        }, {});
        
        return Object.entries(categoryTotals)
            .map(([name, value]) => ({ name, value: value as number }))
            .sort((a, b) => b.value - a.value);

    }, [expenses]);
    
     useEffect(() => {
        if (selectedIndex !== null && selectedIndex >= monthlyData.length) {
            setSelectedIndex(monthlyData.length > 0 ? 0 : null);
        }
        if (monthlyData.length > 0 && selectedIndex === null) {
            setSelectedIndex(0);
        }
    }, [monthlyData, selectedIndex]);

    const activePieIndex = hoveredIndex ?? selectedIndex;
    const currentMonthName = new Date().toLocaleString('it-IT', { month: 'long', year: 'numeric' });

    return (
        <div className="animate-fade-in-up">
            <h1 className="text-2xl font-bold text-slate-800 mb-6">Andamento Mensile</h1>
            
            <div className="bg-white p-6 rounded-2xl shadow-lg">
                <h3 className="text-xl font-bold text-slate-700 mb-2 text-center capitalize">
                    Riepilogo di {currentMonthName}
                </h3>

                {monthlyData.length > 0 ? (
                    <>
                        <ResponsiveContainer width="100%" height={300}>
                            <PieChart>
                                <Pie
                                    activeIndex={activePieIndex ?? undefined}
                                    activeShape={renderActiveShape}
                                    data={monthlyData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={70}
                                    outerRadius={100}
                                    fill="#8884d8"
                                    dataKey="value"
                                    onMouseEnter={(_, index) => setHoveredIndex(index)}
                                    onMouseLeave={() => setHoveredIndex(null)}
                                    onClick={(_, index) => setSelectedIndex(prev => prev === index ? null : index)}
                                >
                                    {monthlyData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Pie>
                            </PieChart>
                        </ResponsiveContainer>
                        
                        <div className="mt-4 pt-4 border-t border-slate-200">
                            <div className="flex flex-wrap justify-center gap-x-4 gap-y-3">
                            {monthlyData.map((entry, index) => {
                                const style = getCategoryStyle(entry.name);
                                const isActive = index === selectedIndex;
                                return (
                                <button
                                    key={`item-${index}`}
                                    onClick={() => setSelectedIndex(isActive ? null : index)}
                                    onMouseEnter={() => setHoveredIndex(index)}
                                    onMouseLeave={() => setHoveredIndex(null)}
                                    className={`flex items-center gap-3 p-2 rounded-full text-left transition-all duration-200 transform hover:shadow-md ${
                                        isActive ? 'bg-indigo-100 ring-2 ring-indigo-300' : 'bg-slate-100'
                                    }`}
                                >
                                    <span className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${style.bgColor}`}>
                                        <style.Icon className={`w-4 h-4 ${style.color}`} />
                                    </span>
                                    <div className="min-w-0 pr-2">
                                        <p className={`font-semibold text-sm truncate ${isActive ? 'text-indigo-800' : 'text-slate-700'}`}>{style.label}</p>
                                    </div>
                                </button>
                                );
                            })}
                            </div>
                        </div>

                    </>
                ) : (
                    <div className="text-center text-slate-500 py-20">
                        <p>Nessuna spesa registrata per questo mese.</p>
                        <p className="text-sm mt-2">Aggiungi una nuova spesa per iniziare.</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default MonthlyTrendScreen;
```


---

## `./screens/RecurringExpensesScreen.tsx`

```tsx

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Expense, Account } from '../types';
import { getCategoryStyle } from '../utils/categoryStyles';
import { formatCurrency, formatDate } from '../components/icons/formatters';
import { ArrowLeftIcon } from '../components/icons/ArrowLeftIcon';
import { TrashIcon } from '../components/icons/TrashIcon';
import { CalendarDaysIcon } from '../components/icons/CalendarDaysIcon';
import { CheckIcon } from '../components/icons/CheckIcon';
import ConfirmationModal from '../components/ConfirmationModal';
import { useTapBridge } from '../hooks/useTapBridge';

const ACTION_WIDTH = 72;

const parseLocalYYYYMMDD = (dateString: string | null | undefined): Date | null => {
  if (!dateString) return null;
  const parts = dateString.split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
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

const recurrenceLabels: Record<string, string> = {
  daily: 'Ogni Giorno',
  weekly: 'Ogni Settimana',
  monthly: 'Ogni Mese',
  yearly: 'Ogni Anno',
};

const getRecurrenceSummary = (expense: Expense): string => {
    if (expense.frequency !== 'recurring' || !expense.recurrence) {
        return 'Non programmata';
    }
    const { recurrence, recurrenceInterval = 1 } = expense;
    if (recurrenceInterval > 1) {
        return `Ogni ${recurrenceInterval} ${recurrence === 'daily' ? 'giorni' : recurrence === 'weekly' ? 'settimane' : recurrence === 'monthly' ? 'mesi' : 'anni'}`;
    }
    return recurrenceLabels[recurrence] || 'Ricorrente';
};

const RecurringExpenseItem: React.FC<{
  expense: Expense;
  accounts: Account[];
  onEdit: (expense: Expense) => void;
  onDeleteRequest: (id: string) => void;
  isOpen: boolean;
  onOpen: (id: string) => void;
  isSelectionMode: boolean;
  isSelected: boolean;
  onToggleSelection: (id: string) => void;
  onLongPress: (id: string) => void;
}> = ({ expense, accounts, onEdit, onDeleteRequest, isOpen, onOpen, isSelectionMode, isSelected, onToggleSelection, onLongPress }) => {
    const style = getCategoryStyle(expense.category);
    const accountName = accounts.find(a => a.id === expense.accountId)?.name || 'Sconosciuto';
    const itemRef = useRef<HTMLDivElement>(null);
    const tapBridge = useTapBridge();

    const nextDueDate = useMemo(() => {
        const baseDate = parseLocalYYYYMMDD(expense.lastGeneratedDate || expense.date);
        if (!baseDate) return null;
        if (!expense.lastGeneratedDate) return baseDate;
        return calculateNextDueDate(expense, baseDate);
    }, [expense]);

    // Long press logic
    const longPressTimer = useRef<number | null>(null);
    const handlePointerDownItem = (e: React.PointerEvent) => {
        if (isSelectionMode) return;
        longPressTimer.current = window.setTimeout(() => {
            onLongPress(expense.id);
            if (navigator.vibrate) navigator.vibrate(50);
        }, 500);
    };

    const cancelLongPress = () => {
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
    };

    const dragState = useRef({
      isDragging: false,
      isLocked: false,
      startX: 0,
      startY: 0,
      startTime: 0,
      initialTranslateX: 0,
      pointerId: null as number | null,
      wasHorizontal: false,
    });

    const setTranslateX = useCallback((x: number, animated: boolean) => {
      if (!itemRef.current) return;
      itemRef.current.style.transition = animated ? 'transform 0.2s cubic-bezier(0.22,0.61,0.36,1)' : 'none';
      itemRef.current.style.transform = `translateX(${x}px)`;
    }, []);
    
    useEffect(() => {
      if (!dragState.current.isDragging) {
        setTranslateX(isOpen && !isSelectionMode ? -ACTION_WIDTH : 0, true);
      }
    }, [isOpen, isSelectionMode, setTranslateX]);

    const handlePointerDown = (e: React.PointerEvent) => {
      handlePointerDownItem(e);
      if ((e.target as HTMLElement).closest('button') || !itemRef.current) return;
      
      if (isSelectionMode) return;

      itemRef.current.style.transition = 'none';
      const m = new DOMMatrixReadOnly(window.getComputedStyle(itemRef.current).transform);
      const currentX = m.m41;

      dragState.current = {
        isDragging: false, 
        isLocked: false,
        startX: e.clientX, 
        startY: e.clientY, 
        startTime: performance.now(),
        initialTranslateX: currentX, 
        pointerId: e.pointerId,
        wasHorizontal: false,
      };
      
      try { itemRef.current.setPointerCapture(e.pointerId); } catch (err) {
        console.warn("Could not capture pointer: ", err);
      }
    };

    const handlePointerMove = (e: React.PointerEvent) => {
      const ds = dragState.current;
      
      if (longPressTimer.current) {
          const dist = Math.hypot(e.clientX - ds.startX, e.clientY - ds.startY);
          if (dist > 10) cancelLongPress();
      }

      if (ds.pointerId !== e.pointerId) return;
      if (isSelectionMode) return;

      const dx = e.clientX - ds.startX;
      const dy = e.clientY - ds.startY;
      
      if (!ds.isDragging) {
        if (Math.hypot(dx, dy) > 8) { // Slop
          ds.isDragging = true;
          ds.isLocked = Math.abs(dx) > Math.abs(dy) * 2;
          if (!ds.isLocked) {
             if (ds.pointerId !== null) itemRef.current?.releasePointerCapture(ds.pointerId);
             ds.pointerId = null;
             ds.isDragging = false;
             return;
          }
        } else {
          return;
        }
      }

      if (ds.isDragging && ds.isLocked) {
        ds.wasHorizontal = true;
        if (e.cancelable) e.preventDefault();
  
        let x = ds.initialTranslateX + dx;
        if (x > 0) x = Math.tanh(x / 50) * 25;
        if (x < -ACTION_WIDTH) x = -ACTION_WIDTH - Math.tanh((Math.abs(x) - ACTION_WIDTH) / 50) * 25;
        setTranslateX(x, false);
      }
    };

    const handlePointerUp = (e: React.PointerEvent) => {
      cancelLongPress();
      const ds = dragState.current;
      if (ds.pointerId !== e.pointerId) return;
      
      if (ds.pointerId !== null) itemRef.current?.releasePointerCapture(ds.pointerId);
      
      const wasDragging = ds.isDragging;
      ds.isDragging = false;
      ds.pointerId = null;

      if (!wasDragging) return;

      if (ds.wasHorizontal) {
        const duration = performance.now() - ds.startTime;
        const dx = e.clientX - ds.startX;
        const endX = new DOMMatrixReadOnly(window.getComputedStyle(itemRef.current!).transform).m41;
        const velocity = dx / (duration || 1);
        const shouldOpen = (endX < -ACTION_WIDTH / 2) || (velocity < -0.3 && dx < -20);
        onOpen(shouldOpen ? expense.id : '');
        setTranslateX(shouldOpen ? -ACTION_WIDTH : 0, true);
      } else {
        setTranslateX(isOpen ? -ACTION_WIDTH : 0, true);
      }
    };
    
    const handlePointerCancel = (e: React.PointerEvent) => {
      cancelLongPress();
      const ds = dragState.current;
      if (ds.pointerId !== e.pointerId) return;
      if (ds.pointerId !== null) itemRef.current?.releasePointerCapture(ds.pointerId);
      ds.isDragging = false;
      ds.isLocked = false;
      ds.pointerId = null;
      setTranslateX(isOpen ? -ACTION_WIDTH : 0, true);
    };

    const handleClick = () => {
        if (dragState.current.isDragging || dragState.current.wasHorizontal) return;
        
        if (isSelectionMode) {
            onToggleSelection(expense.id);
        } else if (isOpen) {
            onOpen('');
        } else {
            onEdit(expense);
        }
    };

    return (
        <div className={`relative overflow-hidden transition-colors duration-200 ${isSelected ? 'bg-indigo-50 ring-1 ring-inset ring-indigo-200' : 'bg-white'}`}>
            <div className="absolute top-0 right-0 h-full flex items-center z-0">
                <button
                    onClick={() => onDeleteRequest(expense.id)}
                    className="w-[72px] h-full flex flex-col items-center justify-center bg-red-500 text-white hover:bg-red-600 transition-colors focus:outline-none focus:visible:ring-2 focus-visible:ring-inset focus-visible:ring-white"
                    aria-label="Elimina spesa programmata"
                    {...tapBridge}
                >
                    <TrashIcon className="w-6 h-6" />
                    <span className="text-xs mt-1">Elimina</span>
                </button>
            </div>
            <div
                ref={itemRef}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerCancel}
                onClick={handleClick}
                className={`relative flex items-center gap-4 py-3 px-4 ${isSelected ? 'bg-indigo-50' : 'bg-white'} z-10 cursor-pointer transition-colors duration-200`}
                style={{ touchAction: 'pan-y' }}
            >
                {isSelected ? (
                     <span className={`w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center bg-indigo-600 text-white transition-transform duration-200 transform scale-100`}>
                        <CheckIcon className="w-6 h-6" strokeWidth={3} />
                     </span>
                ) : (
                    <span className={`w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center ${style.bgColor} transition-transform duration-200`}>
                        <style.Icon className={`w-6 h-6 ${style.color}`} />
                    </span>
                )}

                <div className="flex-grow min-w-0">
                    <p className={`font-semibold truncate ${isSelected ? 'text-indigo-900' : 'text-slate-800'}`}>{expense.description || 'Senza descrizione'}</p>
                    <p className={`text-sm truncate ${isSelected ? 'text-indigo-700' : 'text-slate-500'}`}>{getRecurrenceSummary(expense)} • {accountName}</p>
                </div>
                
                <div className="flex flex-col items-end shrink-0 min-w-[90px]">
                    <p className={`font-bold text-lg text-right whitespace-nowrap ${isSelected ? 'text-indigo-900' : 'text-slate-900'}`}>{formatCurrency(Number(expense.amount) || 0)}</p>
                    {nextDueDate && (
                         <div className={`text-sm font-medium mt-1 whitespace-nowrap ${isSelected ? 'text-indigo-600' : 'text-slate-500'}`}>
                            {formatDate(nextDueDate)}
                         </div>
                    )}
                </div>
            </div>
        </div>
    );
};

interface RecurringExpensesScreenProps {
  recurringExpenses: Expense[];
  expenses: Expense[];
  accounts: Account[];
  onClose: () => void;
  onEdit: (expense: Expense) => void;
  onDelete: (id: string) => void;
  onDeleteRecurringExpenses: (ids: string[]) => void; // Bulk delete prop
}

const RecurringExpensesScreen: React.FC<RecurringExpensesScreenProps> = ({ recurringExpenses, expenses, accounts, onClose, onEdit, onDelete, onDeleteRecurringExpenses }) => {
  const [isAnimatingIn, setIsAnimatingIn] = useState(false);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [expenseToDeleteId, setExpenseToDeleteId] = useState<string | null>(null);
  const [isConfirmDeleteModalOpen, setIsConfirmDeleteModalOpen] = useState(false);
  const autoCloseRef = useRef<number | null>(null);

  // Selection State
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkDeleteModalOpen, setIsBulkDeleteModalOpen] = useState(false);
  
  const isSelectionMode = selectedIds.size > 0;

  const activeRecurringExpenses = useMemo(() => {
    return recurringExpenses.filter(template => {
        if (template.frequency !== 'recurring') {
            return false;
        }

        if (!template.recurrenceEndType || template.recurrenceEndType === 'forever') {
            return true;
        }

        if (template.recurrenceEndType === 'count') {
            if (!template.recurrenceCount || template.recurrenceCount <= 0) return true; 
            const generatedCount = expenses.filter(e => e.recurringExpenseId === template.id).length;
            return generatedCount < template.recurrenceCount;
        }

        if (template.recurrenceEndType === 'date') {
            const endDate = parseLocalYYYYMMDD(template.recurrenceEndDate);
            if (!endDate) return true;

            const lastDate = parseLocalYYYYMMDD(template.lastGeneratedDate || template.date);
            if (!lastDate) return true;
            
            if (lastDate.getTime() > endDate.getTime()) return false;

            const nextDueDate = calculateNextDueDate(template, lastDate);

            if (!nextDueDate) return false;
            
            return nextDueDate.getTime() <= endDate.getTime();
        }

        return true;
    });
  }, [recurringExpenses, expenses]);

  useEffect(() => {
    const timer = setTimeout(() => setIsAnimatingIn(true), 10);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!isAnimatingIn && openItemId) {
      setOpenItemId(null);
    }
  }, [isAnimatingIn, openItemId]);

  useEffect(() => {
    if (autoCloseRef.current) clearTimeout(autoCloseRef.current);
    if (openItemId && !isConfirmDeleteModalOpen) {
      autoCloseRef.current = window.setTimeout(() => setOpenItemId(null), 5000);
    }
    return () => {
      if (autoCloseRef.current) clearTimeout(autoCloseRef.current);
    };
  }, [openItemId, isConfirmDeleteModalOpen]);

  const handleClose = () => {
      setOpenItemId(null);
      setIsAnimatingIn(false);
      setTimeout(onClose, 300);
  }

  const handleDeleteRequest = (id: string) => {
    setExpenseToDeleteId(id);
    setIsConfirmDeleteModalOpen(true);
  };

  const confirmDelete = () => {
    if (expenseToDeleteId) {
      onDelete(expenseToDeleteId);
      setExpenseToDeleteId(null);
      setIsConfirmDeleteModalOpen(false);
      setOpenItemId(null);
    }
  };

  const cancelDelete = () => {
    setIsConfirmDeleteModalOpen(false);
    setExpenseToDeleteId(null);
  };

  // Selection Handlers
  const handleLongPress = (id: string) => {
      setSelectedIds(new Set([id]));
      if (navigator.vibrate) navigator.vibrate(50);
  };

  const handleToggleSelection = (id: string) => {
      setSelectedIds(prev => {
          const next = new Set(prev);
          if (next.has(id)) {
              next.delete(id);
          } else {
              next.add(id);
          }
          return next;
      });
  };

  const handleCancelSelection = () => {
      setSelectedIds(new Set());
  };

  const handleBulkDeleteClick = () => {
      if (selectedIds.size > 0) {
          setIsBulkDeleteModalOpen(true);
      }
  };

  const handleConfirmBulkDelete = () => {
      onDeleteRecurringExpenses(Array.from(selectedIds));
      setIsBulkDeleteModalOpen(false);
      setSelectedIds(new Set());
  };
  
  const sortedExpenses = [...activeRecurringExpenses].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return (
    <div 
      className={`fixed inset-0 z-50 bg-slate-100 transform transition-transform duration-300 ease-in-out ${isAnimatingIn ? 'translate-y-0' : 'translate-y-full'}`}
      style={{ touchAction: 'pan-y' }}
    >
      <header className="sticky top-0 z-20 flex items-center gap-4 p-4 bg-white/80 backdrop-blur-sm shadow-sm h-[60px]">
        {isSelectionMode ? (
            <>
                <button
                    onClick={handleCancelSelection}
                    className="p-2 -ml-2 rounded-full hover:bg-slate-200 transition-colors text-slate-600"
                    aria-label="Annulla selezione"
                >
                    <ArrowLeftIcon className="w-6 h-6" />
                </button>
                <h1 className="text-xl font-bold text-indigo-800 flex-1">{selectedIds.size} Selezionati</h1>
                <button
                    onClick={handleBulkDeleteClick}
                    className="p-2 rounded-full hover:bg-red-100 text-red-600 transition-colors"
                    aria-label="Elimina selezionati"
                >
                    <TrashIcon className="w-6 h-6" />
                </button>
            </>
        ) : (
            <>
                <button onClick={handleClose} className="p-2 rounded-full hover:bg-slate-200 transition-colors" aria-label="Indietro">
                  <ArrowLeftIcon className="w-6 h-6 text-slate-700" />
                </button>
                <h1 className="text-xl font-bold text-slate-800 flex-1">Spese Programmate</h1>
            </>
        )}
      </header>
      <main className="overflow-y-auto h-[calc(100%-60px)] p-2" style={{ touchAction: 'pan-y' }}>
        {sortedExpenses.length > 0 ? (
            <div className="bg-white rounded-xl shadow-md overflow-hidden my-4">
                {sortedExpenses.map((expense, index) => (
                    <React.Fragment key={expense.id}>
                        {index > 0 && <hr className="border-t border-slate-200 ml-16" />}
                        <RecurringExpenseItem
                            expense={expense}
                            accounts={accounts}
                            onEdit={onEdit}
                            onDeleteRequest={handleDeleteRequest}
                            isOpen={openItemId === expense.id}
                            onOpen={setOpenItemId}
                            isSelectionMode={isSelectionMode}
                            isSelected={selectedIds.has(expense.id)}
                            onToggleSelection={handleToggleSelection}
                            onLongPress={handleLongPress}
                        />
                    </React.Fragment>
                ))}
            </div>
        ) : (
          <div className="text-center text-slate-500 pt-20 px-6">
            <CalendarDaysIcon className="w-16 h-16 mx-auto text-slate-400" />
            <p className="text-lg font-semibold mt-4">Nessuna spesa programmata attiva</p>
            <p className="mt-2">Le spese programmate concluse vengono rimosse automaticamente. Puoi crearne di nuove quando aggiungi una spesa.</p>
          </div>
        )}
      </main>

      {/* Modal di conferma eliminazione singola */}
      <ConfirmationModal 
        isOpen={isConfirmDeleteModalOpen}
        onClose={cancelDelete}
        onConfirm={confirmDelete}
        title="Conferma Eliminazione"
        message={<>Sei sicuro di voler eliminare questa spesa programmata? <br/>Le spese già generate non verranno cancellate.</>}
        variant="danger"
      />

      {/* Modal di conferma eliminazione multipla */}
      <ConfirmationModal
        isOpen={isBulkDeleteModalOpen}
        onClose={() => setIsBulkDeleteModalOpen(false)}
        onConfirm={handleConfirmBulkDelete}
        title="Elimina Selezionati"
        message={`Sei sicuro di voler eliminare ${selectedIds.size} elementi?`}
        variant="danger"
        confirmButtonText="Elimina"
        cancelButtonText="Annulla"
      />
    </div>
  );
};

export default RecurringExpensesScreen;

```


---

## `./screens/ResetPinScreen.tsx`

```tsx
import React, { useState, useEffect } from 'react';
import AuthLayout from '../components/auth/AuthLayout';
import PinInput from '../components/auth/PinInput';
import { resetPin, getUsers, saveUsers, forgotPassword } from '../utils/api';
import { hashPinWithSalt } from '../utils/auth';
import { SpinnerIcon } from '../components/icons/SpinnerIcon';

interface ResetPinScreenProps {
  email: string;
  token: string;
  onResetSuccess: () => void;
}

const ResetPinScreen: React.FC<ResetPinScreenProps> = ({ email, token, onResetSuccess }) => {
  const [step, setStep] = useState<'new_pin' | 'confirm_pin'>('new_pin');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  // Stato per link scaduto
  const [expired, setExpired] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  const [resendDone, setResendDone] = useState(false);
  const [cooldownLeft, setCooldownLeft] = useState(0); // secondi

  useEffect(() => {
    if (cooldownLeft <= 0) return;
    const id = window.setInterval(() => {
      setCooldownLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(id);
  }, [cooldownLeft]);

  const handleResend = async () => {
    if (resendBusy || cooldownLeft > 0) return;
    try {
      setResendBusy(true);
      await forgotPassword(email);
      setResendDone(true);
      setCooldownLeft(30); // cooldown 30s per evitare spam
    } finally {
      setResendBusy(false);
    }
  };

  const handleReset = async () => {
    setIsLoading(true);
    setError(null);

    const response = await resetPin(email, token, pin);

    if (response.success) {
      try {
        // Aggiorna anche il mock DB locale così il login funziona subito
        const users = getUsers();
        const normalizedEmail = email.toLowerCase();
        if (users[normalizedEmail]) {
          const { hash, salt } = await hashPinWithSalt(pin);
          users[normalizedEmail].pinHash = hash;
          users[normalizedEmail].pinSalt = salt;
          saveUsers(users);

          setSuccessMessage(response.message);
          setTimeout(() => {
            onResetSuccess();
          }, 1500);
        } else {
          setError('Utente non trovato nel database locale. Sincronizzazione fallita.');
          setIsLoading(false);
        }
      } catch (e) {
        console.error('Failed to update local PIN', e);
        setError("Errore durante l'aggiornamento del PIN locale.");
        setIsLoading(false);
      }
    } else {
      // Se il token è scaduto o non valido → mostra la vista dedicata
      const msg = (response.message || '').toLowerCase();
      if (msg.includes('invalid') || msg.includes('scadut') || msg.includes('non valido')) {
        setExpired(true);
        setIsLoading(false);
        return;
      }
      // Altri errori: reset flusso PIN
      setError(response.message);
      setIsLoading(false);
      setTimeout(() => {
        setPin('');
        setConfirmPin('');
        setError(null);
        setStep('new_pin');
      }, 2000);
    }
  };

  useEffect(() => {
    if (step === 'new_pin' && pin.length === 4) {
      setStep('confirm_pin');
    }
  }, [pin, step]);

  useEffect(() => {
    if (step === 'confirm_pin' && confirmPin.length === 4) {
      if (pin === confirmPin) {
        setError(null);
        handleReset();
      } else {
        setError('I PIN non corrispondono. Riprova.');
        setTimeout(() => {
          setPin('');
          setConfirmPin('');
          setError(null);
          setStep('new_pin');
        }, 1500);
      }
    }
  }, [confirmPin, pin, step]);

  // ====== RENDER ======
  // 1) Vista "link scaduto / non valido"
  if (expired) {
    return (
      <AuthLayout>
        <div className="text-center">
          <h2 className="text-xl font-bold text-slate-800 mb-2">Link scaduto o non valido</h2>
          <p className="text-slate-500 mb-6">
            Il link di reset non è più valido.<br />
            Puoi richiederne uno nuovo per <strong className="text-slate-700">{email}</strong>.
          </p>

          <button
            onClick={handleResend}
            disabled={resendBusy || cooldownLeft > 0}
            className={`w-full px-4 py-3 text-sm font-semibold rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-colors
              ${resendBusy || cooldownLeft > 0
                ? 'bg-slate-300 text-slate-600 cursor-not-allowed'
                : 'bg-indigo-600 text-white hover:bg-indigo-700'
              }`}
          >
            {resendBusy ? 'Invio in corso…' : cooldownLeft > 0 ? `Richiedi nuovo link (${cooldownLeft}s)` : 'Richiedi nuovo link'}
          </button>

          {resendDone && (
            <p className="mt-4 text-sm text-green-600">
              Se l'email è registrata, riceverai a breve un nuovo link.
            </p>
          )}
        </div>
      </AuthLayout>
    );
  }

  // 2) Vista caricamento operazioni di reset
  if (isLoading) {
    return (
      <AuthLayout>
        <div className="text-center min-h-[300px] flex flex-col justify-center items-center">
          <SpinnerIcon className="w-12 h-12 text-indigo-600 mx-auto" />
          <p className="mt-4 text-slate-500">Aggiornamento PIN in corso...</p>
        </div>
      </AuthLayout>
    );
  }

  // 3) Vista successo
  if (successMessage) {
    return (
      <AuthLayout>
        <div className="text-center min-h-[300px] flex flex-col justify-center items-center">
          <p className="text-lg font-semibold text-green-600">{successMessage}</p>
          <p className="mt-2 text-slate-500">Verrai reindirizzato al login.</p>
        </div>
      </AuthLayout>
    );
  }

  // 4) Vista standard: nuovo PIN / conferma
  const isConfirming = step === 'confirm_pin';
  return (
    <AuthLayout>
      <div className="text-center">
        <h2 className="text-xl font-bold text-slate-800 mb-2">
          {isConfirming ? 'Conferma il nuovo PIN' : 'Crea un nuovo PIN'}
        </h2>
        <p className={`text-slate-500 h-10 flex items-center justify-center transition-colors ${error ? 'text-red-500' : ''}`}>
          {error || (isConfirming ? 'Inseriscilo di nuovo per conferma.' : 'Il tuo nuovo PIN di 4 cifre.')}
        </p>
        <PinInput
          pin={isConfirming ? confirmPin : pin}
          onPinChange={isConfirming ? setConfirmPin : setPin}
        />
        {/* Tip utile: permetti di richiedere subito un nuovo link se l’utente ha dubbi */}
        <div className="mt-6">
          <button
            onClick={handleResend}
            disabled={resendBusy || cooldownLeft > 0}
            className={`text-sm font-semibold transition-colors
              ${resendBusy || cooldownLeft > 0 ? 'text-slate-400' : 'text-indigo-600 hover:text-indigo-500'}`}
          >
            {resendBusy ? 'Invio in corso…' : cooldownLeft > 0 ? `Link non arrivato? Reinvia (${cooldownLeft}s)` : 'Link non arrivato? Reinvia'}
          </button>
          {resendDone && (
            <p className="mt-2 text-xs text-green-600">
              Se l'email è registrata, riceverai a breve un nuovo link.
            </p>
          )}
        </div>
      </div>
    </AuthLayout>
  );
};

export default ResetPinScreen;

```


---

## `./screens/SetupScreen.tsx`

```tsx
import React, { useState, useEffect } from 'react'; 
import AuthLayout from '../components/auth/AuthLayout';
import PinInput from '../components/auth/PinInput';
import { register, login } from '../utils/api';
import { EnvelopeIcon } from '../components/icons/EnvelopeIcon';
import { SpinnerIcon } from '../components/icons/SpinnerIcon';

// biometria
import {
  isBiometricsAvailable,
  registerBiometric,
  setBiometricsOptOut,
} from '../services/biometrics';

// ——— Snooze di sessione per evitare auto-prompt dopo “Annulla” ———
const BIO_SNOOZE_KEY = 'bio.snooze';
const clearBiometricSnooze = () => { try { sessionStorage.removeItem(BIO_SNOOZE_KEY); } catch {} };

interface SetupScreenProps {
  onSetupSuccess: (token: string, email: string) => void;
  onGoToLogin: () => void;
}

type Step = 'email' | 'pin_setup' | 'pin_confirm' | 'bio_offer' | 'processing';

const SetupScreen: React.FC<SetupScreenProps> = ({ onSetupSuccess, onGoToLogin }) => {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [bioSupported, setBioSupported] = useState<boolean | null>(null);
  const [bioBusy, setBioBusy] = useState(false);

  const handleEmailSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (email.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError(null);
      setStep('pin_setup');
    } else {
      setError('Inserisci un indirizzo email valido.');
    }
  };

  // flusso finale: registrazione + login
  const doRegisterAndLogin = async () => {
    setStep('processing');
    setIsLoading(true);
    setError(null);
    const normalizedEmail = email.toLowerCase();

    // Registrazione
    const regResponse = await register(normalizedEmail, pin);
    if (!regResponse.success) {
      setError(regResponse.message);
      setIsLoading(false);
      setTimeout(() => {
        setPin('');
        setConfirmPin('');
        setError(null);
        setStep('email');
      }, 2000);
      return;
    }

    // Login automatico
    const loginResponse = await login(normalizedEmail, pin);
    if (loginResponse.success && loginResponse.token) {
      onSetupSuccess(loginResponse.token, normalizedEmail);
    } else {
      setIsLoading(false);
      setError('Login automatico fallito. Vai alla pagina di login.');
      setTimeout(() => onGoToLogin(), 2000);
    }
  };

  // Passaggio da pin_setup a pin_confirm
  useEffect(() => {
    if (step === 'pin_setup' && pin.length === 4) {
      setStep('pin_confirm');
    }
  }, [pin, step]);

  // Dopo la conferma PIN corretta → mostra bio_offer se supportato, altrimenti procedi
  useEffect(() => {
    (async () => {
      if (step === 'pin_confirm' && confirmPin.length === 4) {
        if (pin === confirmPin) {
          setError(null);
          const supported = await isBiometricsAvailable();
          setBioSupported(supported);
          if (supported) {
            setStep('bio_offer');
          } else {
            // niente biometria → procedi direttamente
            await doRegisterAndLogin();
          }
        } else {
          setError('I PIN non corrispondono. Riprova.');
          setTimeout(() => {
            setPin('');
            setConfirmPin('');
            setError(null);
            setStep('pin_setup');
          }, 1500);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmPin, pin, step]);

  const inputStyles =
    'block w-full rounded-md border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 sm:text-sm';

  const renderContent = () => {
    if (step === 'processing' || isLoading) {
      return (
        <div className="text-center min-h-[300px] flex flex-col justify-center items-center">
          <SpinnerIcon className="w-12 h-12 text-indigo-600 mx-auto" />
          <p className="mt-4 text-slate-500">Creazione account in corso...</p>
        </div>
      );
    }

    switch (step) {
      case 'email':
        return (
          <div className="text-center">
            <h2 className="text-xl font-bold text-slate-800 mb-2">Crea un Account</h2>
            <p className="text-slate-500 mb-6 h-10 flex items-center justify-center">{error || 'Inizia inserendo i tuoi dati.'}</p>
            <form onSubmit={handleEmailSubmit} className="space-y-4">
              <div>
                <label htmlFor="email-register" className="sr-only">Email</label>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                    <EnvelopeIcon className="h-5 w-5 text-slate-400" aria-hidden="true" />
                  </div>
                  <input
                    type="email"
                    id="email-register"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={inputStyles}
                    placeholder="La tua email"
                    required
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={!email}
                className="w-full px-4 py-3 text-sm font-semibold text-white bg-indigo-600 rounded-lg shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-colors disabled:bg-indigo-300"
              >
                Continua
              </button>
            </form>
            <p className="text-sm text-slate-500 mt-6">
              Hai già an account?{' '}
              <button onClick={onGoToLogin} className="font-semibold text-indigo-600 hover:text-indigo-500">
                Accedi
              </button>
            </p>
          </div>
        );

      case 'pin_setup':
      case 'pin_confirm': {
        const isConfirming = step === 'pin_confirm';
        return (
          <div className="text-center">
            <h2 className="text-xl font-bold text-slate-800 mb-2">
              {isConfirming ? 'Conferma il tuo PIN' : 'Crea un PIN di 4 cifre'}
            </h2>
            <p className={`text-slate-500 h-10 flex items-center justify-center transition-colors ${error ? 'text-red-500' : ''}`}>
              {error || (isConfirming ? 'Inseriscilo di nuovo per conferma.' : 'Servirà per accedere al tuo account.')}
            </p>
            <PinInput pin={isConfirming ? confirmPin : pin} onPinChange={isConfirming ? setConfirmPin : setPin} />
          </div>
        );
      }

      case 'bio_offer': {
        return (
          <div className="text-center">
            <h2 className="text-xl font-bold text-slate-800 mb-2">Vuoi abilitare l’impronta / FaceID?</h2>
            <p className="text-slate-500 h-10 flex items-center justify-center">
              Potrai sbloccare l’app senza inserire il PIN.
            </p>

            <div className="mt-4 p-3 rounded-lg border border-slate-200 bg-slate-50 text-left inline-block">
              <p className="text-sm text-slate-700">Abilita ora lo sblocco biometrico su questo dispositivo?</p>
              <div className="flex gap-3 mt-2">
                <button
                  onClick={async () => {
                    if (!bioSupported) { await doRegisterAndLogin(); return; }
                    try {
                      setBioBusy(true);
                      await registerBiometric('Profilo locale');
                      // registrazione riuscita: eventuale auto-prompt verrà gestito dalla Login
                      clearBiometricSnooze(); // assicura che non resti in stato “annullato”
                      setBioBusy(false);
                    } catch {
                      setBioBusy(false);
                      // anche se annulla la registrazione, proseguiamo col flusso
                    } finally {
                      await doRegisterAndLogin();
                    }
                  }}
                  disabled={bioBusy}
                  className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-indigo-300"
                >
                  {bioBusy ? 'Attivo…' : 'Abilita e continua'}
                </button>

                <button
                  onClick={async () => {
                    setBiometricsOptOut(true); // non riproporre in login
                    await doRegisterAndLogin();
                  }}
                  disabled={bioBusy}
                  className="px-4 py-2 text-sm font-semibold text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-100"
                >
                  Non ora
                </button>
              </div>
            </div>
          </div>
        );
      }
    }
  };

  return <AuthLayout>{renderContent()}</AuthLayout>;
};

export default SetupScreen;

```


---

## `./service-worker.js`

```js
// Importa la libreria idb per un accesso più semplice a IndexedDB
importScripts('https://cdn.jsdelivr.net/npm/idb@8/build/iife/index-min.js');

const CACHE_NAME = 'expense-manager-cache-v32';
// Aggiunta la pagina di share-target al caching
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.svg',
  '/icon-512.svg',
  '/share-target/',
  // Key CDN dependencies
  'https://cdn.tailwindcss.com',
  'https://esm.sh/react@18.3.1',
  'https://esm.sh/react-dom@18.3.1/client',
  'https://aistudiocdn.com/@google/genai@^1.21.0',
  'https://esm.sh/recharts@2.12.7',
  'https://cdn.jsdelivr.net/npm/idb@8/+esm'
];

// --- Funzioni Helper per IndexedDB (replicate da db.ts per l'uso nel Service Worker) ---
const DB_NAME = 'expense-manager-db';
const STORE_NAME = 'offline-images';
const DB_VERSION = 1;

const getDb = () => {
  return idb.openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    },
  });
};

const fileToBase64 = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = (error) => reject(error);
  });
};

// Install event
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache, caching app shell');
        return cache.addAll(urlsToCache);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate event
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // --- Gestione Share Target ---
  if (event.request.method === 'POST' && url.pathname === '/share-target/') {
    event.respondWith(Response.redirect('/')); // Rispondi subito con un redirect
    
    event.waitUntil(async function() {
      try {
        const formData = await event.request.formData();
        const file = formData.get('screenshot');
        
        if (!file || !file.type.startsWith('image/')) {
            console.warn('Share target: No valid image file received.');
            return;
        }

        const base64Image = await fileToBase64(file);
        
        const db = await getDb();
        await db.add(STORE_NAME, {
            id: crypto.randomUUID(),
            base64Image,
            mimeType: file.type,
        });
        
        console.log('Image from share target saved to IndexedDB.');

        // Cerca un client (tab/finestra) esistente dell'app e mettilo a fuoco
        const clients = await self.clients.matchAll({
            type: 'window',
            includeUncontrolled: true,
        });

        if (clients.length > 0) {
            await clients[0].focus();
        } else {
            self.clients.openWindow('/');
        }
      } catch (error) {
          console.error('Error handling share target:', error);
      }
    }());
    return;
  }
  
  if (event.request.method !== 'GET') {
    return;
  }

  // Strategy: Network falling back to cache for navigation
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Strategy: Cache first for all other assets
  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        return cachedResponse || fetch(event.request).then(
          networkResponse => {
            if (!networkResponse || networkResponse.status !== 200 || networkResponse.type === 'opaque') {
              return networkResponse;
            }
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseToCache);
            });
            return networkResponse;
          }
        );
      })
  );
});
```


---

## `./services/biometrics.ts`

```ts
// src/services/biometrics.ts
// Sblocco con impronta/FaceID via WebAuthn (Passkey) lato PWA/TWA

const KEY_ENABLED = 'bio.enabled';
const KEY_CRED_ID = 'bio.credId';       // base64url del rawId
const KEY_USER_ID = 'bio.userId';       // id utente locale per la passkey
const KEY_OPTOUT  = 'bio.optOut';       // utente ha detto "non ora"

// Snooze di sessione: dopo annullo/timeout non autopromptare fino a riapertura app
const KEY_SNOOZE  = 'bio.snooze';       // sessionStorage: '1' = non auto-promptare

// RP ID (dominio)
const RP_ID = location.hostname;

// --- base64url helpers ---
const toB64Url = (buf: ArrayBuffer) => {
  const b = String.fromCharCode(...new Uint8Array(buf));
  return btoa(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};
const fromB64Url = (s: string) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const arr = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) arr[i] = b.charCodeAt(i);
  return arr.buffer;
};

// ——— Snooze helpers ———
export function isBiometricSnoozed(): boolean {
  try { return sessionStorage.getItem(KEY_SNOOZE) === '1'; } catch { return false; }
}
export function setBiometricSnooze(): void {
  try { sessionStorage.setItem(KEY_SNOOZE, '1'); } catch {}
}
export function clearBiometricSnooze(): void {
  try { sessionStorage.removeItem(KEY_SNOOZE); } catch {}
}
export function canAutoPromptBiometric(): boolean {
  try {
    return !isBiometricSnoozed() && localStorage.getItem(KEY_ENABLED) === '1' && !!localStorage.getItem(KEY_CRED_ID);
  } catch { return false; }
}

// Supporto dispositivo
export async function isBiometricsAvailable(): Promise<boolean> {
  if (!('PublicKeyCredential' in window)) return false;
  try {
    const ok = await (window as any).PublicKeyCredential
      .isUserVerifyingPlatformAuthenticatorAvailable?.();
    return !!ok;
  } catch {
    return false;
  }
}

// Stato locale
export function isBiometricsEnabled(): boolean {
  return localStorage.getItem(KEY_ENABLED) === '1' && !!localStorage.getItem(KEY_CRED_ID);
}

// Opt-out prompt
export function isBiometricsOptedOut(): boolean {
  return localStorage.getItem(KEY_OPTOUT) === '1';
}
export function setBiometricsOptOut(v: boolean) {
  if (v) localStorage.setItem(KEY_OPTOUT, '1');
  else localStorage.removeItem(KEY_OPTOUT);
}

// Disabilita
export function disableBiometrics() {
  localStorage.removeItem(KEY_ENABLED);
  localStorage.removeItem(KEY_CRED_ID);
  clearBiometricSnooze();
}

// Registra passkey (abilitazione)
export async function registerBiometric(displayName = 'Utente'): Promise<boolean> {
  if (!(await isBiometricsAvailable())) throw new Error('Biometria non disponibile su questo dispositivo');

  let userIdStr = localStorage.getItem(KEY_USER_ID);
  if (!userIdStr) {
    const rnd = crypto.getRandomValues(new Uint8Array(32));
    userIdStr = toB64Url(rnd.buffer);
    localStorage.setItem(KEY_USER_ID, userIdStr);
  }
  const userId = fromB64Url(userIdStr);

  const challenge = crypto.getRandomValues(new Uint8Array(32));

  const publicKey: PublicKeyCredentialCreationOptions = {
    challenge,
    rp: { name: 'Gestore Spese', id: RP_ID },
    user: {
      id: new Uint8Array(userId),
      name: 'local@gestore',
      displayName,
    },
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 },   // ES256
      { type: 'public-key', alg: -257 }, // RS256
    ],
    timeout: 60000,
    attestation: 'none',
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      residentKey: 'preferred',
      userVerification: 'required',
    },
  };

  const cred = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential | null;
  if (!cred) throw new Error('Creazione passkey annullata');

  const credIdB64 = toB64Url(cred.rawId);
  localStorage.setItem(KEY_CRED_ID, credIdB64);
  localStorage.setItem(KEY_ENABLED, '1');
  clearBiometricSnooze();        // nuova attivazione ⇒ togli eventuale blocco sessione
  setBiometricsOptOut(false);    // rimuovi opt-out
  return true;
}

// Sblocco — se l’utente ANNULLA o scade: metti SNOOZE e lancia NotAllowed/Abort (verrà intercettato dallo screen)
export async function unlockWithBiometric(reason = 'Sblocca Gestore Spese'): Promise<boolean> {
  if (!(await isBiometricsAvailable())) throw new Error('Biometria non disponibile');
  const credIdB64 = localStorage.getItem(KEY_CRED_ID);
  if (!credIdB64) throw new Error('Biometria non configurata');

  try { (document.activeElement as HTMLElement | null)?.blur?.(); } catch {}

  const allowId = fromB64Url(credIdB64);
  const challenge = crypto.getRandomValues(new Uint8Array(32));

  const publicKey: PublicKeyCredentialRequestOptions = {
    challenge,
    rpId: RP_ID,
    timeout: 60000,
    userVerification: 'required',
    allowCredentials: [{ id: new Uint8Array(allowId), type: 'public-key' }],
  };

  try {
    const assertion = (await navigator.credentials.get({ publicKey })) as PublicKeyCredential | null;
    if (!assertion) {
      // raro, ma trattalo come annullo
      setBiometricSnooze();
      const err = new DOMException('User cancelled', 'NotAllowedError');
      throw err;
    }
    clearBiometricSnooze(); // successo ⇒ ok ai futuri auto-prompt
    return true;
  } catch (e: any) {
    const name = String(e?.name || '');
    const msg  = String(e?.message || '');
    // Cancel/dismiss/timeout → metti in snooze e rilancia per far interrompere l’autoprompt
    if (name === 'NotAllowedError' || name === 'AbortError' || /timeout/i.test(msg)) {
      setBiometricSnooze();
    }
    throw e; // il caller decide cosa fare (noi abbiamo già messo lo snooze)
  }
}

// Suggerire offerta attivazione?
export async function shouldOfferBiometricEnable(): Promise<boolean> {
  const supported = await isBiometricsAvailable();
  return supported && !isBiometricsEnabled() && !isBiometricsOptedOut();
}

```


---

## `./share-target/index.html`

```html
<!DOCTYPE html>
<html>
<head>
    <title>Ricezione spesa...</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body {
            font-family: sans-serif;
            background-color: #f1f5f9;
            color: #475569;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
        }
    </style>
</head>
<body>
    <p>Elaborazione in corso, verrai reindirizzato...</p>
    <script>
        // Se il service worker non riesce a reindirizzare per qualche motivo,
        // questo lo farà come fallback.
        window.location.href = '/';
    </script>
</body>
</html>
```


---

## `./tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "experimentalDecorators": true,
    "useDefineForClassFields": false,
    "module": "ESNext",
    "lib": [
      "ES2022",
      "DOM",
      "DOM.Iterable"
    ],
    "skipLibCheck": true,
    "types": [
      "node"
    ],
    "moduleResolution": "bundler",
    "isolatedModules": true,
    "moduleDetection": "force",
    "allowJs": true,
    "jsx": "react-jsx",
    "paths": {
      "@/*": [
        "./*"
      ]
    },
    "allowImportingTsExtensions": true,
    "noEmit": true
  }
}
```


---

## `./types.ts`

```ts


export interface Account {
  id: string;
  name: string;
}

export interface Expense {
  id:string;
  description: string;
  amount: number;
  date: string; // For recurring templates, this is the start date
  time?: string;
  category: string;
  subcategory?: string;
  accountId: string;
  frequency?: 'single' | 'recurring';
  recurrence?: 'daily' | 'weekly' | 'monthly' | 'yearly';
  monthlyRecurrenceType?: 'dayOfMonth' | 'dayOfWeek';
  recurrenceInterval?: number;
  recurrenceDays?: number[]; // 0 for Sunday, 1 for Monday, etc.
  recurrenceEndType?: 'forever' | 'date' | 'count';
  recurrenceEndDate?: string;
  recurrenceCount?: number;
  recurringExpenseId?: string; // Links an instance to its template
  lastGeneratedDate?: string; // For templates, tracks the last generation date
}

export const CATEGORIES: Record<string, string[]> = {
  'Alimentari': ['Supermercato', 'Ristorante', 'Bar', 'Caffè'],
  'Trasporti': ['Mezzi Pubblici', 'Benzina', 'Taxi', 'Manutenzione Auto'],
  'Casa': ['Affitto/Mutuo', 'Bollette', 'Manutenzione', 'Arredamento'],
  'Shopping': ['Abbigliamento', 'Elettronica', 'Libri', 'Regali'],
  'Tempo Libero': ['Cinema', 'Concerti', 'Sport', 'Viaggi'],
  'Salute': ['Farmacia', 'Visite Mediche', 'Assicurazione'],
  'Istruzione': ['Corsi', 'Libri', 'Tasse Scolastiche'],
  'Lavoro': ['Pranzi', 'Materiale Ufficio'],
  'Altro': [],
};

```


---

## `./utils/ai.ts`

```ts

import { GoogleGenAI, Type, FunctionDeclaration, Modality, Blob, LiveServerMessage } from '@google/genai';
import { CATEGORIES, Expense } from '../types';

// Helper per accedere alle variabili d'ambiente in modo sicuro (evita ReferenceError su process)
const getEnv = (key: string) => {
  try {
    // Vite
    if ((import.meta as any).env && (import.meta as any).env[key]) {
      return (import.meta as any).env[key];
    }
  } catch (e) {}

  try {
    // Node / CRA
    if (typeof process !== 'undefined' && process.env && process.env[key]) {
      return process.env[key];
    }
  } catch (e) {}

  return undefined;
};

// 1. Cerca la chiave in tutte le possibili variabili d'ambiente standard
const API_KEY = 
  getEnv('VITE_API_KEY') || 
  getEnv('REACT_APP_API_KEY') || 
  getEnv('API_KEY');

if (!API_KEY) {
    console.error("API_KEY mancante! Le funzionalità AI non funzioneranno.");
}

const ai = new GoogleGenAI({ apiKey: API_KEY! });

const toYYYYMMDD = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

// --- Image Parsing Logic ---

const expenseSchema = {
    type: Type.OBJECT,
    properties: {
        description: { type: Type.STRING, description: 'Breve descrizione della spesa. Es: "Cena da Mario", "Spesa Esselunga".' },
        amount: { type: Type.NUMBER, description: 'Importo totale numerico della spesa.' },
        date: { type: Type.STRING, description: 'Data della spesa in formato YYYY-MM-DD. Se non trovata, usa la data odierna.' },
        category: { type: Type.STRING, description: `Categoria della spesa. Scegli tra: ${Object.keys(CATEGORIES).join(', ')}.` },
        subcategory: { type: Type.STRING, description: 'Sottocategoria della spesa, se applicabile. Deve appartenere alla categoria scelta.' },
    },
    required: ['amount', 'date']
};

const multiExpenseSchema = {
    type: Type.ARRAY,
    items: expenseSchema,
};


const getCategoryPrompt = () => {
    let categoryDetails = "";
    for (const [category, subcategories] of Object.entries(CATEGORIES)) {
        if(subcategories.length > 0) {
            categoryDetails += `- ${category}: (sottocategorie: ${subcategories.join(', ')})\n`;
        } else {
            categoryDetails += `- ${category}\n`;
        }
    }
    return categoryDetails;
}

export async function parseExpensesFromImage(base64Image: string, mimeType: string): Promise<Partial<Expense>[]> {
    const imagePart = {
        inlineData: {
            mimeType,
            data: base64Image,
        },
    };
    const textPart = {
        text: `Analizza questa immagine di una ricevuta o scontrino e estrai TUTTE le informazioni sulle spese presenti. Se ci sono più spese, restituiscile come un array di oggetti.
        Le categorie e sottocategorie disponibili sono:
        ${getCategoryPrompt()}
        Se una categoria o sottocategoria non è chiara, imposta la categoria su "Altro" e lascia vuota la sottocategoria.
        Formatta la data come YYYY-MM-DD. Se non trovi una data, usa la data di oggi: ${toYYYYMMDD(new Date())}.
        Estrai una descrizione concisa per ogni spesa.
        Fornisci il risultato esclusivamente in formato JSON, anche se trovi una sola spesa (in quel caso, sarà un array con un solo elemento). Se non trovi nessuna spesa valida, restituisci un array vuoto.`
    };

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: { parts: [imagePart, textPart] },
        config: {
            responseMimeType: "application/json",
            responseSchema: multiExpenseSchema,
        }
    });

    const jsonStr = response.text.trim();
    if (!jsonStr) {
        return [];
    }
    return JSON.parse(jsonStr);
}


// --- Voice Parsing Logic ---

export const addExpenseFunctionDeclaration: FunctionDeclaration = {
  name: 'addExpense',
  parameters: {
    type: Type.OBJECT,
    description: 'Registra una nuova spesa.',
    properties: {
      description: {
        type: Type.STRING,
        description: 'Descrizione della spesa. Es: "Caffè al bar", "Biglietto del cinema".',
      },
      amount: {
        type: Type.NUMBER,
        description: 'Importo della spesa.',
      },
      category: {
        type: Type.STRING,
        description: `Categoria della spesa. Scegli tra: ${Object.keys(CATEGORIES).join(', ')}.`,
      },
    },
    required: ['amount'],
  },
};

export function encode(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Modifica la firma della funzione per accettare sampleRateInHz
export function createBlob(data: Float32Array, sampleRateInHz: number): Blob {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    int16[i] = data[i] * 32768;
  }
  return {
    data: encode(new Uint8Array(int16.buffer)),
    // Usa il rate reale passato dal componente Voice
    mimeType: `audio/pcm;rate=${sampleRateInHz}`,
  };
}

// FIX: Made callbacks required and removed async/return type as per Gemini API guidelines.
export function createLiveSession(callbacks: {
    onopen: () => void,
    onmessage: (message: LiveServerMessage) => void,
    onerror: (e: ErrorEvent) => void,
    onclose: (e: CloseEvent) => void
}) {
    const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks,
        config: {
            responseModalities: [Modality.AUDIO],
            inputAudioTranscription: {},
            tools: [{functionDeclarations: [addExpenseFunctionDeclaration]}],
             systemInstruction: `Sei un assistente vocale per un'app di gestione spese. 
             Il tuo compito è capire la spesa descritta dall'utente e chiamare la funzione 'addExpense' con i dati corretti.
             Oggi è ${new Date().toLocaleDateString('it-IT')}.
             Le categorie disponibili sono: ${Object.keys(CATEGORIES).join(', ')}.
             Se la categoria non è specificata, cerca di dedurla dalla descrizione. Se non è possibile, non specificarla.
             Sii conciso e non rispondere con audio a meno che non sia strettamente necessario per una domanda di chiarimento. Il tuo output principale è la chiamata di funzione.`
        }
    });
    return sessionPromise;
}

```


---

## `./utils/api.ts`

```ts
// utils/api.ts
import { hashPinWithSalt, verifyPin } from './auth';

// --- MOCK USER DATABASE in localStorage ---
// (Solo demo: NON sicuro per produzione)
export const getUsers = () => {
  try {
    return JSON.parse(localStorage.getItem('users_db') || '{}');
  } catch {
    return {};
  }
};
export const saveUsers = (users: any) => localStorage.setItem('users_db', JSON.stringify(users));

// URL Apps Script (web app "exec") — usato SOLO per inviare la mail
const SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbzmq-PTrMcMdrYqCRX29_S034zCaj5ttyc3tZhdhjV77wF6n99LKricFgzy7taGqKOo/exec';

// ------ Helpers ------
function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}
function buildResetRedirect(): string {
  // La tua pagina /reset su GitHub Pages
  return 'https://jerbamichol-del.github.io/gestore/reset/';
}
// Facoltativo: helper POST JSON (al momento non usato dopo la modifica)
async function postJSON<T = any>(url: string, data: any): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const out = await res.json().catch(() => ({}));
  const ok = out && (out.ok === true || out.success === true);
  return { ...out, ok, success: !!ok } as T;
}

// ------ API MOCK + integrazioni ------

/** Registra un nuovo utente (mock locale). */
export const register = async (
  email: string,
  pin: string
): Promise<{ success: boolean; message: string }> => {
  return new Promise(resolve => {
    setTimeout(async () => {
      const users = getUsers();
      const normalizedEmail = normalizeEmail(email);
      if (users[normalizedEmail]) {
        resolve({ success: false, message: 'Un utente con questa email esiste già.' });
        return;
      }
      const { hash, salt } = await hashPinWithSalt(pin);
      users[normalizedEmail] = { email: normalizedEmail, pinHash: hash, pinSalt: salt };
      saveUsers(users);
      resolve({ success: true, message: 'Registrazione completata.' });
    }, 1000);
  });
};

/** Login (mock locale). */
export const login = async (
  email: string,
  pin: string
): Promise<{ success: boolean; message: string; token?: string }> => {
  return new Promise(resolve => {
    setTimeout(async () => {
      const users = getUsers();
      const normalizedEmail = normalizeEmail(email);
      const user = users[normalizedEmail];
      if (!user) {
        resolve({ success: false, message: 'Nessun account trovato per questa email.' });
        return;
      }
      const isPinValid = await verifyPin(pin, user.pinHash, user.pinSalt);
      if (isPinValid) {
        const mockToken = `mock_token_${Date.now()}`;
        resolve({ success: true, message: 'Login effettuato con successo.', token: mockToken });
      } else {
        resolve({ success: false, message: 'PIN errato.' });
      }
    }, 1000);
  });
};

/**
 * Invia l’email di reset PIN.
 * Il tuo Apps Script si aspetta **GET ?action=request&email=...&redirect=...**
 */
export const forgotPassword = async (email: string): Promise<{ success: boolean; message: string }> => {
  const normalizedEmail = normalizeEmail(email);
  const redirect = buildResetRedirect();
  const url =
    `${SCRIPT_URL}?action=request` +
    `&email=${encodeURIComponent(normalizedEmail)}` +
    `&redirect=${encodeURIComponent(redirect)}`;

  try {
    // fire-and-forget: non ci interessa leggere la risposta
    await fetch(url, { method: 'GET', mode: 'no-cors', cache: 'no-store' });
  } catch (err) {
    console.warn('forgotPassword (fire-and-forget) warning:', err);
  }
  return { success: true, message: "Se l'email è registrata, riceverai un link per il reset." };
};

/**
 * Reimposta il PIN **in locale**.
 * Il token è già stato validato/consumato nella pagina /reset, quindi qui NON chiamiamo Apps Script.
 */
export const resetPin = async (
  email: string,
  _token: string,          // ignorato: già consumato in /reset
  newPin: string
): Promise<{ success: boolean; message: string }> => {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !newPin || newPin.length !== 4) {
    return { success: false, message: 'Dati non validi.' };
  }

  const users = getUsers();
  const user = users[normalizedEmail];
  if (!user) {
    return { success: false, message: 'Utente non trovato.' };
  }

  try {
    const { hash, salt } = await hashPinWithSalt(newPin);
    user.pinHash = hash;
    user.pinSalt = salt;
    users[normalizedEmail] = user;
    saveUsers(users);
    return { success: true, message: 'PIN aggiornato con successo.' };
  } catch (e) {
    console.error('Errore aggiornando il PIN locale:', e);
    return { success: false, message: 'Errore durante l’aggiornamento del PIN.' };
  }
};

```


---

## `./utils/auth.ts`

```ts
// Helper to convert Base64 string to ArrayBuffer
const b64ToArrayBuffer = (b64: string): ArrayBuffer => {
    const str = atob(b64);
    const bytes = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) {
        bytes[i] = str.charCodeAt(i);
    }
    return bytes.buffer;
};

// Helper to convert ArrayBuffer to Base64 string
const arrayBufferToB64 = (buffer: ArrayBuffer): string => {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
};


// --- PIN Hashing (PBKDF2) ---
export async function hashPinWithSalt(pin: string, salt?: ArrayBuffer): Promise<{ hash: string, salt: string }> {
    const saltBuffer = salt || crypto.getRandomValues(new Uint8Array(16));
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        encoder.encode(pin),
        { name: "PBKDF2" },
        false,
        ["deriveBits"]
    );
    const derivedBits = await crypto.subtle.deriveBits(
        {
            name: "PBKDF2",
            salt: saltBuffer,
            iterations: 100000,
            hash: "SHA-256",
        },
        keyMaterial,
        256
    );

    return {
        hash: arrayBufferToB64(derivedBits),
        salt: arrayBufferToB64(saltBuffer),
    };
}

export async function verifyPin(pin: string, storedHash: string, storedSalt: string): Promise<boolean> {
    if (!pin || !storedHash || !storedSalt) return false;
    try {
        const saltBuffer = b64ToArrayBuffer(storedSalt);
        const { hash: hashOfInput } = await hashPinWithSalt(pin, saltBuffer);
        return hashOfInput === storedHash;
    } catch (e) {
        console.error("PIN verification failed", e);
        return false;
    }
}

```


---

## `./utils/categoryStyles.tsx`

```tsx

import React from 'react';
import { AllIcon } from '../components/icons/categories/AllIcon';
import { FoodIcon } from '../components/icons/categories/FoodIcon';
import { TransportIcon } from '../components/icons/categories/TransportIcon';
import { HomeIcon } from '../components/icons/categories/HomeIcon';
import { ShoppingIcon } from '../components/icons/categories/ShoppingIcon';
import { LeisureIcon } from '../components/icons/categories/LeisureIcon';
import { HealthIcon } from '../components/icons/categories/HealthIcon';
import { EducationIcon } from '../components/icons/categories/EducationIcon';
import { WorkIcon } from '../components/icons/categories/WorkIcon';
import { OtherIcon } from '../components/icons/categories/OtherIcon';

interface CategoryStyle {
    label: string;
    Icon: React.FC<React.SVGProps<SVGSVGElement>>;
    color: string;
    bgColor: string;
}

export const categoryStyles: Record<string, CategoryStyle> = {
    'all': {
        label: 'Tutte',
        Icon: AllIcon,
        color: 'text-slate-600',
        bgColor: 'bg-slate-200',
    },
    'Alimentari': {
        label: 'Alimentari',
        Icon: FoodIcon,
        color: 'text-green-600',
        bgColor: 'bg-green-100',
    },
    'Trasporti': {
        label: 'Trasporti',
        Icon: TransportIcon,
        color: 'text-blue-600',
        bgColor: 'bg-blue-100',
    },
    'Casa': {
        label: 'Casa',
        Icon: HomeIcon,
        color: 'text-orange-600',
        bgColor: 'bg-orange-100',
    },
    'Shopping': {
        label: 'Shopping',
        Icon: ShoppingIcon,
        color: 'text-pink-600',
        bgColor: 'bg-pink-100',
    },
    'Tempo Libero': {
        label: 'Tempo Libero',
        Icon: LeisureIcon,
        color: 'text-purple-600',
        bgColor: 'bg-purple-100',
    },
    'Salute': {
        label: 'Salute',
        Icon: HealthIcon,
        color: 'text-red-600',
        bgColor: 'bg-red-100',
    },
    'Istruzione': {
        label: 'Istruzione',
        Icon: EducationIcon,
        color: 'text-yellow-600',
        bgColor: 'bg-yellow-100',
    },
    'Lavoro': {
        label: 'Lavoro',
        Icon: WorkIcon,
        color: 'text-indigo-600',
        bgColor: 'bg-indigo-100',
    },
    'Altro': {
        label: 'Altro',
        Icon: OtherIcon,
        color: 'text-gray-600',
        bgColor: 'bg-gray-200',
    },
};

export const getCategoryStyle = (category: string | 'all'): CategoryStyle => {
    return categoryStyles[category] || categoryStyles['Altro'];
};
```


---

## `./utils/db.ts`

```ts
import { openDB, IDBPDatabase } from 'idb';

export interface OfflineImage {
  id: string;
  base64Image: string;
  mimeType: string;
}

const DB_NAME = 'expense-manager-db';
const STORE_NAME = 'offline-images';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<unknown>> | null = null;

const getDb = (): Promise<IDBPDatabase<unknown>> => {
    if (!dbPromise) {
        dbPromise = openDB(DB_NAME, DB_VERSION, {
            upgrade(db) {
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                }
            },
        });
    }
    return dbPromise;
};

export const addImageToQueue = async (image: OfflineImage): Promise<void> => {
  const db = await getDb();
  await db.add(STORE_NAME, image);
};

export const getQueuedImages = async (): Promise<OfflineImage[]> => {
  const db = await getDb();
  return await db.getAll(STORE_NAME);
};

export const deleteImageFromQueue = async (id: string): Promise<void> => {
  const db = await getDb();
  await db.delete(STORE_NAME, id);
};

```


---

## `./utils/defaults.ts`

```ts
import { Account } from '../types';

export const DEFAULT_ACCOUNTS: Account[] = [
  { id: 'cash', name: 'Contanti' },
  { id: 'credit-card', name: 'Carta di Credito' },
  { id: 'bank-account', name: 'Conto Bancario' },
  { id: 'paypal', name: 'PayPal' },
  { id: 'revolut', name: 'Revolut' },
  { id: 'poste', name: 'PostePay' },
  { id: 'crypto', name: 'Cripto' },
];
```


---

## `./vite.config.ts`

```ts
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});

```
