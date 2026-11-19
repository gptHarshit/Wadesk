/**
 * Light or dark theme. Each person's choice is kept in their own browser, so
 * teammates can use different themes. Light is the default.
 */
export const THEME_KEY = 'wadesk-theme';

/** Runs in <head> before the page paints, so a dark-theme user never sees a white flash. */
export const THEME_BOOT_SCRIPT = `try{if(localStorage.getItem('${THEME_KEY}')==='dark')document.documentElement.classList.add('dark')}catch(e){}`;

export function currentTheme() {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

export function applyTheme(theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Private mode or storage blocked: the theme still applies until the page reloads.
  }
}
