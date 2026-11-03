import { defineConfig } from 'vite';

// En desarrollo, Vite reenvía /api a la API (como nginx en Docker), así que la web usa rutas relativas
// y no hace falta CORS. Las variables VITE_* se leen del .env de la raíz del monorepo.
export default defineConfig({
  envDir: '../..',
  server: {
    port: 5173,
    proxy: {
      '/api': process.env.API_PROXY_TARGET ?? 'http://localhost:3000',
    },
  },
});
