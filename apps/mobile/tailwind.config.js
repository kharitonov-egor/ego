/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        surface: {
          50: '#f0f1f4',
          100: '#d8dbe3',
          200: '#b1b7c7',
          300: '#8a93ab',
          400: '#636f8f',
          500: '#3c4b73',
          600: '#2d3a5c',
          700: '#1e2945',
          800: '#161e35',
          900: '#0f1525',
          950: '#0a0e1a'
        },
        accent: {
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb'
        }
      }
    }
  },
  plugins: []
}
