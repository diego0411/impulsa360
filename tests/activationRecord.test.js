const test = require('node:test');
const assert = require('node:assert/strict');

const {
  completarIdentidadSincronizacion,
  construirPayloadSincronizacionActivacion,
} = require('../lib/activationRecord');

test('conserva el impulsador persistido aunque cambie el nombre de sesión', () => {
  const payload = construirPayloadSincronizacionActivacion({
    id: 'registro-1',
    impulsador: 'Nombre Original',
  });
  const remoto = completarIdentidadSincronizacion(payload, {
    ownerId: 'usuario-1',
    nombreImpulsador: 'Nombre Actual',
    email: 'actual@example.com',
  });

  assert.equal(remoto.impulsador, 'Nombre Original');
  assert.equal(remoto.usuario_id, 'usuario-1');
});

test('un histórico sin impulsador usa los fallbacks actuales', () => {
  const ausente = completarIdentidadSincronizacion(
    construirPayloadSincronizacionActivacion({ id: 'registro-2' }),
    { ownerId: 'usuario-2', nombreImpulsador: 'Nombre Actual', email: 'actual@example.com' },
  );
  const vacio = completarIdentidadSincronizacion(
    construirPayloadSincronizacionActivacion({ id: 'registro-3', impulsador: '   ' }),
    { ownerId: 'usuario-3', nombreImpulsador: '', email: 'legacy@example.com' },
  );

  assert.equal(ausente.impulsador, 'Nombre Actual');
  assert.equal(vacio.impulsador, 'legacy@example.com');
});

test('el nombre persistido nunca modifica la identidad propietaria', () => {
  const remoto = completarIdentidadSincronizacion({
    impulsador: 'Nombre Persistido',
    usuario_id: 'usuario-ajeno',
  }, {
    ownerId: 'usuario-autenticado',
    nombreImpulsador: 'Nombre Sesión',
  });

  assert.equal(remoto.impulsador, 'Nombre Persistido');
  assert.equal(remoto.usuario_id, 'usuario-autenticado');
});
