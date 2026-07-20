/** Apply the color theme by toggling data-theme on <html> (drives the CSS variables). */
export function applyTheme(theme: 'dark' | 'light'): void {
  document.documentElement.dataset.theme = theme
}

/** Read the saved theme and apply it. Call once on each renderer entry, before first paint. */
export function initTheme(): void {
  void window.api.getSettings().then((s) => applyTheme(s.theme))
}
