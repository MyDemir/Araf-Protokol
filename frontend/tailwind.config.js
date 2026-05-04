/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        app: 'var(--color-bg-app)',
        shell: 'var(--color-bg-shell)',
        surface: 'var(--color-bg-surface)',
        elevated: 'var(--color-bg-elevated)',
        borderSubtle: 'var(--color-border-subtle)',
        borderStrong: 'var(--color-border-strong)',
        textPrimary: 'var(--color-text-primary)',
        textSecondary: 'var(--color-text-secondary)',
        textMuted: 'var(--color-text-muted)',
        brand: 'var(--color-brand)',
        info: 'var(--color-info)',
        warning: 'var(--color-warning)',
        danger: 'var(--color-danger)',
        success: 'var(--color-success)',
      },
      borderRadius: {
        control: '0.5rem',
        card: '0.75rem',
        sheet: '1rem',
      },
    },
  },
  plugins: [],
}
