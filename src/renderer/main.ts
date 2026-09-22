import { mount } from 'svelte'
import { Notifier } from '@airbrake/browser'
import App from './App.svelte'
import { status, platform } from './lib/ipc.svelte'

// Config is baked in at build time (see electron.vite.config.ts + .env.local.example).
// A local dev build with no .env simply runs without error reporting.
const projectId = Number(import.meta.env.AIRBRAKE_PROJECT_ID)
const projectKey = import.meta.env.AIRBRAKE_PROJECT_KEY
if (projectId && projectKey) {
  const airbrake = new Notifier({
    projectId,
    projectKey,
    environment: import.meta.env.DEV ? 'development' : 'production',
  })

  // Read live at notify time — both values are fetched over IPC shortly after
  // startup (see initIpc in ./lib/ipc.svelte.ts) and may not be populated yet
  // when this filter is registered.
  airbrake.addFilter((notice) => {
    notice.context = {
      ...notice.context,
      installationId: status.installationId,
      platform: platform.value,
    }
    return notice
  })
}

mount(App, { target: document.getElementById('app')! })
