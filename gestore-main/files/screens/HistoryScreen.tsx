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