/**
 * Quem pode ser titular da verba de alimentação ou de transporte (decisão
 * 164): os colaboradores ativos do RH e os freelas ativos da lista
 * provisória, sem repetir quem está nos dois.
 *
 * A ficha do RH só abre para administrador e RH, e a tabela de freelas
 * guarda o CPF; por isso a lista vem da função `pessoas_para_verba`, que
 * devolve só nome, função e o segundo dado da linha (contratação ou
 * cidade), e só para quem gera PP. O formulário carrega a lista quando a
 * verba nova é escolhida, e o servidor relê dela o nome que a PP guarda.
 */

import type { createClient } from "@/lib/supabase/server";
import { tipoContratacaoLabel, type TipoContratacao } from "@/lib/types";

export interface PessoaParaVerba {
  id: string;
  origem: "colaborador" | "freela";
  nome: string;
  funcao: string | null;
  /** A contratação (colaborador) ou a cidade (freela). */
  detalhe: string | null;
  /** O nome social do freela: entra na busca, não aparece na lista. */
  busca: string | null;
}

const CONTRATACOES: ReadonlySet<string> = new Set(["pj", "mei", "clt_recibo", "clt", "estagio", "socio"]);

export async function carregarPessoasParaVerba(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
): Promise<PessoaParaVerba[]> {
  const { data, error } = await supabase.rpc("pessoas_para_verba", { p_tenant_id: tenantId });
  if (error) {
    console.error("[pessoas_para_verba]", error.message);
    return [];
  }
  const linhas = (data ?? []) as Array<{
    id: string;
    origem: "colaborador" | "freela";
    nome: string;
    funcao: string | null;
    detalhe: string | null;
    busca: string | null;
  }>;
  return linhas
    .map((l) => ({
      id: l.id,
      origem: l.origem,
      nome: l.nome.trim(),
      funcao: l.funcao?.trim() || null,
      detalhe:
        l.origem === "colaborador" && l.detalhe && CONTRATACOES.has(l.detalhe)
          ? tipoContratacaoLabel(l.detalhe as TipoContratacao)
          : l.detalhe?.trim() || null,
      busca: l.busca?.trim() || null,
    }))
    .sort(
      (a, b) =>
        (a.origem === b.origem ? 0 : a.origem === "colaborador" ? -1 : 1) ||
        a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" }),
    );
}
