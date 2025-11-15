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