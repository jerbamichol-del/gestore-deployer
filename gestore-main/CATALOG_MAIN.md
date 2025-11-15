# CATALOG_MAIN (testo)
Embed testo (<= 1048576 bytes per file)


---

## `./App.tsx`

```tsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Expense, Account } from './types';
import { useLocalStorage } from './hooks/useLocalStorage';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { useSwipe } from './hooks/useSwipe';
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

type NavView = 'home' | 'history';

type ToastMessage = { message: string; type: 'success' | 'info' | 'error' };

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = error => reject(error);
  });
};

const pickImage = (source: 'camera' | 'gallery'): Promise<File> => {
    return new Promise((resolve, reject) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';

        if (source === 'camera') {
            input.capture = 'environment';
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

const toYYYYMMDD = (date: Date) => date.toISOString().split('T')[0];
const parseDate = (dateString: string): Date => {
    const [year, month, day] = dateString.split('-').map(Number);
    return new Date(year, month - 1, day);
};

const calculateNextDueDate = (template: Expense, fromDate: Date): Date | null => {
    if (template.frequency !== 'recurring' || !template.recurrence) return null;
    const interval = template.recurrenceInterval || 1;
    const nextDate = new Date(fromDate);
    
    switch (template.recurrence) {
        case 'daily': nextDate.setDate(nextDate.getDate() + interval); break;
        case 'weekly': nextDate.setDate(nextDate.getDate() + 7 * interval); break;
        case 'monthly': nextDate.setMonth(nextDate.getMonth() + interval); break;
        case 'yearly': nextDate.setFullYear(nextDate.getFullYear() + interval); break;
        default: return null;
    }
    return nextDate;
};


const App: React.FC<{ onLogout: () => void }> = ({ onLogout }) => {
  const [expenses, setExpenses] = useLocalStorage<Expense[]>('expenses_v2', []);
  const [recurringExpenses, setRecurringExpenses] = useLocalStorage<Expense[]>('recurring_expenses_v1', []);
  const [accounts, setAccounts] = useLocalStorage<Account[]>('accounts_v1', DEFAULT_ACCOUNTS);
  const [activeView, setActiveView] = useState<NavView>('home');
  
  // Modal States
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isCalculatorContainerOpen, setIsCalculatorContainerOpen] = useState(false);
  const [isImageSourceModalOpen, setIsImageSourceModalOpen] = useState(false);
  const [isVoiceModalOpen, setIsVoiceModalOpen] = useState(false);
  const [isConfirmDeleteModalOpen, setIsConfirmDeleteModalOpen] = useState(false);
  const [isConfirmDeleteRecurringModalOpen, setIsConfirmDeleteRecurringModalOpen] = useState(false);
  const [isMultipleExpensesModalOpen, setIsMultipleExpensesModalOpen] = useState(false);
  const [isParsingImage, setIsParsingImage] = useState(false);
  const [isDateModalOpen, setIsDateModalOpen] = useState(false);
  const [isRecurringScreenOpen, setIsRecurringScreenOpen] = useState(false);
  
  // Data for Modals
  const [editingExpense, setEditingExpense] = useState<Expense | undefined>(undefined);
  const [editingRecurringExpense, setEditingRecurringExpense] = useState<Expense | undefined>(undefined);
  const [prefilledData, setPrefilledData] = useState<Partial<Omit<Expense, 'id'>> | undefined>(undefined);
  const [expenseToDeleteId, setExpenseToDeleteId] = useState<string | null>(null);
  const [recurringExpenseToDeleteId, setRecurringExpenseToDeleteId] = useState<string | null>(null);
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
  const [installPromptEvent, setInstallPromptEvent] = useState<any>(null); // ✅ FIX AGGIUNTO
  const backPressExitTimeoutRef = useRef<number | null>(null);
  const [isHistoryItemOpen, setIsHistoryItemOpen] = useState(false);
  const [isHistoryItemInteracting, setIsHistoryItemInteracting] = useState(false);
  const [showSuccessIndicator, setShowSuccessIndicator] = useState(false);
  const successIndicatorTimerRef = useRef<number | null>(null);
  
  useEffect(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const newExpenses: Expense[] = [];
    const updatedTemplates: Expense[] = [];

    recurringExpenses.forEach(template => {
        if (!template.date) {
          console.warn('Skipping recurring expense template with no date:', template);
          return; // Skip this template if it has no start date.
        }

        const cursorDateString = template.lastGeneratedDate || template.date;
        let cursor = parseDate(cursorDateString);
        let updatedTemplate = { ...template };
        
        let nextDue = !template.lastGeneratedDate ? parseDate(template.date) : calculateNextDueDate(template, cursor);

        while (nextDue && nextDue <= today) {
            const totalGenerated = expenses.filter(e => e.recurringExpenseId === template.id).length + newExpenses.filter(e => e.recurringExpenseId === template.id).length;
            if (template.recurrenceEndType === 'date' && template.recurrenceEndDate && toYYYYMMDD(nextDue) > template.recurrenceEndDate) break;
            if (template.recurrenceEndType === 'count' && template.recurrenceCount && totalGenerated >= template.recurrenceCount) break;
            
            const nextDueDateString = toYYYYMMDD(nextDue);
            const instanceExists = expenses.some(exp => exp.recurringExpenseId === template.id && exp.date === nextDueDateString);
            
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
            updatedTemplate.lastGeneratedDate = toYYYYMMDD(cursor);
            nextDue = calculateNextDueDate(template, cursor);
        }
        
        if (updatedTemplate.lastGeneratedDate && updatedTemplate.lastGeneratedDate !== template.lastGeneratedDate) {
            updatedTemplates.push(updatedTemplate);
        }
    });

    if (newExpenses.length > 0) {
        setExpenses(prev => [...newExpenses, ...prev]);
    }
    if (updatedTemplates.length > 0) {
        setRecurringExpenses(prev => prev.map(t => updatedTemplates.find(ut => ut.id === t.id) || t));
    }
  }, []);


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

  const handleNavigation = useCallback((targetView: NavView) => {
    if (activeView === targetView) return;

    if (activeView === 'history' && isDateModalOpen) {
        setIsDateModalOpen(false);
    }
    
    setActiveView(targetView);
    window.history.pushState({ view: targetView }, '');
  }, [activeView, isDateModalOpen]);
  

    useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
        event.preventDefault();
        const pushStateAfterHandling = () => window.history.pushState({ view: activeView }, '');
        if (isRecurringScreenOpen) {
            setIsRecurringScreenOpen(false);
            pushStateAfterHandling();
            return;
        }
        if (!!imageForAnalysis) { setImageForAnalysis(null); pushStateAfterHandling(); return; }
        if (isCalculatorContainerOpen) { setIsCalculatorContainerOpen(false); pushStateAfterHandling(); return; }
        if (isFormOpen) { setIsFormOpen(false); pushStateAfterHandling(); return; }
        if (isImageSourceModalOpen) { setIsImageSourceModalOpen(false); pushStateAfterHandling(); return; }
        if (isVoiceModalOpen) { setIsVoiceModalOpen(false); pushStateAfterHandling(); return; }
        if (isConfirmDeleteModalOpen) { setIsConfirmDeleteModalOpen(false); setExpenseToDeleteId(null); pushStateAfterHandling(); return; }
        if (isConfirmDeleteRecurringModalOpen) { setIsConfirmDeleteRecurringModalOpen(false); setRecurringExpenseToDeleteId(null); pushStateAfterHandling(); return; }
        if (isMultipleExpensesModalOpen) { setIsMultipleExpensesModalOpen(false); pushStateAfterHandling(); return; }
        if (activeView !== 'home') { handleNavigation('home'); return; }
        if (backPressExitTimeoutRef.current) { clearTimeout(backPressExitTimeoutRef.current); backPressExitTimeoutRef.current = null; window.close(); } 
        else { showToast({ message: 'Premi di nuovo per uscire.', type: 'info' }); backPressExitTimeoutRef.current = window.setTimeout(() => { backPressExitTimeoutRef.current = null; }, 2000); pushStateAfterHandling(); }
    };
    window.history.pushState({ view: 'home' }, '');
    window.addEventListener('popstate', handlePopState);
    return () => {
        window.removeEventListener('popstate', handlePopState);
        if (backPressExitTimeoutRef.current) clearTimeout(backPressExitTimeoutRef.current);
    };
  }, [ activeView, handleNavigation, showToast, isCalculatorContainerOpen, isFormOpen, isImageSourceModalOpen, isVoiceModalOpen, isConfirmDeleteModalOpen, isConfirmDeleteRecurringModalOpen, isMultipleExpensesModalOpen, imageForAnalysis, isRecurringScreenOpen ]);


  const swipeContainerRef = useRef<HTMLDivElement>(null);
  
  const handleNavigateHome = useCallback(() => {
    handleNavigation('home');
  }, [handleNavigation]);

  const { progress, isSwiping } = useSwipe(
    swipeContainerRef,
    {
      onSwipeLeft: activeView === 'home' ? () => handleNavigation('history') : undefined,
      onSwipeRight: activeView === 'history' ? handleNavigateHome : undefined,
    },
    {
      enabled: !isCalculatorContainerOpen && !isDateModalOpen && !isRecurringScreenOpen && !isHistoryItemInteracting,
      threshold: 36,
      slop: 10,
      ignoreSelector: '[data-no-page-swipe]',
    }
  );
  
  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => { e.preventDefault(); setInstallPromptEvent(e); };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => { window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt); };
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

  const refreshPendingImages = useCallback(() => {
    getQueuedImages().then(images => {
      setPendingImages(images);
      if (images.length > pendingImagesCountRef.current) {
        showToast({ message: 'Immagine salvata! Pronta per l\'analisi.', type: 'info' });
      }
      pendingImagesCountRef.current = images.length;
    });
  }, [showToast]);

  useEffect(() => {
    refreshPendingImages();
    const handleStorageChange = () => { refreshPendingImages(); };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [refreshPendingImages]);

  useEffect(() => {
    if (prevIsOnlineRef.current === false && isOnline && pendingImages.length > 0) {
      showToast({ message: `Sei online! ${pendingImages.length} immagini in attesa.`, type: 'info' });
    }
    prevIsOnlineRef.current = isOnline;
  }, [isOnline, pendingImages.length, showToast]);

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
    setExpenses(prev => prev.map(e => e.id === updatedExpense.id ? updatedExpense : e));
    triggerSuccessIndicator();
  };

  const updateRecurringExpense = (updatedTemplate: Expense) => {
    setRecurringExpenses(prev => prev.map(e => e.id === updatedTemplate.id ? updatedTemplate : e));
    triggerSuccessIndicator();
  };

  const handleFormSubmit = (data: Omit<Expense, 'id'> | Expense) => {
      if (editingRecurringExpense && 'id' in data && data.id === editingRecurringExpense.id && data.frequency !== 'recurring') {
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

  const openEditForm = (expense: Expense) => { setEditingExpense(expense); setIsFormOpen(true); };
  const openRecurringEditForm = (expense: Expense) => { setEditingRecurringExpense(expense); setIsFormOpen(true); };
  
  const handleDeleteRequest = (id: string) => { setExpenseToDeleteId(id); setIsConfirmDeleteModalOpen(true); };
  const handleDeleteRecurringRequest = (id: string) => { setRecurringExpenseToDeleteId(id); setIsConfirmDeleteRecurringModalOpen(true); };
  
  const confirmDelete = () => {
    if (expenseToDeleteId) {
      setExpenses(prev => prev.filter(e => e.id !== expenseToDeleteId));
      setExpenseToDeleteId(null);
      setIsConfirmDeleteModalOpen(false);
      showToast({ message: 'Spesa eliminata.', type: 'info' });
    }
  };
  
  const confirmDeleteRecurring = () => {
    if (recurringExpenseToDeleteId) {
      setRecurringExpenses(prev => prev.filter(e => e.id !== recurringExpenseToDeleteId));
      setRecurringExpenseToDeleteId(null);
      setIsConfirmDeleteRecurringModalOpen(false);
      showToast({ message: 'Spesa ricorrente eliminata.', type: 'info' });
    }
  };

  const handleImagePick = async (source: 'camera' | 'gallery') => {
    setIsImageSourceModalOpen(false);
    sessionStorage.setItem('preventAutoLock', 'true');
    try {
        const file = await pickImage(source);
        const base64Image = await fileToBase64(file);
        const newImage: OfflineImage = { id: crypto.randomUUID(), base64Image, mimeType: file.type };
        if (isOnline) { setImageForAnalysis(newImage); } 
        else { await addImageToQueue(newImage); refreshPendingImages(); }
    } catch (error) {
        if (!(error instanceof Error && error.message.includes('annullata'))) {
            console.error('Errore selezione immagine:', error);
            showToast({ message: 'Errore durante la selezione dell\'immagine.', type: 'error' });
        }
    } finally {
        setTimeout(() => sessionStorage.removeItem('preventAutoLock'), 2000);
    }
  };
  
  const handleAnalyzeImage = async (image: OfflineImage, fromQueue: boolean = true) => {
      if (!isOnline) { showToast({ message: 'Connettiti a internet per analizzare le immagini.', type: 'error' }); return; }
      setSyncingImageId(image.id); setIsParsingImage(true);
      try {
          const parsedData = await parseExpensesFromImage(image.base64Image, image.mimeType);
          if (parsedData.length === 0) { showToast({ message: 'Nessuna spesa trovata nell\'immagine.', type: 'info' }); } 
          else if (parsedData.length === 1) { setPrefilledData(parsedData[0]); setIsFormOpen(true); } 
          else { setMultipleExpensesData(parsedData); setIsMultipleExpensesModalOpen(true); }
          if (fromQueue) { await deleteImageFromQueue(image.id); refreshPendingImages(); }
      } catch (error) {
          console.error('Error durante l\'analisi AI:', error);
          showToast({ message: 'Errore durante l\'analisi dell\'immagine.', type: 'error' });
      } finally {
          setIsParsingImage(false); setSyncingImageId(null);
      }
  };

  const handleVoiceParsed = (data: Partial<Omit<Expense, 'id'>>) => { setIsVoiceModalOpen(false); setPrefilledData(data); setIsFormOpen(true); };
  
  const handleHistoryItemStateChange = useCallback(({ isOpen, isInteracting }: { isOpen: boolean; isInteracting: boolean; }) => { setIsHistoryItemOpen(isOpen); setIsHistoryItemInteracting(isInteracting); }, []);

  const isEditingOrDeletingInHistory = (isFormOpen && !!editingExpense) || isConfirmDeleteModalOpen;

  const mainContentClasses = isCalculatorContainerOpen || isRecurringScreenOpen ? 'pointer-events-none' : '';
  
  const baseTranslatePercent = activeView === 'home' ? 0 : -50;
  const dragTranslatePercent = progress * 50;
  const viewTranslate = baseTranslatePercent + dragTranslatePercent;
  
  const isAnyModalOpenForFab = isFormOpen || isImageSourceModalOpen || isVoiceModalOpen || isConfirmDeleteModalOpen || isConfirmDeleteRecurringModalOpen || isMultipleExpensesModalOpen || isDateModalOpen || isParsingImage || !!imageForAnalysis || isRecurringScreenOpen;
  
  const isOverlayActiveForHistory = isCalculatorContainerOpen || isFormOpen || isConfirmDeleteModalOpen || isImageSourceModalOpen || isVoiceModalOpen || isMultipleExpensesModalOpen || isParsingImage || !!imageForAnalysis;

  const fabStyle: React.CSSProperties = {
    transform: activeView === 'history' ? 'translateY(-70px)' : 'translateY(0)',
    opacity: isAnyModalOpenForFab ? 0 : 1,
    visibility: isAnyModalOpenForFab ? 'hidden' : 'visible',
    pointerEvents: isAnyModalOpenForFab ? 'none' : 'auto',
    transition: `transform 0.25s cubic-bezier(0.22, 0.61, 0.36, 1), opacity 0.2s ease-out, visibility 0s linear ${isAnyModalOpenForFab ? '0.2s' : '0s'}`
  };

  return (
    <div className="h-full w-full bg-slate-100 flex flex-col font-sans overflow-hidden" style={{ touchAction: 'pan-y' }}>
        <div className={`flex-shrink-0 z-20 ${mainContentClasses}`}>
            <Header
              pendingSyncs={pendingImages.length}
              isOnline={isOnline}
              activeView={activeView}
              onNavigate={handleNavigation}
              onInstallClick={handleInstallClick}
              installPromptEvent={installPromptEvent}
            />
        </div>
        
        <main 
          ref={swipeContainerRef}
          className={`flex-grow overflow-hidden ${mainContentClasses}`}
        >
            <div 
                className="w-[200%] h-full flex swipe-container"
                style={{
                  transform: `translateX(${viewTranslate}%)`,
                  transition: isSwiping ? 'none' : 'transform 0.08s ease-out',
                  pointerEvents: 'auto',
                }}
            >
                <div className="w-1/2 h-full overflow-y-auto space-y-6 swipe-view" style={{ touchAction: 'pan-y' }}>
                    <Dashboard expenses={expenses} onLogout={onLogout} onNavigateToRecurring={() => setIsRecurringScreenOpen(true)} isPageSwiping={isSwiping} />
                    <PendingImages 
                        images={pendingImages}
                        onAnalyze={(image) => handleAnalyzeImage(image, true)}
                        onDelete={async (id) => {
                            await deleteImageFromQueue(id);
                            refreshPendingImages();
                        }}
                        isOnline={isOnline}
                        syncingImageId={syncingImageId}
                    />
                </div>
                <div className="w-1/2 h-full swipe-view">
                    <HistoryScreen 
                      expenses={expenses}
                      accounts={accounts}
                      onEditExpense={openEditForm}
                      onDeleteExpense={handleDeleteRequest}
                      onItemStateChange={handleHistoryItemStateChange}
                      isEditingOrDeleting={isEditingOrDeletingInHistory}
                      onNavigateHome={handleNavigateHome}
                      isActive={activeView === 'history'}
                      onDateModalStateChange={setIsDateModalOpen}
                      isPageSwiping={isSwiping}
                      isOverlayActive={isOverlayActiveForHistory}
                    />
                </div>
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
        
        <SuccessIndicator
            show={showSuccessIndicator && !isDateModalOpen}
            style={{
              transform: activeView === 'history' ? 'translateY(-70px)' : 'translateY(0)',
              transition: 'transform 0.25s cubic-bezier(0.22, 0.61, 0.36, 1)',
            }}
        />
        
        {toast && (
            <Toast 
                message={toast.message} 
                type={toast.type} 
                onClose={() => setToast(null)} 
            />
        )}
        
        <CalculatorContainer 
            isOpen={isCalculatorContainerOpen}
            onClose={() => setIsCalculatorContainerOpen(false)}
            onSubmit={handleFormSubmit}
            accounts={accounts}
            expenses={expenses}
            onEditExpense={openEditForm}
            onDeleteExpense={handleDeleteRequest}
            onMenuStateChange={() => {}} // ✅ FIX: Prop aggiunta
        />
      
        <ExpenseForm 
            isOpen={isFormOpen}
            onClose={() => { setIsFormOpen(false); setEditingExpense(undefined); setEditingRecurringExpense(undefined); setPrefilledData(undefined); }}
            onSubmit={handleFormSubmit}
            initialData={editingExpense || editingRecurringExpense}
            prefilledData={prefilledData}
            accounts={accounts}
            isForRecurringTemplate={!!editingRecurringExpense}
        />

        {isImageSourceModalOpen && (
           <div
              className={`fixed inset-0 z-50 flex justify-center items-end p-4 transition-opacity duration-300 ease-in-out bg-slate-900/60 backdrop-blur-sm`}
              onClick={() => setIsImageSourceModalOpen(false)}
              aria-modal="true"
              role="dialog"
            >
              <div
                className={`bg-slate-50 rounded-lg shadow-xl w-full max-w-lg transform transition-all duration-300 ease-in-out animate-fade-in-up`}
                onClick={(e) => e.stopPropagation()}
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
                        icon={<CameraIcon className="w-8 h-8"/>}
                        title="Scatta Foto"
                        description="Usa la fotocamera per una nuova ricevuta."
                        onClick={() => handleImagePick('camera')}
                      />
                      <ImageSourceCard 
                        icon={<ComputerDesktopIcon className="w-8 h-8"/>}
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
                <SpinnerIcon className="w-12 h-12 text-indigo-600"/>
                <p className="mt-4 text-lg font-semibold text-slate-700 animate-pulse-subtle">Analisi in corso...</p>
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
            message={<>Sei sicuro di voler eliminare questa spesa? <br/>L'azione è irreversibile.</>}
            variant="danger"
        />

        <ConfirmationModal 
            isOpen={isConfirmDeleteRecurringModalOpen}
            onClose={() => {
                setIsConfirmDeleteRecurringModalOpen(false);
                setRecurringExpenseToDeleteId(null);
            }}
            onConfirm={confirmDeleteRecurring}
            title="Conferma Eliminazione"
            message={<>Sei sicuro di voler eliminare questa spesa ricorrente? <br/>Le spese già generate non verranno cancellate.</>}
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

        {isRecurringScreenOpen && (
            <RecurringExpensesScreen
                recurringExpenses={recurringExpenses}
                accounts={accounts}
                onClose={() => setIsRecurringScreenOpen(false)}
                onEdit={openRecurringEditForm}
                onDelete={handleDeleteRecurringRequest}
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
    transition: isSwiping ? 'none' : 'transform 0.08s ease-out',
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
import { useTapBridge } from '../hooks/useTapBridge';


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
  const tapBridgeHandlers = useTapBridge();

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
        {...tapBridgeHandlers}
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

View your app in AI Studio: https://ai.studio/apps/drive/1jhTn1az-nBiGXLJXpxAuxLildi_YPzKS

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
    transition: isSwiping ? 'none' : 'transform 0.08s ease-out',
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

  const handleSubmit = useCallback(() => {
    if ((formData.amount ?? 0) > 0) {
      onSubmit({ ...formData, category: formData.category || 'Altro' } as Omit<Expense, 'id'>);
    }
  }, [formData, onSubmit]);

  const handleSelectChange = useCallback((field: keyof Omit<Expense, 'id'>, value: string) => {
    const updated = { [field]: value } as Partial<Omit<Expense, 'id'>>;
    if (field === 'category') (updated as any).subcategory = '';
    onFormChange(updated);
    setActiveMenu(null);
  }, [onFormChange]);

  const canSubmit = (formData.amount ?? 0) > 0;

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
      className={`fixed inset-0 z-50 flex justify-center items-center p-4 transition-opacity duration-300 ease-in-out ${isAnimating ? 'opacity-100' : 'opacity-0'} bg-slate-900/60 backdrop-blur-sm`}
      onClick={onClose}
      aria-modal="true"
      role="dialog"
      aria-labelledby="modal-title"
    >
      <div
        className={`bg-white rounded-lg shadow-xl w-full max-w-md transform transition-all duration-300 ease-in-out ${isAnimating ? 'scale-100 opacity-100' : 'scale-95 opacity-0'}`}
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
import { LockClosedIcon } from './icons/LockClosedIcon';
import { ArrowPathIcon } from './icons/ArrowPathIcon';
import { ChevronRightIcon } from './icons/ChevronRightIcon';
import { useTapBridge } from '../hooks/useTapBridge';

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
  onLogout: () => void;
  onNavigateToRecurring: () => void;
  isPageSwiping?: boolean;
}

const Dashboard: React.FC<DashboardProps> = ({ expenses, onLogout, onNavigateToRecurring, isPageSwiping }) => {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const tapBridge = useTapBridge();
  const activeIndex = selectedIndex;

  const handleLegendItemClick = (index: number, event: React.MouseEvent) => {
    event.stopPropagation();
    setSelectedIndex(current => (current === index ? null : index));
  };
  
  const handleChartBackgroundClick = () => {
    setSelectedIndex(null);
  };

  const { totalExpenses, dailyTotal, categoryData } = useMemo(() => {
    const validExpenses = expenses.filter(e => e.amount != null && !isNaN(Number(e.amount)));
    
    const total = validExpenses.reduce((acc, expense) => acc + Number(expense.amount), 0);
    
    const today = new Date();
    const todayString = today.toISOString().split('T')[0];
    const daily = validExpenses
        .filter(expense => expense.date === todayString)
        .reduce((acc, expense) => acc + Number(expense.amount), 0);
        
    const categoryTotals = validExpenses.reduce((acc: Record<string, number>, expense) => {
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
        categoryData: sortedCategoryData
    };
  }, [expenses]);
  
  return (
    <>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-1 bg-white p-6 rounded-2xl shadow-lg flex flex-col justify-between">
                <div>
                    <div className="flex justify-between items-center mb-4">
                        <div className="flex items-center gap-2">
                            <h3 className="text-xl font-bold text-slate-700">Spesa Totale</h3>
                        </div>
                        <button
                            onClick={onLogout}
                            className="p-2 text-slate-500 hover:text-indigo-600 hover:bg-indigo-100 rounded-full transition-colors"
                            aria-label="Logout"
                            title="Logout"
                        >
                            <LockClosedIcon className="w-6 h-6" />
                        </button>
                    </div>
                    <p className="text-4xl font-extrabold text-indigo-600">{formatCurrency(totalExpenses)}</p>
                </div>
                <div className="mt-4 pt-4 border-t border-slate-200">
                    <div>
                        <h4 className="text-sm font-medium text-slate-500">Oggi</h4>
                        <p className="text-xl font-bold text-slate-800">{formatCurrency(dailyTotal)}</p>
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
        
        <button
            onClick={onNavigateToRecurring}
            style={{ touchAction: 'manipulation' }}
            className="w-full flex items-center justify-between gap-4 px-6 py-4 text-left font-semibold text-slate-800 bg-white rounded-2xl shadow-lg hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-all"
            {...tapBridge}
        >
            <div className="flex items-center gap-4">
                <span className="w-10 h-10 rounded-xl flex items-center justify-center bg-indigo-100">
                    <ArrowPathIcon className="w-6 h-6 text-indigo-600" />
                </span>
                <div>
                    <span className="text-base">Spese Ricorrenti</span>
                    <p className="text-sm font-normal text-slate-500">Gestisci abbonamenti e pagamenti fissi</p>
                </div>
            </div>
            <ChevronRightIcon className="w-6 h-6 text-slate-400" />
        </button>

        <div className="bg-white p-6 rounded-2xl shadow-lg">
            <h3 className="text-xl font-bold text-slate-700 mb-2 text-center">Spese per Categoria</h3>
            {categoryData.length > 0 ? (
                <div className={`relative cursor-pointer ${isPageSwiping ? 'pointer-events-none' : ''}`} onClick={handleChartBackgroundClick}>
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
                            <span className="text-slate-500 text-sm">Spesa Totale</span>
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
    </>
  );
};

export default Dashboard;
```


