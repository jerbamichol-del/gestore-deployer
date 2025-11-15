
import React from 'react';
import { AllIcon } from '../components/icons/categories/AllIcon';
import { FoodIcon } from '../components/icons/categories/FoodIcon';
import { TransportIcon } from '../components/icons/categories/TransportIcon';
import { HomeIcon } from '../components/icons/categories/HomeIcon';
import { ShoppingIcon } from '../components/icons/categories/ShoppingIcon';
import { LeisureIcon } from '../components/icons/categories/LeisureIcon';
import { HealthIcon } from '../components/icons/categories/HealthIcon';
import { EducationIcon } from '../components/icons/categories/EducationIcon';
import { WorkIcon } from '../components/icons/categories/WorkIcon';
import { OtherIcon } from '../components/icons/categories/OtherIcon';

interface CategoryStyle {
    label: string;
    Icon: React.FC<React.SVGProps<SVGSVGElement>>;
    color: string;
    bgColor: string;
}

export const categoryStyles: Record<string, CategoryStyle> = {
    'all': {
        label: 'Tutte',
        Icon: AllIcon,
        color: 'text-slate-600',
        bgColor: 'bg-slate-200',
    },
    'Alimentari': {
        label: 'Alimentari',
        Icon: FoodIcon,
        color: 'text-green-600',
        bgColor: 'bg-green-100',
    },
    'Trasporti': {
        label: 'Trasporti',
        Icon: TransportIcon,
        color: 'text-blue-600',
        bgColor: 'bg-blue-100',
    },
    'Casa': {
        label: 'Casa',
        Icon: HomeIcon,
        color: 'text-orange-600',
        bgColor: 'bg-orange-100',
    },
    'Shopping': {
        label: 'Shopping',
        Icon: ShoppingIcon,
        color: 'text-pink-600',
        bgColor: 'bg-pink-100',
    },
    'Tempo Libero': {
        label: 'Tempo Libero',
        Icon: LeisureIcon,
        color: 'text-purple-600',
        bgColor: 'bg-purple-100',
    },
    'Salute': {
        label: 'Salute',
        Icon: HealthIcon,
        color: 'text-red-600',
        bgColor: 'bg-red-100',
    },
    'Istruzione': {
        label: 'Istruzione',
        Icon: EducationIcon,
        color: 'text-yellow-600',
        bgColor: 'bg-yellow-100',
    },
    'Lavoro': {
        label: 'Lavoro',
        Icon: WorkIcon,
        color: 'text-indigo-600',
        bgColor: 'bg-indigo-100',
    },
    'Altro': {
        label: 'Altro',
        Icon: OtherIcon,
        color: 'text-gray-600',
        bgColor: 'bg-gray-200',
    },
};

export const getCategoryStyle = (category: string | 'all'): CategoryStyle => {
    return categoryStyles[category] || categoryStyles['Altro'];
};