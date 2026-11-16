import { createContext, useContext } from 'react';

export const SessionCtx = createContext<{ signedIn: boolean; setSignedIn: (v: boolean) => void; signOut: () => Promise<void> }>({
  signedIn: false, setSignedIn: () => undefined, signOut: async () => undefined,
});
export const useSession = () => useContext(SessionCtx);
