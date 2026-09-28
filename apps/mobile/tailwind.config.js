/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        surface: {
          50: '#fafafa',
          100: '#f5f5f5',
          200: '#e5e5e5',
          300: '#d4d4d4',
          400: '#a3a3a3',
          500: '#737373',
          600: '#525252',
          700: '#404040',
          800: '#262626',
          900: '#171717',
          950: '#0a0a0a'
        },
        background: '#0a0a0a',
        foreground: '#fafafa',
        card: { DEFAULT: '#141414', foreground: '#fafafa' },
        popover: { DEFAULT: '#1c1c1c', foreground: '#fafafa' },
        primary: { DEFAULT: '#fafafa', foreground: '#0a0a0a' },
        secondary: { DEFAULT: '#262626', foreground: '#fafafa' },
        muted: { DEFAULT: '#262626', foreground: '#a3a3a3' },
        border: '#262626',
        input: '#333333',
        ring: '#737373',
        positive: '#34d399',
        attention: '#fbbf24',
        destructive: { DEFAULT: '#fb7185', foreground: '#0a0a0a' },
        accent: {
          300: '#ffffff',
          400: '#fafafa',
          500: '#d4d4d4'
        }
      }
    }
  },
  plugins: []
}
