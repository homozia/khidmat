// Survives vi.resetModules(), like the phone's encrypted store survives an app restart.
const g = globalThis as unknown as { __secure?: Map<string, string> };
export const store = (g.__secure ??= new Map<string, string>());
export const getItemAsync = async (k: string) => store.get(k) ?? null;
export const setItemAsync = async (k: string, v: string) => { store.set(k, v); };
export const deleteItemAsync = async (k: string) => { store.delete(k); };
