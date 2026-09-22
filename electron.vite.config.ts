import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
  main: {
    // AIRBRAKE_* vars are baked into the bundle at build time (see .env.local.example)
    // since a packaged app has no runtime env vars from CI to read.
    envPrefix: ['MAIN_VITE_', 'AIRBRAKE_'],
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
      },
    },
  },
  renderer: {
    envPrefix: ['RENDERER_VITE_', 'AIRBRAKE_'],
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer'),
        '@shared': resolve('src/shared'),
      },
    },
    plugins: [svelte()],
  },
})
