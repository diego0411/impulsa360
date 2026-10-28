const test = require('node:test');
const assert = require('node:assert/strict');

const {
  encontrarFotoHistoricaSegura,
  esCandidatoFotoHistoricaSeguro,
} = require('../lib/historicalPhotoSelection');

const recordIds = ['registro-1'];

test('acepta nombres inequívocos de foto principal, incluidos los legacy', () => {
  const paths = [
    'activaciones/usuario-1/registro-1/principal.jpg',
    'activaciones/usuario-1/registro-1/foto.jpg',
    'activaciones/usuario-1/registro-1/foto_url.jpg',
    'activaciones/registro-1.jpg',
    'activaciones/registro-1_respaldo.jpg',
  ];
  for (const path of paths) {
    assert.equal(esCandidatoFotoHistoricaSeguro({ path, key: 'foto_url', recordIds }), true);
  }
});

test('foto principal excluye archivos Cash-In y nombres ambiguos', () => {
  const paths = [
    'activaciones/usuario-1/registro-1/cash-in.jpg',
    'activaciones/usuario-1/registro-1/cash_in.jpg',
    'activaciones/usuario-1/registro-1/foto_cash_in.jpg',
    'activaciones/usuario-1/registro-1/evidencia.jpg',
  ];
  for (const path of paths) {
    assert.equal(esCandidatoFotoHistoricaSeguro({ path, key: 'foto_url', recordIds }), false);
  }
});

test('Cash-In acepta únicamente sus nombres inequívocos', () => {
  for (const nombre of ['cash-in.jpg', 'cash_in.jpg', 'foto_cash_in.jpg']) {
    assert.equal(esCandidatoFotoHistoricaSeguro({
      path: `activaciones/usuario-1/registro-1/${nombre}`,
      key: 'foto_cash_in',
      recordIds,
    }), true);
  }
  for (const nombre of ['principal.jpg', 'foto.jpg', 'foto_url.jpg', 'evidencia.jpg']) {
    assert.equal(esCandidatoFotoHistoricaSeguro({
      path: `activaciones/usuario-1/registro-1/${nombre}`,
      key: 'foto_cash_in',
      recordIds,
    }), false);
  }
});

test('ignora la foto contraria y devuelve una coincidencia segura', async () => {
  const existentes = new Set([
    'activaciones/usuario-1/registro-1/cash-in.jpg',
    'activaciones/usuario-1/registro-1/principal.jpg',
  ]);
  const result = await encontrarFotoHistoricaSegura({
    candidates: [...existentes],
    key: 'foto_url',
    recordIds,
    existe: async (path) => existentes.has(path),
  });
  assert.equal(result, 'activaciones/usuario-1/registro-1/principal.jpg');
});

test('sin coincidencia segura devuelve vacío para conservar el pendiente', async () => {
  const result = await encontrarFotoHistoricaSegura({
    candidates: [
      'activaciones/usuario-1/registro-1/principal.jpg',
      'activaciones/usuario-1/registro-1/evidencia-cash.jpg',
    ],
    key: 'foto_cash_in',
    recordIds,
    existe: async () => true,
  });
  assert.equal(result, '');
});

test('si el archivo seguro está ausente devuelve vacío', async () => {
  const result = await encontrarFotoHistoricaSegura({
    candidates: ['activaciones/usuario-1/registro-1/cash-in.jpg'],
    key: 'foto_cash_in',
    recordIds,
    existe: async () => false,
  });
  assert.equal(result, '');
});
