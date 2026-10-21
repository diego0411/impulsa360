const test = require('node:test');
const assert = require('node:assert/strict');
const {
  combinarHistorialLocalRemoto,
  combinarFormulariosSinDuplicados,
  crearControlConsultaUnica,
  filtrarFormulariosNoDuplicados,
  persistirReemplazoFoto,
  puedeConsultarHistorialRemoto,
} = require('../lib/historialActivaciones');

test('el remoto reemplaza al pendiente cuyo _id_local coincide con su id', () => {
  const remoto = { id: 'activacion-1', estado_sync: 'synced' };
  const pendiente = { _id_local: 'activacion-1', estado_sync: 'offline_pending' };
  assert.deepEqual(filtrarFormulariosNoDuplicados([pendiente], [remoto]), []);
});

test('conserva pendientes distintos y deduplica por cualquiera de sus identidades', () => {
  const pendientes = [
    { id: 'servidor-1', _id_local: 'local-1' },
    { _id_local: 'local-1' },
    { _id_local: 'local-2' },
  ];
  assert.deepEqual(
    filtrarFormulariosNoDuplicados(pendientes),
    [pendientes[0], pendientes[2]],
  );
});

test('la paginacion remota conserva el primer registro de cada identidad', () => {
  const primeraPagina = [{ id: 'a' }, { id: 'b', _id_local: 'local-b' }];
  const segundaPagina = [{ id: 'b' }, { id: 'local-b' }, { id: 'c' }];
  assert.deepEqual(
    combinarFormulariosSinDuplicados(primeraPagina, segundaPagina),
    [primeraPagina[0], primeraPagina[1], segundaPagina[2]],
  );
});

test('el historial muestra solo pendientes propios del periodo y los sustituye al sincronizar', () => {
  const ownerId = 'usuario-1';
  const pendiente = {
    id: 'activacion-1',
    _id_local: 'activacion-1',
    usuario_id: ownerId,
    fecha_activacion: '2026-10-18',
    estado_sync: 'offline_pending',
  };
  const fueraPeriodo = { ...pendiente, id: 'activacion-2', _id_local: 'activacion-2', fecha_activacion: '2026-09-30' };
  const otroUsuario = { ...pendiente, id: 'activacion-3', _id_local: 'activacion-3', usuario_id: 'usuario-2' };
  const periodo = { desde: '2026-10-01', hasta: '2026-10-31' };

  const antes = combinarHistorialLocalRemoto({
    locales: [pendiente, fueraPeriodo, otroUsuario],
    remotos: [],
    ownerId,
    periodo,
  });
  assert.deepEqual(antes.map((item) => item.id), ['activacion-1']);
  assert.equal(antes[0]._origen, 'local');

  const remoto = { ...pendiente, estado_sync: 'online' };
  const despues = combinarHistorialLocalRemoto({
    locales: [pendiente],
    remotos: [remoto],
    ownerId,
    periodo,
  });
  assert.equal(despues.length, 1);
  assert.equal(despues[0], remoto);
});

test('modo avion conserva de uno a cinco pendientes sin habilitar consultas remotas', () => {
  const ownerId = 'usuario-1';
  const periodo = { desde: '2026-10-01', hasta: '2026-10-31' };
  assert.equal(puedeConsultarHistorialRemoto({
    isConnected: false,
    isInternetReachable: false,
  }), false);

  for (let cantidad = 1; cantidad <= 5; cantidad += 1) {
    const pendientes = Array.from({ length: cantidad }, (_, index) => ({
      id: `activacion-${index}`,
      _id_local: `local-${index}`,
      usuario_id: ownerId,
      fecha_activacion: `2026-10-${String(index + 1).padStart(2, '0')}`,
      estado_sync: 'offline_pending',
    }));
    const visibles = combinarHistorialLocalRemoto({
      locales: pendientes,
      remotos: [],
      ownerId,
      periodo,
    });
    assert.equal(visibles.length, cantidad);
    assert.ok(visibles.every((item) => item._origen === 'local'));
  }
});

test('un fallo remoto bloquea paginacion automatica hasta desbloqueo explicito', () => {
  assert.equal(puedeConsultarHistorialRemoto({
    isConnected: true,
    isInternetReachable: true,
    bloqueado: true,
  }), false);
  assert.equal(puedeConsultarHistorialRemoto({
    isConnected: true,
    isInternetReachable: true,
    bloqueado: false,
  }), true);
  assert.equal(puedeConsultarHistorialRemoto({
    isConnected: true,
    isInternetReachable: false,
    bloqueado: false,
  }), false);
});

