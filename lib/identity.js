const colapsarEspacios = (value = '') =>
  String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');

export const normalizarNombreVisible = (value = '') => colapsarEspacios(value);

export const normalizarNombreKey = (value = '') =>
  colapsarEspacios(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

export const mismoNombreActivador = (a = '', b = '') => {
  const ak = normalizarNombreKey(a);
  const bk = normalizarNombreKey(b);
  return !!ak && !!bk && ak === bk;
};
