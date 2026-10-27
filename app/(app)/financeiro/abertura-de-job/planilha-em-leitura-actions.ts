"use server";

/**
 * A Planilha Interna de um job, em leitura, para os pop-ups da abertura
 * (revisão da decisão 155, 19/10/2026): a do próprio job ("Visualizar
 * planilha interna"), a do job de origem de um consumo e a de cada job que
 * consome o crédito deste. Só roda quando alguém abre o pop-up. Até
 * 19/10/2026 a página montava a planilha de cada origem junto com o
 * formulário (`planilha-da-origem.tsx`, por streaming); com a lista
 * "Consumido por" seriam N planilhas carregadas a cada visita ao job.
 *
 * Mesma trava da página da abertura e da do job no financeiro:
 * administrador ou financeiro. A RLS de cada tabela decide o resto, pelo
 * cliente do usuário (`carregarDetalheDoJob`).
 */

import { COMITE_DA_PP_SEM_ACAO } from "@/lib/data/comite";
import type { ComponentProps } from "react";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { carregarDetalheDoJob } from "@/app/(app)/jobs/[jobId]/carregar-detalhe";
import type { JobRealizadoSection } from "@/app/(app)/jobs/[jobId]/realizado/job-realizado-section";

/** As props da planilha, menos as que o pop-up decide no navegador. */
export type PlanilhaEmLeitura = Omit<
  ComponentProps<typeof JobRealizadoSection>,
  "destacarItens" | "linhasDaRevisao" | "resultadoInicial"
>;

export type ResultadoDaPlanilha =
  | { ok: true; props: PlanilhaEmLeitura }
  | { ok: false; message: string };

const ERRO = "Não foi possível carregar a planilha. Tente de novo.";

export async function lerPlanilhaEmLeitura(jobId: string): Promise<ResultadoDaPlanilha> {
  const id = z.string().uuid().safeParse(jobId);
  if (!id.success) return { ok: false, message: ERRO };

  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    return { ok: false, message: "Sem permissão para ver a planilha deste job." };
  }

  const detalhe = await carregarDetalheDoJob(session, id.data).catch((e: Error) => {
    console.error("[abertura-job.planilha-em-leitura]", e.message);
    return null;
  });
  if (!detalhe) return { ok: false, message: ERRO };

  const { versaoAprovada, podeExportarInterna, job } = detalhe;

  // As mesmas props da aba Planilha Interna da página do job no financeiro,
  // em leitura: sem "Editar orçado", errata, PP, BV ou histórico — o pop-up
  // é para conferir. No job mensal (e na Mídia Off) a régua troca de mês no
  // próprio pop-up (`mesNoLugar`), a partir do Trimestre (ou da Campanha):
  // navegar sairia da abertura e levaria o que já foi preenchido.
  return {
    ok: true,
    props: {
      papelEnviaPP: false,
      comiteDaPP: COMITE_DA_PP_SEM_ACAO,
      emDecisaoPP: null,
      // A planilha da conferência só lê: sem marca da Mídia System.
      midiaSystem: null,
      papelCorrigeNf: false,
      confirmarSaidaParaOrcamento: true,
      edicaoDoFinanceiro: null,
      aberturaDoJob: null,
      papelNaErrata: null,
      errataPronta: null,
      midia: detalhe.midia,
      comHistorico: false,
      interno: detalhe.interno,
      savePorItem: detalhe.savePorItem,
      saldosDeSave: [],
      clienteNome: detalhe.clienteNome,
      job: {
        id: job.id,
        codigo: job.codigo,
        nome: job.nome,
        status: job.status,
        projeto_id: job.projeto_id,
        orcamento_id: job.orcamento_id,
        versao_orcamento_aprovada_id: job.versao_orcamento_aprovada_id,
        empresa_id: job.empresa_id,
        responsavel_id: job.responsavel_id,
      },
      nomeJob: job.nome,
      versao: {
        id: versaoAprovada.id,
        numero_versao: versaoAprovada.numero_versao,
        moeda: versaoAprovada.moeda,
        percentual_honorarios: Number(versaoAprovada.percentual_honorarios),
        percentual_imposto: Number(versaoAprovada.percentual_imposto),
        percentual_int_taxes: Number(versaoAprovada.percentual_int_taxes ?? 0),
        int_transaction_costs: Number(versaoAprovada.int_transaction_costs ?? 0),
        moeda_estrangeira: versaoAprovada.moeda_estrangeira ?? null,
        cambio_compra:
          versaoAprovada.cambio_compra === null || versaoAprovada.cambio_compra === undefined
            ? null
            : Number(versaoAprovada.cambio_compra),
      },
      modeloPlanilha: detalhe.modeloPlanilha,
      meses: detalhe.meses,
      faturamentoMensal: detalhe.faturamentoMensal,
      mesPedido: undefined,
      hrefPlanilha: undefined,
      mesNoLugar: true,
      grupos: detalhe.grupos,
      itens: detalhe.itens,
      realizadosMap: detalhe.realizadosMap,
      categoriasMap: detalhe.categoriasMap,
      podeAcoes: false,
      podeMexerNoSave: false,
      podeExportarInterna,
      podeConfirmarBv: false,
      ppsPorItemId: detalhe.ppsPorItemId,
      aEmitirPorItemId: detalhe.aEmitirPorItemId,
      tomadoresDaNf: detalhe.tomadoresDaNf,
      tomadorPorEmpresa: detalhe.tomadorPorEmpresa,
      cnpjPadraoDaPP: detalhe.cnpjPadraoDaPP,
      fornecedores: detalhe.fornecedores,
      empresas: detalhe.empresas,
      responsaveis: detalhe.responsaveis,
      bvsPorItem: detalhe.bvsPorItem,
    },
  };
}
