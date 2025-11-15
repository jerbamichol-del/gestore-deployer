

export const formatCurrency = (amount: number): string => {
  const numericAmount = (typeof amount === 'number' && !isNaN(amount)) ? amount : 0;

  const isInteger = numericAmount % 1 === 0;

  const options: Intl.NumberFormatOptions = {
    style: 'decimal',
  };

  if (isInteger) {
    options.minimumFractionDigits = 0;
    options.maximumFractionDigits = 0;
  } else {
    options.minimumFractionDigits = 2;
    options.maximumFractionDigits = 2;
  }

  const formattedAmount = new Intl.NumberFormat('it-IT', options).format(numericAmount);
  return `€ ${formattedAmount}`;
};

export const formatDate = (date: Date): string => {
  const options: Intl.DateTimeFormatOptions = {
    year: '2-digit',
    month: 'short',
    day: 'numeric',
  };
  const formatter = new Intl.DateTimeFormat('it-IT', options);
  // Usiamo formatToParts per poter aggiungere il punto al mese abbreviato.
  // Questo approccio è robusto e rispetta l'ordine dei componenti della data per la lingua specificata.
  return formatter.formatToParts(date).map(({ type, value }) => {
    if (type === 'month') {
      return `${value}.`;
    }
    return value;
  }).join('');
};
