/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [require('../../packages/ui/tailwind.preset.js')],
  content: ['./src/renderer/**/*.{html,tsx,ts}', '../../packages/ui/src/**/*.{tsx,ts}']
}
