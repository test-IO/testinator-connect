interface ImportMetaEnv {
  readonly AIRBRAKE_PROJECT_ID?: string
  readonly AIRBRAKE_PROJECT_KEY?: string
  readonly MAIN_VITE_MAC_SIGNED?: string
  readonly MAIN_VITE_AUTO_UPDATE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
