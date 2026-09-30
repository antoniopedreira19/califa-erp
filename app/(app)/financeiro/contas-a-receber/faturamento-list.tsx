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
 * As notas já emitidas continuam aqui, em verde — clicar em `NF <número>`
 * reabre o mesmo formulário em modo somente leitura.
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
 * Recebimento antes da NF (decisão 130): a linha da nota do envio e a do
 * BV ganham o botão de registrar o que o cliente já pagou, e o selo com o
 * que foi recebido. Na emissão, o recebido vira a parcela 1 da nota.
 */

import * as React from "react";
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
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { cn, formatCnpj } from "@/lib/utils";
import type { ContaBancaria, PlanoContaTipo, PlanoContaSubtipo } from "@/lib/types";
import {
  FaturarDrawer,
  type DrawerState,
  type InfoJob,
} from "./faturar-drawer";
import type { ContatoCobranca } from "@/lib/data/contatos-cobranca";
import {
  BotaoInfo,
  InfoFaturamentoModal,
  type InfoFaturamento,
} from "@/components/financeiro/info-faturamento-modal";
import { rotuloMes } from "@/lib/calculos/meses-trimestre";
import { chaveDoRecebidoAntes, chaveInfoDoEnvio } from "./chave-info";
import {
  RecebidosAntesNfDialog,
  RecebimentoAntesNfDialog,
  somaDosRecebidos,
  type AlvoDoRecebidoAntes,
  type RecebidoAntesDaNf,
} from "./recebimento-antes-nf-dialog";
import {
  cancelarRecebimentoAntesNf,
  registrarRecebimentoAntesNf,
} from "./actions-recebimento-antes-nf";

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
  /** CNPJ do cliente para o qual a nota sai (só dígitos). Nulo em BV. */
  cnpj_tomador: string | null;
  /** CNAE que o GP sugeriu — texto de fundo no Faturar (D3). */
  cnae_sugerido: string | null;
  /** O descritivo que o GP escreveu para esta nota. */
  descritivo_nota: string | null;
}

