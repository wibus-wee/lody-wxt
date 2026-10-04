export function bounded<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort);
      reject(signal.reason);
    };
    const cleanup = () => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });
    void promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

export async function acquireWithin<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  release: (resource: T) => Promise<void>,
): Promise<T> {
  let abandoned = false;
  const tracked = promise.then(async (resource) => {
    if (abandoned || signal.aborted) {
      await release(resource);
      throw signal.reason;
    }
    return resource;
  });
  try {
    return await bounded(tracked, signal);
  } catch (error) {
    abandoned = true;
    throw error;
  }
}
