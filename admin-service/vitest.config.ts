import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Les tests d'intégration redémarrent des services et pilotent des connexions: 5 s par défaut ne suffisent pas.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
})
