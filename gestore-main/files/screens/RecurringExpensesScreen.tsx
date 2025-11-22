
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
