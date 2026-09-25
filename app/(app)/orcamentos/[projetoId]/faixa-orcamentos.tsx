import { createClient } from "@/lib/supabase/server";
import { FaixaDoProjeto } from "@/components/faixa-do-projeto";
import { itensDeOrcamentos } from "@/lib/faixa-do-projeto";

interface Props {
  tenantId: string;
  projeto: { id: string; codigo: string; nome: string };
  orcamentoId: string;
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
export async function FaixaDosOrcamentos({ tenantId, projeto, orcamentoId }: Props) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("orcamentos")
    .select("id, codigo, nome, status")
    .eq("tenant_id", tenantId)
    .eq("projeto_id", projeto.id)
    .order("codigo", { ascending: true });

  if (error) console.error("[orcamento.faixa]", error.message);

  return (
    <FaixaDoProjeto
      {...faixaDoOrcamentoSemItens(projeto)}
      ativo={orcamentoId}
      itens={itensDeOrcamentos(
        projeto.id,
        (data ?? []) as Array<{ id: string; codigo: string; nome: string; status: string }>,
        orcamentoId,
      )}
    />
  );
}

/** O que a faixa do orçamento tem antes dos itens — também é o fallback. */
export function faixaDoOrcamentoSemItens(projeto: {
  id: string;
  codigo: string;
  nome: string;
}) {
  return {
    modulo: "orcamentos" as const,
    voltar: {
      href: `/orcamentos/${projeto.id}`,
      rotulo: `${projeto.codigo} · ${projeto.nome}`,
      titulo: `Voltar para ${projeto.codigo} · ${projeto.nome}`,
    },
    projeto: { codigo: projeto.codigo, nome: projeto.nome },
    agregadaHref: `/orcamentos/${projeto.id}/agregado`,
  };
}
