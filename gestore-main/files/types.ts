

export interface Account {
  id: string;
  name: string;
}

export interface Expense {
  id:string;
  description: string;
  amount: number;
  date: string; // For recurring templates, this is the start date
  time?: string;
  category: string;
  subcategory?: string;
  accountId: string;
  frequency?: 'single' | 'recurring';
  recurrence?: 'daily' | 'weekly' | 'monthly' | 'yearly';
  monthlyRecurrenceType?: 'dayOfMonth' | 'dayOfWeek';
  recurrenceInterval?: number;
  recurrenceDays?: number[]; // 0 for Sunday, 1 for Monday, etc.
  recurrenceEndType?: 'forever' | 'date' | 'count';
  recurrenceEndDate?: string;
  recurrenceCount?: number;
  recurringExpenseId?: string; // Links an instance to its template
  lastGeneratedDate?: string; // For templates, tracks the last generation date
}

export const CATEGORIES: Record<string, string[]> = {
  'Alimentari': ['Supermercato', 'Ristorante', 'Bar', 'Caffè'],
  'Trasporti': ['Mezzi Pubblici', 'Benzina', 'Taxi', 'Manutenzione Auto'],
  'Casa': ['Affitto/Mutuo', 'Bollette', 'Manutenzione', 'Arredamento'],
  'Shopping': ['Abbigliamento', 'Elettronica', 'Libri', 'Regali'],
  'Tempo Libero': ['Cinema', 'Concerti', 'Sport', 'Viaggi'],
  'Salute': ['Farmacia', 'Visite Mediche', 'Assicurazione'],
  'Istruzione': ['Corsi', 'Libri', 'Tasse Scolastiche'],
  'Lavoro': ['Pranzi', 'Materiale Ufficio'],
  'Altro': [],
};
