/**
 * O `alvo` das duas baixas reais, para a aba Títulos da conciliação abrir a
 * MESMA baixa que as listas abrem (02/10/2026).
 *
 * CÓPIA FIEL da montagem de `titulos-pagar-list.tsx` (alvoBaixa,
 * motivoSemParcialDa, faltaPagar) e de `titulos-list.tsx` (alvoBaixa,
 * faltaReceber). As listas ainda montam o delas: quando passarem a importar
 * daqui, a cópia some. Até lá, mudou uma, mude a outra.
 *
 * O mesmo vale para a baixa em lote: quem entra no lote, por que não, e o
 * título no formato do lote são cópias de `chaveDoLote`, `motivoForaDoLote`
 * e `paraOLote` das duas listas.
 */

import type { BaixaTituloAlvo } from "@/components/financeiro/baixa-titulo-dialog";
import type { TituloParaLote } from "@/components/financeiro/baixa-em-lote";
import {
  ORIGENS_PAGAR_NO_LOTE,
  type OrigemPagarNoLote,
} from "@/lib/financeiro/baixa-em-lote";
import type { OrigemTitulo } from "@/lib/types";
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

// ---------------------------------------------------------------------------
// Baixa em lote — a pagar (cópia de `titulos-pagar-list.tsx`)
// ---------------------------------------------------------------------------

function origemNoLote(o: OrigemTitulo): o is OrigemPagarNoLote {
  return (ORIGENS_PAGAR_NO_LOTE as readonly string[]).includes(o);
}

/** A chave do título na seleção e no lote — única entre as origens. */
export function chaveDoLoteAPagar(r: TituloAPagar): string {
  return `pagar|${r.origem}|${r.id}`;
}

/**
 * Por que o título não entra na baixa em lote; `null` entra. O lote paga
 * pela conta escolhida, uma baixa por título, sempre pelo que falta (a
 * parcial entra pelo restante). Entram PP, avulso e recorrência em
 * aberto (decisão aprovada pelo Tiago em 02/10/2026); folha, fatura de
 * cartão e devolução de verba têm baixa própria, o previsto no cartão vira
 * item da fatura na baixa (decisão 093), e o desembolso tem o centro de
 * custo escolhido na baixa — todos um de cada vez.
 */
export function motivoForaDoLoteAPagar(r: TituloAPagar): string | null {
  if (r.status === "pago") return "Título já pago.";
  switch (r.origem) {
    case "folha":
      return "Folha tem baixa própria: dê baixa nela sozinha.";
    case "fatura_cartao":
      return "Fatura de cartão tem baixa própria: dê baixa nela sozinha.";
    case "pp_devolucao_verba":
      return "Devolução de verba tem baixa própria: dê baixa nela sozinha.";
    case "desembolso":
      return "Desembolso: dê baixa nele sozinho, para escolher o centro de custo.";
  }
  if (!origemNoLote(r.origem)) return "Este título não entra na baixa em lote: dê baixa nele sozinho.";
  if (r.forma_pagamento === "cartao_credito" || r.forma_prevista === "cartao_credito") {
    return "Previsto no cartão de crédito: dê baixa nele sozinho, para o item entrar na fatura.";
  }
  // Decisão 137: para onde vai o dinheiro aparece só na baixa do título.
  if (r.fora_do_cadastro) {
    return "Pagamento fora do cadastro: dê baixa nele sozinho, para ver para onde vai o dinheiro.";
  }
  if (faltaPagar(r) <= 0.004) return "Título sem valor em aberto.";
  return null;
}

