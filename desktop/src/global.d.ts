import type { DesktopApi } from "./shared";

declare global {
  interface Window {
    deepseekDesktop: DesktopApi;
  }
}

export {};
