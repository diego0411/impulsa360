const test = require('node:test');
const assert = require('node:assert/strict');
const {
  VISTA_CAMARA,
  VISTA_INICIANDO,
  VISTA_PREVIEW,
  bucketDimensionesLayout,
  camaraReutilizableEnPreview,
  construirEntregaFoto,
  construirFotoPreview,
  mantenerCamaraMontadaEnPreview,
  resolverVistaCamara,
} = require('../lib/cameraCaptureFlow');

// Simula la secuencia del componente restaurado del build 71:
// abrir cámara -> tomar foto -> preview -> Repetir -> tomar foto -> preview.
const simularCaptura = (fotos) => {
  let cameraInstance = 1;
  let fotoCapturada = null;
  const vistas = [resolverVistaCamara({ cameraInstance, fotoCapturada })];
  for (const resultado of fotos) {
    if (resultado?.uri) {
      fotoCapturada = construirFotoPreview(resultado);
      cameraInstance = null;
    }
    vistas.push(resolverVistaCamara({ fotoCapturada, cameraInstance }));
    if (resultado?.repetir) {
      fotoCapturada = null;
      cameraInstance = (cameraInstance || 0) + 1;
      vistas.push(resolverVistaCamara({ fotoCapturada, cameraInstance }));
    }
  }
  return { vistas, fotoCapturada };
};

test('el preview no depende de las dimensiones ni de la resolución', () => {
  assert.equal(resolverVistaCamara({ fotoCapturada: { uri: 'file://foto.jpg' } }), VISTA_PREVIEW);
  assert.equal(
    resolverVistaCamara({ fotoCapturada: { uri: 'file://foto.jpg', width: 4608, height: 3456 } }),
    VISTA_PREVIEW
  );
  assert.equal(
    resolverVistaCamara({ fotoCapturada: { uri: 'file://foto.jpg', width: undefined, height: undefined } }),
    VISTA_PREVIEW
  );
});

test('sin foto capturada se muestra cámara montada o inicio', () => {
  assert.equal(resolverVistaCamara({ cameraInstance: 3, fotoCapturada: null }), VISTA_CAMARA);
  assert.equal(resolverVistaCamara({ cameraInstance: null, fotoCapturada: null }), VISTA_INICIANDO);
  assert.equal(resolverVistaCamara(), VISTA_INICIANDO);
});

test('construirFotoPreview conserva la uri y normaliza dimensiones inválidas', () => {
  assert.deepEqual(construirFotoPreview({ uri: 'file://a.jpg', width: 1280, height: 960 }), {
    uri: 'file://a.jpg',
    width: 1280,
    height: 960,
  });
  assert.deepEqual(construirFotoPreview({ uri: 'file://a.jpg', width: 0, height: Number.NaN }), {
    uri: 'file://a.jpg',
    width: undefined,
    height: undefined,
  });
  assert.equal(construirFotoPreview({}), null);
});

test('construirEntregaFoto propaga uri, dimensiones y el proceso de cámara', () => {
  assert.deepEqual(
    construirEntregaFoto({ uri: 'file://e.jpg', width: 1280, height: 960 }, 'FOTO-ABC'),
    { uri: 'file://e.jpg', width: 1280, height: 960, cameraProcessId: 'FOTO-ABC' }
  );
  assert.deepEqual(construirEntregaFoto(null, undefined), {
    uri: undefined,
    width: undefined,
    height: undefined,
    cameraProcessId: '',
  });
});

