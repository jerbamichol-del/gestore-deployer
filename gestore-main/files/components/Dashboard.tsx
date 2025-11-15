
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