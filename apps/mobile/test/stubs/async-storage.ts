const g = globalThis as unknown as { __async?: Map<string, string> };
const store = (g.__async ??= new Map<string, string>());
export default {
  getItem: async (k: string) => store.get(k) ?? null,
  setItem: async (k: string, v: string) => { store.set(k, v); },
  removeItem: async (k: string) => { store.delete(k); },
};
