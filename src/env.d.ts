/// <reference types="vite/client" />
/// <reference types="unplugin-icons/types/vue" />

declare const __APP_VERSION__: string;
declare const __APP_REPO_URL__: string;
declare const __APP_REPO_NAME__: string;
declare const __APP_AUTHOR__: string;
declare const __APP_HOMEPAGE__: string;
declare const __APP_AUTHOR_URL__: string;

interface Window {
  __splashStart?: number;
}
