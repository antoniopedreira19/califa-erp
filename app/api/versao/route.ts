/**
 * A versão publicada do sistema (09/10/2026), para o aviso de versão nova
 * (`components/aviso-de-versao-nova.tsx`).
 *
 * Estática: o valor sai do build (`next.config.js`), e cada publicação tem
 * a sua. O `fetch` que a tela faz para cá não carrega o id da publicação, e
 * a proteção de versão da Vercel o manda para a publicação MAIS NOVA — é
 * assim que uma aba presa na versão antiga descobre que existe outra.
 *
 * Fora do middleware (o matcher a exclui): não lê sessão nem banco, e a id
 * da publicação já está no HTML de qualquer página.
 */
export const dynamic = "force-static";

export function GET() {
  return Response.json({ versao: process.env.VERSAO_DO_SISTEMA ?? "local" });
}
