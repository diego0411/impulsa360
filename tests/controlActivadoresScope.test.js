const test = require('node:test');
const assert = require('node:assert/strict');
const { resolverConsultaDetalleMetricas } = require('../lib/controlActivadoresScope');

const USUARIO_ID = '11111111-1111-4111-8111-111111111111';
const ACTIVADOR_ID = '22222222-2222-4222-8222-222222222222';
const EQUIPO_ID = '33333333-3333-4333-8333-333333333333';

test('metricas personales usan el usuario autenticado y no el valor simbolico de equipo', () => {
  assert.deepEqual(
    resolverConsultaDetalleMetricas({
      vistaPersonal: true,
      usuarioId: USUARIO_ID,
      equipoId: 'propio',
      activadorId: ACTIVADOR_ID,
    }),
    { tipo: 'personal', usuarioId: USUARIO_ID },
  );
});

test('metricas de equipo conservan sus UUID para la RPC', () => {
  assert.deepEqual(
    resolverConsultaDetalleMetricas({
      vistaPersonal: false,
      usuarioId: USUARIO_ID,
      equipoId: EQUIPO_ID,
      activadorId: ACTIVADOR_ID,
    }),
    { tipo: 'equipo', equipoId: EQUIPO_ID, activadorId: ACTIVADOR_ID },
  );
});

test('un valor simbolico nunca puede convertirse en parametro UUID de equipo', () => {
  assert.throws(
    () => resolverConsultaDetalleMetricas({
      vistaPersonal: false,
      usuarioId: USUARIO_ID,
      equipoId: 'propio',
      activadorId: ACTIVADOR_ID,
    }),
    /equipoId no contiene un UUID válido/,
  );
});
