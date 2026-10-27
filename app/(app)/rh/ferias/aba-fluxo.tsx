import { createClient } from "@/lib/supabase/server";
import type { RhFeriasFluxoRow } from "@/lib/types";
import type { FolhaDoc } from "./modal-documentos";
import { FluxoKanban } from "./aba-fluxo-kanban";

export async function AbaFluxo({ tenantId }: { tenantId: string }) {
  const supabase = createClient();

  // 1ª query: linhas do kanban (view)
  const { data } = await supabase
    .from("vw_rh_ferias_fluxo")
    .select("*")
    .eq("tenant_id", tenantId);

  const rows = (data ?? []) as RhFeriasFluxoRow[];

  // 2ª query: folhas de pagamento vinculadas aos lançamentos visíveis
  const lancamentoIds = rows
    .map((r) => r.lancamento_id)
    .filter((id): id is string => Boolean(id));

  const folhasPorLancamento: Record<string, FolhaDoc[]> = {};

  if (lancamentoIds.length > 0) {
    const { data: folhasData } = await supabase
      .from("folhas_pagamento")
      .select(
        "id, lancamento_ferias_id, origem, tipo_folha_ferias, salario_base, status, anexo_url",
      )
      .eq("tenant_id", tenantId)
      .eq("tipo", "ferias")
      .in("lancamento_ferias_id", lancamentoIds);

    const folhas = folhasData ?? [];

    // 3ª query: NFs que colaboradores PJ já anexaram
    // Usamos os lancamento_ids das folhas california (PJ) como escopo_id
    const lancamentoIdsComFolhaCalifornia = [
      ...new Set(
        folhas
          .filter((f) => f.origem === "california" && f.lancamento_ferias_id)
          .map((f) => f.lancamento_ferias_id as string),
      ),
    ];

    const nfsAnexadas = new Set<string>();

    if (lancamentoIdsComFolhaCalifornia.length > 0) {
      const { data: nfsData } = await supabase
        .from("colaboradores_nf_anexos")
        .select("escopo_id, escopo_tipo")
        .in("escopo_id", lancamentoIdsComFolhaCalifornia)
        .in("escopo_tipo", ["ferias_usufruto", "ferias_abono"]);

      for (const nf of nfsData ?? []) {
        nfsAnexadas.add(`${nf.escopo_id}|${nf.escopo_tipo}`);
      }
    }

    // Agrupa as folhas por lancamento_ferias_id, populando nf_anexada para PJ
    for (const f of folhas) {
      if (!f.lancamento_ferias_id) continue;
      const lid = f.lancamento_ferias_id as string;
      if (!folhasPorLancamento[lid]) folhasPorLancamento[lid] = [];

      // Determina se a NF foi anexada para PJ:
      // A chave no set usa o lancamento_id como escopo_id.
      // O escopo_tipo varia conforme tipo_folha_ferias.
      let nfAnexada = false;
      if (f.origem === "california") {
        const escopoTipo =
          f.tipo_folha_ferias === "abono" ? "ferias_abono" : "ferias_usufruto";
        nfAnexada = nfsAnexadas.has(`${lid}|${escopoTipo}`);
      }

      folhasPorLancamento[lid].push({
        id: f.id as string,
        origem: f.origem as "california" | "contabilidade",
        tipo_folha_ferias: f.tipo_folha_ferias as "usufruto" | "abono" | null,
        salario_base: Number(f.salario_base ?? 0),
        status: f.status as FolhaDoc["status"],
        anexo_url: (f.anexo_url as string | null) ?? null,
        nf_anexada: nfAnexada,
      });
    }
  }

  return <FluxoKanban rows={rows} folhasPorLancamento={folhasPorLancamento} />;
}
