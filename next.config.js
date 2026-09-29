/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: false,
    // pdfmake + pdfkit sao Node-only e usados em server actions.
    // serverComponentsExternalPackages tambem cobre server actions via
    // next-flight-action-entry-loader — evita webpack tentar bundlar
    // deps nativas e reduz cold start.
    serverComponentsExternalPackages: ["pdfmake", "pdfkit"],
    // pdfkit carrega Helvetica.cjs/afm/etc por require dinamico; o
    // tracer da Vercel nao segue esses requires e o deploy sobe sem
    // as fontes -> "Cannot find module .../standard-fonts/Helvetica.cjs"
    // -> Unhandled Rejection -> SIGTERM em quem importa @react-pdf.
    outputFileTracingIncludes: {
      "/rh/contratacoes/**": [
        "./node_modules/pdfkit/js/data/**/*",
        "./node_modules/pdfkit/js/standard-fonts/**/*",
      ],
    },
  },
};

module.exports = nextConfig;
