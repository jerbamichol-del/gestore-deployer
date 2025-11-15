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