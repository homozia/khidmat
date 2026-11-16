import { useEffect, useState } from 'react';

export interface Me { id: string; roles: string[]; provider_id: string | null }

/** Minimal hash router: #/path/segments */
export function useRoute(): string[] {
  const read = () => window.location.hash.replace(/^#\/?/, '').split('?')[0]!.split('/').filter(Boolean);
  const [r, setR] = useState(read);
  useEffect(() => {
    const on = () => setR(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return r;
}

export const go = (path: string) => { window.location.hash = `#/${path}`; };
