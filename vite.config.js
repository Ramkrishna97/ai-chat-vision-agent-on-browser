import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '127.0.0.1',
    proxy: { '/local-bridge': { target: 'http://127.0.0.1:3210', changeOrigin: false, rewrite: path => path.replace(/^\/local-bridge/, '') } },
  },
});
