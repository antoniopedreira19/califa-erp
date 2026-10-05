"use server";

/**
 * A lista do "CNAE sugerido" do envio para faturamento (módulo fiscal,
 * entrega 1 — 02/10/2026): os CNAEs cadastrados nos CNPJs do grupo, um por
 * código + subitem da LC 116 (`cnaesDoGrupo`). Lida quando o pop-up do envio
 * abre — e não com a página do job, para não pesar a página.
 *
 * Só leitura. A trava é a mesma do envio (`jobs.enviar_faturamento`): a
 * lista só serve a quem envia.
 */
import { requireSession } from "@/lib/auth/session";
import { checarPermissao } from "@/lib/permissoes-server";
import { createClient } from "@/lib/supabase/server";
import { cnaesDoGrupo } from "@/lib/fiscal/cadastro";
import type { FiscalCnae } from "@/lib/types";

/** Um CNAE da lista do envio: o código, o subitem e a atividade. */
export interface CnaeDoGrupo {
  codigo: string;
  subitem: string | null;
  descricao: string;
}

export type CnaesDoGrupoResult =
  | { ok: true; cnaes: CnaeDoGrupo[] }
  | { ok: false; message: string };

export async function listarCnaesDoGrupo(): Promise<CnaesDoGrupoResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "jobs.enviar_faturamento");
  if (!gate.ok) return { ok: false, message: gate.message };

  const supabase = createClient();
  const { data, error } = await supabase
    .from("fiscal_cnaes")
    .select("*")
    .eq("tenant_id", session.activeTenant.id)
    .eq("ativo", true)
    .order("codigo")
    .order("subitem", { nullsFirst: true });
  if (error) {
    console.error("[envio.cnaes_do_grupo]", error.message);
    return { ok: false, message: "Não foi possível carregar a lista de CNAEs. Feche e abra o envio de novo." };
  }

  // `cnaesDoGrupo` só lê os CNAEs do cadastro: o resto vai vazio.
  const cnaes = cnaesDoGrupo({
    regimes: [],
    estabelecimentos: [],
    cnaes: (data ?? []) as FiscalCnae[],
    feriados: [],
    parametros: [],
    receitasAnteriores: [],
  });
  return {
    ok: true,
    cnaes: cnaes.map((c) => ({ codigo: c.codigo, subitem: c.subitem, descricao: c.descricao })),
  };
}