/** O título no formato do lote. `null` na origem que não entra nele. */
export function paraOLoteAPagar(r: TituloAPagar): TituloParaLote | null {
  if (!origemNoLote(r.origem)) return null;
  return {
    chave: chaveDoLoteAPagar(r),
    tipo: "pagar",
    alvo: { modulo: "pagar", origem: r.origem, id: r.id },
    titulo: r.descricao,
    referencia:
      r.parcela_total > 1
        ? `${r.origem_label} · ${r.parcela_numero}/${r.parcela_total}`
        : r.origem_label,
    contraparte: r.fornecedor_nome || "—",
    vencimento: r.data_pagamento,
    aberto: faltaPagar(r),
    // Avulso e recorrência já têm o par; a PP tem só o tipo (decisão 068)
    // e usa o subtipo do lote.
    centroDeCusto:
      r.plano_conta_tipo_id && r.plano_conta_subtipo_id
        ? { tipoId: r.plano_conta_tipo_id, subtipoId: r.plano_conta_subtipo_id }
        : null,
  };
}

// ---------------------------------------------------------------------------
// Baixa em lote — a receber (cópia de `titulos-list.tsx`)
// ---------------------------------------------------------------------------

/** A chave do título na seleção e no lote — única entre as origens. */
export function chaveDoLoteAReceber(r: TituloAReceber): string {
  return `receber|${r.origem}|${r.id}`;
}

/**
 * Por que a caixa da baixa em lote fica desligada; `null` entra. Entram a
 * nota fiscal e o recebimento avulso em aberto — inadimplente e parcial
 * também, pelo que falta receber (decisão aprovada pelo Tiago em
 * 02/10/2026). O rendimento (conta de aplicação travada) e a
 * transferência entre contas têm baixa própria.
 */
export function motivoForaDoLoteAReceber(r: TituloAReceber): string | null {
  if (r.status === "cancelado") return "Título cancelado: não há baixa a dar.";
  if (r.status === "pago") {
    return r.origem === "transferencia" ? "Transferência já feita." : "Título já recebido.";
  }
  if (r.origem === "rendimento") return "Rendimento tem baixa própria: dê baixa nele sozinho.";
  if (r.origem === "transferencia") {
    return "Transferência tem baixa própria: dê baixa nela sozinha.";
  }
  if (r.origem === "recebimento_avulso" && !r.conta_avulsa_id) {
    return "Este título não entra na baixa em lote: dê baixa nele sozinho.";
  }
  if (faltaReceber(r) <= 0.004) return "Título sem valor em aberto.";
  return null;
}

/** O título no formato do lote. `null` na origem que não entra nele. */
export function paraOLoteAReceber(r: TituloAReceber): TituloParaLote | null {
  if (r.origem === "nf") {
    return {
      chave: chaveDoLoteAReceber(r),
      tipo: "receber",
      alvo: { modulo: "receber", origem: "nf", id: r.id },
      titulo: `NF ${r.fat_numero_nf}${r.total_parcelas > 1 ? ` · parcela ${r.numero_parcela}/${r.total_parcelas}` : ""}`,
      referencia: `NF ${r.fat_numero_nf}`,
      contraparte: r.contraparte_nome,
      vencimento: r.data_vencimento,
      aberto: faltaReceber(r),
      // A nota não tem centro de custo: usa o do lote.
      centroDeCusto: null,
    };
  }
  if (r.origem === "recebimento_avulso" && r.conta_avulsa_id) {
    return {
      chave: chaveDoLoteAReceber(r),
      tipo: "receber",
      alvo: { modulo: "receber", origem: "recebimento_avulso", id: r.conta_avulsa_id },
      titulo: r.fat_descricao,
      referencia: r.codigo_avulsa ?? "Recebimento avulso",
      contraparte: r.contraparte_nome,
      vencimento: r.data_vencimento,
      aberto: faltaReceber(r),
      // O recebimento avulso nasce com o centro de custo (decisão 124).
      centroDeCusto:
        r.plano_conta_tipo_id && r.plano_conta_subtipo_id
          ? { tipoId: r.plano_conta_tipo_id, subtipoId: r.plano_conta_subtipo_id }
          : null,
    };
  }
  return null;
}
