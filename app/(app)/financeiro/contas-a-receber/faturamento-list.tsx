"use client";

/**
 * Aba "Faturamento" (Tela 3.3) — o que ainda espera nota, e o que já saiu.
 *
 * Uma linha por NOTA do envio (decisão 123, 29/09/2026): a produção diz,
 * ao liberar o job, em quantas notas fiscais ele sai — cada uma com o
 * próprio CNPJ, CNAE sugerido e descritivo — e em quantos vencimentos cada
 * nota se paga. A view continua trazendo uma linha por PARCELA (a unidade
 * de saldo); a tela junta as parcelas de uma nota numa linha só, e o
 * Faturar emite a nota inteira, total ou parcialmente.
 *
 * As notas já emitidas continuam aqui, em verde — clicar na linha reabre o
 * mesmo formulário em modo somente leitura.
 *
 * Decisão 260 (16/11/2026, protótipo "Faturar em pé" aprovado pelo Tiago):
 * - a lista em grade fixa, como a de PPs: cada linha tem no máximo duas
 *   alturas, e o texto que não cabe abre inteiro ao passar o mouse;
 * - Job (código, origem, mês e, embaixo, o nome do job dado pelo
 *   financeiro), Cliente, Empresa, Valor, Já faturado, A faturar, Parcela,
 *   Vencimento, Enviado por, Situação e o ícone da Planilha Interna; sem as
 *   colunas Descrição e Ação (o clique na linha faz o que o botão fazia, e o
 *   número da NF foi para o selo da coluna Job);
 * - os chips A faturar · Faturados · A receber · Recebidos · Inadimplentes ·
 *   Todos, com a contagem. O que foi recebido em parte vira mais de uma
 *   linha (`situacao-da-nota.ts`); em Todos, as linhas da mesma nota vêm
 *   juntas, ligadas por um tracejado;
 * - o filtro pelo CNPJ emissor no lugar do filtro de Cliente.
 *
 * Duas regras do protótipo moram nesta tela:
 *
 * 1. **Uma NF agrupada só cobre jobs de um mesmo cliente e de um mesmo
 *    CNPJ.** Com mais de um cliente (ou CNPJ) na seleção o formulário NÃO
 *    abre — o erro aparece na própria barra de seleção. A conta é pelo
 *    `cliente_id` e pelo CNPJ da nota do envio, e `emitir_faturamento`
 *    recusa de novo no banco (079 e 123).
 * 2. **BV nunca entra em NF agrupada**, porque a contraparte dele é o
 *    fornecedor. O checkbox da linha fica desabilitado.
 *
 * Recebimento antes da NF (decisão 130): registrado no Recebimento avulso
 * (decisão 260; antes, na conciliação, decisão 256), aparece aqui como uma
 * linha em Recebidos, logo abaixo da linha a faturar. Na emissão, o recebido
 * vira a parcela 1 da nota.
 */

import * as React from "react";
import { createPortal } from "react-dom";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertCircle,
  Building2,
  Check,
  ChevronDown,
  FileCheck2,
  FileText,
  HandCoins,
  Hourglass,
  Info,
  Layers,
  Plus,
  Search,
  Sheet,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { TruncateTooltip } from "@/components/ui/truncate-tooltip";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PopUpDaPlanilha } from "@/app/(app)/financeiro/abertura-de-job/[jobId]/planilha-em-leitura";
import type { ParteDaNota, RecebimentoDaNota, SituacaoDaNota } from "./situacao-da-nota";
import { cn, formatCnpj } from "@/lib/utils";
import type { ContaBancaria, PlanoContaTipo, PlanoContaSubtipo } from "@/lib/types";
import type { FiscalDoFaturar } from "@/lib/fiscal/faturar";
import { sugestaoDoCnpj } from "@/lib/fiscal/faturar";
import { formatarCnpj } from "@/lib/fiscal/cadastro";
import { Checkbox } from "@/components/ui/checkbox";
import {
  FaturarDrawer,
  type CnpjsDoCliente,
  type DrawerState,
  type InfoJob,
  type JobDoFaturar,
} from "./faturar-drawer";
import type { ContatoCobranca } from "@/lib/data/contatos-cobranca";
import {
  BotaoInfo,
  InfoFaturamentoModal,
  type InfoFaturamento,
} from "@/components/financeiro/info-faturamento-modal";
import { rotuloMes } from "@/lib/calculos/meses-trimestre";
import { chaveDaLinhaDaFila, chaveDoRecebidoAntes, chaveDoRecebidoDoJob, chaveInfoDoEnvio } from "./chave-info";
import {
  RecebidosAntesNfDialog,
  somaDosRecebidos,
  type AlvoDoRecebidoAntes,
  type CambioDoJob,
  type RecebidoAntesDaNf,
} from "./recebimento-antes-nf-dialog";
import { cancelarRecebimentoAntesNf } from "./actions-recebimento-antes-nf";
import {
  BarraDosFiltrosDeColuna,
  celulaData,
  celulaTexto,
  celulaValor,
  useFiltrosDeColuna,
  type ColunaFiltravel,
} from "@/components/ui/filtro-de-coluna";

// ---------------------------------------------------------------------------
// Tipos das linhas
// ---------------------------------------------------------------------------

export interface FaturamentoPendenteRow {
  origem_tipo: "job" | "bv";
  /** O que o item da nota aponta: o job, ou o BV. */
  origem_id: string;
  /** O JOB da linha — no BV é o job de origem, e não o BV
   *  (`vw_faturamento_pendente`, 31/08/2026). Chave do botão `i`. */
  job_id: string | null;
  /** Parcela do envio que esta linha representa. Nulo em BV. */
  envio_parcela_id: string | null;
  /** Mês do envio no job mensal — Fee e Always On (decisão 078). Nulo nos
   *  outros jobs e em BV. */
  mes_referencia: string | null;
  empresa_id: string;
  codigo: string | null;
  descricao: string;
  cliente_id: string | null;
  fornecedor_id: string | null;
  contraparte_nome: string;
  /** Valor desta parcela. */
  valor_previsto: number;
  valor_ja_faturado: number;
  /** Saldo desta parcela. */
  saldo: number;
  /** Soma dos saldos de TODAS as parcelas do job — o "total do job". */
  saldo_job: number;
  /** Quanto do saldo desta parcela ainda é faturamento PRÓPRIO do job.
   *  O que passar disso é saldo em save, e vira um segundo item de nota
   *  (docs/decisions/028-save-entre-jobs.md). Numa parcela sem save é o
   *  saldo inteiro. */
  saldo_proprio: number;
  /** Quanto do saldo desta parcela é saldo em save. Zero na maioria. */
  saldo_save: number;
  parcela_numero: number;
  parcela_total: number;
  data_prevista: string | null;
  /** A nota do envio a que esta parcela pertence (decisão 123). Nulo em BV. */
  envio_nota_id: string | null;
  /** Posição da nota no envio, e quantas notas o envio tem. Nulos em BV. */
  nota_ordem: number | null;
  nota_total: number | null;
  /** CNPJ do cliente para o qual a nota sai (só dígitos). Nulo em BV e
   *  quando o GP marcou o tomador no exterior. */
  cnpj_tomador: string | null;
  /** Decisão 184: o GP marcou "Tomador no exterior, sem CNPJ". */
  tomador_exterior: boolean;
  /** CNAE que o GP sugeriu — texto de fundo no Faturar (D3). */
  cnae_sugerido: string | null;
  /** O descritivo que o GP escreveu para esta nota. */
  descritivo_nota: string | null;
  /** Quem mandou e quando (decisão 136): na linha de job, quem enviou o job
   *  para faturamento; na de BV, quem confirmou o BV. */
  autor_nome: string | null;
  autor_em: string | null;
  /** Decisão 188: a nota do envio em lote de que esta parcela é parte. Nula
   *  no envio de um job só e no BV. */
  lote: NotaDoLote | null;
  /** Decisão 229: a variação cambial do câmbio fechado da nota (+ ganho,
   *  − perda), já somada a `saldo`. Zero fora do internacional. */
  variacao_cambial: number;
  /** Decisão 256: a linha do saldo do Novo faturamento — o job faturado pelo
   *  financeiro abaixo do previsto (no mensal, o mês). Sem envio: o Faturar
   *  dela abre o Novo faturamento com o saldo. */
  saldo_do_novo_faturamento: boolean;
}

/**
 * Uma nota do envio em lote (decisão 188): a nota que o cliente pediu, com
 * a parte de cada job. Cada parte é uma nota do envio do job; a fila junta
 * as partes numa linha só, e o Faturar emite a nota inteira.
 */
export interface NotaDoLote {
  lote_nota_id: string;
  lote_id: string;
  /** Posição da nota no lote, e quantas notas o lote tem. */
  ordem: number;
  total: number;
  /** Para quem a nota sai, como a produção escreveu (a instituição do
   *  e-mail do cliente). Nulo desde a decisão 263 quando a nota sai para
   *  um CNPJ que não é o do cliente: o envio só pede o CNPJ. */
  tomador_nome: string | null;
  /** O valor da nota pedida, somadas as partes dos jobs. */
  valor: number;
  /** A observação do envio para o financeiro. Não sai na nota. */
  observacao: string | null;
}

/**
 * Uma linha da fila: as parcelas (vencimentos) de UMA nota do envio, ou um
 * BV. Os números são a soma das parcelas. Na nota do envio em lote, as
 * parcelas são as de todos os jobs da nota (decisão 188).
 */
interface LinhaDaFila {
  chave: string;
  /** A primeira parcela — o que é da nota inteira (job, cliente, CNPJ). */
  p: FaturamentoPendenteRow;
  parcelas: FaturamentoPendenteRow[];
  valor: number;
  jaFaturado: number;
  saldo: number;
  primeiroVencimento: string | null;
  ultimoVencimento: string | null;
  /** Quantos vencimentos a nota tem. Na do lote, as partes dos jobs vencem
   *  juntas: conta as datas, não as parcelas. */
  vencimentos: number;
}

