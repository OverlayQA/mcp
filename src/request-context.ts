import { AsyncLocalStorage } from 'node:async_hooks';

// The SDK supplies one signal per tool call. Keep it scoped across async work
// so cancelling one call cannot abort a different concurrent request.
const signals = new AsyncLocalStorage<AbortSignal>();

export function withRequestSignal<T>(signal: AbortSignal, fn: () => Promise<T>): Promise<T> {
  return signals.run(signal, fn);
}

export function currentRequestSignal(): AbortSignal | undefined {
  return signals.getStore();
}
