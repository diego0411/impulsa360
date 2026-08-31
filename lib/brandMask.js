const normalizarRol = (value) => String(value || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_|_$/g, '');

const esAdmin = (usuario) => {
  const rol = normalizarRol(usuario?.rol || usuario?.role);
  return ['admin', 'administrador', 'administrator'].some(
    (item) => rol === item || rol.startsWith(`${item}_`),
  );
};

export const debeEnmascararMarca = (usuario) => !esAdmin(usuario);

export const enmascararMarcaVisible = (value, usuario) => {
  if (value === null || value === undefined) return value;
  const text = String(value);
  if (!debeEnmascararMarca(usuario)) return text;

  return text
    .replace(/YOLO/g, 'YOXX')
    .replace(/Yolo/g, 'YoXX')
    .replace(/yolo/g, 'yoxx');
};
