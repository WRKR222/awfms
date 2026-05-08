import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ThemeStore {
  isDark: boolean;
  toggleTheme: () => void;
  setDark: (dark: boolean) => void;
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set, get) => ({
      isDark: true, // dark mode default
      toggleTheme: () => {
        const next = !get().isDark;
        set({ isDark: next });
        applyTheme(next);
      },
      setDark: (dark: boolean) => {
        set({ isDark: dark });
        applyTheme(dark);
      },
    }),
    { name: 'awfms-theme' },
  ),
);

export function applyTheme(isDark: boolean) {
  const root = document.documentElement;
  if (isDark) {
    root.classList.add('dark');
    root.classList.remove('light');
  } else {
    root.classList.remove('dark');
    root.classList.add('light');
  }
}

// Apply theme on load
export function initTheme() {
  const stored = localStorage.getItem('awfms-theme');
  let isDark = true; // default dark
  if (stored) {
    try {
      isDark = JSON.parse(stored)?.state?.isDark ?? true;
    } catch {}
  }
  applyTheme(isDark);
}
