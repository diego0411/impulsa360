const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PERIODO_MES_ACTUAL,
  PERIODO_MES_ANTERIOR,
  crearOpcionesPeriodoMensual,
  fechaEnPeriodoMensual,
  resolverPeriodoMensual,
} = require('../lib/periodoMensual');

test('resuelve febrero de 28 dias', () => {
  assert.deepEqual(
    resolverPeriodoMensual(PERIODO_MES_ACTUAL, '2026-02-14'),
    {
      periodo: PERIODO_MES_ACTUAL,
      desde: '2026-02-01',
      hasta: '2026-02-28',
      hastaExclusivo: '2026-03-01',
      etiqueta: 'Febrero 2026',
    },
  );
});

test('resuelve febrero bisiesto de 29 dias', () => {
  assert.equal(
    resolverPeriodoMensual(PERIODO_MES_ACTUAL, '2024-02-20').hasta,
    '2024-02-29',
  );
});

test('resuelve meses de 30 y 31 dias', () => {
  assert.equal(
    resolverPeriodoMensual(PERIODO_MES_ACTUAL, '2026-04-10').hasta,
    '2026-04-30',
  );
  assert.equal(
    resolverPeriodoMensual(PERIODO_MES_ACTUAL, '2026-10-16').hasta,
    '2026-10-31',
  );
});

test('enero consulta diciembre inmediato del ano anterior', () => {
  assert.deepEqual(
    resolverPeriodoMensual(PERIODO_MES_ANTERIOR, '2026-01-08'),
    {
      periodo: PERIODO_MES_ANTERIOR,
      desde: '2025-12-01',
      hasta: '2025-12-31',
      hastaExclusivo: '2026-01-01',
      etiqueta: 'Diciembre 2025',
    },
  );
});

test('expone unicamente mes actual y mes anterior', () => {
  const opciones = crearOpcionesPeriodoMensual('2026-10-16');
  assert.deepEqual(opciones.map((item) => item.value), [
    PERIODO_MES_ACTUAL,
    PERIODO_MES_ANTERIOR,
  ]);
  assert.deepEqual(opciones.map((item) => item.label), [
    'Mes actual · Octubre 2026',
    'Mes anterior · Septiembre 2026',
  ]);
});

test('el KPI mensual usa el periodo seleccionado y no el mes de hoy', () => {
  const septiembre = resolverPeriodoMensual(PERIODO_MES_ANTERIOR, '2026-10-16');
  assert.equal(fechaEnPeriodoMensual('2026-09-01', septiembre), true);
  assert.equal(fechaEnPeriodoMensual('2026-09-30', septiembre), true);
  assert.equal(fechaEnPeriodoMensual('2026-10-01', septiembre), false);
});
