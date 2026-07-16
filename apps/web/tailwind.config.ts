import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  safelist: [
    "dark",
    "badge-green",
    "badge-red",
    "badge-amber",
    "badge-blue",
    "toast-viewport",
    "toast",
    "update-pill",
  ],
  theme: {
    container: {
      center: true,
      padding: "1rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--border))",
        ring: "hsl(var(--accent))",
        background: "hsl(var(--surface))",
        foreground: "hsl(var(--text))",

        surface: {
          DEFAULT: "hsl(var(--surface))",
          2: "hsl(var(--surface2))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          2: "hsl(var(--accent2))",
          foreground: "hsl(var(--white))",
        },
        primary: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--white))",
        },
        secondary: {
          DEFAULT: "hsl(var(--surface2))",
          foreground: "hsl(var(--text))",
        },
        destructive: {
          DEFAULT: "hsl(var(--red))",
          foreground: "hsl(var(--white))",
        },
        success: {
          DEFAULT: "hsl(var(--green))",
          foreground: "hsl(var(--white))",
        },
        warning: {
          DEFAULT: "hsl(var(--amber))",
          foreground: "hsl(var(--white))",
        },
        info: {
          DEFAULT: "hsl(var(--blue))",
          foreground: "hsl(var(--white))",
        },
        popover: {
          DEFAULT: "hsl(var(--surface2))",
          foreground: "hsl(var(--text))",
        },
        card: {
          DEFAULT: "hsl(var(--surface2))",
          foreground: "hsl(var(--text))",
        },
        white: "hsl(var(--white))",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [animate],
} satisfies Config;
