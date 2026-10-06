"use server";

import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { checarPermissao } from "@/lib/permissoes-server";
import type { TipoCusto } from "@/lib/types";
import type { EnvioDaPlanilha } from "@/lib/importacao/envio";
import type { GrupoRascunho } from "../../_rascunho/tipos";
import { sobrescreverVersaoComPlanilha } from "../[orcId]/versoes/importar-actions";

/**
 * Desde 06/10/2026 (decisão 148) a visão agregada não tem mais "Salvar
 * alterações": cada alteração grava na hora, pelas MESMAS actions da tela
 * da versão (célula, item, grupo, ordem, parâmetros, BV, save) e pela
 * `criarOrcamentoDaAgregada`. O salvamento em lote — que mandava a tela
 * inteira e reconciliava contra o banco — saiu: ele apagava o que não
 * estava na tela de quem salvava, e foi por ele que o AMB-P017/26 ganhou
 * 36 cópias em 05/10/2026.
 *
 * Aqui fica só o que a tela da versão não tem pronto para a agregada.
 */

export type ImportacaoNaAgregadaResult =
  | { ok: true; grupos: GrupoRascunho[] }
  | { ok: false; message: string };

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * O "Importar planilha" do card da agregada: a mesma importação da tela da
 * versão (`sobrescreverVersaoComPlanilha` — relê o arquivo no servidor,
 * recusa planilha de outro modelo, aplica o Interno, registra em
 * `orcamento_importacoes` e descarta o XLSX), seguida da leitura do que
 * ficou gravado. A tela troca a planilha do card pelos grupos e itens com
 * os ids do banco, e daí em diante cada célula grava por id.
 *
 * O card só oferece a importação na versão sem planilha; por isso o
 * planejado vem sempre da planilha (não há anterior para casar).
 */
export async function importarPlanilhaNaAgregada(
  versaoId: string,
  envio: EnvioDaPlanilha & { aba: string },
): Promise<ImportacaoNaAgregadaResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "orcamentos.editar");
  if (!gate.ok) return { ok: false, message: gate.message };

  const res = await sobrescreverVersaoComPlanilha(versaoId, {
    envio: { path: envio.path, nome: envio.nome, tamanho: envio.tamanho },
    aba: envio.aba,
    origem_planejado: "planilha",
  });
  if (!res.ok) return { ok: false, message: res.message };

  const supabase = createClient();
  const tenantId = session.activeTenant.id;
  const [gruposRes, itensRes] = await Promise.all([
    supabase
      .from("versoes_orcamento_grupos")
      .select("id, nome, ordem, mes_id")
      .eq("versao_orcamento_id", versaoId)
      .eq("tenant_id", tenantId)
      .order("ordem", { ascending: true }),
    supabase
      .from("versoes_orcamento_itens")
      .select(
        "id, grupo_id, ordem, item, tipo_custo, categoria_id, planilha_origem, " +
          "valor_unitario_orcado, quantidade_orcada, dias_meses_orcado, " +
          "valor_unitario_planejado, quantidade_planejada, dias_meses_planejado, " +
          "em_save, save_consumido",
      )
      .eq("versao_orcamento_id", versaoId)
      .eq("tenant_id", tenantId)
      .order("ordem", { ascending: true }),
  ]);

  if (gruposRes.error || itensRes.error) {
    console.error(
      "[agregado.importar.ler]",
      gruposRes.error?.message ?? itensRes.error?.message,
    );
    return {
      ok: false,
      message: "A planilha foi importada, mas não deu para mostrá-la aqui. Recarregue a página.",
    };
  }

  const itensPorGrupo = new Map<string, GrupoRascunho["itens"]>();
  for (const it of (itensRes.data ?? []) as any[]) {
    const lista = itensPorGrupo.get(it.grupo_id) ?? [];
    lista.push({
      id: it.id,
      item: it.item,
      tipo_custo: it.tipo_custo as TipoCusto,
      categoria_id: it.categoria_id ?? null,
      valor_unitario_orcado: num(it.valor_unitario_orcado),
      quantidade_orcada: num(it.quantidade_orcada),
      dias_meses_orcado: num(it.dias_meses_orcado),
      valor_unitario_planejado: num(it.valor_unitario_planejado),
      quantidade_planejada: num(it.quantidade_planejada),
      dias_meses_planejado: num(it.dias_meses_planejado),
      planilha_origem: it.planilha_origem ?? null,
      em_save: it.em_save === true,
      save_consumido: num(it.save_consumido),
      // Planilha recém-importada não traz BV: a importação apaga os da
      // versão, e os novos se lançam pela janela do BV.
      bv: null,
    });
    itensPorGrupo.set(it.grupo_id, lista);
  }

  const grupos: GrupoRascunho[] = (
    (gruposRes.data ?? []) as { id: string; nome: string; mes_id: string | null }[]
  ).map((g) => ({
    id: g.id,
    nome: g.nome,
    mesId: g.mes_id ?? null,
    itens: itensPorGrupo.get(g.id) ?? [],
  }));

  return { ok: true, grupos };
}
