const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const babel = require('@babel/core');

const filename = path.resolve('lib/plazas.js');
const { code } = babel.transformFileSync(filename, {
  babelrc: false,
  configFile: false,
  presets: [require.resolve('babel-preset-expo')],
});
const modulo = new Module(filename, module);
modulo.filename = filename;
modulo.paths = Module._nodeModulePaths(path.dirname(filename));
modulo._compile(code, filename);

const {
  estaPlazaTemporalVigente,
  filtrarPlazasTemporalesAutorizadas,
  resolverPlazaBaseAutorizada,
  validarPlazaAutorizada,
} = modulo.exports;

test('prioriza plaza_base y conserva el snapshot remoto plaza como compatibilidad', () => {
  assert.equal(resolverPlazaBaseAutorizada({
    equipo_id: 'equipo-1',
    plaza_id: 'plaza-1',
    plaza_base: 'La Paz',
    plaza: 'Santa Cruz',
  }), 'La Paz');
  assert.equal(resolverPlazaBaseAutorizada({ equipo_id: 'equipo-1', plaza: 'Santa Cruz' }), 'Santa Cruz');
  assert.equal(resolverPlazaBaseAutorizada({ equipo_id: 'equipo-1' }), null);
  assert.equal(resolverPlazaBaseAutorizada({ plaza: 'El Alto' }), 'El Alto');
});

test('acepta solo temporales activas, no canceladas y vigentes', () => {
  const now = new Date('2026-10-30T12:00:00.000Z');
  assert.equal(estaPlazaTemporalVigente({ activo: true, inicio: '2026-10-01', fin: '2026-11-01' }, now), true);
  assert.equal(estaPlazaTemporalVigente({ activo: false }, now), false);
  assert.equal(estaPlazaTemporalVigente({ vigente: false }, now), false);
  assert.equal(estaPlazaTemporalVigente({ cancelado_at: '2026-10-29T12:00:00Z' }, now), false);
  assert.equal(estaPlazaTemporalVigente({ inicio: '2026-11-01' }, now), false);
  assert.equal(estaPlazaTemporalVigente({ fin: '2026-10-30T12:00:00.000Z' }, now), false);
  assert.equal(estaPlazaTemporalVigente({ fin: 'fecha-invalida' }, now), false);
});

test('une base y temporales sin duplicar nombres equivalentes', () => {
  const temporales = filtrarPlazasTemporalesAutorizadas([
    { id: '1', nombre: 'Santa Cruz' },
    { id: '2', nombre: 'Santa Cruz de la Sierra' },
    { id: '3', nombre: 'La Paz' },
    { id: '4', nombre: 'La Paz' },
  ], 'Santa Cruz de la Sierra');

  assert.deepEqual(temporales.map((item) => item.id), ['3']);
});

test('bloquea registros sin plaza y acepta únicamente selecciones autorizadas', () => {
  const temporal = { id: 'temporal-1', nombre: 'La Paz' };
  assert.match(validarPlazaAutorizada({}), /No tienes una plaza autorizada/);
  assert.equal(validarPlazaAutorizada({ plazaBase: 'El Alto' }), null);
  assert.equal(validarPlazaAutorizada({
    plazasTemporales: [temporal],
    esPlazaTemporal: true,
    plazaTemporal: 'La Paz',
  }), null);
  assert.match(validarPlazaAutorizada({
    plazasTemporales: [temporal],
    esPlazaTemporal: true,
    plazaTemporal: 'Montero',
  }), /no está autorizada/);
});
