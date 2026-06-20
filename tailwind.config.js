/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        background: '#0B0B0F',
        surface: '#16161D',
        primary: '#5B8DEF',
        accent: '#F2C14E',
        muted: '#8A8A99',
        danger: '#E5484D',
        success: '#46A758',
      },
    },
  },
  plugins: [],
};
