const TIME_ZONE = 'America/La_Paz';

const formatter = new globalThis.Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

const partesBolivia = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = formatter.formatToParts(date);
  return parts.reduce((result, part) => {
    if (part.type !== 'literal') result[part.type] = part.value;
    return result;
  }, {});
};

export const fechaBolivia = (value = new Date()) => {
  const parts = partesBolivia(value);
  if (!parts?.year || !parts?.month || !parts?.day) return '';
  return `${parts.year}-${parts.month}-${parts.day}`;
};

export const milisegundosHastaSiguienteDiaBolivia = (value = new Date()) => {
  const parts = partesBolivia(value);
  if (!parts) return 60 * 1000;
  const elapsed = (
    Number(parts.hour || 0) * 60 * 60 * 1000
    + Number(parts.minute || 0) * 60 * 1000
    + Number(parts.second || 0) * 1000
    + new Date(value).getMilliseconds()
  );
  return Math.max(1000, 24 * 60 * 60 * 1000 - elapsed + 50);
};
