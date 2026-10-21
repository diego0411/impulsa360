const PERIODO_MES_ACTUAL = 'mes_actual';
const PERIODO_MES_ANTERIOR = 'mes_anterior';

const MESES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

const pad = (value) => String(value).padStart(2, '0');

const parseFechaCalendario = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) throw new Error('La fecha de referencia mensual no es valida.');
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || month < 1 || month > 12) {
    throw new Error('La fecha de referencia mensual no es valida.');
  }
  return { year, month };
};

const desplazarMes = (year, month, offset) => {
  const index = year * 12 + month - 1 + offset;
  return {
    year: Math.floor(index / 12),
    month: ((index % 12) + 12) % 12 + 1,
  };
};

const resolverPeriodoMensual = (periodo, fechaReferenciaBolivia) => {
  const periodoNormalizado = periodo === PERIODO_MES_ANTERIOR
    ? PERIODO_MES_ANTERIOR
    : PERIODO_MES_ACTUAL;
  const referencia = parseFechaCalendario(fechaReferenciaBolivia);
  const { year, month } = desplazarMes(
    referencia.year,
    referencia.month,
    periodoNormalizado === PERIODO_MES_ANTERIOR ? -1 : 0,
  );
  const siguiente = desplazarMes(year, month, 1);
  const ultimoDia = new Date(Date.UTC(year, month, 0)).getUTCDate();

  return {
    periodo: periodoNormalizado,
    desde: `${year}-${pad(month)}-01`,
    hasta: `${year}-${pad(month)}-${pad(ultimoDia)}`,
    hastaExclusivo: `${siguiente.year}-${pad(siguiente.month)}-01`,
    etiqueta: `${MESES[month - 1]} ${year}`,
  };
};

const crearOpcionesPeriodoMensual = (fechaReferenciaBolivia) => {
  const actual = resolverPeriodoMensual(PERIODO_MES_ACTUAL, fechaReferenciaBolivia);
  const anterior = resolverPeriodoMensual(PERIODO_MES_ANTERIOR, fechaReferenciaBolivia);
  return [
    { label: `Mes actual · ${actual.etiqueta}`, value: PERIODO_MES_ACTUAL },
    { label: `Mes anterior · ${anterior.etiqueta}`, value: PERIODO_MES_ANTERIOR },
  ];
};

const fechaEnPeriodoMensual = (value, periodo) => {
  const fecha = String(value || '').slice(0, 10);
  return !!fecha
    && !!periodo?.desde
    && !!periodo?.hasta
    && fecha >= periodo.desde
    && fecha <= periodo.hasta;
};

module.exports = {
  PERIODO_MES_ACTUAL,
  PERIODO_MES_ANTERIOR,
  crearOpcionesPeriodoMensual,
  fechaEnPeriodoMensual,
  resolverPeriodoMensual,
};
