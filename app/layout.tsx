import type { Metadata } from "next";
import { Suspense } from "react";
import { Inter, Fraunces } from "next/font/google";
import "./globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TopProgressBar } from "@/components/top-progress-bar";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

// Fonte display para títulos com cara de agência (editorial, expressiva).
// Usada em headings grandes via `font-display` no Tailwind.
const fraunces = Fraunces({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
  axes: ["opsz"],
});

export const metadata: Metadata = {
  title: "Sistema Califa",
  description:
    "ERP gerencial da Agência California — orçamentos, versões e jobs.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" className={`${inter.variable} ${fraunces.variable}`}>
      <body className="min-h-screen bg-background font-sans antialiased">
        {/* Suspense exigido pelo Next 14 por conta do useSearchParams no
            TopProgressBar — sem ele, o build força a árvore toda a virar
            client-side rendering. */}
        <Suspense fallback={null}>
          <TopProgressBar />
        </Suspense>
        <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
      </body>
    </html>
  );
}
