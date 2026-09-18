const maskTail = (value, visibleCount = 4) => {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const keep = Math.max(0, Math.min(visibleCount, text.length - 1));
  const maskCount = Math.max(1, text.length - keep);
  return `${text.slice(0, keep)}${'*'.repeat(maskCount)}`;
};

export const enmascararTelefonoCliente = (value) => maskTail(value, 4);

export const enmascararCiCliente = (value) => maskTail(value, 4);

export const enmascararEmailCliente = (value) => {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const atIndex = text.indexOf('@');
  if (atIndex <= 0) return maskTail(text, 4);

  const local = text.slice(0, atIndex);
  const domain = text.slice(atIndex);
  const keep = Math.max(0, Math.min(local.length - 1, local.length - 4));
  const maskCount = Math.max(1, local.length - keep);
  return `${local.slice(0, keep)}${'*'.repeat(maskCount)}${domain}`;
};

export const enmascararDatoCliente = (label, value) => {
  const normalizedLabel = String(label || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (normalizedLabel === 'ci' || normalizedLabel.includes('carnet')) {
    return enmascararCiCliente(value);
  }
  if (normalizedLabel.includes('telefono')) {
    return enmascararTelefonoCliente(value);
  }
  if (normalizedLabel.includes('email') || normalizedLabel.includes('correo')) {
    return enmascararEmailCliente(value);
  }
  return value;
};
