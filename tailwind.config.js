/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        refv: {
          bg: '#fef9ec',
          pri: '#118cd1',
          sky: '#90d4ec',
          ink: '#0d3a57',
          mut: '#6b8799',
          line: '#eae3cf',
          ok: '#1a9a5b',
        }
      }
    },
  },
  plugins: [],
}