/**
 * Uma linha da fila: as parcelas (vencimentos) de UMA nota do envio, ou um
 * BV. Os números são a soma das parcelas.
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

/** A chave da linha da fila: a nota do envio junta as parcelas dela. */
function chaveLinha(r: FaturamentoPendenteRow): string {
  if (r.envio_nota_id) return `nota:${r.envio_nota_id}`;
  return r.envio_parcela_id ?? `${r.origem_tipo}:${r.origem_id}`;
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
  for (const l of linhas) l.parcelas.sort((a, b) => a.parcela_numero - b.parcela_numero);
  return linhas;
}

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
}: Props) {
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
  // Tudo / A faturar / Faturados. As duas listas convivem na mesma tabela
  // desde sempre; agora dá para ver uma de cada vez.
  const [filtroFat, setFiltroFat] = React.useState<
    "todos" | "pendentes" | "faturados"
  >("todos");
  const [busca, setBusca] = React.useState("");
  const [toast, setToast] = React.useState<string | null>(null);
  const [info, setInfo] = React.useState<InfoFaturamento | null>(null);
  // Recebimento antes da NF (decisão 130): o registro abre pela linha; o
  // selo abre a lista, pela chave — depois do cancelamento a lista se
  // refaz com o que sobrou.
  const [registrarAntes, setRegistrarAntes] = React.useState<AlvoDoRecebidoAntes | null>(
    null,
  );
  const [verAntes, setVerAntes] = React.useState<string | null>(null);
  const [erroAntes, setErroAntes] = React.useState<string | null>(null);
  const [pendingAntes, startAntes] = React.useTransition();

  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
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
    const chave = chaveAntes(p);
    if (!chave) return null;
    const vencimentos = linha.parcelas.length;
    return {
      chave,
      envioNotaId: p.envio_nota_id,
      itemBvId: p.origem_tipo === "bv" ? p.origem_id : null,
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
    };
  }

  const todasAsLinhas = React.useMemo(() => agruparPorNota(pendentes), [pendentes]);
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

  const visiveis = React.useMemo(
    () =>
      pendentes.filter((p) => {
        if (filtroFat === "faturados") return false;
        if (filtroContraparte !== "todos" && rotuloContraparte(p) !== filtroContraparte) {
          return false;
        }
        if (!q) return true;
        return `${p.codigo ?? ""} ${p.descricao} ${p.contraparte_nome}`
          .toLowerCase()
          .includes(q);
      }),
    [pendentes, filtroContraparte, filtroFat, q],
  );

  const faturadosVisiveis = React.useMemo(
    () =>
      faturados.filter((f) => {
        if (filtroFat === "pendentes") return false;
        if (filtroContraparte !== "todos" && f.contraparte_nome !== filtroContraparte) {
          return false;
        }
        if (!q) return true;
        return `${f.numero_nf} ${f.contraparte_nome} ${f.descricao} ${f.itens
          .map((i) => i.codigo)
          .join(" ")}`
          .toLowerCase()
          .includes(q);
      }),
    [faturados, filtroContraparte, filtroFat, q],
  );

  // Uma linha por nota do envio (decisão 123); o BV segue sozinho.
  const linhasVisiveis = React.useMemo(() => agruparPorNota(visiveis), [visiveis]);

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

  // BV não é agrupável — o checkbox nem aparece habilitado.
  const agrupaveis = linhasVisiveis.filter((l) => l.p.origem_tipo === "job");
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

  return (
    <div className="space-y-4">
      {/* Chips de cliente + busca + ações */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Combobox de cliente. A barra de chips não escala: com o cadastro
              real seriam dezenas de nomes empilhados antes da busca. Mostra
              os 5 primeiros e manda digitar para refinar. */}
          <div className="relative w-[290px]">
            <div
              className={cn(
                "flex h-[34px] items-center gap-2 rounded-lg border bg-white px-3 transition-colors",
                cliAberto || filtroContraparte !== "todos"
                  ? "border-california-red/40"
                  : "border-border",
              )}
            >
              <Building2 className="h-3.5 w-3.5 flex-none text-muted-foreground" />
              <input
                type="text"
                value={cliAberto ? cliBusca : rotuloClienteAtivo}
                onChange={(e) => setCliBusca(e.target.value)}
                onFocus={() => {
                  setCliAberto(true);
                  setCliBusca("");
                }}
                onBlur={() => {
                  // Timeout para o clique na opção acontecer antes do blur
                  // fechar a lista — sem isso a seleção nunca chega.
                  window.setTimeout(() => setCliAberto(false), 120);
                }}
                placeholder="Cliente — digite para filtrar"
                className="min-w-0 flex-1 border-0 bg-transparent text-[12.5px] font-medium outline-none"
              />
              {filtroContraparte !== "todos" && (
                <button
                  type="button"
                  title="Limpar filtro de cliente"
                  onClick={() => {
                    setFiltroContraparte("todos");
                    setCliBusca("");
                  }}
                  className="flex-none text-muted-foreground transition-colors hover:text-california-red"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
              <ChevronDown className="h-3.5 w-3.5 flex-none text-muted-foreground" />
            </div>
            {cliAberto && (
              <div className="absolute left-0 right-0 top-[38px] z-40 overflow-hidden rounded-xl border border-border bg-white shadow-elevated">
                {cliOpcoes.map((c) => (
                  <button
                    key={c.chave}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setFiltroContraparte(c.chave);
                      setCliBusca("");
                      setCliAberto(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2.5 text-left text-[12.5px] font-medium transition-colors hover:bg-muted/60",
                      filtroContraparte === c.chave &&
                        "bg-california-red/[0.07] text-california-red",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{c.rotulo}</span>
                    <span className="font-mono text-[11px] font-semibold tabular-nums text-muted-foreground">
                      {c.n}
                    </span>
                  </button>
                ))}
                {clientesOcultos > 0 && (
                  <div className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
                    + {clientesOcultos} cliente{clientesOcultos > 1 ? "s" : ""} —
                    continue digitando para refinar
                  </div>
                )}
                {cliOpcoes.length === 1 && cliBusca.trim() !== "" && (
                  <div className="px-3 py-3 text-xs text-muted-foreground">
                    Nenhum cliente encontrado.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* O que já saiu em nota continua na mesma tabela, em verde. Este
              filtro é o que permite olhar uma coisa de cada vez. */}
          <div className="flex items-center rounded-lg border border-border bg-muted p-[3px]">
            {(
              [
                { chave: "todos", rotulo: "Tudo" },
                { chave: "pendentes", rotulo: "A faturar" },
                { chave: "faturados", rotulo: "Faturados" },
              ] as const
            ).map((c) => (
              <button
                key={c.chave}
                type="button"
                onClick={() => setFiltroFat(c.chave)}
                className={cn(
                  "whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                  filtroFat === c.chave
                    ? "bg-white text-california-red shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {c.rotulo}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por job, cliente ou descrição"
              className="w-[270px] rounded-lg border border-border bg-white py-1.5 pl-8 pr-3 text-xs focus:border-california-red/40 focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => {
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
          <button
            type="button"
            onClick={() => setDrawer({ modo: "avulso" })}
            className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg bg-california-red px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-california-red-hover"
          >
            <Plus className="h-3.5 w-3.5" />
            Faturamento avulso
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

      {/* Tabela.
          O botão `i` fica FORA do frame, na calha à direita — mesmo padrão
          do "Gerar PP" da planilha interna, a pedido do Tiago (o protótipo
          o desenhou dentro da tabela nesta aba). A caixa reserva os 46px
          com um `mr-`, e a pílula mora numa célula de largura ZERO: assim
          a calha nunca alarga a tabela (`app/(app)/_planilha/calha.tsx`). */}
      <div className="overflow-x-auto pb-1.5">
      <div className="mr-[46px] box-border w-max min-w-[calc(100%-46px)] rounded-2xl border border-border bg-card shadow-soft">
        <table className="w-full min-w-[1120px] text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              {modoSelecao && (
                <th className="w-[38px] py-3 pl-4">
                  <button
                    type="button"
                    onClick={alternarTodos}
                    title="Selecionar todos os visíveis"
                    className={cn(
                      "flex h-[19px] w-[19px] items-center justify-center rounded-md border transition-colors",
                      todosMarcados
                        ? "border-california-red bg-california-red text-white"
                        : "border-border bg-white text-transparent",
                    )}
                  >
                    <Check className="h-3 w-3" />
                  </button>
                </th>
              )}
              <th className="w-[70px] px-4 py-3 font-semibold">Origem</th>
              <th className="min-w-[300px] px-4 py-3 font-semibold">Job / descrição</th>
              <th className="min-w-[150px] px-4 py-3 font-semibold">Cliente</th>
              <th className="px-4 py-3 text-right font-semibold">Valor</th>
              <th className="px-4 py-3 text-right font-semibold">Já faturado</th>
              <th className="px-4 py-3 text-right font-semibold">Saldo a faturar</th>
              <th className="w-[72px] px-3 py-3 font-semibold">Nota</th>
              <th className="w-[110px] px-4 py-3 font-semibold">Vencimento</th>
              <th className="w-[150px] px-4 py-3 text-right font-semibold">Ação</th>
              {/* A calha não é coluna: largura zero, e o botão sai do frame. */}
              <th className="w-0 p-0" />
            </tr>
          </thead>
          <tbody>
            {linhasVisiveis.length === 0 && faturadosVisiveis.length === 0 && (
              <tr>
                <td
                  colSpan={modoSelecao ? 10 : 9}
                  className="px-4 py-12 text-center text-sm text-muted-foreground"
                >
                  Nada aguardando faturamento com esses filtros.
                </td>
              </tr>
            )}

            {linhasVisiveis.map((linha) => {
              const p = linha.p;
              const k = linha.chave;
              const marcado = !!sel[k];
              const agrupavel = p.origem_tipo === "job";
              const alvoAntes = alvoDoRecebido(linha);
              const recebidoAntes = alvoAntes ? somaDosRecebidos(alvoAntes.recebidos) : 0;
              const cabeRecebido = alvoAntes !== null && linha.saldo - recebidoAntes > 0.004;
              return (
                <tr
                  key={k}
                  onClick={() => {
                    // No agrupamento o clique marca a linha; fora dele, abre
                    // o formulário. Espelha o protótipo `clicarLinha`.
                    if (modoSelecao) {
                      if (agrupavel) alternarLinha(linha);
                      return;
                    }
                    limparErro();
                    setDrawer({ modo: "origem", linhas: linha.parcelas });
                  }}
                  className={cn(
                    "cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-accent/40",
                    marcado && "bg-california-red/[0.05]",
                    modoSelecao && !agrupavel && "cursor-not-allowed opacity-55",
                  )}
                >
                  {modoSelecao && (
                    <td className="py-3 pl-4">
                      <button
                        type="button"
                        disabled={!agrupavel}
                        onClick={(e) => {
                          e.stopPropagation();
                          alternarLinha(linha);
                        }}
                        title={
                          agrupavel ? "Incluir nesta NF" : "BV é faturado individualmente"
                        }
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
                  <td className="px-4 py-3">
                    <ChipOrigem tipo={p.origem_tipo} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-semibold">{p.descricao}</span>
                      {p.codigo && (
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {p.codigo}
                        </span>
                      )}
                      {p.mes_referencia && (
                        <span className="text-[11px] font-semibold text-muted-foreground">
                          {rotuloMes(p.mes_referencia)}
                        </span>
                      )}
                      {alvoAntes && recebidoAntes > 0 && (
                        <button
                          type="button"
                          title="Ver o recebimento antes da NF"
                          onClick={(e) => {
                            e.stopPropagation();
                            setErroAntes(null);
                            setVerAntes(alvoAntes.chave);
                          }}
                          className="mt-0.5 inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800 transition-colors hover:border-amber-400"
                        >
                          <HandCoins className="h-3 w-3" />
                          Recebido antes da NF · {formatMoney(recebidoAntes)}
                        </button>
                      )}
                    </div>
                  </td>
                  {/* Só o nome. O contato de cobrança mudou para o botão `i`
                      em 31/08/2026: dentro da célula ele empurrava a linha
                      para três alturas e mostrava só nome e e-mail. */}
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    <div className="flex flex-col gap-0.5">
                      <span>{p.contraparte_nome}</span>
                      {/* O CNPJ para o qual a nota sai (decisão 123): pode
                          não ser o do cadastro do cliente. */}
                      {p.cnpj_tomador && (
                        <span className="font-mono text-[11px]">
                          {formatCnpj(p.cnpj_tomador)}
                        </span>
                      )}
                    </div>
                  </td>
                  {/* A quebra job × save saiu daqui em 31/08/2026 e foi para
                      o botão `i`: disputava espaço com o número que a coluna
                      existe para mostrar (decisão 033). */}
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-muted-foreground">
                    {formatMoney(linha.valor)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-muted-foreground/80">
                    {formatMoney(linha.jaFaturado)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <div className="flex flex-col items-end gap-0.5">
                      <span className="font-bold tabular-nums">
                        {formatMoney(linha.saldo)}
                      </span>
                      <span className="text-[10.5px] text-muted-foreground">
                        {(p.nota_total ?? 1) > 1
                          ? `de ${formatMoney(p.saldo_job)} ${p.mes_referencia ? "no mês" : "no job"}`
                          : p.mes_referencia
                            ? "total do mês"
                            : "total do job"}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-3 font-mono text-xs text-muted-foreground">
                    <div className="flex flex-col gap-0.5">
                      <span>
                        {p.nota_ordem ?? 1}/{p.nota_total ?? 1}
                      </span>
                      {linha.parcelas.length > 1 && (
                        <span className="font-sans text-[10.5px]">
                          {linha.parcelas.length} venc.
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-muted-foreground">
                    <div className="flex flex-col gap-0.5">
                      <span>{formatDate(linha.primeiroVencimento)}</span>
                      {linha.parcelas.length > 1 && (
                        <span className="font-sans text-[10.5px]">
                          até {formatDate(linha.ultimoVencimento)}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {cabeRecebido && !modoSelecao && (
                        <button
                          type="button"
                          title="Registrar recebimento antes da NF"
                          aria-label="Registrar recebimento antes da NF"
                          onClick={(e) => {
                            e.stopPropagation();
                            setErroAntes(null);
                            setRegistrarAntes(alvoAntes);
                          }}
                          className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-md border border-border bg-white text-muted-foreground transition-colors hover:border-amber-400 hover:text-amber-700"
                        >
                          <HandCoins className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          limparErro();
                          setDrawer({ modo: "origem", linhas: linha.parcelas });
                        }}
                        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-white px-2.5 py-1.5 text-[11.5px] font-semibold transition-colors hover:border-california-red hover:text-california-red"
                      >
                        <FileText className="h-3.5 w-3.5" />
                        Faturar
                      </button>
                    </div>
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

            {faturadosVisiveis.map((f) => (
              <tr
                key={f.faturamento_id}
                onClick={() => {
                  // Nota já emitida abre o mesmo formulário em leitura — o
                  // agrupamento não a seleciona, porque só serve para faturar.
                  if (modoSelecao) return;
                  setDrawer({ modo: "leitura", nota: f });
                }}
                className={cn(
                  "border-b border-border bg-emerald-50/35 transition-colors last:border-0",
                  modoSelecao ? "opacity-55" : "cursor-pointer hover:bg-emerald-50/70",
                )}
              >
                {modoSelecao && (
                  <td className="py-3 pl-4">
                    <span
                      title="Faturamento já emitido"
                      className="flex h-[19px] w-[19px] cursor-not-allowed items-center justify-center rounded-md border border-border bg-muted"
                    />
                  </td>
                )}
                <td className="px-4 py-3">
                  <span className="inline-flex items-center whitespace-nowrap rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                    Faturado
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-0.5">
                    {/* Sem repetir, pela mesma razão do código logo abaixo: a
                        NF 900123 tem DOIS itens do mesmo job (faturamento
                        parcial em duas vezes) e saía como "Teste Alterações
                        Job 3 + Teste Alterações Job 3". O item de save tem
                        descrição própria e continua somando — ali o "+" diz
                        algo (31/08/2026). */}
                    <span className="font-semibold">
                      {[
                        ...new Set(
                          f.itens.map((i) => i.descricao.split(" — ")[0]),
                        ),
                      ].join(" + ")}
                    </span>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {/* Sem repetir: a nota com save tem DOIS itens do mesmo
                          job (o próprio e o saldo em save), e listar o
                          código duas vezes lê como erro. */}
                      {[...new Set(f.itens.map((i) => i.codigo))].join(", ")}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {f.contraparte_nome}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-muted-foreground">
                  {formatMoney(f.valor_total)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-muted-foreground/80">
                  {formatMoney(f.valor_total)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right text-muted-foreground">
                  —
                </td>
                <td className="px-3 py-3 font-mono text-xs text-muted-foreground">
                  {f.qtd_parcelas > 1 ? `${f.qtd_parcelas}x` : "1/1"}
                </td>
                <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-muted-foreground">
                  {formatDate(f.primeiro_vencimento)}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    title="Ver formulário e NF anexada"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDrawer({ modo: "leitura", nota: f });
                    }}
                    className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 font-mono text-[11.5px] font-bold text-emerald-700 transition-colors hover:bg-emerald-100"
                  >
                    <FileCheck2 className="h-3.5 w-3.5" />
                    NF {f.numero_nf}
                  </button>
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
            ))}
          </tbody>
        </table>
      </div>
      </div>

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
      {modoSelecao && (
        <div className="sticky bottom-0 z-20 -mx-1 overflow-hidden rounded-t-2xl border border-b-0 border-california-red/35 bg-white/95 shadow-[0_-4px_16px_-8px_rgba(0,0,0,0.12)] backdrop-blur">
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
      )}

      {drawer && (
        <FaturarDrawer
          state={drawer}
          onClose={() => setDrawer(null)}
          onEmitida={(msg) => {
            setDrawer(null);
            setSel({});
            setModoSelecao(false);
            setToast(msg);
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
        />
      )}

      <RecebimentoAntesNfDialog
        alvo={registrarAntes}
        onOpenChange={(aberto) => {
          if (!aberto && !pendingAntes) {
            setRegistrarAntes(null);
            setErroAntes(null);
          }
        }}
        contas={contas}
        tipos={tipos}
        subtipos={subtipos}
        pending={pendingAntes}
        erro={erroAntes}
        onConfirm={(dados) => {
          const alvo = registrarAntes;
          if (!alvo) return;
          setErroAntes(null);
          startAntes(async () => {
            const res = await registrarRecebimentoAntesNf({
              envio_nota_id: alvo.envioNotaId,
              item_bv_id: alvo.itemBvId,
              ...dados,
            });
            if (!res.ok) {
              setErroAntes(res.message);
              return;
            }
            setRegistrarAntes(null);
            setToast(
              `${formatMoney(dados.valor)} recebidos antes da NF em ${alvo.titulo}. ` +
                "Na emissão da nota, o valor entra como a parcela 1, já recebida.",
            );
            router.refresh();
          });
        }}
      />

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
            setToast(
              `Recebimento de ${formatMoney(recebido.valor)} cancelado: o lançamento saiu do extrato.`,
            );
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
          className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-elevated"
        >
          <FileCheck2 className="h-4 w-4 shrink-0 text-emerald-700" />
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

function ChipOrigem({ tipo }: { tipo: "job" | "bv" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        tipo === "bv"
          ? "border-violet-200 bg-violet-50 text-violet-700"
          : "border-border bg-muted text-muted-foreground",
      )}
    >
      {tipo === "bv" ? "BV" : "Job"}
    </span>
  );
}
