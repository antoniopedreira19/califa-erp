"use server";

import { requireSession } from "@/lib/auth/session";
import { extrairArquivoXlsx } from "@/lib/importacao/arquivo";
import {
  parseOficial,
  type ParseResultado,
} from "@/lib/importacao/parser-oficial";
import type { ImportacaoWarning } from "@/lib/types";
import type { GrupoPayload } from "./tipos";

// ============================================================
// Parse da planilha SEM persistir
// ============================================================

export type ParseRascunhoResult =
  | {
      ok: true;
      grupos: GrupoPayload[];
      warnings: ImportacaoWarning[];
      percentual_honorarios: number | null;
      arquivo_nome: string;
      linhas_lidas: number;
      linhas_importadas: number;
      linhas_ignoradas: number;
    }
  | { ok: false; message: string };

/**
 * Lê o XLSX e devolve grupos e itens prontos para entrar no rascunho.
 * Não escreve nada — no editor do orçamento do projeto o banco só é
 * tocado no "Salvar orçamentos". O arquivo original fica com o cliente e
 * volta no salvamento, que é quando ele é arquivado no bucket.
 */
export async function parsePlanilhaRascunho(
  formData: FormData,
): Promise<ParseRascunhoResult> {
  await requireSession();

  const arq = await extrairArquivoXlsx(formData);
  if (!arq.ok) return { ok: false, message: arq.message };

  let parsed: ParseResultado;
  try {
    parsed = await parseOficial(arq.buffer);
  } catch (err) {
    console.error("[multi.parse]", err);
    return {
      ok: false,
      message:
        "Não conseguimos ler o arquivo. Verifique se é a planilha padrão salva como .xlsx.",
    };
  }

  if (parsed.grupos.length === 0) {
    return {
      ok: false,
      message:
        parsed.warnings[0]?.motivo ??
        "Nenhum item encontrado na planilha. Confira a aba 'Oficial'.",
    };
  }

  return {
    ok: true,
    grupos: parsed.grupos.map((g) => ({
      nome: g.nome,
      itens: g.itens.map((it) => ({
        item: it.item,
        tipo_custo: it.tipo_custo,
        categoria_id: null,
        valor_unitario_orcado: it.valor_unitario_orcado,
        quantidade_orcada: it.quantidade_orcada,
        dias_meses_orcado: it.dias_meses_orcado,
        valor_unitario_planejado: it.valor_unitario_planejado,
        quantidade_planejada: it.quantidade_planejada,
        dias_meses_planejado: it.dias_meses_planejado,
        planilha_origem: `linha ${it.linha_xlsx}`,
        bv: null,
      })),
    })),
    warnings: parsed.warnings,
    percentual_honorarios: parsed.percentual_honorarios,
    arquivo_nome: arq.nome,
    linhas_lidas: parsed.linhas_lidas,
    linhas_importadas: parsed.linhas_importadas,
    linhas_ignoradas: parsed.linhas_ignoradas,
  };
}
