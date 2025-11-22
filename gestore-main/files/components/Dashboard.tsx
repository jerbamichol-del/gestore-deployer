
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
