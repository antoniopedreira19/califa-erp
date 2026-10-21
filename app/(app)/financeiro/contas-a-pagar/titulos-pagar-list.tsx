"use client";

/**
 * Aba "Títulos a Pagar" (Tela 3.2) — a visão única de tudo que é pagável.
 *
 * O que entra aqui vem de duas tabelas, unificado no server component:
 * parcela de PP aprovada, lançamento avulso e ocorrência de recorrência.
 * O que a aba FAZ é uma coisa só: dar baixa e repactuar data. Aprovar e
 * rejeitar PP continua na aba de Pedidos de Produção — é a regra que o
 * protótipo escreve no rodapé e que o aviso ao pé da tabela repete.
 *
 * A linha PAGA não repete mais a baixa (08/09/2026). O subtítulo "Pago em
 * X · conta · centro de custo" que ficava sob a descrição saiu: o olho da
 * linha abre o `BaixaRegistradaDialog` com tudo aquilo, e lá o centro de
 * custo e o subtipo ocupam linhas próprias. Mesmo movimento feito na aba
 * Cartão e em Contas a Receber, no mesmo dia.
 *
 * Desde 29/09/2026 (decisão 120) o popup do olho tem duas ações: estornar
 * (transação nova, despesa negativa, o título continua pago) e cancelar a
 * baixa (o lançamento sai do extrato e o título volta para A pagar). A
 * linha com estorno mostra "estornado R$ X" sob o valor.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import {
  CalendarClock,
  CheckCheck,
  Eye,
  Info,
  Plus,
  Search,
  Undo2,
  Wallet,
} from "lucide-react";
import { DevolverFolhaDialog } from "./devolver-folha-dialog";
import { verbaAguardaProducao } from "@/lib/types";
import { cn } from "@/lib/utils";
import { DatePicker } from "@/components/ui/date-picker";
import type {
  ContaBancaria,
  FormaPagamento,
  OrigemTitulo,
  PlanoContaTipo,
  PlanoContaSubtipo,
  TituloPagarStatus,
  SituacaoVerba,
} from "@/lib/types";
import type { CartaoOption } from "@/components/financeiro/forma-pagamento-field";
import type { UltimaRetencao } from "@/components/financeiro/valor-da-baixa";
import { ContaAvulsaDrawer } from "./conta-avulsa-drawer";
import {
  BaixaTituloDialog,
  type BaixaTituloAlvo,
} from "@/components/financeiro/baixa-titulo-dialog";
import { lerCompetencia, rotuloCurto } from "@/lib/cartoes/competencia";
import {
  BaixaRegistradaDialog,
  type BaixaDoTitulo,
  type BaixaRegistradaAlvo,
  type EstornoDaBaixa,
} from "@/components/financeiro/baixa-registrada-dialog";
import {
  cancelarBaixa,
  estornarValorDaBaixa,
} from "../actions-baixa-registrada";
import {
  EditarDataPagamentoDialog,
  type EditarDataAlvo,
} from "./editar-data-pagamento-dialog";
import {
  darBaixaTitulo,
  repactuarDataPagamento,
} from "./actions-titulos";
import {
  BaixaEmLoteDialog,
  BarraDeSelecao,
  CaixaDaLinha,
  CaixaDoCabecalho,
  elegivelDoLote,
  useSelecao,
  type TituloParaLote,
} from "@/components/financeiro/baixa-em-lote";
import {
  ORIGENS_PAGAR_NO_LOTE,
  type OrigemPagarNoLote,
} from "@/lib/financeiro/baixa-em-lote";
import { BarraDosFiltrosDeColuna, useFiltrosDeColuna } from "@/components/ui/filtro-de-coluna";
import { PlanilhaDeTitulos } from "@/components/financeiro/planilha-de-titulos/planilha";
import { colunasFiltraveis } from "@/components/financeiro/planilha-de-titulos/colunas";
import { BotaoDetalhes, type AcaoDoDetalhe } from "@/components/financeiro/detalhes-do-titulo/botao-detalhes";
import type { ExtrasDaPlanilha } from "@/lib/data/planilha-de-titulos";
import { linhaAPagar, prepararContexto, type Linha } from "../conciliacao/linhas-da-aba";

// ---------------------------------------------------------------------------
// Tipo da linha
// ---------------------------------------------------------------------------

export interface TituloRow {
  /** Id da parcela (origem `pp`) ou da conta avulsa (demais origens). */
  id: string;
  origem: OrigemTitulo;
  /** `PP-00005`, `AVULSO` ou `RECORRÊNCIA` — o chip da coluna Origem. */
  origem_label: string;
  descricao: string;
  fornecedor_nome: string;
  /**
   * Decisão 067: o cadastro do fornecedor mudou depois que a PP tirou a
   * foto. Só origem `pp` pode acender — as outras quatro não têm foto e
   * mandam `false` explícito.
   *
   * **Obrigatório de propósito.** Como opcional, um produtor que
   * esquecesse de preencher devolveria `undefined` em silêncio, com `tsc`
   * limpo — e `undefined && …` simplesmente não pinta nada. O asterisco
   * sumiria sem ninguém perceber, que é exatamente o alçapão que este
   * campo já quase caiu uma vez (o `.map` não dispara a checagem de
   * propriedade extra do TypeScript).
   */
  cadastro_do_fornecedor_mudou: boolean;
  job_codigo: string;
  /**
   * Nome do job, ao lado do código, como na aba de PPs (16/09/2026).
   * Obrigatório pelo mesmo motivo do campo acima: origem sem job (avulsa,
   * recorrência, desembolso, fatura) manda `""` explícito.
   */
  job_nome: string;
  /** Data vigente de pagamento — o que a tela ordena e soma. */
  data_pagamento: string | null;
  /** Prazo negociado pela produção (PP) ou informado na criação (avulsa). */
  venc_original: string | null;
  data_pagamento_primeira: string | null;
  valor: number;
  parcela_numero: number;
  parcela_total: number;
  status: TituloPagarStatus;
  empresa_id: string;
  plano_conta_tipo_id: string | null;
  plano_conta_subtipo_id: string | null;
  pago_em: string | null;
  /** Conta, centro de custo (tipo) e subtipo da baixa. NÃO aparecem mais
   *  na linha (08/09/2026): só o olho, que abre a baixa registrada. */
  conta_nome: string | null;
  centro_nome: string | null;
  subtipo_nome: string | null;
  /**
   * O lançamento da baixa viva e a conta dele (decisão 120): o estorno se
   * pendura no primeiro e sugere a segunda. Nulos no título a pagar e na
   * fatura de cartão, que tem duas pernas e não tem estorno.
   */
  baixa_lancamento_id: string | null;
  baixa_conta_id: string | null;
  /** Estornos registrados sobre a baixa viva. Obrigatório: quem não tem
   *  manda `[]` explícito. */
  estornos_da_baixa: EstornoDaBaixa[];
  /**
   * Decisão 125: todas as baixas vivas do documento, da mais antiga para a
   * mais nova — parcela de PP e avulsa podem ter várias (baixa parcial),
   * cada uma com os impostos retidos dela. Os campos de uma baixa só, logo
   * acima, são os da ÚLTIMA. Obrigatório: sem baixa, `[]`.
   */
  baixas: BaixaDoTitulo[];
  /** O que as baixas quitaram: líquido + retidos. Falta = valor − baixado. */
  baixado: number;
  /** Já foi para uma remessa CNAB: só a baixa do que falta (o banco pagou
   *  o documento inteiro). */
  em_remessa: boolean;
  /** A remessa pagou o líquido, descontando a retenção da aprovação da PP
   *  (decisão 145): a baixa repete essa retenção. Falso na remessa que pagou
   *  o valor cheio, que segue sem retenção. */
  em_remessa_com_retencao: boolean;
  /** PP de verba de produção: só o valor inteiro, sem retenção (P3). */
  eh_verba: boolean;
  /** O fornecedor — chave do "Repetir as alíquotas". `null` sem fornecedor. */
  parte_id: string | null;
  /**
   * Forma de pagamento da conta avulsa ou recorrência.
   * Parcelas de PP ficam null (PP não tem forma_pagamento ainda).
   * Task 10 consome esses campos para separar cartões da aba comum.
   */
  forma_pagamento: FormaPagamento | null;
  /** Cartão de crédito associado. Null para PP ou formas sem cartão. */
  cartao_credito_id: string | null;
  /**
   * Intenção registrada na aprovação da PP ou no cadastro da avulsa
   * (decisão 093). Serve para PRÉ-PREENCHER a baixa, e só: não decide em
   * que aba a linha aparece — isso é `forma_pagamento`, que é a forma
   * REALIZADA (ou "cartão" quando a linha já está numa fatura). Sem isto
   * a PP aprovada "no cartão" chegava na baixa pedindo a forma de novo.
   */
  forma_prevista: FormaPagamento | null;
  cartao_previsto_id: string | null;
  /**
   * A fatura a que a linha pertence, quando pertence a alguma: item
   * confirmado na baixa, ou legado roteado antes da 093 que entra no
   * fechamento. É por ela que a aba Cartão liga a linha do extrato da
   * fatura às ações (estornar compra, ver a baixa). Obrigatório: origem
   * sem fatura manda `null`.
   */
  fatura_cartao_id: string | null;
  /**
   * Preenchido quando ESTA linha é um estorno — o id da compra que ela
   * desfaz. A aba Cartão mostra a linha como crédito e a subtrai da
   * fatura (29/08/2026).
   */
  /**
   * Onde a verba de produção está depois de paga (decisão 081) — só no
   * título de PP de verba; toda outra linha manda `null`. É o que alimenta
   * o status próprio e o filtro "Aguardando prestação".
   */
  verba_situacao: SituacaoVerba | null;
  /**
   * A PP de origem é urgente (decisão 077, pergunta 4a): a urgência não
   * termina na aprovação — o título sobe para o topo dos "a pagar" com a
   * mesma justificativa. Só PP tem urgência; toda outra origem manda
   * `false` e `null`. Obrigatório, pelo mesmo motivo do asterisco acima.
   */
  urgente: boolean;
  urgente_justificativa: string | null;
  /**
   * Decisão 137: a PP de origem paga por outra chave ou conta, e quem
   * pediu. Aparece só na baixa — a lista não muda (Tiago, 01/10/2026). Só
   * PP tem; toda outra origem manda `null` explícito.
   */
  fora_do_cadastro: BaixaTituloAlvo["foraDoCadastro"];
  /**
   * Módulo fiscal (decisão 139): o número da NF do fornecedor, que o
   * financeiro registrou na aprovação da PP. Decisão 152: as notas vêm do
   * cadastro `notas_fiscais_fornecedor`, e a PP com mais de uma mostra
   * todas ("602, 603"). A linha mostra "NF 602" embaixo do título, e o
   * lote e a aba Títulos da conciliação levam na referência ("PP-00110 ·
   * NF 602"). Null na PP sem NF registrada; toda outra origem manda `null`
   * explícito. Obrigatório pelo mesmo motivo do asterisco acima.
   */
  nf_numero: string | null;
  estorno_de_avulsa_id: string | null;
  /**
   * A COMPRA a que esta linha pertence — ela mesma, se for compra à vista
   * ou a primeira parcela; a cabeça, se for parcela do meio.
   *
   * É neste id que o estorno se prende: compra em 3x estornada por
   * inteiro é UM estorno do valor cheio, apontando para a cabeça
   * (29/08/2026). Fora do cartão, é o próprio id.
   */
  compra_id: string;
  /** Total da compra: a soma das parcelas dela. Uma parcela sozinha não
   *  é o teto do estorno. */
  compra_total: number;
  /**
   * Quanto desta COMPRA já foi estornado. Serve para a aba Cartão saber
   * se ainda cabe estorno e qual o teto. Sempre 0 fora do cartão.
   */
  estornado: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Por que a baixa desta linha não aceita estorno (decisão 120). O estorno
 * é dinheiro que volta para uma conta bancária: a fatura de cartão não tem
 * (cancelar é o caminho), e o item pago no cartão já tem o "Estornar
 * compra", na fatura.
 */
