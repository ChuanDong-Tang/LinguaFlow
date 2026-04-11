/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_REWRITE_API_URL?: string;
  readonly VITE_REWRITE_TIMEOUT_MS?: string;
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
