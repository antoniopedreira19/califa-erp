/**
 * O `alvo` das duas baixas reais, para a aba Títulos da conciliação abrir a
 * MESMA baixa que as listas abrem (02/10/2026).
 *
 * CÓPIA FIEL da montagem de `titulos-pagar-list.tsx` (alvoBaixa,
 * motivoSemParcialDa, faltaPagar) e de `titulos-list.tsx` (alvoBaixa,
 * faltaReceber). As listas ainda montam o delas: quando passarem a importar
 * daqui, a cópia some. Até lá, mudou uma, mude a outra.
 */

import type { BaixaTituloAlvo } from "@/components/financeiro/baixa-titulo-dialog";
import type { UltimaRetencao } from "@/components/financeiro/valor-da-baixa";
import type { BaixaRecebimentoAlvo } from "../contas-a-receber/baixa-recebimento-dialog";
import type { TituloRow as TituloAPagar } from "../contas-a-pagar/titulos-pagar-list";
import type { TituloRow as TituloAReceber } from "../contas-a-receber/titulos-list";

type TituloRow = TituloAPagar;

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

// ---------------------------------------------------------------------------
// A pagar
// ---------------------------------------------------------------------------

/** O que falta pagar (decisão 125): o valor menos as baixas (líquido +
 *  retidos). */
export function faltaPagar(r: TituloRow): number {
  return Math.max(0, Math.round((r.valor - r.baixado) * 100) / 100);
}

/** Por que a origem só aceita a baixa do valor inteiro (decisão 125).
 *  `null`: aceita a parcial. */
function motivoSemParcialDa(r: TituloRow): string | null {
  switch (r.origem) {
    case "desembolso":
      return "Desembolso só aceita a baixa do valor inteiro.";
    case "fatura_cartao":
      return "Fatura de cartão só aceita a baixa do valor inteiro.";
    case "pp_devolucao_verba":
      return "Devolução de verba só aceita a baixa do valor inteiro.";
    case "folha":
      return "Folha só aceita a baixa do valor inteiro.";
  }
  if (r.eh_verba) return "PP de verba só aceita a baixa do valor inteiro.";
  if (r.em_remessa) return "Pago pela remessa com o valor cheio: só a baixa do que falta.";
  return null;
}

/** O `alvo` do `BaixaTituloDialog` para um título a pagar. */
export function alvoDaBaixaAPagar(
  baixando: TituloAPagar,
  ultimasRetencoes: Record<string, UltimaRetencao>,
): BaixaTituloAlvo {
  return {
    titulo: baixando.descricao,
    origem:
      baixando.origem === "pp"
        ? `Pedido de produção ${baixando.origem_label}`
        : baixando.origem === "recorrencia"
          ? `Recorrência · ${baixando.descricao}`
          : baixando.origem === "desembolso"
            ? `Desembolso ${baixando.origem_label}`
            : baixando.origem === "pp_devolucao_verba"
              ? `Estorno de verba ${baixando.origem_label.replace(/^ESTORNO /, "")}`
              : baixando.origem === "fatura_cartao"
                ? `Fatura de cartão ${baixando.origem_label}`
                : baixando.origem === "folha"
                  ? "Folha de pagamento"
                  : "Lançamento avulso",
    parcela: `${baixando.parcela_numero}/${baixando.parcela_total}`,
    vencimento: baixando.data_pagamento,
    chave: `${baixando.origem}-${baixando.id}-${baixando.baixas.length}`,
    valor: baixando.valor,
    aberto: faltaPagar(baixando),
    restoTexto: baixando.data_pagamento
      ? `, na data de ${formatDate(baixando.data_pagamento)}, que dá para repactuar pelo lápis.`
      : null,
    motivoSemParcial: motivoSemParcialDa(baixando),
    // Retenção só no serviço de fornecedor (decisão 125): PP que não é
    // de verba, avulso e recorrência. O que foi para uma remessa saiu
    // com o valor cheio (interino da D15).
    retencao:
      (baixando.origem === "pp" && !baixando.eh_verba) ||
      baixando.origem === "avulso" ||
      baixando.origem === "recorrencia"
        ? {
            mostra: true,
            motivo: baixando.em_remessa ? "Pago pela remessa com o valor cheio." : null,
          }
        : { mostra: false },
    ultimaRetencao: baixando.parte_id ? ultimasRetencoes[baixando.parte_id] ?? null : null,
    empresaId: baixando.empresa_id,
    planoContaTipoId: baixando.plano_conta_tipo_id,
    planoContaSubtipoId: baixando.plano_conta_subtipo_id,
    foraDoCadastro: baixando.fora_do_cadastro,
    isDevolucao: baixando.origem === "pp_devolucao_verba",
    // Fatura não se paga com cartão, folha também não (Tiago,
    // 01/10/2026; o banco recusa), e o restante de uma parcial não vai
    // para a fatura.
    semCartao:
      baixando.origem === "fatura_cartao" ||
      baixando.origem === "folha" ||
      baixando.baixas.length > 0,
  };
}