function motivoSemEstorno(r: TituloRow): string | null {
  if (r.origem === "fatura_cartao") {
    return "Pagamento de fatura não tem estorno. Se foi lançado errado, cancele a baixa.";
  }
  if (r.forma_pagamento === "cartao_credito") {
    return "Pago no cartão: para devolver, use Estornar compra, na fatura do cartão.";
  }
  return null;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function formatMoney(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Data de hoje em ISO local — não usar `toISOString`, que volta em UTC. */
function hojeISO(): string {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}

function somaDiasISO(iso: string, dias: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const base = new Date(y, m - 1, d + dias);
  const mes = String(base.getMonth() + 1).padStart(2, "0");
  const dia = String(base.getDate()).padStart(2, "0");
  return `${base.getFullYear()}-${mes}-${dia}`;
}

const CHIP_ORIGEM: Array<{ key: "todas" | OrigemTitulo; label: string }> = [
  { key: "todas", label: "Todas as origens" },
  { key: "pp", label: "PPs" },
  { key: "avulso", label: "Avulsos" },
  { key: "folha", label: "Folhas" },
  { key: "recorrencia", label: "Recorrências" },
  { key: "desembolso", label: "Desembolsos" },
  { key: "pp_devolucao_verba", label: "Estornos de verba" },
  { key: "fatura_cartao", label: "Faturas de cartão" },
];

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

/** "aguardando_prestacao": título de verba paga cuja prestação depende da
 *  produção — sem prestação ou reprovada (decisão 081, 4a). "parcial": com
 *  baixa e ainda faltando (decisão 125); ele também está em "A pagar". */
type StatusFiltro = "a_pagar" | "parcial" | "aguardando_prestacao" | "pago" | "todos";

/** O estorno de verba é despesa negativa nas telas (decisão 081, 8a): no
 *  banco segue positivo, aqui abate as somas. */
function valorComSinal(r: TituloRow): number {
  return r.origem === "pp_devolucao_verba" ? -r.valor : r.valor;
}

/** O que falta pagar (decisão 125): o valor menos as baixas (líquido +
 *  retidos). */
function faltaPagar(r: TituloRow): number {
  return Math.max(0, Math.round((r.valor - r.baixado) * 100) / 100);
}

function ehParcial(r: TituloRow): boolean {
  return r.status === "a_pagar" && r.baixas.length > 0 && faltaPagar(r) > 0.004;
}

/** Com o sinal da devolução de verba. */
function comSinal(r: TituloRow, v: number): number {
  return r.origem === "pp_devolucao_verba" ? -v : v;
}

/**
 * O que saiu da conta num recorte de datas: cada baixa na data dela, pelo
 * líquido (decisão 125 — antes, o título inteiro na data da última baixa).
 * A fatura de cartão não tem baixa única (duas pernas): conta pelo título.
 */
function pagoNasDatas(r: TituloRow, casa: (data: string) => boolean): number {
  if (r.baixas.length === 0) {
    return r.status === "pago" && r.pago_em && casa(r.pago_em) ? valorComSinal(r) : 0;
  }
  return comSinal(
    r,
    r.baixas.reduce((acc, b) => (b.data && casa(b.data) ? acc + b.movimentado : acc), 0),
  );
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
  if (r.em_remessa)
    return r.em_remessa_com_retencao
      ? "Pago pela remessa: só a baixa do que falta."
      : "Pago pela remessa com o valor cheio: só a baixa do que falta.";
  return null;
}

// ---------------------------------------------------------------------------
// Baixa em lote (pedido do Tiago, 02/10/2026)
// ---------------------------------------------------------------------------

function origemNoLote(o: OrigemTitulo): o is OrigemPagarNoLote {
  return (ORIGENS_PAGAR_NO_LOTE as readonly string[]).includes(o);
}

/** A chave do título na seleção e no lote — única entre as origens. */
function chaveDoLote(r: TituloRow): string {
  return `pagar|${r.origem}|${r.id}`;
}

/**
 * Por que o título não entra na baixa em lote; `null` entra. O lote paga
 * pela conta escolhida, uma baixa por título, sempre pelo que falta (a
 * parcial entra pelo restante). Entram PP, avulso e recorrência em
 * aberto (decisão aprovada pelo Tiago em 02/10/2026) e, desde 05/10/2026,
 * a folha (revisão da decisão 140); fatura de cartão e devolução de verba
 * têm baixa própria, o previsto no cartão vira item da fatura na baixa
 * (decisão 093), e o desembolso tem o centro de custo escolhido na baixa —
 * todos um de cada vez. A origem já marcada barra as outras na seleção
 * (`useSelecao`), não aqui.
 */
function motivoForaDoLote(r: TituloRow): string | null {
  if (r.status === "pago") return "Título já pago.";
  switch (r.origem) {
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
function paraOLote(r: TituloRow): TituloParaLote | null {
  if (!origemNoLote(r.origem)) return null;
  // A PP com NF registrada leva o número junto do código (módulo fiscal):
  // "PP-00110 · NF 602".
  const origem = r.nf_numero ? `${r.origem_label} · NF ${r.nf_numero}` : r.origem_label;
  return {
    chave: chaveDoLote(r),
    tipo: "pagar",
    alvo: { modulo: "pagar", origem: r.origem, id: r.id },
    titulo: r.descricao,
    referencia:
      r.parcela_total > 1
        ? `${origem} · ${r.parcela_numero}/${r.parcela_total}`
        : origem,
    contraparte: r.fornecedor_nome || "—",
    vencimento: r.data_pagamento,
    aberto: faltaPagar(r),
    // Avulso, recorrência e folha já têm o par; a PP tem só o tipo
    // (decisão 068) e usa o subtipo do lote.
    centroDeCusto:
      r.plano_conta_tipo_id && r.plano_conta_subtipo_id
        ? { tipoId: r.plano_conta_tipo_id, subtipoId: r.plano_conta_subtipo_id }
        : null,
  };
}

/** O título a pagar por trás da linha da planilha (a lista só monta linhas
 *  a pagar). */
function tituloDe(l: Linha): TituloRow {
  return l.t as TituloRow;
}

interface Props {
  /** Base bruta — inclui a_pagar e pago (não cartão). Filtro é interno. */
  rows: TituloRow[];
  tenantId: string;
  contas: ContaBancaria[];
  tipos: PlanoContaTipo[];
  subtipos: PlanoContaSubtipo[];
  empresas: Array<{ id: string; nome: string }>;
  /** `cpf_cnpj` é a chave de busca e a segunda linha da opção do campo
   *  de fornecedor (decisão 067). Ele SÓ atravessa até aqui se cada
   *  fronteira declarar o campo: tipo de prop estreito não apaga o dado
   *  em tempo de execução, mas apaga do tipo — e o próximo `.map` no
   *  caminho o descartaria de vez, com `tsc` limpo. */
  fornecedores: Array<{ id: string; nome: string; cpf_cnpj?: string | null }>;
  clientes: Array<{ id: string; nome: string }>;
  regionais: Array<{ id: string; nome: string; ativo: boolean; empresa_id: string }>;
  /** Cartões de crédito ativos — repassados ao drawer de conta avulsa. */
  cartoes?: CartaoOption[];
  /** A última retenção de cada fornecedor (por `parte_id`), para o
   *  "Repetir as alíquotas" da baixa (decisão 125). */
  ultimasRetencoes: Record<string, UltimaRetencao>;
  /** Botão "Exportar remessa Santander" já montado no server component,
   *  renderizado ao lado do "+ Lançamento Avulso" na toolbar. Módulo
   *  pgto-remessa. */
  exportarRemessaBotao?: React.ReactNode;
  /** Quem aprova folha pode devolver o título de folha para a aprovação
   *  (decisão 132). Obrigatório: a página decide, a lista não adivinha. */
  podeDevolverFolha: boolean;
  /** O dia de hoje em Brasília (decisão 195): o vencido e o trimestre. */
  hoje: string;
  /** Empresa → nome curto, para a coluna Empresa (a lista `empresas` leva a
   *  razão social, que é a do formulário). */
  nomesDasEmpresas: Record<string, string>;
  /** Regional, retenção da aprovação e itens da fatura (decisão 195). */
  extras: ExtrasDaPlanilha;
  /** Os títulos pagos no cartão: ficam na lista como "No cartão", com a
   *  fatura em que entraram (decisão 195), fora das somas do caixa. */
  pagosNoCartao: TituloRow[];
}

export function TitulosPagarList({
  rows: rowsBruto,
  tenantId,
  contas,
  tipos,
  subtipos,
  empresas,
  fornecedores,
  clientes,
  regionais,
  cartoes = [],
  ultimasRetencoes,
  exportarRemessaBotao,
  podeDevolverFolha,
  hoje,
  nomesDasEmpresas,
  extras,
  pagosNoCartao,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  const [statusFiltro, setStatusFiltro] = React.useState<StatusFiltro>("a_pagar");
  const [filtroOrigem, setFiltroOrigem] = React.useState<"todas" | OrigemTitulo>("todas");
  const [busca, setBusca] = React.useState("");
  // Filtro de período — só aplica quando o filtro de status inclui pagos.
  // Filtra por `pago_em` (ISO local). Datas vazias = sem limite naquele lado.
  const [dataDe, setDataDe] = React.useState<string>("");
  const [dataAte, setDataAte] = React.useState<string>("");

  // Recorte pelo filtro de status — o resto do componente enxerga só isso.
  const rows = React.useMemo(
    () =>
      [...rowsBruto, ...pagosNoCartao].filter((r) =>
        statusFiltro === "todos"
          ? true
          : statusFiltro === "aguardando_prestacao"
            ? verbaAguardaProducao(r.verba_situacao)
            : statusFiltro === "parcial"
              ? ehParcial(r)
              : r.status === statusFiltro,
      ),
    [rowsBruto, pagosNoCartao, statusFiltro],
  );

  const [baixando, setBaixando] = React.useState<TituloRow | null>(null);
  const [devolvendo, setDevolvendo] = React.useState<TituloRow | null>(null);
  /** Título JÁ PAGO aberto para conferência — e para estornar, se for o
   *  caso. Clicar na linha paga é o que o abre (18/08/2026). */
  const [conferindo, setConferindo] = React.useState<TituloRow | null>(null);
  const [editando, setEditando] = React.useState<TituloRow | null>(null);
  const [erroAcao, setErroAcao] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);

  /**
   * "Criar e dar baixa": o lançamento é criado primeiro e a baixa vem
   * logo atrás. Como a linha nova só existe depois que o `router.refresh()`
   * do drawer volta do servidor, guardamos o id e abrimos a baixa assim
   * que ela aparece em `rows`.
   */
  const [baixarAposCriar, setBaixarAposCriar] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!baixarAposCriar) return;
    const nova = rows.find((r) => r.origem !== "pp" && r.id === baixarAposCriar);
    if (!nova) return;
    setBaixarAposCriar(null);
    setErroAcao(null);
    setBaixando(nova);
  }, [rows, baixarAposCriar]);

  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // O chip de origem conta respeitando a busca e o período ativos: o
  // número é literalmente "quantas linhas apareceriam se eu clicasse
  // aqui".
  const casaBusca = React.useCallback(
    (r: TituloRow, q: string) =>
      !q ||
      r.descricao.toLowerCase().includes(q) ||
      r.fornecedor_nome.toLowerCase().includes(q) ||
      r.job_codigo.toLowerCase().includes(q) ||
      r.job_nome.toLowerCase().includes(q) ||
      r.origem_label.toLowerCase().includes(q),
    [],
  );

  // Filtro de período só se aplica quando o filtro de status inclui pagos.
  // Filtra por `pago_em`. Em "a_pagar" os inputs ficam ocultos, retorna true.
  const mostraPeriodo = statusFiltro === "pago" || statusFiltro === "todos";
  const casaPeriodo = React.useCallback(
    (r: TituloRow) => {
      if (!mostraPeriodo) return true;
      if (!dataDe && !dataAte) return true;
      // Linhas ainda "a pagar" quando o filtro é "todos" passam sem período.
      if (r.status !== "pago") return true;
      const p = r.pago_em ?? "";
      if (!p) return false;
      if (dataDe && p < dataDe) return false;
      if (dataAte && p > dataAte) return false;
      return true;
    },
    [mostraPeriodo, dataDe, dataAte],
  );

  const contagemOrigem = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    const base = rows.filter((r) => casaBusca(r, q) && casaPeriodo(r));
    return {
      todas: base.length,
      pp: base.filter((r) => r.origem === "pp").length,
      avulso: base.filter((r) => r.origem === "avulso").length,
      folha: base.filter((r) => r.origem === "folha").length,
      recorrencia: base.filter((r) => r.origem === "recorrencia").length,
      desembolso: base.filter((r) => r.origem === "desembolso").length,
      pp_devolucao_verba: base.filter((r) => r.origem === "pp_devolucao_verba").length,
      fatura_cartao: base.filter((r) => r.origem === "fatura_cartao").length,
    };
  }, [rows, busca, casaBusca, casaPeriodo]);

  /** O que passa nos filtros de CIMA (status, origem, busca, período), na
   *  ordem de sempre. Os filtros dos títulos vêm depois, sobre esta lista. */
  const doTopo = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    return rows
      .filter((r) => {
        if (filtroOrigem !== "todas" && r.origem !== filtroOrigem) return false;
        if (!casaPeriodo(r)) return false;
        return casaBusca(r, q);
      })
      .sort((a, b) => {
        // Urgente primeiro entre os "a pagar" (decisão 077, pergunta 4a):
        // a urgência da PP segue no título até ele ser pago.
        if (statusFiltro !== "pago") {
          const urgenteA = a.urgente && a.status === "a_pagar";
          const urgenteB = b.urgente && b.status === "a_pagar";
          if (urgenteA !== urgenteB) return urgenteA ? -1 : 1;
        }
        // Em "a pagar" o próximo vencimento vem primeiro; em "pagos" o mais
        // recente vem primeiro. "Todos": pagos abaixo, mais recente antes;
        // a pagar acima, por vencimento crescente.
        if (statusFiltro === "pago") {
          const paA = a.pago_em ?? "0000-00-00";
          const paB = b.pago_em ?? "0000-00-00";
          return paB.localeCompare(paA);
        }
        if (statusFiltro === "todos") {
          if (a.status !== b.status) return a.status === "a_pagar" ? -1 : 1;
          if (a.status === "pago") {
            return (b.pago_em ?? "0000-00-00").localeCompare(a.pago_em ?? "0000-00-00");
          }
        }
        return (a.data_pagamento ?? "9999-12-31").localeCompare(
          b.data_pagamento ?? "9999-12-31",
        );
      });
  }, [rows, filtroOrigem, busca, casaBusca, casaPeriodo, statusFiltro]);

  // Os filtros e a ordem dos títulos das colunas. `filtrados` é o que a
  // tabela mostra — e é dele que a baixa em lote tira os elegíveis: o
  // "selecionar todos" do cabeçalho só marca o que o filtro deixou, e o
  // título que some do filtro sai da seleção (`useSelecao`).
  //
  // Desde a decisão 195 a lista é a planilha de títulos: as linhas saem do
  // título pela mesma montagem da conciliação (`linhaAPagar`), e o filtro
  // pelo título vale sobre as colunas novas.
  const contexto = React.useMemo(
    () =>
      prepararContexto({
        hoje,
        empresas: nomesDasEmpresas,
        tipos,
        subtipos,
        cartoes,
        contas,
        centroDoImposto: {},
        extras,
      }),
    [hoje, nomesDasEmpresas, tipos, subtipos, cartoes, contas, extras],
  );
  const linhasDoTopo = React.useMemo(() => doTopo.map((r) => linhaAPagar(r, contexto)), [doTopo, contexto]);
  const colunasDoFiltro = React.useMemo(
    () => colunasFiltraveis({ contaId: null, hoje, rotuloContraparte: "Fornecedor", status: true }),
    [hoje],
  );
  const colunas = useFiltrosDeColuna<Linha>(linhasDoTopo, colunasDoFiltro, { guardarEm: "contas-a-pagar-planilha" });
  const filtrados = colunas.visiveis;

  // Baixa em lote (pedido do Tiago, 02/10/2026): marcar vários títulos da
  // lista e dar baixa de uma vez. A seleção vale para o que está na tela:
  // o título que some do filtro, ou que foi pago, sai dela sozinho. Uma
  // origem por lote (revisão da decisão 140, 05/10/2026).
  const elegiveis = filtrados.flatMap((l) => {
    const r = tituloDe(l);
    const t = motivoForaDoLote(r) === null ? paraOLote(r) : null;
    return t ? [elegivelDoLote(t)] : [];
  });
  const selecao = useSelecao(elegiveis);
  const [loteAberto, setLoteAberto] = React.useState(false);
  const selecionados = filtrados
    .map(tituloDe)
    .filter((r) => selecao.marcado(chaveDoLote(r)))
    .map(paraOLote)
    .filter((t): t is TituloParaLote => t !== null);

  // Faixa de resumo — sobre a base bruta (todos os status), não sobre o
  // recorte do chip: é panorama do caixa. O corte de "mês" segue o mês
  // corrente local (America/Sao_Paulo). "Total pago (filtro)" respeita o
  // período quando ele está ativo.
  const aguardandoPrestacao = React.useMemo(
    () => rowsBruto.filter((r) => verbaAguardaProducao(r.verba_situacao)).length,
    [rowsBruto],
  );

  // Decisão 125: o "a pagar" soma o que FALTA de cada título, e os pagos
  // contam cada baixa na data dela, pelo que saiu da conta.
  const resumo = React.useMemo(() => {
    const hoje = hojeISO();
    const limite = somaDiasISO(hoje, 7);
    const mesAtual = hoje.slice(0, 7);
    const aPagar = rowsBruto.filter((r) => r.status === "a_pagar");
    const noPeriodo = (d: string) =>
      !mostraPeriodo || ((!dataDe || d >= dataDe) && (!dataAte || d <= dataAte));
    return {
      emAberto: aPagar.reduce((s, r) => s + comSinal(r, faltaPagar(r)), 0),
      semana: aPagar
        .filter(
          (r) =>
            r.data_pagamento && r.data_pagamento >= hoje && r.data_pagamento <= limite,
        )
        .reduce((s, r) => s + comSinal(r, faltaPagar(r)), 0),
      pagosHoje: rowsBruto.reduce((s, r) => s + pagoNasDatas(r, (d) => d === hoje), 0),
      pagosMes: rowsBruto.reduce(
        (s, r) => s + pagoNasDatas(r, (d) => d.slice(0, 7) === mesAtual),
        0,
      ),
      totalPago: rowsBruto.reduce((s, r) => s + pagoNasDatas(r, noPeriodo), 0),
    };
  }, [rowsBruto, mostraPeriodo, dataDe, dataAte]);

  const alvoBaixa: BaixaTituloAlvo | null = baixando
    ? {
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
        // de verba, avulso e recorrência. O que foi para uma remessa com o
        // valor cheio sai sem retenção; a remessa que pagou o líquido
        // (decisão 145) abre com a retenção dela.
        retencao:
          (baixando.origem === "pp" && !baixando.eh_verba) ||
          baixando.origem === "avulso" ||
          baixando.origem === "recorrencia"
            ? {
                mostra: true,
                motivo:
                  baixando.em_remessa && !baixando.em_remessa_com_retencao
                    ? "Pago pela remessa com o valor cheio."
                    : null,
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
      }
    : null;

  const alvoConferencia: BaixaRegistradaAlvo | null = conferindo
    ? {
        titulo: conferindo.descricao,
        origem:
          conferindo.origem === "pp"
            ? `Pedido de produção ${conferindo.origem_label}`
            : conferindo.origem === "recorrencia"
              ? `Recorrência · ${conferindo.descricao}`
              : conferindo.origem === "desembolso"
                ? `Desembolso ${conferindo.origem_label}`
                : conferindo.origem === "pp_devolucao_verba"
                  ? `Estorno de verba ${conferindo.origem_label.replace(/^ESTORNO /, "")}`
                  : conferindo.origem === "fatura_cartao"
                    ? `Fatura de cartão ${conferindo.origem_label}`
                    : conferindo.origem === "folha"
                      ? "Folha de pagamento"
                      : "Lançamento avulso",
        parcela: `${conferindo.parcela_numero}/${conferindo.parcela_total}`,
        valor: conferindo.valor,
        vencOriginal: conferindo.venc_original,
        // As baixas do documento (decisão 125). A fatura de cartão não tem
        // um lançamento só (duas pernas): a baixa dela sai dos campos de
        // uma baixa só, e cancela pela fatura.
        baixas:
          conferindo.baixas.length > 0
            ? conferindo.baixas
            : [
                {
                  lancamentoId: conferindo.baixa_lancamento_id,
                  data: conferindo.pago_em,
                  contaNome: conferindo.conta_nome,
                  contaBancariaId: conferindo.baixa_conta_id,
                  centroNome: conferindo.centro_nome,
                  subtipoNome: conferindo.subtipo_nome,
                  movimentado: conferindo.valor,
                  retencoes: [],
                  estornos: conferindo.estornos_da_baixa,
                  antesDaNf: false,
                },
              ],
        viaCartao: conferindo.forma_pagamento === "cartao_credito",
        ehFaturaDeCartao: conferindo.origem === "fatura_cartao",
        ehTransferencia: false,
        semEstorno: motivoSemEstorno(conferindo),
      }
    : null;

  const alvoEdicao: EditarDataAlvo | null = editando
    ? {
        titulo: editando.descricao,
        origem:
          editando.origem === "pp"
            ? `${editando.origem_label} · ${editando.parcela_numero}/${editando.parcela_total}`
            : editando.origem === "desembolso"
              ? `Desembolso ${editando.origem_label}`
              : editando.origem === "pp_devolucao_verba"
                ? `Estorno de verba ${editando.origem_label.replace(/^ESTORNO /, "")}`
                : editando.origem_label,
        vencOriginal: editando.venc_original,
        primeiraData: editando.data_pagamento_primeira,
        dataAtual: editando.data_pagamento,
      }
    : null;

  return (
    <div className="space-y-4">
      {/* Linha 1: Status (esquerda) + botões de ação (direita extrema). */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Status
          </span>
          <StatusChip
            ativo={statusFiltro === "a_pagar"}
            onClick={() => setStatusFiltro("a_pagar")}
            label="A pagar"
          />
          <StatusChip
            ativo={statusFiltro === "parcial"}
            onClick={() => setStatusFiltro("parcial")}
            label="Parciais"
          />
          <StatusChip
            ativo={statusFiltro === "aguardando_prestacao"}
            onClick={() => setStatusFiltro("aguardando_prestacao")}
            label={
              aguardandoPrestacao > 0
                ? `Aguardando prestação · ${aguardandoPrestacao}`
                : "Aguardando prestação"
            }
          />
          <StatusChip
            ativo={statusFiltro === "pago"}
            onClick={() => setStatusFiltro("pago")}
            label="Pagos"
          />
          <StatusChip
            ativo={statusFiltro === "todos"}
            onClick={() => setStatusFiltro("todos")}
            label="Todos"
          />
        </div>

        {statusFiltro !== "pago" && (
          <div className="flex items-center gap-2">
            {exportarRemessaBotao}
            <ContaAvulsaDrawer
              mode="criar"
              tenantId={tenantId}
              empresas={empresas}
              tipos={tipos}
              subtipos={subtipos}
              fornecedores={fornecedores}
              clientes={clientes}
              regionais={regionais}
              cartoes={cartoes}
              onCriadaParaBaixa={(id) => {
                setFiltroOrigem("todas");
                setBusca("");
                // O lançamento novo tem de aparecer: os títulos também limpam.
                colunas.limpar();
                setBaixarAposCriar(id);
              }}
              trigger={
                <button
                  type="button"
                  className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-california-red-hover"
                >
                  <Plus className="h-4 w-4" />
                  Lançamento Avulso
                </button>
              }
            />
          </div>
        )}
      </div>

      {/* Linha 2: busca (esquerda) + filtros de origem (após a busca). */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por título, fornecedor ou job..."
            className="w-full rounded-lg border border-border bg-white py-2 pl-9 pr-3 text-sm focus:border-california-red focus:outline-none"
          />
        </div>
        {CHIP_ORIGEM.map((c) => (
          <Chip
            key={c.key}
            ativo={filtroOrigem === c.key}
            onClick={() => setFiltroOrigem(c.key)}
            label={c.label}
            count={contagemOrigem[c.key]}
          />
        ))}
      </div>

      {/* Faixa de resumo — panorama do caixa. Itens fixos; o período só
          aparece quando o filtro de status inclui pagos. */}
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card px-4 py-3">
        <ResumoItem
          icone={<Wallet className="h-3.5 w-3.5 text-california-red" />}
          label="Em aberto"
          valor={resumo.emAberto}
        />
        <div className="h-5 w-px bg-border" />
        <ResumoItem
          icone={<CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />}
          label="Vencendo em 7 dias"
          valor={resumo.semana}
        />
        <div className="h-5 w-px bg-border" />
        <ResumoItem
          icone={<CheckCheck className="h-3.5 w-3.5 text-emerald-700" />}
          label="Pagos este mês"
          valor={resumo.pagosMes}
        />
        {mostraPeriodo && (
          <>
            <div className="h-5 w-px bg-border" />
            <ResumoItem
              icone={<Wallet className="h-3.5 w-3.5 text-muted-foreground" />}
              label="Total pago (filtro)"
              valor={resumo.totalPago}
            />
            {/* Filtro de período — ancorado à direita do card. Cada
                DatePicker traz seu próprio X pra limpar. */}
            <div className="ml-auto flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Pago em
              </span>
              <div className="w-[160px]">
                <DatePicker
                  name="pago_em_de"
                  defaultValue={dataDe}
                  placeholder="De"
                  onDateChange={(d) => setDataDe(d ? format(d, "yyyy-MM-dd") : "")}
                  className="h-9 px-3 text-xs"
                />
              </div>
              <span className="text-xs text-muted-foreground">até</span>
              <div className="w-[160px]">
                <DatePicker
                  name="pago_em_ate"
                  defaultValue={dataAte}
                  placeholder="Até"
                  onDateChange={(d) => setDataAte(d ? format(d, "yyyy-MM-dd") : "")}
                  className="h-9 px-3 text-xs"
                />
              </div>
            </div>
          </>
        )}
      </div>

      {/* Tabela — table-fixed para caber na largura da página sem scroll horizontal.
          Larguras em % para escalar com o container; Título e Fornecedor
          absorvem sobra e truncam quando precisa.

          O cabeçalho segue o alinhamento do conteúdo da coluna, como na
          aba Cartão: texto (Título, Fornecedor, Job) à esquerda, dinheiro à
          direita, o resto centralizado. Até 16/09/2026 todos os cabeçalhos
          eram centralizados, e com a página mais larga o "Título" ficava
          visivelmente solto do texto embaixo dele.

          A 1ª coluna é a seleção da baixa em lote (02/10/2026), da largura
          da coluna de caixas da remessa CNAB (`w-10`). Título e Fornecedor
          cederam 5% para ela: com as porcentagens somando 100% e mais 40px
          fixos, a tabela passaria da largura da página.

          Filtro pelo título (09/10/2026): o botão do título soma 16 px (a
          seta do funil) e, com a coluna ordenada, mais 14 px (a seta da
          ordem). Só "Parcela" não cabia: em 5% (≈ 83 px, 67 px úteis) o
          "PARCELA" com as duas setas pede 84 px e invadia o Status. Ela foi
          a 6% (≈ 100 px) e o Título, que quebra linha, cedeu o 1% (16% →
          15%). As outras colunas cabem com folga, medidas a 1838 px. */}
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
        linhas={filtrados}
        contaId={null}
        hoje={hoje}
        colunaStatus
        titulo={(chave) => colunas.titulo(chave)}
        cabecalhoDaSelecao={<CaixaDoCabecalho {...selecao.cabecalho} />}
        caixa={(l) => {
          const r = tituloDe(l);
          const chaveLote = chaveDoLote(r);
          const motivoLote = motivoForaDoLote(r) ?? selecao.foraDaOrigem(chaveLote);
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
        onBaixar={(l) => {
          setErroAcao(null);
          setBaixando(tituloDe(l));
        }}
        onEditarData={(l) => {
          setErroAcao(null);
          setEditando(tituloDe(l));
        }}
        onVerBaixas={(l) => {
          setErroAcao(null);
          setConferindo(tituloDe(l));
        }}
        detalhes={(l) => {
          const r = tituloDe(l);
          // As ações que moravam soltas na linha (decisão 195): o olho do
          // parcial e o "Devolver para a aprovação" da folha.
          const acoes: AcaoDoDetalhe[] = [];
          if (ehParcial(r)) {
            acoes.push({
              rotulo: "Ver as baixas",
              icone: Eye,
              onClick: () => {
                setErroAcao(null);
                setConferindo(r);
              },
            });
          }
          if (podeDevolverFolha && r.origem === "folha" && r.status !== "pago" && !ehParcial(r)) {
            acoes.push({
              rotulo: "Devolver para a aprovação",
              icone: Undo2,
              onClick: () => {
                setErroAcao(null);
                setDevolvendo(r);
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
          doTopo.length > 0
            ? "Nenhum título com esse filtro."
            : rows.length === 0
              ? statusFiltro === "a_pagar"
                ? "Nenhum título a pagar. Aprove um Pedido de Produção ou crie um lançamento avulso."
                : statusFiltro === "pago"
                  ? "Nenhum título pago ainda. Baixas registradas aparecerão aqui."
                  : "Nenhum título encontrado."
              : "Nenhum título encontrado com esses filtros."
        }
      />

      {/* Baixa em lote: a barra da seleção — quantos títulos, o que sai da
          conta e "Dar baixa". Gruda no pé da tela enquanto a lista rola, e
          some sem seleção. */}
      <BarraDeSelecao
        itens={selecionados}
        onLimpar={selecao.limpar}
        onBaixar={() => setLoteAberto(true)}
      />

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Info className="h-3.5 w-3.5" />
        Baixa é feita aqui. A aprovação e a rejeição continuam na aba de
        Pedidos de Produção. O olho do título pago e o ⓘ do parcial abrem as
        baixas para conferir e, se preciso, estornar ou cancelar.
      </p>

      {devolvendo && (
        <DevolverFolhaDialog
          contaAvulsaId={devolvendo.id}
          descricao={devolvendo.descricao}
          valor={devolvendo.valor}
          open={devolvendo !== null}
          onOpenChange={(o) => {
            if (!o) setDevolvendo(null);
          }}
        />
      )}

      <BaixaTituloDialog
        open={baixando !== null}
        onOpenChange={(o) => {
          if (!o) {
            setBaixando(null);
            setErroAcao(null);
          }
        }}
        alvo={alvoBaixa}
        contas={contas}
        tipos={tipos}
        subtipos={subtipos}
        cartoes={cartoes}
        formaPlanejada={baixando?.forma_pagamento ?? baixando?.forma_prevista ?? null}
        cartaoPlanejadoId={baixando?.cartao_credito_id ?? baixando?.cartao_previsto_id ?? null}
        pending={pending}
        erro={erroAcao}
        onConfirm={(payload) => {
          const alvo = baixando;
          if (!alvo) return;
          startTransition(async () => {
            const res = await darBaixaTitulo({
              origem: alvo.origem,
              id: alvo.id,
              ...payload,
            });
            if (!res.ok) {
              setErroAcao(res.message);
              return;
            }
            setBaixando(null);
            setErroAcao(null);
            // No cartão nada foi para a conciliação de conta bancária: o
            // item entrou numa fatura, e o toast diz em qual (093 §13). A
            // fatura vem do SERVIDOR — a da data do pagamento pode já ter
            // fechado, e aí o banco rola para a próxima aberta.
            const cartao =
              payload.forma_pagamento === "cartao_credito"
                ? cartoes.find((c) => c.id === payload.cartao_credito_id) ?? null
                : null;
            const competencia = res.fatura
              ? lerCompetencia(res.fatura.competencia_fechamento.slice(0, 7))
              : null;
            const retidoNaBaixa =
              payload.retencoes.reduce((acc, r) => acc + Math.round(r.valor * 100), 0) / 100;
            const liquido = Math.round((payload.valor_baixa - retidoNaBaixa) * 100) / 100;
            const resta = Math.round((faltaPagar(alvo) - payload.valor_baixa) * 100) / 100;
            setToast(
              res.fatura
                ? `Confirmado no cartão · ${formatMoney(alvo.valor)} entrou na fatura${competencia ? ` de ${rotuloCurto(competencia)}` : ""}${cartao ? ` do ${cartao.nome}` : ""} (${res.fatura.codigo}).`
                : `Baixa registrada · ${formatMoney(liquido)} enviado para a conciliação.` +
                    (retidoNaBaixa > 0
                      ? ` ${formatMoney(retidoNaBaixa)} retidos, a recolher.`
                      : "") +
                    (resta > 0.004 ? ` Faltam ${formatMoney(resta)}.` : ""),
            );
            router.refresh();
          });
        }}
      />

      <BaixaRegistradaDialog
        open={conferindo !== null}
        onOpenChange={(o) => {
          if (!o) {
            setConferindo(null);
            setErroAcao(null);
          }
        }}
        alvo={alvoConferencia}
        // A página já traz só contas ativas e sem cartão.
        contas={contas.map((c) => ({ id: c.id, nome: c.nome, banco: c.banco }))}
        pending={pending}
        erro={erroAcao}
        onDarBaixaNoRestante={() => {
          const alvo = conferindo;
          if (!alvo) return;
          setConferindo(null);
          setErroAcao(null);
          setBaixando(alvo);
        }}
        onCancelar={(baixa, motivo) => {
          const alvo = conferindo;
          if (!alvo) return;
          // PP, avulso, recorrência e folha cancelam AQUELA baixa (decisão
          // 125); desembolso, devolução de verba e fatura têm uma baixa só
          // e cancelam pelo documento.
          const porBaixa =
            baixa.lancamentoId !== null &&
            (alvo.origem === "pp" ||
              alvo.origem === "avulso" ||
              alvo.origem === "recorrencia" ||
              alvo.origem === "folha");
          startTransition(async () => {
            const res = porBaixa
              ? await cancelarBaixa({ tipo: "baixa", id: baixa.lancamentoId, motivo })
              : await cancelarBaixa({ tipo: alvo.origem, id: alvo.id, motivo });
            if (!res.ok) {
              setErroAcao(res.message);
              return;
            }
            setConferindo(null);
            setErroAcao(null);
            const sobraBaixa = porBaixa && alvo.baixas.length > 1;
            setToast(
              alvo.origem === "fatura_cartao"
                ? `Pagamento cancelado · a fatura ${alvo.origem_label} voltou para Fechada.`
                : `Baixa cancelada · ${formatMoney(baixa.movimentado)} saíram do extrato e o título voltou para ${sobraBaixa ? "Parcial" : "A pagar"}.`,
            );
            router.refresh();
          });
        }}
        onEstornar={(baixa, dados) => {
          const alvo = conferindo;
          if (!alvo || !baixa.lancamentoId) return;
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
              setErroAcao(res.message);
              return;
            }
            setConferindo(null);
            setErroAcao(null);
            setToast(
              `Estorno registrado · ${formatMoney(dados.valor)} ${alvo.origem === "pp_devolucao_verba" ? "saiu da" : "voltou para a"} conta em ${formatDate(dados.data)}. A baixa continua como está.`,
            );
            router.refresh();
          });
        }}
      />

      <EditarDataPagamentoDialog
        open={editando !== null}
        onOpenChange={(o) => {
          if (!o) {
            setEditando(null);
            setErroAcao(null);
          }
        }}
        alvo={alvoEdicao}
        pending={pending}
        erro={erroAcao}
        onSalvar={(novaData) => {
          const alvo = editando;
          if (!alvo) return;
          startTransition(async () => {
            const res = await repactuarDataPagamento({
              origem: alvo.origem,
              id: alvo.id,
              data_pagamento: novaData,
            });
            if (!res.ok) {
              setErroAcao(res.message);
              return;
            }
            setEditando(null);
            setErroAcao(null);
            setToast(`Data de pagamento atualizada para ${formatDate(novaData)}.`);
            router.refresh();
          });
        }}
      />

      {/* Baixa em lote: a data e a conta uma vez, uma baixa por título. */}
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

// ---------------------------------------------------------------------------
// Peças pequenas
// ---------------------------------------------------------------------------

function StatusChip({
  ativo,
  onClick,
  label,
}: {
  ativo: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
        ativo
          ? "border-california-red bg-california-red text-white"
          : "border-border bg-white text-muted-foreground hover:border-california-red/50",
      )}
    >
      {label}
    </button>
  );
}

function Chip({
  ativo,
  onClick,
  label,
  count,
}: {
  ativo: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
        ativo
          ? "border-california-red bg-california-red text-white"
          : "border-border bg-white text-muted-foreground hover:border-california-red/50",
      )}
    >
      {label}
      <span
        className={cn(
          "tabular-nums",
          ativo ? "text-white/85" : "text-muted-foreground/70",
        )}
      >
        {count}
      </span>
    </button>
  );
}

function ResumoItem({
  icone,
  label,
  valor,
}: {
  icone: React.ReactNode;
  label: string;
  valor: number;
}) {
  return (
    <div className="flex items-center gap-2.5">
      {icone}
      <span className="whitespace-nowrap text-xs text-muted-foreground">{label}</span>
      <span className="font-mono text-sm font-bold tabular-nums">
        {formatMoney(valor)}
      </span>
    </div>
  );
}
