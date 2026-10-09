import { createClient } from "@/lib/supabase/server";
import { PagamentosListaCliente } from "./pagamentos-lista-cliente";
import type { TipoContratacao } from "@/lib/types";

type Props = {
  tenantId: string;
};

export type PagamentoFerias = {
  id: string;
  colaborador_id: string;
  colaborador_nome: string;
  tipo_contratacao: TipoContratacao;
  salario_base: number;
  status: "rascunho" | "enviada" | "aprovada" | "pendente_correcao" | "paga";
  origem: "california" | "contabilidade";
  data_pagamento_prevista: string | null;
  data_pagamento: string | null;
  anexo_url: string | null;
  lancamento_ferias_id: string | null;
  lancamento_data_inicio: string | null;
  lancamento_data_fim: string | null;
  lancamento_dias: number | null;
  enviada_em: string | null;
};

export async function AbaPagamentos({ tenantId }: Props) {
  const supabase = createClient();

  // Puxa todas as folhas de férias do tenant com dados do colaborador e
  // do lançamento associado. Agrupamento + seleção é feito no cliente.
  // Limite 500: muito mais que isso e precisamos paginar.
  const { data: rows } = await supabase
    .from("folhas_pagamento")
    .select(
      `
        id,
        salario_base,
        status,
        origem,
        data_pagamento_prevista,
        data_pagamento,
        anexo_url,
        enviada_em,
        colaborador:colaboradores!colaborador_id(id, nome, tipo_contratacao),
        lancamento:colaboradores_ferias_lancamentos!lancamento_ferias_id(id, data_inicio, data_fim, dias)
      `,
    )
    .eq("tenant_id", tenantId)
    .eq("tipo", "ferias")
    .order("data_pagamento_prevista", { ascending: true })
    .limit(500);

  const pagamentos: PagamentoFerias[] = (rows ?? []).map((r) => {
    const colab = r.colaborador as unknown as {
      id: string;
      nome: string;
      tipo_contratacao: TipoContratacao;
    } | null;
    const lanc = r.lancamento as unknown as {
      id: string;
      data_inicio: string;
      data_fim: string;
      dias: number;
    } | null;
    return {
      id: r.id as string,
      colaborador_id: colab?.id ?? "",
      colaborador_nome: colab?.nome ?? "—",
      tipo_contratacao: (colab?.tipo_contratacao ?? "pj") as TipoContratacao,
      salario_base: Number(r.salario_base) || 0,
      status: r.status as PagamentoFerias["status"],
      origem: r.origem as PagamentoFerias["origem"],
      data_pagamento_prevista: (r.data_pagamento_prevista as string | null) ?? null,
      data_pagamento: (r.data_pagamento as string | null) ?? null,
      anexo_url: (r.anexo_url as string | null) ?? null,
      lancamento_ferias_id: lanc?.id ?? null,
      lancamento_data_inicio: lanc?.data_inicio ?? null,
      lancamento_data_fim: lanc?.data_fim ?? null,
      lancamento_dias: lanc?.dias ?? null,
      enviada_em: (r.enviada_em as string | null) ?? null,
    };
  });

  return <PagamentosListaCliente pagamentos={pagamentos} />;
}
