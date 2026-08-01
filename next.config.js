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
  },
};

module.exports = nextConfig;
