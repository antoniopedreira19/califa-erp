// Mesma configuração de tailwind.config.ts do ERP, com o content do protótipo.
module.exports = {
  content: [__dirname + "/src/**/*.js"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "var(--font-sans)", "serif"],
      },
      colors: {
        border: "hsl(var(--border))", input: "hsl(var(--input))", ring: "hsl(var(--ring))",
        background: "hsl(var(--background))", foreground: "hsl(var(--foreground))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },
        california: { red: "#E74B56", "red-hover": "#d83e49", "red-soft": "#fef0f1", dark: "#282828", "dark-soft": "#3a3a3a", black: "#000000", cream: "#FAFAFA" },
      },
      borderRadius: { lg: "var(--radius)", md: "calc(var(--radius) - 2px)", sm: "calc(var(--radius) - 4px)" },
      boxShadow: {
        soft: "0 1px 2px 0 rgba(0,0,0,0.02), 0 1px 3px 0 rgba(0,0,0,0.04)",
        elevated: "0 1px 2px 0 rgba(0,0,0,0.03), 0 8px 24px -6px rgba(0,0,0,0.06)",
      },
    },
  },
  plugins: [],
};