---

## `./components/DateRangePickerModal.tsx`

```tsx
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { XMarkIcon } from './icons/XMarkIcon';
import { ChevronLeftIcon } from './icons/ChevronLeftIcon';
import { ChevronRightIcon } from './icons/ChevronRightIcon';
import { ChevronDownIcon } from './icons/ChevronDownIcon';

interface DateRangePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (range: { start: string, end: string }) => void;
  initialRange: { start: string | null, end: string | null };
}

const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
const getFirstDayOfMonth = (year: number, month: number) => (new Date(year, month, 1).getDay() + 6) % 7; // 0 = Lunedì

const parseLocalYYYYMMDD = (dateString: string | null): Date | null => {
  if (!dateString) return null;
  const parts = dateString.split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]); // locale 00:00
};

const CalendarView = React.memo(({
  viewDate,
  today,
  startDate,
  endDate,
  hoverDate,
  onDateClick,
  onHoverDate,
  isHoverDisabled
}: {
  viewDate: Date;
  today: Date;
  startDate: Date | null;
  endDate: Date | null;
  hoverDate: Date | null;
  onDateClick: (day: number) => void;
  onHoverDate: (date: Date | null) => void;
  isHoverDisabled: boolean;
}) => {
  const calendarGrid = useMemo(() => {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const daysInMonth = getDaysInMonth(year, month);
    const firstDay = getFirstDayOfMonth(year, month);
    const grid: (number | null)[] = Array(firstDay).fill(null);
    for (let i = 1; i <= daysInMonth; i++) grid.push(i);
    // Pad to 6 weeks (42 cells) to maintain consistent height
    while (grid.length < 42) {
      grid.push(null);
    }
    return grid;
  }, [viewDate]);

  const renderDay = (day: number | null, index: number) => {
    if (!day) return <div key={index} className="h-10" />;

    const date = new Date(viewDate.getFullYear(), viewDate.getMonth(), day);
    const dateTime = date.getTime();
    const isToday = dateTime === today.getTime();

    // Selection states
    const isSelectedStart = !!(startDate && dateTime === startDate.getTime());
    const isSelectedEnd = !!(endDate && dateTime === endDate.getTime());

    // Hover states (for preview)
    const isHovering = !!(hoverDate && dateTime === hoverDate.getTime());

    // Range states
    let inRange = false; // Final selected range
    let inPreviewRange = false; // Hover preview range

    if (startDate && endDate) {
        const startTime = startDate.getTime();
        const endTime = endDate.getTime();
        inRange = dateTime > startTime && dateTime < endTime;
    } else if (startDate && !endDate && hoverDate && !isHoverDisabled) {
        const startTime = startDate.getTime();
        const hoverTime = hoverDate.getTime();
        if (hoverTime > startTime) {
            inPreviewRange = dateTime > startTime && dateTime < hoverTime;
        } else if (hoverTime < startTime) {
            inPreviewRange = dateTime < startTime && dateTime > hoverTime;
        }
    }

    // --- CSS Logic ---

    // Wrapper for pill background
    let wrapperClasses = 'flex justify-center items-center';
    
    const effectiveStartDate = startDate;
    const effectiveEndDate = endDate;
    
    if (effectiveStartDate && effectiveEndDate) {
        const startTime = effectiveStartDate.getTime();
        const endTime = effectiveEndDate.getTime();
        const minTime = Math.min(startTime, endTime);
        const maxTime = Math.max(startTime, endTime);

        if (dateTime > minTime && dateTime < maxTime) {
            wrapperClasses += ' bg-indigo-100';
        }
        
        if (dateTime === minTime) {
            wrapperClasses += ' rounded-l-full bg-indigo-100';
        }
        if (dateTime === maxTime) {
            wrapperClasses += ' rounded-r-full bg-indigo-100';
        }
        if (startTime === endTime && (isSelectedStart || isSelectedEnd)) {
             wrapperClasses += ' rounded-full';
        }
    }


    // Button for day number and selection dot
    const baseClasses = "w-10 h-10 flex items-center justify-center text-sm transition-colors duration-150 rounded-full select-none";
    let dayClasses = "";

    if (isSelectedStart || isSelectedEnd || isHovering) {
        dayClasses = "bg-indigo-600 text-white font-bold";
    } else if (inRange || inPreviewRange) {
        dayClasses = "font-bold bg-transparent text-indigo-800 hover:bg-slate-200/50";
    } else {
        dayClasses = "font-bold text-slate-800 hover:bg-slate-200";
        if (isToday) {
            dayClasses += " text-indigo-600";
        }
    }

    return (
        <div
            key={index}
            className={wrapperClasses}
            onMouseEnter={() => !isHoverDisabled && onHoverDate(date)}
        >
            <button onClick={() => onDateClick(day)} className={`${baseClasses} ${dayClasses}`}>
                {day}
            </button>
        </div>
    );
  };

  return (
    <div
      className="border border-slate-300 rounded-lg p-2 bg-white shadow-sm"
      onMouseLeave={() => !isHoverDisabled && onHoverDate(null)}
    >
      <div className="grid grid-cols-7 gap-y-1 text-center text-xs font-semibold text-slate-500 mb-2">
        <div>L</div><div>M</div><div>M</div><div>G</div><div>V</div><div>S</div><div>D</div>
      </div>
      <div className="grid grid-cols-7 gap-y-1">
        {calendarGrid.map(renderDay)}
      </div>
    </div>
  );
});

const DateInputButton = ({ label, date, isActive, onClick }: {
  label: string;
  date: Date | null;
  isActive: boolean;
  onClick: () => void;
}) => {
  const buttonClasses = `w-full p-2 rounded-lg border-2 text-left transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-400 ${
    isActive ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 bg-white hover:border-slate-400'
  }`;

  const formattedDate = date 
    ? new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', year: 'numeric' }).format(date).replace('.', '')
    : 'Seleziona';

  return (
    <button onClick={onClick} className={buttonClasses}>
      <span className="block text-xs font-semibold text-slate-500">{label}</span>
      <span className={`block text-base font-bold ${date ? 'text-slate-800' : 'text-slate-400'}`}>{formattedDate}</span>
    </button>
  );
};

export const DateRangePickerModal: React.FC<DateRangePickerModalProps> = ({ isOpen, onClose, onApply, initialRange }) => {
  const [isAnimating, setIsAnimating] = useState(false);
  const [pickerView, setPickerView] = useState<'days' | 'months' | 'years'>('days');
  const [selectingFor, setSelectingFor] = useState<'start' | 'end' | null>('start');

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  
  const [displayDate, setDisplayDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [transition, setTransition] = useState<{ direction: 'left' | 'right' } | null>(null);
  
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [hoverDate, setHoverDate] = useState<Date | null>(null);
  
  const swipeContainerRef = useRef<HTMLDivElement>(null);
  const swipeState = useRef({ isDragging: false, startX: 0, startY: 0, isLocked: false });
  const ignoreClickRef = useRef<boolean>(false);

  useEffect(() => {
    if (isOpen) {
      const newStartDate = parseLocalYYYYMMDD(initialRange.start);
      const newEndDate = parseLocalYYYYMMDD(initialRange.end);
      setStartDate(newStartDate);
      setEndDate(newEndDate);

      setSelectingFor('start');
      const initialDisplay = newStartDate || today;
      setDisplayDate(new Date(initialDisplay.getFullYear(), initialDisplay.getMonth(), 1));
      
      setPickerView('days');
      const timer = setTimeout(() => setIsAnimating(true), 10);
      return () => clearTimeout(timer);
    } else {
      setIsAnimating(false);
    }
  }, [isOpen, initialRange.start, initialRange.end, today]);

  const {
    prevMonthDate,
    nextMonthDate
  } = useMemo(() => {
    const d = displayDate;
    const nextMonth = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    return {
      prevMonthDate: new Date(d.getFullYear(), d.getMonth() - 1, 1),
      nextMonthDate: nextMonth,
    };
  }, [displayDate]);
  
  const { yearsInView, yearRangeLabel } = useMemo(() => {
    const year = displayDate.getFullYear();
    const startYear = Math.floor(year / 12) * 12;
    const years = Array.from({ length: 12 }, (_, i) => startYear + i);
    return { yearsInView: years, yearRangeLabel: `${startYear} - ${startYear + 11}` };
  }, [displayDate]);

  const triggerTransition = (direction: 'left' | 'right') => {
    if (transition) return;
    setTransition({ direction });
  };

  const handleAnimationEnd = () => {
    if (transition) {
      setDisplayDate(transition.direction === 'left' ? nextMonthDate : prevMonthDate);
      setTransition(null);
    }
  };

  const changeYear = (delta: number) => {
    setHoverDate(null);
    setDisplayDate(current => {
      const newYear = current.getFullYear() + delta;
      return new Date(newYear, current.getMonth(), 1);
    });
  };

  const changeYearRange = (delta: number) => changeYear(delta * 12);

  const handleDateClick = (day: number) => {
    if (ignoreClickRef.current) return;
    const clickedDate = new Date(displayDate.getFullYear(), displayDate.getMonth(), day);
    const clickedTime = clickedDate.getTime();
    setHoverDate(null);

    const startTime = startDate ? startDate.getTime() : null;
    const endTime = endDate ? endDate.getTime() : null;

    if (selectingFor === 'start') {
        if (startTime === clickedTime) {
            // Deselect start date
            setStartDate(null);
        } else {
            // Set new start date
            setStartDate(clickedDate);
            // If new start is after end, clear end date
            if (endTime && clickedTime > endTime) {
                setEndDate(null);
            }
            // And move to select end date
            setSelectingFor('end');
        }
    } else if (selectingFor === 'end') {
        if (endTime === clickedTime) {
            // Deselect end date
            setEndDate(null);
        } else {
            // Set a new end date, handling swaps if necessary
            if (startTime && clickedTime < startTime) {
                setEndDate(startDate);
                setStartDate(clickedDate);
            } else {
                setEndDate(clickedDate);
            }
            // Finish selection
            setSelectingFor(null);
        }
    } else { // selectingFor is null, a range is complete
        // Clicking a date after a range is selected should start a new selection.
        setStartDate(clickedDate);
        setEndDate(null);
        setSelectingFor('end');
    }
  };

  const handleApply = () => {
    if (startDate && endDate) {
      const toYYYYMMDD = (date: Date) => date.toISOString().split('T')[0];
      onApply({ start: toYYYYMMDD(startDate), end: toYYYYMMDD(endDate) });
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (pickerView !== 'days' || transition) return;
    swipeState.current = { startX: e.clientX, startY: e.clientY, isDragging: true, isLocked: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  
  const handlePointerMove = (e: React.PointerEvent) => {
    if (!swipeState.current.isDragging) return;
    const dx = e.clientX - swipeState.current.startX;
    const dy = e.clientY - swipeState.current.startY;
    if (!swipeState.current.isLocked) {
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
        swipeState.current.isLocked = Math.abs(dx) > Math.abs(dy);
      }
    }
     if (swipeState.current.isLocked) {
       if (e.cancelable) { e.preventDefault(); e.stopPropagation(); }
    }
  };

  const handlePointerEnd = (e: React.PointerEvent) => {
    if (!swipeState.current.isDragging) return;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    
    if (swipeState.current.isLocked) {
      const dx = e.clientX - swipeState.current.startX;
      const SWIPE_THRESHOLD = 50;
      if (dx < -SWIPE_THRESHOLD) triggerTransition('left');
      else if (dx > SWIPE_THRESHOLD) triggerTransition('right');
      if (Math.abs(dx) > 10) {
        ignoreClickRef.current = true;
        setTimeout(() => { ignoreClickRef.current = false; }, 0);
      }
    }
    swipeState.current = { isDragging: false, startX: 0, startY: 0, isLocked: false };
  };

  if (!isOpen) return null;

  const months = Array.from({ length: 12 }, (_, i) =>
    new Date(0, i).toLocaleString('it-IT', { month: 'long' })
  );
  
  const getNavLabel = (direction: 'prev' | 'next') => {
    const action = direction === 'prev' ? 'precedente' : 'successivo';
    switch (pickerView) {
        case 'days': return `Mese ${action}`;
        case 'months': return `Anno ${action}`;
        case 'years': return `Intervallo di anni ${action}`;
        default: return '';
    }
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex justify-center items-center p-4 transition-opacity duration-300 ease-in-out ${isAnimating ? 'opacity-100' : 'opacity-0'} bg-slate-900/60 backdrop-blur-sm`}
      onClick={onClose}
      aria-modal="true"
      role="dialog"
    >
      <div
        className={`bg-white rounded-lg shadow-xl w-full max-w-sm transform transition-all duration-300 ease-in-out ${isAnimating ? 'scale-100 opacity-100' : 'scale-95 opacity-0'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex justify-between items-center p-4 border-b border-slate-200">
          <h2 className="text-lg font-bold text-slate-800">Seleziona Intervallo</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1 rounded-full hover:bg-slate-200">
            <XMarkIcon className="w-6 h-6" />
          </button>
        </header>

        <div className="p-4 overflow-hidden">
          <div className="grid grid-cols-2 gap-3 mb-4">
            <DateInputButton label="Da" date={startDate} isActive={selectingFor === 'start'} onClick={() => setSelectingFor('start')} />
            <DateInputButton label="A" date={endDate} isActive={selectingFor === 'end'} onClick={() => setSelectingFor('end')} />
          </div>

          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => {
                if (pickerView === 'days') triggerTransition('right');
                else if (pickerView === 'months') changeYear(-1);
                else if (pickerView === 'years') changeYearRange(-1);
              }}
              className="p-2 rounded-full hover:bg-slate-200"
              aria-label={getNavLabel('prev')}
            >
              <ChevronLeftIcon className="w-5 h-5 text-slate-600" />
            </button>
            <button
              onClick={() => {
                  if (pickerView === 'days') setPickerView('months');
                  else if (pickerView === 'months') setPickerView('years');
              }}
              className="font-semibold text-slate-700 capitalize p-1 rounded-md hover:bg-slate-200 flex items-center gap-1"
              aria-live="polite"
              aria-expanded={pickerView !== 'days'}
            >
              <span>
                {pickerView === 'days' ? displayDate.toLocaleString('it-IT', { month: 'long', year: 'numeric' })
                  : pickerView === 'months' ? displayDate.getFullYear()
                  : yearRangeLabel
                }
              </span>
              <ChevronDownIcon className={`w-4 h-4 text-slate-500 transition-transform duration-200 ${pickerView !== 'days' ? 'rotate-180' : ''}`} />
            </button>
            <button
              onClick={() => {
                if (pickerView === 'days') triggerTransition('left');
                else if (pickerView === 'months') changeYear(1);
                else if (pickerView === 'years') changeYearRange(1);
              }}
              className="p-2 rounded-full hover:bg-slate-200 disabled:text-slate-300 disabled:hover:bg-transparent disabled:cursor-not-allowed"
              aria-label={getNavLabel('next')}
            >
              <ChevronRightIcon className="w-5 h-5" />
            </button>
          </div>

          <div
            ref={swipeContainerRef}
            className="relative h-[312px] overflow-hidden"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerEnd}
            onPointerCancel={handlePointerEnd}
            style={{ touchAction: 'pan-y' }}
          >
            {pickerView === 'days' ? (
               <>
                <div
                  key={displayDate.getTime()}
                  onAnimationEnd={handleAnimationEnd}
                  className={`w-full h-full px-1 ${transition?.direction === 'left' ? 'animate-slide-out-left' : transition?.direction === 'right' ? 'animate-slide-out-right' : ''}`}
                >
                  <CalendarView
                    viewDate={displayDate}
                    today={today}
                    startDate={startDate}
                    endDate={endDate}
                    hoverDate={hoverDate}
                    onDateClick={handleDateClick}
                    onHoverDate={setHoverDate}
                    isHoverDisabled={!!transition || swipeState.current.isLocked || selectingFor !== 'end'}
                  />
                </div>
                {transition && (
                  <div
                    key={transition.direction === 'left' ? nextMonthDate.getTime() : prevMonthDate.getTime()}
                    className={`absolute top-0 left-0 w-full h-full px-1 ${transition.direction === 'left' ? 'animate-slide-in-from-right' : 'animate-slide-in-from-left'}`}
                  >
                    <CalendarView
                      viewDate={transition.direction === 'left' ? nextMonthDate : prevMonthDate}
                      today={today}
                      startDate={startDate}
                      endDate={endDate}
                      hoverDate={null}
                      onDateClick={() => {}}
                      onHoverDate={() => {}}
                      isHoverDisabled={true}
                    />
                  </div>
                )}
              </>
            ) : pickerView === 'months' ? (
              <div className="grid grid-cols-3 gap-2 animate-fade-in-up">
                {months.map((month, index) => {
                  return (
                    <button
                      key={month}
                      onClick={() => { setDisplayDate(new Date(displayDate.getFullYear(), index, 1)); setPickerView('days'); }}
                      className="p-3 text-sm font-semibold rounded-lg text-slate-700 hover:bg-indigo-100 hover:text-indigo-700 transition-colors capitalize"
                    >
                      {month}
                    </button>
                  );
                })}
              </div>
            ) : ( // pickerView === 'years'
              <div className="grid grid-cols-3 gap-2 animate-fade-in-up">
                {yearsInView.map((year) => {
                  const isCurrentYear = year === displayDate.getFullYear();
                  return (
                    <button
                      key={year}
                      onClick={() => { setDisplayDate(new Date(year, displayDate.getMonth(), 1)); setPickerView('months'); }}
                      className={`p-3 text-sm font-semibold rounded-lg transition-colors capitalize ${isCurrentYear ? 'bg-indigo-600 text-white' : 'text-slate-700 hover:bg-indigo-100 hover:text-indigo-700'}`}
                    >
                      {year}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <footer className="px-6 py-4 bg-slate-100 border-t border-slate-200 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg shadow-sm hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-colors"
          >
            Annulla
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={!startDate || !endDate}
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
import { useTapBridge } from '../hooks/useTapBridge';


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
  const tapBridgeHandlers = useTapBridge();

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
        {...tapBridgeHandlers}
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
import { HomeNavIcon } from './icons/HomeNavIcon';
import { ArchiveBoxIcon } from './icons/ArchiveBoxIcon';
import { ArrowDownOnSquareIcon } from './icons/ArrowDownOnSquareIcon';

type NavView = 'home' | 'history';

interface HeaderProps {
    pendingSyncs: number;
    isOnline: boolean;
    activeView: NavView;
    onNavigate: (view: NavView) => void;
    onInstallClick: () => void;
    installPromptEvent: any;
}

const NavItem = ({ label, icon, isActive, onClick }: { label: string, icon: React.ReactNode, isActive: boolean, onClick: () => void }) => {
    const activeClasses = 'text-indigo-600 border-indigo-500';
    const inactiveClasses = 'text-slate-500 border-transparent hover:text-slate-800 hover:border-slate-300';

    return (
        <button
            onClick={onClick}
            className={`flex-1 flex items-center justify-center gap-2 py-3 border-b-2 font-semibold text-base transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-indigo-400 ${isActive ? activeClasses : inactiveClasses}`}
        >
            {icon}
            <span>{label}</span>
        </button>
    );
};


const Header: React.FC<HeaderProps> = ({ pendingSyncs, isOnline, activeView, onNavigate, onInstallClick, installPromptEvent }) => {
  return (
    <header className="bg-white shadow-md sticky top-0 z-20">
      <div>
        <div className="py-2 flex items-center justify-end gap-3 px-4 md:px-8">
          <div className="flex items-center gap-4">
              {!isOnline && (
                  <div className="flex items-center gap-2 text-sm font-semibold text-amber-600 bg-amber-100 px-3 py-1.5 rounded-full">
                      <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-500 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                      </span>
                      <span>Offline</span>
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
                      <span>Installa</span>
                  </button>
              )}
          </div>
        </div>
        <div className="flex" role="navigation">
            <NavItem 
                label="Home"
                icon={<HomeNavIcon className="w-6 h-6" />}
                isActive={activeView === 'home'}
                onClick={() => onNavigate('home')}
            />
            <NavItem 
                label="Storico"
                icon={<ArchiveBoxIcon className="w-6 h-6" />}
                isActive={activeView === 'history'}
                onClick={() => onNavigate('history')}
            />
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
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { DateRangePickerModal } from './DateRangePickerModal';
import { ChevronLeftIcon } from './icons/ChevronLeftIcon';
import { ChevronRightIcon } from './icons/ChevronRightIcon';
import { useSwipe } from '../hooks/useSwipe';
import SmoothPullTab from './SmoothPullTab';
import { useTapBridge } from '../hooks/useTapBridge';
import { ChevronDownIcon } from './icons/ChevronDownIcon';

type DateFilter = 'all' | '7d' | '30d' | '6m' | '1y';
type PeriodType = 'day' | 'week' | 'month' | 'year';

interface HistoryFilterCardProps {
  onSelectQuickFilter: (value: DateFilter) => void;
  currentQuickFilter: DateFilter;
  onCustomRangeChange: (range: { start: string | null, end: string | null }) => void;
  currentCustomRange: { start: string | null, end: string | null };
  isCustomRangeActive: boolean;
  onDateModalStateChange: (isOpen: boolean) => void;
  isActive: boolean; // true SOLO nella pagina "Storico"
  onSelectPeriodType: (type: PeriodType) => void;
  onSetPeriodDate: (date: Date) => void;
  periodType: PeriodType;
  periodDate: Date;
  onActivatePeriodFilter: () => void;
  isPeriodFilterActive: boolean;
}

// FIX: Added missing fmtBtn function
const fmtBtn = (iso: string) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: 'short', year: '2-digit' })
    .format(new Date(y, m - 1, d))
    .replace('.', '');
};

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
    <div className={'w-full h-10 flex border rounded-lg overflow-hidden transition-colors ' + (isActive ? 'border-indigo-600' : 'border-slate-400')}>
      {filters.map((f, i) => {
        const active = isActive && currentValue === f.value;
        return (
          <button
            key={f.value}
            onClick={() => onSelect(f.value)}
            style={{ touchAction: 'none' }} // swipe orizzontale anche partendo dal bottone
            className={'flex-1 flex items-center justify-center px-2 text-center font-semibold text-sm transition-colors duration-200 focus:outline-none ' +
              (i > 0 ? 'border-l ' : '') +
              (active ? 'bg-indigo-600 text-white border-indigo-600'
                       : `bg-slate-100 text-slate-700 hover:bg-slate-200 ${isActive ? 'border-indigo-600' : 'border-slate-400'}`)
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
  onClick: () => void;
  range: { start: string | null; end: string | null };
  isActive: boolean;
}> = ({ onClick, range, isActive }) => {
  const has = !!(range.start && range.end);
  const txt = has ? `${fmtBtn(range.start!)} - ${fmtBtn(range.end!)}` : 'Imposta periodo';
  return (
    <div className={'border h-10 transition-colors rounded-lg ' + (isActive ? 'border-indigo-600' : 'border-slate-400')}>
      <button
        onClick={onClick}
        style={{ touchAction: 'none' }}
        className={'w-full h-full flex items-center justify-center gap-2 px-2 hover:bg-slate-200 transition-colors focus:outline-none rounded-lg ' + (isActive ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-700')}
        aria-label="Seleziona intervallo di date"
      >
        <span className="text-sm font-semibold pointer-events-none">{txt}</span>
      </button>
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
}> = ({ periodType, periodDate, onTypeChange, onDateChange, isActive, onActivate, isMenuOpen, onMenuToggle }) => {
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (ev: PointerEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(ev.target as Node)) onMenuToggle(false);
    };
    if (isMenuOpen) document.addEventListener('pointerdown', handler, { capture: true });
    return () => document.removeEventListener('pointerdown', handler as any, { capture: true } as any);
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
    const t = new Date(); t.setHours(0,0,0,0);
    const s = new Date(periodDate); s.setHours(0,0,0,0);
    if (periodType === 'day') {
      if (+s === +t) return 'Oggi';
      const y = new Date(t); y.setDate(t.getDate() - 1);
      if (+s === +y) return 'Ieri';
      return periodDate.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' }).replace('.', '');
    }
    if (periodType === 'month') {
      const cm = t.getMonth(), cy = t.getFullYear();
      if (periodDate.getMonth() === cm && periodDate.getFullYear() === cy) return 'Questo Mese';
      const pm = cm === 0 ? 11 : cm - 1; const py = cm === 0 ? cy - 1 : cy;
      if (periodDate.getMonth() === pm && periodDate.getFullYear() === py) return 'Mese Scorso';
      return periodDate.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
    }
    if (periodType === 'year') {
      if (periodDate.getFullYear() === t.getFullYear()) return "Quest'Anno";
      if (periodDate.getFullYear() === t.getFullYear() - 1) return 'Anno Scorso';
      return String(periodDate.getFullYear());
    }
    // week
    const sow = new Date(periodDate); const day = sow.getDay(); const diff = sow.getDate() - day + (day === 0 ? -6 : 1);
    sow.setDate(diff); sow.setHours(0,0,0,0);
    const eow = new Date(sow); eow.setDate(sow.getDate() + 6);
    const tsow = new Date(t); const tday = tsow.getDay(); const tdiff = tsow.getDate() - tday + (tday === 0 ? -6 : 1);
    tsow.setDate(tdiff); tsow.setHours(0,0,0,0);
    if (+sow === +tsow) return 'Questa Settimana';
    const last = new Date(tsow); last.setDate(tsow.getDate() - 7);
    if (+sow === +last) return 'Settimana Scorsa';
    return `${sow.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })} - ${eow.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  })();

  return (
    <div ref={wrapperRef} className={'w-full h-10 flex items-center justify-between border rounded-lg bg-white ' + (isActive ? 'border-indigo-600' : 'border-slate-400')}>
      <button onClick={() => step(-1)} style={{ touchAction: 'none' }} className="h-full px-4 hover:bg-slate-100 rounded-l-lg" aria-label="Periodo precedente">
        <ChevronLeftIcon className="w-5 h-5 text-slate-700" />
      </button>
      <button onClick={() => onMenuToggle(!isMenuOpen)} style={{ touchAction: 'none' }} className={'flex-1 h-full text-sm font-semibold ' + (isActive ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-700') + ' hover:bg-slate-200'}>
        {label}
      </button>
      <button onClick={() => step(+1)} style={{ touchAction: 'none' }} className="h-full px-4 hover:bg-slate-100 rounded-r-lg" aria-label="Periodo successivo">
        <ChevronRightIcon className="w-5 h-5 text-slate-700" />
      </button>

      {isMenuOpen && (
        <div className="absolute bottom-full mb-2 left-0 right-0 mx-auto w-40 bg-white border border-slate-200 shadow-lg rounded-lg z-[1000] p-2 space-y-1">
          {(['day','week','month','year'] as PeriodType[]).map(v => (
            <button key={v} onClick={() => { onActivate(); onTypeChange(v); onMenuToggle(false); }} style={{ touchAction: 'none' }} className={'w-full text-left px-4 py-2 text-sm font-semibold rounded-lg ' + (isActive && periodType === v ? 'bg-indigo-100 text-indigo-800' : 'bg-slate-50 text-slate-800 hover:bg-slate-200')}>
              {v === 'day' ? 'Giorno' : v === 'week' ? 'Settimana' : v === 'month' ? 'Mese' : 'Anno'}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/* -------------------- HistoryFilterCard -------------------- */
export const HistoryFilterCard: React.FC<HistoryFilterCardProps> = (props) => {
  const [isDateModalOpen, setIsDateModalOpen] = useState(false);
  const [isPeriodMenuOpen, setIsPeriodMenuOpen] = useState(false);
  const [activeViewIndex, setActiveViewIndex] = useState(0);

  const filterBarRef = useRef<HTMLDivElement>(null);
  const tapBridge = useTapBridge();

  // misura pannello
  const OPEN_HEIGHT_VH = 40;
  const [openHeight, setOpenHeight] = useState(0);
  const [peekHeight, setPeekHeight] = useState(0);
  const [laidOut, setLaidOut] = useState(false);

  // stato drag verticale
  const gs = useRef({
    isDragging: false, isLocked: false,
    startX: 0, startY: 0, lastY: 0, lastT: 0,
    startTranslateY: 0, pointerId: null as number | null,
  });

  // rebind dello swipe dopo tap su filtri rapidi
  const [swipeEnabled, setSwipeEnabled] = useState(true);
  const rafRemount = useRef(0);
  const remountSwipe = useCallback(() => {
    if (rafRemount.current) cancelAnimationFrame(rafRemount.current);
    setSwipeEnabled(false);
    rafRemount.current = requestAnimationFrame(() => {
      requestAnimationFrame(() => setSwipeEnabled(true));
    });
  }, []);

  const OPEN_Y = 0;
  const [translateY, setTranslateY] = useState(0);
  const [anim, setAnim] = useState(false);
  
  const isPanelOpen = laidOut && translateY < (openHeight - peekHeight) / 2;

  const closedYRef = useRef(0);
  const translateYRef = useRef(0);
  useEffect(() => { translateYRef.current = translateY; }, [translateY]);

  const CLOSED_Y = openHeight > peekHeight ? openHeight - peekHeight : 0;
  useEffect(() => { closedYRef.current = CLOSED_Y; }, [CLOSED_Y]);

  useEffect(() => { props.onDateModalStateChange?.(isDateModalOpen); }, [isDateModalOpen, props.onDateModalStateChange]);

  const setCardY = useCallback((y: number, animated: boolean) => { setAnim(animated); setTranslateY(y); }, []);

  // layout solo in Storico (attendi misura reale)
  useEffect(() => {
    if (!props.isActive) { setLaidOut(false); return; }
    let raf = 0;
    const update = () => {
      if (!filterBarRef.current) { raf = requestAnimationFrame(update); return; }
      const vh = window.innerHeight / 100;
      const oh = OPEN_HEIGHT_VH * vh;
      const ph = filterBarRef.current.offsetHeight || 0;
      if (ph === 0) { raf = requestAnimationFrame(update); return; }
      const closed = oh - ph;
      setOpenHeight(oh); setPeekHeight(ph);
      if (!laidOut) { setCardY(closed, false); setLaidOut(true); }
      else { setTranslateY(cur => (cur < closed * 0.9 ? OPEN_Y : closed)); setAnim(false); }
    };
    update();
    window.addEventListener('resize', update);
    return () => { window.removeEventListener('resize', update); if (raf) cancelAnimationFrame(raf); };
  }, [props.isActive, laidOut, setCardY]);

  // lock scroll sotto quando overlay davvero aperto
  const overlayOpen = props.isActive && laidOut && translateY <= Math.max(0, CLOSED_Y - 1) && !isDateModalOpen;
  useEffect(() => {
    if (!overlayOpen) return;
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    return () => { document.documentElement.style.overflow = prev; };
  }, [overlayOpen]);

  // snap helper (35% / 65%)
  const snapToAnchor = useCallback(() => {
    const closed = closedYRef.current;
    const y = translateYRef.current;
    const ratio = closed > 0 ? y / closed : 1; // 0=aperto, 1=chiuso
    const target = (ratio <= 0.35) ? OPEN_Y : (ratio >= 0.65 ? closed : (ratio < 0.5 ? OPEN_Y : closed));
    setCardY(target, true);
  }, [setCardY]);

  // fail-safe unlock + snap anche se l'up arriva su window
  useEffect(() => {
    const unlock = () => {
      if (gs.current.isDragging || gs.current.isLocked) {
        gs.current.isDragging = false;
        gs.current.isLocked = false;
        gs.current.pointerId = null;
        snapToAnchor();
      }
    };
    window.addEventListener('pointerup', unlock, { capture: true });
    window.addEventListener('pointercancel', unlock, { capture: true });
    return () => {
      window.removeEventListener('pointerup', unlock as any, { capture: true } as any);
      window.removeEventListener('pointercancel', unlock as any, { capture: true } as any);
    };
  }, [snapToAnchor]);

  const SPEED = 0.18; // px/ms
  const DPR = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const clamp = useCallback((y: number) => Math.round(Math.max(OPEN_Y, Math.min(closedYRef.current, y)) * DPR) / DPR, []);

  /* ---------- TapBridge + drag verticale (capture) ---------- */
  const onPD = (e: React.PointerEvent) => {
    tapBridge.onPointerDown(e);
    if (!props.isActive || isDateModalOpen) return;
    if (anim) setAnim(false);
    if (gs.current.pointerId !== null || e.button !== 0) return;
    const now = performance.now();
    gs.current.isDragging = true; gs.current.isLocked = false;
    gs.current.startX = e.clientX; gs.current.startY = e.clientY;
    gs.current.lastY = e.clientY; gs.current.lastT = now;
    gs.current.startTranslateY = translateY; gs.current.pointerId = e.pointerId;
  };

  const onPM = useCallback((e: React.PointerEvent) => {
    tapBridge.onPointerMove(e);
    if (!props.isActive || isDateModalOpen) return;
    const S = gs.current;
    if (!S.isDragging || S.pointerId !== e.pointerId) return;

    const dy = e.clientY - S.startY;
    const dx = e.clientX - S.startX;

    if (!S.isLocked) {
        const SLOP = 10;
        if (Math.abs(dx) <= SLOP && Math.abs(dy) <= SLOP) return;

        const isVertical = Math.abs(dy) > Math.abs(dx);
        if (!isVertical) {
            S.isDragging = false;
            S.isLocked = false;
            if (S.pointerId !== null) {
              try { (e.currentTarget as HTMLElement).releasePointerCapture(S.pointerId); } catch {}
              S.pointerId = null;
            }
            return;
        }
        S.isLocked = true;
    }

    if (S.isLocked) {
        if (e.cancelable) e.preventDefault();
        const newY = S.startTranslateY + dy;
        setCardY(clamp(newY), false);

        S.lastY = e.clientY;
        S.lastT = performance.now();
    }
  }, [props.isActive, isDateModalOpen, tapBridge, setCardY, clamp]);
  
  const onPU = (e: React.PointerEvent) => {
    tapBridge.onPointerUp(e);
    if (!props.isActive) return;

    const S = gs.current;
    if (!S.isDragging || S.pointerId !== e.pointerId) return;

    if (S.isLocked) (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);

    const dt = Math.max(1, performance.now() - S.lastT);
    const vy = (e.clientY - S.lastY) / dt;

    const closed = closedYRef.current;
    const ratio = closed > 0 ? translateYRef.current / closed : 1; // 0=aperto, 1=chiuso
    const openBySpeed = vy <= -SPEED;
    const closeBySpeed = vy >= SPEED;

    S.isDragging = false; S.isLocked = false; S.pointerId = null;

    let target: number;
    if (openBySpeed || ratio <= 0.35) target = OPEN_Y;
    else if (closeBySpeed || ratio >= 0.65) target = closed;
    else target = ratio < 0.5 ? OPEN_Y : closed;

    setCardY(target, true);
  };
  const onPC = (e: React.PointerEvent) => {
    tapBridge.onPointerCancel?.(e as any);
    const S = gs.current; if (!S.isDragging) return;
    S.isDragging = S.isLocked = false; S.pointerId = null;
    snapToAnchor();
  };
  const onClickCap = (e: React.MouseEvent) => { tapBridge.onClickCapture(e as any); };

  /* ---------------- Swipe orizzontale tra le 3 viste ---------------- */
  const swipeWrapperRef = useRef<HTMLDivElement>(null);
  const changeView = useCallback((i: number) => setActiveViewIndex(i), []);
  const { progress, isSwiping } = useSwipe(
    swipeWrapperRef,
    {
      onSwipeLeft: () => changeView(Math.min(2, activeViewIndex + 1)),
      onSwipeRight: () => changeView(Math.max(0, activeViewIndex - 1)),
    },
    {
      enabled: swipeEnabled && props.isActive && !isPeriodMenuOpen && !isDateModalOpen,
      threshold: 28,
      slop: 8,
      disableDrag: () => gs.current.isLocked,
    }
  );

  const isQuickFilterActive = !props.isPeriodFilterActive && !props.isCustomRangeActive;
  const tx = -activeViewIndex * (100 / 3) + progress * (100 / 3);
  const listTransform = `translateX(${tx}%)`;

  const handleQuickSelect = useCallback((v: DateFilter) => {
    props.onSelectQuickFilter(v);
    remountSwipe();
  }, [props.onSelectQuickFilter, remountSwipe]);
  
  const handlePeriodDateChange = useCallback((date: Date) => {
    props.onSetPeriodDate(date);
    remountSwipe();
  }, [props.onSetPeriodDate, remountSwipe]);

  const handlePeriodTypeChange = useCallback((type: PeriodType) => {
    props.onSelectPeriodType(type);
    remountSwipe();
  }, [props.onSelectPeriodType, remountSwipe]);

  // --------- Y iniziale in stato chiuso prima del layout (FIX #1) ----------
  const initialPanelHeightPx = Math.round(
    (typeof window !== 'undefined' ? window.innerHeight : 0) * (OPEN_HEIGHT_VH / 100)
  );
  const yForStyle = laidOut
    ? clamp(translateY)
    : (openHeight || initialPanelHeightPx);

  // Pannello overlay
  const panel = (
    <div
      onPointerDownCapture={onPD}
      onPointerMoveCapture={onPM}
      onPointerUpCapture={onPU}
      onPointerCancelCapture={onPC}
      onClickCapture={onClickCap}
      data-no-page-swipe="true"
      className="fixed bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-[0_-8px_20px_-5px_rgba(0,0,0,0.08)] z-[1000]"
      style={{
        height: `${OPEN_HEIGHT_VH}vh`,
        transform: `translate3d(0, ${yForStyle}px, 0)`,
        transition: anim ? 'transform 0.26s cubic-bezier(0.22, 0.61, 0.36, 1)' : 'none',
        touchAction: 'none',
        backfaceVisibility: 'hidden',
        willChange: 'transform',
        opacity: laidOut && !isDateModalOpen ? 1 : 0,
        pointerEvents: laidOut && !isDateModalOpen ? 'auto' : 'none',
      }}
      onTransitionEnd={() => setAnim(false)}
    >
      <div 
        className="absolute top-0 left-1/2 -translate-x-1/2 w-[88px] h-auto flex justify-center cursor-grab"
        style={{ transform: 'translateX(-50%) translateY(-19px)' }}
        aria-hidden="true"
      >
        <SmoothPullTab width="88" height="19" fill="white" />
        <ChevronDownIcon
          className={'absolute w-5 h-5 text-slate-400 transition-transform duration-300 ' + (isPanelOpen ? 'rotate-0' : 'rotate-180')}
          style={{ top: '2px' }}
        />
      </div>

      <div ref={filterBarRef} className="pt-1">
        <div
          ref={swipeWrapperRef}
          className={'relative ' + (isPeriodMenuOpen ? 'overflow-visible' : 'overflow-hidden')}
          style={{ touchAction: 'none' }} // swipe orizzontale anche partendo dai pulsanti
        >
          <div className="w-[300%] flex" style={{ transform: listTransform, transition: isSwiping ? 'none' : 'transform 0.08s ease-out' }}>
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
              />
            </div>

            <div className="w-1/3 px-4 py-1">
              <CustomDateRangeInputs
                onClick={() => setIsDateModalOpen(true)}
                range={props.currentCustomRange}
                isActive={props.isCustomRangeActive}
              />
            </div>
          </div>
        </div>

        <div className="flex justify-center items-center pt-1 pb-2 gap-2">
          {[0,1,2].map(i => (
            <button
              key={i}
              onClick={() => setActiveViewIndex(i)}
              style={{ touchAction: 'none' }}
              className={'w-2.5 h-2.5 rounded-full transition-colors ' + (activeViewIndex === i ? 'bg-indigo-600' : 'bg-slate-300 hover:bg-slate-400')}
              aria-label={'Vai al filtro ' + (i+1)}
            />
          ))}
        </div>

        <div style={{ height: 'env(safe-area-inset-bottom, 0px)' }} />
      </div>
    </div>
  );

  return (
    <>
      {props.isActive && createPortal(panel, document.body)}

      <DateRangePickerModal
        isOpen={isDateModalOpen}
        onClose={() => setIsDateModalOpen(false)}
        initialRange={props.currentCustomRange}
        onApply={(range) => { props.onCustomRangeChange(range); setIsDateModalOpen(false); }}
      />
    </>
  );
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
      className={`fixed inset-0 z-50 flex justify-center items-start p-4 transition-opacity duration-300 ease-in-out ${isAnimating ? 'opacity-100' : 'opacity-0'} bg-slate-900/60 backdrop-blur-sm overflow-y-auto`}
      onClick={onClose}
      aria-modal="true"
      role="dialog"
    >
      <div
        className={`bg-slate-50 rounded-lg shadow-xl w-full max-w-3xl my-8 transform transition-all duration-300 ease-in-out ${isAnimating ? 'scale-100 opacity-100' : 'scale-95 opacity-0'}`}
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

interface PendingImagesProps {
  images: OfflineImage[];
  onAnalyze: (image: OfflineImage) => void;
  onDelete: (id: string) => void;
  isOnline: boolean;
  syncingImageId: string | null;
}

const PendingImages: React.FC<PendingImagesProps> = ({ images, onAnalyze, onDelete, isOnline, syncingImageId }) => {
  const [isOpen, setIsOpen] = useState(false);

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
                    >
                      Analizza
                    </button>
                    <button
                      onClick={() => onDelete(image.id)}
                      disabled={isAnalyzing}
                      className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-100 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      aria-label="Elimina immagine in attesa"
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
  style?: React.CSSProperties;
}

const SuccessIndicator: React.FC<SuccessIndicatorProps> = ({ show, style }) => {
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
        ...style
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
import { CurrencyEuroIcon } from './icons/CurrencyEuroIcon';
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
  const amountInputRef = useRef<HTMLInputElement>(null);
  const descriptionInputRef = useRef<HTMLInputElement>(null);

  const [activeMenu, setActiveMenu] = useState<'account' | null>(null);
  const [isAmountFocused, setIsAmountFocused] = useState(false);

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

  // Derive amountStr dal formData.amount (previene race condition)
  const [amountStr, setAmountStr] = useState('');
  useEffect(() => {
    if (!isAmountFocused) {
      const formatted = formData.amount === undefined || formData.amount === 0 
        ? '' 
        : String(formData.amount).replace('.', ',');
      setAmountStr(formatted);
    }
  }, [formData.amount, isAmountFocused]);

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
      if (activeEl === amountInputRef.current || activeEl === descriptionInputRef.current) {
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

    if (name === 'amount') {
      let s = value.replace(/[^0-9,]/g, '');
      const parts = s.split(',');
      if (parts.length > 2) s = parts[0] + ',' + parts.slice(1).join('');
      if (parts[1]?.length > 2) s = parts[0] + ',' + parts[1].slice(0, 2);
      setAmountStr(s);

      const num = parseFloat(s.replace(',', '.'));
      const next = isNaN(num) ? 0 : num;
      onFormChange({ amount: next });
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
      // FIX: This comparison appears to be unintentional because the types '"recurring"' and '"single"' have no overlap.
      // The logic inside the `else` block of the original faulty `if` was correct for the 'recurring' case.
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
    if (t === 'date') return 'Fino a';
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
        <div className="space-y-4">
          {/* Importo */}
          <div>
            <label htmlFor="amount" className="block text-base font-medium text-slate-700 mb-1">Importo</label>
            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                <CurrencyEuroIcon className="h-5 w-5 text-slate-400" />
              </div>
              <input
                ref={amountInputRef}
                id="amount"
                name="amount"
                type="text"
                inputMode="decimal"
                value={amountStr}
                onChange={handleInputChange}
                onFocus={() => setIsAmountFocused(true)}
                onBlur={() => setIsAmountFocused(false)}
                className="block w-full rounded-md border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                placeholder="0,00"
                enterKeyHint="done"
                onKeyDown={(e) => { if (e.key === 'Enter') { (e.currentTarget as HTMLInputElement).blur(); e.preventDefault(); } }}
              />
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
            // FIX: The onClick handler should call onSubmit with the current form data.
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
                <div className="w-5 h-5 rounded-full border-2 border-slate-400 flex items-center justify-center">
                  {tempMonthlyRecurrenceType === 'dayOfMonth' && <div className="w-2.5 h-2.5 bg-indigo-600 rounded-full" />}
                </div>
                <span className="text-sm font-medium text-slate-700">Lo stesso giorno di ogni mese</span>
              </div>

              <div
                role="radio"
                aria-checked={tempMonthlyRecurrenceType === 'dayOfWeek'}
                onClick={() => setTempMonthlyRecurrenceType('dayOfWeek')}
                className="flex items-center gap-3 p-2 cursor-pointer rounded-lg hover:bg-slate-100"
              >
                <div className="w-5 h-5 rounded-full border-2 border-slate-400 flex items-center justify-center">
                  {tempMonthlyRecurrenceType === 'dayOfWeek' && <div className="w-2.5 h-2.5 bg-indigo-600 rounded-full" />}
                </div>
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
                  <div className="absolute top-full mt-1 w-full bg-white border border-slate-200 shadow-lg rounded-lg z-20 p-2 space-y-1">
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
                        {k === 'forever' ? 'Per sempre' : k === 'date' ? 'Fino a' : 'Numero di volte'}
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
// FIX: Removed deprecated LiveSession import.
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

  // FIX: Use ReturnType for proper type inference as LiveSession is not exported.
  const sessionPromise = useRef<ReturnType<typeof createLiveSession> | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const scriptProcessor = useRef<ScriptProcessorNode | null>(null);
  const stream = useRef<MediaStream | null>(null);

  const cleanUp = () => {
    stream.current?.getTracks().forEach(track => track.stop());
    scriptProcessor.current?.disconnect();
    audioContext.current?.close();
    sessionPromise.current?.then(session => session.close());
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

      // FIX: Moved audio processing setup into `onopen` callback and added type assertions for function call args.
      sessionPromise.current = createLiveSession({
        onopen: () => {
          const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
          if (!AudioContext) {
            setError("Il tuo browser non supporta l'input vocale.");
            setStatus('error');
            return;
          }
    
          audioContext.current = new AudioContext({ sampleRate: 16000 });
          const source = audioContext.current.createMediaStreamSource(stream.current!);
          scriptProcessor.current = audioContext.current.createScriptProcessor(4096, 1, 1);
          
          scriptProcessor.current.onaudioprocess = (audioProcessingEvent) => {
              const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
              const pcmBlob = createBlob(inputData);
              sessionPromise.current?.then((session) => {
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
      }
    } else {
      setIsAnimating(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const getStatusContent = () => {
    switch(status) {
      case 'listening':
        return {
          icon: <div className="w-24 h-24 rounded-full bg-red-500 animate-pulse flex items-center justify-center"><MicrophoneIcon className="w-12 h-12 text-white" /></div>,
          text: 'In ascolto...',
          subtext: 'Descrivi la tua spesa, ad esempio "25 euro per una cena al ristorante".'
        };
      case 'processing':
        return {
          icon: <div className="w-24 h-24 rounded-full bg-indigo-500 flex items-center justify-center"><div className="w-12 h-12 text-white animate-spin rounded-full border-4 border-t-transparent border-white"></div></div>,
          text: 'Elaborazione...',
          subtext: 'Sto analizzando la tua richiesta.'
        };
      case 'error':
        return {
          icon: <div className="w-24 h-24 rounded-full bg-red-100 flex items-center justify-center"><XMarkIcon className="w-12 h-12 text-red-500" /></div>,
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
      className={`fixed inset-0 z-50 flex justify-center items-center p-4 transition-opacity duration-300 ease-in-out ${isAnimating ? 'opacity-100' : 'opacity-0'} bg-slate-900/50 backdrop-blur-sm`}
      onClick={onClose}
      aria-modal="true"
      role="dialog"
    >
      <div
        className={`bg-slate-50 rounded-lg shadow-xl w-full max-w-lg transform transition-all duration-300 ease-in-out ${isAnimating ? 'scale-100 opacity-100' : 'scale-95 opacity-0'}`}
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
    <svg id="Livello_1" data-name="Livello 1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 468.4 464" {...props}>
        <path d="M4.3,118.8c11.3-9.4,27.7-7,41.7-7.2,108-1.1,216.1-.3,324.1-.6,14.3,0,34.3-.9,47.2,5,9,4.1,20.9,15.9,23.7,25.4s-.7,6.7,3.1,7.4c0-1,.1-2.1,0-3h1.2c0,3.6-1.2,6.8,0,10.2,0,.4,0,.8,0,1.2-.2,15.3-.2,30.8,0,46.1,0,3-.5,7,.6,9.6s.7.6.6,1.2c-2-.2-1.1-1.1-2-1.8-2-1.5-11.1,0-14.1-.6,0-1.9.6-5.2-1.6-5.9s-2.2-.3-2.5,0c-.6.5-1,9.1-.7,9.5s.9,0,1.2,0c.8,0,1.6,0,2.4,0h1.2c-.7,3.1-7.3.7-5.4-3.6h-120.8c-74.4,8.1-93.6,104.6-22.4,136.3,18,8,37.4,5.7,56.6,6.3,9.8.3,19.4,1.6,29.4,1.2,15.1-.6,30.6-1.3,45.5-3,8.2-1,20.1,0,28.8,0s5.9,1.4,7.5-1.2c0,.3,0,1,0,1.8l-3.6.9c-.4,26.6,1.2,53.4-1.2,80-2.2,6.1-3.6,10.3-7.2,15.6-2.7,1.3-5.9,4.7-7.2,7.2-.5.3-1.5.2-2,.5s-.3,1.2-.4,1.3c-.2.2-.4.4-.6.6-1.3-.1-1.3,0-1.2,1.2-.2,0-.4,0-.6,0-.8.4-1.5.8-2.3,1.2-1.2.6-2.9,0-2.5,1.8-.2,0-.4,0-.6,0-.5,0-1,0-1.2.6H18.7c-1.2-1.2-2.8-2-4.2-3-1.8-3.7-5.8-6.2-8.4-9.3s-1.8-4.7-4.2-5.1c-.4-1.1-.9-2.1-1.3-3.2C-.6,338.8.4,234,0,129.3c.3-3.6,2.3-7.5,4.2-10.5ZM6.2,127.4c-.9,1-1.3,3.8.8,4.1s8-1,8.9-1.3c1.3-.5,1.4-2.6.8-3.5s-9.3-.4-10.4.8ZM28.5,126c-1.5.6-1.1,4.8,0,4.8h9c1.8,0,1.8-4.8,0-4.8h-9ZM49.6,126.2c-1.7.5-2.3,3.5-1.1,4.4s8.8.5,9.4-.3.5-3.4-.3-4-7-.4-8-.1ZM68.7,126c-1.5.6-1.1,4.8,0,4.8h9c1.8,0,1.8-4.8,0-4.8h-9ZM90.9,126c-1.8.6-2,4.8-.6,4.8h9.6c1.3,0,1.3-4.8,0-4.8h-9ZM113,126c-1.5.6-1.1,4.8,0,4.8h10.8c1.3,0,1.3-4.8,0-4.8h-10.8ZM138.8,130.8c1.3.4,7.6,0,9.6,0s1.3-4.8,0-4.8h-9.6c-.2,0-.9.8-1.5.6.2,1,.6,3.9,1.5,4.2ZM173.9,126c-.5-.3-9.4,0-11.1,0s-1.3,4.8,0,4.8h10.8c1.4,0,.7-4.5.3-4.8ZM199.6,126c-.5-.3-9.4,0-11.1,0s-1.3,4.8,0,4.8h11.1c.3,0,.8-4.3,0-4.8ZM213.1,126c-1.5.6-1.1,4.8,0,4.8h10.8c1.3,0,1.3-4.8,0-4.8h-10.8ZM238.3,126c-1.5.6-1.1,4.8,0,4.8h10.8c1.3,0,1.3-4.8,0-4.8h-10.8ZM262.8,126c-1.5.6-1.1,4.8,0,4.8h10.8c1.3,0,1.3-4.8,0-4.8h-10.8ZM288,126c-1.5.6-1.1,4.8,0,4.8h10.8c1.3,0,1.3-4.8,0-4.8h-10.8ZM313.8,126c-1.5.6-1.1,4.8,0,4.8h9.6c1.3,0,1.3-4.8,0-4.8h-9.6ZM338.1,130.8c.4.3,8.9,0,10.5,0s1.3-4.8,0-4.8h-9.6c-.2,0-1.4.6-1.5,1-.1.6.5,3.7.6,3.8ZM362.9,126c-1.8.6-2,4.8-.6,4.8h10.8c1.3,0,1.3-4.8,0-4.8h-10.2ZM386.9,130.8c1.3.4,7,0,9,0s2.4-2.7.9-3.9-9.2-1.4-10.2-.6-.8,4.2.3,4.5ZM407.4,130.3c-.7.1-2,.8-2.2,1.5-.4,1.8,7.2,6.5,8.2,6.7,1.6.4,3.6-1.9,2.9-3.5s-7-5-8.9-4.7ZM421.7,144.7c-2,.7,1.3,8.7,2.1,9.7s2.5,1.5,3.6.7-.4-12.2-5.6-10.4ZM430.3,175.8v-10.5c0-1.2-4.2-1.2-4.2,0v10.5h4.2ZM430.3,184.8c-.9.2-4.4-.3-4.8,0-.9.8-.7,9.5.2,10.8s3.3.4,4.5.6v-11.4ZM430.3,358.5c-5.9-2.2-5.9,2.1-5.3,6.8s5.3,3.5,5.3,2.5v-9.3ZM430.3,390c.4-1.3,0-7,0-9s-4.2-1.9-4.7-1.4-1,9.9-.4,10.8,4.7.9,5.1-.3ZM429.6,401.8c-.5-.6-2.4-.9-3.1-.7-1.9.6-2.1,10.3-1.3,11.4s4.6,1,5-.4.2-9.3-.7-10.3ZM421.9,429.9c-.2.5-2.1.9-.9,3.6s2.7.7,3.3,0,.5-.4.6-.6c1.6-2.1,4.7-6.8,2.4-9.3-3.7-4.1-4.8,4.4-5.4,6.3ZM405.2,449.5c2.3,1.5,14.7-6.5,8.5-8.2s-9.1,4.3-9.2,5.6.4,1.8.7,2.6ZM8.5,444.8c-1.7,5.5,5.3,6.8,9.4,7.1s4.3-3.2,2.6-4.5-11.6-3.1-12-2.7ZM31.8,453.2h12.6c-.1-.8.2-4,0-4.2-.3-.3-7-.6-8.1-.6-4.5,0-5,.2-4.5,4.8ZM394.4,453.2c.2-1.1.6-1.7.2-2.9-.9-3.2-2-1.4-4.1-1.3s-7.4-.3-8,0-1,4.1.2,4.1h11.7ZM68.3,449.7c-.8-.9-11.6-1.2-11.9.3-.8,3.4,1,4.1,3.9,4.4s7.6-.2,8.1-.6.1-3.9,0-4.1ZM92.4,453.2c.1-.8.2-4.2-.9-4.2h-10.8c-1.2,0-1.2,4.2,0,4.2h11.7ZM115.1,453.2c.1-.8.2-4.2-.9-4.2h-10.5c-.2,0-1.2,4.2.3,4.2h11.1ZM138.5,453.2c.1-.8.2-4.2-.9-4.2h-10.5c-.2,0-1.2,4.2.3,4.2h11.1ZM150.5,453.2h10.5c1.2,0,1.2-4.2,0-4.2h-9.6c-1.1,0-1,3.3-.9,4.2ZM185.2,453.2c.1-.8.2-4.2-.9-4.2h-10.5v4.2h11.4ZM208.6,453.2c0-1.1.4-3.3-.6-3.9s-7.5-.4-8.8-.3c-2.8.3-2,1.8-2.1,4.2h11.4ZM232,453.2c0-1.1.4-3.3-.6-3.9s-7.5-.4-8.8-.3c-2.8.3-2,1.8-2.1,4.2h11.4ZM255.4,453.2c0-1.1.4-3.3-.6-3.9s-10-.5-10.8,0c-1.3.8-1.6,3.9-.3,3.9h11.7ZM266.7,449c0,.9-1.2,4.2.3,4.2h10.8c1.2,0,1.2-4.2,0-4.2h-11.1ZM302.1,453.2c.1-.8.2-4.2-.9-4.2h-11.1v4.2h12ZM324.3,449c-.4-.3-8.9,0-10.5,0s-1.2,4.2,0,4.2h10.5c.3,0,.7-3.7,0-4.2ZM347.6,449c-.4-.3-8.9,0-10.5,0s-1.2,4.2,0,4.2h10.5c.3,0,.7-3.7,0-4.2ZM371,453.2c0-1,.3-2.8-.3-3.6s-9.7-.8-10.8,0-.2,2.7-.3,3.7h11.4Z" fill="#12427c" />
        <path d="M420.1,463.4v.6h-1.2c.2-.6.7-.5,1.2-.6Z" fill="#799bc6" />
        <path d="M449.5,351.4c-1.6,2.6-5.3,1.2-7.5,1.2-8.7,0-20.6-.9-28.8,0-14.9,1.7-30.4,2.5-45.5,3-10,.4-19.6-.9-29.4-1.2-19.2-.6-38.6,1.7-56.6-6.3-71.2-31.7-52.1-128.1,22.4-136.3h120.8c-1.9,4.3,4.6,6.7,5.4,3.6s0-2.6,0-3.6c3,.5,12.2-.9,14.1.6s0,1.6,2,1.8,2.9-.1,3,0c.2.2-.2,5.5,0,6.6-49.5.9-99.2.4-148.8.7-67.7,11.9-68.7,109.9-.2,120.9,42.2-.4,84.6.2,126.8.6-.5,1.7-1.9,1.8-1.2,4.2,3.9.4,5-.4,3.6-4.2,8.2,0,12.4-.6,21,.6-1.1,2.6-.9,5.1-1.2,7.8Z" fill="#223159" />
        <path d="M371.6,99.7l25.8.6c11.9,1.7,20.2,4.6,29.4,12s6.4,5.4,9.6,9.6c5.2,6.8,6.1,10.4,8.4,18.6-1.7,1.8.4,1.7.6,2.2.2.8,0,2.2,0,3.2h-1.2c-1.9-12.8-15.8-29.8-27.8-34.2s-14.5-4.2-16.8-4.2h-246c0-2.4,0-4.8,0-7.2.2,0,.8,0,1.2,0,9.2-.8,20.5,0,30,0,24.2,0,48.3,0,72.5,0s24.4,0,36.6,0,6.8,0,10.2,0,.8,0,1.2,0c2.4,0,4.8,0,7.2,0s.8,0,1.2,0c1,0,2,0,3,0s2.8,0,4.2,0,1.2,0,1.8,0c2.6,0,5.2,0,7.8,0s1.2,0,1.8,0,.8,0,1.2,0,.4,0,.6,0c2.2,0,4.4,0,6.6,0,4,0,8,0,12,0,5.8,0,11.6,0,17.4,0s.5-.6.6-.6c.2,0,.4,0,.6,0s.4,0,.6,0Z" fill="#223159" />
        <path d="M153.5,100.3c0,2.4,0,4.8,0,7.2h246c2.3,0,14.1,3.2,16.8,4.2,12.1,4.4,26,21.4,27.8,34.2s0,2,0,3c-3.8-.7-2.4-5.1-3.1-7.4-2.8-9.5-14.8-21.3-23.7-25.4-12.9-5.9-32.9-5.1-47.2-5-108.1.4-216.2-.5-324.1.6-14,.1-30.4-2.3-41.7,7.2,0-1.1.8-1.7,1.5-2.4,3.6-3.7,6.7-7.1,11.1-9.6-.3,1.8.9,1.2,2.1,1.2,12-.1,24.1-.7,36.3-.6s.9.6,2,.6c31.4.3,62.8-.3,94.2,0,3.1-.4.3-7,2.1-7.8Z" fill="#799bc6" />
        <path d="M449.5,353.1c-.4,6-.5,11.9-.6,18s0,11.6,0,17.4.7,17.6,0,25.5-3.1,17.1-4.2,20.1c2.4-26.5.7-53.3,1.2-80l3.6-.9Z" fill="#799bc6" />
        <path d="M8.5,444.8c.4-.4,11.5,2.3,12,2.7,1.6,1.2,1.3,4.8-2.6,4.5s-11.1-1.6-9.4-7.1Z" fill="#e0e6ec" />
        <path d="M429.6,401.8c.8,1,1.1,8.9.7,10.3s-4.4,1.4-5,.4-.6-10.8,1.3-11.4,2.6.2,3.1.7Z" fill="#e0e6ec" />
        <path d="M68.3,449.7c.2.2.2,4,0,4.1-.4.5-6.9.7-8.1.6-2.9-.3-4.7-1-3.9-4.4s11.2-1.2,11.9-.3Z" fill="#e0e6ec" />
        <path d="M288,126h10.8c1.3,0,1.3,4.8,0,4.8h-10.8c-1.1,0-1.5-4.2,0-4.8Z" fill="#e0e6ec" />
        <path d="M262.8,126h10.8c1.3,0,1.3,4.8,0,4.8h-10.8c-1.1,0-1.5-4.2,0-4.8Z" fill="#e0e6ec" />
        <path d="M238.3,126h10.8c1.3,0,1.3,4.8,0,4.8h-10.8c-1.1,0-1.5-4.2,0-4.8Z" fill="#e0e6ec" />
        <path d="M213.1,126h10.8c1.3,0,1.3,4.8,0,4.8h-10.8c-1.1,0-1.5-4.2,0-4.8Z" fill="#e0e6ec" />
        <path d="M430.3,390c-.4,1.2-4.5,1.3-5.1.3s-.3-10.2.4-10.8,4.7-.5,4.7,1.4.4,7.7,0,9Z" fill="#e0e6ec" />
        <path d="M113,126h10.8c1.3,0,1.3,4.8,0,4.8h-10.8c-1.1,0-1.5-4.2,0-4.8Z" fill="#e0e6ec" />
        <path d="M173.9,126c.4.3,1.1,4.8-.3,4.8h-10.8c-1.3,0-1.3-4.8,0-4.8s10.6-.3,11.1,0Z" fill="#e0e6ec" />
        <path d="M199.6,126c.8.5.3,4.8,0,4.8h-11.1c-1.3,0-1.3-4.8,0-4.8s10.6-.3,11.1,0Z" fill="#e0e6ec" />
        <path d="M362.9,126h10.2c1.3,0,1.3,4.8,0,4.8h-10.8c-1.4,0-1.2-4.2.6-4.8Z" fill="#e0e6ec" />
        <path d="M430.3,184.8v11.4c-1.2-.1-3.8.5-4.5-.6s-1.1-9.9-.2-10.8,3.8.1,4.8,0Z" fill="#e0e6ec" />
        <path d="M31.8,453.2c-.5-4.6,0-4.9,4.5-4.8s7.8.3,8.1.6-.1,3.4,0,4.2h-12.6Z" fill="#e0e6ec" />
        <path d="M430.3,358.5v9.3c0,1.1-4.5,4-5.3-2.5s-.6-9.1,5.3-6.8Z" fill="#e0e6ec" />
        <path d="M338.1,130.8c-.2-.1-.8-3.2-.6-3.8.1-.4,1.4-1,1.5-1h9.6c1.3,0,1.3,4.8,0,4.8s-10,.3-10.5,0Z" fill="#e0e6ec" />
        <path d="M138.8,130.8c-.9-.3-1.3-3.2-1.5-4.2.6.1,1.3-.6,1.5-.6h9.6c1.3,0,1.3,4.8,0,4.8-2,0-8.3.4-9.6,0Z" fill="#e0e6ec" />
        <path d="M394.4,453.2h-11.7c-1.2,0-.9-3.6-.2-4.1s6.5,0,8,0c2.1,0,3.2-1.8,4.1,1.3s0,1.8-.2,2.9Z" fill="#e0e6ec" />
        <path d="M313.8,126h9.6c1.3,0,1.3,4.8,0,4.8h-9.6c-1.1,0-1.5-4.2,0-4.8Z" fill="#e0e6ec" />
        <path d="M90.9,126h9c1.3,0,1.3,4.8,0,4.8h-9.6c-1.4,0-1.2-4.2.6-4.8Z" fill="#e0e6ec" />
        <path d="M407.4,130.3c1.9-.3,8.1,3.1,8.9,4.7s-1.2,3.9-2.9,3.5-8.6-4.9-8.2-6.7c.2-.7,1.5-1.4,2.2-1.5Z" fill="#e0e6ec" />
        <path d="M68.7,126h9c1.8,0,1.8,4.8,0,4.8h-9c-1.1,0-1.5-4.2,0-4.8Z" fill="#e0e6ec" />
        <path d="M92.4,453.2h-11.7c-1.2,0-1.2-4.2,0-4.2h10.8c1.1,0,1,3.3.9,4.2Z" fill="#e0e6ec" />
        <path d="M28.5,126h9c1.8,0,1.8,4.8,0,4.8h-9c-1.1,0-1.5-4.2,0-4.8Z" fill="#e0e6ec" />
        <path d="M421.7,144.7c5.2-1.8,7.1,9.4,5.6,10.4s-2.8.4-3.6-.7-4.1-9.1-2.1-9.7Z" fill="#e0e6ec" />
        <path d="M386.9,130.8c-1.2-.4-1.3-3.8-.3-4.5s9-.4,10.2.6-.1,3.9-.9,3.9c-2,0-7.7.4-9,0Z" fill="#e0e6ec" />
        <path d="M405.2,449.5c-.3-.8-.8-1.8-.7-2.6.1-1.3,7.8-6,9.2-5.6,6.2,1.7-6.2,9.7-8.5,8.2Z" fill="#e0e6ec" />
        <path d="M266.7,449h11.1c1.2,0,1.2,4.2,0,4.2h-10.8c-1.5,0-.3-3.3-.3-4.2Z" fill="#e0e6ec" />
        <path d="M255.4,453.2h-11.7c-1.3,0-1-3.1.3-3.9s10.1-.5,10.8,0,.5,2.9.6,3.9Z" fill="#e0e6ec" />
        <path d="M302.1,453.2h-12v-4.2h11.1c1.1,0,1,3.3.9,4.2Z" fill="#e0e6ec" />
        <path d="M115.1,453.2h-11.1c-1.5,0-.5-4.2-.3-4.2h10.5c1.1,0,1,3.3.9,4.2Z" fill="#e0e6ec" />
        <path d="M6.2,127.4c1-1.2,9.5-2.1,10.4-.8s.5,3-.8,3.5-8.2,1.4-8.9,1.3c-2-.3-1.6-3.1-.8-4.1Z" fill="#e0e6ec" />
        <path d="M138.5,453.2h-11.1c-1.5,0-.5-4.2-.3-4.2h10.5c1.1,0,1,3.3.9,4.2Z" fill="#e0e6ec" />
        <path d="M324.3,449c.7.4.3,4.2,0,4.2h-10.5c-1.2,0-1.2-4.2,0-4.2s10-.3,10.5,0Z" fill="#e0e6ec" />
        <path d="M347.6,449c.7.4.3,4.2,0,4.2h-10.5c-1.2,0-1.2-4.2,0-4.2s10-.3,10.5,0Z" fill="#e0e6ec" />
        <path d="M185.2,453.2h-11.4v-4.2h10.5c1.1,0,1,3.3.9,4.2Z" fill="#e0e6ec" />
        <path d="M430.3,175.8h-4.2v-10.5c0-1.2,4.2-1.2,4.2,0v10.5Z" fill="#e0e6ec" />
        <path d="M208.6,453.2h-11.4c0-2.4-.8-3.9,2.1-4.2s8.2-.1,8.8.3c.9.7.5,2.9.6,3.9Z" fill="#e0e6ec" />
        <path d="M232,453.2h-11.4c0-2.4-.8-3.9,2.1-4.2s8.2-.1,8.8.3c.9.7.5,2.9.6,3.9Z" fill="#e0e6ec" />
        <path d="M49.6,126.2c1-.3,7.3-.3,8,.1s.8,3.2.3,4-8.6.9-9.4.3c-1.3-.9-.6-3.9,1.1-4.4Z" fill="#e0e6ec" />
        <path d="M150.5,453.2c-.1-.8-.2-4.2.9-4.2h9.6c1.2,0,1.2,4.2,0,4.2h-10.5Z" fill="#e0e6ec" />
        <path d="M371,453.2h-11.4c.2-1-.5-3.1.3-3.7s10.1-.9,10.8,0,.2,2.6.3,3.6Z" fill="#e0e6ec" />
        <path d="M430.3,211.7c0,1,.2,2.8,0,3.6h-1.2c-.5-1.7-.4-4-2.4-4.8v4.8c-.3,0-1.1,0-1.2,0-.3-.4,0-9,.7-9.5s2-.1,2.5,0c2.3.7,1.6,3.9,1.6,5.9Z" fill="#e0e6ec" />
        <path d="M445.9,203.3h-.6c-.2-15.3-.2-30.8,0-46.1,1,.6.6,2.3.6,3.3.2,14.3,0,28.6,0,42.9Z" fill="#e0e6ec" />
        <path d="M1.9,446.6c2.4.3,2.7,3.3,4.2,5.1,2.6,3.1,6.5,5.6,8.4,9.3-5.7-4-9.9-7.7-12.6-14.4Z" fill="#799bc6" />
        <path d="M424.9,432.8c-.3-2.3,2.9-5.8,1.5-7.8s-1.8-.8-2.1-.6-1.7,4.9-1.8,5.4h-.6c.6-1.9,1.7-10.4,5.4-6.3s-.8,7.2-2.4,9.3Z" fill="#799bc6" />
        <path d="M445.3,156c-1.2-3.4,0-6.6,0-10.2s.2-2.4,0-3.2-2.3-.4-.6-2.2c2,7.2.7,9,.6,15.6Z" fill="#799bc6" />
        <path d="M430.3,456.8c-.5,1.1.1,1.6-2.4,1.8,0,0-.3-.8.4-1.3s1.5-.3,2-.5c1.3-2.5,4.5-5.9,7.2-7.2-2.2,3.2-3.7,5.3-7.2,7.2Z" fill="#799bc6" />
        <path d="M422.5,429.9c-.3,2-.5,4.3,1.8,3.6-.6.7-1.5,3.8-3.3,0s.7-3.1.9-3.6h.6Z" fill="#e0e6ec" />
        <path d="M445.9,212.9c-1.1-2.6-.6-6.6-.6-9.6h.6v9.6Z" fill="#799bc6" />
        <path d="M425.5,460.4c-1.1,1.7-3,2.4-4.8,3-.4-1.8,1.4-1.3,2.5-1.8s1.5-.8,2.3-1.2Z" fill="#799bc6" />
        <path d="M427.3,459.2c-.4.5-.4.9-1.2,1.2-.1-1.3,0-1.3,1.2-1.2Z" fill="#799bc6" />
        <path d="M449.5,220.7c4,0,10.9-.5,14.6.1s3.8,3.3,4,4.7c-1,.6-.6,2.3-.6,3.3,0,4.9,0,9.8,0,14.7,0,31.9,0,63.9,0,95.9-.9,2.4-2.7,3.5-5.4,3.9s-9.8.5-11.4.3c-8.6-1.2-12.8-.5-21-.6s-1.6,0-2.4,0c-42.1-.4-84.5-1-126.8-.6-68.5-11-67.6-109,.2-120.9,49.6-.3,99.3.2,148.8-.7ZM336.9,273.5c.6-4.1,6.7-7.6,10.6-8.2s9.8.9,14.2,3.4c.5,0,2.6-7.9,2.6-8.8,0-2.7-8.6-4.7-11-5-12.4-1.1-21.5,3.8-27.5,14.4-.4.8-1.4,3.9-1.7,4-1.1.7-4.5-.9-5.6,1.3s-.6,3.5,0,4.2,3,.2,4,.8.7,3.8.6,3.9c-.6.5-4.5-1.7-4.8,3.3s3.9,1.9,6.4,3.8,2.3,5.1,3.1,6.4c7,11.9,24,15.4,35.5,8.2l-.6-11c-6.4,4-13.7,6.7-20.6,2.3-1.1-.7-6.1-5.3-5.2-6.5,2.3,0,9.3.6,10.8-.3s1.6-6.3.3-6.3h-13.5c0-1-.2-2.3,0-3.2.8-2.4,11.8.3,14.1-1.5s1-5.5,0-5.5h-11.7Z" fill="#a2486c" />
        <path d="M139.1,64.3l25-7.6c50.6-16.7,100.7-33.7,151.4-50s19.2-7.8,24.5-6.6l31,99.5c-.2,0-.4,0-.6,0l-.6.6c-5.8,0-11.6,0-17.4,0l-16.7-54.3c-9.3-3.2-14.9,1-23.4-5.9s-5.3-7.8-9.4-10.4l-152.4,50.2c-1.8-3.9-8.2-12.2-11.4-15.6Z" fill="#b9d588" />
        <path d="M54,100.3c0-.5,1-8.7,1.2-9.8,7.1-38.7,56.7-55,83.8-26.1s9.6,11.7,11.4,15.6,2.2,7.6,3,10.2,0,7.4,0,9.6,0,.4,0,.6c-1.8.8,1,7.4-2.1,7.8-31.4-.2-62.8.3-94.2,0s-1.9-.6-2-.6c.7-1.8.3-4.2,0-6.1s-1.1-.8-1.2-1.1Z" fill="#f7d214" />
        <path d="M54,100.3c0,.2,1.1.5,1.2,1.1.3,2,.7,4.3,0,6.1-12.1-.1-24.2.5-36.3.6s-2.4.5-2.1-1.2c5.5-3.1,13.5-5,19.8-5.4s11.6.8,15.6-.6.9-.9,1.8-.6Z" fill="#223159" />
        <path d="M467.5,339.4c0-31.9,0-63.9,0-95.9h.6c.3,31.3-.2,62.6,0,93.9.3.9-.4,1.5-.6,2Z" fill="#e0e6ec" />
        <path d="M397.4,100.3l-25.8-.6c8.4,0,17.6-.6,25.8.6Z" fill="#799bc6" />
        <path d="M468.1,243.5h-.6c0-4.9,0-9.8,0-14.7s-.4-2.7.6-3.3c.7,4.6,0,12.8,0,18Z" fill="#799bc6" />
        <path d="M448.9,388.5c0-5.8,0-11.6,0-17.4,1.1,4.3.7,9.6.6,14.1s.4,2.7-.6,3.3Z" fill="#e0e6ec" />
        <path d="M52.2,100.9c-4,1.4-11,.3-15.6.6,4.9-1.4,10.5-.2,15.6-.6Z" fill="#799bc6" />
        <path d="M436.3,121.8c-3.2-4.2-5.5-6.3-9.6-9.6,2.8.6,6.6,4.7,8.4,6.9s1.4,1.4,1.2,2.7Z" fill="#799bc6" />
        <path d="M429.7,343c1.4,3.8.3,4.6-3.6,4.2-.7-2.4.7-2.5,1.2-4.2.8,0,1.6,0,2.4,0Z" fill="#e0e6ec" />
        <path d="M340.4,100.3c-2.2,0-4.4,0-6.6,0l-.3-.6-.3.6c-.4,0-.8,0-1.2,0,0-.9-1.7-.9-1.8,0-2.6,0-5.2,0-7.8,0,0-.9-1.7-.9-1.8,0-1.4,0-2.8,0-4.2,0-.4-.9-2.6-.9-3,0-.4,0-.8,0-1.2,0-1.7-1-5.6-1-7.2,0-.4,0-.8,0-1.2,0-2.8-1-7.4-1-10.2,0-12.2,0-24.4,0-36.6,0-1.6-.8-1.7-2.5-2.7-3.6-9.8-11.8-29.4-17.7-44.2-14.2s-18.7,9.6-25.6,17.8c-9.4,0-20.8-.8-30,0l-1.2-.6c0-2.2.5-8.1,0-9.6,7.9-1.1,15.3-4.9,22.8-7.5,35.7-12.2,71.6-23.8,107.4-35.3,3.2-1,12.1-5,15.1-4.6s5.5,5.2,7.2,6.6c3.2,2.5,10,5.5,13.9,6.4s6.5,0,8,1.6l12.3,39.3.3,3.6Z" fill="#b9d588" />
        <path d="M352.4,100.3c-4,0-8,0-12,0l-.3-3.6-12.3-39.3c-1.5-1.6-6-1.1-8-1.6-4-1-10.7-4-13.9-6.4s-5.5-6.4-7.2-6.6c-3-.4-11.9,3.6-15.1,4.6-35.8,11.5-71.7,23.1-107.4,35.3-7.5,2.6-14.9,6.3-22.8,7.5-.8-2.6-1.8-7.6-3-10.2l152.4-50.2c4.1,2.6,5.3,7.1,9.4,10.4,8.6,6.9,14.1,2.8,23.4,5.9l16.7,54.3Z" fill="#76b62e" />
        <path d="M257.2,100.3c-24.2,0-48.3,0-72.5,0,7-8.2,14.9-15.2,25.6-17.8s34.4,2.4,44.2,14.2c.9,1.1,1.1,2.8,2.7,3.6Z" fill="#76b62e" />
        <path d="M303.9,100.3c-3.4,0-6.8,0-10.2,0,2.8-1,7.4-1,10.2,0Z" fill="#76b62e" />
        <path d="M312.3,100.3c-2.4,0-4.8,0-7.2,0,1.6-1,5.5-1,7.2,0Z" fill="#76b62e" />
        <path d="M316.5,100.3c-1,0-2,0-3,0,.4-.9,2.6-.9,3,0Z" fill="#76b62e" />
        <path d="M332.1,100.3c-.6,0-1.2,0-1.8,0,0-.9,1.7-.9,1.8,0Z" fill="#76b62e" />
        <path d="M322.5,100.3c-.6,0-1.2,0-1.8,0,0-.9,1.7-.9,1.8,0Z" fill="#76b62e" />
        <path d="M154.7,100.3c-.4,0-1,0-1.2,0,0-.2,0-.4,0-.6l1.2.6Z" fill="#76b62e" />
        <path d="M333.9,100.3c-.2,0-.4,0-.6,0l.3-.6.3.6Z" fill="#76b62e" />
        <path d="M369.8,100.3l.6-.6c-.1,0-.4.6-.6.6Z" fill="#799bc6" />
        <path d="M336.9,273.5h11.7c1.1,0,1.5,4.3,0,5.5-2.3,1.8-13.3-.9-14.1,1.5s0,2.2,0,3.2h13.5c1.3,0,1.3,5.3-.3,6.3s-8.5.2-10.8.3c-.9,1.2,4,5.8,5.2,6.5,6.9,4.4,14.2,1.7,20.6-2.3l.6,11c-11.5,7.3-28.4,3.7-35.5-8.2-.8-1.4-2.5-5.9-3.1-6.4-2.5-1.9-6.8,1.9-6.4-3.8s4.3-2.8,4.8-3.3.2-3.4-.6-3.9-3.2.2-4-.8-.4-3.3,0-4.2c1.1-2.2,4.5-.6,5.6-1.3s1.2-3.2,1.7-4c6-10.6,15.1-15.5,27.5-14.4s11,2.3,11,5-2.1,8.7-2.6,8.8c-4.4-2.6-9-4.3-14.2-3.4s-10,4.1-10.6,8.2Z" fill="#f7d214" />
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

export function useSwipe(
  ref: React.RefObject<HTMLElement>,
  handlers: { onSwipeLeft?: () => void; onSwipeRight?: () => void },
  opts: SwipeOpts = {}
) {
  const {
    enabled = true,
    slop = 10,
    threshold = 32,
    ignoreSelector,
    disableDrag,
  } = opts;

  const state = React.useRef({
    pointerId: null as number | null,
    startX: 0,
    startY: 0,
    dx: 0,
    armed: false,
    intent: null as null | 'left' | 'right',
  }).current;

  const [progress, setProgress] = React.useState(0);
  const [isSwiping, setIsSwiping] = React.useState(false);

  const handlersRef = React.useRef(handlers);
  handlersRef.current = handlers;

  const resetState = React.useCallback(() => {
    state.pointerId = null;
    state.armed = false;
    state.intent = null;
    state.dx = 0;
    setIsSwiping(false);
    setProgress(0);
  }, [state]);

  React.useEffect(() => {
    const root = ref.current;
    if (!root || !enabled) {
      // If the hook is disabled (e.g., modal is closed), ensure we reset
      // the internal state. This prevents an interrupted gesture from leaving
      // the state "dirty", which would block future swipes.
      resetState();
      return;
    }

    const onDown = (e: PointerEvent) => {
      if (
        e.button !== 0 ||
        state.pointerId !== null ||
        (ignoreSelector && (e.target as HTMLElement).closest(ignoreSelector))
      ) {
        return;
      }
      state.pointerId = e.pointerId;
      state.startX = e.clientX;
      state.startY = e.clientY;
      state.dx = 0;
      state.armed = false;
      state.intent = null;
    };

    const onMove = (e: PointerEvent) => {
      if (state.pointerId !== e.pointerId) return;

      const dx = e.clientX - state.startX;
      const dy = e.clientY - state.startY;

      if (!state.armed) {
        if (Math.abs(dx) > slop && Math.abs(dx) > Math.abs(dy) * 2) {
          state.armed = true;
          setIsSwiping(true);
          state.intent = dx < 0 ? 'left' : 'right';
          try {
            root.setPointerCapture(e.pointerId);
          } catch {}
        } else if (Math.abs(dy) > slop) {
          state.pointerId = null; // It's a vertical scroll, release
        }
        if (!state.armed) return;
      }

      state.dx = dx;
      const hasHandler =
        (state.intent === 'left' && handlersRef.current.onSwipeLeft) ||
        (state.intent === 'right' && handlersRef.current.onSwipeRight);
      
      if (!hasHandler) return;

      const screenWidth = root.offsetWidth;
      if (screenWidth > 0) {
        const p = Math.max(-1, Math.min(1, dx / screenWidth));
        if (state.intent && disableDrag?.(state.intent)) {
          setProgress(0);
        } else {
          setProgress(p);
        }
      }
    };

    const onUp = (e: PointerEvent) => {
      if (state.pointerId !== e.pointerId) return;

      if (state.armed) {
        try {
          root.releasePointerCapture(e.pointerId);
        } catch {}

        if (Math.abs(state.dx) >= threshold) {
          if (state.intent === 'left' && handlersRef.current.onSwipeLeft) {
            handlersRef.current.onSwipeLeft();
          } else if (state.intent === 'right' && handlersRef.current.onSwipeRight) {
            handlersRef.current.onSwipeRight();
          }
        }
      }
      
      resetState();
    };

    const onCancel = (e: PointerEvent) => {
      if (state.pointerId !== e.pointerId) return;
      if (state.armed) {
        try {
          root.releasePointerCapture(e.pointerId);
        } catch {}
      }
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
  }, [ref, enabled, slop, threshold, ignoreSelector, disableDrag, resetState, state]);

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
// hooks/useTapBridge.ts
// FIX: Import React to provide types for events.
import React, { useRef, useCallback } from 'react';

type Options = { slopPx?: number; tapMs?: number; };

/**
 * TapBridge: Evita il "primo tap a vuoto" e sopprime i doppi click
 * senza interferire con altri gesti come lo swipe.
 *
 * Funziona in fase di "capture" per essere più cooperativo.
 */
export function useTapBridge(opts: Options = {}) {
  const SLOP = opts.slopPx ?? 10;
  const TAP_MS = opts.tapMs ?? 350;

  const stateRef = useRef({
    id: null as number | null,
    t0: 0,
    x0: 0,
    y0: 0,
    moved: false,
    target: null as EventTarget | null,
    suppressNextClick: false,
  });

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    // Se un altro puntatore è già attivo, ignora.
    if (stateRef.current.id !== null && e.pointerId !== stateRef.current.id) return;
    
    const state = stateRef.current;
    state.id = e.pointerId;
    state.t0 = performance.now();
    state.x0 = e.clientX;
    state.y0 = e.clientY;
    state.moved = false;
    state.target = e.target;
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const state = stateRef.current;
    if (state.id !== e.pointerId || state.moved) return;

    const dx = Math.abs(e.clientX - state.x0);
    const dy = Math.abs(e.clientY - state.y0);
    if (dx > SLOP || dy > SLOP) {
      state.moved = true;
    }
  }, [SLOP]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const state = stateRef.current;
    if (state.id !== e.pointerId) return;

    const isTap = !state.moved && (performance.now() - state.t0) < TAP_MS;
    const target = state.target as HTMLElement | null;

    // Resetta l'ID del puntatore per terminare il gesto per questo bridge
    state.id = null;

    if (isTap && target && !target.closest?.('[data-no-synthetic-click]')) {
      // Questo bridge sta gestendo il tap. Ferma la propagazione per evitare che i bridge parent facciano lo stesso.
      e.stopPropagation();

      state.suppressNextClick = true;

      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable
      ) {
        if (document.activeElement !== target) {
          target.focus();
        }
      }

      const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
      target.dispatchEvent(clickEvent);
    }
  }, [TAP_MS]);

  const onClickCapture = useCallback((e: React.MouseEvent) => {
    const state = stateRef.current;
    
    if (state.suppressNextClick && e.isTrusted) {
      e.preventDefault();
      e.stopPropagation();
      state.suppressNextClick = false; // Consuma il flag
    }
  }, []);

  // FIX: Added onPointerCancel handler to reset gesture state when canceled.
  const onPointerCancel = useCallback((e: React.PointerEvent) => {
    const state = stateRef.current;
    if (state.id === e.pointerId) {
      // Reset the state to cancel the tap gesture
      state.id = null;
      state.moved = false;
      state.target = null;
      state.suppressNextClick = false;
    }
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
<svg id="Livello_1" data-name="Livello 1" xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 468.4 464">
  <path d="M4.3,118.8c11.3-9.4,27.7-7,41.7-7.2,108-1.1,216.1-.3,324.1-.6,14.3,0,34.3-.9,47.2,5,9,4.1,20.9,15.9,23.7,25.4s-.7,6.7,3.1,7.4c0-1,.1-2.1,0-3h1.2c0,3.6-1.2,6.8,0,10.2,0,.4,0,.8,0,1.2-.2,15.3-.2,30.8,0,46.1,0,3-.5,7,.6,9.6s.7.6.6,1.2c-2-.2-1.1-1.1-2-1.8-2-1.5-11.1,0-14.1-.6,0-1.9.6-5.2-1.6-5.9s-2.2-.3-2.5,0c-.6.5-1,9.1-.7,9.5s.9,0,1.2,0c.8,0,1.6,0,2.4,0h1.2c-.7,3.1-7.3.7-5.4-3.6h-120.8c-74.4,8.1-93.6,104.6-22.4,136.3,18,8,37.4,5.7,56.6,6.3,9.8.3,19.4,1.6,29.4,1.2,15.1-.6,30.6-1.3,45.5-3,8.2-1,20.1,0,28.8,0s5.9,1.4,7.5-1.2c0,.3,0,1,0,1.8l-3.6.9c-.4,26.6,1.2,53.4-1.2,80-2.2,6.1-3.6,10.3-7.2,15.6-2.7,1.3-5.9,4.7-7.2,7.2-.5.3-1.5.2-2,.5s-.3,1.2-.4,1.3c-.2.2-.4.4-.6.6-1.3-.1-1.3,0-1.2,1.2-.2,0-.4,0-.6,0-.8.4-1.5.8-2.3,1.2-1.2.6-2.9,0-2.5,1.8-.2,0-.4,0-.6,0-.5,0-1,0-1.2.6H18.7c-1.2-1.2-2.8-2-4.2-3-1.8-3.7-5.8-6.2-8.4-9.3s-1.8-4.7-4.2-5.1c-.4-1.1-.9-2.1-1.3-3.2C-.6,338.8.4,234,0,129.3c.3-3.6,2.3-7.5,4.2-10.5ZM6.2,127.4c-.9,1-1.3,3.8.8,4.1s8-1,8.9-1.3c1.3-.5,1.4-2.6.8-3.5s-9.3-.4-10.4.8ZM28.5,126c-1.5.6-1.1,4.8,0,4.8h9c1.8,0,1.8-4.8,0-4.8h-9ZM49.6,126.2c-1.7.5-2.3,3.5-1.1,4.4s8.8.5,9.4-.3.5-3.4-.3-4-7-.4-8-.1ZM68.7,126c-1.5.6-1.1,4.8,0,4.8h9c1.8,0,1.8-4.8,0-4.8h-9ZM90.9,126c-1.8.6-2,4.8-.6,4.8h9.6c1.3,0,1.3-4.8,0-4.8h-9ZM113,126c-1.5.6-1.1,4.8,0,4.8h10.8c1.3,0,1.3-4.8,0-4.8h-10.8ZM138.8,130.8c1.3.4,7.6,0,9.6,0s1.3-4.8,0-4.8h-9.6c-.2,0-.9.8-1.5.6.2,1,.6,3.9,1.5,4.2ZM173.9,126c-.5-.3-9.4,0-11.1,0s-1.3,4.8,0,4.8h10.8c1.4,0,.7-4.5.3-4.8ZM199.6,126c-.5-.3-9.4,0-11.1,0s-1.3,4.8,0,4.8h11.1c.3,0,.8-4.3,0-4.8ZM213.1,126c-1.5.6-1.1,4.8,0,4.8h10.8c1.3,0,1.3-4.8,0-4.8h-10.8ZM238.3,126c-1.5.6-1.1,4.8,0,4.8h10.8c1.3,0,1.3-4.8,0-4.8h-10.8ZM262.8,126c-1.5.6-1.1,4.8,0,4.8h10.8c1.3,0,1.3-4.8,0-4.8h-10.8ZM288,126c-1.5.6-1.1,4.8,0,4.8h10.8c1.3,0,1.3-4.8,0-4.8h-10.8ZM313.8,126c-1.5.6-1.1,4.8,0,4.8h9.6c1.3,0,1.3-4.8,0-4.8h-9.6ZM338.1,130.8c.4.3,8.9,0,10.5,0s1.3-4.8,0-4.8h-9.6c-.2,0-1.4.6-1.5,1-.1.6.5,3.7.6,3.8ZM362.9,126c-1.8.6-2,4.8-.6,4.8h10.8c1.3,0,1.3-4.8,0-4.8h-10.2ZM386.9,130.8c1.3.4,7,0,9,0s2.4-2.7.9-3.9-9.2-1.4-10.2-.6-.8,4.2.3,4.5ZM407.4,130.3c-.7.1-2,.8-2.2,1.5-.4,1.8,7.2,6.5,8.2,6.7,1.6.4,3.6-1.9,2.9-3.5s-7-5-8.9-4.7ZM421.7,144.7c-2,.7,1.3,8.7,2.1,9.7s2.5,1.5,3.6.7-.4-12.2-5.6-10.4ZM430.3,175.8v-10.5c0-1.2-4.2-1.2-4.2,0v10.5h4.2ZM430.3,184.8c-.9.2-4.4-.3-4.8,0-.9.8-.7,9.5.2,10.8s3.3.4,4.5.6v-11.4ZM430.3,358.5c-5.9-2.2-5.9,2.1-5.3,6.8s5.3,3.5,5.3,2.5v-9.3ZM430.3,390c.4-1.3,0-7,0-9s-4.2-1.9-4.7-1.4-1,9.9-.4,10.8,4.7.9,5.1-.3ZM429.6,401.8c-.5-.6-2.4-.9-3.1-.7-1.9.6-2.1,10.3-1.3,11.4s4.6,1,5-.4.2-9.3-.7-10.3ZM421.9,429.9c-.2.5-2.1.9-.9,3.6s2.7.7,3.3,0,.5-.4.6-.6c1.6-2.1,4.7-6.8,2.4-9.3-3.7-4.1-4.8,4.4-5.4,6.3ZM405.2,449.5c2.3,1.5,14.7-6.5,8.5-8.2s-9.1,4.3-9.2,5.6.4,1.8.7,2.6ZM8.5,444.8c-1.7,5.5,5.3,6.8,9.4,7.1s4.3-3.2,2.6-4.5-11.6-3.1-12-2.7ZM31.8,453.2h12.6c-.1-.8.2-4,0-4.2-.3-.3-7-.6-8.1-.6-4.5,0-5,.2-4.5,4.8ZM394.4,453.2c.2-1.1.6-1.7.2-2.9-.9-3.2-2-1.4-4.1-1.3s-7.4-.3-8,0-1,4.1.2,4.1h11.7ZM68.3,449.7c-.8-.9-11.6-1.2-11.9.3-.8,3.4,1,4.1,3.9,4.4s7.6-.2,8.1-.6.1-3.9,0-4.1ZM92.4,453.2c.1-.8.2-4.2-.9-4.2h-10.8c-1.2,0-1.2,4.2,0,4.2h11.7ZM115.1,453.2c.1-.8.2-4.2-.9-4.2h-10.5c-.2,0-1.2,4.2.3,4.2h11.1ZM138.5,453.2c.1-.8.2-4.2-.9-4.2h-10.5c-.2,0-1.2,4.2.3,4.2h11.1ZM150.5,453.2h10.5c1.2,0,1.2-4.2,0-4.2h-9.6c-1.1,0-1,3.3-.9,4.2ZM185.2,453.2c.1-.8.2-4.2-.9-4.2h-10.5v4.2h11.4ZM208.6,453.2c0-1.1.4-3.3-.6-3.9s-7.5-.4-8.8-.3c-2.8.3-2,1.8-2.1,4.2h11.4ZM232,453.2c0-1.1.4-3.3-.6-3.9s-7.5-.4-8.8-.3c-2.8.3-2,1.8-2.1,4.2h11.4ZM255.4,453.2c0-1.1.4-3.3-.6-3.9s-10-.5-10.8,0c-1.3.8-1.6,3.9-.3,3.9h11.7ZM266.7,449c0,.9-1.2,4.2.3,4.2h10.8c1.2,0,1.2-4.2,0-4.2h-11.1ZM302.1,453.2c.1-.8.2-4.2-.9-4.2h-11.1v4.2h12ZM324.3,449c-.4-.3-8.9,0-10.5,0s-1.2,4.2,0,4.2h10.5c.3,0,.7-3.7,0-4.2ZM347.6,449c-.4-.3-8.9,0-10.5,0s-1.2,4.2,0,4.2h10.5c.3,0,.7-3.7,0-4.2ZM371,453.2c0-1,.3-2.8-.3-3.6s-9.7-.8-10.8,0-.2,2.7-.3,3.7h11.4Z" fill="#12427c"/>
  <path d="M420.1,463.4v.6h-1.2c.2-.6.7-.5,1.2-.6Z" fill="#799bc6"/>
  <path d="M449.5,351.4c-1.6,2.6-5.3,1.2-7.5,1.2-8.7,0-20.6-.9-28.8,0-14.9,1.7-30.4,2.5-45.5,3-10,.4-19.6-.9-29.4-1.2-19.2-.6-38.6,1.7-56.6-6.3-71.2-31.7-52.1-128.1,22.4-136.3h120.8c-1.9,4.3,4.6,6.7,5.4,3.6s0-2.6,0-3.6c3,.5,12.2-.9,14.1.6s0,1.6,2,1.8,2.9-.1,3,0c.2.2-.2,5.5,0,6.6-49.5.9-99.2.4-148.8.7-67.7,11.9-68.7,109.9-.2,120.9,42.2-.4,84.6.2,126.8.6-.5,1.7-1.9,1.8-1.2,4.2,3.9.4,5-.4,3.6-4.2,8.2,0,12.4-.6,21,.6-1.1,2.6-.9,5.1-1.2,7.8Z" fill="#223159"/>
  <path d="M371.6,99.7l25.8.6c11.9,1.7,20.2,4.6,29.4,12s6.4,5.4,9.6,9.6c5.2,6.8,6.1,10.4,8.4,18.6-1.7,1.8.4,1.7.6,2.2.2.8,0,2.2,0,3.2h-1.2c-1.9-12.8-15.8-29.8-27.8-34.2s-14.5-4.2-16.8-4.2h-246c0-2.4,0-4.8,0-7.2.2,0,.8,0,1.2,0,9.2-.8,20.5,0,30,0,24.2,0,48.3,0,72.5,0s24.4,0,36.6,0,6.8,0,10.2,0,.8,0,1.2,0c2.4,0,4.8,0,7.2,0s.8,0,1.2,0c1,0,2,0,3,0s2.8,0,4.2,0,1.2,0,1.8,0c2.6,0,5.2,0,7.8,0s1.2,0,1.8,0,.8,0,1.2,0,.4,0,.6,0c2.2,0,4.4,0,6.6,0,4,0,8,0,12,0,5.8,0,11.6,0,17.4,0s.5-.6.6-.6c.2,0,.4,0,.6,0s.4,0,.6,0Z" fill="#223159"/>
  <path d="M153.5,100.3c0,2.4,0,4.8,0,7.2h246c2.3,0,14.1,3.2,16.8,4.2,12.1,4.4,26,21.4,27.8,34.2s0,2,0,3c-3.8-.7-2.4-5.1-3.1-7.4-2.8-9.5-14.8-21.3-23.7-25.4-12.9-5.9-32.9-5.1-47.2-5-108.1.4-216.2-.5-324.1.6-14,.1-30.4-2.3-41.7,7.2,0-1.1.8-1.7,1.5-2.4,3.6-3.7,6.7-7.1,11.1-9.6-.3,1.8.9,1.2,2.1,1.2,12-.1,24.1-.7,36.3-.6s.9.6,2,.6c31.4.3,62.8-.3,94.2,0,3.1-.4.3-7,2.1-7.8Z" fill="#799bc6"/>
  <path d="M449.5,353.1c-.4,6-.5,11.9-.6,18s0,11.6,0,17.4.7,17.6,0,25.5-3.1,17.1-4.2,20.1c2.4-26.5.7-53.3,1.2-80l3.6-.9Z" fill="#799bc6"/>
  <path d="M8.5,444.8c.4-.4,11.5,2.3,12,2.7,1.6,1.2,1.3,4.8-2.6,4.5s-11.1-1.6-9.4-7.1Z" fill="#e0e6ec"/>
  <path d="M429.6,401.8c.8,1,1.1,8.9.7,10.3s-4.4,1.4-5,.4-.6-10.8,1.3-11.4,2.6.2,3.1.7Z" fill="#e0e6ec"/>
  <path d="M68.3,449.7c.2.2.2,4,0,4.1-.4.5-6.9.7-8.1.6-2.9-.3-4.7-1-3.9-4.4s11.2-1.2,11.9-.3Z" fill="#e0e6ec"/>
  <path d="M288,126h10.8c1.3,0,1.3,4.8,0,4.8h-10.8c-1.1,0-1.5-4.2,0-4.8Z" fill="#e0e6ec"/>
  <path d="M262.8,126h10.8c1.3,0,1.3,4.8,0,4.8h-10.8c-1.1,0-1.5-4.2,0-4.8Z" fill="#e0e6ec"/>
  <path d="M238.3,126h10.8c1.3,0,1.3,4.8,0,4.8h-10.8c-1.1,0-1.5-4.2,0-4.8Z" fill="#e0e6ec"/>
  <path d="M213.1,126h10.8c1.3,0,1.3,4.8,0,4.8h-10.8c-1.1,0-1.5-4.2,0-4.8Z" fill="#e0e6ec"/>
  <path d="M430.3,390c-.4,1.2-4.5,1.3-5.1.3s-.3-10.2.4-10.8,4.7-.5,4.7,1.4.4,7.7,0,9Z" fill="#e0e6ec"/>
  <path d="M113,126h10.8c1.3,0,1.3,4.8,0,4.8h-10.8c-1.1,0-1.5-4.2,0-4.8Z" fill="#e0e6ec"/>
  <path d="M173.9,126c.4.3,1.1,4.8-.3,4.8h-10.8c-1.3,0-1.3-4.8,0-4.8s10.6-.3,11.1,0Z" fill="#e0e6ec"/>
  <path d="M199.6,126c.8.5.3,4.8,0,4.8h-11.1c-1.3,0-1.3-4.8,0-4.8s10.6-.3,11.1,0Z" fill="#e0e6ec"/>
  <path d="M362.9,126h10.2c1.3,0,1.3,4.8,0,4.8h-10.8c-1.4,0-1.2-4.2.6-4.8Z" fill="#e0e6ec"/>
  <path d="M430.3,184.8v11.4c-1.2-.1-3.8.5-4.5-.6s-1.1-9.9-.2-10.8,3.8.1,4.8,0Z" fill="#e0e6ec"/>
  <path d="M31.8,453.2c-.5-4.6,0-4.9,4.5-4.8s7.8.3,8.1.6-.1,3.4,0,4.2h-12.6Z" fill="#e0e6ec"/>
  <path d="M430.3,358.5v9.3c0,1.1-4.5,4-5.3-2.5s-.6-9.1,5.3-6.8Z" fill="#e0e6ec"/>
  <path d="M338.1,130.8c-.2-.1-.8-3.2-.6-3.8.1-.4,1.4-1,1.5-1h9.6c1.3,0,1.3,4.8,0,4.8s-10,.3-10.5,0Z" fill="#e0e6ec"/>
  <path d="M138.8,130.8c-.9-.3-1.3-3.2-1.5-4.2.6.1,1.3-.6,1.5-.6h9.6c1.3,0,1.3,4.8,0,4.8-2,0-8.3.4-9.6,0Z" fill="#e0e6ec"/>
  <path d="M394.4,453.2h-11.7c-1.2,0-.9-3.6-.2-4.1s6.5,0,8,0c2.1,0,3.2-1.8,4.1,1.3s0,1.8-.2,2.9Z" fill="#e0e6ec"/>
  <path d="M313.8,126h9.6c1.3,0,1.3,4.8,0,4.8h-9.6c-1.1,0-1.5-4.2,0-4.8Z" fill="#e0e6ec"/>
  <path d="M90.9,126h9c1.3,0,1.3,4.8,0,4.8h-9.6c-1.4,0-1.2-4.2.6-4.8Z" fill="#e0e6ec"/>
  <path d="M407.4,130.3c1.9-.3,8.1,3.1,8.9,4.7s-1.2,3.9-2.9,3.5-8.6-4.9-8.2-6.7c.2-.7,1.5-1.4,2.2-1.5Z" fill="#e0e6ec"/>
  <path d="M68.7,126h9c1.8,0,1.8,4.8,0,4.8h-9c-1.1,0-1.5-4.2,0-4.8Z" fill="#e0e6ec"/>
  <path d="M92.4,453.2h-11.7c-1.2,0-1.2-4.2,0-4.2h10.8c1.1,0,1,3.3.9,4.2Z" fill="#e0e6ec"/>
  <path d="M28.5,126h9c1.8,0,1.8,4.8,0,4.8h-9c-1.1,0-1.5-4.2,0-4.8Z" fill="#e0e6ec"/>
  <path d="M421.7,144.7c5.2-1.8,7.1,9.4,5.6,10.4s-2.8.4-3.6-.7-4.1-9.1-2.1-9.7Z" fill="#e0e6ec"/>
  <path d="M386.9,130.8c-1.2-.4-1.3-3.8-.3-4.5s9-.4,10.2.6-.1,3.9-.9,3.9c-2,0-7.7.4-9,0Z" fill="#e0e6ec"/>
  <path d="M405.2,449.5c-.3-.8-.8-1.8-.7-2.6.1-1.3,7.8-6,9.2-5.6,6.2,1.7-6.2,9.7-8.5,8.2Z" fill="#e0e6ec"/>
  <path d="M266.7,449h11.1c1.2,0,1.2,4.2,0,4.2h-10.8c-1.5,0-.3-3.3-.3-4.2Z" fill="#e0e6ec"/>
  <path d="M255.4,453.2h-11.7c-1.3,0-1-3.1.3-3.9s10.1-.5,10.8,0,.5,2.9.6,3.9Z" fill="#e0e6ec"/>
  <path d="M302.1,453.2h-12v-4.2h11.1c1.1,0,1,3.3.9,4.2Z" fill="#e0e6ec"/>
  <path d="M115.1,453.2h-11.1c-1.5,0-.5-4.2-.3-4.2h10.5c1.1,0,1,3.3.9,4.2Z" fill="#e0e6ec"/>
  <path d="M6.2,127.4c1-1.2,9.5-2.1,10.4-.8s.5,3-.8,3.5-8.2,1.4-8.9,1.3c-2-.3-1.6-3.1-.8-4.1Z" fill="#e0e6ec"/>
  <path d="M138.5,453.2h-11.1c-1.5,0-.5-4.2-.3-4.2h10.5c1.1,0,1,3.3.9,4.2Z" fill="#e0e6ec"/>
  <path d="M324.3,449c.7.4.3,4.2,0,4.2h-10.5c-1.2,0-1.2-4.2,0-4.2s10-.3,10.5,0Z" fill="#e0e6ec"/>
  <path d="M347.6,449c.7.4.3,4.2,0,4.2h-10.5c-1.2,0-1.2-4.2,0-4.2s10-.3,10.5,0Z" fill="#e0e6ec"/>
  <path d="M185.2,453.2h-11.4v-4.2h10.5c1.1,0,1,3.3.9,4.2Z" fill="#e0e6ec"/>
  <path d="M430.3,175.8h-4.2v-10.5c0-1.2,4.2-1.2,4.2,0v10.5Z" fill="#e0e6ec"/>
  <path d="M208.6,453.2h-11.4c0-2.4-.8-3.9,2.1-4.2s8.2-.1,8.8.3c.9.7.5,2.9.6,3.9Z" fill="#e0e6ec"/>
  <path d="M232,453.2h-11.4c0-2.4-.8-3.9,2.1-4.2s8.2-.1,8.8.3c.9.7.5,2.9.6,3.9Z" fill="#e0e6ec"/>
  <path d="M49.6,126.2c1-.3,7.3-.3,8,.1s.8,3.2.3,4-8.6.9-9.4.3c-1.3-.9-.6-3.9,1.1-4.4Z" fill="#e0e6ec"/>
  <path d="M150.5,453.2c-.1-.8-.2-4.2.9-4.2h9.6c1.2,0,1.2,4.2,0,4.2h-10.5Z" fill="#e0e6ec"/>
  <path d="M371,453.2h-11.4c.2-1-.5-3.1.3-3.7s10.1-.9,10.8,0,.2,2.6.3,3.6Z" fill="#e0e6ec"/>
  <path d="M430.3,211.7c0,1,.2,2.8,0,3.6h-1.2c-.5-1.7-.4-4-2.4-4.8v4.8c-.3,0-1.1,0-1.2,0-.3-.4,0-9,.7-9.5s2-.1,2.5,0c2.3.7,1.6,3.9,1.6,5.9Z" fill="#e0e6ec"/>
  <path d="M445.9,203.3h-.6c-.2-15.3-.2-30.8,0-46.1,1,.6.6,2.3.6,3.3.2,14.3,0,28.6,0,42.9Z" fill="#e0e6ec"/>
  <path d="M1.9,446.6c2.4.3,2.7,3.3,4.2,5.1,2.6,3.1,6.5,5.6,8.4,9.3-5.7-4-9.9-7.7-12.6-14.4Z" fill="#799bc6"/>
  <path d="M424.9,432.8c-.3-2.3,2.9-5.8,1.5-7.8s-1.8-.8-2.1-.6-1.7,4.9-1.8,5.4h-.6c.6-1.9,1.7-10.4,5.4-6.3s-.8,7.2-2.4,9.3Z" fill="#799bc6"/>
  <path d="M445.3,156c-1.2-3.4,0-6.6,0-10.2s.2-2.4,0-3.2-2.3-.4-.6-2.2c2,7.2.7,9,.6,15.6Z" fill="#799bc6"/>
  <path d="M430.3,456.8c-.5,1.1.1,1.6-2.4,1.8,0,0-.3-.8.4-1.3s1.5-.3,2-.5c1.3-2.5,4.5-5.9,7.2-7.2-2.2,3.2-3.7,5.3-7.2,7.2Z" fill="#799bc6"/>
  <path d="M422.5,429.9c-.3,2-.5,4.3,1.8,3.6-.6.7-1.5,3.8-3.3,0s.7-3.1.9-3.6h.6Z" fill="#e0e6ec"/>
  <path d="M445.9,212.9c-1.1-2.6-.6-6.6-.6-9.6h.6v9.6Z" fill="#799bc6"/>
  <path d="M425.5,460.4c-1.1,1.7-3,2.4-4.8,3-.4-1.8,1.4-1.3,2.5-1.8s1.5-.8,2.3-1.2Z" fill="#799bc6"/>
  <path d="M427.3,459.2c-.4.5-.4.9-1.2,1.2-.1-1.3,0-1.3,1.2-1.2Z" fill="#799bc6"/>
  <path d="M449.5,220.7c4,0,10.9-.5,14.6.1s3.8,3.3,4,4.7c-1,.6-.6,2.3-.6,3.3,0,4.9,0,9.8,0,14.7,0,31.9,0,63.9,0,95.9-.9,2.4-2.7,3.5-5.4,3.9s-9.8.5-11.4.3c-8.6-1.2-12.8-.5-21-.6s-1.6,0-2.4,0c-42.1-.4-84.5-1-126.8-.6-68.5-11-67.6-109,.2-120.9,49.6-.3,99.3.2,148.8-.7ZM336.9,273.5c.6-4.1,6.7-7.6,10.6-8.2s9.8.9,14.2,3.4c.5,0,2.6-7.9,2.6-8.8,0-2.7-8.6-4.7-11-5-12.4-1.1-21.5,3.8-27.5,14.4-.4.8-1.4,3.9-1.7,4-1.1.7-4.5-.9-5.6,1.3s-.6,3.5,0,4.2,3,.2,4,.8.7,3.8.6,3.9c-.6.5-4.5-1.7-4.8,3.3s3.9,1.9,6.4,3.8,2.3,5.1,3.1,6.4c7,11.9,24,15.4,35.5,8.2l-.6-11c-6.4,4-13.7,6.7-20.6,2.3-1.1-.7-6.1-5.3-5.2-6.5,2.3,0,9.3.6,10.8-.3s1.6-6.3.3-6.3h-13.5c0-1-.2-2.3,0-3.2.8-2.4,11.8.3,14.1-1.5s1-5.5,0-5.5h-11.7Z" fill="#a2486c"/>
  <path d="M139.1,64.3l25-7.6c50.6-16.7,100.7-33.7,151.4-50s19.2-7.8,24.5-6.6l31,99.5c-.2,0-.4,0-.6,0l-.6.6c-5.8,0-11.6,0-17.4,0l-16.7-54.3c-9.3-3.2-14.9,1-23.4-5.9s-5.3-7.8-9.4-10.4l-152.4,50.2c-1.8-3.9-8.2-12.2-11.4-15.6Z" fill="#b9d588"/>
  <path d="M54,100.3c0-.5,1-8.7,1.2-9.8,7.1-38.7,56.7-55,83.8-26.1s9.6,11.7,11.4,15.6,2.2,7.6,3,10.2,0,7.4,0,9.6,0,.4,0,.6c-1.8.8,1,7.4-2.1,7.8-31.4-.2-62.8.3-94.2,0s-1.9-.6-2-.6c.7-1.8.3-4.2,0-6.1s-1.1-.8-1.2-1.1Z" fill="#f7d214"/>
  <path d="M54,100.3c0,.2,1.1.5,1.2,1.1.3,2,.7,4.3,0,6.1-12.1-.1-24.2.5-36.3.6s-2.4.5-2.1-1.2c5.5-3.1,13.5-5,19.8-5.4s11.6.8,15.6-.6.9-.9,1.8-.6Z" fill="#223159"/>
  <path d="M467.5,339.4c0-31.9,0-63.9,0-95.9h.6c.3,31.3-.2,62.6,0,93.9.3.9-.4,1.5-.6,2Z" fill="#e0e6ec"/>
  <path d="M397.4,100.3l-25.8-.6c8.4,0,17.6-.6,25.8.6Z" fill="#799bc6"/>
  <path d="M468.1,243.5h-.6c0-4.9,0-9.8,0-14.7s-.4-2.7.6-3.3c.7,4.6,0,12.8,0,18Z" fill="#799bc6"/>
  <path d="M448.9,388.5c0-5.8,0-11.6,0-17.4,1.1,4.3.7,9.6.6,14.1s.4,2.7-.6,3.3Z" fill="#e0e6ec"/>
  <path d="M52.2,100.9c-4,1.4-11,.3-15.6.6,4.9-1.4,10.5-.2,15.6-.6Z" fill="#799bc6"/>
  <path d="M436.3,121.8c-3.2-4.2-5.5-6.3-9.6-9.6,2.8.6,6.6,4.7,8.4,6.9s1.4,1.4,1.2,2.7Z" fill="#799bc6"/>
  <path d="M429.7,343c1.4,3.8.3,4.6-3.6,4.2-.7-2.4.7-2.5,1.2-4.2.8,0,1.6,0,2.4,0Z" fill="#e0e6ec"/>
  <path d="M340.4,100.3c-2.2,0-4.4,0-6.6,0l-.3-.6-.3.6c-.4,0-.8,0-1.2,0,0-.9-1.7-.9-1.8,0-2.6,0-5.2,0-7.8,0,0-.9-1.7-.9-1.8,0-1.4,0-2.8,0-4.2,0-.4-.9-2.6-.9-3,0-.4,0-.8,0-1.2,0-1.7-1-5.6-1-7.2,0-.4,0-.8,0-1.2,0-2.8-1-7.4-1-10.2,0-12.2,0-24.4,0-36.6,0-1.6-.8-1.7-2.5-2.7-3.6-9.8-11.8-29.4-17.7-44.2-14.2s-18.7,9.6-25.6,17.8c-9.4,0-20.8-.8-30,0l-1.2-.6c0-2.2.5-8.1,0-9.6,7.9-1.1,15.3-4.9,22.8-7.5,35.7-12.2,71.6-23.8,107.4-35.3,3.2-1,12.1-5,15.1-4.6s5.5,5.2,7.2,6.6c3.2,2.5,10,5.5,13.9,6.4s6.5,0,8,1.6l12.3,39.3.3,3.6Z" fill="#b9d588"/>
  <path d="M352.4,100.3c-4,0-8,0-12,0l-.3-3.6-12.3-39.3c-1.5-1.6-6-1.1-8-1.6-4-1-10.7-4-13.9-6.4s-5.5-6.4-7.2-6.6c-3-.4-11.9,3.6-15.1,4.6-35.8,11.5-71.7,23.1-107.4,35.3-7.5,2.6-14.9,6.3-22.8,7.5-.8-2.6-1.8-7.6-3-10.2l152.4-50.2c4.1,2.6,5.3,7.1,9.4,10.4,8.6,6.9,14.1,2.8,23.4,5.9l16.7,54.3Z" fill="#76b62e"/>
  <path d="M257.2,100.3c-24.2,0-48.3,0-72.5,0,7-8.2,14.9-15.2,25.6-17.8s34.4,2.4,44.2,14.2c.9,1.1,1.1,2.8,2.7,3.6Z" fill="#76b62e"/>
  <path d="M303.9,100.3c-3.4,0-6.8,0-10.2,0,2.8-1,7.4-1,10.2,0Z" fill="#76b62e"/>
  <path d="M312.3,100.3c-2.4,0-4.8,0-7.2,0,1.6-1,5.5-1,7.2,0Z" fill="#76b62e"/>
  <path d="M316.5,100.3c-1,0-2,0-3,0,.4-.9,2.6-.9,3,0Z" fill="#76b62e"/>
  <path d="M332.1,100.3c-.6,0-1.2,0-1.8,0,0-.9,1.7-.9,1.8,0Z" fill="#76b62e"/>
  <path d="M322.5,100.3c-.6,0-1.2,0-1.8,0,0-.9,1.7-.9,1.8,0Z" fill="#76b62e"/>
  <path d="M154.7,100.3c-.4,0-1,0-1.2,0,0-.2,0-.4,0-.6l1.2.6Z" fill="#76b62e"/>
  <path d="M333.9,100.3c-.2,0-.4,0-.6,0l.3-.6.3.6Z" fill="#76b62e"/>
  <path d="M369.8,100.3l.6-.6c-.1,0-.4.6-.6.6Z" fill="#799bc6"/>
  <path d="M336.9,273.5h11.7c1.1,0,1.5,4.3,0,5.5-2.3,1.8-13.3-.9-14.1,1.5s0,2.2,0,3.2h13.5c1.3,0,1.3,5.3-.3,6.3s-8.5.2-10.8.3c-.9,1.2,4,5.8,5.2,6.5,6.9,4.4,14.2,1.7,20.6-2.3l.6,11c-11.5,7.3-28.4,3.7-35.5-8.2-.8-1.4-2.5-5.9-3.1-6.4-2.5-1.9-6.8,1.9-6.4-3.8s4.3-2.8,4.8-3.3.2-3.4-.6-3.9-3.2.2-4-.8-.4-3.3,0-4.2c1.1-2.2,4.5-.6,5.6-1.3s1.2-3.2,1.7-4c6-10.6,15.1-15.5,27.5-14.4s11,2.3,11,5-2.1,8.7-2.6,8.8c-4.4-2.6-9-4.3-14.2-3.4s-10,4.1-10.6,8.2Z" fill="#f7d214"/>
</svg>
```


---

## `./icon-512.svg`

```svg
<?xml version="1.0" encoding="UTF-8"?>
<svg id="Livello_1" data-name="Livello 1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 468.4 464">
<path d="M4.3,118.8c11.3-9.4,27.7-7,41.7-7.2,108-1.1,216.1-.3,324.1-.6,14.3,0,34.3-.9,47.2,5,9,4.1,20.9,15.9,23.7,25.4s-.7,6.7,3.1,7.4c0-1,.1-2.1,0-3h1.2c0,3.6-1.2,6.8,0,10.2,0,.4,0,.8,0,1.2-.2,15.3-.2,30.8,0,46.1,0,3-.5,7,.6,9.6s.7.6.6,1.2c-2-.2-1.1-1.1-2-1.8-2-1.5-11.1,0-14.1-.6,0-1.9.6-5.2-1.6-5.9s-2.2-.3-2.5,0c-.6.5-1,9.1-.7,9.5s.9,0,1.2,0c.8,0,1.6,0,2.4,0h1.2c-.7,3.1-7.3.7-5.4-3.6h-120.8c-74.4,8.1-93.6,104.6-22.4,136.3,18,8,37.4,5.7,56.6,6.3,9.8.3,19.4,1.6,29.4,1.2,15.1-.6,30.6-1.3,45.5-3,8.2-1,20.1,0,28.8,0s5.9,1.4,7.5-1.2c0,.3,0,1,0,1.8l-3.6.9c-.4,26.6,1.2,53.4-1.2,80-2.2,6.1-3.6,10.3-7.2,15.6-2.7,1.3-5.9,4.7-7.2,7.2-.5.3-1.5.2-2,.5s-.3,1.2-.4,1.3c-.2.2-.4.4-.6.6-1.3-.1-1.3,0-1.2,1.2-.2,0-.4,0-.6,0-.8.4-1.5.8-2.3,1.2-1.2.6-2.9,0-2.5,1.8-.2,0-.4,0-.6,0-.5,0-1,0-1.2.6H18.7c-1.2-1.2-2.8-2-4.2-3-1.8-3.7-5.8-6.2-8.4-9.3s-1.8-4.7-4.2-5.1c-.4-1.1-.9-2.1-1.3-3.2C-.6,338.8.4,234,0,129.3c.3-3.6,2.3-7.5,4.2-10.5ZM6.2,127.4c-.9,1-1.3,3.8.8,4.1s8-1,8.9-1.3c1.3-.5,1.4-2.6.8-3.5s-9.3-.4-10.4.8ZM28.5,126c-1.5.6-1.1,4.8,0,4.8h9c1.8,0,1.8-4.8,0-4.8h-9ZM49.6,126.2c-1.7.5-2.3,3.5-1.1,4.4s8.8.5,9.4-.3.5-3.4-.3-4-7-.4-8-.1ZM68.7,126c-1.5.6-1.1,4.8,0,4.8h9c1.8,0,1.8-4.8,0-4.8h-9ZM90.9,126c-1.8.6-2,4.8-.6,4.8h9.6c1.3,0,1.3-4.8,0-4.8h-9ZM113,126c-1.5.6-1.1,4.8,0,4.8h10.8c1.3,0,1.3-4.8,0-4.8h-10.8ZM138.8,130.8c1.3.4,7.6,0,9.6,0s1.3-4.8,0-4.8h-9.6c-.2,0-.9.8-1.5.6.2,1,.6,3.9,1.5,4.2ZM173.9,126c-.5-.3-9.4,0-11.1,0s-1.3,4.8,0,4.8h10.8c1.4,0,.7-4.5.3-4.8ZM199.6,126c-.5-.3-9.4,0-11.1,0s-1.3,4.8,0,4.8h11.1c.3,0,.8-4.3,0-4.8ZM213.1,126c-1.5.6-1.1,4.8,0,4.8h10.8c1.3,0,1.3-4.8,0-4.8h-10.8ZM238.3,126c-1.5.6-1.1,4.8,0,4.8h10.8c1.3,0,1.3-4.8,0-4.8h-10.8ZM262.8,126c-1.5.6-1.1,4.8,0,4.8h10.8c1.3,0,1.3-4.8,0-4.8h-10.8ZM288,126c-1.5.6-1.1,4.8,0,4.8h10.8c1.3,0,1.3-4.8,0-4.8h-10.8ZM313.8,126c-1.5.6-1.1,4.8,0,4.8h9.6c1.3,0,1.3-4.8,0-4.8h-9.6ZM338.1,130.8c.4.3,8.9,0,10.5,0s1.3-4.8,0-4.8h-9.6c-.2,0-1.4.6-1.5,1-.1.6.5,3.7.6,3.8ZM362.9,126c-1.8.6-2,4.8-.6,4.8h10.8c1.3,0,1.3-4.8,0-4.8h-10.2ZM386.9,130.8c1.3.4,7,0,9,0s2.4-2.7.9-3.9-9.2-1.4-10.2-.6-.8,4.2.3,4.5ZM407.4,130.3c-.7.1-2,.8-2.2,1.5-.4,1.8,7.2,6.5,8.2,6.7,1.6.4,3.6-1.9,2.9-3.5s-7-5-8.9-4.7ZM421.7,144.7c-2,.7,1.3,8.7,2.1,9.7s2.5,1.5,3.6.7-.4-12.2-5.6-10.4ZM430.3,175.8v-10.5c0-1.2-4.2-1.2-4.2,0v10.5h4.2ZM430.3,184.8c-.9.2-4.4-.3-4.8,0-.9.8-.7,9.5.2,10.8s3.3.4,4.5.6v-11.4ZM430.3,358.5c-5.9-2.2-5.9,2.1-5.3,6.8s5.3,3.5,5.3,2.5v-9.3ZM430.3,390c.4-1.3,0-7,0-9s-4.2-1.9-4.7-1.4-1,9.9-.4,10.8,4.7.9,5.1-.3ZM429.6,401.8c-.5-.6-2.4-.9-3.1-.7-1.9.6-2.1,10.3-1.3,11.4s4.6,1,5-.4.2-9.3-.7-10.3ZM421.9,429.9c-.2.5-2.1.9-.9,3.6s2.7.7,3.3,0,.5-.4.6-.6c1.6-2.1,4.7-6.8,2.4-9.3-3.7-4.1-4.8,4.4-5.4,6.3ZM405.2,449.5c2.3,1.5,14.7-6.5,8.5-8.2s-9.1,4.3-9.2,5.6.4,1.8.7,2.6ZM8.5,444.8c-1.7,5.5,5.3,6.8,9.4,7.1s4.3-3.2,2.6-4.5-11.6-3.1-12-2.7ZM31.8,453.2h12.6c-.1-.8.2-4,0-4.2-.3-.3-7-.6-8.1-.6-4.5,0-5,.2-4.5,4.8ZM394.4,453.2c.2-1.1.6-1.7.2-2.9-.9-3.2-2-1.4-4.1-1.3s-7.4-.3-8,0-1,4.1.2,4.1h11.7ZM68.3,449.7c-.8-.9-11.6-1.2-11.9.3-.8,3.4,1,4.1,3.9,4.4s7.6-.2,8.1-.6.1-3.9,0-4.1ZM92.4,453.2c.1-.8.2-4.2-.9-4.2h-10.8c-1.2,0-1.2,4.2,0,4.2h11.7ZM115.1,453.2c.1-.8.2-4.2-.9-4.2h-10.5c-.2,0-1.2,4.2.3,4.2h11.1ZM138.5,453.2c.1-.8.2-4.2-.9-4.2h-10.5c-.2,0-1.2,4.2.3,4.2h11.1ZM150.5,453.2h10.5c1.2,0,1.2-4.2,0-4.2h-9.6c-1.1,0-1,3.3-.9,4.2ZM185.2,453.2c.1-.8.2-4.2-.9-4.2h-10.5v4.2h11.4ZM208.6,453.2c0-1.1.4-3.3-.6-3.9s-7.5-.4-8.8-.3c-2.8.3-2,1.8-2.1,4.2h11.4ZM232,453.2c0-1.1.4-3.3-.6-3.9s-7.5-.4-8.8-.3c-2.8.3-2,1.8-2.1,4.2h11.4ZM255.4,453.2c0-1.1.4-3.3-.6-3.9s-10-.5-10.8,0c-1.3.8-1.6,3.9-.3,3.9h11.7ZM266.7,449c0,.9-1.2,4.2.3,4.2h10.8c1.2,0,1.2-4.2,0-4.2h-11.1ZM302.1,453.2c.1-.8.2-4.2-.9-4.2h-11.1v4.2h12ZM324.3,449c-.4-.3-8.9,0-10.5,0s-1.2,4.2,0,4.2h10.5c.3,0,.7-3.7,0-4.2ZM347.6,449c-.4-.3-8.9,0-10.5,0s-1.2,4.2,0,4.2h10.5c.3,0,.7-3.7,0-4.2ZM371,453.2c0-1,.3-2.8-.3-3.6s-9.7-.8-10.8,0-.2,2.7-.3,3.7h11.4Z" fill="#12427c"/>
<path d="M420.1,463.4v.6h-1.2c.2-.6.7-.5,1.2-.6Z" fill="#799bc6"/>
<path d="M449.5,351.4c-1.6,2.6-5.3,1.2-7.5,1.2-8.7,0-20.6-.9-28.8,0-14.9,1.7-30.4,2.5-45.5,3-10,.4-19.6-.9-29.4-1.2-19.2-.6-38.6,1.7-56.6-6.3-71.2-31.7-52.1-128.1,22.4-136.3h120.8c-1.9,4.3,4.6,6.7,5.4,3.6s0-2.6,0-3.6c3,.5,12.2-.9,14.1.6s0,1.6,2,1.8,2.9-.1,3,0c.2.2-.2,5.5,0,6.6-49.5.9-99.2.4-148.8.7-67.7,11.9-68.7,109.9-.2,120.9,42.2-.4,84.6.2,126.8.6-.5,1.7-1.9,1.8-1.2,4.2,3.9.4,5-.4,3.6-4.2,8.2,0,12.4-.6,21,.6-1.1,2.6-.9,5.1-1.2,7.8Z" fill="#223159"/>
<path d="M371.6,99.7l25.8.6c11.9,1.7,20.2,4.6,29.4,12s6.4,5.4,9.6,9.6c5.2,6.8,6.1,10.4,8.4,18.6-1.7,1.8.4,1.7.6,2.2.2.8,0,2.2,0,3.2h-1.2c-1.9-12.8-15.8-29.8-27.8-34.2s-14.5-4.2-16.8-4.2h-246c0-2.4,0-4.8,0-7.2.2,0,.8,0,1.2,0,9.2-.8,20.5,0,30,0,24.2,0,48.3,0,72.5,0s24.4,0,36.6,0,6.8,0,10.2,0,.8,0,1.2,0c2.4,0,4.8,0,7.2,0s.8,0,1.2,0c1,0,2,0,3,0s2.8,0,4.2,0,1.2,0,1.8,0c2.6,0,5.2,0,7.8,0s1.2,0,1.8,0,.8,0,1.2,0,.4,0,.6,0c2.2,0,4.4,0,6.6,0,4,0,8,0,12,0,5.8,0,11.6,0,17.4,0s.5-.6.6-.6c.2,0,.4,0,.6,0s.4,0,.6,0Z" fill="#223159"/>
<path d="M153.5,100.3c0,2.4,0,4.8,0,7.2h246c2.3,0,14.1,3.2,16.8,4.2,12.1,4.4,26,21.4,27.8,34.2s0,2,0,3c-3.8-.7-2.4-5.1-3.1-7.4-2.8-9.5-14.8-21.3-23.7-25.4-12.9-5.9-32.9-5.1-47.2-5-108.1.4-216.2-.5-324.1.6-14,.1-30.4-2.3-41.7,7.2,0-1.1.8-1.7,1.5-2.4,3.6-3.7,6.7-7.1,11.1-9.6-.3,1.8.9,1.2,2.1,1.2,12-.1,24.1-.7,36.3-.6s.9.6,2,.6c31.4.3,62.8-.3,94.2,0,3.1-.4.3-7,2.1-7.8Z" fill="#799bc6"/>
<path d="M449.5,353.1c-.4,6-.5,11.9-.6,18s0,11.6,0,17.4.7,17.6,0,25.5-3.1,17.1-4.2,20.1c2.4-26.5.7-53.3,1.2-80l3.6-.9Z" fill="#799bc6"/>
<path d="M8.5,444.8c.4-.4,11.5,2.3,12,2.7,1.6,1.2,1.3,4.8-2.6,4.5s-11.1-1.6-9.4-7.1Z" fill="#e0e6ec"/>
<path d="M429.6,401.8c.8,1,1.1,8.9.7,10.3s-4.4,1.4-5,.4-.6-10.8,1.3-11.4,2.6.2,3.1.7Z" fill="#e0e6ec"/>
<path d="M68.3,449.7c.2.2.2,4,0,4.1-.4.5-6.9.7-8.1.6-2.9-.3-4.7-1-3.9-4.4s11.2-1.2,11.9-.3Z" fill="#e0e6ec"/>
<path d="M288,126h10.8c1.3,0,1.3,4.8,0,4.8h-10.8c-1.1,0-1.5-4.2,0-4.8Z" fill="#e0e6ec"/>
<path d="M262.8,126h10.8c1.3,0,1.3,4.8,0,4.8h-10.8c-1.1,0-1.5-4.2,0-4.8Z" fill="#e0e6ec"/>
<path d="M238.3,126h10.8c1.3,0,1.3,4.8,0,4.8h-10.8c-1.1,0-1.5-4.2,0-4.8Z" fill="#e0e6ec"/>
<path d="M213.1,126h10.8c1.3,0,1.3,4.8,0,4.8h-10.8c-1.1,0-1.5-4.2,0-4.8Z" fill="#e0e6ec"/>
<path d="M430.3,390c-.4,1.2-4.5,1.3-5.1.3s-.3-10.2.4-10.8,4.7-.5,4.7,1.4.4,7.7,0,9Z" fill="#e0e6ec"/>
<path d="M113,126h10.8c1.3,0,1.3,4.8,0,4.8h-10.8c-1.1,0-1.5-4.2,0-4.8Z" fill="#e0e6ec"/>
<path d="M173.9,126c.4.3,1.1,4.8-.3,4.8h-10.8c-1.3,0-1.3-4.8,0-4.8s10.6-.3,11.1,0Z" fill="#e0e6ec"/>
<path d="M199.6,126c.8.5.3,4.8,0,4.8h-11.1c-1.3,0-1.3-4.8,0-4.8s10.6-.3,11.1,0Z" fill="#e0e6ec"/>
<path d="M362.9,126h10.2c1.3,0,1.3,4.8,0,4.8h-10.8c-1.4,0-1.2-4.2.6-4.8Z" fill="#e0e6ec"/>
<path d="M430.3,184.8v11.4c-1.2-.1-3.8.5-4.5-.6s-1.1-9.9-.2-10.8,3.8.1,4.8,0Z" fill="#e0e6ec"/>
<path d="M31.8,453.2c-.5-4.6,0-4.9,4.5-4.8s7.8.3,8.1.6-.1,3.4,0,4.2h-12.6Z" fill="#e0e6ec"/>
<path d="M430.3,358.5v9.3c0,1.1-4.5,4-5.3-2.5s-.6-9.1,5.3-6.8Z" fill="#e0e6ec"/>
<path d="M338.1,130.8c-.2-.1-.8-3.2-.6-3.8.1-.4,1.4-1,1.5-1h9.6c1.3,0,1.3,4.8,0,4.8s-10,.3-10.5,0Z" fill="#e0e6ec"/>
<path d="M138.8,130.8c-.9-.3-1.3-3.2-1.5-4.2.6.1,1.3-.6,1.5-.6h9.6c1.3,0,1.3,4.8,0,4.8-2,0-8.3.4-9.6,0Z" fill="#e0e6ec"/>
<path d="M394.4,453.2h-11.7c-1.2,0-.9-3.6-.2-4.1s6.5,0,8,0c2.1,0,3.2-1.8,4.1,1.3s0,1.8-.2,2.9Z" fill="#e0e6ec"/>
<path d="M313.8,126h9.6c1.3,0,1.3,4.8,0,4.8h-9.6c-1.1,0-1.5-4.2,0-4.8Z" fill="#e0e6ec"/>
<path d="M90.9,126h9c1.3,0,1.3,4.8,0,4.8h-9.6c-1.4,0-1.2-4.2.6-4.8Z" fill="#e0e6ec"/>
<path d="M407.4,130.3c1.9-.3,8.1,3.1,8.9,4.7s-1.2,3.9-2.9,3.5-8.6-4.9-8.2-6.7c.2-.7,1.5-1.4,2.2-1.5Z" fill="#e0e6ec"/>
<path d="M68.7,126h9c1.8,0,1.8,4.8,0,4.8h-9c-1.1,0-1.5-4.2,0-4.8Z" fill="#e0e6ec"/>
<path d="M92.4,453.2h-11.7c-1.2,0-1.2-4.2,0-4.2h10.8c1.1,0,1,3.3.9,4.2Z" fill="#e0e6ec"/>
<path d="M28.5,126h9c1.8,0,1.8,4.8,0,4.8h-9c-1.1,0-1.5-4.2,0-4.8Z" fill="#e0e6ec"/>
<path d="M421.7,144.7c5.2-1.8,7.1,9.4,5.6,10.4s-2.8.4-3.6-.7-4.1-9.1-2.1-9.7Z" fill="#e0e6ec"/>
<path d="M386.9,130.8c-1.2-.4-1.3-3.8-.3-4.5s9-.4,10.2.6-.1,3.9-.9,3.9c-2,0-7.7.4-9,0Z" fill="#e0e6ec"/>
<path d="M405.2,449.5c-.3-.8-.8-1.8-.7-2.6.1-1.3,7.8-6,9.2-5.6,6.2,1.7-6.2,9.7-8.5,8.2Z" fill="#e0e6ec"/>
<path d="M266.7,449h11.1c1.2,0,1.2,4.2,0,4.2h-10.8c-1.5,0-.3-3.3-.3-4.2Z" fill="#e0e6ec"/>
<path d="M255.4,453.2h-11.7c-1.3,0-1-3.1.3-3.9s10.1-.5,10.8,0,.5,2.9.6,3.9Z" fill="#e0e6ec"/>
<path d="M302.1,453.2h-12v-4.2h11.1c1.1,0,1,3.3.9,4.2Z" fill="#e0e6ec"/>
<path d="M115.1,453.2h-11.1c-1.5,0-.5-4.2-.3-4.2h10.5c1.1,0,1,3.3.9,4.2Z" fill="#e0e6ec"/>
<path d="M6.2,127.4c1-1.2,9.5-2.1,10.4-.8s.5,3-.8,3.5-8.2,1.4-8.9,1.3c-2-.3-1.6-3.1-.8-4.1Z" fill="#e0e6ec"/>
<path d="M138.5,453.2h-11.1c-1.5,0-.5-4.2-.3-4.2h10.5c1.1,0,1,3.3.9,4.2Z" fill="#e0e6ec"/>
<path d="M324.3,449c.7.4.3,4.2,0,4.2h-10.5c-1.2,0-1.2-4.2,0-4.2s10-.3,10.5,0Z" fill="#e0e6ec"/>
<path d="M347.6,449c.7.4.3,4.2,0,4.2h-10.5c-1.2,0-1.2-4.2,0-4.2s10-.3,10.5,0Z" fill="#e0e6ec"/>
<path d="M185.2,453.2h-11.4v-4.2h10.5c1.1,0,1,3.3.9,4.2Z" fill="#e0e6ec"/>
<path d="M430.3,175.8h-4.2v-10.5c0-1.2,4.2-1.2,4.2,0v10.5Z" fill="#e0e6ec"/>
<path d="M208.6,453.2h-11.4c0-2.4-.8-3.9,2.1-4.2s8.2-.1,8.8.3c.9.7.5,2.9.6,3.9Z" fill="#e0e6ec"/>
<path d="M232,453.2h-11.4c0-2.4-.8-3.9,2.1-4.2s8.2-.1,8.8.3c.9.7.5,2.9.6,3.9Z" fill="#e0e6ec"/>
<path d="M49.6,126.2c1-.3,7.3-.3,8,.1s.8,3.2.3,4-8.6.9-9.4.3c-1.3-.9-.6-3.9,1.1-4.4Z" fill="#e0e6ec"/>
<path d="M150.5,453.2c-.1-.8-.2-4.2.9-4.2h9.6c1.2,0,1.2,4.2,0,4.2h-10.5Z" fill="#e0e6ec"/>
<path d="M371,453.2h-11.4c.2-1-.5-3.1.3-3.7s10.1-.9,10.8,0,.2,2.6.3,3.6Z" fill="#e0e6ec"/>
<path d="M430.3,211.7c0,1,.2,2.8,0,3.6h-1.2c-.5-1.7-.4-4-2.4-4.8v4.8c-.3,0-1.1,0-1.2,0-.3-.4,0-9,.7-9.5s2-.1,2.5,0c2.3.7,1.6,3.9,1.6,5.9Z" fill="#e0e6ec"/>
<path d="M445.9,203.3h-.6c-.2-15.3-.2-30.8,0-46.1,1,.6.6,2.3.6,3.3.2,14.3,0,28.6,0,42.9Z" fill="#e0e6ec"/>
<path d="M1.9,446.6c2.4.3,2.7,3.3,4.2,5.1,2.6,3.1,6.5,5.6,8.4,9.3-5.7-4-9.9-7.7-12.6-14.4Z" fill="#799bc6"/>
<path d="M424.9,432.8c-.3-2.3,2.9-5.8,1.5-7.8s-1.8-.8-2.1-.6-1.7,4.9-1.8,5.4h-.6c.6-1.9,1.7-10.4,5.4-6.3s-.8,7.2-2.4,9.3Z" fill="#799bc6"/>
<path d="M445.3,156c-1.2-3.4,0-6.6,0-10.2s.2-2.4,0-3.2-2.3-.4-.6-2.2c2,7.2.7,9,.6,15.6Z" fill="#799bc6"/>
<path d="M430.3,456.8c-.5,1.1.1,1.6-2.4,1.8,0,0-.3-.8.4-1.3s1.5-.3,2-.5c1.3-2.5,4.5-5.9,7.2-7.2-2.2,3.2-3.7,5.3-7.2,7.2Z" fill="#799bc6"/>
<path d="M422.5,429.9c-.3,2-.5,4.3,1.8,3.6-.6.7-1.5,3.8-3.3,0s.7-3.1.9-3.6h.6Z" fill="#e0e6ec"/>
<path d="M445.9,212.9c-1.1-2.6-.6-6.6-.6-9.6h.6v9.6Z" fill="#799bc6"/>
<path d="M425.5,460.4c-1.1,1.7-3,2.4-4.8,3-.4-1.8,1.4-1.3,2.5-1.8s1.5-.8,2.3-1.2Z" fill="#799bc6"/>
<path d="M427.3,459.2c-.4.5-.4.9-1.2,1.2-.1-1.3,0-1.3,1.2-1.2Z" fill="#799bc6"/>
<path d="M449.5,220.7c4,0,10.9-.5,14.6.1s3.8,3.3,4,4.7c-1,.6-.6,2.3-.6,3.3,0,4.9,0,9.8,0,14.7,0,31.9,0,63.9,0,95.9-.9,2.4-2.7,3.5-5.4,3.9s-9.8.5-11.4.3c-8.6-1.2-12.8-.5-21-.6s-1.6,0-2.4,0c-42.1-.4-84.5-1-126.8-.6-68.5-11-67.6-109,.2-120.9,49.6-.3,99.3.2,148.8-.7ZM336.9,273.5c.6-4.1,6.7-7.6,10.6-8.2s9.8.9,14.2,3.4c.5,0,2.6-7.9,2.6-8.8,0-2.7-8.6-4.7-11-5-12.4-1.1-21.5,3.8-27.5,14.4-.4.8-1.4,3.9-1.7,4-1.1.7-4.5-.9-5.6,1.3s-.6,3.5,0,4.2,3,.2,4,.8.7,3.8.6,3.9c-.6.5-4.5-1.7-4.8,3.3s3.9,1.9,6.4,3.8,2.3,5.1,3.1,6.4c7,11.9,24,15.4,35.5,8.2l-.6-11c-6.4,4-13.7,6.7-20.6,2.3-1.1-.7-6.1-5.3-5.2-6.5,2.3,0,9.3.6,10.8-.3s1.6-6.3.3-6.3h-13.5c0-1-.2-2.3,0-3.2.8-2.4,11.8.3,14.1-1.5s1-5.5,0-5.5h-11.7Z" fill="#a2486c"/>
<path d="M139.1,64.3l25-7.6c50.6-16.7,100.7-33.7,151.4-50s19.2-7.8,24.5-6.6l31,99.5c-.2,0-.4,0-.6,0l-.6.6c-5.8,0-11.6,0-17.4,0l-16.7-54.3c-9.3-3.2-14.9,1-23.4-5.9s-5.3-7.8-9.4-10.4l-152.4,50.2c-1.8-3.9-8.2-12.2-11.4-15.6Z" fill="#b9d588"/>
<path d="M54,100.3c0-.5,1-8.7,1.2-9.8,7.1-38.7,56.7-55,83.8-26.1s9.6,11.7,11.4,15.6,2.2,7.6,3,10.2,0,7.4,0,9.6,0,.4,0,.6c-1.8.8,1,7.4-2.1,7.8-31.4-.2-62.8.3-94.2,0s-1.9-.6-2-.6c.7-1.8.3-4.2,0-6.1s-1.1-.8-1.2-1.1Z" fill="#f7d214"/>
<path d="M54,100.3c0,.2,1.1.5,1.2,1.1.3,2,.7,4.3,0,6.1-12.1-.1-24.2.5-36.3.6s-2.4.5-2.1-1.2c5.5-3.1,13.5-5,19.8-5.4s11.6.8,15.6-.6.9-.9,1.8-.6Z" fill="#223159"/>
<path d="M467.5,339.4c0-31.9,0-63.9,0-95.9h.6c.3,31.3-.2,62.6,0,93.9.3.9-.4,1.5-.6,2Z" fill="#e0e6ec"/>
<path d="M397.4,100.3l-25.8-.6c8.4,0,17.6-.6,25.8.6Z" fill="#799bc6"/>
<path d="M468.1,243.5h-.6c0-4.9,0-9.8,0-14.7s-.4-2.7.6-3.3c.7,4.6,0,12.8,0,18Z" fill="#799bc6"/>
<path d="M448.9,388.5c0-5.8,0-11.6,0-17.4,1.1,4.3.7,9.6.6,14.1s.4,2.7-.6,3.3Z" fill="#e0e6ec"/>
<path d="M52.2,100.9c-4,1.4-11,.3-15.6.6,4.9-1.4,10.5-.2,15.6-.6Z" fill="#799bc6"/>
<path d="M436.3,121.8c-3.2-4.2-5.5-6.3-9.6-9.6,2.8.6,6.6,4.7,8.4,6.9s1.4,1.4,1.2,2.7Z" fill="#799bc6"/>
<path d="M429.7,343c1.4,3.8.3,4.6-3.6,4.2-.7-2.4.7-2.5,1.2-4.2.8,0,1.6,0,2.4,0Z" fill="#e0e6ec"/>
<path d="M340.4,100.3c-2.2,0-4.4,0-6.6,0l-.3-.6-.3.6c-.4,0-.8,0-1.2,0,0-.9-1.7-.9-1.8,0-2.6,0-5.2,0-7.8,0,0-.9-1.7-.9-1.8,0-1.4,0-2.8,0-4.2,0-.4-.9-2.6-.9-3,0-.4,0-.8,0-1.2,0-1.7-1-5.6-1-7.2,0-.4,0-.8,0-1.2,0-2.8-1-7.4-1-10.2,0-12.2,0-24.4,0-36.6,0-1.6-.8-1.7-2.5-2.7-3.6-9.8-11.8-29.4-17.7-44.2-14.2s-18.7,9.6-25.6,17.8c-9.4,0-20.8-.8-30,0l-1.2-.6c0-2.2.5-8.1,0-9.6,7.9-1.1,15.3-4.9,22.8-7.5,35.7-12.2,71.6-23.8,107.4-35.3,3.2-1,12.1-5,15.1-4.6s5.5,5.2,7.2,6.6c3.2,2.5,10,5.5,13.9,6.4s6.5,0,8,1.6l12.3,39.3.3,3.6Z" fill="#b9d588"/>
<path d="M352.4,100.3c-4,0-8,0-12,0l-.3-3.6-12.3-39.3c-1.5-1.6-6-1.1-8-1.6-4-1-10.7-4-13.9-6.4s-5.5-6.4-7.2-6.6c-3-.4-11.9,3.6-15.1,4.6-35.8,11.5-71.7,23.1-107.4,35.3-7.5,2.6-14.9,6.3-22.8,7.5-.8-2.6-1.8-7.6-3-10.2l152.4-50.2c4.1,2.6,5.3,7.1,9.4,10.4,8.6,6.9,14.1,2.8,23.4,5.9l16.7,54.3Z" fill="#76b62e"/>
<path d="M257.2,100.3c-24.2,0-48.3,0-72.5,0,7-8.2,14.9-15.2,25.6-17.8s34.4,2.4,44.2,14.2c.9,1.1,1.1,2.8,2.7,3.6Z" fill="#76b62e"/>
<path d="M303.9,100.3c-3.4,0-6.8,0-10.2,0,2.8-1,7.4-1,10.2,0Z" fill="#76b62e"/>
<path d="M312.3,100.3c-2.4,0-4.8,0-7.2,0,1.6-1,5.5-1,7.2,0Z" fill="#76b62e"/>
<path d="M316.5,100.3c-1,0-2,0-3,0,.4-.9,2.6-.9,3,0Z" fill="#76b62e"/>
<path d="M332.1,100.3c-.6,0-1.2,0-1.8,0,0-.9,1.7-.9,1.8,0Z" fill="#76b62e"/>
<path d="M322.5,100.3c-.6,0-1.2,0-1.8,0,0-.9,1.7-.9,1.8,0Z" fill="#76b62e"/>
<path d="M154.7,100.3c-.4,0-1,0-1.2,0,0-.2,0-.4,0-.6l1.2.6Z" fill="#76b62e"/>
<path d="M333.9,100.3c-.2,0-.4,0-.6,0l.3-.6.3.6Z" fill="#76b62e"/>
<path d="M369.8,100.3l.6-.6c-.1,0-.4.6-.6.6Z" fill="#799bc6"/>
<path d="M336.9,273.5h11.7c1.1,0,1.5,4.3,0,5.5-2.3,1.8-13.3-.9-14.1,1.5s0,2.2,0,3.2h13.5c1.3,0,1.3,5.3-.3,6.3s-8.5.2-10.8.3c-.9,1.2,4,5.8,5.2,6.5,6.9,4.4,14.2,1.7,20.6-2.3l.6,11c-11.5,7.3-28.4,3.7-35.5-8.2-.8-1.4-2.5-5.9-3.1-6.4-2.5-1.9-6.8,1.9-6.4-3.8s4.3-2.8,4.8-3.3.2-3.4-.6-3.9-3.2.2-4-.8-.4-3.3,0-4.2c1.1-2.2,4.5-.6,5.6-1.3s1.2-3.2,1.7-4c6-10.6,15.1-15.5,27.5-14.4s11,2.3,11,5-2.1,8.7-2.6,8.8c-4.4-2.6-9-4.3-14.2-3.4s-10,4.1-10.6,8.2Z" fill="#f7d214"/>
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
    "react-dom": "https://aistudiocdn.com/react-dom@^19.2.0"
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
        animation: fade-in-up 0.12s ease-out forwards;
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
        animation: fade-in-down 0.2s ease-out forwards;
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
  </head>
  <body class="bg-slate-100 overflow-hidden">
    <div id="root"></div>
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
  "name": "Copy of Gestore spese 1",
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
import React, { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { Expense, Account } from '../types';
import { getCategoryStyle } from '../utils/categoryStyles';
import { formatCurrency } from '../components/icons/formatters';
import { TrashIcon } from '../components/icons/TrashIcon';
import { HistoryFilterCard } from '../components/HistoryFilterCard';
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
  onInteractionChange: (isInteracting: boolean) => void;
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
  onInteractionChange,
}) => {
  const tapBridge = useTapBridge();
  const style = getCategoryStyle(expense.category);
  const accountName = accounts.find(a => a.id === expense.accountId)?.name || 'Sconosciuto';

  const itemRef = useRef<HTMLDivElement>(null);
  const gesture = useRef({
    id: null as number | null,
    startX: 0,
    startY: 0,
    isDragging: false,
    isHorizontal: false,
    wasHorizontal: false, // Tracks if a horizontal drag has started
    initialX: 0,
    currentX: 0,
    t0: 0,
  });

  const setX = useCallback((x: number, animate: boolean) => {
    const el = itemRef.current;
    if (!el) return;
    el.style.transition = animate ? `transform 0.25s cubic-bezier(0.1, 0.7, 0.5, 1)` : 'none';
    el.style.transform = `translateX(${x}px)`;
  }, []);

  const snapTo = useCallback((open: boolean) => {
    onInteractionChange(true);
    const targetX = open ? -ACTION_WIDTH : 0;
    setX(targetX, true);
    
    const el = itemRef.current;
    const animationFallback = setTimeout(() => {
        if (open !== isOpen) onOpen(open ? expense.id : '');
        onInteractionChange(false);
    }, 300);

    if (el) {
        const onEnd = () => {
            clearTimeout(animationFallback);
            if (open !== isOpen) onOpen(open ? expense.id : '');
            onInteractionChange(false);
            el.removeEventListener('transitionend', onEnd);
        };
        el.addEventListener('transitionend', onEnd);
    }
  }, [expense.id, isOpen, onInteractionChange, onOpen, setX]);

  // Sync with external state (isOpen)
  useEffect(() => {
    if (gesture.current.isDragging) return;
    const targetX = isOpen ? -ACTION_WIDTH : 0;
    setX(targetX, true);
  }, [isOpen, setX]);

  const handlePointerDown = (e: React.PointerEvent) => {
    tapBridge.onPointerDown(e);
    if ((e.target as HTMLElement).closest('button') || gesture.current.id !== null) return;
    if (!itemRef.current) return;

    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    const g = gesture.current;
    g.id = e.pointerId;
    g.startX = e.clientX;
    g.startY = e.clientY;
    g.isDragging = false;
    g.isHorizontal = false;
    g.wasHorizontal = false;
    g.initialX = isOpen ? -ACTION_WIDTH : 0;
    g.currentX = g.initialX;
    g.t0 = performance.now();
    
    itemRef.current.style.transition = 'none';
    onInteractionChange(true);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    tapBridge.onPointerMove(e);
    const g = gesture.current;
    if (g.id !== e.pointerId) return;

    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;

    if (!g.isDragging) {
      if (Math.hypot(dx, dy) > 8) { // Slop
        g.isDragging = true;
        g.isHorizontal = Math.abs(dx) > Math.abs(dy) * 2; // Stricter check

        if (!g.isHorizontal) {
            // Vertical scroll detected. Release capture, which will fire onPointerCancel.
            (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
            g.id = null;
            g.isDragging = false;
            return;
        }
      }
    }

    if (g.isDragging && g.isHorizontal) {
        g.wasHorizontal = true; // Mark that a horizontal drag has occurred
        if (e.cancelable) e.preventDefault();
        
        let newX = g.initialX + dx;
        
        // Clamp motion to bounds, removing the elastic effect.
        if (newX > 0) {
            newX = 0;
        } else if (newX < -ACTION_WIDTH) {
            newX = -ACTION_WIDTH;
        }

        g.currentX = newX;
        setX(newX, false);
    }
  };
  
  const handlePointerUp = (e: React.PointerEvent) => {
    tapBridge.onPointerUp(e);
    const g = gesture.current;
    if (g.id !== e.pointerId) return;

    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    g.id = null;
    
    if (!g.isDragging) { // This was a tap
      onInteractionChange(false);
      return;
    }
    
    g.isDragging = false;
    
    if (!g.wasHorizontal) {
        // If no horizontal drag occurred, it was likely a vertical scroll attempt that got cancelled.
        // The pointercancel handler would have already dealt with it, but as a fallback, we snap back.
        snapTo(isOpen);
        return;
    }
    
    const duration = Math.max(1, performance.now() - g.t0);
    const dx = e.clientX - g.startX;
    const velocity = dx / duration;
    
    // Predictive closing logic based on final position and velocity
    const predictedX = g.currentX + velocity * 150; // Predict 150ms into the future
    const shouldOpen = predictedX < -ACTION_WIDTH / 2;
    
    snapTo(shouldOpen);
  };

  const handlePointerCancel = (e: React.PointerEvent) => {
      tapBridge.onPointerCancel?.(e as any);
      const g = gesture.current;
      if (g.id !== e.pointerId) return;
      
      try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
      
      // Always snap back to a valid state on cancel to prevent getting stuck.
      snapTo(isOpen);

      g.id = null;
      g.isDragging = false;
      g.wasHorizontal = false;
  };
  
  const handleClick = () => {
    if (gesture.current.isDragging || gesture.current.wasHorizontal) return;
    onInteractionChange(false);
    if (isOpen) {
      snapTo(false);
    } else {
      onEdit(expense);
    }
  };

  return (
    <div className="relative bg-white overflow-hidden">
      {/* azioni a destra */}
      <div className="absolute top-0 right-0 h-full flex items-center z-0">
        <button
          onClick={() => onDelete(expense.id)}
          className="w-[72px] h-full flex flex-col items-center justify-center bg-red-500 text-white hover:bg-red-600 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white"
          aria-label="Elimina spesa"
          {...tapBridge}
        >
          <TrashIcon className="w-6 h-6" />
          <span className="text-xs mt-1">Elimina</span>
        </button>
      </div>

      {/* contenuto swipeable */}
      <div
        ref={itemRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onClickCapture={tapBridge.onClickCapture}
        onClick={handleClick}
        className="relative flex items-center gap-4 py-3 px-4 bg-white z-10 cursor-pointer"
        style={{ touchAction: 'pan-y', willChange: 'transform' }}
      >
        <span className={`w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center ${style.bgColor}`}>
          <style.Icon className={`w-6 h-6 ${style.color}`} />
        </span>
        <div className="flex-grow min-w-0">
          <p className="font-semibold text-slate-800 truncate">
            {expense.subcategory || style.label} • {accountName}
          </p>
          <p className="text-sm text-slate-500 truncate" title={expense.description}>
            {expense.description || 'Senza descrizione'}
          </p>
        </div>
        <p className="font-bold text-slate-900 text-lg text-right shrink-0 whitespace-nowrap min-w-[90px]">
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
  onItemStateChange: (state: { isOpen: boolean; isInteracting: boolean }) => void;
  isEditingOrDeleting: boolean;
  onNavigateHome: () => void;
  isActive: boolean;
  onDateModalStateChange: (isOpen: boolean) => void;
  isPageSwiping: boolean;
  isOverlayActive: boolean;
}

interface ExpenseGroup {
  year: number;
  week: number;
  label: string;
  expenses: Expense[];
}

const getISOWeek = (date: Date): [number, number] => {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return [d.getUTCFullYear(), Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)];
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
  onItemStateChange,
  isEditingOrDeleting,
  onNavigateHome,
  isActive,
  onDateModalStateChange,
  isPageSwiping,
  isOverlayActive,
}) => {
  const tapBridge = useTapBridge();

  const [activeFilterMode, setActiveFilterMode] = useState<ActiveFilterMode>('quick');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [customRange, setCustomRange] = useState<{ start: string | null; end: string | null }>({ start: null, end: null });

  const [periodType, setPeriodType] = useState<PeriodType>('week');
  const [periodDate, setPeriodDate] = useState<Date>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [isInteracting, setIsInteracting] = useState(false);

  const autoCloseRef = useRef<number | null>(null);
  const prevOpRef = useRef(isEditingOrDeleting);

  useEffect(() => {
    if (prevOpRef.current && !isEditingOrDeleting) setOpenItemId(null);
    prevOpRef.current = isEditingOrDeleting;
  }, [isEditingOrDeleting]);

  useEffect(() => { if (!isActive) setOpenItemId(null); }, [isActive]);

  useEffect(() => {
    onItemStateChange({ isOpen: openItemId !== null, isInteracting });
  }, [openItemId, isInteracting, onItemStateChange]);

  useEffect(() => {
    if (autoCloseRef.current) clearTimeout(autoCloseRef.current);
    if (openItemId && !isEditingOrDeleting) {
      autoCloseRef.current = window.setTimeout(() => setOpenItemId(null), 5000);
    }
    return () => { if (autoCloseRef.current) clearTimeout(autoCloseRef.current); };
  }, [openItemId, isEditingOrDeleting]);

  const filteredExpenses = useMemo(() => {
    if (activeFilterMode === 'period') {
      const start = new Date(periodDate); start.setHours(0,0,0,0);
      const end = new Date(periodDate); end.setHours(23,59,59,999);
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
      const t0 = start.getTime(); const t1 = end.getTime();
      return expenses.filter(e => {
        const d = parseLocalYYYYMMDD(e.date);
        if (isNaN(d.getTime())) return false;
        const t = d.getTime();
        return t >= t0 && t <= t1;
      });
    }

    if (activeFilterMode === 'custom' && customRange.start && customRange.end) {
      const t0 = parseLocalYYYYMMDD(customRange.start!).getTime();
      const endDay = parseLocalYYYYMMDD(customRange.end!); endDay.setDate(endDay.getDate() + 1);
      const t1 = endDay.getTime();
      return expenses.filter(e => {
        const d = parseLocalYYYYMMDD(e.date);
        if (isNaN(d.getTime())) return false;
        const t = d.getTime();
        return t >= t0 && t < t1;
      });
    }

    if (dateFilter === 'all') return expenses;

    const startDate = new Date(); startDate.setHours(0,0,0,0);
    switch (dateFilter) {
      case '7d': startDate.setDate(startDate.getDate() - 6); break;
      case '30d': startDate.setDate(startDate.getDate() - 29); break;
      case '6m': startDate.setMonth(startDate.getMonth() - 6); break;
      case '1y': startDate.setFullYear(startDate.getFullYear() - 1); break;
    }
    const t0 = startDate.getTime();
    return expenses.filter(e => { const d = parseLocalYYYYMMDD(e.date); return !isNaN(d.getTime()) && d.getTime() >= t0; });
  }, [expenses, activeFilterMode, dateFilter, customRange, periodType, periodDate]);

  const groupedExpenses = useMemo(() => {
    const sorted = [...filteredExpenses].sort((a, b) => {
      const db = parseLocalYYYYMMDD(b.date);
      const da = parseLocalYYYYMMDD(a.date);
      if (b.time) { const [h, m] = b.time.split(':').map(Number); if (!isNaN(h) && !isNaN(m)) db.setHours(h, m); }
      if (a.time) { const [h, m] = a.time.split(':').map(Number); if (!isNaN(h) && !isNaN(m)) da.setHours(h, m); }
      return db.getTime() - da.getTime();
    });

    return sorted.reduce<Record<string, ExpenseGroup>>((acc, e) => {
      const d = parseLocalYYYYMMDD(e.date);
      if (isNaN(d.getTime())) return acc;
      const [y, w] = getISOWeek(d);
      const key = `${y}-${w}`;
      if (!acc[key]) acc[key] = { year: y, week: w, label: getWeekLabel(y, w), expenses: [] };
      acc[key].expenses.push(e);
      return acc;
    }, {});
  }, [filteredExpenses]);

  const expenseGroups = (Object.values(groupedExpenses) as ExpenseGroup[]).sort(
    (a, b) => (a.year !== b.year ? b.year - a.year : b.week - a.week)
  );

  const handleOpenItem = (id: string) => setOpenItemId(id || null);
  const handleInteractionChange = (v: boolean) => setIsInteracting(v);

  return (
    <div className="h-full flex flex-col bg-slate-100" style={{ touchAction: 'pan-y' }}>
      <div
        className="flex-1 overflow-y-auto pb-36"
        style={{ touchAction: 'pan-y' }}
        onPointerDownCapture={(e) => tapBridge.onPointerDown(e)}
        onPointerMoveCapture={(e) => tapBridge.onPointerMove(e)}
        onPointerUpCapture={(e) => tapBridge.onPointerUp(e)}
        onPointerCancelCapture={(e) => tapBridge.onPointerCancel?.(e as any)}
        onClickCapture={(e) => tapBridge.onClickCapture(e as any)}
      >
        {expenseGroups.length > 0 ? (
          expenseGroups.map(group => (
            <div key={group.label} className="mb-6 last:mb-0">
              <h2 className="font-bold text-slate-800 text-lg px-4 py-2 sticky top-0 bg-slate-100/80 backdrop-blur-sm z-10">
                {group.label}
              </h2>

              <div className="bg-white rounded-xl shadow-md mx-2 overflow-hidden">
                {group.expenses.map((expense, index) => (
                  <React.Fragment key={expense.id}>
                    {index > 0 && <hr className="border-t border-slate-200 ml-16" />}
                    <ExpenseItem
                      expense={expense}
                      accounts={accounts}
                      onEdit={onEditExpense}
                      onDelete={onDeleteExpense}
                      isOpen={openItemId === expense.id}
                      onOpen={handleOpenItem}
                      onInteractionChange={handleInteractionChange}
                    />
                  </React.Fragment>
                ))}
              </div>
            </div>
          ))
        ) : (
          <div className="text-center text-slate-500 pt-20 px-6">
            <p className="text-lg font-semibold">Nessuna spesa trovata</p>
            <p className="mt-2">Prova a modificare i filtri o aggiungi una nuova spesa dalla schermata Home.</p>
          </div>
        )}
      </div>

      <HistoryFilterCard
        isActive={isActive && !isOverlayActive}
        onSelectQuickFilter={(value) => { setDateFilter(value); setActiveFilterMode('quick'); }}
        currentQuickFilter={dateFilter}
        onCustomRangeChange={(range) => { setCustomRange(range); setActiveFilterMode('custom'); }}
        currentCustomRange={customRange}
        isCustomRangeActive={activeFilterMode === 'custom'}
        onDateModalStateChange={onDateModalStateChange}
        periodType={periodType}
        periodDate={periodDate}
        onSelectPeriodType={(type) => {
          setPeriodType(type);
          setPeriodDate(() => { const d = new Date(); d.setHours(0,0,0,0); return d; });
          setActiveFilterMode('period');
        }}
        onSetPeriodDate={setPeriodDate}
        isPeriodFilterActive={activeFilterMode === 'period'}
        onActivatePeriodFilter={() => setActiveFilterMode('period')}
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

// helper snooze/lock dal service (li importo a runtime per evitare cicli in build)
type BioHelpers = {
  isBiometricSnoozed: () => boolean;
  setBiometricSnooze: () => void;
  clearBiometricSnooze: () => void;
};

// lock di sessione per evitare doppio avvio (StrictMode / re-render)
const BIO_AUTOPROMPT_LOCK_KEY = 'bio.autoprompt.lock';
const hasAutoPromptLock = () => {
  try { return sessionStorage.getItem(BIO_AUTOPROMPT_LOCK_KEY) === '1'; } catch { return false; }
};
const setAutoPromptLock = () => { try { sessionStorage.setItem(BIO_AUTOPROMPT_LOCK_KEY, '1'); } catch {} };

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
  const [activeEmail, setActiveEmail] = useLocalStorage<string | null>('last_active_user_email', null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // biometria
  const [bioSupported, setBioSupported] = useState(false);
  const [bioEnabled, setBioEnabled] = useState(false);
  const [showEnableBox, setShowEnableBox] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);
  const autoStartedRef = useRef(false);

  // verifica stato biometria quando entri nella schermata PIN
  useEffect(() => {
    let mounted = true;
    (async () => {
      const supported = await isBiometricsAvailable();
      const enabled = isBiometricsEnabled();
      const offer = await shouldOfferBiometricEnable();
      if (!mounted) return;
      setBioSupported(supported);
      setBioEnabled(enabled);
      setShowEnableBox(offer);
    })();
    return () => { mounted = false; };
  }, [activeEmail]);

  // Autoprompt biometrico: 1 solo tentativo totale per sessione.
  // Gli "altri 2 tentativi" li gestisce il foglio di sistema dentro lo stesso prompt.
  useEffect(() => {
    if (!activeEmail) return;
    if (!bioSupported || !bioEnabled) return;
    if (autoStartedRef.current) return;
    if (hasAutoPromptLock()) return;

    autoStartedRef.current = true;
    setAutoPromptLock(); // blocca eventuale secondo run (StrictMode)

    (async () => {
      const { isBiometricSnoozed, setBiometricSnooze, clearBiometricSnooze } =
        (await import('../services/biometrics')) as unknown as BioHelpers;

      if (isBiometricSnoozed()) return;

      try {
        setBioBusy(true);
        const ok = await unlockWithBiometric('Sblocca con impronta / FaceID'); // timeout 60s gestisce retry interno
        setBioBusy(false);
        if (ok) {
          clearBiometricSnooze();
          onLoginSuccess('biometric-local', activeEmail);
        }
      } catch (err: any) {
        setBioBusy(false);
        // Qualsiasi annullo/timeout/chiusura: metti in snooze e non ripresentare
        const name = err?.name || '';
        const msg  = String(err?.message || '');
        if (name === 'NotAllowedError' || name === 'AbortError' || /timeout/i.test(msg)) {
          setBiometricSnooze();
        }
        // resta su PIN, nessun altro prompt automatico
      }
    })();
  }, [activeEmail, bioSupported, bioEnabled, onLoginSuccess]);

  // Verifica PIN
  useEffect(() => {
    if (pin.length === 4 && activeEmail) {
      handlePinVerify();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, activeEmail]);

  const handleEmailSubmit = (email: string) => {
    if (email) {
      setActiveEmail(email.toLowerCase());
      setError(null);
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

  // Abilita ora (box interno) — tenta 1 prompt manuale; se annulla, niente ripresentazione
  const enableBiometricsNow = async () => {
    try {
      setBioBusy(true);
      await registerBiometric('Profilo locale');
      setBioEnabled(true);
      setShowEnableBox(false);
      setBioBusy(false);

      // Tentativo manuale singolo subito dopo l’abilitazione
      try {
        const { clearBiometricSnooze, setBiometricSnooze } =
          (await import('../services/biometrics')) as unknown as BioHelpers;
        clearBiometricSnooze(); // consenti il prompt adesso
        const ok = await unlockWithBiometric('Sblocca con impronta / FaceID');
        if (ok && activeEmail) {
          onLoginSuccess('biometric-local', activeEmail);
          return;
        }
      } catch (err: any) {
        const name = err?.name || '';
        const msg  = String(err?.message || '');
        if (name === 'NotAllowedError' || name === 'AbortError' || /timeout/i.test(msg)) {
          const { setBiometricSnooze } =
            (await import('../services/biometrics')) as unknown as BioHelpers;
          setBiometricSnooze();
        }
        // resta su PIN
      }
    } catch {
      setBioBusy(false);
      // se annulla in registrazione, resta tutto com’è
    }
  };

  // Non ora (non riproporre il box)
  const denyBiometricsOffer = () => {
    setBiometricsOptOut(true);
    setShowEnableBox(false);
  };

  const handleSwitchUser = () => {
    setActiveEmail(null);
    setPin('');
    setError(null);
    autoStartedRef.current = false;
    // non resetto il lock: in questa sessione niente altro auto-prompt
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
            error || (bioEnabled && bioSupported ? 'Puoi anche usare l’impronta.' : 'Inserisci il tuo PIN di 4 cifre.')
          )}
        </p>

        <PinInput pin={pin} onPinChange={setPin} />

        {/* Box abilitazione biometria (solo se disponibile, non abilitata, non opt-out) */}
        {showEnableBox && (
          <div className="mt-4 p-3 rounded-lg border border-slate-200 bg-slate-50 text-left">
            <p className="text-sm text-slate-700">
              Vuoi abilitare lo sblocco con impronta / FaceID su questo dispositivo?
            </p>
            <div className="flex gap-3 mt-2">
              <button
                onClick={enableBiometricsNow}
                disabled={bioBusy}
                className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-indigo-300"
              >
                {bioBusy ? 'Attivo…' : 'Abilita ora'}
              </button>
              <button
                onClick={denyBiometricsOffer}
                disabled={bioBusy}
                className="px-4 py-2 text-sm font-semibold text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-100"
              >
                Non ora
              </button>
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-col sm:flex-row justify-between items-center gap-2">
          <button
            onClick={handleSwitchUser}
            className="text-sm font-semibold text-slate-500 hover:text-slate-800"
          >
            Cambia Utente
          </button>
          <div className="flex gap-4">
            <button
              onClick={onGoToForgotPassword}
              className="text-sm font-semibold text-indigo-600 hover:text-indigo-500"
            >
              PIN Dimenticato?
            </button>
          </div>
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
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Expense, Account } from '../types';
import { getCategoryStyle } from '../utils/categoryStyles';
import { formatCurrency } from '../components/icons/formatters';
import { ArrowLeftIcon } from '../components/icons/ArrowLeftIcon';
import { TrashIcon } from '../components/icons/TrashIcon';
import { CalendarDaysIcon } from '../components/icons/CalendarDaysIcon';
import ConfirmationModal from '../components/ConfirmationModal';
import { useTapBridge } from '../hooks/useTapBridge';

const ACTION_WIDTH = 72;

const recurrenceLabels: Record<string, string> = {
  daily: 'Ogni Giorno',
  weekly: 'Ogni Settimana',
  monthly: 'Ogni Mese',
  yearly: 'Ogni Anno',
};

const getRecurrenceSummary = (expense: Expense): string => {
    if (expense.frequency !== 'recurring' || !expense.recurrence) {
        return 'Non ricorrente';
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
}> = ({ expense, accounts, onEdit, onDeleteRequest, isOpen, onOpen }) => {
    const style = getCategoryStyle(expense.category);
    const accountName = accounts.find(a => a.id === expense.accountId)?.name || 'Sconosciuto';
    const itemRef = useRef<HTMLDivElement>(null);
    const tapBridge = useTapBridge();

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
        setTranslateX(isOpen ? -ACTION_WIDTH : 0, true);
      }
    }, [isOpen, setTranslateX]);

    const handlePointerDown = (e: React.PointerEvent) => {
      tapBridge.onPointerDown(e);
      if ((e.target as HTMLElement).closest('button') || !itemRef.current) return;
      
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
      tapBridge.onPointerMove(e);
      const ds = dragState.current;
      if (ds.pointerId !== e.pointerId) return;

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
      tapBridge.onPointerUp(e);
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
      tapBridge.onPointerCancel?.(e as any);
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
        if (isOpen) {
            onOpen('');
        } else {
            onEdit(expense);
        }
    };

    return (
        <div className="relative bg-white overflow-hidden">
            <div className="absolute top-0 right-0 h-full flex items-center z-0">
                <button
                    onClick={() => onDeleteRequest(expense.id)}
                    className="w-[72px] h-full flex flex-col items-center justify-center bg-red-500 text-white hover:bg-red-600 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white"
                    aria-label="Elimina spesa ricorrente"
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
                onClickCapture={tapBridge.onClickCapture}
                onClick={handleClick}
                className="relative flex items-center gap-4 py-3 px-4 bg-white z-10 cursor-pointer"
                style={{ touchAction: 'pan-y' }}
            >
                <span className={`w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center ${style.bgColor}`}>
                    <style.Icon className={`w-6 h-6 ${style.color}`} />
                </span>
                <div className="flex-grow min-w-0">
                    <p className="font-semibold text-slate-800 truncate">{expense.description || 'Senza descrizione'}</p>
                    <p className="text-sm text-slate-500 truncate">{getRecurrenceSummary(expense)} • {accountName}</p>
                </div>
                <p className="font-bold text-slate-900 text-lg text-right shrink-0 whitespace-nowrap min-w-[90px]">{formatCurrency(Number(expense.amount) || 0)}</p>
            </div>
        </div>
    );
};

interface RecurringExpensesScreenProps {
  recurringExpenses: Expense[];
  accounts: Account[];
  onClose: () => void;
  onEdit: (expense: Expense) => void;
  onDelete: (id: string) => void;
}

const RecurringExpensesScreen: React.FC<RecurringExpensesScreenProps> = ({ recurringExpenses, accounts, onClose, onEdit, onDelete }) => {
  const [isAnimatingIn, setIsAnimatingIn] = useState(false);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [expenseToDeleteId, setExpenseToDeleteId] = useState<string | null>(null);
  const [isConfirmDeleteModalOpen, setIsConfirmDeleteModalOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsAnimatingIn(true), 10);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!isAnimatingIn && openItemId) {
      setOpenItemId(null);
    }
  }, [isAnimatingIn, openItemId]);

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
  
  const sortedExpenses = [...recurringExpenses].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return (
    <div 
      className={`fixed inset-0 z-50 bg-slate-100 transform transition-transform duration-300 ease-in-out ${isAnimatingIn ? 'translate-x-0' : 'translate-x-full'}`}
      style={{ touchAction: 'pan-y' }}
    >
      <header className="sticky top-0 z-20 flex items-center gap-4 p-4 bg-white/80 backdrop-blur-sm shadow-sm">
        <button onClick={handleClose} className="p-2 rounded-full hover:bg-slate-200 transition-colors" aria-label="Indietro">
          <ArrowLeftIcon className="w-6 h-6 text-slate-700" />
        </button>
        <h1 className="text-xl font-bold text-slate-800">Spese Ricorrenti</h1>
      </header>
      <main className="overflow-y-auto h-[calc(100%-68px)] p-2" style={{ touchAction: 'pan-y' }}>
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
                        />
                    </React.Fragment>
                ))}
            </div>
        ) : (
          <div className="text-center text-slate-500 pt-20 px-6">
            <CalendarDaysIcon className="w-16 h-16 mx-auto text-slate-400" />
            <p className="text-lg font-semibold mt-4">Nessuna spesa ricorrente</p>
            <p className="mt-2">Puoi creare una spesa ricorrente quando aggiungi una nuova spesa.</p>
          </div>
        )}
      </main>

      {/* Modal di conferma eliminazione - renderizzato dentro questo componente */}
      <ConfirmationModal 
        isOpen={isConfirmDeleteModalOpen}
        onClose={cancelDelete}
        onConfirm={confirmDelete}
        title="Conferma Eliminazione"
        message={<>Sei sicuro di voler eliminare questa spesa ricorrente? <br/>Le spese già generate non verranno cancellate.</>}
        variant="danger"
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

if (!process.env.API_KEY) {
    // In a real app, you'd want to handle this more gracefully.
    // For this context, we assume the key is set.
    console.error("API_KEY environment variable is not set");
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });

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

export function createBlob(data: Float32Array): Blob {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    int16[i] = data[i] * 32768;
  }
  return {
    data: encode(new Uint8Array(int16.buffer)),
    mimeType: 'audio/pcm;rate=16000',
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
