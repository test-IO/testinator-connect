interface ImportMetaEnv {
  readonly AIRBRAKE_PROJECT_ID?: string
  readonly AIRBRAKE_PROJECT_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
