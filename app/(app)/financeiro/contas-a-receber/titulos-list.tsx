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
import { CheckCheck, Eye, Info, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  InfoFaturamentoModal,
  type InfoFaturamento,
} from "@/components/financeiro/info-faturamento-modal";
import {
  BaixaRegistradaDialog,
  type BaixaDoTitulo,
  type BaixaRegistradaAlvo,
} from "@/components/financeiro/baixa-registrada-dialog";
import type { UltimaRetencao } from "@/components/financeiro/valor-da-baixa";
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
import { BarraDosFiltrosDeColuna, useFiltrosDeColuna } from "@/components/ui/filtro-de-coluna";
import { PlanilhaDeTitulos } from "@/components/financeiro/planilha-de-titulos/planilha";
import { colunasFiltraveis } from "@/components/financeiro/planilha-de-titulos/colunas";
import { BotaoDetalhes, type AcaoDoDetalhe } from "@/components/financeiro/detalhes-do-titulo/botao-detalhes";
import type { ExtrasDaPlanilha } from "@/lib/data/planilha-de-titulos";
import { ordenarLinhas } from "@/lib/financeiro/planilha-de-titulos";
import { linhaAReceber, prepararContexto, type Linha } from "../conciliacao/linhas-da-aba";

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
  /** O dia de hoje em Brasília (decisão 195). */
  hoje: string;
  /** Empresa → nome curto, para a coluna Empresa. */
  nomesDasEmpresas: Record<string, string>;
  /** Regional e centro de custo da nota (decisão 195). */
  extras: ExtrasDaPlanilha;
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
      // O recebimento nunca vai para o cartão (decisão 197).
      semCartao: "Recebimento não entra na fatura do cartão.",
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
      // O recebimento nunca vai para o cartão (decisão 197).
      semCartao: "Recebimento não entra na fatura do cartão.",
      // O recebimento avulso nasce com o centro de custo (decisão 124).
      centroDeCusto:
        r.plano_conta_tipo_id && r.plano_conta_subtipo_id
          ? { tipoId: r.plano_conta_tipo_id, subtipoId: r.plano_conta_subtipo_id }
          : null,
    };
  }
  return null;
}

/** O título a receber por trás da linha da planilha (a lista só monta
 *  linhas a receber e transferências). */
function tituloDe(l: Linha): TituloRow {
  return l.t as TituloRow;
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
  hoje,
  nomesDasEmpresas,
  extras,
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

  /** Os títulos que passam no filtro de CIMA (os chips de status). Os
   *  filtros dos títulos das colunas vêm depois, sobre esta lista. */
  const doTopo = React.useMemo(
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
  // Desde a decisão 195 a lista é a planilha de títulos: as linhas saem do
  // título pela mesma montagem da conciliação (`linhaAReceber`).
  const contexto = React.useMemo(
    () =>
      prepararContexto({
        hoje,
        empresas: nomesDasEmpresas,
        tipos,
        subtipos,
        cartoes: [],
        contas,
        centroDoImposto: {},
        extras,
      }),
    [hoje, nomesDasEmpresas, tipos, subtipos, contas, extras],
  );
  // Na ordem da data prevista, a da coluna (a lista vinha pelo vencimento).
  const linhasDoTopo = React.useMemo(
    () => ordenarLinhas(doTopo.map((r) => linhaAReceber(r, contexto))),
    [doTopo, contexto],
  );
  const colunasDoFiltro = React.useMemo(
    () => colunasFiltraveis({ contaId: null, hoje, rotuloContraparte: "Cliente", status: true }),
    [hoje],
  );
  const colunas = useFiltrosDeColuna<Linha>(linhasDoTopo, colunasDoFiltro, { guardarEm: "contas-a-receber-planilha" });
  /** Os títulos que passam em tudo, na ordem do título escolhido (sem
   *  nenhum, a de sempre: pelo vencimento). A seleção do lote sai daqui. */
  const visiveis = React.useMemo(() => colunas.visiveis.map(tituloDe), [colunas.visiveis]);

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

      {/* Quantos títulos os filtros dos títulos das colunas deixaram (o mesmo
          aviso da aba PPs): o filtro mora escondido no título. */}
      {colunas.ativo && (
        <BarraDosFiltrosDeColuna
          visiveis={colunas.visiveis.length}
          total={colunas.total}
          singular="título"
          plural="títulos"
          onLimpar={colunas.limpar}
        />
      )}

      <PlanilhaDeTitulos<Linha>
        linhas={colunas.visiveis}
        contaId={null}
        hoje={hoje}
        colunaStatus
        titulo={(chave) => colunas.titulo(chave)}
        cabecalhoDaSelecao={<CaixaDoCabecalho {...selecao.cabecalho} />}
        caixa={(l) => {
          const chaveLote = chaveDoLote(tituloDe(l));
          const motivoLote = motivoForaDoLote(tituloDe(l)) ?? selecao.foraDaOrigem(chaveLote);
          return (
            <span title={motivoLote ?? undefined}>
              <CaixaDaLinha
                marcado={selecao.marcado(chaveLote)}
                onAlternar={() => selecao.alternar(chaveLote)}
                disponivel={motivoLote === null}
                motivo={motivoLote ?? undefined}
              />
            </span>
          );
        }}
        onBaixar={(l) => abrirBaixa(tituloDe(l))}
        onEditarData={(l) => {
          setErro(null);
          setEditando(tituloDe(l));
        }}
        onVerBaixas={(l) => {
          setErro(null);
          setConferindo(tituloDe(l));
        }}
        detalhes={(l) => {
          const r = tituloDe(l);
          // As ações que moravam soltas na linha (decisão 195): o `i` da nota,
          // o olho do parcial e a lixeira do título criado por engano.
          const acoes: AcaoDoDetalhe[] = [];
          if (r.origem === "nf") {
            acoes.push({ rotulo: "Informações de faturamento e cobrança", icone: Info, onClick: () => setInfo(infoDoTitulo(r)) });
          }
          if (ehParcial(r)) {
            acoes.push({
              rotulo: "Ver as baixas",
              icone: Eye,
              onClick: () => {
                setErro(null);
                setConferindo(r);
              },
            });
          }
          if (r.origem !== "nf" && r.status === "em_aberto" && r.baixas.length === 0) {
            acoes.push({
              rotulo: r.origem === "transferencia" ? "Excluir a transferência" : "Excluir este título",
              icone: Trash2,
              perigo: true,
              onClick: () => {
                setErro(null);
                setExcluindo(r);
              },
            });
          }
          return (
            <BotaoDetalhes
              chave={l.chave}
              titulo={l.descricao}
              recebimento={l.entra}
              job={l.job}
              vencimentoDiferente={l.vencimento && l.vencimento !== l.dataPrevista ? l.vencimento : null}
              retencoes={l.valor.retencoes}
              rateio={l.rateio}
              acoes={acoes}
            />
          );
        }}
        vazio={
          rows.length === 0
            ? "Nenhum título a receber ainda. Emita uma NF na aba Faturamento."
            : doTopo.length === 0
              ? "Nenhum título com esse status."
              : "Nenhum título com esse filtro."
        }
      />

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
        // Recebimento não vai para o cartão (decisão 197).
        cartoes={[]}
        faturas={[]}
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
