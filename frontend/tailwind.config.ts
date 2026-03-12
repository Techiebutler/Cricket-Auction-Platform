import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#fef3c7",
          100: "#fde68a",
          500: "#f59e0b",
          600: "#d97706",
          700: "#b45309",
          900: "#78350f",
        },
      },
    },
  },
  plugins: [],
};

export default config;
