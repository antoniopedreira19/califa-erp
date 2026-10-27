import { createClient } from "@/lib/supabase/server";
import { FaixaDoProjeto } from "@/components/faixa-do-projeto";
import { itensDeOrcamentos } from "@/lib/faixa-do-projeto";

interface Props {
  tenantId: string;
  projeto: { id: string; nome: string };
  orcamentoId: string;
  /** Mostra o “+” de novo orçamento: quem pode criar, com o projeto ativo. */
  podeCriarOrcamento: boolean;
}

/**
 * Faixa do projeto na tela do orçamento (decisão 106).
 *
 * Busca os irmãos por conta própria, em vez de entrar no `Promise.all` da
 * página: a página segura o fetch da versão inteira, e esta consulta leve
 * (quatro colunas, coberta por `idx_orcamentos_projeto`) vem por streaming
 * dentro de um `<Suspense>` cujo fallback é a mesma faixa sem os itens —
 * a altura não muda quando eles chegam.
 */
export async function FaixaDosOrcamentos({
  tenantId,
  projeto,
  orcamentoId,
  podeCriarOrcamento,
}: Props) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("orcamentos")
    .select("id, nome, status, arquivado_em, created_at")
    .eq("tenant_id", tenantId)
    .eq("projeto_id", projeto.id)
    .order("created_at", { ascending: true });

  if (error) console.error("[orcamento.faixa]", error.message);

  return (
    <FaixaDoProjeto
      {...faixaDoOrcamentoSemItens(projeto, podeCriarOrcamento)}
      ativo={orcamentoId}
      itens={itensDeOrcamentos(
        projeto.id,
        (data ?? []) as Array<{
          id: string;
          nome: string;
          status: string;
          arquivado_em: string | null;
          created_at: string;
        }>,
        orcamentoId,
      )}
    />
  );
}

/** O que a faixa do orçamento tem antes dos itens — também é o fallback. */
export function faixaDoOrcamentoSemItens(
  projeto: {
    id: string;
    nome: string;
  },
  podeCriarOrcamento: boolean,
) {
  return {
    modulo: "orcamentos" as const,
    reservaDoVoltar: `/orcamentos/${projeto.id}`,
    projeto: {
      nome: projeto.nome,
      href: `/orcamentos/${projeto.id}`,
    },
    agregadaHref: `/orcamentos/${projeto.id}/agregado`,
    novoHref: novoOrcamentoHref(projeto.id, podeCriarOrcamento),
  };
}

/** Destino do “+” da faixa: a mesma página do "Novo orçamento" da página do
 *  projeto (decisão do Tiago, 05/10/2026). `undefined` esconde o “+”. */
export function novoOrcamentoHref(
  projetoId: string,
  podeCriarOrcamento: boolean,
): string | undefined {
  return podeCriarOrcamento ? `/orcamentos/${projetoId}/novo` : undefined;
}