test('onEndReached repetido comparte una sola consulta y libera el turno al finalizar', async () => {
  const control = crearControlConsultaUnica();
  let llamadas = 0;
  let finalizar;
  const pendiente = new Promise((resolve) => {
    finalizar = resolve;
  });
  const consultar = async () => {
    llamadas += 1;
    await pendiente;
    return ['ok'];
  };

  const primera = control.ejecutar(consultar);
  const segunda = control.ejecutar(consultar);
  const tercera = control.ejecutar(consultar);
  assert.equal(primera.iniciada, true);
  assert.equal(segunda.iniciada, false);
  assert.equal(tercera.iniciada, false);
  assert.equal(primera.promesa, segunda.promesa);
  assert.equal(segunda.promesa, tercera.promesa);
  assert.equal(control.enCurso(), true);
  finalizar();
  assert.deepEqual(await primera.promesa, ['ok']);
  assert.equal(llamadas, 1);
  assert.equal(control.enCurso(), false);

  const posterior = control.ejecutar(async () => {
    llamadas += 1;
    return ['recuperado'];
  });
  assert.equal(posterior.iniciada, true);
  assert.deepEqual(await posterior.promesa, ['recuperado']);
  assert.equal(llamadas, 2);
});

test('la exclusion se libera despues de un fallo para permitir refresh o reconexion', async () => {
  const control = crearControlConsultaUnica();
  const fallida = control.ejecutar(async () => {
    throw new Error('Supabase no disponible');
  });
  await assert.rejects(fallida.promesa, /Supabase no disponible/);
  assert.equal(control.enCurso(), false);

  const recuperada = control.ejecutar(async () => 'ok');
  assert.equal(recuperada.iniciada, true);
  assert.equal(await recuperada.promesa, 'ok');
});

test('reemplaza una foto solo despues de comprobar archivo, escritura y relectura', async () => {
  const eventos = [];
  const destino = 'file:///nueva.jpg';
  const patch = {
    foto_url: destino,
    _sync: { localPhotos: { foto_url: destino } },
  };
  const confirmado = await persistirReemplazoFoto({
    destino,
    fieldName: 'foto_url',
    patch,
    verificarArchivo: async () => {
      eventos.push('verificar');
      return { exists: true, size: 1024 };
    },
    persistir: async () => {
      eventos.push('persistir');
      return true;
    },
    releer: async () => {
      eventos.push('releer');
      return patch;
    },
  });
  assert.equal(confirmado.foto_url, destino);
  assert.deepEqual(eventos, ['verificar', 'persistir', 'releer']);
});

test('un archivo nuevo inexistente no llega a escribirse en el pendiente', async () => {
  let persistido = false;
  await assert.rejects(
    persistirReemplazoFoto({
      destino: 'file:///ausente.jpg',
      fieldName: 'foto_url',
      patch: { foto_url: 'file:///ausente.jpg' },
      verificarArchivo: async () => ({ exists: false }),
      persistir: async () => {
        persistido = true;
        return true;
      },
      releer: async () => null,
    }),
    /no quedó disponible/,
  );
  assert.equal(persistido, false);
});

test('un fallo de escritura conserva la referencia y foto anteriores', async () => {
  const registro = {
    foto_url: 'file:///anterior.jpg',
    _sync: { localPhotos: { foto_url: 'file:///anterior.jpg' } },
  };
  let releido = false;
  await assert.rejects(
    persistirReemplazoFoto({
      destino: 'file:///nueva.jpg',
      fieldName: 'foto_url',
      patch: { foto_url: 'file:///nueva.jpg' },
      verificarArchivo: async () => ({ exists: true, size: 1024 }),
      persistir: async () => {
        throw new Error('fallo durable');
      },
      releer: async () => {
        releido = true;
        return registro;
      },
    }),
    /fallo durable/,
  );
  assert.equal(releido, false);
  assert.equal(registro.foto_url, 'file:///anterior.jpg');
});

test('una relectura inconsistente no confirma el reemplazo ni altera el registro anterior', async () => {
  const anterior = {
    foto_cash_in: 'file:///anterior.jpg',
    _sync: { localPhotos: { foto_cash_in: 'file:///anterior.jpg' } },
  };
  await assert.rejects(
    persistirReemplazoFoto({
      destino: 'file:///nueva.jpg',
      fieldName: 'foto_cash_in',
      patch: { foto_cash_in: 'file:///nueva.jpg' },
      verificarArchivo: async () => ({ exists: true, size: 1024 }),
      persistir: async () => true,
      releer: async () => anterior,
    }),
    /no pudo confirmarse/,
  );
  assert.equal(anterior.foto_cash_in, 'file:///anterior.jpg');
});
