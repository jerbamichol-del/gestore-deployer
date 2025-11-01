# CATALOG_MAIN (testo)
Questo file contiene i sorgenti *testuali* di `gestore@main` (solo estensioni note, max 200 KB/file).  


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


const App: React.FC<{ onLogout: () => void }> = ({ onLogout }) => {
  const [expenses, setExpenses] = useLocalStorage<Expense[]>('expenses_v2', []);
  const [accounts, setAccounts] = useLocalStorage<Account[]>('accounts_v1', DEFAULT_ACCOUNTS);
  const [activeView, setActiveView] = useState<NavView>('home');
  
  // Modal States
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isCalculatorContainerOpen, setIsCalculatorContainerOpen] = useState(false);
  const [isImageSourceModalOpen, setIsImageSourceModalOpen] = useState(false);
  const [isVoiceModalOpen, setIsVoiceModalOpen] = useState(false);
  const [isConfirmDeleteModalOpen, setIsConfirmDeleteModalOpen] = useState(false);
  const [isMultipleExpensesModalOpen, setIsMultipleExpensesModalOpen] = useState(false);
  const [isParsingImage, setIsParsingImage] = useState(false);
  const [isDateModalOpen, setIsDateModalOpen] = useState(false);
  
  // Data for Modals
  const [editingExpense, setEditingExpense] = useState<Expense | undefined>(undefined);
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
  const [isHistoryItemOpen, setIsHistoryItemOpen] = useState(false);
  const [isHistoryItemInteracting, setIsHistoryItemInteracting] = useState(false);
  const [showSuccessIndicator, setShowSuccessIndicator] = useState(false);
  const successIndicatorTimerRef = useRef<number | null>(null);

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
    setActiveView(targetView);
    window.history.pushState({ view: targetView }, '');
  }, [activeView]);

  // Back button handling logic
  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
        event.preventDefault();

        // Always push a new state to re-enable our listener for the next back press
        const pushStateAfterHandling = () => window.history.pushState({ view: activeView }, '');

        // Priorità 1: Chiudere le modali aperte
        if (!!imageForAnalysis) {
            setImageForAnalysis(null); // Chiude la modale di analisi
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

        // Priorità 2: Tornare alla Home se non ci siamo già
        if (activeView !== 'home') {
            handleNavigation('home');
            // handleNavigation already pushes state
            return;
        }

        // Priorità 3: Uscire dall'app se si è in Home
        if (backPressExitTimeoutRef.current) {
            clearTimeout(backPressExitTimeoutRef.current);
            backPressExitTimeoutRef.current = null;
            window.close(); // Tenta di chiudere la PWA
        } else {
            showToast({ message: 'Premi di nuovo per uscire.', type: 'info' });
            backPressExitTimeoutRef.current = window.setTimeout(() => {
                backPressExitTimeoutRef.current = null;
            }, 2000);
            pushStateAfterHandling();
        }
    };
    
    // Setup initial history state
    window.history.pushState({ view: 'home' }, '');
    window.addEventListener('popstate', handlePopState);

    return () => {
        window.removeEventListener('popstate', handlePopState);
        if (backPressExitTimeoutRef.current) {
            clearTimeout(backPressExitTimeoutRef.current);
        }
    };
}, [
    activeView, handleNavigation, showToast,
    isCalculatorContainerOpen, isFormOpen, isImageSourceModalOpen,
    isVoiceModalOpen, isConfirmDeleteModalOpen, isMultipleExpensesModalOpen,
    imageForAnalysis
]);


  const swipeContainerRef = useRef<HTMLDivElement>(null);
  
  const handleNavigateHome = useCallback(() => {
    if (activeView === 'history') {
        handleNavigation('home');
    }
  }, [activeView, handleNavigation]);

  const { progress, isSwiping } = useSwipe(
    swipeContainerRef,
    {
      onSwipeLeft: activeView === 'home' ? () => handleNavigation('history') : undefined,
      onSwipeRight: activeView === 'history' ? handleNavigateHome : undefined,
    },
    { 
      enabled: !isCalculatorContainerOpen && !isHistoryItemInteracting && !isDateModalOpen,
      threshold: 32,
      slop: 6,
      ignoreSelector: '[data-swipeable-item="true"]',
    }
  );
  
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
    if (!installPromptEvent) {
        return;
    }
    installPromptEvent.prompt();
    const { outcome } = await installPromptEvent.userChoice;
    setInstallPromptEvent(null);
    if (outcome === 'accepted') {
        showToast({ message: 'App installata!', type: 'success' });
    } else {
        showToast({ message: 'Installazione annullata.', type: 'info' });
    }
};

  // Funzione per caricare le immagini in coda e gestire le notifiche
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
    // Ascolta eventi 'storage' per aggiornare se un'altra scheda (come lo share-target) modifica IndexedDB
    const handleStorageChange = () => {
        refreshPendingImages();
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [refreshPendingImages]);

  // Sincronizzazione automatica quando si torna online
  useEffect(() => {
    // Mostra la notifica "Sei online!" solo quando si passa da offline a online.
    if (prevIsOnlineRef.current === false && isOnline && pendingImages.length > 0) {
      showToast({ message: `Sei online! ${pendingImages.length} immagini in attesa.`, type: 'info' });
    }
    // Aggiorna lo stato online precedente per il prossimo render.
    prevIsOnlineRef.current = isOnline;
  }, [isOnline, pendingImages.length, showToast]);

  const addExpense = (newExpense: Omit<Expense, 'id'>) => {
    const expenseWithId: Expense = {
      ...newExpense,
      id: crypto.randomUUID(),
    };
    setExpenses(prev => [expenseWithId, ...prev]);
    triggerSuccessIndicator();
  };

  const updateExpense = (updatedExpense: Expense) => {
    setExpenses(prev => prev.map(e => e.id === updatedExpense.id ? updatedExpense : e));
    triggerSuccessIndicator();
  };
  
  const handleFormSubmit = (data: Omit<Expense, 'id'> | Expense) => {
      if ('id' in data) {
          updateExpense(data);
      } else {
          addExpense(data);
      }
      setIsFormOpen(false);
      setIsCalculatorContainerOpen(false);
      setEditingExpense(undefined);
      setPrefilledData(undefined);
  };
  
  const handleMultipleExpensesSubmit = (expensesToAdd: Omit<Expense, 'id'>[]) => {
      const expensesWithIds: Expense[] = expensesToAdd.map(exp => ({
          ...exp,
          id: crypto.randomUUID(),
      }));
      setExpenses(prev => [...expensesWithIds, ...prev]);
      setIsMultipleExpensesModalOpen(false);
      setMultipleExpensesData([]);
      triggerSuccessIndicator();
  };

  const openEditForm = (expense: Expense) => {
    setEditingExpense(expense);
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
      showToast({ message: 'Spesa eliminata.', type: 'info' });
    }
  };

  const handleImagePick = async (source: 'camera' | 'gallery') => {
    setIsImageSourceModalOpen(false);
    sessionStorage.setItem('preventAutoLock', 'true');
    try {
        const file = await pickImage(source);
        const base64Image = await fileToBase64(file);
        const newImage: OfflineImage = {
            id: crypto.randomUUID(),
            base64Image,
            mimeType: file.type,
        };

        if (isOnline) {
            setImageForAnalysis(newImage);
        } else {
            await addImageToQueue(newImage);
            refreshPendingImages();
        }
    } catch (error) {
        if (error instanceof Error && error.message.includes('annullata')) {
             // L'utente ha annullato, non mostrare errore
        } else {
            console.error('Errore selezione immagine:', error);
            showToast({ message: 'Errore durante la selezione dell\'immagine.', type: 'error' });
        }
    } finally {
        setTimeout(() => sessionStorage.removeItem('preventAutoLock'), 2000); // safety clear
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
              showToast({ message: 'Nessuna spesa trovata nell\'immagine.', type: 'info' });
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
          console.error('Error durante l\'analisi AI:', error);
          showToast({ message: 'Errore durante l\'analisi dell\'immagine.', type: 'error' });
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
  
  const handleHistoryItemStateChange = useCallback(({ isOpen, isInteracting }: { isOpen: boolean; isInteracting: boolean; }) => {
    setIsHistoryItemOpen(isOpen);
    setIsHistoryItemInteracting(isInteracting);
  }, []);

  const isEditingOrDeletingInHistory = (isFormOpen && !!editingExpense) || isConfirmDeleteModalOpen;

  const mainContentClasses = isCalculatorContainerOpen
    ? 'pointer-events-none'
    : '';
  
  const baseTranslatePercent = activeView === 'home' ? 0 : -50;
  const dragTranslatePercent = progress * 50;
  const viewTranslate = baseTranslatePercent + dragTranslatePercent;

  const isAnyModalOpen = isFormOpen || 
    isImageSourceModalOpen || 
    isVoiceModalOpen || 
    isConfirmDeleteModalOpen || 
    isMultipleExpensesModalOpen || 
    isDateModalOpen || 
    isParsingImage ||
    !!imageForAnalysis;

  const fabStyle: React.CSSProperties = {
    transform: activeView === 'history' ? 'translateY(-70px)' : 'translateY(0)',
    opacity: isAnyModalOpen ? 0 : 1,
    visibility: isAnyModalOpen ? 'hidden' : 'visible',
    pointerEvents: isAnyModalOpen ? 'none' : 'auto',
    transition: `transform 0.25s cubic-bezier(0.22, 0.61, 0.36, 1), opacity 0.2s ease-out, visibility 0s linear ${isAnyModalOpen ? '0.2s' : '0s'}`
  };

  return (
    <div className="h-full w-full bg-slate-100 flex flex-col font-sans overflow-hidden">
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
                  transition: isSwiping ? 'none' : 'transform 0.12s ease-out',
                }}
            >
                <div className="w-1/2 h-full overflow-y-auto space-y-6 swipe-view" style={{ touchAction: 'pan-y' }}>
                    <Dashboard expenses={expenses} onLogout={onLogout} />
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
        />
      
        <ExpenseForm 
            isOpen={isFormOpen}
            onClose={() => { setIsFormOpen(false); setEditingExpense(undefined); setPrefilledData(undefined); }}
            onSubmit={handleFormSubmit}
            initialData={editingExpense}
            prefilledData={prefilledData}
            accounts={accounts}
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
import ForgotEmailScreen from './screens/ForgotEmailScreen';
import ResetPinScreen from './screens/ResetPinScreen';
import { useLocalStorage } from './hooks/useLocalStorage';

type AuthView = 'login' | 'register' | 'forgotPassword' | 'forgotEmail' | 'forgotPasswordSuccess';
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
    case 'forgotEmail':
        return <ForgotEmailScreen onBackToLogin={() => setAuthView('login')} />;
    case 'login':
    default:
      return (
        <LoginScreen 
            onLoginSuccess={handleAuthSuccess}
            onGoToRegister={() => setAuthView('register')}
            onGoToForgotPassword={() => setAuthView('forgotPassword')}
            onGoToForgotEmail={() => setAuthView('forgotEmail')}
        />
      );
  }
};

export default AuthGate;
```


---

## `./README.md`

```md
<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1ecn6scFuueWaqb2n8y67kBpJgek-6qHG

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

```


---

## `./components/BottomNavigationBar.tsx`

```tsx

```


---

## `./components/CalculatorContainer.tsx`

```tsx
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
  expenses: Expense[];
  onEditExpense: (expense: Expense) => void;
  onDeleteExpense: (id: string) => void;
}

// Hook per media query
const useMediaQuery = (query: string) => {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(query);
    if (media.matches !== matches) {
      setMatches(media.matches);
    }
    const listener = () => setMatches(media.matches);
    window.addEventListener('resize', listener);
    return () => window.removeEventListener('resize', listener);
  }, [matches, query]);
  return matches;
};

const getCurrentTime = () => new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

