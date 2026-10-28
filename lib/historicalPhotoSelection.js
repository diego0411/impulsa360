const nombreArchivo = (path) => String(path || '').split('/').filter(Boolean).pop()?.toLowerCase() || '';

const NOMBRES_PRINCIPAL = new Set(['principal.jpg', 'foto.jpg', 'foto_url.jpg']);
const NOMBRES_CASH_IN = new Set(['cash-in.jpg', 'cash_in.jpg', 'foto_cash_in.jpg']);

const esCandidatoFotoHistoricaSeguro = ({ path, key, recordIds = [] }) => {
  const nombre = nombreArchivo(path);
  if (key === 'foto_cash_in') return NOMBRES_CASH_IN.has(nombre);
  if (key !== 'foto_url' || NOMBRES_CASH_IN.has(nombre)) return false;
  if (NOMBRES_PRINCIPAL.has(nombre)) return true;

  return recordIds.some((id) => {
    const base = `activaciones/${id}`.toLowerCase();
    const candidate = String(path || '').toLowerCase();
    return candidate === `${base}.jpg` || candidate === `${base}_respaldo.jpg`;
  });
};

const encontrarFotoHistoricaSegura = async ({ candidates, key, recordIds, existe }) => {
  for (const candidate of candidates) {
    if (!esCandidatoFotoHistoricaSeguro({ path: candidate, key, recordIds })) continue;
    if (await existe(candidate)) return candidate;
  }
  return '';
};

module.exports = {
  encontrarFotoHistoricaSegura,
  esCandidatoFotoHistoricaSeguro,
};
