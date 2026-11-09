import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './hooks/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      colors: {
        ink: { 950: '#0b0d12', 900: '#11141b', 850: '#161a23', 800: '#1c212c', 700: '#2a3140', 600: '#3a4356', 400: '#8a93a6', 300: '#b4bccb', 100: '#e9ecf2' },
        signal: { DEFAULT: '#5eead4', dim: '#2dd4bf' },
        ember: '#fb7185',
        amber: '#fbbf24',
      },
      keyframes: {
        ripple: { '0%': { transform: 'scale(1)', opacity: '0.45' }, '100%': { transform: 'scale(1.9)', opacity: '0' } },
        bar: { '0%,100%': { transform: 'scaleY(0.35)' }, '50%': { transform: 'scaleY(1)' } },
      },
      animation: {
        ripple: 'ripple 1.6s ease-out infinite',
        bar: 'bar 0.9s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
