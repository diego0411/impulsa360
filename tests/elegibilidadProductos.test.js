const test = require('node:test');
const assert = require('node:assert/strict');

const { resolverElegibilidadProductos } = require('../lib/elegibilidadProductos');

test('Créditos se habilita en todos los subtipos de Tienda de Barrio y en las reglas existentes', () => {
  const creditos = [
    ['tienda_barrio', 'comercio'],
    ['tienda_barrio', 'no_habilitado'],
    ['tienda_barrio', 'reactivacion'],
    ['tienda_barrio', 'config_cuenta'],
    ['tienda_barrio', 'reimpresion_qr'],
    ['comercio', 'reactivacion_comercio'],
    ['comercio', 'reimpresion_qr'],
    ['transeunte', 'reactivacion_transeunte'],
    ['transeunte', 'cliente_antiguo'],
    ['cliente_antiguo', 'cliente_antiguo'],
  ];
  for (const [tipoGrupo, tipoActivacion] of creditos) {
    assert.equal(
      resolverElegibilidadProductos({ tipoGrupo, tipoActivacion }).creditos,
      true,
      `créditos debería habilitarse en ${tipoGrupo}/${tipoActivacion}`,
    );
  }
});

test('Créditos conserva deshabilitado en Comercio sin reactivación y en Transeúnte nuevo', () => {
  const sinCreditos = [
    ['comercio', 'comercio'],
    ['comercio', 'limbo'],
    ['comercio', 'no_habilitado'],
    ['transeunte', 'transeunte'],
  ];
  for (const [tipoGrupo, tipoActivacion] of sinCreditos) {
    assert.equal(
      resolverElegibilidadProductos({ tipoGrupo, tipoActivacion }).creditos,
      false,
      `créditos NO debe habilitarse en ${tipoGrupo}/${tipoActivacion}`,
    );
  }
});

test('Remesas se habilita en todos los subtipos de Tienda de Barrio', () => {
  const tiendaBarrio = [
    ['tienda_barrio', 'comercio'],
    ['tienda_barrio', 'no_habilitado'],
    ['tienda_barrio', 'reactivacion'],
    ['tienda_barrio', 'config_cuenta'],
    ['tienda_barrio', 'reimpresion_qr'],
  ];
  for (const [tipoGrupo, tipoActivacion] of tiendaBarrio) {
    assert.equal(
      resolverElegibilidadProductos({ tipoGrupo, tipoActivacion }).remesas,
      true,
      `remesas debería habilitarse en ${tipoGrupo}/${tipoActivacion}`,
    );
  }
});

test('Remesas se habilita en Transeúnte vigente y Comercio (nuevo y limbo)', () => {
  const remesas = [
    ['transeunte', 'transeunte'],
    ['transeunte', 'reactivacion_transeunte'],
    ['comercio', 'comercio'],
    ['comercio', 'limbo'],
  ];
  for (const [tipoGrupo, tipoActivacion] of remesas) {
    assert.equal(
      resolverElegibilidadProductos({ tipoGrupo, tipoActivacion }).remesas,
      true,
      `remesas debería habilitarse en ${tipoGrupo}/${tipoActivacion}`,
    );
  }
});

test('Remesas conserva deshabilitado en Comercio no nuevo, Cliente antiguo y Transeúnte legacy', () => {
  const sinRemesas = [
    ['comercio', 'reactivacion_comercio'],
    ['comercio', 'no_habilitado'],
    ['comercio', 'reimpresion_qr'],
    ['cliente_antiguo', 'cliente_antiguo'],
    ['transeunte', 'cliente_antiguo'],
  ];
  for (const [tipoGrupo, tipoActivacion] of sinRemesas) {
    assert.equal(
      resolverElegibilidadProductos({ tipoGrupo, tipoActivacion }).remesas,
      false,
      `remesas NO debe habilitarse en ${tipoGrupo}/${tipoActivacion}`,
    );
  }
});

test('casos ambiguos, desconocidos o vacíos quedan con ambos deshabilitados', () => {
  const ambiguos = [
    {},
    { tipoGrupo: 'comercio', tipoActivacion: 'comercio', extra: true },
    { tipoGrupo: 'comercio', tipoActivacion: 'no_habilitado' },
    { tipoGrupo: 'tienda_barrio', tipoActivacion: 'desconocido' },
    { tipoGrupo: 'transeunte', tipoActivacion: 'desconocido' },
    { tipoGrupo: 'nuevo_grupo', tipoActivacion: 'nuevo_tipo' },
  ];
  for (const caso of ambiguos) {
    const esperado = caso.tipoGrupo === 'comercio' && caso.tipoActivacion === 'comercio'
      ? { creditos: false, remesas: true }
      : { creditos: false, remesas: false };
    assert.deepEqual(resolverElegibilidadProductos(caso), esperado);
  }
  assert.deepEqual(resolverElegibilidadProductos(), { creditos: false, remesas: false });
});

test('normaliza mayúsculas y espacios y es compatible con datos históricos sin propiedades', () => {
  assert.deepEqual(
    resolverElegibilidadProductos({ tipoGrupo: ' Comercio ', tipoActivacion: 'COMERCIO' }),
    { creditos: false, remesas: true },
  );
  assert.deepEqual(
    resolverElegibilidadProductos({ tipoGrupo: ' Tienda_Barrio ', tipoActivacion: 'No_Habilitado' }),
    { creditos: true, remesas: true },
  );
  assert.deepEqual(
    resolverElegibilidadProductos({ tipoGrupo: 'transeunte', tipoActivacion: 'Reactivacion_Transeunte' }),
    { creditos: true, remesas: true },
  );
  assert.deepEqual(
    resolverElegibilidadProductos({ tipoGrupo: 'transeunte', tipoActivacion: 'Cliente_Antiguo' }),
    { creditos: true, remesas: false },
  );
  assert.deepEqual(
    resolverElegibilidadProductos({ tipo_grupo: 'comercio' }),
    { creditos: false, remesas: false },
  );
});
