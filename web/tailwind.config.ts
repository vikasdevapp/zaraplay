import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#000000",
        surface: "#161616",
        surface2: "#212121",
        border: "#333333",
        primary: {
          DEFAULT: "#dc2626",
          dark: "#991b1b",
          light: "#f87171",
        },
        gold: {
          DEFAULT: "#f5f5f5",
          light: "#ffffff",
        },
        muted: "#a3a3a3",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["Georgia", "Cambria", "Times New Roman", "serif"],
      },
      borderRadius: {
        xl2: "1.25rem",
      },
    },
  },
  plugins: [],
};

export default config;
