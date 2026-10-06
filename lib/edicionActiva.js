// Señal mínima de edición activa para evitar auto-sync pesado durante
// escritura en formulario. No bloquea UI ni cancela operaciones en curso.
let edicionActiva = false;

export const setEdicionActiva = (valor) => {
  edicionActiva = valor === true;
};

export const isEdicionActiva = () => edicionActiva === true;
