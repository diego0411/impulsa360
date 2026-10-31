const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  booleanPretty,
  resolverGrupoActivacion,
  resolverIndicadorReactivacion,
} = require('../lib/detalleActivacion');

test('booleanPretty distingue true, false, null y campos históricos ausentes', () => {
  assert.equal(booleanPretty(true), 'Sí');
  assert.equal(booleanPretty(false), 'No');
  assert.equal(booleanPretty(null), '—');
  assert.equal(booleanPretty(undefined), '—');
});

test('reactivación conserva true y false explícitos', () => {
  assert.equal(resolverIndicadorReactivacion({ es_reactivacion: true }), true);
  assert.equal(resolverIndicadorReactivacion({ es_reactivacion: false }), false);
  assert.equal(resolverIndicadorReactivacion({ reactivacion_comercio: true }), true);
  assert.equal(resolverIndicadorReactivacion({ reactivacion_comercio: false }), false);
});

test('reactivación prioriza true y distingue registros históricos ausentes', () => {
  assert.equal(resolverIndicadorReactivacion({ es_reactivacion: false, reactivacion_comercio: true }), true);
  assert.equal(resolverIndicadorReactivacion({ es_reactivacion: null, reactivacion_comercio: undefined }), null);
  assert.equal(resolverIndicadorReactivacion({}), null);
});

test('el grupo explícito identifica los tres grupos de activación', () => {
  assert.equal(resolverGrupoActivacion({ tipo_grupo: 'comercio' }), 'Comercio');
  assert.equal(resolverGrupoActivacion({ tipo_grupo: 'tienda_barrio' }), 'Tienda de Barrio');
  assert.equal(resolverGrupoActivacion({ tipo_grupo: 'transeunte' }), 'Transeúnte');
});

test('los históricos se derivan solo con señales inequívocas', () => {
  assert.equal(resolverGrupoActivacion({ base_activacion: 'comercio' }), 'Comercio');
  assert.equal(resolverGrupoActivacion({ tipo_activacion: 'config_cuenta' }), 'Tienda de Barrio');
  assert.equal(resolverGrupoActivacion({ tipo_activacion: 'reactivacion_transeunte' }), 'Transeúnte');
  assert.equal(resolverGrupoActivacion({ tipo_activacion: 'reimpresion_qr', base_activacion: 'none' }), null);
  assert.equal(resolverGrupoActivacion({ tipo_activacion: 'comercio' }), null);
  assert.equal(resolverGrupoActivacion({
    tipo_activacion: 'reactivacion_transeunte',
    base_activacion: 'comercio',
  }), null);
});

test('el detalle conecta todos los campos almacenados solicitados', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'components/FormulariosPorImpulsador.js'),
    'utf8',
  );
  for (const campo of [
    'creditos',
    'remesas',
    'ciudad_activacion',
    'zona_activacion',
    'distrito_gps',
    'region_gps',
    'base_activacion',
    'es_plaza_temporal',
  ]) {
    assert.match(source, new RegExp(`detalle\\.${campo}\\b`), `${campo} debe mostrarse desde el registro`);
  }
  assert.match(source, /renderCampo\('Grupo de activación', resolverGrupoActivacion\(detalle\) \|\| '—'\)/);
  assert.match(source, /renderCampo\('Reactivación', booleanPretty\(resolverIndicadorReactivacion\(detalle\)\)\)/);
  assert.doesNotMatch(source, /Reactivación comercio/);
  assert.match(source, /booleanPretty\(resolverIndicadorReactivacion\(detalle\)\)/);
});
