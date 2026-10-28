const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const fuenteCamara = fs.readFileSync(path.resolve('components/CameraEvidencia.js'), 'utf8');
const fuenteDiagnostico = fs.readFileSync(path.resolve('lib/photoDiagnostics.js'), 'utf8');
const fuenteTelemetria = fs.readFileSync(path.resolve('lib/telemetry.js'), 'utf8');

const bloqueDesmontaje = () => {
  const inicio = fuenteCamara.indexOf('mountedRef.current = false;');
  assert.ok(inicio >= 0, 'no se encontró la limpieza de desmontaje');
  const fin = fuenteCamara.indexOf('\n    };', inicio);
  assert.ok(fin > inicio, 'no se encontró el cierre de la limpieza de desmontaje');
  return fuenteCamara.slice(inicio, fin);
};

const sinComentarios = (src) => src
  .replace(/\/\/[^\n]*/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '');

test('el desmontaje marca UNMOUNTED y nunca finaliza el hito como éxito', () => {
  const bloque = bloqueDesmontaje();
  assert.match(bloque, /!entregadaRef\.current && cameraProcessIdRef\.current/);
  assert.match(bloque, /marcarHitoCamaraInterrumpido\(cameraProcessIdRef\.current\)/);
  assert.ok(!bloque.includes('finalizarHitoCamara'), 'el desmontaje no debe cerrar como éxito');
  assert.ok(!bloque.includes('SESSION_CLOSED'));
  assert.ok(!bloque.includes('CLOSED'));
});

test('los cierres normales finalizan el hito de cámara', () => {
  assert.match(fuenteCamara, /finalizarHitoCamara\(cameraProcessIdRef\.current, 'CLOSED'\)/);
  assert.match(
    fuenteCamara,
    /if \(!visible\) \{\s+if \(!entregadaRef\.current && cameraProcessIdRef\.current\) \{\s+finalizarHitoCamara\(cameraProcessIdRef\.current, 'SESSION_CLOSED'\)/
  );
});

test('la entrega cede el hito al procesamiento de foto sin cerrarlo', () => {
  assert.match(
    fuenteCamara,
    /if \(!entrega\?\.uri\) return;\s+entregadaRef\.current = true;\s+reportarHito\('CAMERA_HANDOFF'\);/
  );
  assert.match(
    fuenteCamara,
    /cameraProcessIdRef\.current = crearIdCamara\(\);\s+entregadaRef\.current = false;/
  );
});

test('UNMOUNTED no se interpreta como crash nativo', () => {
  const codigoDiagnostico = sinComentarios(fuenteDiagnostico);
  const codigoTelemetria = sinComentarios(fuenteTelemetria);
  assert.ok(!/ApplicationExitInfo|ExitInfo|native_exit_reason/.test(codigoDiagnostico));
  assert.ok(!/ApplicationExitInfo|ExitInfo/.test(codigoTelemetria));
  assert.ok(!codigoTelemetria.includes("phase: 'previous_run_unclean'"));
});
