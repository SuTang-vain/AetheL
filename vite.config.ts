import { defineConfig, loadEnv } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tsconfigPaths from "vite-tsconfig-paths";
import { traeBadgePlugin } from 'vite-plugin-trae-solo-badge';

// --- deployment-specific overrides (set via env at build time) ---
// VITE_BASE_PATH    -> asset base prefix (default '/')
// VITE_API_BASE     -> API path prefix (default '/api/')
// When deploying under a sub-path (e.g. /aethel/) on a shared host,
// set VITE_BASE_PATH=/aethel/ and VITE_API_BASE=/aethel-api/ so the
// SPA bundle routes requests to the right nginx location without
// touching source code.
const rewriteApiPathPlugin = (apiBase: string): Plugin => ({
  name: 'aethel:rewrite-api-path',
  enforce: 'post',
  transform(code, id) {
    if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(id)) return null
    if (apiBase === '/api/') return null
    if (!code.includes('/api/')) return null
    return {
      code: code.replace(/(['"`])\/api\//g, `$1${apiBase}`),
      map: null,
    }
  },
})

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = env.VITE_API_TARGET || `http://localhost:${env.PORT || '3000'}`
  const basePath = env.VITE_BASE_PATH || '/'
  const apiBase = env.VITE_API_BASE || '/api/'

  return {
    base: basePath,
    define: {
      __AETHEL_BASE_PATH__: JSON.stringify(basePath),
      __AETHEL_API_BASE__: JSON.stringify(apiBase),
    },
    plugins: [
      react({
        babel: {
          plugins: [
            'react-dev-locator',
          ],
        },
      }),
      traeBadgePlugin({
        variant: 'dark',
        position: 'bottom-right',
        prodOnly: true,
        clickable: true,
        clickUrl: 'https://www.trae.ai/solo?showJoin=1',
        autoTheme: true,
        autoThemeTarget: '#root'
      }),
      tsconfigPaths(),
      rewriteApiPathPlugin(apiBase),
    ],
    server: {
      watch: {
        ignored: ['**/data/**'],
      },
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          secure: false,
          configure: (proxy, _options) => {
            proxy.on('error', (err, _req, _res) => {
              console.log('proxy error', err);
            });
            proxy.on('proxyReq', (proxyReq, req, _res) => {
              console.log('Sending Request to the Target:', req.method, req.url);
            });
            proxy.on('proxyRes', (proxyRes, req, _res) => {
              console.log('Received Response from the Target:', proxyRes.statusCode, req.url);
            });
          },
        }
      }
    }
  }
})
