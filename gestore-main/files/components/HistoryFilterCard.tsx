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
