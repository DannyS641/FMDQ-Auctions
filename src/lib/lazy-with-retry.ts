import { lazy } from "react";

const RETRY_KEY_PREFIX = "lazy-retry:";

export function lazyWithRetry<T extends { default: React.ComponentType<any> }>(
  importer: () => Promise<T>,
  key: string
) {
  return lazy(async () => {
    try {
      const module = await importer();
      sessionStorage.removeItem(`${RETRY_KEY_PREFIX}${key}`);
      return module;
    } catch (error) {
      const retryKey = `${RETRY_KEY_PREFIX}${key}`;
      const alreadyRetried = sessionStorage.getItem(retryKey) === "1";

      if (!alreadyRetried) {
        sessionStorage.setItem(retryKey, "1");
        window.location.reload();
        return new Promise<T>(() => undefined);
      }

      throw error;
    }
  });
}
