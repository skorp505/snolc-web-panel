import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // OpenWrt LuCI-style palette
        canvas: "hsl(224 22% 10%)",
        canvasHover: "hsl(224 22% 14%)",
        panel: "hsl(224 22% 13%)",
        panelHover: "hsl(224 22% 17%)",
        border: "hsl(220 15% 26%)",
        foreground: "hsl(210 40% 96%)",
        muted: "hsl(220 14% 20%)",
        "muted-foreground": "hsl(217 10% 58%)",
        card: "hsl(222 20% 12%)",
        primary: "hsl(199 89% 48%)",
        destructive: "hsl(4 80% 58%)",
      },
    },
  },
  plugins: [],
} satisfies Config;
