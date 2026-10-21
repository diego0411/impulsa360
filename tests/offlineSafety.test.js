const test = require('node:test');
const assert = require('node:assert/strict');
const {
  asegurarSesionParaSync,
  drenarEscriturasCoalescidas,
  ejecutarOperacionSerializada,
  resolverLecturaPendientes,
} = require('../lib/offlineSafety');

test('lectura segura distingue vacio confirmado, datos propios y error', () => {
  assert.deepEqual(
    resolverLecturaPendientes({ status: 'ok', value: [] }, 'usuario-1'),
    { ok: true, status: 'ok', allRows: [], rows: [], count: 0 },
  );

  const todos = [
    { id: 'a', usuario_id: 'usuario-1' },
    { id: 'b', usuario_id: 'usuario-2' },
  ];
  assert.deepEqual(
    resolverLecturaPendientes({ status: 'ok', value: todos }, 'usuario-1'),
    { ok: true, status: 'ok', allRows: todos, rows: [todos[0]], count: 1 },
  );

  assert.deepEqual(
    resolverLecturaPendientes({ status: 'temporarily_unreadable', value: null }, 'usuario-1'),
    {
      ok: false,
      status: 'temporarily_unreadable',
      allRows: null,
      rows: null,
      count: null,
    },
  );
});

test('sincronizacion manual puede revalidar una sesion transitoriamente invalida', async () => {
  let llamadas = 0;
  const permitida = await asegurarSesionParaSync({
    sesionValida: false,
    manual: true,
    revalidar: async () => {
      llamadas += 1;
      return true;
    },
    ownerId: 'usuario-1',
    obtenerOwnerId: () => 'usuario-1',
    logoutEnCurso: () => false,
  });
  assert.equal(permitida, true);
  assert.equal(llamadas, 1);
});

test('revalidacion no autoriza autosync, logout ni cambio de propietario', async () => {
  let llamadas = 0;
  const revalidar = async () => {
    llamadas += 1;
    return true;
  };
  assert.equal(await asegurarSesionParaSync({
    sesionValida: false,
    manual: false,
    revalidar,
    ownerId: 'usuario-1',
  }), false);
  assert.equal(llamadas, 0);

  assert.equal(await asegurarSesionParaSync({
    sesionValida: false,
    manual: true,
    revalidar,
    ownerId: 'usuario-1',
    obtenerOwnerId: () => 'usuario-2',
    logoutEnCurso: () => false,
  }), false);
  assert.equal(await asegurarSesionParaSync({
    sesionValida: false,
    manual: true,
    revalidar,
    ownerId: 'usuario-1',
    obtenerOwnerId: () => 'usuario-1',
    logoutEnCurso: () => true,
  }), false);
  assert.equal(await asegurarSesionParaSync({
    sesionValida: true,
    manual: true,
    revalidar,
    ownerId: 'usuario-1',
    obtenerOwnerId: () => 'usuario-2',
    logoutEnCurso: () => false,
  }), false);
});

test('la revalidacion concurrente comparte una sola operacion', async () => {
  const operationRef = { current: null };
  let llamadas = 0;
  let finalizar;
  const pendiente = new Promise((resolve) => {
    finalizar = resolve;
  });
  const iniciar = async () => {
    llamadas += 1;
    await pendiente;
    return true;
  };
  const primera = ejecutarOperacionSerializada(operationRef, iniciar);
  const segunda = ejecutarOperacionSerializada(operationRef, iniciar);
  assert.equal(primera, segunda);
  finalizar();
  assert.equal(await primera, true);
  assert.equal(llamadas, 1);
  assert.equal(operationRef.current, null);
});

test('la cola drena el snapshot mas reciente llegado durante una escritura lenta', async () => {
  const escritos = [];
  let liberarPrimera;
  const primeraPendiente = new Promise((resolve) => {
    liberarPrimera = resolve;
  });
  let siguiente = null;
  const operacion = drenarEscriturasCoalescidas({
    inicial: { value: 'primero' },
    tomarSiguiente: () => {
      const actual = siguiente;
      siguiente = null;
      return actual;
    },
    persistir: async ({ value }) => {
      escritos.push(value);
      if (value === 'primero') await primeraPendiente;
      return true;
    },
  });

  siguiente = { value: 'ultimo' };
  liberarPrimera();
  assert.equal(await operacion, true);
  assert.deepEqual(escritos, ['primero', 'ultimo']);
});

test('un fallo de escritura no confirma ni consume el snapshot posterior', async () => {
  let siguiente = { value: 'ultimo' };
  let consumido = false;
  const resultado = await drenarEscriturasCoalescidas({
    inicial: { value: 'fallido' },
    tomarSiguiente: () => {
      consumido = true;
      const actual = siguiente;
      siguiente = null;
      return actual;
    },
    persistir: async () => false,
  });
  assert.equal(resultado, false);
  assert.equal(consumido, false);
  assert.deepEqual(siguiente, { value: 'ultimo' });
});
