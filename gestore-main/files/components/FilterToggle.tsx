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