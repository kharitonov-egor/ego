/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        surface: {
          50: '#f4f4f5',
          100: '#e6e6e8',
          200: '#d0d0d4',
          300: '#b5b5bc',
          400: '#909099',
          500: '#707078',
          600: '#505056',
          700: '#38383d',
          800: '#2a2a2f',
          900: '#1d1d21',
          950: '#121214'
        },
        accent: {
          300: '#b9dbff',
          400: '#91c4ff',
          500: '#6aaaff',
          600: '#4e91e8'
        }
      }
    }
  },
  plugins: []
}
