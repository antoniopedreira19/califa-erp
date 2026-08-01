/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: false,
    // pdfmake usa submodule pdfmake/src/printer que nao esta exportado
    // no package.json. Marcamos como external pra Next.js usar o
    // require nativo do Node em runtime, evitando o resolve do webpack.
    // pdfkit e dep transitiva (usada pelo printer).
    serverComponentsExternalPackages: ["pdfmake", "pdfkit"],
  },
};

module.exports = nextConfig;
