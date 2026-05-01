const defaultTheme = require('tailwindcss/defaultTheme');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        ink: {
          DEFAULT: '#0A0A0B',
          900: '#0A0A0B',
          800: '#171719',
          700: '#27272A',
        },
        canvas: {
          DEFAULT: '#FAFAF7',
          50: '#FFFFFF',
          100: '#FAFAF7',
          200: '#F4F4EF',
          300: '#E9E9E2',
        },
        line: '#E5E5E0',
        muted: '#6B7280',
        accent: {
          DEFAULT: '#FF6A3D',
          50: '#FFF1EB',
          100: '#FFE0D2',
          500: '#FF6A3D',
          600: '#E5572C',
          700: '#B8431F',
        },
        success: '#16A34A',
        warning: '#D97706',
        danger: '#DC2626',
        info: '#0EA5E9',
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.125rem',
      },
      boxShadow: {
        soft: '0 1px 2px 0 rgb(10 10 11 / 0.04), 0 1px 3px 0 rgb(10 10 11 / 0.06)',
        card: '0 1px 0 0 rgb(10 10 11 / 0.04), 0 4px 14px -4px rgb(10 10 11 / 0.08)',
      },
    },
  },
  plugins: [],
};
