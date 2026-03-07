/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // AWFMS brand palette
        brand: {
          green:  '#1A6B3A',
          mid:    '#2E8B57',
          light:  '#E8F5ED',
          teal:   '#0D7377',
          tealLight: '#E0F4F4',
          gold:   '#B8860B',
          goldLight: '#FFF8E1',
        },
        status: {
          pending:  '#F59E0B', // amber
          approved: '#10B981', // green
          returned: '#EF4444', // red
          overdue:  '#DC2626', // dark red
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
