import { mount } from 'svelte'
import { Notifier } from '@airbrake/browser'
import App from './App.svelte'

// Config is baked in at build time (see electron.vite.config.ts + .env.local.example).
// A local dev build with no .env simply runs without error reporting.
const projectId = Number(import.meta.env.AIRBRAKE_PROJECT_ID)
const projectKey = import.meta.env.AIRBRAKE_PROJECT_KEY
if (projectId && projectKey) {
  new Notifier({
    projectId,
    projectKey,
    environment: import.meta.env.DEV ? 'development' : 'production',
  })
}

mount(App, { target: document.getElementById('app')! })
