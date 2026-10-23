import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

function figmaAssetResolver() {
  return {
    name: 'figma-asset-resolver',
    resolveId(id: string) {
      if (id.startsWith('figma:asset/')) {
        const filename = id.replace('figma:asset/', '')
        return fileURLToPath(new URL(`src/assets/${filename}`, import.meta.url))
      }
    },
  }
}

export default defineConfig({
  plugins: [
    figmaAssetResolver(),
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],

  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Heavy third-party libraries isolated into dedicated cacheable vendor chunks
          if (id.includes('node_modules/recharts')) {
            return 'vendor-recharts';
          }
          if (id.includes('node_modules/xlsx')) {
            return 'vendor-xlsx';
          }
          if (id.includes('node_modules/@zxing')) {
            return 'vendor-zxing';
          }
          if (id.includes('node_modules/lucide-react')) {
            return 'vendor-lucide';
          }
          if (id.includes('node_modules/@radix-ui')) {
            return 'vendor-radix';
          }
        },
      },
    },
  },
})
