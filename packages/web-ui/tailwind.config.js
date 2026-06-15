/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
          950: '#1e1b4b',
        },
        surface: {
          0: '#ffffff',
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
          950: '#020617',
        },
      },
      fontFamily: {
        sans: ['var(--font-cabinet)', 'Cabinet Grotesk', 'system-ui', 'sans-serif'],
        body: ['var(--font-satoshi)', 'Satoshi', 'system-ui', 'sans-serif'],
        mono: ['var(--font-jetbrains)', 'JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        subtle: '0 1px 2px rgba(15,23,42,0.04)',
        small: '0 4px 8px rgba(15,23,42,0.04)',
        medium: '0 4px 16px rgba(99,102,241,0.08)',
        large: '0 8px 24px rgba(15,23,42,0.12)',
        modal:
          '0 0 0 1px rgba(15,23,42,0.05), 0 8px 24px rgba(15,23,42,0.12), 0 24px 64px rgba(15,23,42,0.15), 0 0 120px rgba(99,102,241,0.06)',
        topbar: '0 1px 0 rgba(226,232,240,0.8)',
      },
      keyframes: {
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in-up': 'fadeInUp 0.45s cubic-bezier(0.16,1,0.3,1) forwards',
      },
    },
  },
  plugins: [],
};
