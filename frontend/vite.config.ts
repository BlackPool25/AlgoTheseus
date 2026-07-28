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
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    proxy: {
      '/execute': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/health':  { target: 'http://127.0.0.1:8000', changeOrigin: true },
    },
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
  },
})
