import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Unit tests for the app's networking and storage logic. Native modules are replaced by small in-memory stubs;
// the API is real (two servers started by test/servers.ts).
const stub = (f: string) => path.resolve(import.meta.dirname, 'test/stubs', f);
export default defineConfig({
  resolve: {
    alias: {
      '@/': `${path.resolve(import.meta.dirname, 'src')}/`,
      'react-native': stub('react-native.ts'),
      'expo-secure-store': stub('secure-store.ts'),
      '@react-native-async-storage/async-storage': stub('async-storage.ts'),
      'expo-file-system/legacy': stub('file-system.ts'),
      'expo-crypto': stub('crypto.ts'),
      'expo-constants': stub('constants.ts'),
    },
  },
  test: { include: ['test/**/*.test.ts'], testTimeout: 60000, hookTimeout: 120000, fileParallelism: false },
});
