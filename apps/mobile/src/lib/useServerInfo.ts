import { useEffect, useState } from 'react';
import { apiUrl } from './config';
import { checkServer, type ServerInfo } from './health';

/** What the current server allows (sandbox sign-in codes, test controls). Null until known or unreachable. */
export function useServerInfo() {
  const [info, setInfo] = useState<ServerInfo | null>(null);
  useEffect(() => { void checkServer(apiUrl(), 5000).then((r) => setInfo(r.ok ? r.info : null)); }, []);
  return info;
}
