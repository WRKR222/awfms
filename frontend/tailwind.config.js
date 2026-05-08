/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // ── Brand palette ──────────────────────────────────────────────────
        brand: {
          green:      '#1A6B3A',
          greenDark:  '#4ade80',   // lighter green for dark mode text
          mid:        '#2E8B57',
          light:      '#E8F5ED',
          lightDark:  '#1a2e20',   // dark mode equivalent of light
          teal:       '#0D7377',
          tealLight:  '#E0F4F4',
          gold:       '#B8860B',
          goldLight:  '#FFF8E1',
        },
        status: {
          pending:  '#F59E0B',
          approved: '#10B981',
          returned: '#EF4444',
          overdue:  '#DC2626',
        },
        // ── Dark mode surface palette ──────────────────────────────────────
        dark: {
          bg:      '#0a0f0d',   // deepest background
          surface: '#111a14',   // header / nav
          card:    '#162018',   // card background
          border:  '#243329',   // subtle borders
          text:    '#e8f0ea',   // primary text
          muted:   '#6b8f74',   // secondary text
        },
      },
      fontFamily: {
        sans: ['Poppins', 'system-ui', 'sans-serif'],
      },
      scale: {
        '98': '0.98',
      },
    },
  },
  plugins: [],
};
