// Adds a release signing config that reads the keystore from environment variables at build time.
// The keystore and its passwords never live in the repository: CI writes them from encrypted secrets.
//   KHIDMAT_KEYSTORE_PATH, KHIDMAT_KEYSTORE_PASSWORD, KHIDMAT_KEY_ALIAS, KHIDMAT_KEY_PASSWORD
// Without them, the release build falls back to the debug key and is marked as such in the build log.
const { withAppBuildGradle } = require('expo/config-plugins');

const BLOCK = `
    signingConfigs {
        khidmatRelease {
            def ks = System.getenv("KHIDMAT_KEYSTORE_PATH")
            if (ks) {
                storeFile file(ks)
                storePassword System.getenv("KHIDMAT_KEYSTORE_PASSWORD")
                keyAlias System.getenv("KHIDMAT_KEY_ALIAS")
                keyPassword System.getenv("KHIDMAT_KEY_PASSWORD")
            }
        }
    }`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let g = cfg.modResults.contents;
    if (g.includes('khidmatRelease')) return cfg;
    g = g.replace(/android\s*\{/, (m) => `${m}${BLOCK}`);
    g = g.replace(/(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig\s+signingConfigs\.debug/,
      '$1signingConfig System.getenv("KHIDMAT_KEYSTORE_PATH") ? signingConfigs.khidmatRelease : signingConfigs.debug');
    cfg.modResults.contents = g;
    return cfg;
  });
};
