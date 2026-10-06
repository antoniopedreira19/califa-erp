"use server";

import { requireSession } from "@/lib/auth/session";
import { baixarEnvio, type EnvioDaPlanilha } from "@/lib/importacao/envio";
import {
  abaSugerida,
  lerTodasAsAbas,
  ordenarAbas,
  totaisDaAba,
  type AbaLida,
  type AbaResumo,
} from "@/lib/importacao/abas-do-arquivo";
import { parseOficial, recusaPorModelo, type ParseResultado } from "@/lib/importacao/parser-oficial";
import { montarPreviewDaAba } from "@/lib/importacao/preview-da-aba";
import type { PreviewDaAba, PreviewResult } from "@/lib/importacao/tipos-da-importacao";
import type { CategoriaModeloPlanilha } from "@/lib/types";
import type { GrupoPayload } from "./tipos";

// ============================================================
// Importação de planilha no editor do orçamento — SEM persistir
// ============================================================
//
// Só leitura. O arquivo já está no Storage (o navegador o subiu direto,
// decisão 110): aqui ele é lido para a prévia. Quem grava é a importação
// da versão, chamada pela agregada (`importarPlanilhaNaAgregada`, decisão
// 148), que registra a importação e descarta o arquivo.

interface EntradaDoRascunho {
  envio: EnvioDaPlanilha;
  /** O modelo do orçamento que recebe a planilha: a de outro modelo é
   *  recusada (decisão 072). Orçamento mensal não nasce por aqui. */
  modelo_planilha: CategoriaModeloPlanilha;
  /** Serviço Interno (decisão 105): a linha com tipo em branco ou
   *  desconhecido entra como F · Interno em vez de ser descartada. */
  interno: boolean;
}

function modeloDoRascunho(m: CategoriaModeloPlanilha): CategoriaModeloPlanilha {
  return m === "internacional" ? "internacional" : "nacional";
}

/** A tabela de abas e o resumo de cada aba legível (decisão 110). */
export async function lerPlanilhaDoRascunho(entrada: EntradaDoRascunho): Promise<PreviewResult> {
  const session = await requireSession();
  const arq = await baixarEnvio(entrada.envio, session.activeTenant.id);
  if (!arq.ok) return { ok: false, message: arq.message };

  let lidas: AbaLida[];
  try {
    lidas = await lerTodasAsAbas(arq.buffer, { tipoFixo: entrada.interno ? "FI" : undefined });
  } catch (err) {
    console.error("[multi.parse]", err);
    return {
      ok: false,
      message: "Não conseguimos ler o arquivo. Verifique se é uma planilha salva como .xlsx.",
    };
  }

  const previews: Record<string, PreviewDaAba> = {};
  const abas: AbaResumo[] = lidas.map((lida) => {
    const r = montarPreviewDaAba(lida.parsed, {
      modelo: modeloDoRascunho(entrada.modelo_planilha),
      anterior: null,
      mesesDestino: null,
      honorarios: null,
    });
    if (!r.ok) {
      return {
        nome: lida.nome,
        visivel: lida.visivel,
        legivel: false,
        motivo: r.motivo,
        grupos: 0,
        itens: 0,
        orcado: 0,
        planejado: 0,
      };
    }
    previews[lida.nome] = r.preview;
    return { nome: lida.nome, visivel: lida.visivel, legivel: true, motivo: null, ...totaisDaAba(r.parsed) };
  });

  const sugerida = abaSugerida(abas);
  if (!sugerida) {
    return {
      ok: false,
      message:
        abas.length === 1
          ? (abas[0].motivo ?? "Nenhum item encontrado na planilha.")
          : `Nenhuma das ${abas.length} abas do arquivo está no formato do orçamento. Confira o modelo e envie de novo.`,
    };
  }
  return {
    ok: true,
    arquivo: { nome: entrada.envio.nome, tamanho: entrada.envio.tamanho },
    abas: ordenarAbas(abas),
    sugerida,
    previews,
  };
}

export type AbaNoRascunhoResult =
  | {
      ok: true;
      grupos: GrupoPayload[];
      percentual_honorarios: number | null;
      avisos: number;
    }
  | { ok: false; message: string };

/** Grupos e itens da aba escolhida, prontos para entrar no rascunho. */
export async function carregarAbaNoRascunho(
  entrada: EntradaDoRascunho & { aba: string },
): Promise<AbaNoRascunhoResult> {
  const session = await requireSession();
  const arq = await baixarEnvio(entrada.envio, session.activeTenant.id);
  if (!arq.ok) return { ok: false, message: arq.message };

  let parsed: ParseResultado;
  try {
    parsed = await parseOficial(arq.buffer, {
      tipoFixo: entrada.interno ? "FI" : undefined,
      aba: entrada.aba,
    });
  } catch (err) {
    console.error("[multi.parse]", err);
    return { ok: false, message: "Não conseguimos ler o arquivo. Envie de novo." };
  }

  const recusa = recusaPorModelo(parsed.modelo, modeloDoRascunho(entrada.modelo_planilha));
  if (recusa) return { ok: false, message: recusa };
  if (parsed.grupos.length === 0) {
    return { ok: false, message: parsed.warnings[0]?.motivo ?? "Nenhum item encontrado na aba." };
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
    percentual_honorarios: parsed.percentual_honorarios,
    avisos: parsed.warnings.length,
  };
}
