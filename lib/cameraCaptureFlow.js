// Modelo puro del flujo de captura y vista previa restaurado del build 71:
// takePictureAsync -> vista previa (capa opaca sobre la cámara) -> Repetir / Usar foto.
//
// Decisión clave verificada contra los AAB 71 y 74: en el build 71 la captura
// NUNCA se condiciona a una validación de resolución. La protección contra
// imágenes desproporcionadas sigue existiendo, pero aguas abajo, en
// prepararImagenPersistente (límite de 6 MB / 12 MP + resize), no en la cámara.
//
// Build 81 (pantalla blanca tras captura): en Android CameraView (SurfaceView)
// permanece montado durante el preview y la foto se superpone en una capa
// opaca; desmontar la cámara y montar Image en el mismo commit rompía la
// composición nativa. iOS conserva el desmontaje del build 71.

const VISTA_INICIANDO = 'iniciando';
const VISTA_CAMARA = 'camara';
const VISTA_PREVIEW = 'preview';

// Selecciona qué vista debe mostrarse. El preview depende únicamente de que
// exista una foto con uri válida; no de sus dimensiones.
const resolverVistaCamara = ({ fotoCapturada, cameraInstance } = {}) => {
  if (fotoCapturada?.uri) return VISTA_PREVIEW;
  if (cameraInstance !== null && cameraInstance !== undefined) return VISTA_CAMARA;
  return VISTA_INICIANDO;
};

// Normaliza la foto capturada para el preview. Acepta dimensiones ausentes o
// inválidas sin descartar la foto.
const construirFotoPreview = (foto) => {
  if (!foto?.uri) return null;
  const width = Number(foto.width);
  const height = Number(foto.height);
  return {
    uri: foto.uri,
    width: Number.isFinite(width) && width > 0 ? width : undefined,
    height: Number.isFinite(height) && height > 0 ? height : undefined,
  };
};

// Datos que se entregan al formulario (evidencia o Cash-In) al pulsar
// "Usar foto". Conserva el rastro de telemetría de la cámara.
const construirEntregaFoto = (foto, cameraProcessId) => ({
  uri: foto?.uri,
  width: foto?.width,
  height: foto?.height,
  cameraProcessId: cameraProcessId || '',
});

// Solo Android mantiene CameraView montada durante el preview (build 81).
const mantenerCamaraMontadaEnPreview = (platform) => platform === 'android';

// La cámara montada se puede reutilizar en "Repetir" si sigue siendo la misma
// instancia que capturó (no se remontó ni falló el montaje durante el preview).
const camaraReutilizableEnPreview = ({ platform, instance, instanceActual } = {}) => (
  mantenerCamaraMontadaEnPreview(platform)
  && instance !== null
  && instance !== undefined
  && instance === instanceActual
);

// Agrupa el tamaño del layout del preview (dp) para telemetría PREVIEW_LAYOUT.
// Solo se emiten tramos; nunca valores exactos ni datos del dispositivo.
const bucketDimensionesLayout = (layout) => {
  const width = Number(layout?.width);
  const height = Number(layout?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 'EMPTY';
  const maxSide = Math.max(width, height);
  if (maxSide < 600) return 'LT_600';
  if (maxSide < 800) return '600_799';
  if (maxSide < 1280) return '800_1279';
  return 'GE_1280';
};

module.exports = {
  VISTA_INICIANDO,
  VISTA_CAMARA,
  VISTA_PREVIEW,
  resolverVistaCamara,
  construirFotoPreview,
  construirEntregaFoto,
  mantenerCamaraMontadaEnPreview,
  camaraReutilizableEnPreview,
  bucketDimensionesLayout,
};