const CalculatorContainer: React.FC<CalculatorContainerProps> = ({
  isOpen,
  onClose,
  onSubmit,
  accounts,
}) => {
  const [isAnimating, setIsAnimating] = useState(false);
  const [view, setView] = useState<'calculator' | 'details'>('calculator');
  
  const resetFormData = useCallback(() => ({
    amount: 0,
    description: '',
    date: new Date().toISOString().split('T')[0],
    time: getCurrentTime(),
    accountId: accounts.length > 0 ? accounts[0].id : '',
    category: 'Altro',
    subcategory: undefined,
    frequency: undefined,
    recurrence: undefined,
    recurrenceInterval: 1,
    recurrenceEndType: undefined,
    recurrenceEndDate: undefined,
    recurrenceCount: undefined,
  }), [accounts]);

  const [formData, setFormData] = useState<Partial<Omit<Expense, 'id'>>>(resetFormData);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const isDesktop = useMediaQuery('(min-width: 768px)');
  
  const containerRef = useRef<HTMLDivElement>(null);
  const swipeableDivRef = useRef<HTMLDivElement>(null);

  const { progress, isSwiping } = useSwipe(
    containerRef,
    {
      onSwipeLeft: view === 'calculator' ? () => navigateTo('details') : undefined,
      onSwipeRight: view === 'details' ? () => navigateTo('calculator') : undefined,
    },
    { enabled: !isDesktop && isOpen && !isMenuOpen, threshold: 32, slop: 6 }
  );
  
  useEffect(() => {
    if (isOpen) {
      setView('calculator');
      const timer = setTimeout(() => setIsAnimating(true), 10);
      return () => clearTimeout(timer);
    } else {
      setIsAnimating(false);
      // BUG FIX: Reset the form state reliably *after* the closing animation completes.
      // This prevents flickering by ensuring the component is pristine before it's shown again.
      const resetTimer = setTimeout(() => {
        setFormData(resetFormData());
      }, 300); // Matches the transition duration
      return () => clearTimeout(resetTimer);
    }
  }, [isOpen, resetFormData]);
  
  const handleClose = () => {
    setIsAnimating(false);
    setTimeout(onClose, 300);
  };

  const handleFormChange = (newData: Partial<Omit<Expense, 'id'>>) => {
    setFormData(prev => ({...prev, ...newData}));
  };
  
  const handleFinalSubmit = (data: Omit<Expense, 'id'>) => {
    onSubmit(data);
  };

  const navigateTo = (targetView: 'calculator' | 'details') => {
      setView(targetView);
  };
  
  if (!isOpen) {
    return null;
  }
  
  const translateX = (view === 'calculator' ? 0 : -50) + (progress * 50);

  return (
    <div
      className={`fixed inset-0 z-50 bg-slate-100 transform transition-transform duration-300 ease-in-out ${
        isAnimating ? 'translate-y-0' : 'translate-y-full'
      }`}
      aria-modal="true"
      role="dialog"
    >
      <div
        ref={containerRef}
        className="relative h-full w-full overflow-hidden"
        style={{ touchAction: 'pan-y' }}
      >
        <div
          ref={swipeableDivRef}
          className="absolute inset-0 flex w-[200%] md:w-full md:grid md:grid-cols-2"
          style={{
            transform: isDesktop ? 'none' : `translateX(${translateX}%)`,
            transition: isSwiping ? 'none' : 'transform 0.12s ease-out',
            willChange: 'transform',
          }}
        >
          <div className="w-1/2 md:w-auto h-full relative">
            <CalculatorInputScreen
              formData={formData}
              onFormChange={handleFormChange}
              onClose={handleClose}
              onSubmit={handleFinalSubmit}
              accounts={accounts}
              onNavigateToDetails={() => navigateTo('details')}
              onMenuStateChange={setIsMenuOpen}
              isDesktop={isDesktop}
              isVisible={view === 'calculator' || isDesktop}
            />
          </div>
          <div className="w-1/2 md:w-auto h-full relative">
              <TransactionDetailPage
                formData={formData}
                onFormChange={handleFormChange}
                accounts={accounts}
                onClose={() => navigateTo('calculator')}
                onSubmit={handleFinalSubmit}
                isDesktop={isDesktop}
                isVisible={view === 'details' || isDesktop}
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
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Expense, Account, CATEGORIES } from '../types';
import { XMarkIcon } from './icons/XMarkIcon';
import { CheckIcon } from './icons/CheckIcon';
import { BackspaceIcon } from './icons/BackspaceIcon';
import SelectionMenu from './SelectionMenu';
import { getCategoryStyle } from '../utils/categoryStyles';
import { ChevronLeftIcon } from './icons/ChevronLeftIcon';
import SmoothPullTab from './SmoothPullTab';

interface CalculatorInputScreenProps {
  onClose: () => void;
  onSubmit: (data: Omit<Expense, 'id'>) => void;
  accounts: Account[];
  onNavigateToDetails: () => void;
  isVisible: boolean;
  formData: Partial<Omit<Expense, 'id'>>;
  onFormChange: (newData: Partial<Omit<Expense, 'id'>>) => void;
  onMenuStateChange: (isOpen: boolean) => void;
  isDesktop: boolean;
}

const formatAmountForDisplay = (numStr: string): string => {
  let sanitizedStr = String(numStr || '0').replace('.', ',');
  let [integerPart, decimalPart] = sanitizedStr.split(',');
  if (integerPart === '') integerPart = '0';
  const formattedIntegerPart = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  if (decimalPart !== undefined) return `${formattedIntegerPart},${decimalPart}`;
  return formattedIntegerPart;
};

const getAmountFontSize = (value: string): string => {
  const len = value.length;
  if (len <= 4) return 'text-9xl';
  if (len <= 6) return 'text-8xl';
  if (len <= 8) return 'text-7xl';
  if (len <= 11) return 'text-6xl';
  return 'text-5xl';
};

const CalculatorInputScreen: React.FC<CalculatorInputScreenProps> = ({
  onClose, onSubmit, accounts, onNavigateToDetails, isVisible,
  formData, onFormChange, onMenuStateChange, isDesktop
}) => {
  const [currentValue, setCurrentValue] = useState('0');
  const [previousValue, setPreviousValue] = useState<string | null>(null);
  const [operator, setOperator] = useState<string | null>(null);
  const [shouldResetCurrentValue, setShouldResetCurrentValue] = useState(false);
  const [justCalculated, setJustCalculated] = useState(false);
  const [activeMenu, setActiveMenu] = useState<'account' | 'category' | 'subcategory' | null>(null);

  useEffect(() => {
    onMenuStateChange(activeMenu !== null);
  }, [activeMenu, onMenuStateChange]);

  useEffect(() => {
    const parentAmount = formData.amount || 0;
    // FIX: Correctly parse the displayed value, removing thousand separators, to prevent incorrect comparisons.
    const currentDisplayAmount = parseFloat(currentValue.replace(/\./g, '').replace(',', '.')) || 0;

    // To prevent feedback loops and display jitters (e.g., "12,3" vs "12,30"),
    // only sync from the parent if the numeric values are meaningfully different.
    if (Math.abs(parentAmount - currentDisplayAmount) > 1e-9) {
        setCurrentValue(String(parentAmount).replace('.', ','));
    }

    // When a new expense starts, the parent resets amount to 0. We use this
    // as a signal to reset the calculator's internal operation state.
    if (formData.amount === 0 || !formData.amount) {
        setPreviousValue(null);
        setOperator(null);
        setShouldResetCurrentValue(false);
        setJustCalculated(false);
    }
  }, [formData.amount]);


  useEffect(() => {
    const newAmount = parseFloat(currentValue.replace(/\./g, '').replace(',', '.'));
    // FIX: Use a numeric comparison with tolerance to avoid loops from floating point inaccuracies.
    if (!isNaN(newAmount) && Math.abs((formData.amount || 0) - newAmount) > 1e-9) {
      onFormChange({ amount: newAmount });
    }
  }, [currentValue, onFormChange, formData.amount]);
  
  const handleClearAmount = useCallback(() => {
    setCurrentValue('0');
    setJustCalculated(false);
  }, []);

  const handleSingleBackspace = useCallback(() => {
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
      const newStr = valNoDots.length > 1 ? valNoDots.slice(0, -1) : '0';
      return newStr;
    });
  }, [justCalculated, shouldResetCurrentValue, handleClearAmount]);

  // --- Long-press solo per ⌫ ---
  const delTimerRef = useRef<number | null>(null);
  const delDidLongRef = useRef(false);
  const delStartXRef = useRef(0);
  const delStartYRef = useRef(0);

  const DEL_HOLD_MS = 450;   // durata long-press
  const DEL_SLOP_PX = 8;     // movimento massimo consentito

  function clearDelTimer() {
    if (delTimerRef.current !== null) {
      window.clearTimeout(delTimerRef.current);
      delTimerRef.current = null;
    }
  }

  // Fix: Changed event handler types from HTMLButtonElement to HTMLDivElement to match the KeypadButton component which is a div.
  /** PARTENZA: avvia timer in capture, prima che lo swipe del parent faccia setPointerCapture */
  const onDelPointerDownCapture: React.PointerEventHandler<HTMLDivElement> = (e) => {
    delDidLongRef.current = false;
    delStartXRef.current = e.clientX ?? 0;
    delStartYRef.current = e.clientY ?? 0;

    // cattura locale (se possibile) per continuare a ricevere eventi anche se esci di pochi px
    try { (e.currentTarget as any).setPointerCapture?.((e as any).pointerId ?? 1); } catch {}

    clearDelTimer();
    delTimerRef.current = window.setTimeout(() => {
      delDidLongRef.current = true;
      clearDelTimer();

      // 🔴 AZZERA L’IMPORTO QUI
      handleClearAmount();

      if (navigator.vibrate) navigator.vibrate(10); // feedback tattile su Android
    }, DEL_HOLD_MS);
  };

  /** MOVIMENTO: se ti sposti troppo, annulla il long-press (così non collide con lo swipe) */
  const onDelPointerMoveCapture: React.PointerEventHandler<HTMLDivElement> = (e) => {
    if (!delTimerRef.current) return;
    const dx = Math.abs((e.clientX ?? 0) - delStartXRef.current);
    const dy = Math.abs((e.clientY ?? 0) - delStartYRef.current);
    if (dx > DEL_SLOP_PX || dy > DEL_SLOP_PX) {
      clearDelTimer();
    }
  };

  const onDelPointerUpCapture: React.PointerEventHandler<HTMLDivElement> = () => {
    const didLong = delDidLongRef.current;
    clearDelTimer();
    if (didLong) {
      // abbiamo già azzerato: evita click fantasma che cancellerebbe 1 cifra extra
      delDidLongRef.current = false;
      return;
    }
    // SHORT TAP: lascia la tua logica esistente (cancella 1 cifra)
    handleSingleBackspace();
  };

  const onDelPointerCancelCapture: React.PointerEventHandler<HTMLDivElement> = () => {
    clearDelTimer();
  };

  // Evita menu nativo/selection su lungo tap Android
  const onDelContextMenu: React.MouseEventHandler<HTMLDivElement> = (e) => e.preventDefault();
  const onDelSelectStart: React.ReactEventHandler<HTMLDivElement> = (e) => e.preventDefault();

  /** Se lo swipe del parent parte, annulla il long-press (cooperazione, non cambia UI) */
  useEffect(() => {
    const cancel = () => clearDelTimer();
    window.addEventListener('numPad:cancelLongPress', cancel);
    return () => window.removeEventListener('numPad:cancelLongPress', cancel);
  }, []);


  const calculate = (): string => {
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
  };

  const handleKeyPress = (key: string) => {
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
  };

  const handleSubmit = () => {
    if (canSubmit) {
      onSubmit(formData as Omit<Expense, 'id'>);
    }
  };

  const handleSelectChange = (field: keyof Omit<Expense, 'id'>, value: string) => {
      const updatedFormData = { [field]: value };
      if (field === 'category') {
        (updatedFormData as any).subcategory = ''; // Reset subcategory when category changes
      }
      onFormChange(updatedFormData);
      setActiveMenu(null);
  };

  const canSubmit = (formData.amount ?? 0) > 0;

  const categoryOptions = Object.keys(CATEGORIES).map(cat => ({
    value: cat,
    label: getCategoryStyle(cat).label,
    Icon: getCategoryStyle(cat).Icon,
    color: getCategoryStyle(cat).color,
    bgColor: getCategoryStyle(cat).bgColor,
  }));
  const subcategoryOptions = formData.category
    ? (CATEGORIES[formData.category]?.map(sub => ({ value: sub, label: sub })) || [])
    : [];
  const accountOptions = accounts.map(acc => ({ value: acc.id, label: acc.name }));
  const isSubcategoryDisabled = !formData.category || subcategoryOptions.length === 0;

  const displayValue = formatAmountForDisplay(currentValue);
  const smallDisplayValue = previousValue && operator ? `${formatAmountForDisplay(previousValue)} ${operator}` : ' ';
  const fontSizeClass = getAmountFontSize(displayValue);

  type KeypadButtonProps = {
    children: React.ReactNode; 
    onClick?: () => void; 
    className?: string;
    onSelectStart?: React.ReactEventHandler<HTMLDivElement>;
  } & React.HTMLAttributes<HTMLDivElement>;

  const KeypadButton: React.FC<KeypadButtonProps> = ({ children, onClick, className = '', ...props }) => (
    <div
      role="button" tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && onClick) { e.preventDefault(); onClick(); } }}
      className={`flex items-center justify-center text-5xl font-light focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400 transition-colors duration-150 select-none cursor-pointer ${className}`}
      style={{
        WebkitTapHighlightColor: 'transparent',
        touchAction: 'manipulation',
        WebkitTouchCallout: 'none'
      } as React.CSSProperties}
      {...props}
    >
      <span className="pointer-events-none">{children}</span>
    </div>
  );

  const OperatorButton: React.FC<{ children: React.ReactNode; onClick: () => void }> = ({ children, onClick }) => (
    <div
      role="button" tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      className="flex-1 w-full text-5xl text-indigo-600 font-light active:bg-slate-300/80 transition-colors duration-150 flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400 select-none cursor-pointer"
      style={{ WebkitTapHighlightColor: 'transparent', touchAction: 'manipulation' } as React.CSSProperties}
    >
      <span className="pointer-events-none">{children}</span>
    </div>
  );

  return (
    <div className="bg-slate-100 w-full h-full flex flex-col">
      <div className="flex-1 flex flex-col">
        <header className={`flex items-center justify-between p-4 flex-shrink-0 transition-opacity ${!isVisible ? 'opacity-0 invisible' : 'opacity-100'}`}>
          <button
            onClick={onClose}
            aria-label="Chiudi calcolatrice"
            className="w-11 h-11 flex items-center justify-center border border-red-300 text-red-600 bg-red-50 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 rounded-full transition-colors">
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

        <main className="flex-1 flex flex-col overflow-hidden relative">
          <div className="flex-1 flex flex-col justify-center items-center p-4 pt-0">
            <div className="w-full px-4 text-center">
              <span className="text-slate-500 text-2xl font-light h-8 block">{smallDisplayValue}</span>
              <div className={`relative inline-block text-slate-800 font-light tracking-tighter whitespace-nowrap transition-all leading-none ${fontSizeClass}`}>
                {displayValue}
                <span className="absolute right-full top-1/2 -translate-y-1/2 opacity-75" style={{ fontSize: '0.6em', marginRight: '0.2em' }}>€</span>
              </div>
            </div>
          </div>
          
           <button
              onClick={onNavigateToDetails}
              className={`absolute top-1/2 -right-px w-8 h-[148px] flex items-center justify-center cursor-pointer ${isDesktop ? 'hidden' : ''}`}
              style={{ transform: 'translateY(calc(-50% + 2px))' }}
              title="Aggiungi dettagli" aria-label="Aggiungi dettagli alla spesa"
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
            </button>
        </main>
      </div>
      
      <div className="flex-shrink-0 flex flex-col" style={{ height: '52vh' }}>
          <div className="flex justify-between items-center my-2 w-full px-4">
            <button
              onClick={() => setActiveMenu('account')}
              className="font-semibold text-indigo-600 hover:text-indigo-800 text-lg w-1/3 truncate p-2 rounded-lg focus:outline-none focus:ring-0 text-left">
              {accounts.find(a => a.id === formData.accountId)?.name || 'Conto'}
            </button>
            <button
              onClick={() => setActiveMenu('category')}
              className="font-semibold text-indigo-600 hover:text-indigo-800 text-lg w-1/3 truncate p-2 rounded-lg focus:outline-none focus:ring-0 text-center">
              {formData.category ? getCategoryStyle(formData.category).label : 'Categoria'}
            </button>
            <button
              onClick={() => setActiveMenu('subcategory')}
              disabled={isSubcategoryDisabled}
              className="font-semibold text-lg w-1/3 truncate p-2 rounded-lg focus:outline-none focus:ring-0 disabled:cursor-not-allowed disabled:text-slate-400 text-indigo-600 hover:text-indigo-800 transition-colors text-right">
              {formData.subcategory || 'Sottocateg.'}
            </button>
          </div>

          <div className="flex-1 p-2 flex flex-row gap-2 px-4 pb-4">
            <div className="h-full w-4/5 grid grid-cols-3 grid-rows-4 gap-2 num-pad">
              <KeypadButton onClick={() => handleKeyPress('7')} className="text-slate-900 active:bg-slate-200/60">7</KeypadButton>
              <KeypadButton onClick={() => handleKeyPress('8')} className="text-slate-900 active:bg-slate-200/60">8</KeypadButton>
              <KeypadButton onClick={() => handleKeyPress('9')} className="text-slate-900 active:bg-slate-200/60">9</KeypadButton>
              <KeypadButton onClick={() => handleKeyPress('4')} className="text-slate-900 active:bg-slate-200/60">4</KeypadButton>
              <KeypadButton onClick={() => handleKeyPress('5')} className="text-slate-900 active:bg-slate-200/60">5</KeypadButton>
              <KeypadButton onClick={() => handleKeyPress('6')} className="text-slate-900 active:bg-slate-200/60">6</KeypadButton>
              <KeypadButton onClick={() => handleKeyPress('1')} className="text-slate-900 active:bg-slate-200/60">1</KeypadButton>
              <KeypadButton onClick={() => handleKeyPress('2')} className="text-slate-900 active:bg-slate-200/60">2</KeypadButton>
              <KeypadButton onClick={() => handleKeyPress('3')} className="text-slate-900 active:bg-slate-200/60">3</KeypadButton>
              <KeypadButton onClick={() => handleKeyPress(',')} className="text-slate-900 active:bg-slate-200/60">,</KeypadButton>
              <KeypadButton onClick={() => handleKeyPress('0')} className="text-slate-900 active:bg-slate-200/60">0</KeypadButton>
              <KeypadButton
                className="text-slate-900 active:bg-slate-200/60"
                title="Tocca: cancella una cifra — Tieni premuto: cancella tutto"
                aria-label="Cancella"
                onPointerDownCapture={onDelPointerDownCapture}
                onPointerMoveCapture={onDelPointerMoveCapture}
                onPointerUpCapture={onDelPointerUpCapture}
                onPointerCancel={onDelPointerCancelCapture}
                onContextMenu={onDelContextMenu}
                onSelectStart={onDelSelectStart}
              >
                <BackspaceIcon className="w-8 h-8" />
              </KeypadButton>
            </div>

            <div className="h-full w-1/5 flex flex-col gap-2 bg-slate-200 rounded-2xl p-1">
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
};

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
}

