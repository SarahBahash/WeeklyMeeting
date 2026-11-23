import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT: "#172D4D", 50: "#F3F5F8" },
        muted: "#5B6472",
        brand: { DEFAULT: "#25866B", dark: "#1D6B55", light: "#E8F3EF" },
        line: "#E5E7EB",
        danger: { DEFAULT: "#B4483F", light: "#FBEFEE" },
        warn: { DEFAULT: "#A86A0C", light: "#FDF5E7" },
      },
      fontFamily: { sans: ["Inter", "Segoe UI", "system-ui", "-apple-system", "Arial", "sans-serif"] },
      boxShadow: { card: "0 1px 2px rgba(23,45,77,0.05)" },
    },
  },
  plugins: [],
} satisfies Config;
