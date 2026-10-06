"use client";

/**
 * Aba "Títulos a Receber" (Tela 3.3) — espelho da aba Títulos a Pagar.
 *
 * Três datas convivem em cada linha, e confundi-las é o erro fácil:
 *
 * - **Vencimento** — o que a nota diz. IMUTÁVEL; o banco reverte qualquer
 *   tentativa de alterá-lo (trigger `congela_previsao_recebimento_primeira`).
 * - **Previsão de recebimento** — quando o financeiro espera receber.
 *   Repactuável pelo lápis; destacada em âmbar quando difere do
 *   vencimento. É ela que o fluxo de caixa lê.
 * - **Data de recebimento** — quando o dinheiro entrou. Só existe depois
 *   da baixa, e não existe baixa sem ela.
 *
 * A aba dá baixa e, desde 31/08/2026, deixa CONFERIR a baixa já feita —
 * o botão de olho da linha recebida abre o `BaixaRegistradaDialog`, o
 * mesmo de Títulos a Pagar. Desde 29/09/2026 (decisão 120) ele tem as
 * duas ações: estornar (transação nova, receita negativa) e cancelar a
 * baixa (o lançamento sai do extrato e o título volta a Em aberto).
 * Cancelamento de NF continua sem porta aqui (decisão 016 §9).
 *
 * Decisão 125 (29/09/2026): o título aceita baixa parcial e impostos
 * retidos. Com baixa e ainda faltando, ele fica **Parcial** (azul, e com
 * filtro próprio) — acima de Inadimplente, porque o cliente já começou a
 * pagar. A linha parcial tem o "Dar baixa" do restante e o olho, que lista
 * as baixas uma a uma.
 *
 * A coluna Ação da linha recebida é SÓ o olho (08/09/2026). O bloco
 * "Conciliação · conta · centro" que morava ali comia largura de tabela
 * para repetir, em letra miúda, o que o modal já mostra inteiro.
 *
 * INADIMPLÊNCIA (31/08/2026): a pastilha vermelha e o "N dias de atraso"
 * saem de `data_vencimento < hoje`, e NÃO da coluna `inadimplente_desde`.
 * A coluna é o registro que sobrevive ao pagamento, para o relatório; a
 * tela não depende dela, então uma rotina que falhe não deixa a aba
 * mentindo.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Banknote, CheckCheck, Eye, Layers, Pencil, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  BotaoInfo,
  InfoFaturamentoModal,
  type InfoFaturamento,
} from "@/components/financeiro/info-faturamento-modal";
import {
  BaixaRegistradaDialog,
  type BaixaDoTitulo,
  type BaixaRegistradaAlvo,
} from "@/components/financeiro/baixa-registrada-dialog";
import type { UltimaRetencao } from "@/components/financeiro/valor-da-baixa";
import { totalRetido } from "@/lib/data/baixas-do-documento";
import {
  cancelarBaixa,
  estornarValorDaBaixa,
} from "../actions-baixa-registrada";
import type { ContatoCobranca } from "@/lib/data/contatos-cobranca";
import type { InfoJob } from "./faturar-drawer";
import type {
  ContaBancaria,
  PlanoContaTipo,
  PlanoContaSubtipo,
  TipoEntradaAvulsa,
  TituloReceberStatus,
} from "@/lib/types";
import {
  BaixaRecebimentoDialog,
  type BaixaRecebimentoAlvo,
} from "./baixa-recebimento-dialog";
import {
  EditarPrevisaoDialog,
  type EditarPrevisaoAlvo,
} from "./editar-previsao-dialog";
import {
  darBaixaTitulo,
  repactuarPrevisaoRecebimento,
} from "./actions";
import {
  darBaixaRecebimentoAvulso,
  darBaixaTransferencia,
  excluirTituloReceberAvulso,
} from "./actions-recebimento-avulso";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TransferirDialog, type TransferirAlvo } from "./transferir-dialog";
import {
  RecebimentoAvulsoDialog,
  type RendimentoLancado,
} from "./recebimento-avulso-dialog";
import {
  BaixaEmLoteDialog,
  BarraDeSelecao,
  CaixaDaLinha,
  CaixaDoCabecalho,
  elegivelDoLote,
  useSelecao,
  type TituloParaLote,
} from "@/components/financeiro/baixa-em-lote";

export interface TituloRow {
  id: string;
  numero_parcela: number;
  total_parcelas: number;
  valor: number;
  data_vencimento: string;
  data_previsao_recebimento: string;
  data_previsao_recebimento_primeira: string;
  status: TituloReceberStatus;
  pago_em: string | null;
  empresa_id: string;
  faturamento_id: string;
  fat_numero_nf: string;
  fat_data_emissao: string;
  fat_descricao: string;
  /** "California · Salvador · 19.437.976/0001-54": o CNPJ que emitiu a nota
   *  (módulo fiscal, 02/10/2026). Nulo nas notas de antes e fora de nota. */
  fat_cnpj_emissor: string | null;
  contraparte_nome: string;
  /** Rótulos dos jobs DISTINTOS que a nota cobre, sem repetição. A nota com
   *  save e a com dois faturamentos parciais têm mais de um item do mesmo
   *  job, e listá-lo duas vezes lia como erro (31/08/2026). */
  jobs_cobertos: string[];
  /** Os mesmos jobs, com id — o botão `i` mostra a PO de cada um. */
  jobs: Array<{ job_id: string; codigo: string }>;
  /** Dia em que passou do vencimento sem ser recebido. Registro histórico:
   *  sobrevive à baixa. A pastilha da tela NÃO depende dele. */
  inadimplente_desde: string | null;
  /**
   * As baixas vivas, da mais antiga para a mais nova (decisão 125: pode
   * haver várias). Cada uma traz conta, centro de custo, impostos retidos e
   * os estornos dela (decisão 120). Nada disso aparece na linha
   * (08/09/2026): só o olho, que abre as baixas registradas. Obrigatório:
   * título sem baixa manda `[]`.
   */
  baixas: BaixaDoTitulo[];
  /** O que as baixas quitaram: líquido + retidos. Falta = valor − baixado. */
  baixado: number;
  /** Quem paga (cliente, ou o fornecedor da nota de BV): a chave do
   *  "Repetir as alíquotas". `null` na transferência. */
  parte_id: string | null;
  /**
   * De onde o título vem (decisão 124): a nota fiscal, ou uma conta avulsa
   * de natureza entrada — recebimento avulso ou rendimento —, ou uma
   * transferência entre contas (`transferencias_contas`). Os campos `fat_*`
   * ficam vazios nesses: eles não têm nota.
   */
  origem: "nf" | TipoEntradaAvulsa | "transferencia";
  /** A conta avulsa por trás do recebimento avulso e do rendimento.
   *  `null` na nota. */
  conta_avulsa_id: string | null;
  /** "AV-00012" ou "TR-00003": vai na coluna Nota fiscal de quem não tem
   *  nota. */
  codigo_avulsa: string | null;
  /** O centro de custo gravado no título avulso: a baixa já vem com ele. */
  plano_conta_tipo_id: string | null;
  plano_conta_subtipo_id: string | null;
  /** Rendimento: a conta de aplicação, travada na baixa. */
  conta_prevista_id: string | null;
}

