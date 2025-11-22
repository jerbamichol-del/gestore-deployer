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