/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        araf: {
          dark: '#0f172a',
          red: '#ef4444',
          green: '#10b981'
        }
      }
    },
  },
  plugins: [],
}
