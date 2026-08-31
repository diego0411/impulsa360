export class TimeoutError extends Error {
  constructor(message = 'Tiempo de espera agotado.') {
    super(message);
    this.name = 'TimeoutError';
  }
}

export const withTimeout = (promise, ms, message) => {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = globalThis.setTimeout(() => {
      reject(new TimeoutError(message));
    }, ms);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) globalThis.clearTimeout(timer);
  });
};

export const isTimeoutError = (error) => error?.name === 'TimeoutError';
