/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // A versão publicada, fixada no build: a aba compara a dela com a que
  // /api/versao devolve e avisa que há versão nova (09/10/2026 —
  // components/aviso-de-versao-nova.tsx). Fora da Vercel fica "local".
  env: {
    VERSAO_DO_SISTEMA:
      process.env.VERCEL_DEPLOYMENT_ID ||
      process.env.VERCEL_GIT_COMMIT_SHA ||
      "local",
  },
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
