import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      '/celestrak-api': {
        target: 'https://celestrak.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/celestrak-api/, '/NORAD/elements/gp.php'),
      }
    }
  }
});
