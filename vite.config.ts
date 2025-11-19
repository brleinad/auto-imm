import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { resolve } from 'path'

export default defineConfig({
  plugins: [svelte()],
  optimizeDeps: {
    include: ['tesseract.js']
  },
  build: {
    outDir: 'dist',
    commonjsOptions: {
      transformMixedEsModules: true
    },
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        'content-script': resolve(__dirname, 'src/content-script.ts')
      },
      output: {
        entryFileNames: (chunkInfo) => {
          // Content script goes to root, others to assets
          return chunkInfo.name === 'content-script'
            ? '[name].js'
            : 'assets/[name].js';
        },
        chunkFileNames: `assets/[name].js`,
        assetFileNames: `assets/[name].[ext]`
      }
    }
  }
})