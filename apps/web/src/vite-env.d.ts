/// <reference types="vite/client" />

interface ImportMetaEnv {
  // API key con solo read:now para la pantalla informativa; se incrusta en el build
  readonly VITE_INFO_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
