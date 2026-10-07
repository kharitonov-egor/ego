/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [require('../../packages/ui/tailwind.preset.js')],
  content: ['./index.html', './src/**/*.{tsx,ts}', '../../packages/ui/src/**/*.{tsx,ts}']
}
