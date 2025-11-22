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
      className={`fixed inset-0 z-50 flex justify-center items-start p-4 transition-opacity duration-75 ease-in-out ${isAnimating ? 'opacity-100' : 'opacity-0'} bg-slate-900/60 backdrop-blur-sm overflow-y-auto`}
      onClick={onClose}
      aria-modal="true"
      role="dialog"
    >
      <div
        className={`bg-slate-50 rounded-lg shadow-xl w-full max-w-3xl my-8 transform transition-all duration-75 ease-in-out ${isAnimating ? 'scale-100 opacity-100' : 'scale-95 opacity-0'}`}
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