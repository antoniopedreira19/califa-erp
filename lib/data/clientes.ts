import { createClient } from "@/lib/supabase/server";
import { HONORARIOS_PADRAO_FALLBACK } from "@/lib/validations/clientes";

/**
 * Honorários padrão do cliente + nome dele, para as telas e actions de
 * orçamento. É a única fonte do percentual na criação: as telas mostram o
 * campo travado e o servidor grava sempre o que sai daqui, nunca o que
 * veio no payload.
 *
 * `null` significa "não consegui resolver o cliente" — quem chama decide
 * se isso é erro (server action) ou se cai no fallback (tela).
 */
export interface HonorariosDoCliente {
  clienteId: string;
  clienteNome: string;
  percentual: number;
}

/** Linha única por FK — embed de 1:1 é 1 round-trip, não é embed pesado. */
interface ClienteEmbed {
  cliente: {
    id: string;
    nome_fantasia: string;
    percentual_honorarios_padrao: number | string;
  } | null;
}

function normalizar(embed: ClienteEmbed | null): HonorariosDoCliente | null {
  const cliente = embed?.cliente;
  if (!cliente) return null;
  const bruto = Number(cliente.percentual_honorarios_padrao);
  return {
    clienteId: cliente.id,
    clienteNome: cliente.nome_fantasia,
    percentual: Number.isFinite(bruto) ? bruto : HONORARIOS_PADRAO_FALLBACK,
  };
}

/** Cliente do projeto. Usado pelo editor do orçamento do projeto e pela
 *  visão agregada, que criam versões v1 em lote. */
export async function honorariosDoProjeto(
  projetoId: string,
  tenantId: string,
): Promise<HonorariosDoCliente | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("projetos")
    .select("cliente:clientes(id, nome_fantasia, percentual_honorarios_padrao)")
    .eq("id", projetoId)
    .eq("tenant_id", tenantId)
    .maybeSingle<ClienteEmbed>();

  if (error) {
    console.error("[clientes.honorariosDoProjeto]", error.message);
    return null;
  }
  return normalizar(data);
}

/** Cliente do orçamento (via projeto). Usado por nova versão e importação. */
export async function honorariosDoOrcamento(
  orcamentoId: string,
  tenantId: string,
): Promise<HonorariosDoCliente | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("orcamentos")
    .select(
      "projeto:projetos(cliente:clientes(id, nome_fantasia, percentual_honorarios_padrao))",
    )
    .eq("id", orcamentoId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ projeto: ClienteEmbed | null }>();

  if (error) {
    console.error("[clientes.honorariosDoOrcamento]", error.message);
    return null;
  }
  return normalizar(data?.projeto ?? null);
}
