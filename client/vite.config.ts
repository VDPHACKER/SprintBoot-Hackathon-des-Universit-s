import { defineConfig } from 'vite'

// Deux applications distinctes servies par le même build: la messagerie (index.html) et la console d'administration (admin.html).
export default defineConfig({
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: { input: { main: 'index.html', admin: 'admin.html' } },
  },
})
