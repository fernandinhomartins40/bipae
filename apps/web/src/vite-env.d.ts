/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  /** Test/dev override for the Bipaê Conector address. */
  readonly VITE_CONNECTOR_URL?: string;
}

declare const __APP_VERSION__: string;