const Dashboard: React.FC<DashboardProps> = ({ expenses, onLogout }) => {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
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
                <div className="mt-6 pt-4 border-t border-slate-200">
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
    const isFuture = date > today;

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

    if (isFuture) {
        dayClasses = "text-slate-400 cursor-not-allowed font-normal";
    } else if (isSelectedStart || isSelectedEnd || (isHovering && !isFuture)) {
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
            onMouseEnter={() => !isFuture && !isHoverDisabled && onHoverDate(date)}
        >
            <button onClick={() => !isFuture && onDateClick(day)} className={`${baseClasses} ${dayClasses}`} disabled={isFuture}>
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
    isNextMonthDisabled,
    isNextYearDisabled,
    isNextYearRangeDisabled,
    prevMonthDate,
    nextMonthDate
  } = useMemo(() => {
    const d = displayDate;
    const nextMonth = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    const nextYear = new Date(d.getFullYear() + 1, 0, 1);
    const nextRangeYear = new Date(d.getFullYear() + 12, 0, 1);
    return {
      isNextMonthDisabled: nextMonth > today,
      isNextYearDisabled: nextYear > today,
      isNextYearRangeDisabled: nextRangeYear > today,
      prevMonthDate: new Date(d.getFullYear(), d.getMonth() - 1, 1),
      nextMonthDate: nextMonth,
    };
  }, [displayDate, today]);
  
  const { yearsInView, yearRangeLabel } = useMemo(() => {
    const year = displayDate.getFullYear();
    const startYear = Math.floor(year / 12) * 12;
    const years = Array.from({ length: 12 }, (_, i) => startYear + i);
    return { yearsInView: years, yearRangeLabel: `${startYear} - ${startYear + 11}` };
  }, [displayDate]);

  const triggerTransition = (direction: 'left' | 'right') => {
    if (transition) return;
    if (direction === 'left' && isNextMonthDisabled) return;
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
      if (delta > 0 && new Date(newYear, 0, 1) > today) return current;
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
              disabled={ pickerView === 'days' ? isNextMonthDisabled : pickerView === 'months' ? isNextYearDisabled : isNextYearRangeDisabled }
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
                  const isFutureMonth = displayDate.getFullYear() > today.getFullYear() || (displayDate.getFullYear() === today.getFullYear() && index > today.getMonth());
                  return (
                    <button
                      key={month}
                      onClick={() => { setDisplayDate(new Date(displayDate.getFullYear(), index, 1)); setPickerView('days'); }}
                      disabled={isFutureMonth}
                      className="p-3 text-sm font-semibold rounded-lg text-slate-700 hover:bg-indigo-100 hover:text-indigo-700 transition-colors capitalize disabled:text-slate-400 disabled:hover:bg-transparent disabled:cursor-not-allowed"
                    >
                      {month}
                    </button>
                  );
                })}
              </div>
            ) : ( // pickerView === 'years'
              <div className="grid grid-cols-3 gap-2 animate-fade-in-up">
                {yearsInView.map((year) => {
                  const isFutureYear = year > today.getFullYear();
                  const isCurrentYear = year === displayDate.getFullYear();
                  return (
                    <button
                      key={year}
                      onClick={() => { setDisplayDate(new Date(year, displayDate.getMonth(), 1)); setPickerView('months'); }}
                      disabled={isFutureYear}
                      className={`p-3 text-sm font-semibold rounded-lg transition-colors capitalize disabled:text-slate-400 disabled:hover:bg-transparent disabled:cursor-not-allowed ${isCurrentYear ? 'bg-indigo-600 text-white' : 'text-slate-700 hover:bg-indigo-100 hover:text-indigo-700'}`}
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
import React, { useState, useEffect, useCallback, useRef } from 'react';
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

interface ExpenseFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: Omit<Expense, 'id'> | Expense) => void;
  initialData?: Expense;
  prefilledData?: Partial<Omit<Expense, 'id'>>;
  accounts: Account[];
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

// ✅ helper SOLO per la tastiera: attende la chiusura/stabilizzazione del visualViewport
const waitKeyboardClose = (): Promise<void> =>
  new Promise((resolve) => {
    const vv = (window as any).visualViewport as VisualViewport | undefined;
    if (!vv) { setTimeout(resolve, 100); return; }
    let t: any;
    const finish = () => { vv.removeEventListener('resize', onVV as any); clearTimeout(t); resolve(); };
    const onVV = () => { clearTimeout(t); t = setTimeout(finish, 80); };
    vv.addEventListener('resize', onVV as any, { passive: true });
    t = setTimeout(finish, 180); // safety
  });

// A memoized and correctly ref-forwarded input component to prevent re-renders from causing focus issues.
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

const ExpenseForm: React.FC<ExpenseFormProps> = ({ isOpen, onClose, onSubmit, initialData, prefilledData, accounts }) => {
  const [isAnimating, setIsAnimating] = useState(false);
  const [isClosableByBackdrop, setIsClosableByBackdrop] = useState(false);
  const [formData, setFormData] = useState<Partial<Omit<Expense, 'id' | 'amount'>> & { amount?: number | string }>({});
  const [error, setError] = useState<string | null>(null);
  
  const [activeMenu, setActiveMenu] = useState<'category' | 'subcategory' | 'account' | null>(null);

  // New states for change detection
  const [originalExpenseState, setOriginalExpenseState] = useState<Partial<Expense> | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  const amountInputRef = useRef<HTMLInputElement>(null);
  const descriptionInputRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  const isEditing = !!initialData;

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
    });
    setError(null);
    setOriginalExpenseState(null);
  }, [accounts]);
  
  const handleClose = () => {
    setIsAnimating(false);
    setTimeout(onClose, 300);
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
            time: initialData.time || getCurrentTime()
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
        });
        setOriginalExpenseState(null);
      } else {
        resetForm();
      }
      setHasChanges(false);
      
      const animTimer = setTimeout(() => {
        setIsAnimating(true);
        // Set focus on the title to prevent the browser from auto-focusing an input
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
  }, [isOpen, initialData, prefilledData, resetForm, accounts]);
  
    // Effect to detect changes
  useEffect(() => {
    if (!isEditing || !originalExpenseState) {
        setHasChanges(false);
        return;
    }

    // Normalize amount for comparison (formData can be string with comma)
    const currentAmount = parseFloat(String(formData.amount || '0').replace(',', '.'));
    const originalAmount = originalExpenseState.amount || 0;
    const amountChanged = Math.abs(currentAmount - originalAmount) > 0.001; // Use tolerance for float comparison

    const descriptionChanged = (formData.description || '') !== (originalExpenseState.description || '');
    const dateChanged = formData.date !== originalExpenseState.date;
    const timeChanged = (formData.time || '') !== (originalExpenseState.time || '');
    const categoryChanged = (formData.category || '') !== (originalExpenseState.category || '');
    const subcategoryChanged = (formData.subcategory || '') !== (originalExpenseState.subcategory || '');
    const accountIdChanged = formData.accountId !== originalExpenseState.accountId;

    const changed = amountChanged || descriptionChanged || dateChanged || timeChanged || categoryChanged || subcategoryChanged || accountIdChanged;
    
    setHasChanges(changed);

  }, [formData, originalExpenseState, isEditing]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
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

    const dataToSubmit = {
      ...formData,
      amount: amountAsNumber,
      date: finalDate,
      time: formData.time || undefined,
      description: formData.description || '',
      category: formData.category || '',
      subcategory: formData.subcategory || undefined,
    };
    
    if (isEditing) {
        onSubmit({ ...initialData, ...dataToSubmit } as Expense);
    } else {
        onSubmit(dataToSubmit as Omit<Expense, 'id'>);
    }
  };

  // ⬇️ S O L O  T A S T I E R A: intercetta Enter su "Importo", chiude tastiera, niente submit
  const handleAmountEnter = useCallback(async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const el = e.currentTarget as HTMLInputElement;
    el.blur();                // chiude la tastiera
    await waitKeyboardClose(); // attende stabilizzazione viewport → evita sfarfallio
    // resta nel form per scegliere conto/categoria/sottocategoria
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

  const selectedAccountLabel = accounts.find(a => a.id === formData.accountId)?.name;
  const selectedCategoryLabel = formData.category ? getCategoryStyle(formData.category).label : undefined;
  
  return (
    <div
      className={`fixed inset-0 z-50 transition-opacity duration-300 ease-in-out ${isAnimating ? 'opacity-100' : 'opacity-0'} bg-slate-900/60 backdrop-blur-sm`}
      onClick={handleBackdropClick}
      aria-modal="true"
      role="dialog"
    >
      <div
        className={`bg-slate-50 w-full h-full flex flex-col absolute bottom-0 transform transition-transform duration-300 ease-in-out ${isAnimating ? 'translate-y-0' : 'translate-y-full'}`}
        onClick={(e) => e.stopPropagation()}
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
                     onKeyDown={handleAmountEnter}  // ⬅️ Enter chiude tastiera, non invia
                     icon={<CurrencyEuroIcon className="h-5 w-5 text-slate-400" />}
                     // ⬇️ cambiamento CHIAVE per tastiera
                     type="text"
                     inputMode="decimal"
                     pattern="[0-9]*[.,]?[0-9]*"
                     placeholder="0.00"
                     required
                     autoComplete="off"
                  />
                  <div>
                    <label htmlFor="date" className="block text-base font-medium text-slate-700 mb-1">Data e Ora (opzionali)</label>
                    <div className="grid grid-cols-2 gap-2">
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
                                max={getTodayString()}
                            />
                        </div>
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
import { ArrowDownTrayIcon } from './icons/ArrowDownTrayIcon';

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
                      <ArrowDownTrayIcon className="w-5 h-5" />
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
import React, { useState, useRef, useEffect } from 'react';
import { DateRangePickerModal } from './DateRangePickerModal';

type DateFilter = 'all' | '7d' | '30d' | '6m' | '1y';

interface HistoryFilterCardProps {
  onSelectQuickFilter: (value: DateFilter) => void;
  currentQuickFilter: DateFilter;
  onCustomRangeChange: (range: { start: string | null, end: string | null }) => void;
  currentCustomRange: { start: string | null, end: string | null };
  isCustomRangeActive: boolean;
  onDateModalStateChange: (isOpen: boolean) => void;
}

const QuickFilterTable: React.FC<{
  onSelect: (value: DateFilter) => void;
  currentValue: DateFilter;
  isCustomActive: boolean;
}> = ({ onSelect, currentValue, isCustomActive }) => {
  const filters: { value: DateFilter; label: string }[] = [
    { value: '7d', label: '7G' },
    { value: '30d', label: '30G' },
    { value: '6m', label: '6M' },
    { value: '1y', label: '1A' },
  ];

  return (
    <table className="w-full table-fixed border-collapse border border-slate-400">
      <tbody>
        <tr>
          {filters.map(filter => {
            const isActive = !isCustomActive && currentValue === filter.value;
            return (
              <td key={filter.value} className="border border-slate-400 p-0 h-11">
                <button
                  onClick={() => onSelect(currentValue === filter.value ? 'all' : filter.value)}
                  className={`w-full h-full flex items-center justify-center px-2 text-center font-semibold text-sm transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${
                    isActive ? 'bg-indigo-600 text-white'
                             : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {filter.label}
                </button>
              </td>
            );
          })}
        </tr>
      </tbody>
    </table>
  );
};

const formatDateForButton = (dateString: string): string => {
    // Correctly parse YYYY-MM-DD as a local date to avoid timezone issues.
    const parts = dateString.split('-').map(Number);
    // Date constructor month is 0-indexed
    const date = new Date(parts[0], parts[1] - 1, parts[2]);
    
    return new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: 'short', year: '2-digit' }).format(date).replace('.', '');
};

const CustomDateRangeInputs: React.FC<{
  onClick: () => void;
  range: { start: string | null; end: string | null };
}> = ({ onClick, range }) => {
  return (
    <div className="grid grid-cols-2 border border-slate-400 h-11">
      <button
        onClick={onClick}
        aria-label={`Seleziona intervallo di date. Inizio: ${range.start ? formatDateForButton(range.start) : 'non impostato'}.`}
        className="flex items-center justify-center gap-2 px-2 bg-slate-100 hover:bg-slate-200 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 border-r border-slate-400"
      >
        <span className="text-sm font-semibold text-slate-700">
          {range.start ? formatDateForButton(range.start) : 'Da...'}
        </span>
      </button>
      <button
        onClick={onClick}
        aria-label={`Seleziona intervallo di date. Fine: ${range.end ? formatDateForButton(range.end) : 'non impostato'}.`}
        className="flex items-center justify-center gap-2 px-2 bg-slate-100 hover:bg-slate-200 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
      >
        <span className="text-sm font-semibold text-slate-700">
          {range.end ? formatDateForButton(range.end) : '...A'}
        </span>
      </button>
    </div>
  );
};


export const HistoryFilterCard: React.FC<HistoryFilterCardProps> = ({
  onSelectQuickFilter, currentQuickFilter, onCustomRangeChange, currentCustomRange, isCustomRangeActive, onDateModalStateChange
}) => {
  const [activeView, setActiveView] = useState<'quick' | 'custom'>('quick');
  const [isDateModalOpen, setIsDateModalOpen] = useState(false);
  const swipeContainerRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    onDateModalStateChange(isDateModalOpen);
  }, [isDateModalOpen, onDateModalStateChange]);

  const [dragPct, setDragPct] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const el = swipeContainerRef.current;
    if (!el) return;

    const ANG = 30; 
    const TAN = Math.tan((ANG * Math.PI) / 180);
    const SLOP = 6; 
    const TRIGGER_RATIO = 0.10;

    let hasDown = false;
    let lock: null | 'h' | 'v' = null;
    let sx = 0, sy = 0;
    let width = 1;
    let pid: number | null = null;

    const basePct = () => (activeView === 'quick' ? 0 : -50);

    const onDown = (e: PointerEvent) => {
      hasDown = true; lock = null;
      sx = e.clientX; sy = e.clientY;
      width = el.getBoundingClientRect().width || 1;
      pid = e.pointerId ?? 1;
      try { el.setPointerCapture?.(pid as any); } catch {}
      e.stopPropagation();
    };

    const onMove = (e: PointerEvent) => {
      if (!hasDown || (pid !== null && e.pointerId !== pid)) return;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;

      if (!lock) {
        const mostlyH = Math.abs(dx) > Math.abs(dy) * TAN;
        if (Math.max(Math.abs(dx), Math.abs(dy)) > SLOP) lock = mostlyH ? 'h' : 'v';
      }
      if (lock !== 'h') return;

      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
      setDragging(true);

      const deltaPct = (dx / width) * 50; 
      let t = basePct() + deltaPct;
      if (t > 0) t = 0;
      if (t < -50) t = -50;
      setDragPct(t);
    };

    const onEnd = (e: PointerEvent) => {
      if (!hasDown || (pid !== null && e.pointerId !== pid)) return;
      const dx = e.clientX - sx;
      const triggerPx = (el.getBoundingClientRect().width || 1) * TRIGGER_RATIO;

      if (lock === 'h') {
        if (activeView === 'quick' && dx <= -triggerPx) setActiveView('custom');
        else if (activeView === 'custom' && dx >= triggerPx) setActiveView('quick');
      }

      setDragging(false);
      setDragPct(null); 
      hasDown = false; pid = null; lock = null;
      e.stopPropagation();
    };

    el.addEventListener('pointerdown', onDown as any, { capture: true, passive: true });
    el.addEventListener('pointermove', onMove as any,  { capture: true, passive: false });
    el.addEventListener('pointerup', onEnd as any,     { capture: true, passive: true });
    el.addEventListener('pointercancel', onEnd as any, { capture: true });

    return () => {
      el.removeEventListener('pointerdown', onDown as any, { capture: true } as any);
      el.removeEventListener('pointermove', onMove as any,  { capture: true } as any);
      el.removeEventListener('pointerup', onEnd as any,     { capture: true } as any);
      el.removeEventListener('pointercancel', onEnd as any, { capture: true } as any);
    };
  }, [activeView]);

  const baseTranslate = activeView === 'quick' ? 0 : -50;
  const translateX = dragPct !== null ? dragPct : baseTranslate;

  return (
    <>
      <div className="flex-shrink-0 z-30">
        <div className="bg-white/95 backdrop-blur-sm shadow-[0_-8px_20px_-5px_rgba(0,0,0,0.08)]">
          <div className="mx-auto pt-3 pb-2 rounded-t-2xl">
            <div
              className="overflow-hidden"
              ref={swipeContainerRef}
              style={{ touchAction: 'pan-y', overscrollBehaviorX: 'contain' }}
            >
              <div
                className="flex"
                style={{
                  width: '200%',
                  transform: `translateX(${translateX}%)`,
                  transition: dragging ? 'none' : 'transform 0.12s ease-out'
                }}
              >
                <div className="w-1/2 flex-shrink-0 px-4">
                  <QuickFilterTable
                    onSelect={onSelectQuickFilter}
                    currentValue={currentQuickFilter}
                    isCustomActive={isCustomRangeActive}
                  />
                </div>
                <div className="w-1/2 flex-shrink-0 px-4">
                  <CustomDateRangeInputs
                    onClick={() => setIsDateModalOpen(true)}
                    range={currentCustomRange}
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-center items-center gap-2.5 pt-2">
              <button
                onClick={() => setActiveView('quick')}
                aria-label="Vai ai filtri rapidi"
                className={`w-3 h-3 rounded-full transition-colors ${activeView === 'quick' ? 'bg-indigo-600' : 'bg-slate-300 hover:bg-slate-400'}`}
              />
              <button
                onClick={() => setActiveView('custom')}
                aria-label="Vai al filtro per data personalizzata"
                className={`w-3 h-3 rounded-full transition-colors ${activeView === 'custom' ? 'bg-indigo-600' : 'bg-slate-300 hover:bg-slate-400'}`}
              />
            </div>
          </div>
          <div style={{ height: `env(safe-area-inset-bottom, 0px)` }} />
        </div>
      </div>
      <DateRangePickerModal
          isOpen={isDateModalOpen}
          onClose={() => setIsDateModalOpen(false)}
          initialRange={currentCustomRange}
          onApply={(range) => {
              onCustomRangeChange(range);
              setIsDateModalOpen(false);
          }}
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
import React, { useState, useEffect, useRef } from 'react';
import { Expense, Account } from '../types';
import { ArrowLeftIcon } from './icons/ArrowLeftIcon';
import { formatCurrency, formatDate } from './icons/formatters';
import SelectionMenu from './SelectionMenu';
import { DocumentTextIcon } from './icons/DocumentTextIcon';
import { CalendarIcon } from './icons/CalendarIcon';
import { CreditCardIcon } from './icons/CreditCardIcon';
import { ClockIcon } from './icons/ClockIcon';
import { ChevronDownIcon } from './icons/ChevronDownIcon';
import { CheckIcon } from './icons/CheckIcon';
import { XMarkIcon } from './icons/XMarkIcon';

interface TransactionDetailPageProps {
  formData: Partial<Omit<Expense, 'id'>>;
  onFormChange: (newData: Partial<Omit<Expense, 'id'>>) => void;
  accounts: Account[];
  onClose: () => void; // Per tornare alla calcolatrice
  onSubmit: (data: Omit<Expense, 'id'>) => void;
  isVisible: boolean;
  isDesktop: boolean;
}

const toYYYYMMDD = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const parseLocalYYYYMMDD = (dateString: string | null): Date | null => {
  if (!dateString) return null;
  const parts = dateString.split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]); // locale 00:00
};

const recurrenceLabels = {
    daily: 'Giornaliera',
    weekly: 'Settimanale',
    monthly: 'Mensile',
    yearly: 'Annuale',
};
const getRecurrenceLabel = (value?: keyof typeof recurrenceLabels) => {
    if (!value) return null;
    return recurrenceLabels[value];
}

const TransactionDetailPage: React.FC<TransactionDetailPageProps> = ({
    formData,
    onFormChange,
    accounts,
    onClose,
    onSubmit,
    isVisible,
    isDesktop,
}) => {
    const [activeMenu, setActiveMenu] = useState<'account' | null>(null);
    
    const initialDataOnShowRef = useRef<string | null>(null);
    const [hasChanges, setHasChanges] = useState(false);

    const [isFrequencyModalOpen, setIsFrequencyModalOpen] = useState(false);
    const [isFrequencyModalAnimating, setIsFrequencyModalAnimating] = useState(false);
    
    // State for the recurrence modal
    const [isRecurrenceModalOpen, setIsRecurrenceModalOpen] = useState(false);
    const [isRecurrenceModalAnimating, setIsRecurrenceModalAnimating] = useState(false);
    const [isRecurrenceOptionsOpen, setIsRecurrenceOptionsOpen] = useState(false);
    const [tempRecurrence, setTempRecurrence] = useState(formData.recurrence);
    const [tempRecurrenceInterval, setTempRecurrenceInterval] = useState<number | undefined>(formData.recurrenceInterval);

    // State for the recurrence end modal
    const [isRecurrenceEndModalOpen, setIsRecurrenceEndModalOpen] = useState(false);
    const [isRecurrenceEndModalAnimating, setIsRecurrenceEndModalAnimating] = useState(false);

     useEffect(() => {
        if (isFrequencyModalOpen) {
            const timer = setTimeout(() => setIsFrequencyModalAnimating(true), 10);
            return () => clearTimeout(timer);
        } else {
            setIsFrequencyModalAnimating(false);
        }
    }, [isFrequencyModalOpen]);

    useEffect(() => {
        if (isRecurrenceModalOpen) {
            // Initialize temp state when modal opens
            setTempRecurrence(formData.recurrence || 'monthly');
            setTempRecurrenceInterval(formData.recurrenceInterval || 1);
            setIsRecurrenceOptionsOpen(false);
            const timer = setTimeout(() => setIsRecurrenceModalAnimating(true), 10);
            return () => clearTimeout(timer);
        } else {
            setIsRecurrenceModalAnimating(false);
        }
    }, [isRecurrenceModalOpen, formData.recurrence, formData.recurrenceInterval]);

    useEffect(() => {
        if (isRecurrenceEndModalOpen) {
            const timer = setTimeout(() => setIsRecurrenceEndModalAnimating(true), 10);
            return () => clearTimeout(timer);
        } else {
            setIsRecurrenceEndModalAnimating(false);
        }
    }, [isRecurrenceEndModalOpen]);

    useEffect(() => {
        if (isVisible) {
            initialDataOnShowRef.current = JSON.stringify(formData);
            setHasChanges(false);
        } else {
            initialDataOnShowRef.current = null;
            setHasChanges(false);
        }
    }, [isVisible, formData]); // formData dependency ensures the ref is updated if parent changes it while visible

    // Robust change detection
    useEffect(() => {
        if (isVisible && initialDataOnShowRef.current) {
            try {
                const initialData = JSON.parse(initialDataOnShowRef.current);
                const changes =
                    (formData.description || '') !== (initialData.description || '') ||
                    formData.date !== initialData.date ||
                    formData.time !== initialData.time ||
                    formData.accountId !== initialData.accountId ||
                    (formData.frequency || undefined) !== (initialData.frequency || undefined) ||
                    (formData.recurrence || undefined) !== (initialData.recurrence || undefined) ||
                    (formData.recurrenceInterval || 1) !== (initialData.recurrenceInterval || 1) ||
                    (formData.recurrenceEndType || 'forever') !== (initialData.recurrenceEndType || 'forever') ||
                    (formData.recurrenceEndDate || undefined) !== (initialData.recurrenceEndDate || undefined) ||
                    (formData.recurrenceCount || undefined) !== (initialData.recurrenceCount || undefined);
                setHasChanges(changes);
            } catch (e) {
                // If parsing fails, assume changes to be safe
                setHasChanges(true);
            }
        }
    }, [formData, isVisible]);


    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        if (name === 'recurrenceCount') {
            const num = parseInt(value, 10);
            onFormChange({ [name]: isNaN(num) || num <= 0 ? undefined : num });
        } else {
            onFormChange({ [name]: value });
        }
    };
    
    const handleAccountSelect = (accountId: string) => {
        onFormChange({ accountId });
        setActiveMenu(null);
    };
    
     const handleFrequencySelect = (frequency: string) => {
        onFormChange({ frequency: frequency as 'single' | 'recurring' });
        handleCloseFrequencyModal();
    };

    const handleCloseFrequencyModal = () => {
        setIsFrequencyModalAnimating(false);
        setTimeout(() => {
            setIsFrequencyModalOpen(false);
        }, 300);
    };

    const handleCloseRecurrenceModal = () => {
        setIsRecurrenceModalAnimating(false);
        setTimeout(() => {
            setIsRecurrenceModalOpen(false);
        }, 300); // Match animation duration
    };
    
    const handleApplyRecurrence = () => {
        onFormChange({
            recurrence: tempRecurrence as any,
            recurrenceInterval: tempRecurrence === 'monthly' ? (tempRecurrenceInterval || 1) : 1
        });
        handleCloseRecurrenceModal();
    };

    const handleCloseRecurrenceEndModal = () => {
        setIsRecurrenceEndModalAnimating(false);
        setTimeout(() => {
            setIsRecurrenceEndModalOpen(false);
        }, 300);
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
        onFormChange(updates);
        handleCloseRecurrenceEndModal();
    };

    const handleSubmit = () => {
        onSubmit(formData as Omit<Expense, 'id'>);
    };

    const handleConfirmDetails = () => {
        onClose();
    };
    
    const selectedAccountLabel = accounts.find(a => a.id === formData.accountId)?.name;
    const accountOptions = accounts.map(acc => ({ value: acc.id, label: acc.name }));
    const today = toYYYYMMDD(new Date());

    const getRecurrenceEndLabel = () => {
        const { recurrenceEndType } = formData;
        if (!recurrenceEndType || recurrenceEndType === 'forever') {
            return 'Per sempre';
        }
        if (recurrenceEndType === 'date') {
            return 'Fino a';
        }
        if (recurrenceEndType === 'count') {
            return 'Numero di volte';
        }
        return 'Per sempre';
    };


    if (typeof formData.amount !== 'number') {
        return (
            <div className="flex flex-col h-full bg-slate-100 items-center justify-center p-4">
                 <header className={`p-4 flex items-center gap-4 text-slate-800 bg-white shadow-sm absolute top-0 left-0 right-0 z-10 transition-opacity ${!isVisible ? 'opacity-0 invisible' : 'opacity-100'}`}>
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

    const numericAmount = formData.amount || 0;
    const isInteger = numericAmount % 1 === 0;
    const numberFormatOptions: Intl.NumberFormatOptions = { style: 'decimal' };
    if (isInteger) {
        numberFormatOptions.minimumFractionDigits = 0;
        numberFormatOptions.maximumFractionDigits = 0;
    } else {
        numberFormatOptions.minimumFractionDigits = 2;
        numberFormatOptions.maximumFractionDigits = 2;
    }

    return (
        <div className="flex flex-col h-full bg-slate-100">
             <header className={`p-4 flex items-center justify-between gap-4 text-slate-800 bg-white shadow-sm sticky top-0 z-10 transition-opacity ${!isVisible ? 'opacity-0 invisible' : 'opacity-100'}`}>
                <div className="flex items-center gap-4">
                    {!isDesktop && (
                        <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-200" aria-label="Torna alla calcolatrice">
                            <ArrowLeftIcon className="w-6 h-6" />
                        </button>
                    )}
                    <h2 className="text-xl font-bold">Aggiungi Dettagli</h2>
                </div>
                <div className="w-11 h-11 flex items-center justify-center">
                    {hasChanges && !isDesktop && (
                        <button
                            onClick={handleConfirmDetails}
                            aria-label="Conferma modifiche e torna indietro"
                            className="w-11 h-11 flex items-center justify-center border border-green-500 bg-green-100 text-green-700 hover:bg-green-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 rounded-full transition-all animate-fade-in-up"
                            style={{ animationDuration: '200ms' }}
                        >
                            <CheckIcon className="w-7 h-7" />
                        </button>
                    )}
                </div>
            </header>
            <main className="flex-1 p-4 flex flex-col overflow-y-auto">
                <div className="mb-6 text-center">
                    <span className="block text-slate-500 text-lg">Importo</span>
                    <div>
                        <p className="text-5xl font-extrabold text-indigo-600 relative inline-block">
                            <span className="absolute right-full mr-2 text-3xl font-semibold top-1/2 -translate-y-1/2 text-indigo-600/80">€</span>
                            {new Intl.NumberFormat('it-IT', numberFormatOptions).format(numericAmount)}
                        </p>
                    </div>
                </div>

                <div className="space-y-4">
                    <div>
                        <label htmlFor="description" className="block text-base font-medium text-slate-700 mb-1">Descrizione</label>
                        <div className="relative">
                            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                                <DocumentTextIcon className="h-5 w-5 text-slate-400" />
                            </div>
                            <input
                                id="description"
                                name="description"
                                type="text"
                                value={formData.description || ''}
                                onChange={handleInputChange}
                                className="block w-full rounded-md border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-base"
                                placeholder="Es. Caffè al bar"
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
                          <span className="truncate flex-1">
                            {selectedAccountLabel || 'Seleziona'}
                          </span>
                        </button>
                    </div>

                    <div className="bg-white p-4 rounded-lg border border-slate-200 space-y-4">
                        <div>
                            <label className="block text-base font-medium text-slate-700 mb-1">Frequenza</label>
                            <button
                                type="button"
                                onClick={() => setIsFrequencyModalOpen(true)}
                                className="w-full flex items-center justify-between text-left gap-2 px-3 py-2.5 text-base rounded-lg border shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors bg-white border-slate-300 text-slate-800 hover:bg-slate-50"
                            >
                                <span className="truncate flex-1 capitalize">
                                    {formData.frequency === 'recurring' ? 'Ricorrente' : formData.frequency === 'single' ? 'Singolo' : 'Seleziona'}
                                </span>
                                <ChevronDownIcon className="w-5 h-5 text-slate-500" />
                            </button>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                             <div>
                                <label htmlFor="date" className="block text-base font-medium text-slate-700 mb-1">
                                    {formData.frequency === 'recurring' ? 'Data di inizio' : 'Data'}
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
                                        max={today}
                                        className="block w-full rounded-md border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-base"
                                    />
                                </div>
                            </div>
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
                                        className="block w-full rounded-md border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-base"
                                    />
                                </div>
                            </div>
                        </div>
                        {formData.frequency === 'recurring' && (
                             <>
                                <div>
                                    <label className="block text-base font-medium text-slate-700 mb-1">Ricorrenza</label>
                                    <button
                                        type="button"
                                        onClick={() => setIsRecurrenceModalOpen(true)}
                                        className="w-full flex items-center justify-between text-left gap-2 px-3 py-2.5 text-base rounded-lg border shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors bg-white border-slate-300 text-slate-800 hover:bg-slate-50"
                                    >
                                        <span className="truncate flex-1 capitalize">
                                            {getRecurrenceLabel(formData.recurrence as any) || 'Imposta ricorrenza'}
                                        </span>
                                        <ChevronDownIcon className="w-5 h-5 text-slate-500" />
                                    </button>
                                </div>
                                <div className="grid grid-cols-2 gap-4 items-end">
                                    <div>
                                        <label className="block text-base font-medium text-slate-700 mb-1">Termina</label>
                                        <button
                                            type="button"
                                            onClick={() => setIsRecurrenceEndModalOpen(true)}
                                            className="w-full flex items-center justify-between text-left gap-2 px-3 py-2.5 text-base rounded-lg border shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors bg-white border-slate-300 text-slate-800 hover:bg-slate-50"
                                        >
                                            <span className="truncate flex-1">
                                                {getRecurrenceEndLabel()}
                                            </span>
                                            <ChevronDownIcon className="w-5 h-5 text-slate-500" />
                                        </button>
                                    </div>

                                    {formData.recurrenceEndType === 'date' && (
                                        <div className="animate-fade-in-up">
                                            <label className="block text-base font-medium text-slate-700 mb-1 invisible" aria-hidden="true">Data fine</label>
                                            <label
                                                htmlFor="recurrence-end-date"
                                                className="relative w-full flex items-center justify-center gap-2 px-3 py-2.5 text-base rounded-lg focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-indigo-500 text-indigo-600 hover:bg-indigo-100 font-semibold cursor-pointer"
                                            >
                                                <CalendarIcon className="h-5 w-5" />
                                                <span>
                                                    {formData.recurrenceEndDate
                                                        ? formatDate(parseLocalYYYYMMDD(formData.recurrenceEndDate)!)
                                                        : 'Seleziona'}
                                                </span>
                                                <input
                                                    id="recurrence-end-date"
                                                    type="date"
                                                    name="recurrenceEndDate"
                                                    value={formData.recurrenceEndDate || ''}
                                                    onChange={handleInputChange}
                                                    min={formData.date}
                                                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                                    aria-label="Data di fine ricorrenza"
                                                />
                                            </label>
                                        </div>
                                    )}
                                    {formData.recurrenceEndType === 'count' && (
                                        <div className="animate-fade-in-up">
                                            <label htmlFor="recurrence-count" className="block text-base font-medium text-slate-700 mb-1">N. di volte</label>
                                            <input
                                                type="number"
                                                id="recurrence-count"
                                                name="recurrenceCount"
                                                value={formData.recurrenceCount || ''}
                                                onChange={handleInputChange}
                                                min="1"
                                                placeholder="Es. 12"
                                                className="block w-full rounded-md border border-slate-300 bg-white py-2.5 px-3 text-slate-900 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-base"
                                            />
                                        </div>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                </div>
                <div className="mt-auto pt-6">
                    <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={(formData.amount ?? 0) <= 0}
                        className="w-full px-4 py-3 text-base font-semibold text-white bg-indigo-600 rounded-lg shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-colors disabled:bg-indigo-300 disabled:cursor-not-allowed"
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

            {isFrequencyModalOpen && (
                 <div
                    className={`absolute inset-0 z-[60] flex justify-center items-center p-4 transition-opacity duration-300 ease-in-out ${isFrequencyModalAnimating ? 'opacity-100' : 'opacity-0'} bg-slate-900/60 backdrop-blur-sm`}
                    onClick={handleCloseFrequencyModal}
                    aria-modal="true" role="dialog"
                >
                    <div
                        className={`bg-white rounded-lg shadow-xl w-full max-w-xs transform transition-all duration-300 ease-in-out ${isFrequencyModalAnimating ? 'scale-100 opacity-100' : 'scale-95 opacity-0'}`}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex justify-between items-center p-4 border-b border-slate-200">
                            <h2 className="text-lg font-bold text-slate-800">Seleziona Frequenza</h2>
                            <button type="button" onClick={handleCloseFrequencyModal} className="text-slate-500 hover:text-slate-800 transition-colors p-1 rounded-full hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500" aria-label="Chiudi">
                                <XMarkIcon className="w-6 h-6" />
                            </button>
                        </div>
                        <div className="p-4 space-y-2">
                             <button onClick={() => handleFrequencySelect('single')} className="w-full text-center px-4 py-3 text-base font-semibold rounded-lg transition-colors bg-slate-100 text-slate-800 hover:bg-indigo-100 hover:text-indigo-800">Singolo</button>
                             <button onClick={() => handleFrequencySelect('recurring')} className="w-full text-center px-4 py-3 text-base font-semibold rounded-lg transition-colors bg-slate-100 text-slate-800 hover:bg-indigo-100 hover:text-indigo-800">Ricorrente</button>
                        </div>
                    </div>
                </div>
            )}
            
            {isRecurrenceModalOpen && (
                <div
                    className={`absolute inset-0 z-[60] flex justify-center items-center p-4 transition-opacity duration-300 ease-in-out ${isRecurrenceModalAnimating ? 'opacity-100' : 'opacity-0'} bg-slate-900/60 backdrop-blur-sm`}
                    onClick={handleCloseRecurrenceModal}
                    aria-modal="true"
                    role="dialog"
                >
                    <div
                        className={`bg-white rounded-lg shadow-xl w-full max-w-sm transform transition-all duration-300 ease-in-out ${isRecurrenceModalAnimating ? 'scale-100 opacity-100' : 'scale-95 opacity-0'}`}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <header className="flex justify-between items-center p-4 border-b border-slate-200">
                            <h2 className="text-lg font-bold text-slate-800">Imposta Ricorrenza</h2>
                            <button type="button" onClick={handleCloseRecurrenceModal} className="text-slate-500 hover:text-slate-800 transition-colors p-1 rounded-full hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500" aria-label="Chiudi">
                                <XMarkIcon className="w-6 h-6" />
                            </button>
                        </header>
                        
                        <main className="p-4 space-y-4">
                            <div className="relative">
                                <button
                                    onClick={() => setIsRecurrenceOptionsOpen(prev => !prev)}
                                    className="w-full flex items-center justify-between text-left gap-2 px-3 py-2.5 text-base rounded-lg border shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors bg-white border-slate-300 text-slate-800 hover:bg-slate-50"
                                >
                                    <span className="truncate flex-1 capitalize">
                                        {getRecurrenceLabel(tempRecurrence as any) || 'Seleziona'}
                                    </span>
                                    <ChevronDownIcon className={`w-5 h-5 text-slate-500 transition-transform ${isRecurrenceOptionsOpen ? 'rotate-180' : ''}`} />
                                </button>

                                {isRecurrenceOptionsOpen && (
                                    <div className="absolute top-full mt-1 w-full bg-white border border-slate-200 shadow-lg rounded-lg z-10 p-2 space-y-1 animate-fade-in-down">
                                        {(Object.keys(recurrenceLabels) as Array<keyof typeof recurrenceLabels>).map((key) => (
                                            <button
                                                key={key}
                                                onClick={() => {
                                                    setTempRecurrence(key);
                                                    setIsRecurrenceOptionsOpen(false);
                                                }}
                                                className="w-full text-left px-4 py-3 text-base font-semibold rounded-lg transition-colors bg-slate-50 text-slate-800 hover:bg-indigo-100 hover:text-indigo-800"
                                            >
                                                {recurrenceLabels[key]}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {tempRecurrence === 'monthly' && (
                                <div className="animate-fade-in-up pt-2" style={{animationDuration: '200ms'}}>
                                    <div className="flex items-center justify-center gap-2 bg-slate-100 p-3 rounded-lg">
                                        <span className="text-base text-slate-700">Ogni</span>
                                        <input
                                            type="number"
                                            value={tempRecurrenceInterval || ''}
                                            onChange={(e) => {
                                                const val = e.target.value;
                                                if (val === '') {
                                                    setTempRecurrenceInterval(undefined);
                                                } else {
                                                    const num = parseInt(val, 10);
                                                    if (!isNaN(num) && num > 0) {
                                                        setTempRecurrenceInterval(num);
                                                    }
                                                }
                                            }}
                                            onFocus={(e) => e.target.select()}
                                            className="w-12 text-center text-lg font-bold text-slate-800 bg-transparent border-0 border-b-2 border-slate-400 focus:ring-0 focus:outline-none focus:border-indigo-600 p-0"
                                            min="1"
                                        />
                                        <span className="text-base text-slate-700">
                                            {(tempRecurrenceInterval || 1) === 1 ? 'mese' : 'mesi'}
                                        </span>
                                    </div>
                                </div>
                            )}
                        </main>

                        <footer className="px-4 py-3 bg-slate-100 border-t border-slate-200 flex justify-end gap-3">
                            <button
                                type="button"
                                onClick={handleCloseRecurrenceModal}
                                className="px-4 py-2 text-sm font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg shadow-sm hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-colors"
                            >
                                Annulla
                            </button>
                            <button
                                type="button"
                                onClick={handleApplyRecurrence}
                                className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-colors"
                            >
                                Applica
                            </button>
                        </footer>
                    </div>
                </div>
            )}

            {isRecurrenceEndModalOpen && (
                <div
                    className={`absolute inset-0 z-[60] flex justify-center items-center p-4 transition-opacity duration-300 ease-in-out ${isRecurrenceEndModalAnimating ? 'opacity-100' : 'opacity-0'} bg-slate-900/60 backdrop-blur-sm`}
                    onClick={handleCloseRecurrenceEndModal}
                    aria-modal="true"
                    role="dialog"
                >
                    <div
                        className={`bg-white rounded-lg shadow-xl w-full max-w-xs transform transition-all duration-300 ease-in-out ${isRecurrenceEndModalAnimating ? 'scale-100 opacity-100' : 'scale-95 opacity-0'}`}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex justify-between items-center p-4 border-b border-slate-200">
                            <h2 className="text-lg font-bold text-slate-800">Termina Ripetizione</h2>
                            <button type="button" onClick={handleCloseRecurrenceEndModal} className="text-slate-500 hover:text-slate-800 transition-colors p-1 rounded-full hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500" aria-label="Chiudi">
                                <XMarkIcon className="w-6 h-6" />
                            </button>
                        </div>
                        <div className="p-4 space-y-2">
                            <button onClick={() => handleRecurrenceEndTypeSelect('forever')} className="w-full text-center px-4 py-3 text-base font-semibold rounded-lg transition-colors bg-slate-100 text-slate-800 hover:bg-indigo-100 hover:text-indigo-800">Per sempre</button>
                            <button onClick={() => handleRecurrenceEndTypeSelect('date')} className="w-full text-center px-4 py-3 text-base font-semibold rounded-lg transition-colors bg-slate-100 text-slate-800 hover:bg-indigo-100 hover:text-indigo-800">Fino a</button>
                            <button onClick={() => handleRecurrenceEndTypeSelect('count')} className="w-full text-center px-4 py-3 text-base font-semibold rounded-lg transition-colors bg-slate-100 text-slate-800 hover:bg-indigo-100 hover:text-indigo-800">Numero di volte</button>
                        </div>
                    </div>
                </div>
            )}
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
import { LiveServerMessage, LiveSession } from '@google/genai';

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

  const sessionPromise = useRef<Promise<LiveSession> | null>(null);
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

      sessionPromise.current = createLiveSession({
        onmessage: (message: LiveServerMessage) => {
          if (message.serverContent?.inputTranscription) {
            setTranscript(prev => prev + message.serverContent.inputTranscription.text);
          }
          if (message.toolCall?.functionCalls) {
            setStatus('processing');
            const args = message.toolCall.functionCalls[0].args;
            onParsed({
              description: args.description,
              amount: args.amount,
              category: args.category,
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
      
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContext) {
        setError("Il tuo browser non supporta l'input vocale.");
        setStatus('error');
        return;
      }

      audioContext.current = new AudioContext({ sampleRate: 16000 });
      const source = audioContext.current.createMediaStreamSource(stream.current);
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
      <AppLogoIcon style={{ width: '100%', height: '100%' }} />
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
    mainContainerStyle.position = 'fixed';
    mainContainerStyle.inset = 0;
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

export const AppLogoIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
    <defs>
      <linearGradient id="app-logo-wallet-gradient" x1="0" y1="0" x2="80" y2="80" gradientUnits="userSpaceOnUse">
        <stop stopColor="#6366F1"/>
        <stop offset="1" stopColor="#4F46E5"/>
      </linearGradient>
      <filter id="app-logo-shadow" x="-25%" y="-25%" width="150%" height="150%">
        <feDropShadow dx="0" dy="5" stdDeviation="5" floodColor="#4338ca" floodOpacity="0.4"/>
      </filter>
    </defs>
    <g filter="url(#app-logo-shadow)">
      {/* Back part of wallet */}
      <rect x="10" y="24" width="60" height="40" rx="8" fill="url(#app-logo-wallet-gradient)"/>
      
      {/* Receipt paper */}
      <rect x="22" y="12" width="36" height="30" rx="4" fill="#F8FAFC" stroke="#E2E8F0" strokeWidth="2"/>
      <path d="M29 22H51" stroke="#D1D5DB" strokeWidth="2" strokeLinecap="round"/>
      <path d="M29 29H43" stroke="#D1D5DB" strokeWidth="2" strokeLinecap="round"/>
      
      {/* Front part of wallet */}
      <rect x="10" y="30" width="60" height="34" rx="8" fill="#4F46E5"/>
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
    startY: 0,
    lastY: 0,
    lastT: 0,
    vy: 0, // Velocity in px/ms
    scroller: null as HTMLElement | null,
    closing: false,
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

    const onStart = (y: number) => {
      g.active = true;
      g.tookOver = false;
      g.startY = y;
      g.lastY = y;
      g.lastT = performance.now();
      g.vy = 0;
      g.scroller = findScrollable(sheet, scrollableSelector);
    };

    const onMove = (y: number, e: Event) => {
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
      
      const dy = y - g.startY;

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
      onStart(e.touches[0].clientY);
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!g.active || e.touches.length !== 1) return;
      onMove(e.touches[0].clientY, e);
    };
    const onTouchEnd = () => onEnd();
    const onTouchCancel = () => onEnd();

    // Pointer fallback
    const onPointerDown = (e: PointerEvent) => onStart(e.clientY);
    const onPointerMove = (e: PointerEvent) => onMove(e.clientY, e);
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
// useSwipe.ts / useSwipe.js
import * as React from "react";

type SwipeOpts = {
  enabled?: boolean;
  slop?: number;        // px per "armare" il gesto (default 12)
  threshold?: number;   // px per confermare la nav (default 56)
  angle?: number;       // tolleranza orizzontale (± gradi, default 30)
  enableLeftAtRightEdge?: boolean;  // default true
  enableRightAtLeftEdge?: boolean;  // default false
  ignoreSelector?: string; // New option to ignore swipes on certain elements
  disableDrag?: (intent: "left" | "right") => boolean;
};

function isHorizScrollable(el: HTMLElement | null) {
  if (!el) return false;
  const s = getComputedStyle(el);
  if (!(s.overflowX === "auto" || s.overflowX === "scroll")) return false;
  return el.scrollWidth > el.clientWidth + 1;
}

function nearestHorizScroller(from: EventTarget | null): HTMLElement | null {
  let el = from as HTMLElement | null;
  while (el) {
    if (isHorizScrollable(el)) return el;
    el = el.parentElement;
  }
  return null;
}

function atStart(sc: HTMLElement) {
  // LTR: 0; usiamo una tolleranza di 1px
  return sc.scrollLeft <= 1;
}
function atEnd(sc: HTMLElement) {
  const max = sc.scrollWidth - sc.clientWidth;
  return sc.scrollLeft >= max - 1;
}

export function useSwipe(
  ref: React.RefObject<HTMLElement>,
  handlers: { onSwipeLeft?: () => void; onSwipeRight?: () => void },
  opts: SwipeOpts = {}
) {
  const {
    enabled = true,
    slop = 12,
    threshold = 56,
    angle = 30,
    enableLeftAtRightEdge = true,
    enableRightAtLeftEdge = false,
    ignoreSelector,
    disableDrag,
  } = opts;

  const st = React.useRef({
    tracking: false,
    startX: 0,
    startY: 0,
    dx: 0,
    dy: 0,
    armed: false,
    intent: null as null | "left" | "right",
    scroller: null as HTMLElement | null,
    mode: null as null | "scroll" | "page",
    handoffX: null as number | null, // X al momento del passaggio "scroll → page"
  });

  const [progress, setProgress] = React.useState(0);
  const [isSwiping, setIsSwiping] = React.useState(false);
  const TAN = Math.tan((angle * Math.PI) / 180);
  
  const handlersRef = React.useRef(handlers);
  handlersRef.current = handlers;

  React.useEffect(() => {
    const root = ref.current;
    if (!root || !enabled) return;

    const onDown = (e: PointerEvent) => {
      // Check if the event target or its parent matches the ignore selector.
      if (ignoreSelector && (e.target as HTMLElement).closest(ignoreSelector)) {
        return; // Do not start tracking the swipe.
      }

      st.current.tracking = true;
      st.current.startX = e.clientX;
      st.current.startY = e.clientY;
      st.current.dx = 0;
      st.current.dy = 0;
      st.current.armed = false;
      st.current.intent = null;
      st.current.mode = null;
      st.current.handoffX = null;
      st.current.scroller = nearestHorizScroller(e.target);

      setIsSwiping(false);
      setProgress(0);
      // 🔸 non catturiamo subito il pointer: lasciamo scorrere la card liberamente
    };

    const onMove = (e: PointerEvent) => {
      if (!st.current.tracking) return;

      const dx = e.clientX - st.current.startX;
      const dy = e.clientY - st.current.startY;
      st.current.dx = dx;
      st.current.dy = dy;

      const mostlyHorizontal = Math.abs(dx) > Math.abs(dy) * TAN;

      // 1) Lock della direzione quando superiamo lo slop in orizzontale
      if (!st.current.armed && mostlyHorizontal && Math.abs(dx) >= slop) {
        st.current.armed = true;
        st.current.intent = dx < 0 ? "left" : "right";

        const hasHandler =
          (st.current.intent === 'left' && handlersRef.current.onSwipeLeft) ||
          (st.current.intent === 'right' && handlersRef.current.onSwipeRight);

        const sc = st.current.scroller;
        if (sc) {
          // Politica: nav solo Left@RightEdge (storico); Right@LeftEdge opzionale (default off)
          if (st.current.intent === "left") {
            st.current.mode = enableLeftAtRightEdge && atEnd(sc) && hasHandler ? "page" : "scroll";
            if (st.current.mode === "page") {
              st.current.handoffX = e.clientX;
              try { root.setPointerCapture?.((e as any).pointerId ?? 1); } catch {}
            }
          } else { // intent === 'right'
            st.current.mode = enableRightAtLeftEdge && atStart(sc) && hasHandler ? "page" : "scroll";
            if (st.current.mode === "page") {
              st.current.handoffX = e.clientX;
              try { root.setPointerCapture?.((e as any).pointerId ?? 1); } catch {}
            }
          }
        } else {
          // nessuno scroller: è swipe di pagina, only if handler exists
          if (hasHandler) {
             st.current.mode = "page";
             st.current.handoffX = e.clientX;
             try { root.setPointerCapture?.((e as any).pointerId ?? 1); } catch {}
          } else {
             // No handler, no scroller. This swipe does nothing.
             st.current.armed = false;
             st.current.intent = null;
          }
        }
      }

      if (!st.current.armed || !mostlyHorizontal) return;

      // 2) Se siamo in modalità "scroll", controlla se raggiungiamo il bordo giusto DURANTE lo stesso gesto
      if (st.current.mode === "scroll" && st.current.scroller) {
        const sc = st.current.scroller;
        const hasHandler =
          (st.current.intent === 'left' && handlersRef.current.onSwipeLeft) ||
          (st.current.intent === 'right' && handlersRef.current.onSwipeRight);

        if (
          hasHandler && // Check handler before handoff
          st.current.intent === "left" &&
          enableLeftAtRightEdge &&
          atEnd(sc)
        ) {
          // **Edge handoff**: la card è ora tutta a destra e continui verso sinistra → passa a pagina
          st.current.mode = "page";
          st.current.handoffX = e.clientX; // zero locale per progress
          try { root.setPointerCapture?.((e as any).pointerId ?? 1); } catch {}
        } else if (
          hasHandler && // Check handler before handoff
          st.current.intent === "right" &&
          enableRightAtLeftEdge &&
          atStart(sc)
        ) {
          st.current.mode = "page";
          st.current.handoffX = e.clientX;
          try { root.setPointerCapture?.((e as any).pointerId ?? 1); } catch {}
        } else {
          // resta scroll: non interferire
          setIsSwiping(false);
          setProgress(0);
          return;
        }
      }

      // 3) Modalità pagina: gestiamo il gesto rispetto al punto di handoff
      if (st.current.mode === "page") {
        if (e.cancelable) e.preventDefault();
        setIsSwiping(true);

        const baseX = st.current.handoffX ?? st.current.startX;
        const dxFromHandoff = e.clientX - baseX; // negativo = left, positivo = right

        // progress normalizzato (clamp −1..1)
        const screenWidth = root.offsetWidth;
        if (screenWidth > 0) {
            const p = Math.max(-1, Math.min(1, dxFromHandoff / screenWidth));
            if (st.current.intent && disableDrag?.(st.current.intent)) {
              setProgress(0);
            } else {
              setProgress(p);
            }
        }
      }
    };

    const onUp = (e: PointerEvent) => {
      if (!st.current.tracking) return;

      const { armed, intent, mode, handoffX } = st.current;
      
      try { root.releasePointerCapture?.((e as any).pointerId ?? 1); } catch {}

      st.current.tracking = false;
      setIsSwiping(false);
      setProgress(0);

      if (!armed || mode !== "page" || !intent) return;

      const baseX = handoffX ?? st.current.startX;
      const dxFromHandoff = e.clientX - baseX;

      if (Math.abs(dxFromHandoff) >= threshold) {
          if (intent === "left" && handlersRef.current.onSwipeLeft) {
            handlersRef.current.onSwipeLeft();
          } else if (intent === "right" && handlersRef.current.onSwipeRight) {
            handlersRef.current.onSwipeRight();
          }
      }
      // altrimenti: gesto non confermato → nessuna nav
    };

    const onCancel = (e: PointerEvent) => {
      try { root.releasePointerCapture?.((e as any).pointerId ?? 1); } catch {}
      st.current.tracking = false;
      setIsSwiping(false);
      setProgress(0);
    };

    root.addEventListener("pointerdown", onDown, { passive: true });
    root.addEventListener("pointermove", onMove, { passive: false }); // serve per preventDefault
    root.addEventListener("pointerup", onUp, { passive: true });
    root.addEventListener("pointercancel", onCancel);

    return () => {
      root.removeEventListener("pointerdown", onDown as any);
      root.removeEventListener("pointermove", onMove as any);
      root.removeEventListener("pointerup", onUp as any);
      root.removeEventListener("pointercancel", onCancel as any);
    };
  }, [
    ref,
    enabled,
    slop,
    threshold,
    angle,
    enableLeftAtRightEdge,
    enableRightAtLeftEdge,
    ignoreSelector,
    disableDrag,
  ]);

  return { progress, isSwiping };
}
```


---

## `./hooks/useSwipeDownCloseAtTop.ts`

```ts

```


---

## `./icon-192.svg`

```svg
<svg width="192" height="192" viewBox="0 0 192 192" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="192" height="192" rx="48" fill="#4f46e5"/>
    <svg x="32" y="32" width="128" height="128" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path stroke-linecap="round" stroke-linejoin="round" d="M21 12a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 12m18 0v6a2.25 2.25 0 0 1-2.25-2.25H5.25A2.25 2.25 0 0 1 3 18v-6m18 0V9M3 12V9m18 3a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 12m15.75 0-3.75-3.75" stroke="white" stroke-width="1.5"/>
    </svg>
</svg>
```


---

## `./icon-512.svg`

```svg
<svg width="512" height="512" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="512" height="512" rx="128" fill="#4f46e5"/>
    <svg x="96" y="96" width="320" height="320" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path stroke-linecap="round" stroke-linejoin="round" d="M21 12a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 12m18 0v6a2.25 2.25 0 0 1-2.25-2.25H5.25A2.25 2.25 0 0 1 3 18v-6m18 0V9M3 12V9m18 3a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 12m15.75 0-3.75-3.75" stroke="white" stroke-width="1.5"/>
    </svg>
</svg>
```


---

## `./index.html`

```html
<!DOCTYPE html>
<html lang="it">
  <head>
    <meta charset="UTF-8" />
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
    "idb": "https://cdn.jsdelivr.net/npm/idb@8/+esm"
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
      .animate-slide-out-left { animation: slide-out-to-left 0.2s ease-out forwards; }
      .animate-slide-in-from-right { animation: slide-in-from-right 0.2s ease-out forwards; }
      .animate-slide-out-right { animation: slide-out-to-right 0.2s ease-out forwards; }
      .animate-slide-in-from-left { animation: slide-in-from-left 0.2s ease-out forwards; }

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
    <!-- Preview refresh trigger -->
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
  "name": "Copy of Gestore Spese ",
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
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "18.3.1",
    "react-dom": "18.3.1",
    "@google/genai": "^1.21.0",
    "recharts": "2.12.7",
    "idb": "8"
  },
  "devDependencies": {
    "@types/node": "^22.14.0",
    "@vitejs/plugin-react": "^5.0.0",
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
import React, { useState } from 'react';
import AuthLayout from '../components/auth/AuthLayout';
import { findEmailByPhoneNumber } from '../utils/api';
import { PhoneIcon } from '../components/icons/PhoneIcon';
import { SpinnerIcon } from '../components/icons/SpinnerIcon';

interface ForgotEmailScreenProps {
  onBackToLogin: () => void;
}

const ForgotEmailScreen: React.FC<ForgotEmailScreenProps> = ({ onBackToLogin }) => {
    const [phoneNumber, setPhoneNumber] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [message, setMessage] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!phoneNumber) return;
        setIsLoading(true);
        const response = await findEmailByPhoneNumber(phoneNumber);
        setMessage(response.message);
        setIsLoading(false);
    };
    
    const inputStyles = "block w-full rounded-md border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 sm:text-sm";

    return (
        <AuthLayout>
            <div className="text-center">
                 <h2 className="text-xl font-bold text-slate-800 mb-2">Recupera Email</h2>
                 {message ? (
                     <>
                        <p className="text-slate-500 mb-6 min-h-[40px]">{message}</p>
                        <button
                          onClick={onBackToLogin}
                          className="w-full px-4 py-3 text-sm font-semibold text-white bg-indigo-600 rounded-lg shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-colors"
                        >
                          Torna al Login
                        </button>
                     </>
                 ) : (
                     <>
                        <p className="text-slate-500 mb-6">Inserisci il tuo numero di telefono. Ti invieremo un SMS con l'email associata.</p>
                        <form onSubmit={handleSubmit}>
                           <div className="mb-4">
                               <label htmlFor="phone-recover" className="sr-only">Numero di Telefono</label>
                               <div className="relative">
                                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                                      <PhoneIcon className="h-5 w-5 text-slate-400" aria-hidden="true" />
                                  </div>
                                  <input
                                      type="tel"
                                      id="phone-recover"
                                      autoComplete="tel"
                                      value={phoneNumber}
                                      onChange={(e) => setPhoneNumber(e.target.value)}
                                      className={inputStyles}
                                      placeholder="Il tuo numero di telefono"
                                      required
                                      disabled={isLoading}
                                  />
                               </div>
                           </div>
                           <button
                               type="submit"
                               disabled={isLoading || !phoneNumber}
                               className="w-full px-4 py-3 text-sm font-semibold text-white bg-indigo-600 rounded-lg shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-colors disabled:bg-indigo-300 flex justify-center items-center"
                           >
                               {isLoading ? <SpinnerIcon className="w-5 h-5"/> : 'Trova la mia Email'}
                           </button>
                        </form>
                        <button
                          onClick={onBackToLogin}
                          className="mt-6 w-full text-center text-sm font-semibold text-indigo-600 hover:text-indigo-500"
                        >
                          Annulla
                        </button>
                     </>
                 )}
            </div>
        </AuthLayout>
    );
};

export default ForgotEmailScreen;
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
import { formatCurrency, formatDate } from '../components/icons/formatters';
import { PencilSquareIcon } from '../components/icons/PencilSquareIcon';
import { TrashIcon } from '../components/icons/TrashIcon';
import { HistoryFilterCard } from '../components/HistoryFilterCard';

type DateFilter = 'all' | '7d' | '30d' | '6m' | '1y';

interface ExpenseItemProps {
  expense: Expense;
  accounts: Account[];
  onEdit: (expense: Expense) => void;
  onDelete: (id: string) => void;
  isOpen: boolean;
  onOpen: (id: string) => void;
  onInteractionChange: (isInteracting: boolean) => void;
  onNavigateHome: () => void;
}

const ACTION_WIDTH = 72; // w-[72px] for delete button

const ExpenseItem: React.FC<ExpenseItemProps> = ({ expense, accounts, onEdit, onDelete, isOpen, onOpen, onInteractionChange, onNavigateHome }) => {
    const style = getCategoryStyle(expense.category);
    const accountName = accounts.find(a => a.id === expense.accountId)?.name || 'Sconosciuto';
    
    const itemRef = useRef<HTMLDivElement>(null);
    const dragState = useRef({
      isDragging: false,
      isLocked: false,
      startX: 0,
      startY: 0,
      startTime: 0,
      initialTranslateX: 0,
    });

    const setTranslateX = useCallback((x: number, animated: boolean) => {
        if (itemRef.current) {
            itemRef.current.style.transition = animated ? 'transform 0.2s cubic-bezier(0.22, 0.61, 0.36, 1)' : 'none';
            itemRef.current.style.transform = `translateX(${x}px)`;
        }
    }, []);

    const handlePointerDown = (e: React.PointerEvent) => {
        if ((e.target as HTMLElement).closest('button') || !itemRef.current) return;
        
        const transform = window.getComputedStyle(itemRef.current).transform;
        const currentTranslateX = new DOMMatrixReadOnly(transform).m41;
        
        dragState.current = {
            isDragging: true,
            isLocked: false,
            startX: e.clientX,
            startY: e.clientY,
            startTime: performance.now(),
            initialTranslateX: currentTranslateX,
        };
        
        setTranslateX(currentTranslateX, false);
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (!dragState.current.isDragging) return;

        const deltaX = e.clientX - dragState.current.startX;
        const deltaY = e.clientY - dragState.current.startY;

        if (!dragState.current.isLocked) {
          const SLOP = 10;
          if (Math.abs(deltaX) <= SLOP && Math.abs(deltaY) <= SLOP) {
            return;
          }

          const isHorizontal = Math.abs(deltaX) > Math.abs(deltaY);

          if (isHorizontal) {
            dragState.current.isLocked = true;
            onInteractionChange(true);
            e.stopPropagation();
            try { itemRef.current?.setPointerCapture(e.pointerId); } catch {}
          } else {
            dragState.current.isDragging = false;
            return;
          }
        }
        
        if (dragState.current.isLocked) {
            e.stopPropagation();
            let newX = dragState.current.initialTranslateX + deltaX;

            if (newX > 0) newX = 0;
            if (newX < -ACTION_WIDTH) newX = -ACTION_WIDTH - Math.tanh((-newX - ACTION_WIDTH) / 50) * 25;

            setTranslateX(newX, false);
        }
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        if (!dragState.current.isDragging || !itemRef.current) return;
    
        const wasLocked = dragState.current.isLocked;
        const deltaX = e.clientX - dragState.current.startX;
        const deltaY = e.clientY - dragState.current.startY;
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        const elapsed = performance.now() - dragState.current.startTime;
        const isTap = distance < 12 && elapsed < 250;
    
        dragState.current.isDragging = false;
        dragState.current.isLocked = false;
        if (wasLocked) {
            onInteractionChange(false);
            try { itemRef.current?.releasePointerCapture(e.pointerId); } catch {}
        }
    
        const wasOpen = Math.abs(dragState.current.initialTranslateX) > 1;
    
        if (isTap) {
            e.preventDefault();
            e.stopPropagation();
            if (wasOpen) {
                onOpen('');
            } else {
                onEdit(expense);
            }
            return;
        }
    
        if (wasLocked) {
            e.stopPropagation();
            const transform = window.getComputedStyle(itemRef.current).transform;
            const finalTranslateX = new DOMMatrixReadOnly(transform).m41;
    
            if (!wasOpen && deltaX > ACTION_WIDTH * 0.75) {
                 onNavigateHome();
                 onOpen(''); 
                 return;
            }
    
            const shouldOpen = finalTranslateX < -ACTION_WIDTH / 2;
            onOpen(shouldOpen ? expense.id : '');
            setTranslateX(shouldOpen ? -ACTION_WIDTH : 0, true);
        } else {
            // This case handles small drags that didn't lock: snap back.
            setTranslateX(isOpen ? -ACTION_WIDTH : 0, true);
        }
    };
    
    useEffect(() => {
        if (!dragState.current.isDragging) {
            setTranslateX(isOpen ? -ACTION_WIDTH : 0, true);
        }
    }, [isOpen, setTranslateX]);

    return (
        <div data-expense-item-root className="relative bg-white overflow-hidden">
            {/* Actions Layer (underneath) */}
            <div className="absolute top-0 right-0 h-full flex items-center z-0">
                <button
                    onPointerDown={(e) => e.preventDefault()}
                    onPointerUp={(e) => {
                      e.stopPropagation();
                      onDelete(expense.id);
                    }}
                    className="w-[72px] h-full flex flex-col items-center justify-center bg-red-500 text-white hover:bg-red-600 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white"
                    aria-label="Elimina spesa"
                >
                    <TrashIcon className="w-6 h-6" />
                    <span className="text-xs mt-1">Elimina</span>
                </button>
            </div>
            
            {/* Content Layer (swipeable) */}
            <div
                ref={itemRef}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                data-swipeable-item="true"
                className="relative flex items-center gap-4 py-3 px-4 bg-white z-10"
                style={{ touchAction: 'pan-y' }}
            >
                <span className={`w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center ${style.bgColor}`}>
                    <style.Icon className={`w-6 h-6 ${style.color}`} />
                </span>
                <div className="flex-grow min-w-0">
                    <p className="font-semibold text-slate-800 truncate">{expense.subcategory || style.label} • {accountName}</p>
                    <p className="text-sm text-slate-500 truncate" title={expense.description}>{expense.description || 'Senza descrizione'}</p>
                </div>
                <p className="font-bold text-slate-900 text-lg text-right shrink-0 whitespace-nowrap min-w-[90px]">{formatCurrency(Number(expense.amount) || 0)}</p>
            </div>
        </div>
    );
};

interface HistoryScreenProps {
  expenses: Expense[];
  accounts: Account[];
  onEditExpense: (expense: Expense) => void;
  onDeleteExpense: (id: string) => void;
  onItemStateChange: (state: { isOpen: boolean, isInteracting: boolean }) => void;
  isEditingOrDeleting: boolean;
  onNavigateHome: () => void;
  isActive: boolean;
  onDateModalStateChange: (isOpen: boolean) => void;
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

const getWeekLabel = (year: number, week: number): string => {
    const now = new Date();
    const [currentYear, currentWeek] = getISOWeek(now);

    if (year === currentYear) {
        if (week === currentWeek) return "Questa Settimana";
        if (week === currentWeek - 1) return "Settimana Scorsa";
    }

    return `Settimana ${week}, ${year}`;
};

const parseLocalYYYYMMDD = (dateString: string): Date => {
    const parts = dateString.split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
};


const HistoryScreen: React.FC<HistoryScreenProps> = ({ expenses, accounts, onEditExpense, onDeleteExpense, onItemStateChange, isEditingOrDeleting, onNavigateHome, isActive, onDateModalStateChange }) => {
    const [dateFilter, setDateFilter] = useState<DateFilter>('all');
    const [customRange, setCustomRange] = useState<{ start: string | null, end: string | null }>({ start: null, end: null });
    const [openItemId, setOpenItemId] = useState<string | null>(null);
    const [isInteracting, setIsInteracting] = useState(false);
    const autoCloseTimerRef = useRef<number | null>(null);

    const prevIsEditingOrDeleting = useRef(isEditingOrDeleting);
    useEffect(() => {
        if (prevIsEditingOrDeleting.current && !isEditingOrDeleting) {
            setOpenItemId(null);
        }
        prevIsEditingOrDeleting.current = isEditingOrDeleting;
    }, [isEditingOrDeleting]);

    useEffect(() => {
        if (!isActive) {
            setOpenItemId(null);
        }
    }, [isActive]);

    useEffect(() => {
        onItemStateChange({ isOpen: openItemId !== null, isInteracting });
    }, [openItemId, isInteracting, onItemStateChange]);

    useEffect(() => {
        if (autoCloseTimerRef.current) {
            clearTimeout(autoCloseTimerRef.current);
        }
        if (openItemId && !isEditingOrDeleting) {
            autoCloseTimerRef.current = window.setTimeout(() => {
                setOpenItemId(null);
            }, 5000);
        }
        return () => {
            if (autoCloseTimerRef.current) {
                clearTimeout(autoCloseTimerRef.current);
            }
        };
    }, [openItemId, isEditingOrDeleting]);

    const isCustomRangeActive = customRange.start !== null && customRange.end !== null;
    
    const filteredExpenses = useMemo(() => {
        if (isCustomRangeActive) {
             const startTime = parseLocalYYYYMMDD(customRange.start!).getTime();
             const endDay = parseLocalYYYYMMDD(customRange.end!);
             endDay.setDate(endDay.getDate() + 1);
             const endTime = endDay.getTime();

             return expenses.filter(e => {
                const expenseDate = parseLocalYYYYMMDD(e.date);
                if (isNaN(expenseDate.getTime())) return false;
                const expenseTime = expenseDate.getTime();
                return expenseTime >= startTime && expenseTime < endTime;
             });
        }
        
        if (dateFilter === 'all') {
            return expenses;
        }

        const startDate = new Date();
        startDate.setHours(0, 0, 0, 0); 

        switch (dateFilter) {
            case '7d':
                startDate.setDate(startDate.getDate() - 6);
                break;
            case '30d':
                startDate.setDate(startDate.getDate() - 29);
                break;
            case '6m':
                startDate.setMonth(startDate.getMonth() - 6);
                break;
            case '1y':
                startDate.setFullYear(startDate.getFullYear() - 1);
                break;
        }

        const startTime = startDate.getTime();

        return expenses.filter(e => {
            const expenseDate = parseLocalYYYYMMDD(e.date);
            return !isNaN(expenseDate.getTime()) && expenseDate.getTime() >= startTime;
        });
    }, [expenses, dateFilter, customRange, isCustomRangeActive]);

    const groupedExpenses = useMemo(() => {
        const sortedExpenses = [...filteredExpenses].sort((a, b) => {
            const dateB = parseLocalYYYYMMDD(b.date);
            const dateA = parseLocalYYYYMMDD(a.date);

            if (b.time) {
                const [h, m] = b.time.split(':').map(Number);
                if (!isNaN(h) && !isNaN(m)) dateB.setHours(h, m);
            }
            if (a.time) {
                const [h, m] = a.time.split(':').map(Number);
                if (!isNaN(h) && !isNaN(m)) dateA.setHours(h, m);
            }

            return dateB.getTime() - dateA.getTime();
        });
    
        return sortedExpenses.reduce<Record<string, ExpenseGroup>>((acc, expense) => {
            const expenseDate = parseLocalYYYYMMDD(expense.date);
            if (isNaN(expenseDate.getTime())) return acc;
    
            const [year, week] = getISOWeek(expenseDate);
            const key = `${year}-${week}`;
    
            if (!acc[key]) {
                acc[key] = {
                    year,
                    week,
                    label: getWeekLabel(year, week),
                    expenses: []
                };
            }
            acc[key].expenses.push(expense);
            return acc;
        }, {} as Record<string, ExpenseGroup>);
    }, [filteredExpenses]);

    const expenseGroups = (Object.values(groupedExpenses) as ExpenseGroup[]).sort((a, b) => {
        if (a.year !== b.year) return b.year - a.year;
        return b.week - a.week;
    });
    
    const handleOpenItem = (id: string) => {
        setOpenItemId(id);
    };
    
    const handleInteractionChange = (isInteracting: boolean) => {
        setIsInteracting(isInteracting);
    };
    
    return (
        <div 
            className="h-full flex flex-col bg-slate-100"
        >
            <div className="flex-1 overflow-y-auto" style={{ touchAction: 'pan-y' }}>
                {expenseGroups.length > 0 ? (
                    expenseGroups.map(group => (
                        <div key={group.label} className="mb-6 last:mb-0">
                            <h2 className="font-bold text-slate-800 text-lg px-4 py-2 sticky top-0 bg-slate-100/80 backdrop-blur-sm z-10">{group.label}</h2>
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
                                            onNavigateHome={onNavigateHome}
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
                onSelectQuickFilter={(value) => {
                    setDateFilter(value);
                    setCustomRange({ start: null, end: null });
                }}
                currentQuickFilter={dateFilter}
                onCustomRangeChange={(range) => {
                    setCustomRange(range);
                    setDateFilter('all');
                }}
                currentCustomRange={customRange}
                isCustomRangeActive={isCustomRangeActive}
                onDateModalStateChange={onDateModalStateChange}
            />
        </div>
    );
};

export default HistoryScreen;
```


---

## `./screens/LoginScreen.tsx`

```tsx
import React, { useState, useEffect } from 'react';
import AuthLayout from '../components/auth/AuthLayout';
import PinInput from '../components/auth/PinInput';
import { login } from '../utils/api';
import { SpinnerIcon } from '../components/icons/SpinnerIcon';
import { useLocalStorage } from '../hooks/useLocalStorage';
import LoginEmail from '../components/auth/LoginEmail';

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

  useEffect(() => {
    if (pin.length === 4 && activeEmail) {
      handlePinVerify();
    }
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

  const handleSwitchUser = () => {
    setActiveEmail(null);
    setPin('');
    setError(null);
  };

  const renderContent = () => {
    // —— SCHERMATA EMAIL ——
    if (!activeEmail) {
      return (
        <div className="text-center">
          <h2 className="text-xl font-bold text-slate-800 mb-2">Bentornato!</h2>
          <p className="text-slate-500 mb-6">Inserisci la tua email per continuare.</p>

          {/* Il bottone "Continua" è dentro LoginEmail */}
          <LoginEmail onSubmit={handleEmailSubmit} />

          {/* Subito sotto il bottone "Continua" */}
          <div className="mt-3">
            <button
              onClick={onGoToForgotEmail}
              className="text-sm font-semibold text-indigo-600 hover:text-indigo-500"
            >
              Email dimenticata?
            </button>
          </div>

          {/* E POI il link registrazione */}
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
            error || 'Inserisci il tuo PIN di 4 cifre.'
          )}
        </p>

        <PinInput pin={pin} onPinChange={setPin} />

        <div className="mt-4 flex flex-col sm:flex-row justify-between items-center gap-2">
          <button
            onClick={handleSwitchUser}
            className="text-sm font-semibold text-slate-500 hover:text-slate-800"
          >
            Cambia Utente
          </button>
          {/* Qui resta solo il reset PIN */}
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
import { PhoneIcon } from '../components/icons/PhoneIcon';
import { SpinnerIcon } from '../components/icons/SpinnerIcon';

interface SetupScreenProps {
  onSetupSuccess: (token: string, email: string) => void;
  onGoToLogin: () => void;
}

const SetupScreen: React.FC<SetupScreenProps> = ({ onSetupSuccess, onGoToLogin }) => {
  const [step, setStep] = useState<'email' | 'pin_setup' | 'pin_confirm'>('email');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleEmailSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (email.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError(null);
      setStep('pin_setup');
    } else {
      setError('Inserisci un indirizzo email valido.');
    }
  };
  
  const handleRegister = async () => {
    setIsLoading(true);
    setError(null);
    const normalizedEmail = email.toLowerCase();
    const regResponse = await register(normalizedEmail, pin, phoneNumber);
    if (regResponse.success) {
      // Login automatico dopo la registrazione
      const loginResponse = await login(normalizedEmail, pin);
      if (loginResponse.success && loginResponse.token) {
        onSetupSuccess(loginResponse.token, normalizedEmail);
      } else {
        setIsLoading(false);
        setError('Login automatico fallito. Vai alla pagina di login.');
        setTimeout(() => onGoToLogin(), 2000);
      }
    } else {
      setError(regResponse.message);
      setIsLoading(false);
       setTimeout(() => {
          setPin('');
          setConfirmPin('');
          setError(null);
          setStep('email');
       }, 2000);
    }
  };
  
  useEffect(() => {
    if (step === 'pin_setup' && pin.length === 4) {
      setStep('pin_confirm');
    }
  }, [pin, step]);

  useEffect(() => {
    if (step === 'pin_confirm' && confirmPin.length === 4) {
      if (pin === confirmPin) {
        setError(null);
        handleRegister();
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
  }, [confirmPin, pin, step]);
  
  const inputStyles = "block w-full rounded-md border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 sm:text-sm";
  
  const renderContent = () => {
    if (isLoading) {
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
                <div>
                   <label htmlFor="phone-register" className="sr-only">Numero di telefono (opzionale)</label>
                   <div className="relative">
                      <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                          <PhoneIcon className="h-5 w-5 text-slate-400" aria-hidden="true" />
                      </div>
                      <input
                          type="tel"
                          id="phone-register"
                          value={phoneNumber}
                          onChange={(e) => setPhoneNumber(e.target.value)}
                          className={inputStyles}
                          placeholder="Telefono (opzionale per recupero)"
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
              Hai già un account?{' '}
              <button onClick={onGoToLogin} className="font-semibold text-indigo-600 hover:text-indigo-500">
                Accedi
              </button>
            </p>
          </div>
        );
        
      case 'pin_setup':
      case 'pin_confirm':
        const isConfirming = step === 'pin_confirm';
        return (
          <div className="text-center">
            <h2 className="text-xl font-bold text-slate-800 mb-2">{isConfirming ? 'Conferma il tuo PIN' : 'Crea un PIN di 4 cifre'}</h2>
            <p className={`text-slate-500 h-10 flex items-center justify-center transition-colors ${error ? 'text-red-500' : ''}`}>
                {error || (isConfirming ? 'Inseriscilo di nuovo per conferma.' : 'Servirà per accedere al tuo account.')}
            </p>
            <PinInput 
                pin={isConfirming ? confirmPin : pin} 
                onPinChange={isConfirming ? setConfirmPin : setPin} 
            />
          </div>
        );
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

const CACHE_NAME = 'expense-manager-cache-v31';
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
  date: string;
  time?: string;
  category: string;
  subcategory?: string;
  accountId: string;
  frequency?: 'single' | 'recurring';
  recurrence?: 'daily' | 'weekly' | 'monthly' | 'yearly';
  recurrenceInterval?: number;
  recurrenceEndType?: 'forever' | 'date' | 'count';
  recurrenceEndDate?: string;
  recurrenceCount?: number;
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

import { GoogleGenAI, Type, FunctionDeclaration, LiveSession, Modality, Blob, LiveServerMessage } from '@google/genai';
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

export async function createLiveSession(callbacks: {
    onopen?: () => void,
    onmessage?: (message: LiveServerMessage) => void,
    onerror?: (e: ErrorEvent) => void,
    onclose?: (e: CloseEvent) => void
}): Promise<LiveSession> {
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
  pin: string,
  phoneNumber?: string
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
      users[normalizedEmail] = { email: normalizedEmail, pinHash: hash, pinSalt: salt, phoneNumber: phoneNumber || null };
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

/** Recupero email da telefono (mock). */
export const findEmailByPhoneNumber = async (
  phoneNumber: string
): Promise<{ success: boolean; message: string }> => {
  return new Promise(resolve => {
    setTimeout(() => {
      const users = getUsers();
      const foundUser = Object.values(users).find((user: any) => (user as any).phoneNumber === phoneNumber);
      if (foundUser) {
        console.log(`(SIMULAZIONE) SMS a ${phoneNumber} con email: ${(foundUser as any).email}`);
      } else {
        console.log(`(SIMULAZIONE) Numero non registrato: ${phoneNumber}`);
      }
      resolve({ success: true, message: 'Se il numero è associato a un account, riceverai un SMS con la tua email.' });
    }, 1500);
  });
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
