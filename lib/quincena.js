export const fechaLocalIso = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const obtenerQuincenaActual = (baseDate = new Date()) => {
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth();
  const day = baseDate.getDate();
  const desde = new Date(year, month, day <= 15 ? 1 : 16);
  const hasta = new Date(year, month + 1, 0);

  if (day <= 15) {
    hasta.setDate(15);
  }
  const hastaExclusivo = new Date(hasta);
  hastaExclusivo.setDate(hasta.getDate() + 1);

  return {
    desde: fechaLocalIso(desde),
    hasta: fechaLocalIso(hasta),
    hastaExclusivo: fechaLocalIso(hastaExclusivo),
  };
};

export const fechaEnRango = (value, { desde, hasta }) => {
  const fecha = String(value || '').slice(0, 10);
  if (!fecha) return false;
  if (desde && fecha < desde) return false;
  if (hasta && fecha > hasta) return false;
  return true;
};