export interface FaturadoRow {
  faturamento_id: string;
  numero_nf: string;
  data_emissao: string;
  valor_total: number;
  descricao: string;
  /** CNAE usado na emissão — informado pelo financeiro desde 31/08/2026. */
  cnae: string;
  /** CNPJ para o qual a nota saiu (decisão 123). Nulo nas notas antigas,
   *  que saíram para o CNPJ do cadastro, e nas de BV. */
  cnpj_tomador: string | null;
  /** Módulo fiscal (02/10/2026): o CNPJ que emitiu a nota e o CNAE da
   *  lista dele. Nulos nas notas de antes, que só têm o texto `cnae`. */
  estabelecimento_id: string | null;
  fiscal_cnae_id: string | null;
  anexo_nf_path: string;
  empresa_id: string;
  origem_tipo: "job" | "bv" | "avulso";
  contraparte_nome: string;
  cliente_id: string | null;
  qtd_parcelas: number;
  primeiro_vencimento: string | null;
  /** As parcelas de recebimento que a nota realmente gerou, em ordem.
   *  O formulário em modo leitura mostra ESTAS — antes ele montava uma
   *  parcela sintética com o total da NF, e uma nota 2× aparecia como
   *  1× (corrigido em 18/08/2026). */
  parcelas: Array<{ numero: number; valor: number; data_vencimento: string }>;
  /** Rateio de regional da nota avulsa (decisão 086), para o formulário em
   *  leitura. Vazio na nota de job ou de BV, que ficam na regional do job. */
  rateio: Array<{ regional_nome: string; percentual: number }>;
  /** Jobs DISTINTOS que a nota cobre, na ordem dos itens — o botão `i`
   *  mostra a PO de cada um. Vazio no avulso. */
  jobs_cobertos: Array<{ job_id: string; codigo: string }>;
  /** Quem mandou o que a nota cobre (decisão 136): quem enviou cada job
   *  para faturamento, ou confirmou cada BV. Vazio no avulso. */
  autores: Array<{ codigo: string; nome: string; em: string | null; bv: boolean }>;
  /** Decisão 256: nota de job que o financeiro faturou sem o envio da produção. */
  pelo_financeiro: boolean;
  /** Decisão 260: a situação de recebimento e os pedaços da nota, pelos
   *  títulos dela (`situacao-da-nota.ts`). Obrigatório: a página calcula. */
  recebimento: RecebimentoDaNota;
  itens: Array<{
    // `save` só aparece no ITEM: é a fatia da nota que virou crédito do
    // cliente em vez de faturamento deste job.
    origem_tipo: "job" | "bv" | "avulso" | "save";
    /** Job (ou BV) que o item cobre. Nulo no avulso, que não tem origem.
     *  É a chave do botão `i` quando a nota é reaberta em leitura. */
    origem_id: string | null;
    codigo: string;
    descricao: string;
    valor: number;
  }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function formatMoney(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
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

/** A chave da linha da fila (`chave-info.ts`): a nota do envio junta as
 *  parcelas dela, e a nota do envio em lote junta as partes dos jobs. */
const chaveLinha = chaveDaLinhaDaFila;

/** Os jobs distintos de uma linha, na ordem das parcelas. */
function jobsDaLinha(l: LinhaDaFila): FaturamentoPendenteRow[] {
  const vistos = new Set<string>();
  return l.parcelas.filter((x) => {
    if (vistos.has(x.origem_id)) return false;
    vistos.add(x.origem_id);
    return true;
  });
}

/** Junta as parcelas de cada nota numa linha, na ordem em que aparecem. */
function agruparPorNota(rows: FaturamentoPendenteRow[]): LinhaDaFila[] {
  const porChave = new Map<string, LinhaDaFila>();
  for (const r of rows) {
    const k = chaveLinha(r);
    const atual = porChave.get(k);
    if (!atual) {
      porChave.set(k, {
        chave: k,
        p: r,
        parcelas: [r],
        valor: r.valor_previsto,
        jaFaturado: r.valor_ja_faturado,
        saldo: r.saldo,
        primeiroVencimento: r.data_prevista,
        ultimoVencimento: r.data_prevista,
        vencimentos: 1,
      });
      continue;
    }
    atual.parcelas.push(r);
    atual.valor += r.valor_previsto;
    atual.jaFaturado += r.valor_ja_faturado;
    atual.saldo += r.saldo;
    if (r.data_prevista) {
      if (!atual.primeiroVencimento || r.data_prevista < atual.primeiroVencimento) {
        atual.primeiroVencimento = r.data_prevista;
      }
      if (!atual.ultimoVencimento || r.data_prevista > atual.ultimoVencimento) {
        atual.ultimoVencimento = r.data_prevista;
      }
    }
  }
  const linhas = Array.from(porChave.values());
  for (const l of linhas) {
    // Na nota do lote, job a job: as parcelas de cada job ficam juntas.
    l.parcelas.sort(
      (a, b) =>
        (l.p.lote ? (a.codigo ?? "").localeCompare(b.codigo ?? "") : 0) || a.parcela_numero - b.parcela_numero,
    );
    if (l.p.lote) l.p = l.parcelas[0];
    l.vencimentos = l.p.lote
      ? new Set(l.parcelas.map((x) => x.data_prevista ?? "")).size
      : l.parcelas.length;
  }
  // A ordem continua a do vencimento; no empate, as notas de um mesmo lote
  // seguem a ordem do lote (1/2 antes de 2/2).
  return linhas
    .map((l, i) => ({ l, i }))
    .sort((a, b) => {
      const va = a.l.primeiroVencimento ?? "9999-12-31";
      const vb = b.l.primeiroVencimento ?? "9999-12-31";
      if (va !== vb) return va.localeCompare(vb);
      const la = a.l.p.lote;
      const lb = b.l.p.lote;
      if (la && lb && la.lote_id === lb.lote_id) return la.ordem - lb.ordem;
      return a.i - b.i;
    })
    .map((x) => x.l);
}

// ---------------------------------------------------------------------------
// Filtro e ordem pelo título da coluna, como no Excel (pedido do Tiago,
// 09/10/2026, decisão 165 — o mesmo filtro da aba PPs do job)
// ---------------------------------------------------------------------------

/**
 * Uma linha da tabela: uma nota a faturar (as parcelas de uma nota do envio,
 * ou um BV) ou uma nota já emitida, em verde. As duas populações usam as
 * MESMAS colunas: o filtro de um título vale para as duas de uma vez.
 */
type LinhaDaTabela =
  | { tipo: "pendente"; l: LinhaDaFila; parte?: "recebido" }
  | { tipo: "faturado"; f: FaturadoRow; parte?: ParteDaNota };

/** O selo da coluna Origem. */
function origemDaLinha(x: LinhaDaTabela): string {
  if (x.tipo === "faturado") return "Faturado";
  if (x.l.p.lote) return "Lote";
  return x.l.p.origem_tipo === "bv" ? "BV" : "Job";
}
const ORDEM_DA_ORIGEM = ["Job", "Lote", "BV", "Faturado"];

/** O cliente, como o filtro "Cliente" de cima chama: o BV vem com o
 *  fornecedor, rotulado — é dele que a nota cobra. */
function contraparteDaLinha(x: LinhaDaTabela): string {
  const bv = x.tipo === "faturado" ? x.f.origem_tipo === "bv" : x.l.p.origem_tipo === "bv";
  const nome = x.tipo === "faturado" ? x.f.contraparte_nome : x.l.p.contraparte_nome;
  return bv ? `${nome} (fornecedor)` : nome;
}

/** O que a coluna "Job / descrição" mostra em negrito. */
function descricaoDaLinha(x: LinhaDaTabela): string {
  // A nota do lote junta os jobs, como a nota emitida de vários jobs.
  if (x.tipo === "pendente") {
    return x.l.p.lote ? jobsDaLinha(x.l).map((j) => j.descricao).join(" + ") : x.l.p.descricao;
  }
  return [...new Set(x.f.itens.map((i) => i.descricao.split(" — ")[0]))].join(" + ");
}

const COLUNAS: ColunaFiltravel<LinhaDaTabela>[] = [
  {
    // Decisão 260: Job e Descrição numa coluna só. O filtro é pelo
    // código e pelo nome do job (o do financeiro, decisão 243); a busca da
    // coluna acha também pela origem, pelo mês do mensal e por quem mandou.
    chave: "origem",
    rotulo: "Job",
    tipo: "texto",
    celula: (x) => {
      const nome = descricaoDaLinha(x);
      const codigo =
        x.tipo === "pendente"
          ? x.l.p.lote
            ? jobsDaLinha(x.l).map((j) => j.codigo ?? "").join(", ")
            : (x.l.p.codigo ?? "")
          : [...new Set(x.f.itens.map((i) => i.codigo))].join(", ");
      const extra =
        x.tipo === "pendente"
          ? [
              origemDaLinha(x),
              x.l.p.mes_referencia ? rotuloMes(x.l.p.mes_referencia) : "",
              x.l.p.autor_nome ?? "",
              x.l.p.lote?.tomador_nome ?? "",
            ]
          : [`NF ${x.f.numero_nf}`, ...x.f.autores.map((a) => a.nome)];
      const texto = [codigo, nome].filter(Boolean).join(" · ");
      return { ...celulaTexto(texto), busca: [texto, ...extra].join(" ") };
    },
  },
  {
    // A busca da coluna acha também pelo CNPJ da nota.
    chave: "cliente",
    rotulo: "Cliente",
    tipo: "texto",
    celula: (x) => {
      const nome = contraparteDaLinha(x);
      const cnpj = x.tipo === "pendente" ? x.l.p.cnpj_tomador : x.f.cnpj_tomador;
      return { ...celulaTexto(nome), busca: `${nome} ${cnpj ? `${formatCnpj(cnpj)} ${cnpj}` : ""}` };
    },
  },
  {
    chave: "valor",
    rotulo: "Valor",
    tipo: "valor",
    faixa: true,
    alinhar: "right",
    celula: (x) => celulaValor(x.tipo === "pendente" ? x.l.valor : x.f.valor_total, formatMoney),
  },
  {
    chave: "jaFaturado",
    rotulo: "Já faturado",
    tipo: "valor",
    faixa: true,
    alinhar: "right",
    celula: (x) => celulaValor(x.tipo === "pendente" ? x.l.jaFaturado : x.f.valor_total, formatMoney),
  },
  {
    // A nota emitida não tem saldo (a célula mostra "—"): vale zero.
    chave: "saldo",
    rotulo: "A faturar",
    tipo: "valor",
    faixa: true,
    alinhar: "right",
    celula: (x) => celulaValor(x.tipo === "pendente" ? x.l.saldo : 0, formatMoney),
  },
  {
    // Decisão 260: "Parcela" (pedido do Tiago, no singular), com o mesmo sentido nas duas
    // linhas — quantas parcelas a nota tem. Antes, "Nota" era a posição da
    // nota no envio (1/2) na linha a faturar e as parcelas (3x, ou 1/1) na
    // emitida. A posição no envio fica na busca e embaixo, na célula.
    chave: "nota",
    rotulo: "Parcela",
    tipo: "texto",
    celula: (x) => {
      if (x.tipo === "faturado") {
        return { ...celulaTexto(`${x.f.qtd_parcelas}x`), ordem: x.f.qtd_parcelas * 100 };
      }
      // Na nota do lote, a posição é a da nota no lote (decisão 188).
      const ordem = x.l.p.lote?.ordem ?? x.l.p.nota_ordem ?? 1;
      const total = x.l.p.lote?.total ?? x.l.p.nota_total ?? 1;
      const n = Math.max(1, x.l.vencimentos);
      return { ...celulaTexto(`${n}x`), ordem: n * 100 + total * 10 + ordem, busca: `${n}x nota ${ordem}/${total}` };
    },
  },
  {
    // O primeiro vencimento — o que a célula mostra em cima.
    chave: "vencimento",
    rotulo: "Vencimento",
    tipo: "data",
    celula: (x) => celulaData(x.tipo === "pendente" ? x.l.primeiroVencimento : x.f.primeiro_vencimento),
  },
  {
    // Decisão 260: quem enviou (ou confirmou o BV); o Novo faturamento é do financeiro.
    chave: "enviadoPor",
    rotulo: "Enviado por",
    tipo: "texto",
    celula: (x) => {
      const nome =
        x.tipo === "pendente"
          ? x.l.p.saldo_do_novo_faturamento
            ? "Financeiro"
            : (x.l.p.autor_nome ?? "—")
          : x.f.pelo_financeiro
            ? "Financeiro"
            : (x.f.autores[0]?.nome ?? "—");
      return celulaTexto(nome);
    },
  },
];

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

interface Props {
  pendentes: FaturamentoPendenteRow[];
  faturados: FaturadoRow[];
  tipos: PlanoContaTipo[];
  subtipos: PlanoContaSubtipo[];
  empresas: Array<{ id: string; nome: string }>;
  clientes: Array<{ id: string; nome: string }>;
  fornecedores: Array<{ id: string; nome: string }>;
  /** Regionais do tenant, para o rateio da nota avulsa (decisão 086). */
  regionais: Array<{ id: string; nome: string; ativo: boolean; empresa_id: string }>;
  proximoNf: string;
  /** PO, instrução do GP e contatos, por job — o conteúdo do botão `i`. */
  infoPorJob: Record<string, InfoJob>;
  /** Contas ativas, para o recebimento antes da NF. */
  contas: ContaBancaria[];
  /** O recebido antes da NF que ainda espera a nota (decisão 130), pela
   *  chave da linha: `nota:<id>` ou `bv:<id>`. */
  recebidosAntes: Record<string, RecebidoAntesDaNf[]>;
  /** Decisão 229: os jobs internacionais, com a moeda e a cotação de compra
   *  da versão. Neles o recebimento antes da NF é o câmbio fechado. */
  cambioPorJob: Record<string, CambioDoJob>;
  /** Módulo fiscal (02/10/2026): o que o Faturar usa do cadastro de
   *  impostos — CNPJ emissor, CNAEs e as sugestões. */
  fiscal: FiscalDoFaturar;
  /** Decisão 184: empresa, regional e cliente de cada job, e os CNPJs de
   *  cada cliente — o Faturar tira deles o que não se escolhe mais. */
  jobs: JobDoFaturar[];
  cnpjsPorCliente: Record<string, CnpjsDoCliente>;
  /** Decisão 247: honorários padrão de cada cliente (o save avulso). */
  honorariosPorCliente: Record<string, number>;
}

/** A chave do recebimento antes da NF desta parcela: a nota ou o BV. */
function chaveAntes(p: FaturamentoPendenteRow): string | null {
  return chaveDoRecebidoAntes(p.envio_nota_id, p.origem_tipo === "bv" ? p.origem_id : null);
}

export function FaturamentoList({
  pendentes,
  faturados,
  tipos,
  subtipos,
  empresas,
  clientes,
  fornecedores,
  regionais,
  proximoNf,
  infoPorJob,
  contas,
  recebidosAntes,
  cambioPorJob,
  fiscal,
  jobs,
  cnpjsPorCliente,
  honorariosPorCliente,
  ultimasRetencoes,
}: Props & { ultimasRetencoes: Record<string, { referencia: string; data: string; aliquotas: Record<string, number> }> }) {
  const router = useRouter();
  const [drawer, setDrawer] = React.useState<DrawerState | null>(null);
  const [modoSelecao, setModoSelecao] = React.useState(false);
  const [sel, setSel] = React.useState<Record<string, boolean>>({});
  const [erroTitulo, setErroTitulo] = React.useState<string | null>(null);
  const [erroDetalhe, setErroDetalhe] = React.useState<string | null>(null);
  const [filtroContraparte, setFiltroContraparte] = React.useState("todos");
  // Combobox de cliente: a barra de chips não escala. Com o cadastro real
  // seriam dezenas de nomes empilhados antes da busca (Tiago, 31/08/2026).
  const [cliBusca, setCliBusca] = React.useState("");
  const [cliAberto, setCliAberto] = React.useState(false);
  // Decisão 260: a situação, em chips com a contagem, como a
  // lista de PPs. Abre no que espera o financeiro: A faturar.
  const [filtroSit, setFiltroSit] = React.useState<FiltroSituacao>("a_faturar");
  const [busca, setBusca] = React.useState("");
  // O aviso do canto. `apuracao` é a segunda linha do aviso da NF emitida
  // (módulo fiscal): em que Apuração os impostos dela entraram.
  const [toast, setToast] = React.useState<{ texto: string; apuracao: string | null } | null>(
    null,
  );
  const [info, setInfo] = React.useState<InfoFaturamento | null>(null);
  // Recebimento antes da NF (decisão 130): o selo da linha abre a lista,
  // pela chave — depois do cancelamento a lista se refaz com o que sobrou.
  // Decisão 256: o registro saiu da fila; é feito na conciliação.
  const [verAntes, setVerAntes] = React.useState<string | null>(null);
  const [erroAntes, setErroAntes] = React.useState<string | null>(null);
  const [pendingAntes, startAntes] = React.useTransition();

  React.useEffect(() => {
    if (!toast) return;
    // Com a segunda linha há mais para ler: o aviso fica mais tempo.
    const t = setTimeout(() => setToast(null), toast.apuracao ? 9000 : 5000);
    return () => clearTimeout(t);
  }, [toast]);

  function limparErro() {
    setErroTitulo(null);
    setErroDetalhe(null);
  }

  // Contagem por contraparte. BV aparece sob o FORNECEDOR, rotulado, porque
  // é dele que a nota cobra.
  const contagemPorNome = React.useMemo(() => {
    const contagem = new Map<string, number>();
    for (const p of pendentes) {
      const nome =
        p.origem_tipo === "bv" ? `${p.contraparte_nome} (fornecedor)` : p.contraparte_nome;
      contagem.set(nome, (contagem.get(nome) ?? 0) + 1);
    }
    for (const f of faturados) {
      contagem.set(f.contraparte_nome, (contagem.get(f.contraparte_nome) ?? 0) + 1);
    }
    return contagem;
  }, [pendentes, faturados]);

  /** Quantos nomes o dropdown mostra antes de mandar refinar pela digitação. */
  const LIMITE_CLIENTES = 5;

  const cliFiltrados = React.useMemo(() => {
    const q = cliBusca.trim().toLowerCase();
    return Array.from(contagemPorNome.keys()).filter(
      (nome) => !q || nome.toLowerCase().includes(q),
    );
  }, [contagemPorNome, cliBusca]);

  const cliOpcoes = [
    {
      chave: "todos",
      rotulo: "Todos os clientes",
      n: pendentes.length + faturados.length,
    },
    ...cliFiltrados.slice(0, LIMITE_CLIENTES).map((nome) => ({
      chave: nome,
      rotulo: nome,
      n: contagemPorNome.get(nome) ?? 0,
    })),
  ];
  const clientesOcultos = Math.max(0, cliFiltrados.length - LIMITE_CLIENTES);

  function rotuloContraparte(p: FaturamentoPendenteRow): string {
    return p.origem_tipo === "bv"
      ? `${p.contraparte_nome} (fornecedor)`
      : p.contraparte_nome;
  }

  /**
   * O conteúdo do botão `i` de uma linha da fila.
   *
   * BV é caso à parte: PO, instrução do GP e contato de cobrança são todos
   * do JOB, e o BV é cobrado do FORNECEDOR. Nenhum se aplica, então o modal
   * mostra o job na referência e explica cada vazio (Tiago, 31/08/2026).
   */
  function infoDaPendente(linha: LinhaDaFila): InfoFaturamento {
    const p = linha.p;
    const referencia =
      `${p.codigo ?? p.descricao} · ${p.contraparte_nome}` +
      (p.mes_referencia ? ` · ${rotuloMes(p.mes_referencia)}` : "") +
      (p.nota_ordem && p.nota_total ? ` · NF ${p.nota_ordem}/${p.nota_total}` : "");
    const saldoProprio = linha.parcelas.reduce((t, x) => t + x.saldo_proprio, 0);
    const saldoSave = linha.parcelas.reduce((t, x) => t + x.saldo_save, 0);
    // A nota do envio em lote (decisão 188): a PO de cada job, os contatos
    // de todos, e a observação do envio.
    if (p.lote) {
      const jobsDaNota = jobsDaLinha(linha);
      const dadosDosJobs = jobsDaNota.map((j) =>
        j.job_id ? (infoPorJob[chaveInfoDoEnvio(j.job_id, j.mes_referencia)] ?? infoPorJob[j.job_id]) : undefined,
      );
      return {
        referencia:
          `Nota ${p.lote.ordem}/${p.lote.total} do lote · ${p.contraparte_nome}` +
          (p.mes_referencia ? ` · ${rotuloMes(p.mes_referencia)}` : ""),
        pos: jobsDaNota.map((j, i) => ({ job: j.codigo ?? "", po: dadosDosJobs[i]?.po ?? null })),
        descricaoNf: p.descritivo_nota,
        anexosPo: dadosDosJobs.flatMap((d) => d?.anexos ?? []),
        cnpj: p.cnpj_tomador,
        cnaeSugerido: p.cnae_sugerido,
        contatos: dedupContatos(dadosDosJobs.flatMap((d) => d?.contatos ?? [])),
        quebra: saldoSave > 0.005 ? { job: saldoProprio, save: saldoSave } : null,
        observacao: p.lote.observacao,
      };
    }
    if (p.origem_tipo === "bv") {
      return {
        referencia,
        pos: [],
        descricaoNf: null,
        contatos: [],
        ehBv: true,
      };
    }
    const dados = p.job_id
      ? (infoPorJob[chaveInfoDoEnvio(p.job_id, p.mes_referencia)] ??
        infoPorJob[p.job_id])
      : undefined;
    return {
      referencia,
      pos: [{ job: p.codigo ?? "", po: dados?.po ?? null }],
      // O descritivo é da NOTA desde a decisão 123; o do envio fica para
      // os envios anteriores.
      descricaoNf: p.descritivo_nota ?? dados?.descricaoNf ?? null,
      anexosPo: dados?.anexos ?? [],
      cnpj: p.cnpj_tomador,
      cnaeSugerido: p.cnae_sugerido,
      contatos: dados?.contatos ?? [],
      quebra: saldoSave > 0.005 ? { job: saldoProprio, save: saldoSave } : null,
    };
  }

  /** O mesmo botão, na linha de uma nota já emitida. */
  function infoDaNota(f: FaturadoRow): InfoFaturamento {
    return {
      referencia: `NF ${f.numero_nf} · ${f.contraparte_nome}`,
      // Uma PO por job coberto: a mesma PO pode valer para vários jobs, e o
      // modal nomeia cada uma quando há mais de um.
      pos: f.jobs_cobertos.map((j) => ({
        job: j.codigo,
        po: infoPorJob[j.job_id]?.po ?? null,
      })),
      // Nota emitida: o que vale é a descrição que SAIU nela, não mais a
      // instrução que o GP mandou no envio.
      descricaoNf: f.descricao,
      anexosPo: f.jobs_cobertos.flatMap((j) => infoPorJob[j.job_id]?.anexos ?? []),
      cnpj: f.cnpj_tomador,
      contatos: dedupContatos(
        f.jobs_cobertos.flatMap((j) => infoPorJob[j.job_id]?.contatos ?? []),
      ),
      ehBv: f.origem_tipo === "bv",
    };
  }

  /** A linha da fila como alvo do recebimento antes da NF. Nula na linha
   *  que não aceita (parcela de envio anterior às notas). */
  function alvoDoRecebido(linha: LinhaDaFila): AlvoDoRecebidoAntes | null {
    const p = linha.p;
    // A nota do lote ainda não aceita: o recebido antes da NF se prende a
    // UMA nota de job, e a do lote é de vários (decisão 188, pendente).
    if (p.lote) return null;
    // Decisão 256: a linha do saldo do Novo faturamento mostra o recebido
    // preso ao job (registrado na conciliação).
    if (p.saldo_do_novo_faturamento) {
      const chaveJob = chaveDoRecebidoDoJob(p.origem_id);
      return {
        chave: chaveJob,
        envioNotaId: null,
        itemBvId: null,
        jobId: p.origem_id,
        titulo: [p.codigo, p.descricao].filter(Boolean).join(" · "),
        contraparte: p.contraparte_nome,
        ehBv: false,
        notaRotulo: "Novo faturamento",
        saldo: linha.saldo,
        recebidos: recebidosAntes[chaveJob] ?? [],
        cambio: null,
      };
    }
    const chave = chaveAntes(p);
    if (!chave) return null;
    const vencimentos = linha.parcelas.length;
    return {
      chave,
      envioNotaId: p.envio_nota_id,
      itemBvId: p.origem_tipo === "bv" ? p.origem_id : null,
      jobId: null,
      titulo:
        [p.codigo, p.descricao].filter(Boolean).join(" · ") +
        (p.mes_referencia ? ` · ${rotuloMes(p.mes_referencia)}` : ""),
      contraparte: p.contraparte_nome,
      ehBv: p.origem_tipo === "bv",
      notaRotulo:
        p.origem_tipo === "bv"
          ? null
          : `NF ${p.nota_ordem ?? 1}/${p.nota_total ?? 1}` +
            (vencimentos > 1 ? ` · ${vencimentos} vencimentos` : ""),
      saldo: linha.saldo,
      recebidos: recebidosAntes[chave] ?? [],
      cambio: p.origem_tipo === "job" && p.job_id ? (cambioPorJob[p.job_id] ?? null) : null,
    };
  }

  const todasAsLinhas = React.useMemo(() => agruparPorNota(pendentes), [pendentes]);

  /** Fecha o formulário e abre o Faturar da linha do envio do job. */
  function faturarPeloEnvio(jobId: string) {
    const linha = todasAsLinhas.find(
      (l) => l.p.origem_tipo === "job" && jobsDaLinha(l).some((x) => x.origem_id === jobId),
    );
    if (!linha) return;
    setDrawer(null);
    setTimeout(() => setDrawer({ modo: "origem", linhas: linha.parcelas }), 0);
  }
  const alvoVerAntes = (() => {
    if (!verAntes) return null;
    const linha = todasAsLinhas.find((l) => chaveAntes(l.p) === verAntes);
    const alvo = linha ? alvoDoRecebido(linha) : null;
    // Cancelado o último, a lista fecha sozinha.
    return alvo && alvo.recebidos.length > 0 ? alvo : null;
  })();
  const totalRecebidoAntes = React.useMemo(
    () => somaDosRecebidos(Object.values(recebidosAntes).flat()),
    [recebidosAntes],
  );

  /** O que o campo mostra quando não está sendo digitado. */
  const rotuloClienteAtivo =
    filtroContraparte === "todos" ? "" : filtroContraparte;

  const q = busca.trim().toLowerCase();

  // Decisão 260: o CNPJ emissor de cada linha. A nota emitida diz por qual
  // saiu; a que falta faturar usa o que o Faturar já traz escolhido (Hitlab
  // com a Hitlab; senão o último usado para o CNPJ do cliente).
  const [cnpjsFiltro, setCnpjsFiltro] = React.useState<string[]>([]);
  const cnpjDaPendente = React.useCallback(
    (p: FaturamentoPendenteRow) =>
      sugestaoDoCnpj(fiscal, {
        cnpj_tomador: p.cnpj_tomador,
        empresa_id: p.empresa_id,
        contraparte_nome: p.contraparte_nome,
      }).estabelecimentoId ?? SEM_CNPJ,
    [fiscal],
  );
  const cnpjDaFaturada = (f: FaturadoRow) => f.estabelecimento_id ?? SEM_CNPJ;
  /** Os CNPJs ativos do cadastro (e os inativos que ainda têm nota), com
   *  quantas linhas cada um tem. */
  const opcoesDeCnpj = React.useMemo(() => {
    const n = new Map<string, number>();
    for (const l of agruparPorNota(pendentes)) {
      const id = cnpjDaPendente(l.p);
      n.set(id, (n.get(id) ?? 0) + 1);
    }
    for (const f of faturados) {
      const id = f.estabelecimento_id ?? SEM_CNPJ;
      n.set(id, (n.get(id) ?? 0) + 1);
    }
    const lista = fiscal.cadastro.estabelecimentos
      .filter((e) => (e.ativo && e.cnpj) || n.has(e.id))
      .sort((a, b) => a.ordem - b.ordem)
      .map((e) => ({ id: e.id, nome: e.nome, cnpj: e.cnpj, n: n.get(e.id) ?? 0 }));
    return lista;
  }, [pendentes, faturados, fiscal, cnpjDaPendente]);
  /** Nada marcado, ou tudo marcado, é "Todos os CNPJs": aí passa também a
   *  linha que ainda não tem CNPJ. */
  const todosOsCnpjs = cnpjsFiltro.length === 0 || cnpjsFiltro.length >= opcoesDeCnpj.length;
  const passaNoCnpj = React.useCallback(
    (id: string) => todosOsCnpjs || cnpjsFiltro.includes(id),
    [todosOsCnpjs, cnpjsFiltro],
  );

  /** A situação da nota inteira (a linha do chip "Faturados") e os pedaços
   *  (as linhas dos outros chips): a página monta, pelos títulos de cada
   *  nota (decisão 260). */
  const situacaoPorNota = React.useMemo(
    () => new Map(faturados.map((f) => [f.faturamento_id, f.recebimento])),
    [faturados],
  );
  const partesPorNota = React.useMemo(
    () => new Map(faturados.map((f) => [f.faturamento_id, f.recebimento.partes])),
    [faturados],
  );
  /** O recebido antes da NF de uma linha a faturar (decisão 130). */
  // A mesma chave de `alvoDoRecebido`: a nota do lote não aceita; o saldo
  // do Novo faturamento usa o recebido preso ao job (decisão 256).
  const recebidoAntesDaLinha = React.useCallback(
    (l: LinhaDaFila) => {
      if (l.p.lote) return 0;
      const chave = l.p.saldo_do_novo_faturamento ? chaveDoRecebidoDoJob(l.p.origem_id) : chaveAntes(l.p);
      return chave ? somaDosRecebidos(recebidosAntes[chave] ?? []) : 0;
    },
    [recebidosAntes],
  );

  /** O número de cada chip. O CNPJ recorta antes da contagem (como a
   *  regional na lista de PPs); a busca, não. "A faturar" conta linhas, não
   *  parcelas: a nota do lote é uma só. */
  const contagemDasSituacoes = React.useMemo(() => {
    const c: Record<FiltroSituacao, number> = { a_faturar: 0, faturados: 0, a_receber: 0, recebidos: 0, inadimplentes: 0, todos: 0 };
    const linhas = agruparPorNota(pendentes.filter((p) => passaNoCnpj(cnpjDaPendente(p))));
    const comRecebido = linhas.filter((l) => recebidoAntesDaLinha(l) > 0.004).length;
    c.a_faturar = linhas.length;
    c.recebidos += comRecebido;
    let pedacos = 0;
    for (const f of faturados) {
      if (!passaNoCnpj(cnpjDaFaturada(f))) continue;
      c.faturados++;
      const partes = partesPorNota.get(f.faturamento_id) ?? [];
      for (const parte of partes) c[FILTRO_DA_PARTE[parte.tipo]]++;
      pedacos += partes.length;
    }
    // "Todos" conta as linhas que mostra: cada pedaço é uma.
    c.todos = linhas.length + comRecebido + pedacos;
    return c;
  }, [pendentes, faturados, passaNoCnpj, cnpjDaPendente, partesPorNota, recebidoAntesDaLinha]);

  const pendentesDoTopo = React.useMemo(
    () =>
      pendentes.filter((p) => {
        if (filtroSit !== "a_faturar" && filtroSit !== "todos" && filtroSit !== "recebidos") return false;
        if (!passaNoCnpj(cnpjDaPendente(p))) return false;
        if (!q) return true;
        return `${p.codigo ?? ""} ${p.descricao} ${p.contraparte_nome}`
          .toLowerCase()
          .includes(q);
      }),
    [pendentes, passaNoCnpj, cnpjDaPendente, filtroSit, q],
  );

  const faturadosDoTopo = React.useMemo(
    () =>
      faturados.filter((f) => {
        if (filtroSit === "a_faturar") return false;
        if (!passaNoCnpj(cnpjDaFaturada(f))) return false;
        if (!q) return true;
        return `${f.numero_nf} ${f.contraparte_nome} ${f.descricao} ${f.itens
          .map((i) => i.codigo)
          .join(" ")}`
          .toLowerCase()
          .includes(q);
      }),
    [faturados, passaNoCnpj, filtroSit, q],
  );

  // Uma linha por nota do envio (decisão 123); o BV segue sozinho.
  const linhasDoTopo = React.useMemo(() => agruparPorNota(pendentesDoTopo), [pendentesDoTopo]);

  /** As notas a faturar e as emitidas numa lista só, depois dos filtros de
   *  CIMA (CNPJ, situação e busca): os filtros dos
   *  títulos vêm depois e valem para as duas. */
  const doTopo = React.useMemo<LinhaDaTabela[]>(() => {
    const out: LinhaDaTabela[] = [];
    for (const l of linhasDoTopo) {
      const recebido = recebidoAntesDaLinha(l) > 0.004;
      if (filtroSit === "a_faturar" || filtroSit === "todos") out.push({ tipo: "pendente", l });
      if (recebido && (filtroSit === "recebidos" || filtroSit === "todos")) out.push({ tipo: "pendente", l, parte: "recebido" });
    }
    for (const f of faturadosDoTopo) {
      if (filtroSit === "faturados") {
        out.push({ tipo: "faturado", f });
        continue;
      }
      for (const parte of partesPorNota.get(f.faturamento_id) ?? []) {
        if (filtroSit === "todos" || FILTRO_DA_PARTE[parte.tipo] === filtroSit) out.push({ tipo: "faturado", f, parte });
      }
    }
    return out;
  }, [linhasDoTopo, faturadosDoTopo, filtroSit, partesPorNota, recebidoAntesDaLinha]);
  const colunas = useFiltrosDeColuna(doTopo, COLUNAS, { guardarEm: "contas-a-receber-faturamento" });
  // Decisão 260: a Planilha Interna do job, pelo ícone da linha (como na lista de PPs).
  const [planilhaDe, setPlanilhaDe] = React.useState<{ jobId: string; codigo: string; nome: string } | null>(null);
  const nomeDaEmpresa = (id: string | null | undefined) => empresas.find((e) => e.id === id)?.nome ?? "—";
  // A separação continua: as notas a faturar em cima, as emitidas (verdes)
  // embaixo. Com ordem pelo título, cada uma das duas vem naquela ordem.
  const linhasVisiveis = React.useMemo(
    () => colunas.visiveis.flatMap((x) => (x.tipo === "pendente" && !x.parte ? [x.l] : [])),
    [colunas.visiveis],
  );
  const faturadosVisiveis = React.useMemo(
    () => colunas.visiveis.flatMap((x) => (x.tipo === "faturado" ? [x.f] : [])),
    [colunas.visiveis],
  );

  // Faturamento Agrupado: a nota que um título tira da lista sai da
  // seleção, como na baixa em lote (`useSelecao`) — a NF agrupada nunca
  // leva uma nota que não está na tela por causa de um filtro escondido no
  // título. As que a busca e o cliente de cima escondem ficam como sempre.
  const escondidasPeloTitulo = React.useMemo(() => {
    const vistas = new Set(linhasVisiveis.map((l) => l.chave));
    return linhasDoTopo.filter((l) => !vistas.has(l.chave)).map((l) => l.chave);
  }, [linhasDoTopo, linhasVisiveis]);
  const chaveDasEscondidas = escondidasPeloTitulo.join("|");
  React.useEffect(() => {
    if (escondidasPeloTitulo.length === 0) return;
    setSel((atual) => {
      if (!escondidasPeloTitulo.some((k) => atual[k])) return atual;
      const proximo = { ...atual };
      for (const k of escondidasPeloTitulo) delete proximo[k];
      return proximo;
    });
    // `chaveDasEscondidas` resume a lista, que é um array novo a cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveDasEscondidas]);

  const selecionados = React.useMemo(
    () => pendentes.filter((p) => sel[chaveLinha(p)]),
    [pendentes, sel],
  );
  // Agrupa pelo id, não pelo nome: o cadastro tem clientes homônimos (dois
  // "teste" em 14/09/2026), e pelo nome os dois passavam como um só e
  // abriam a nota agrupada (decisão 079).
  const clientesSelecionados = React.useMemo(() => {
    const porId = new Map<string, { nome: string; codigos: string[] }>();
    for (const p of selecionados) {
      const chave = p.cliente_id ?? p.fornecedor_id ?? p.contraparte_nome;
      const atual = porId.get(chave) ?? { nome: p.contraparte_nome, codigos: [] };
      if (p.codigo && !atual.codigos.includes(p.codigo)) atual.codigos.push(p.codigo);
      porId.set(chave, atual);
    }
    return Array.from(porId.values());
  }, [selecionados]);
  const misto = clientesSelecionados.length > 1;
  // D4 (decisão 123): uma nota sai para um CNPJ só.
  const cnpjsSelecionados = React.useMemo(
    () =>
      Array.from(
        new Set(
          selecionados
            .map((p) => p.cnpj_tomador)
            .filter((c): c is string => Boolean(c)),
        ),
      ),
    [selecionados],
  );
  const totalSelecionado = selecionados.reduce((s, p) => s + p.saldo, 0);

  // O agrupado junta notas de UM cliente (pedido do Tiago, 15/11/2026): marcada
  // a primeira linha, só as linhas do mesmo cliente continuam disponíveis — em
  // vez de deixar marcar tudo e só acusar o erro no fim.
  const clienteDe = (p: FaturamentoPendenteRow) => p.cliente_id ?? p.fornecedor_id ?? p.contraparte_nome;
  const clienteDaSelecao = selecionados.length > 0 ? clienteDe(selecionados[0]) : null;
  /** Por que a linha não entra no agrupado agora; nulo quando entra. */
  const foraDoAgrupado = (l: LinhaDaFila): string | null => {
    if (l.p.origem_tipo === "bv") return "BV é faturado individualmente";
    if (l.p.saldo_do_novo_faturamento === true) return "O saldo do Novo faturamento sai pelo Novo faturamento";
    if (clienteDaSelecao && clienteDe(l.p) !== clienteDaSelecao)
      return `Outro cliente: o agrupado junta só notas de ${selecionados[0].contraparte_nome}`;
    return null;
  };
  // BV não é agrupável — o checkbox nem aparece habilitado.
  const agrupaveis = linhasVisiveis.filter((l) => foraDoAgrupado(l) === null);
  // "Marcar todos" só quando a lista à vista é de um cliente só (ou já há um
  // cliente na seleção): nunca junta clientes diferentes.
  const clientesAgrupaveis = new Set(agrupaveis.map((l) => clienteDe(l.p)));
  const podeMarcarTodos = agrupaveis.length > 0 && clientesAgrupaveis.size === 1;
  const todosMarcados =
    agrupaveis.length > 0 && agrupaveis.every((l) => sel[l.chave]);

  const totalAFaturar = pendentes.reduce((s, p) => s + p.saldo, 0);

  function alternarLinha(linha: LinhaDaFila) {
    limparErro();
    setSel((atual) => {
      const k = linha.chave;
      const proximo = { ...atual };
      if (proximo[k]) delete proximo[k];
      else proximo[k] = true;
      return proximo;
    });
  }

  function alternarTodos() {
    limparErro();
    if (todosMarcados) {
      setSel({});
      return;
    }
    if (!podeMarcarTodos) return;
    const proximo: Record<string, boolean> = {};
    for (const l of agrupaveis) proximo[l.chave] = true;
    setSel(proximo);
  }

  function faturarSelecionados() {
    limparErro();
    if (selecionados.length === 0) {
      setErroTitulo("Nenhum job selecionado");
      setErroDetalhe("Marque os jobs que devem entrar na mesma nota fiscal.");
      return;
    }
    const bvs = selecionados.filter((p) => p.origem_tipo === "bv");
    if (bvs.length > 0) {
      setErroTitulo("BV não entra em NF agrupada");
      setErroDetalhe(
        `${bvs.map((p) => p.codigo ?? p.descricao).join(", ")} tem o fornecedor como ` +
          "contraparte e precisa ser faturado individualmente.",
      );
      return;
    }
    if (misto) {
      // Homônimos só se distinguem pelos jobs: "teste, teste" não diz nada.
      const rotulos = clientesSelecionados.map((c) =>
        clientesSelecionados.filter((o) => o.nome === c.nome).length > 1 &&
        c.codigos.length > 0
          ? `${c.nome} — ${c.codigos.join(", ")}`
          : c.nome,
      );
      setErroTitulo("Não é possível agrupar jobs de clientes diferentes");
      setErroDetalhe(
        `A seleção tem ${clientesSelecionados.length} clientes ` +
          `(${rotulos.join("; ")}). Uma nota fiscal cobre apenas jobs ` +
          "de um mesmo cliente — desmarque os jobs dos outros clientes para continuar.",
      );
      return;
    }
    if (cnpjsSelecionados.length > 1) {
      setErroTitulo("Não é possível agrupar notas de CNPJs diferentes");
      setErroDetalhe(
        `A seleção tem ${cnpjsSelecionados.length} CNPJs (${cnpjsSelecionados
          .map(formatCnpj)
          .join("; ")}). Uma nota fiscal sai para um CNPJ só — desmarque as ` +
          "notas dos outros CNPJs para continuar.",
      );
      return;
    }
    setDrawer({ modo: "origem", linhas: selecionados });
  }

  /** A linha da nota emitida: a nota inteira (chip "Faturados") ou um
   *  pedaço dela. `junta`: a próxima linha é da mesma nota. */
  const linhaFaturada = (f: FaturadoRow, parte: ParteDaNota | undefined, junta: boolean) => {
              const codigos = [...new Set(f.itens.map((i) => i.codigo))];
              const descricao = [...new Set(f.itens.map((i) => i.descricao.split(" — ")[0]))].join(" + ");
              const jobUnico = f.jobs_cobertos.length === 1 ? f.jobs_cobertos[0] : null;
              const autor = f.autores[0] ?? null;
              return (
                <tr
                  key={`${f.faturamento_id}:${parte?.tipo ?? "nota"}`}
                  onClick={() => {
                    if (modoSelecao) return;
                    setDrawer({ modo: "leitura", nota: f });
                  }}
                  className={cn(
                    "border-b border-border bg-emerald-50/35 transition-colors last:border-0",
                    junta && "border-dashed",
                    modoSelecao ? "opacity-55" : "cursor-pointer hover:bg-emerald-50/70",
                  )}
                >
                  {modoSelecao && (
                    <td className="py-2.5 pl-4">
                      <span
                        title="Faturamento já emitido"
                        className="flex h-[19px] w-[19px] cursor-not-allowed items-center justify-center rounded-md border border-border bg-muted"
                      />
                    </td>
                  )}
                  <td className="px-3 py-2.5">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate font-mono text-xs font-bold text-emerald-700" title={codigos.join(", ")}>
                        {codigos.length > 1 ? `${codigos.length} jobs` : (codigos[0] || "Avulsa")}
                      </span>
                      {/* Sem a coluna Ação (decisão 260), o número da nota mora no selo. */}
                      <span
                        title="Nota emitida: clique na linha para ver o formulário e a NF"
                        className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide text-emerald-700"
                      >
                        NF {f.numero_nf}
                      </span>
                    </span>
                    <TruncateTooltip as="span" className="mt-1 block font-semibold" text={descricao} />
                  </td>
                  <td className="px-3 py-2.5">
                    <TruncateTooltip as="span" className="block text-[12.5px]" text={f.contraparte_nome} />
                    {f.cnpj_tomador && (
                      <span className="mt-0.5 block font-mono text-[11px] text-muted-foreground">{formatCnpj(f.cnpj_tomador)}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-[12.5px] text-muted-foreground">
                    <TruncateTooltip linhas={2} text={nomeDaEmpresa(f.empresa_id)} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                    {formatMoney(f.valor_total)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-muted-foreground/80">
                    {formatMoney(f.valor_total)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right text-muted-foreground">—</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">
                    {f.qtd_parcelas}x
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-muted-foreground">
                    {formatDate(f.primeiro_vencimento)}
                  </td>
                  <td className="px-3 py-2.5" title={f.pelo_financeiro ? "Faturado pelo financeiro, sem envio da produção" : autor ? (autor.bv ? "BV confirmado por" : "Enviado por") : undefined}>
                    {f.pelo_financeiro ? (
                      <>
                        <span className="block text-[13px] font-medium text-foreground">Financeiro</span>
                        <span className="mt-0.5 block text-[12px] text-muted-foreground">Novo faturamento</span>
                      </>
                    ) : autor ? (
                      <>
                        <TruncateTooltip as="span" className="block text-[13px] font-medium text-foreground" text={autor.nome} />
                        <span className="mt-0.5 block whitespace-nowrap text-[12px] text-muted-foreground">
                          {autor.em ? formatDataHoraCurta(autor.em) : ""}
                          {f.autores.length > 1 ? ` · +${f.autores.length - 1}` : ""}
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {(() => {
                      if (parte) {
                        const selo = SELO_DA_PARTE[parte.tipo];
                        return (
                          <span className="flex flex-col items-start gap-1" title={parte.dica}>
                            <span className={cn(BASE_DO_SELO, selo.cor)}>{selo.rotulo}</span>
                            <span className="whitespace-nowrap text-[11.5px] text-muted-foreground">{formatMoney(parte.valor)}</span>
                          </span>
                        );
                      }
                      const sit = situacaoPorNota.get(f.faturamento_id);
                      const selo = sit ? SELO_DA_SITUACAO[sit.situacao] : null;
                      return (
                        <span className="flex flex-col items-start gap-1">
                          {selo && (
                            <span className={cn("whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide", selo.cor)}>
                              {selo.rotulo}
                            </span>
                          )}
                          <span className="whitespace-nowrap text-[11.5px] text-muted-foreground">
                            {sit?.detalhe ?? `Emitida ${formatDate(f.data_emissao)}`}
                          </span>
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-1 py-2.5 text-center">
                    {jobUnico && (
                      <BotaoPlanilha
                        onClick={() =>
                          setPlanilhaDe({ jobId: jobUnico.job_id, codigo: jobUnico.codigo, nome: descricao })
                        }
                      />
                    )}
                  </td>
                  <td className="relative w-0 p-0">
                    <BotaoInfo
                      className="absolute left-3 top-1/2 h-[30px] w-[30px] -translate-y-1/2 shadow-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setInfo(infoDaNota(f));
                      }}
                    />
                  </td>
                </tr>
              );
  };

  return (
    <div className={cn("space-y-4", modoSelecao && "pb-28")}>
      {/* Decisão 260: os chips da situação à esquerda, como na
          lista de PPs; cliente, busca e as ações à direita. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {FILTROS_DE_SITUACAO.map((f) => {
            const ativo = filtroSit === f.chave;
            return (
              <button
                key={f.chave}
                type="button"
                onClick={() => setFiltroSit(f.chave)}
                className={cn(
                  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                  ativo
                    ? "border-california-red bg-california-red text-white"
                    : "border-border bg-white text-muted-foreground hover:border-california-red/50",
                )}
              >
                {f.rotulo}
                <span className={cn("tabular-nums", ativo ? "text-white/85" : "text-muted-foreground/70")}>
                  {contagemDasSituacoes[f.chave]}
                </span>
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2.5">
          {/* Decisão 260: o cliente se filtra pela busca e pelo título da
              coluna; aqui, o CNPJ que emite a nota (comentário do Tiago). */}
          <FiltroDeCnpj opcoes={opcoesDeCnpj} selecionados={cnpjsFiltro} onChange={setCnpjsFiltro} />

          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar job, cliente ou descrição"
              className="w-[250px] rounded-lg border border-border bg-white py-1.5 pl-8 pr-3 text-xs focus:border-california-red/40 focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => {
              if (!modoSelecao && filtroSit !== "a_faturar" && filtroSit !== "todos") setFiltroSit("a_faturar");
              setModoSelecao((v) => !v);
              setSel({});
              limparErro();
            }}
            className={cn(
              "inline-flex items-center gap-2 whitespace-nowrap rounded-lg border px-3.5 py-2 text-xs font-semibold transition-colors",
              modoSelecao
                ? "border-california-red bg-california-red/10 text-california-red"
                : "border-border bg-white text-foreground hover:border-border/80",
            )}
          >
            <Layers className="h-3.5 w-3.5" />
            {modoSelecao ? "Sair do agrupamento" : "Faturamento Agrupado"}
          </button>
          {/* Decisão 265: um formulário só (Job, Save avulso ou Sem job), sem o menu. */}
          <button
            type="button"
            onClick={() => setDrawer({ modo: "avulso" })}
            className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg bg-california-red px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-california-red-hover"
          >
            <Plus className="h-3.5 w-3.5" />
            Faturamento
          </button>
        </div>
      </div>

      {/* Faixa de resumo */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <Hourglass className="h-3.5 w-3.5 text-california-red" />
        <span className="whitespace-nowrap text-xs text-muted-foreground">A faturar</span>
        <span className="font-mono text-sm font-bold tabular-nums">
          {formatMoney(totalAFaturar)}
        </span>
        {totalRecebidoAntes > 0 && (
          <>
            <span className="mx-1 h-5 w-px bg-border" />
            <HandCoins className="h-3.5 w-3.5 text-amber-700" />
            <span className="whitespace-nowrap text-xs text-muted-foreground">
              Recebido antes da NF
            </span>
            <span className="font-mono text-sm font-bold tabular-nums text-amber-800">
              {formatMoney(totalRecebidoAntes)}
            </span>
          </>
        )}
      </div>

      {/* Quantas notas os filtros dos títulos deixaram (o mesmo aviso da aba
          PPs): o filtro mora escondido no título. */}
      {colunas.ativo && (
        <BarraDosFiltrosDeColuna
          visiveis={colunas.visiveis.length}
          total={colunas.total}
          singular="nota"
          plural="notas"
          onLimpar={colunas.limpar}
        />
      )}

      {/* Tabela.
          O botão `i` fica FORA do frame, na calha à direita — mesmo padrão
          do "Gerar PP" da planilha interna, a pedido do Tiago (o protótipo
          o desenhou dentro da tabela nesta aba). A caixa reserva os 46px
          com um `mr-`, e a pílula mora numa célula de largura ZERO: assim
          a calha nunca alarga a tabela (`app/(app)/_planilha/calha.tsx`). */}
      <div className="overflow-x-auto pb-1.5">
      <div className="mr-[46px] box-border min-w-[calc(100%-46px)] rounded-2xl border border-border bg-card shadow-soft">
        {/* Decisão 260: a grade fixa da lista de PPs (decisão 257).
            Linhas de até duas alturas; quem enviou ganhou coluna; Empresa,
            Situação e o ícone da Planilha Interna entraram. */}
        <table className="w-full min-w-[1500px] table-fixed text-[13px]">
          <colgroup>
            {modoSelecao && <col className="w-[38px]" />}
            {/* Job: o código e a origem; embaixo, o nome do financeiro */}
            <col className="w-[300px]" />
            {/* Cliente fica com o que sobra */}
            <col />
            {/* Empresa (gerencial): de onde sai a nota */}
            <col className="w-[108px]" />
            {/* Valor, Já faturado e A faturar: cabem R$ 9.999.999,99 (a produção
                tem job de R$ 4,7 milhões); a linha do câmbio pede 136 px. */}
            <col className="w-[124px]" />
            <col className="w-[124px]" />
            <col className="w-[136px]" />
            {/* Parcela (o título com o funil pede 100 px) */}
            <col className="w-[100px]" />
            {/* Vencimento (o título com o funil pede 116 px) */}
            <col className="w-[116px]" />
            {/* Enviado por */}
            <col className="w-[136px]" />
            {/* Situação */}
            <col className="w-[168px]" />
            {/* Planilha Interna */}
            <col className="w-[40px]" />
            {/* A calha do `i` */}
            <col className="w-0" />
          </colgroup>
          <thead>
            <tr className="border-b border-border bg-muted/30 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              {modoSelecao && (
                <th className="py-2.5 pl-4">
                  <button
                    type="button"
                    onClick={alternarTodos}
                    disabled={!podeMarcarTodos && !todosMarcados}
                    title={
                      podeMarcarTodos || todosMarcados
                        ? `Selecionar todos os visíveis de ${
                            selecionados[0]?.contraparte_nome ?? agrupaveis[0]?.p.contraparte_nome ?? "um cliente"
                          }`
                        : "Marque um job, ou filtre um cliente: o agrupado junta notas de um cliente só"
                    }
                    className={cn(
                      "flex h-[19px] w-[19px] items-center justify-center rounded-md border transition-colors",
                      todosMarcados
                        ? "border-california-red bg-california-red text-white"
                        : podeMarcarTodos
                          ? "border-border bg-white text-transparent"
                          : "cursor-not-allowed border-border bg-muted text-transparent",
                    )}
                  >
                    <Check className="h-3 w-3" />
                  </button>
                </th>
              )}
              <th className="px-3 py-2.5 font-semibold">{colunas.titulo("origem")}</th>
              <th className="px-3 py-2.5 font-semibold">{colunas.titulo("cliente")}</th>
              <th className="px-3 py-2.5 font-semibold">Empresa</th>
              <th className="px-3 py-2.5 text-right font-semibold">{colunas.titulo("valor")}</th>
              <th className="px-3 py-2.5 text-right font-semibold">{colunas.titulo("jaFaturado")}</th>
              <th className="px-3 py-2.5 text-right font-semibold">{colunas.titulo("saldo")}</th>
              <th className="px-3 py-2.5 font-semibold">{colunas.titulo("nota")}</th>
              <th className="px-3 py-2.5 font-semibold">{colunas.titulo("vencimento")}</th>
              <th className="px-3 py-2.5 font-semibold">{colunas.titulo("enviadoPor")}</th>
              <th className="px-3 py-2.5 font-semibold">Situação</th>
              <th className="px-1 py-2.5">
                <span className="sr-only">Planilha Interna</span>
              </th>
              <th className="p-0" />
            </tr>
          </thead>
          <tbody>
            {doTopo.length === 0 && (
              <tr>
                <td colSpan={modoSelecao ? 13 : 12} className="px-4 py-12 text-center text-sm text-muted-foreground">
                  {filtroSit === "a_faturar"
                    ? "Nada aguardando faturamento com esses filtros."
                    : "Nenhuma nota nesta situação com esses filtros."}
                </td>
              </tr>
            )}
            {doTopo.length > 0 && colunas.visiveis.length === 0 && (
              <tr>
                <td colSpan={modoSelecao ? 13 : 12} className="px-4 py-12 text-center text-sm text-muted-foreground">
                  Nenhuma nota com esse filtro.
                </td>
              </tr>
            )}

            {colunas.visiveis.map((x, i) => {
              const proxima = colunas.visiveis[i + 1];
              if (x.tipo !== "pendente") {
                return linhaFaturada(x.f, x.parte, proxima?.tipo === "faturado" && proxima.f.faturamento_id === x.f.faturamento_id);
              }
              const linha = x.l;
              // O recebido antes da NF é uma linha própria, logo abaixo da
              // linha a faturar, em "Recebidos" e em "Todos".
              const parteRecebida = x.parte === "recebido";
              const junta = proxima?.tipo === "pendente" && proxima.l.chave === linha.chave;
              const p = linha.p;
              const k = linha.chave;
              const marcado = !parteRecebida && !!sel[k];
              const saldoNovo = p.saldo_do_novo_faturamento === true;
              const abrirLinha = () =>
                saldoNovo
                  ? setDrawer({ modo: "adicional", jobInicial: p.origem_id, valorInicial: linha.saldo, mesInicial: p.mes_referencia ?? undefined })
                  : setDrawer({ modo: "origem", linhas: linha.parcelas });
              const motivoFora = foraDoAgrupado(linha);
              const agrupavel = motivoFora === null && !parteRecebida;
              const alvoAntes = alvoDoRecebido(linha);
              const recebidoAntes = alvoAntes ? somaDosRecebidos(alvoAntes.recebidos) : 0;
              const jobsDaNota = jobsDaLinha(linha);
              const descricao = p.lote ? jobsDaNota.map((j) => j.descricao).join(" + ") : p.descricao;
              const jobDaLinha = p.lote ? null : (p.job_id ?? (p.origem_tipo === "job" ? p.origem_id : null));
              const variacao = linha.parcelas.reduce((t, x) => t + x.variacao_cambial, 0);
              const parcial = !saldoNovo && linha.jaFaturado > 0.004;
              const quem = saldoNovo
                ? { rotulo: "Novo faturamento", nome: "Financeiro", em: null as string | null }
                : p.autor_nome
                  ? {
                      rotulo: p.origem_tipo === "bv" ? "BV confirmado por" : p.lote ? "Enviado em lote por" : "Enviado por",
                      nome: p.autor_nome,
                      em: p.autor_em,
                    }
                  : null;
              return (
                <tr
                  key={parteRecebida ? `${k}:recebido` : k}
                  onClick={() => {
                    if (modoSelecao) {
                      if (agrupavel) alternarLinha(linha);
                      return;
                    }
                    limparErro();
                    if (parteRecebida && alvoAntes) {
                      setErroAntes(null);
                      setVerAntes(alvoAntes.chave);
                      return;
                    }
                    abrirLinha();
                  }}
                  className={cn(
                    "cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-accent/40",
                    junta && "border-dashed",
                    parteRecebida && "bg-emerald-50/35",
                    marcado && "bg-california-red/[0.05]",
                    modoSelecao && !agrupavel && "cursor-not-allowed opacity-55",
                  )}
                >
                  {modoSelecao && (
                    <td className="py-2.5 pl-4">
                      <button
                        type="button"
                        disabled={!agrupavel}
                        onClick={(e) => {
                          e.stopPropagation();
                          alternarLinha(linha);
                        }}
                        title={agrupavel ? "Incluir nesta NF" : parteRecebida ? "Já recebido: a linha a faturar é a de cima" : (motivoFora ?? "")}
                        className={cn(
                          "flex h-[19px] w-[19px] items-center justify-center rounded-md border transition-colors",
                          marcado
                            ? "border-california-red bg-california-red text-white"
                            : agrupavel
                              ? "border-border bg-white text-transparent"
                              : "cursor-not-allowed border-border bg-muted text-transparent",
                        )}
                      >
                        <Check className="h-3 w-3" />
                      </button>
                    </td>
                  )}
                  {/* Job: o código, a origem e o mês do mensal; embaixo, o nome
                      do job dado pelo financeiro (decisão 243). */}
                  <td className="px-3 py-2.5">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span
                        className="truncate font-mono text-xs font-bold text-california-red"
                        title={p.lote ? jobsDaNota.map((j) => j.codigo).join(", ") : (p.codigo ?? undefined)}
                      >
                        {p.lote ? `${jobsDaNota.length} jobs` : (p.codigo ?? "—")}
                      </span>
                      <span className="shrink-0">
                        <ChipOrigem tipo={p.lote ? "lote" : p.origem_tipo} />
                      </span>
                      {p.mes_referencia && (
                        <span className="shrink-0 whitespace-nowrap text-[11px] font-semibold text-muted-foreground">
                          {mesCurto(p.mes_referencia)}
                        </span>
                      )}
                    </span>
                    <TruncateTooltip as="span" className="mt-1 block font-semibold" text={descricao} />
                  </td>
                  <td className="px-3 py-2.5">
                    <TruncateTooltip as="span" className="block text-[12.5px]" text={p.contraparte_nome} />
                    {p.cnpj_tomador && (
                      <span className="mt-0.5 block font-mono text-[11px] text-muted-foreground">
                        {formatCnpj(p.cnpj_tomador)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-[12.5px] text-muted-foreground">
                    <TruncateTooltip linhas={2} text={nomeDaEmpresa(p.empresa_id)} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                    {formatMoney(linha.valor)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-muted-foreground/80">
                    {formatMoney(linha.jaFaturado)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right">
                    <span
                      className="block font-bold tabular-nums"
                      title={
                        p.lote
                          ? `${jobsDaNota.length} jobs nesta nota`
                          : p.mes_referencia
                            ? "Total do mês"
                            : "Total do job"
                      }
                    >
                      {parteRecebida ? "—" : formatMoney(linha.saldo)}
                    </span>
                    {Math.abs(variacao) >= 0.005 && (
                      <span
                        title={`Variação cambial ${variacao > 0 ? "+" : ""}${formatMoney(variacao)}`}
                        className={cn(
                          "block truncate text-[10.5px] font-semibold",
                          variacao < 0 ? "text-california-red" : "text-emerald-700",
                        )}
                      >
                        câmbio {variacao > 0 ? "+" : ""}
                        {formatMoney(variacao)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">
                    <span className="block">{Math.max(1, linha.vencimentos)}x</span>
                    {(p.lote?.total ?? p.nota_total ?? 1) > 1 && (
                      <span
                        className="block whitespace-nowrap font-sans text-[10.5px]"
                        title={p.lote ? "A posição desta nota no lote" : "A posição desta nota no envio"}
                      >
                        nota {p.lote?.ordem ?? p.nota_ordem ?? 1}/{p.lote?.total ?? p.nota_total ?? 1}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-muted-foreground">
                    <span className="block">{formatDate(linha.primeiroVencimento)}</span>
                    {linha.vencimentos > 1 && (
                      <span className="block font-sans text-[10.5px]">até {formatDate(linha.ultimoVencimento)}</span>
                    )}
                  </td>
                  {/* Quem enviou, como na lista de PPs: o nome e, embaixo, quando. */}
                  <td className="px-3 py-2.5" title={quem ? quem.rotulo : undefined}>
                    {quem ? (
                      <>
                        <TruncateTooltip as="span" className="block text-[13px] font-medium text-foreground" text={quem.nome} />
                        <span className="mt-0.5 block whitespace-nowrap text-[12px] text-muted-foreground">
                          {quem.em ? formatDataHoraCurta(quem.em) : quem.rotulo}
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  {/* O que pede atenção: recebido antes, parcial, saldo do Novo. */}
                  <td className="px-3 py-2.5">
                    {parteRecebida ? (
                      <span className="flex flex-col items-start gap-1" title="Recebido antes da NF">
                        <span className={cn(BASE_DO_SELO, SELO_DA_PARTE.recebido.cor)}>Recebido</span>
                        <span className="whitespace-nowrap text-[11.5px] text-muted-foreground">
                          {formatMoney(recebidoAntes)} antes da NF
                        </span>
                      </span>
                    ) : (
                    <div className="flex flex-col items-start gap-1">
                      {alvoAntes && recebidoAntes > 0 && filtroSit !== "todos" && (
                        <button
                          type="button"
                          title="Ver o recebimento antes da NF"
                          onClick={(e) => {
                            e.stopPropagation();
                            setErroAntes(null);
                            setVerAntes(alvoAntes.chave);
                          }}
                          className="inline-flex max-w-full items-center gap-1 truncate whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800 transition-colors hover:border-amber-400"
                        >
                          <HandCoins className="h-3 w-3 shrink-0" />
                          Recebido {formatMoney(recebidoAntes).replace("R$", "").trim()}
                        </button>
                      )}
                      {saldoNovo && (
                        <span className="whitespace-nowrap rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-700">
                          Saldo do Novo
                        </span>
                      )}
                      {parcial && (
                        <span className="whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">
                          Parcial
                        </span>
                      )}
                      {!(alvoAntes && recebidoAntes > 0 && filtroSit !== "todos") && !saldoNovo && !parcial && (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </div>
                    )}
                  </td>
                  <td className="px-1 py-2.5 text-center">
                    {jobDaLinha && (
                      <BotaoPlanilha
                        onClick={() =>
                          setPlanilhaDe({
                            jobId: jobDaLinha,
                            codigo: p.codigo ?? "",
                            nome: p.descricao,
                          })
                        }
                      />
                    )}
                  </td>
                  <td className="relative w-0 p-0">
                    <BotaoInfo
                      className="absolute left-3 top-1/2 h-[30px] w-[30px] -translate-y-1/2 shadow-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setInfo(infoDaPendente(linha));
                      }}
                    />
                  </td>
                </tr>
              );
            })}

          </tbody>
        </table>
      </div>
      </div>

      {planilhaDe && (
        <PopUpDaPlanilha
          aberto
          onOpenChange={(a) => {
            if (!a) setPlanilhaDe(null);
          }}
          jobId={planilhaDe.jobId}
          codigo={planilhaDe.codigo}
          descricao={planilhaDe.nome}
        />
      )}

      <p className="flex items-start gap-2 text-xs text-muted-foreground text-pretty">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Uma NF agrupada só pode conter jobs de um{" "}
          <strong className="font-semibold text-foreground">mesmo cliente</strong> e de um{" "}
          <strong className="font-semibold text-foreground">mesmo CNPJ</strong>. BVs
          são faturados individualmente porque a contraparte é o fornecedor.
        </span>
      </p>

      {/* Barra do Faturamento Agrupado — fixa no rodapé, no mesmo padrão da
          barra de ações do job (`jobs/[jobId]/barra-acoes-job.tsx`). Vivia
          acima da tabela, onde saía de vista assim que a lista rolava: o
          usuário marcava as linhas de baixo sem enxergar o total nem o
          botão. Aqui ela acompanha a rolagem.

          Precisa ser o último elemento COM ALTURA da lista para o
          `sticky bottom-0` grudar — o drawer e o toast que vêm depois são
          posicionados por cima e não ocupam espaço no fluxo.

          O fundo branco opaco é obrigatório: o tom vermelho de 4% que a
          barra tinha é transparente demais e a tabela apareceria por baixo
          dela ao rolar. A tinta vermelha vem numa camada interna. */}
      {/* A barra do agrupado fica FIXA no rodapé da tela enquanto o modo está
          ligado (pedido do Tiago, 15/11/2026): o "Faturar selecionados" à vista
          em qualquer ponto da lista, e não só no fim dela. Fora da barra lateral
          (76 px) e na largura do conteúdo; a lista ganha folga embaixo. */}
      {modoSelecao &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 md:left-[76px]">
            <div className="pointer-events-auto mx-auto max-w-[1680px] px-5 md:px-8">
              <div
                className="overflow-hidden rounded-t-2xl border border-b-0 border-california-red/35 bg-white/95 shadow-[0_-4px_16px_-8px_rgba(0,0,0,0.12)] backdrop-blur"
              >
          {/* O erro fica ACIMA da linha de ações: numa barra de rodapé quem
              encosta na borda de baixo tem de ser o botão. */}
          {erroTitulo && (
            <div className="flex items-start gap-2.5 border-b border-california-red/30 bg-california-red/[0.09] px-5 py-3 text-xs text-california-red">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div className="flex flex-col gap-0.5">
                <span className="font-bold">{erroTitulo}</span>
                <span className="text-california-red/85">{erroDetalhe}</span>
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3.5 bg-california-red/[0.04] px-5 py-2.5">
            <span className="flex items-center gap-2 whitespace-nowrap text-xs font-semibold">
              <Layers className="h-3.5 w-3.5 text-california-red" />
              Faturamento Agrupado
            </span>
            <div className="h-4 w-px bg-california-red/25" />
            <span className="whitespace-nowrap text-xs text-muted-foreground">
              {new Set(selecionados.map(chaveLinha)).size} selecionado(s)
            </span>
            <span className="whitespace-nowrap font-mono text-sm font-bold tabular-nums">
              {formatMoney(totalSelecionado)}
            </span>
            {clientesSelecionados.length > 0 && (
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold",
                  misto
                    ? "border-red-200 bg-red-50 text-california-red"
                    : "border-border bg-white text-muted-foreground",
                )}
              >
                <Building2 className="h-3 w-3" />
                {misto
                  ? `${clientesSelecionados.length} clientes diferentes`
                  : clientesSelecionados[0].nome}
              </span>
            )}
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setSel({});
                  limparErro();
                }}
                className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
              >
                Limpar
              </button>
              <button
                type="button"
                onClick={faturarSelecionados}
                className={cn(
                  "inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-3.5 py-2 text-xs font-semibold text-white transition-colors",
                  selecionados.length === 0
                    ? "bg-california-red/45"
                    : "bg-california-red hover:bg-california-red-hover",
                )}
              >
                <FileText className="h-3.5 w-3.5" />
                Faturar selecionados
              </button>
            </div>
          </div>
        </div>
      
            </div>
          </div>,
          document.body,
        )}

      {drawer && (
        <FaturarDrawer
          state={drawer}
          onClose={() => setDrawer(null)}
          onEmitida={(msg, apuracao) => {
            setDrawer(null);
            setSel({});
            setModoSelecao(false);
            setToast({ texto: msg, apuracao });
          }}
          tipos={tipos}
          subtipos={subtipos}
          empresas={empresas}
          clientes={clientes}
          fornecedores={fornecedores}
          regionais={regionais}
          infoPorJob={infoPorJob}
          proximoNf={proximoNf}
          recebidosAntes={recebidosAntes}
          fiscal={fiscal}
          jobs={jobs}
          cnpjsPorCliente={cnpjsPorCliente}
          honorariosPorCliente={honorariosPorCliente}
          onFaturarPeloEnvio={faturarPeloEnvio}
          ultimasRetencoes={ultimasRetencoes}
        />
      )}

      <RecebidosAntesNfDialog
        alvo={alvoVerAntes}
        onOpenChange={(aberto) => {
          if (!aberto && !pendingAntes) {
            setVerAntes(null);
            setErroAntes(null);
          }
        }}
        pending={pendingAntes}
        erro={erroAntes}
        onCancelar={(recebido, motivo) => {
          setErroAntes(null);
          startAntes(async () => {
            const res = await cancelarRecebimentoAntesNf({ id: recebido.id, motivo });
            if (!res.ok) {
              setErroAntes(res.message);
              return;
            }
            setToast({
              texto: `Recebimento de ${formatMoney(recebido.valor)} cancelado: o lançamento saiu do extrato.`,
              apuracao: null,
            });
            router.refresh();
          });
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
          className={cn(
            "fixed bottom-6 right-6 z-50 flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-elevated",
            // Com a segunda linha o aviso quebra em linhas, alinhado pelo topo.
            toast.apuracao ? "max-w-[560px] items-start" : "items-center",
          )}
        >
          <FileCheck2
            className={cn("h-4 w-4 shrink-0 text-emerald-700", toast.apuracao && "mt-0.5")}
          />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-emerald-900">{toast.texto}</p>
            {toast.apuracao && (
              <p className="mt-1 text-[13px] leading-snug text-emerald-900">{toast.apuracao}</p>
            )}
          </div>
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

function ChipOrigem({ tipo }: { tipo: "job" | "bv" | "lote" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        tipo === "bv"
          ? "border-violet-200 bg-violet-50 text-violet-700"
          : tipo === "lote"
            ? "border-sky-200 bg-sky-50 text-sky-700"
            : "border-border bg-muted text-muted-foreground",
      )}
    >
      {tipo === "lote" && <Layers className="h-2.5 w-2.5" />}
      {tipo === "bv" ? "BV" : tipo === "lote" ? "Lote" : "Job"}
    </span>
  );
}

/** Decisão 260: os chips de cima, como os da lista de PPs, na ordem que o
 *  Tiago pediu. O que foi recebido em parte vira mais de uma
 *  linha: a parte recebida em "Recebidos", o resto em "A receber" (ou em
 *  "Inadimplentes", se venceu), ou em "A faturar" no recebido antes da NF.
 *  Em "Todos" as linhas da mesma nota (ou do mesmo job) vêm juntas. */
type FiltroSituacao = "a_faturar" | "faturados" | "a_receber" | "recebidos" | "inadimplentes" | "todos";

const FILTROS_DE_SITUACAO: Array<{ chave: FiltroSituacao; rotulo: string }> = [
  { chave: "a_faturar", rotulo: "A faturar" },
  { chave: "faturados", rotulo: "Faturados" },
  { chave: "a_receber", rotulo: "A receber" },
  { chave: "recebidos", rotulo: "Recebidos" },
  { chave: "inadimplentes", rotulo: "Inadimplentes" },
  { chave: "todos", rotulo: "Todos" },
];

const FILTRO_DA_PARTE: Record<ParteDaNota["tipo"], FiltroSituacao> = {
  recebido: "recebidos",
  inadimplente: "inadimplentes",
  a_receber: "a_receber",
};

const BASE_DO_SELO = "whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide";
const SELO_DA_PARTE: Record<ParteDaNota["tipo"], { rotulo: string; cor: string }> = {
  recebido: { rotulo: "Recebido", cor: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  inadimplente: { rotulo: "Inadimplente", cor: "border-red-200 bg-red-50 text-[#b3323c]" },
  a_receber: { rotulo: "A receber", cor: "border-amber-200 bg-[#fffbeb] text-[#92400e]" },
};

/** As cores são as da planilha de títulos (Em aberto, Inadimplente,
 *  Parcial, Recebido). "Recebida em parte" porque o "Parcial" desta lista
 *  já é o da nota faturada em parte. */
const SELO_DA_SITUACAO: Record<SituacaoDaNota, { rotulo: string; cor: string }> = {
  a_receber: { rotulo: "A receber", cor: "border-amber-200 bg-[#fffbeb] text-[#92400e]" },
  inadimplente: { rotulo: "Inadimplente", cor: "border-red-200 bg-red-50 text-[#b3323c]" },
  parcial: { rotulo: "Recebida em parte", cor: "border-sky-200 bg-sky-50 text-sky-700" },
  recebida: { rotulo: "Recebida", cor: "border-emerald-200 bg-emerald-50 text-emerald-700" },
};

/** A marca das linhas sem CNPJ emissor (a faturar sem sugestão; notas de
 *  antes do módulo fiscal). Não vira opção do filtro (Tiago, 16/11/2026: a
 *  nota precisa de CNPJ emissor): essas linhas só aparecem em "Todos". */
const SEM_CNPJ = "__sem_cnpj";

/** Decisão 260 (comentário do Tiago no protótipo): o filtro pelo CNPJ que
 *  emite a nota, no desenho do filtro de regionais da lista de PPs. Vazio =
 *  todos. Vale a cada clique, sem "Aplicar". */
function FiltroDeCnpj({
  opcoes,
  selecionados,
  onChange,
}: {
  opcoes: Array<{ id: string; nome: string; cnpj: string | null; n: number }>;
  selecionados: string[];
  onChange: (ids: string[]) => void;
}) {
  const [aberto, setAberto] = React.useState(false);
  const todos = selecionados.length === 0 || selecionados.length === opcoes.length;
  const rotulo = todos
    ? "Todos os CNPJs"
    : selecionados.length === 1
      ? (opcoes.find((o) => o.id === selecionados[0])?.nome ?? "1 CNPJ")
      : `${selecionados.length} CNPJs`;
  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Filtrar pelo CNPJ emissor"
          className={cn(
            "flex h-[34px] w-[230px] items-center gap-2 rounded-lg border bg-white px-3 text-left transition-colors",
            todos ? "border-border" : "border-california-red/40",
          )}
        >
          <Building2 className="h-3.5 w-3.5 flex-none text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{rotulo}</span>
          <ChevronDown className="h-3.5 w-3.5 flex-none text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[300px] p-2">
        <div className="flex items-center gap-2 border-b border-border pb-2">
          <button
            type="button"
            onClick={() => onChange([])}
            className="flex-1 rounded-md py-1.5 text-xs font-medium transition-colors hover:bg-accent"
          >
            Marcar todos
          </button>
          <button
            type="button"
            onClick={() => onChange([])}
            className="flex-1 rounded-md py-1.5 text-xs font-medium transition-colors hover:bg-accent"
          >
            Limpar
          </button>
        </div>
        <div className="max-h-80 space-y-0.5 overflow-y-auto pt-2">
          {opcoes.map((o) => (
            <label
              key={o.id}
              className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-accent"
            >
              <Checkbox
                checked={selecionados.includes(o.id)}
                onCheckedChange={(estado) =>
                  onChange(estado === true ? [...selecionados, o.id] : selecionados.filter((x) => x !== o.id))
                }
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{o.nome}</span>
                {o.cnpj && (
                  <span className="block font-mono text-[11px] text-muted-foreground">{formatarCnpj(o.cnpj)}</span>
                )}
              </span>
              <span className="font-mono text-[11px] font-semibold tabular-nums text-muted-foreground">{o.n}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

const MESES_CURTOS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
/** "Out/26": o mês do job mensal, embaixo do código. */
function mesCurto(iso: string): string {
  const [a, m] = iso.slice(0, 7).split("-");
  return `${MESES_CURTOS[Number(m) - 1] ?? m}/${a.slice(2)}`;
}

/** O ícone da Planilha Interna do job (o mesmo da lista de PPs). */
function BotaoPlanilha({ onClick }: { onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Ver a Planilha Interna do job"
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
          onKeyDown={(e) => e.stopPropagation()}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Sheet className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent>Ver a Planilha Interna do job</TooltipContent>
    </Tooltip>
  );
}

/** "29/09/2026 01:26", no horário de Brasília (decisão 136). */
function formatDataHoraCurta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const fmt = (o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", ...o }).format(d);
  return `${fmt({ day: "2-digit", month: "2-digit", year: "numeric" })} ${fmt({ hour: "2-digit", minute: "2-digit" })}`;
}