// ---------------------------------------------------------------------------
// A receber
// ---------------------------------------------------------------------------

/** Com baixa e ainda faltando mais de meio centavo. */
export function faltaReceber(r: TituloAReceber): number {
  return Math.max(0, Math.round((r.valor - r.baixado) * 100) / 100);
}

/** O `alvo` do `BaixaRecebimentoDialog` para um título a receber (nota,
 *  recebimento avulso ou rendimento). `hoje` é a data sugerida. */
export function alvoDaBaixaAReceber(
  baixando: TituloAReceber,
  ultimasRetencoes: Record<string, UltimaRetencao>,
  hoje: string,
): BaixaRecebimentoAlvo {
  return baixando.origem === "nf"
    ? {
        chave: baixando.id,
        resumo: [
          { rotulo: "Nota fiscal", valor: `NF ${baixando.fat_numero_nf}`, estilo: "mono_negrito" },
          { rotulo: "Cliente", valor: baixando.contraparte_nome, estilo: "negrito" },
          { rotulo: "Jobs cobertos", valor: baixando.jobs_cobertos.join("  ·  "), estilo: "mono_pequeno" },
          { rotulo: "Parcela", valor: `${baixando.numero_parcela}/${baixando.total_parcelas}`, estilo: "mono" },
          { rotulo: "Vencimento", valor: formatDate(baixando.data_vencimento), estilo: "mono" },
          { rotulo: "Previsão de recebimento", valor: formatDate(baixando.data_previsao_recebimento), estilo: "mono" },
        ],
        valor: baixando.valor,
        aberto: faltaReceber(baixando),
        parcelaRotulo: `Parcela ${baixando.numero_parcela}/${baixando.total_parcelas}`,
        restoTexto: `, com a previsão de ${formatDate(baixando.data_previsao_recebimento)}, que dá para repactuar pelo lápis.`,
        aceitaParcial: true,
        aceitaRetencao: true,
        ultimaRetencao: baixando.parte_id ? ultimasRetencoes[baixando.parte_id] ?? null : null,
        empresaId: baixando.empresa_id,
        contaTravadaId: null,
        tipoInicialId: null,
        subtipoInicialId: null,
        centroTravado: false,
        dataInicial: hoje,
      }
    : {
        chave: baixando.id,
        resumo: [
          {
            rotulo: baixando.origem === "rendimento" ? "Rendimento" : "Recebimento avulso",
            valor: baixando.codigo_avulsa ?? "—",
            estilo: "mono_negrito",
          },
          { rotulo: "Descrição", valor: baixando.fat_descricao, estilo: "negrito" },
          {
            rotulo: baixando.origem === "rendimento" ? "Conta de aplicação" : "Recebido de",
            valor: baixando.contraparte_nome,
            estilo: "negrito",
          },
          { rotulo: "Data prevista", valor: formatDate(baixando.data_previsao_recebimento), estilo: "mono" },
        ],
        valor: baixando.valor,
        aberto: faltaReceber(baixando),
        parcelaRotulo:
          baixando.origem === "rendimento" ? "Rendimento líquido do mês" : "Valor do recebimento",
        restoTexto: null,
        // Rendimento só pelo valor inteiro, sem retenção (decisão 125).
        aceitaParcial: baixando.origem !== "rendimento",
        aceitaRetencao: baixando.origem !== "rendimento",
        ultimaRetencao: baixando.parte_id ? ultimasRetencoes[baixando.parte_id] ?? null : null,
        empresaId: baixando.empresa_id,
        contaTravadaId: baixando.origem === "rendimento" ? baixando.conta_prevista_id : null,
        tipoInicialId: baixando.plano_conta_tipo_id,
        subtipoInicialId: baixando.plano_conta_subtipo_id,
        centroTravado: baixando.origem === "rendimento",
        dataInicial: baixando.origem === "rendimento" ? baixando.data_previsao_recebimento : hoje,
      };
}
