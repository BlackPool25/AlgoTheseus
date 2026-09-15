import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

/**
 * Vite configuration for DSA Visualizer frontend
 *
 * Features:
 * - React plugin for HMR and JSX transformation
 * - Path alias (@) pointing to src directory
 * - Dev server proxy to backend API
 * - Automatic layout for Monaco editor
 * - COOP/COEP headers (task 19): enable crossOriginIsolated for the future
 *   browser-WASM path (SharedArrayBuffer toolchain); `!crossOriginIsolated`
 *   in the app selects the automatic server-path fallback. Same-origin app
 *   + same-origin proxied API keep the Docker-local dev flow unbroken.
 */

// Cross-Origin-Opener/Embedder-Policy pair for SAB-gated WASM toolchain.
// Verified against current Vite docs: server.headers / preview.headers.
const coopCoepHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};
export default defineConfig({
  plugins: [react()],
  // Base-path-safe (todo 21): '/' for Pages/Netlify custom domains; GH Pages
  // mirror passes VITE_BASE=/<repo>/ at build time. Same-origin WASM blobs
  // stay relative to base — no CDN subresource anywhere (see index.html).
  base: process.env.VITE_BASE ?? '/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    headers: coopCoepHeaders,
    proxy: {
      '/execute': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/health':  { target: 'http://127.0.0.1:8000', changeOrigin: true },
    },
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
  },
  preview: {
    headers: coopCoepHeaders,
  },
})
