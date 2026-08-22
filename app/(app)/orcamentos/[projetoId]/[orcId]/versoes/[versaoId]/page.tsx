import { permanentRedirect } from "next/navigation";

/**
 * A página da versão deixou de existir em 21/08/2026.
 *
 * O handoff "Orcamento - Versoes em Abas" fundiu orçamento e versões numa
 * tela só: as versões viraram abas em `/orcamentos/[projetoId]/[orcId]` e a
 * aba selecionada vive no `?v=`. Esta rota fica de pé só como tradução,
 * porque endereço de versão está gravado em link de gente e apontado por
 * outros módulos — job, financeiro, realizado e o revalidate do BV.
 *
 * Não valida se a versão existe nem se é deste orçamento de propósito:
 * quem faz isso é a tela de destino, que cai na aba padrão quando o `?v=`
 * não bate. Um redirect que consulta o banco custaria um round-trip para
 * chegar exatamente ao mesmo lugar.
 */
export default function VersaoRedirectPage({
  params,
}: {
  params: { projetoId: string; orcId: string; versaoId: string };
}) {
  permanentRedirect(
    `/orcamentos/${params.projetoId}/${params.orcId}?v=${params.versaoId}`,
  );
}