interface Props {
  rows: TituloRow[];
  contas: ContaBancaria[];
  tipos: PlanoContaTipo[];
  subtipos: PlanoContaSubtipo[];
  /** O que o diálogo "Recebimento avulso" oferece (decisão 124). */
  empresas: Array<{ id: string; nome: string }>;
  regionais: Array<{ id: string; nome: string; ativo: boolean; empresa_id: string }>;
  clientes: Array<{ id: string; nome: string }>;
  fornecedores: Array<{ id: string; nome: string }>;
  rendimentosLancados: RendimentoLancado[];
  /** A última retenção de cada cliente (por `parte_id`), para o "Repetir
   *  as alíquotas" da baixa. */
  ultimasRetencoes: Record<string, UltimaRetencao>;
  /** PO, instrução do GP e contatos, por job — o conteúdo do botão `i`. */
  infoPorJob: Record<string, InfoJob>;
}

/** Hoje em ISO local. `toISOString` volta em UTC e erra o dia à noite. */
function hojeIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/** Dias corridos entre o vencimento e hoje. Só faz sentido em atraso. */
function diasDeAtraso(vencimento: string): number {
  const [y, m, d] = vencimento.slice(0, 10).split("-").map(Number);
  const venc = new Date(y, m - 1, d);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((hoje.getTime() - venc.getTime()) / 86400000));
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function formatMoney(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Com baixa e ainda faltando mais de meio centavo. */
function faltaReceber(r: TituloRow): number {
  return Math.max(0, Math.round((r.valor - r.baixado) * 100) / 100);
}

function ehParcial(r: TituloRow): boolean {
  return r.status === "em_aberto" && r.baixas.length > 0 && faltaReceber(r) > 0.004;
}

// ---------------------------------------------------------------------------
// Baixa em lote (pedido do Tiago, 02/10/2026)
// ---------------------------------------------------------------------------

/** A chave do título na seleção e no lote — única entre as origens. */
function chaveDoLote(r: TituloRow): string {
  return `receber|${r.origem}|${r.id}`;
}

/**
 * Por que a caixa da baixa em lote fica desligada; `null` entra. Entram a
 * nota fiscal e o recebimento avulso em aberto — inadimplente e parcial
 * também, pelo que falta receber (decisão aprovada pelo Tiago em
 * 02/10/2026). O rendimento (conta de aplicação travada) e a
 * transferência entre contas têm baixa própria.
 */
function motivoForaDoLote(r: TituloRow): string | null {
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
function paraOLote(r: TituloRow): TituloParaLote | null {
  if (r.origem === "nf") {
    return {
      chave: chaveDoLote(r),
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
      chave: chaveDoLote(r),
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

/** NF agrupada junta os contatos de todos os jobs — sem repetir o mesmo. */
function dedupContatos(lista: ContatoCobranca[]): ContatoCobranca[] {
  const vistos = new Set<string>();
  return lista.filter((c) => {
    const chave = `${c.nome?.trim() ?? ""}|${c.email?.trim().toLowerCase() ?? ""}`;
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
}

export function TitulosList({
  rows,
  contas,
  tipos,
  subtipos,
  empresas,
  regionais,
  clientes,
  fornecedores,
  rendimentosLancados,
  ultimasRetencoes,
  infoPorJob,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [baixando, setBaixando] = React.useState<TituloRow | null>(null);
  const [conferindo, setConferindo] = React.useState<TituloRow | null>(null);
  const [editando, setEditando] = React.useState<TituloRow | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);
  const [info, setInfo] = React.useState<InfoFaturamento | null>(null);
  const [novoAberto, setNovoAberto] = React.useState(false);
  const [transferindo, setTransferindo] = React.useState<TituloRow | null>(null);
  /** Título em aberto criado por engano (decisão 124 §5): só os que não
   *  vêm de nota. */
  const [excluindo, setExcluindo] = React.useState<TituloRow | null>(null);

  /** Em aberto abre a baixa; a transferência a transferir só confirma a
   *  data (as contas e o valor são do título). */
  function abrirBaixa(r: TituloRow) {
    setErro(null);
    if (r.origem === "transferencia") setTransferindo(r);
    else setBaixando(r);
  }
  /**
   * "Criar e dar baixa" (decisão 124): o título acabou de nascer e ainda
   * não está em `rows` — a baixa abre quando o `router.refresh()` o
   * trouxer, como no lançamento avulso de Títulos a Pagar.
   */
  const [baixarAposCriar, setBaixarAposCriar] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!baixarAposCriar) return;
    const novo = rows.find((r) => r.conta_avulsa_id === baixarAposCriar);
    if (!novo) return;
    setBaixarAposCriar(null);
    setErro(null);
    setBaixando(novo);
  }, [rows, baixarAposCriar]);
  const [filtroStatus, setFiltroStatus] = React.useState<
    "todos" | "abertos" | "inadimplentes" | "parciais" | "recebidos"
  >("todos");

  const hoje = hojeIso();

  /**
   * Inadimplente é o título que passou do VENCIMENTO sem ser recebido
   * (Tiago, 31/08/2026). Não da previsão: a previsão anda — ela é
   * repactuada à mão ou rolada de semana em semana pela rotina diária —, e
   * o vencimento é o que a nota diz e nunca muda.
   */
  // Só a nota fica inadimplente: o recebimento avulso e o rendimento não
  // são cobrança de cliente, e passam da data como "Em aberto". A parcial
  // também não: o cliente já começou a pagar (decisão 125).
  const estaInadimplente = React.useCallback(
    (r: TituloRow) =>
      r.origem === "nf" &&
      r.status !== "pago" &&
      r.status !== "cancelado" &&
      !ehParcial(r) &&
      r.data_vencimento < hoje,
    [hoje],
  );

  const chips = React.useMemo(
    () => [
      { chave: "todos" as const, rotulo: "Todos", n: rows.length },
      {
        chave: "abertos" as const,
        rotulo: "Em aberto",
        n: rows.filter(
          (r) => r.status === "em_aberto" && !estaInadimplente(r) && !ehParcial(r),
        ).length,
      },
      {
        chave: "inadimplentes" as const,
        rotulo: "Inadimplentes",
        n: rows.filter(estaInadimplente).length,
      },
      {
        chave: "parciais" as const,
        rotulo: "Parciais",
        n: rows.filter(ehParcial).length,
      },
      {
        chave: "recebidos" as const,
        rotulo: "Recebidos",
        n: rows.filter((r) => r.status === "pago").length,
      },
    ],
    [rows, estaInadimplente],
  );

  const visiveis = React.useMemo(
    () =>
      rows.filter((r) => {
        if (filtroStatus === "abertos") {
          return r.status === "em_aberto" && !estaInadimplente(r) && !ehParcial(r);
        }
        if (filtroStatus === "inadimplentes") return estaInadimplente(r);
        if (filtroStatus === "parciais") return ehParcial(r);
        if (filtroStatus === "recebidos") return r.status === "pago";
        return true;
      }),
    [rows, filtroStatus, estaInadimplente],
  );

  // Baixa em lote (pedido do Tiago, 02/10/2026). A caixa do cabeçalho marca
  // só os visíveis (o filtro de status vale), e quem sai da lista sai da
  // seleção. Uma origem por lote (revisão da decisão 140, 05/10/2026).
  const elegiveis = visiveis.flatMap((r) => {
    const t = motivoForaDoLote(r) === null ? paraOLote(r) : null;
    return t ? [elegivelDoLote(t)] : [];
  });
  const selecao = useSelecao(elegiveis);
  const [loteAberto, setLoteAberto] = React.useState(false);
  const selecionados = visiveis
    .filter((r) => selecao.marcado(chaveDoLote(r)))
    .map(paraOLote)
    .filter((t): t is TituloParaLote => t !== null);

  /** O conteúdo do botão `i` de um título. */
  function infoDoTitulo(r: TituloRow): InfoFaturamento {
    return {
      referencia: `NF ${r.fat_numero_nf} · parcela ${r.numero_parcela}/${r.total_parcelas} · ${r.contraparte_nome}`,
      pos: r.jobs.map((j) => ({
        job: j.codigo,
        po: infoPorJob[j.job_id]?.po ?? null,
      })),
      // Nota já emitida: vale a descrição que saiu NELA, e não mais a
      // instrução que o GP mandou no envio.
      descricaoNf: r.fat_descricao,
      // Os anexos da PO que vieram no envio (decisão 123).
      anexosPo: r.jobs.flatMap((j) => infoPorJob[j.job_id]?.anexos ?? []),
      contatos: dedupContatos(
        r.jobs.flatMap((j) => infoPorJob[j.job_id]?.contatos ?? []),
      ),
    };
  }

  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const alvoBaixa: BaixaRecebimentoAlvo | null = baixando
    ? baixando.origem === "nf"
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
          // Módulo fiscal: a nota do título, para o bloco "No fiscal" da baixa.
          notaId: baixando.faturamento_id,
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
          // Sem nota: a baixa não tem o bloco "No fiscal".
          notaId: null,
        }
    : null;

  const alvoConferencia: BaixaRegistradaAlvo | null = conferindo
    ? {
        titulo:
          conferindo.origem === "nf"
            ? `NF ${conferindo.fat_numero_nf} — ${conferindo.fat_descricao}`
            : `${conferindo.codigo_avulsa ?? ""} — ${conferindo.fat_descricao}`,
        origem:
          conferindo.origem === "nf"
            ? conferindo.jobs_cobertos.join(" · ") || conferindo.contraparte_nome
            : conferindo.origem === "rendimento"
              ? `Rendimento de aplicação · ${conferindo.contraparte_nome}`
              : conferindo.origem === "transferencia"
                ? `Transferência entre contas · ${conferindo.contraparte_nome}`
                : conferindo.contraparte_nome === "—"
                  ? "Recebimento avulso"
                  : `Recebimento avulso · ${conferindo.contraparte_nome}`,
        parcela: `${conferindo.numero_parcela}/${conferindo.total_parcelas}`,
        valor: conferindo.valor,
        vencOriginal: conferindo.data_vencimento,
        baixas: conferindo.baixas,
        // Recebimento nunca é no cartão, nem pagamento de fatura.
        viaCartao: false,
        ehFaturaDeCartao: false,
        ehTransferencia: conferindo.origem === "transferencia",
        // Rendimento não tem estorno (D16): errou, cancela.
        semEstorno:
          conferindo.origem === "rendimento"
            ? "Rendimento de aplicação não tem estorno. Se foi lançado errado, cancele a baixa."
            : conferindo.origem === "transferencia"
              ? "Transferência entre contas não tem estorno. Se foi lançada errado, cancele a baixa."
              : null,
      }
    : null;

  const alvoTransferencia: TransferirAlvo | null = transferindo
    ? {
        id: transferindo.id,
        codigo: transferindo.codigo_avulsa ?? "—",
        contas: transferindo.contraparte_nome,
        descricao: transferindo.fat_descricao === "Transferência entre contas" ? null : transferindo.fat_descricao,
        valor: transferindo.valor,
        dataPrevista: transferindo.data_previsao_recebimento,
      }
    : null;

  const alvoEdicao: EditarPrevisaoAlvo | null = editando
    ? {
        numeroNf: editando.fat_numero_nf,
        parcela: `${editando.numero_parcela}/${editando.total_parcelas}`,
        cliente: editando.contraparte_nome,
        vencimento: editando.data_vencimento,
        primeiraPrevisao: editando.data_previsao_recebimento_primeira,
        previsaoAtual: editando.data_previsao_recebimento,
      }
    : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap gap-1.5">
        {chips.map((c) => (
          <button
            key={c.chave}
            type="button"
            onClick={() => setFiltroStatus(c.chave)}
            className={cn(
              "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              filtroStatus === c.chave
                ? "border-california-red bg-california-red/10 text-california-red"
                : "border-border bg-white text-muted-foreground hover:bg-muted/50",
            )}
          >
            {c.rotulo}
            <span
              className={cn(
                "font-semibold tabular-nums",
                filtroStatus === c.chave
                  ? "text-california-red"
                  : "text-muted-foreground/70",
              )}
            >
              {c.n}
            </span>
          </button>
        ))}
      </div>
        <button
          type="button"
          onClick={() => {
            setErro(null);
            setNovoAberto(true);
          }}
          className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-california-red-hover"
        >
          <Plus className="h-4 w-4" />
          Recebimento avulso
        </button>
      </div>

      {/* A caixa reserva 46px à direita para a calha, e o botão `i` mora numa
          célula de largura ZERO — a calha nunca alarga a tabela
          (`app/(app)/_planilha/calha.tsx`). */}
      <div className="overflow-x-auto pb-1.5">
      <div className="mr-[46px] box-border w-max min-w-[calc(100%-46px)] rounded-2xl border border-border bg-card shadow-soft">
        <table className="w-full min-w-[1400px] text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              {/* A seleção da baixa em lote (02/10/2026), com a caixa da
                  remessa CNAB. A do cabeçalho marca os visíveis que aceitam
                  baixa — da origem já marcada. */}
              <th className="w-10 px-3 py-3 text-center">
                <CaixaDoCabecalho {...selecao.cabecalho} />
              </th>
              <th className="w-[150px] px-3.5 py-3 font-semibold">Vencimento</th>
              <th className="w-[150px] px-3.5 py-3 font-semibold">
                Previsão de recebimento
              </th>
              <th className="w-[130px] px-4 py-3 font-semibold">Nota fiscal</th>
              <th className="min-w-[140px] px-4 py-3 font-semibold">Cliente</th>
              <th className="min-w-[250px] px-4 py-3 font-semibold">Jobs cobertos</th>
              <th className="w-[130px] px-3.5 py-3 font-semibold">
                Data de recebimento
              </th>
              <th className="px-4 py-3 text-right font-semibold">Valor</th>
              <th className="w-[72px] px-3 py-3 font-semibold">Parcela</th>
              <th className="w-[96px] px-3.5 py-3 font-semibold">Status</th>
              <th className="w-[110px] px-4 py-3 text-right font-semibold">Ação</th>
              <th className="w-0 p-0" />
            </tr>
          </thead>
          <tbody>
            {visiveis.length === 0 && (
              <tr>
                <td
                  colSpan={12}
                  className="px-4 py-12 text-center text-sm text-muted-foreground"
                >
                  {rows.length === 0
                    ? "Nenhum título a receber ainda. Emita uma NF na aba Faturamento."
                    : "Nenhum título com esse status."}
                </td>
              </tr>
            )}
            {visiveis.map((r) => {
              const recebido = r.status === "pago";
              const cancelado = r.status === "cancelado";
              const parcial = ehParcial(r);
              const ultimaBaixa = r.baixas[r.baixas.length - 1] ?? null;
              const retido = totalRetido(r.baixas);
              const estornado =
                r.baixas
                  .flatMap((b) => b.estornos)
                  .reduce((acc, e) => acc + Math.round(e.valor * 100), 0) / 100;
              const adiada = r.data_previsao_recebimento !== r.data_vencimento;
              const inadimplente = estaInadimplente(r);
              const agrupada = r.jobs_cobertos.length > 1;
              // Baixa em lote: entra ou não, e por quê.
              const chaveLote = chaveDoLote(r);
              const motivoLote = motivoForaDoLote(r) ?? selecao.foraDaOrigem(chaveLote);
              return (
                <tr
                  key={r.id}
                  onClick={() => {
                    if (cancelado) return;
                    setErro(null);
                    // Recebido ou parcial abre as baixas registradas; em
                    // aberto abre o formulário de baixa.
                    if (recebido || parcial) setConferindo(r);
                    else abrirBaixa(r);
                  }}
                  className={cn(
                    "border-b border-border transition-colors last:border-0 hover:bg-accent/40",
                    !cancelado && "cursor-pointer",
                  )}
                >
                  {/* A caixa da baixa em lote. A linha continua abrindo a
                      baixa (ou as baixas registradas); a seleção é só pela
                      caixa, e o clique na célula dela não abre nada. */}
                  <td
                    className="px-3 py-3 text-center"
                    title={motivoLote ?? undefined}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <CaixaDaLinha
                      marcado={selecao.marcado(chaveLote)}
                      onAlternar={() => selecao.alternar(chaveLote)}
                      disponivel={motivoLote === null}
                      motivo={motivoLote ?? undefined}
                    />
                  </td>
                  <td className="px-3.5 py-3">
                    <div className="flex items-center gap-2">
                      {!recebido && !cancelado && r.origem === "nf" && (
                        <button
                          type="button"
                          title="Editar previsão de recebimento"
                          onClick={(e) => {
                            e.stopPropagation();
                            setErro(null);
                            setEditando(r);
                          }}
                          className="inline-flex h-[26px] w-[26px] flex-none items-center justify-center rounded-md border border-border bg-white text-muted-foreground transition-colors hover:border-california-red hover:text-california-red"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                      )}
                      <span className="whitespace-nowrap font-mono text-xs">
                        {formatDate(r.data_vencimento)}
                      </span>
                    </div>
                  </td>
                  <td className="px-3.5 py-3">
                    <span
                      className={cn(
                        "whitespace-nowrap font-mono text-xs",
                        adiada ? "font-bold text-amber-800" : "font-medium",
                      )}
                    >
                      {formatDate(r.data_previsao_recebimento)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {r.origem === "nf" ? (
                      <div className="flex flex-col gap-0.5">
                        <span className="font-mono text-xs font-bold text-california-red">
                          NF {r.fat_numero_nf}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          Emitida {formatDate(r.fat_data_emissao)}
                        </span>
                      </div>
                    ) : (
                      // Sem nota (decisão 124): o código AV e o tipo.
                      <div className="flex flex-col gap-0.5">
                        <span className="font-mono text-xs font-bold text-foreground">
                          {r.codigo_avulsa ?? "—"}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {r.origem === "rendimento"
                            ? "Rendimento"
                            : r.origem === "transferencia"
                              ? "Transferência"
                              : "Recebimento avulso"}
                        </span>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[13px]">{r.contraparte_nome}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      {agrupada && (
                        <span className="inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-700">
                          <Layers className="h-3 w-3" />
                          Agrupada · {r.jobs_cobertos.length} jobs
                        </span>
                      )}
                      {/* Só os jobs, sem repetição. O contato de cobrança
                          mudou para o botão `i` em 31/08/2026. */}
                      <span className="font-mono text-[11.5px] text-muted-foreground text-pretty">
                        {r.jobs_cobertos.join("  ·  ")}
                      </span>
                    </div>
                  </td>
                  <td className="px-3.5 py-3">
                    {(recebido || parcial) && ultimaBaixa ? (
                      <div className="flex flex-col gap-0.5">
                        <span
                          className={cn(
                            "whitespace-nowrap font-mono text-xs font-bold",
                            recebido ? "text-emerald-700" : "text-sky-700",
                          )}
                        >
                          {formatDate(recebido ? r.pago_em ?? ultimaBaixa.data : ultimaBaixa.data)}
                        </span>
                        {r.baixas.length > 1 && (
                          <span className="text-[10.5px] text-muted-foreground">
                            {r.baixas.length} baixas
                          </span>
                        )}
                      </div>
                    ) : (
                      <span
                        className={cn(
                          "whitespace-nowrap font-mono text-xs",
                          recebido ? "font-bold text-emerald-700" : "text-muted-foreground/50",
                        )}
                      >
                        {recebido ? formatDate(r.pago_em) : "—"}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums">
                    <div className="flex flex-col items-end gap-0.5">
                      <span>{formatMoney(r.valor)}</span>
                      {parcial && (
                        <span className="text-[10.5px] font-medium text-sky-700">
                          recebido {formatMoney(r.baixado)} · falta{" "}
                          <b className="font-semibold">{formatMoney(faltaReceber(r))}</b>
                        </span>
                      )}
                      {retido > 0 && (
                        <span className="text-[10.5px] font-medium text-muted-foreground">
                          {formatMoney(retido)} retidos
                        </span>
                      )}
                      {estornado > 0 && (
                        <span className="text-[10.5px] font-medium text-rose-700">
                          estornado {formatMoney(estornado)}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-3 font-mono text-xs text-muted-foreground">
                    {r.numero_parcela}/{r.total_parcelas}
                  </td>
                  <td className="px-3.5 py-3">
                    <div className="flex flex-col items-start gap-0.5">
                      <span
                        className={cn(
                          "inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                          cancelado
                            ? "border-border bg-muted text-muted-foreground"
                            : recebido
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : parcial
                                ? "border-sky-200 bg-sky-50 text-sky-700"
                                : inadimplente
                                ? "border-[#fecaca] bg-[#fef2f2] text-[#b3323c]"
                                : "border-[#fde68a] bg-[#fffbeb] text-[#92400e]",
                        )}
                      >
                        {cancelado
                          ? "Cancelado"
                          : recebido
                            ? r.origem === "transferencia"
                              ? "Transferida"
                              : "Recebido"
                            : parcial
                              ? "Parcial"
                              : inadimplente
                              ? "Inadimplente"
                              : r.origem === "transferencia"
                                ? "A transferir"
                                : "Em aberto"}
                      </span>
                      {inadimplente && (
                        <span className="whitespace-nowrap text-[10.5px] font-bold text-[#b3323c]">
                          {diasDeAtraso(r.data_vencimento)}{" "}
                          {diasDeAtraso(r.data_vencimento) === 1
                            ? "dia de atraso"
                            : "dias de atraso"}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {!recebido && !cancelado && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            abrirBaixa(r);
                          }}
                          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-emerald-700 px-2.5 py-1.5 text-[11.5px] font-semibold text-white transition-colors hover:bg-emerald-800"
                        >
                          <Banknote className="h-3.5 w-3.5" />
                          Dar baixa
                        </button>
                      )}
                      {(recebido || parcial) && (
                        // Simetria com Títulos a Pagar (31/08/2026): a linha
                        // com baixa abre as baixas registradas, e é lá dentro
                        // que moram o estorno e o cancelamento, em dois
                        // tempos. Conta e centro de custo saíram daqui em
                        // 08/09/2026 — ocupavam meia tabela para repetir o
                        // que o olho já mostra.
                        <button
                          type="button"
                          title="Ver as baixas registradas — estornar ou cancelar, se preciso"
                          aria-label="Ver as baixas registradas"
                          onClick={(e) => {
                            e.stopPropagation();
                            setErro(null);
                            setConferindo(r);
                          }}
                          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:border-california-red hover:text-california-red"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="relative w-0 p-0">
                    {/* Na calha: o ⓘ da nota, ou a lixeira do título em
                        aberto que não vem de nota — nunca os dois, e a
                        tabela não alarga. */}
                    {r.origem !== "nf" && !recebido && !cancelado && r.baixas.length === 0 && (
                      <button
                        type="button"
                        title="Excluir este título (criado por engano)"
                        aria-label="Excluir título"
                        onClick={(e) => {
                          e.stopPropagation();
                          setErro(null);
                          setExcluindo(r);
                        }}
                        className="absolute left-3 top-1/2 inline-flex h-[30px] w-[30px] -translate-y-1/2 items-center justify-center rounded-full border border-border bg-white text-muted-foreground shadow-sm transition-colors hover:border-california-red hover:text-california-red"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {r.origem === "nf" && (
                    <BotaoInfo
                      className="absolute left-3 top-1/2 h-[30px] w-[30px] -translate-y-1/2 shadow-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setInfo(infoDoTitulo(r));
                      }}
                    />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </div>

      {/* Baixa em lote: a barra da seleção, logo abaixo da tabela (ela gruda
          no pé da tela enquanto a lista rola), e o diálogo — a data e a
          conta uma vez, uma baixa por título. */}
      <BarraDeSelecao
        itens={selecionados}
        onLimpar={selecao.limpar}
        onBaixar={() => setLoteAberto(true)}
      />
      <BaixaEmLoteDialog
        open={loteAberto}
        onOpenChange={setLoteAberto}
        itens={selecionados}
        contas={contas}
        tipos={tipos}
        subtipos={subtipos}
        onConcluido={(mensagem) => {
          selecao.limpar();
          setToast(mensagem);
        }}
      />

      <BaixaRecebimentoDialog
        open={baixando !== null}
        onOpenChange={(o) => {
          if (!o) {
            setBaixando(null);
            setErro(null);
          }
        }}
        alvo={alvoBaixa}
        contas={contas}
        tipos={tipos}
        subtipos={subtipos}
        pending={pending}
        erro={erro}
        onConfirm={(payload) => {
          const alvo = baixando;
          if (!alvo) return;
          startTransition(async () => {
            const res =
              alvo.origem === "nf"
                ? await darBaixaTitulo({ titulo_id: alvo.id, ...payload })
                : await darBaixaRecebimentoAvulso({
                    conta_avulsa_id: alvo.conta_avulsa_id,
                    ...payload,
                  });
            if (!res.ok) {
              setErro(res.message);
              return;
            }
            setBaixando(null);
            setErro(null);
            const retidoNaBaixa =
              payload.retencoes.reduce((acc, r) => acc + Math.round(r.valor * 100), 0) / 100;
            const liquido = Math.round((payload.valor_baixa - retidoNaBaixa) * 100) / 100;
            const resta = Math.round((faltaReceber(alvo) - payload.valor_baixa) * 100) / 100;
            setToast(
              `Baixa registrada · ${formatMoney(liquido)} enviado para a conciliação.` +
                (retidoNaBaixa > 0 ? ` ${formatMoney(retidoNaBaixa)} de impostos retidos.` : "") +
                (resta > 0.004 ? ` Faltam ${formatMoney(resta)}.` : ""),
            );
            router.refresh();
          });
        }}
      />

      <EditarPrevisaoDialog
        open={editando !== null}
        onOpenChange={(o) => {
          if (!o) {
            setEditando(null);
            setErro(null);
          }
        }}
        alvo={alvoEdicao}
        pending={pending}
        erro={erro}
        onSalvar={(novaData) => {
          const alvo = editando;
          if (!alvo) return;
          startTransition(async () => {
            const res = await repactuarPrevisaoRecebimento({
              titulo_id: alvo.id,
              data_previsao_recebimento: novaData,
            });
            if (!res.ok) {
              setErro(res.message);
              return;
            }
            setEditando(null);
            setErro(null);
            setToast(`Previsão de recebimento atualizada para ${formatDate(novaData)}.`);
            router.refresh();
          });
        }}
      />

      <BaixaRegistradaDialog
        open={conferindo !== null}
        onOpenChange={(o) => {
          if (!o) {
            setConferindo(null);
            setErro(null);
          }
        }}
        alvo={alvoConferencia}
        contas={contas
          .filter((c) => c.ativo)
          .map((c) => ({ id: c.id, nome: c.nome, banco: c.banco }))}
        pending={pending}
        erro={erro}
        sentido="receber"
        onDarBaixaNoRestante={() => {
          const alvo = conferindo;
          if (!alvo) return;
          setConferindo(null);
          setErro(null);
          setBaixando(alvo);
        }}
        onCancelar={(baixa, motivo) => {
          const alvo = conferindo;
          if (!alvo) return;
          startTransition(async () => {
            // A transferência não tem um lançamento só: cancela pelo
            // título. As outras cancelam aquela baixa (decisão 125).
            const res =
              alvo.origem === "transferencia" || !baixa.lancamentoId
                ? await cancelarBaixa({ tipo: "transferencia", id: alvo.id, motivo })
                : await cancelarBaixa({ tipo: "baixa", id: baixa.lancamentoId, motivo });
            if (!res.ok) {
              setErro(res.message);
              return;
            }
            setConferindo(null);
            setErro(null);
            const referencia =
              alvo.origem === "nf"
                ? `NF ${alvo.fat_numero_nf} ${alvo.numero_parcela}/${alvo.total_parcelas}`
                : (alvo.codigo_avulsa ?? "o título");
            setToast(
              alvo.origem === "transferencia"
                ? `Transferência cancelada · ${alvo.codigo_avulsa ?? ""} voltou para A transferir, e as duas linhas saíram do extrato.`
                : `Baixa cancelada · ${referencia} voltou para ${alvo.baixas.length > 1 ? "Parcial" : "Em aberto"} e ${formatMoney(baixa.movimentado)} saíram do extrato.`,
            );
            router.refresh();
          });
        }}
        onEstornar={(baixa, dados) => {
          if (!baixa.lancamentoId) return;
          const lancamentoId = baixa.lancamentoId;
          startTransition(async () => {
            const res = await estornarValorDaBaixa({
              lancamento_id: lancamentoId,
              data: dados.data,
              conta_bancaria_id: dados.contaBancariaId,
              valor: dados.valor,
              motivo: dados.motivo,
            });
            if (!res.ok) {
              setErro(res.message);
              return;
            }
            setConferindo(null);
            setErro(null);
            setToast(
              `Estorno registrado · ${formatMoney(dados.valor)} saiu da conta em ${formatDate(dados.data)}. A baixa continua como está.`,
            );
            router.refresh();
          });
        }}
      />

      <ConfirmDialog
        open={excluindo !== null}
        onOpenChange={(o) => {
          if (!o) {
            setExcluindo(null);
            setErro(null);
          }
        }}
        title={
          excluindo?.origem === "transferencia"
            ? `Excluir a transferência ${excluindo.codigo_avulsa ?? ""}?`
            : `Excluir o título ${excluindo?.codigo_avulsa ?? ""}?`
        }
        description={
          excluindo ? (
            <>
              {excluindo.fat_descricao} · {formatMoney(excluindo.valor)}. O título sai de
              Títulos a Receber. Como ainda está em aberto, nada sai do extrato. Fica no
              log de auditoria quem excluiu e quando.
              {erro && <span className="mt-2 block font-medium text-california-red">{erro}</span>}
            </>
          ) : null
        }
        confirmLabel="Excluir"
        variant="destructive"
        pending={pending}
        onConfirm={() => {
          const alvo = excluindo;
          if (!alvo || alvo.origem === "nf") return;
          startTransition(async () => {
            const res = await excluirTituloReceberAvulso({
              origem: alvo.origem,
              id: alvo.origem === "transferencia" ? alvo.id : alvo.conta_avulsa_id,
            });
            if (!res.ok) {
              setErro(res.message);
              return;
            }
            setExcluindo(null);
            setErro(null);
            setToast(`${alvo.codigo_avulsa ?? "O título"} excluído de Títulos a Receber.`);
            router.refresh();
          });
        }}
      />

      <TransferirDialog
        open={transferindo !== null}
        onOpenChange={(o) => {
          if (!o) {
            setTransferindo(null);
            setErro(null);
          }
        }}
        alvo={alvoTransferencia}
        pending={pending}
        erro={erro}
        onConfirmar={(data) => {
          const alvo = transferindo;
          if (!alvo) return;
          startTransition(async () => {
            const res = await darBaixaTransferencia({ transferencia_id: alvo.id, data });
            if (!res.ok) {
              setErro(res.message);
              return;
            }
            setTransferindo(null);
            setErro(null);
            setToast(
              `Transferência registrada · ${formatMoney(alvo.valor)} em ${formatDate(data)}, com as duas linhas no extrato.`,
            );
            router.refresh();
          });
        }}
      />

      <RecebimentoAvulsoDialog
        open={novoAberto}
        onOpenChange={setNovoAberto}
        empresas={empresas}
        regionais={regionais}
        clientes={clientes}
        fornecedores={fornecedores}
        tipos={tipos}
        subtipos={subtipos}
        contas={contas}
        rendimentosLancados={rendimentosLancados}
        onCriado={(id, abrirBaixaEmSeguida, mensagem) => {
          setNovoAberto(false);
          setFiltroStatus("todos");
          if (abrirBaixaEmSeguida) setBaixarAposCriar(id);
          else setToast(mensagem);
          router.refresh();
        }}
      />

      <InfoFaturamentoModal
        info={info}
        onOpenChange={(aberto) => {
          if (!aberto) setInfo(null);
        }}
      />

      {toast && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-elevated"
        >
          <CheckCheck className="h-4 w-4 shrink-0 text-emerald-700" />
          <span className="text-sm font-semibold text-emerald-900">{toast}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="text-emerald-700 hover:text-emerald-900"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