for (const modo of ['evidencia', 'cash_in']) {
  test(`${modo}: un primer intento fallido no bloquea y el segundo llega al preview`, () => {
    const { vistas } = simularCaptura([
      { uri: null },
      { uri: `file://${modo}-1.jpg`, width: 1280, height: 960 },
    ]);
    assert.deepEqual(vistas.slice(0, 3), [VISTA_CAMARA, VISTA_CAMARA, VISTA_PREVIEW]);
  });

  test(`${modo}: capturas repetidas vuelven a cámara y previsualizan de nuevo`, () => {
    const { vistas } = simularCaptura([
      { uri: `file://${modo}-1.jpg`, width: 1280, height: 960, repetir: true },
      { uri: `file://${modo}-2.jpg`, width: 1280, height: 960 },
    ]);
    assert.deepEqual(vistas, [
      VISTA_CAMARA,
      VISTA_PREVIEW,
      VISTA_CAMARA,
      VISTA_PREVIEW,
    ]);
  });
}

test('solo Android mantiene la cámara montada durante el preview (build 81)', () => {
  assert.equal(mantenerCamaraMontadaEnPreview('android'), true);
  assert.equal(mantenerCamaraMontadaEnPreview('ios'), false);
  assert.equal(mantenerCamaraMontadaEnPreview(undefined), false);
});

test('Repetir reutiliza la cámara solo si sigue montada y es la misma instancia', () => {
  assert.equal(
    camaraReutilizableEnPreview({ platform: 'android', instance: 4, instanceActual: 4 }),
    true
  );
  assert.equal(
    camaraReutilizableEnPreview({ platform: 'ios', instance: 4, instanceActual: 4 }),
    false
  );
  assert.equal(
    camaraReutilizableEnPreview({ platform: 'android', instance: 4, instanceActual: 5 }),
    false
  );
  assert.equal(
    camaraReutilizableEnPreview({ platform: 'android', instance: null, instanceActual: 5 }),
    false
  );
  assert.equal(
    camaraReutilizableEnPreview({ platform: 'android', instance: undefined, instanceActual: 5 }),
    false
  );
});

test('flujo Android: capturar no desmonta la cámara y Repetir conserva la instancia', () => {
  let cameraInstance = 1;
  let fotoCapturada = null;
  const vistas = [resolverVistaCamara({ cameraInstance, fotoCapturada })];
  // Captura: en Android la instancia permanece montada bajo el preview.
  fotoCapturada = construirFotoPreview({ uri: 'file://a.jpg', width: 1280, height: 960 });
  vistas.push(resolverVistaCamara({ fotoCapturada, cameraInstance }));
  // Repetir: se retira la capa de preview sin crear otra instancia de cámara.
  assert.equal(
    camaraReutilizableEnPreview({
      platform: 'android',
      instance: cameraInstance,
      instanceActual: cameraInstance,
    }),
    true
  );
  fotoCapturada = null;
  vistas.push(resolverVistaCamara({ fotoCapturada, cameraInstance }));
  assert.deepEqual(vistas, [VISTA_CAMARA, VISTA_PREVIEW, VISTA_CAMARA]);
});

test('si la cámara se pierde durante el preview, Repetir exige remontar una instancia nueva', () => {
  // manejarErrorMontaje deja la instancia en null: no hay cámara reutilizable.
  assert.equal(
    camaraReutilizableEnPreview({ platform: 'android', instance: null, instanceActual: 7 }),
    false
  );
  // iOS siempre remonta en Repetir (comportamiento del build 71).
  assert.equal(
    camaraReutilizableEnPreview({ platform: 'ios', instance: null, instanceActual: 7 }),
    false
  );
});

test('bucketDimensionesLayout agrupa el layout del preview sin emitir valores exactos', () => {
  assert.equal(bucketDimensionesLayout({ width: 0, height: 0 }), 'EMPTY');
  assert.equal(bucketDimensionesLayout({}), 'EMPTY');
  assert.equal(bucketDimensionesLayout(null), 'EMPTY');
  assert.equal(bucketDimensionesLayout({ width: 360, height: 599 }), 'LT_600');
  assert.equal(bucketDimensionesLayout({ width: 360, height: 640 }), '600_799');
  assert.equal(bucketDimensionesLayout({ width: 600, height: 800 }), '800_1279');
  assert.equal(bucketDimensionesLayout({ width: 1080, height: 2400 }), 'GE_1280');
});
