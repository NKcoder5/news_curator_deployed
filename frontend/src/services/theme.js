/**
 * Light or dark: the reader's system setting until they choose, then their
 * choice, remembered.
 *
 * Storage can be missing or throw (private windows, blocked site data,
 * embedded previews), and a theme is never worth a broken page, so every
 * access is guarded and a failure simply means "follow the system".
 * public/index.html applies the stored choice before React loads, so the
 * page does not flash the wrong theme first.
 */
export const THEME_KEY = 'pp-theme';

export const readStoredTheme = () => {
  try {
    const value = window.localStorage.getItem(THEME_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch (_) {
    return null;
  }
};

export const storeTheme = (theme) => {
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch (_) {
    // The choice still applies for this visit; it just will not be remembered.
  }
};

export const systemTheme = () => {
  try {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch (_) {
    return 'light';
  }
};

export const currentTheme = () => readStoredTheme() || systemTheme();

export const applyTheme = (theme) => {
  document.documentElement.setAttribute('data-theme', theme);
};
