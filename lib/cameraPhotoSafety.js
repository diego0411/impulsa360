export const MAX_CAPTURE_PIXELS = 12000000;

const PREFERRED_PICTURE_SIZES = ['1280x960', '1280x720', '1024x768', '960x720'];
const MAX_MODERATE_SIDE = 1280;

export const parsePictureSize = (size) => {
  const match = /^(\d+)x(\d+)$/i.exec(String(size || '').trim());
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { size: String(size), width, height, area: width * height, maxSide: Math.max(width, height) };
};

export const seleccionarPictureSizeSeguro = (sizes = []) => {
  const validas = (Array.isArray(sizes) ? sizes : [])
    .map(parsePictureSize)
    .filter(Boolean);
  if (!validas.length) return { status: 'unknown', size: '' };

  const permitidas = validas.filter((item) => item.area <= MAX_CAPTURE_PIXELS);
  if (!permitidas.length) return { status: 'unsupported', size: null };

  const preferida = PREFERRED_PICTURE_SIZES.find((size) => (
    permitidas.some((item) => item.size === size)
  ));
  if (preferida) return { status: 'supported', size: preferida };

  const moderadas = permitidas
    .filter((item) => item.maxSide <= MAX_MODERATE_SIDE)
    .sort((a, b) => b.area - a.area);
  if (moderadas[0]) return { status: 'supported', size: moderadas[0].size };

  const menorPermitida = permitidas.sort((a, b) => a.area - b.area)[0];
  return { status: 'supported', size: menorPermitida.size };
};

export const bucketDimensionesFoto = (pixels) => {
  const value = Number(pixels);
  if (!Number.isFinite(value) || value <= 0) return 'UNKNOWN';
  if (value <= 2000000) return 'LE_2MP';
  if (value <= 5000000) return '2_5MP';
  if (value <= 8000000) return '5_8MP';
  if (value <= MAX_CAPTURE_PIXELS) return '8_12MP';
  return 'GT_12MP';
};

export const evaluarDimensionesCaptura = ({ width, height, pictureSize } = {}) => {
  const widthValue = Number(width);
  const heightValue = Number(height);
  const dimensiones = Number.isFinite(widthValue)
    && Number.isFinite(heightValue)
    && widthValue > 0
    && heightValue > 0
    ? { width: widthValue, height: heightValue }
    : parsePictureSize(pictureSize);

  if (!dimensiones) {
    return { ok: false, reason: 'unknown', pixels: 0, bucket: 'UNKNOWN' };
  }

  const pixels = dimensiones.width * dimensiones.height;
  return {
    ok: pixels <= MAX_CAPTURE_PIXELS,
    reason: pixels <= MAX_CAPTURE_PIXELS ? null : 'too_large',
    width: dimensiones.width,
    height: dimensiones.height,
    pixels,
    bucket: bucketDimensionesFoto(pixels),
  };
};
