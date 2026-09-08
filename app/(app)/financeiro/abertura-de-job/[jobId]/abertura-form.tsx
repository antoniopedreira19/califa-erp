"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarCheck,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Clock,
  CornerUpLeft,
  FileText,
  Folder,
  Info,
  Landmark,
  Lock,
  Pencil,
  Plus,
  Split,
  Table2,
  Trash2,
  TrendingDown,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatCurrency, cn } from "@/lib/utils";
import {
  formatPercentualRateio,
  ordenarCompetencias,
  rateioLabel,
  type JobCompetencia,
  type FotoDaAbertura,
} from "@/lib/types";
import type { ServicoOption } from "@/lib/data/servicos";
import type { JobNaFila, RevisaoDeErrata } from "../dados";
import { formatDataBr, formatPeriodo } from "../formatos";
import {
  curvaFecha,
  dividirEmParcelas,
  ehJanelaDePagamento,
  emCentavos,
  foraDoRateio,
  proximaDataRecebimento,
  proximaDataSugerida,
  somaCurva,
  type CurvaLinha,
} from "../curva";
import {
  abrirJobNoFinanceiro,
  criarProjetoFinanceiro,
  editarRegistroDaAbertura,
} from "../actions";
import { ReprovarDialog } from "../reprovar-dialog";
import {
  HistoricoDaAbertura,
  ResumoDaAberturaAnterior,
} from "./historico-abertura";
import type { ProjetoFinanceiroOpcao } from "@/lib/data/projetos-financeiro";
import type { ContaBancariaOpcao } from "@/lib/data/contas-bancarias";
import { repartirPrevisao } from "@/lib/calculos/previsao-congelada";

interface CategoriaOption {
  id: string;
  nome: string;
}

/**
 * Uma competência do rateio na tela (decisão 055). O percentual é texto
 * pelo mesmo motivo do valor das parcelas: quem digita "33,33" precisa
 * ver "33,33" enquanto digita.
 */
interface LinhaCompetenciaForm {
  trimestre: number;
  ano: number;
  pctTexto: string;
}

function parsePct(texto: string): number {
  const n = Number.parseFloat(texto.replace(",", "."));
  return Number.isNaN(n) ? 0 : n;
}

function pctTexto(n: number): string {
  return (Math.round(n * 100) / 100).toLocaleString("pt-BR", {
    maximumFractionDigits: 2,
  });
}

function chaveComp(c: { trimestre: number; ano: number }): string {
  return `${c.ano}-${c.trimestre}`;
}

/**
 * Reparte 100% igualmente entre as competências, em ordem, com o
 * centésimo de sobra nas primeiras (33,34 · 33,33 · 33,33). É o que
 * "Igualar" faz, e o que incluir ou tirar um trimestre do rateio faz por
 * padrão — quem quer outra proporção ajusta depois.
 */
function igualar(linhas: LinhaCompetenciaForm[]): LinhaCompetenciaForm[] {
  const n = linhas.length;
  if (n === 0) return [];
  const base = Math.floor(10000 / n);
  const sobra = 10000 - base * n;
  return ordenarCompetencias(linhas).map((c, i) => ({
    ...c,
    pctTexto: pctTexto((base + (i < sobra ? 1 : 0)) / 100),
  }));
}

/** O trimestre seguinte a uma competência — "Dividir" começa por ele. */
function proximaCompetencia(c: { trimestre: number; ano: number }) {
  return c.trimestre === 4
    ? { trimestre: 1, ano: c.ano + 1 }
    : { trimestre: c.trimestre + 1, ano: c.ano };
}

function paraFormComp(linhas: JobCompetencia[]): LinhaCompetenciaForm[] {
  return ordenarCompetencias(linhas).map((c) => ({
    trimestre: c.trimestre,
    ano: c.ano,
    pctTexto: pctTexto(c.percentual),
  }));
}

/**
 * Na tela, o valor da parcela é texto: quem digita "1.234,5" precisa ver
 * "1.234,5" enquanto digita. A conversão para número só acontece ao
 * somar e ao enviar.
 */
interface LinhaPrevisaoForm {
  id: string;
  data: string;
  valorTexto: string;
  /**
   * Parcela já consumida por PP emitida (curva) ou nota emitida
   * (recebimento). Data e valor travados: o dinheiro já saiu ou já foi
   * faturado. Só existe na edição de job aberto — na abertura, nada foi
   * consumido ainda.
   */
  congelada?: boolean;
}

/**
 * A mesma tela serve quatro momentos, como no protótipo:
 *
 *   * `abertura` — job na fila, tudo editável, termina em "Abrir job no
 *     financeiro" ou "Reprovar job";
 *   * `leitura`  — job já aberto, aba "Abertura do Job": o registro como
 *     foi confirmado, com o histórico das fotos e o botão "Editar
 *     registro";
 *   * `edicao`   — o mesmo job aberto, destravado para salvar alterações;
 *   * `revisao`  — job devolvido ao mural por uma errata (decisão 059):
 *     nasce EDITÁVEL, igual à abertura, mostra a abertura anterior no
 *     topo e termina em "Registrar revisão de abertura" — que fecha a
 *     revisão e devolve para a fila.
 */
export type ModoAbertura = "abertura" | "leitura" | "edicao" | "revisao";

interface Props {
  job: JobNaFila;
  categorias: CategoriaOption[];
  /** Serviços (categorias_dominio, escopo 'projeto') para o combo. */
  servicos: ServicoOption[];
  /** Projetos do financeiro do mesmo cliente, para o combo. */
  projetos: ProjetoFinanceiroOpcao[];
  /** Contas ativas do tenant, com saldo de hoje. */
  contas: ContaBancariaOpcao[];
  custoPrevisto: number;
  /** Base das parcelas de recebimento — o que a California prevê receber. */
  faturamentoPrevisto: number;
  /** Quanto do orçado deste job é pago com crédito de outro job (save).
   *  Só serve para EXPLICAR um faturamento previsto zerado: sem save, ele
   *  significa "o cliente paga o fornecedor direto"; com save, significa
   *  "o cliente já pagou isto, num job anterior" (decisão 028). */
  saveConsumido?: number;
  /** Quem clicou em "Enviar job para abertura" na tela da versão. */
  enviadoPorNome: string | null;
  curvaInicial: CurvaLinha[];
  recebimentoInicial: CurvaLinha[];
  /**
   * A competência sugerida pelo início do job. É a linha única de 100%
   * com que a abertura começa; no job já aberto vale `competenciasIniciais`.
   */
  trimestreSugerido: number;
  anoSugerido: number;
  /**
   * O rateio gravado (`jobs_competencias`, decisão 055). Só chega no job
   * aberto; vazio ou ausente cai na competência sugerida.
   */
  competenciasIniciais?: JobCompetencia[];
  anos: number[];
  hojeIso: string;
  agoraLabel: string;
  /** Default `abertura` — a fila continua chamando sem passar nada. */
  modo?: ModoAbertura;
  /**
   * Quanto de cada previsão já foi consumido por PP emitida / nota
   * emitida. Só chega no job aberto; congela as parcelas mais próximas
   * (`lib/calculos/previsao-congelada.ts`).
   */
  consumo?: { custo: number; recebimento: number };
  /** Quando e por quem o job foi aberto — o rodapé do modo leitura. */
  abertoEmLabel?: string | null;
  abertoPorNome?: string | null;
  /** As fotos do registro, da abertura à última revisão (decisão 059).
   *  Só chegam no job aberto. */
  fotos?: FotoDaAbertura[];
  /** A errata que devolveu o job ao mural — só no modo `revisao`. */
  revisao?: RevisaoDeErrata | null;
}

function parseMoeda(texto: string): number {
  const limpo = texto
    .replace(/[^\d,.-]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const n = Number.parseFloat(limpo);
  return Number.isNaN(n) ? 0 : n;
}

function formatMoedaTexto(n: number): string {
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPercentual(n: number): string {
  return `${n.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

/**
 * Transforma a previsão guardada nas linhas da tela, repartindo o que já
 * foi consumido.
 *
 * A regra do que congela é a MESMA do servidor
 * (`lib/calculos/previsao-congelada.ts`): o consumo anda em ordem de
 * data, da parcela mais próxima para a mais distante, e a parcela que
 * ele alcança pela metade parte em duas — a fatia congelada e o resto.
 * Sem `consumido` (que é o caso da abertura) nada congela e o resultado
 * é o mapeamento direto.
 */
function paraForm(
  linhas: CurvaLinha[],
  consumido = 0,
): LinhaPrevisaoForm[] {
  if (consumido <= 0) {
    return linhas.map((l) => ({
      id: l.id,
      data: l.data,
      valorTexto: formatMoedaTexto(l.valor),
    }));
  }

  return repartirPrevisao(
    linhas.map((l) => ({ data_prevista: l.data, valor: l.valor })),
    consumido,
  ).map((l, i) => ({
    // A repartição pode partir uma linha em duas, então o id da previsão
    // guardada não serve mais como chave — a posição serve.
    id: `linha-${i}-${l.data_prevista}-${l.congelada ? "c" : "l"}`,
    data: l.data_prevista,
    valorTexto: formatMoedaTexto(l.valor),
    congelada: l.congelada,
  }));
}

export function AberturaForm({
  job,
  categorias,
  servicos,
  projetos,
  contas,
  custoPrevisto,
  faturamentoPrevisto,
  saveConsumido = 0,
  enviadoPorNome,
  curvaInicial,
  recebimentoInicial,
  trimestreSugerido,
  anoSugerido,
  competenciasIniciais,
  anos,
  hojeIso,
  agoraLabel,
  modo = "abertura",
  consumo,
  abertoEmLabel,
  abertoPorNome,
  fotos = [],
  revisao = null,
}: Props) {
  const router = useRouter();

  // Modo leitura só destrava quando alguém clica em "Editar registro".
  // A revisão já nasce destravada: reconferir a abertura depois de uma
  // errata É editar, e pedir um clique a mais para isso era o que deixava
  // o financeiro numa tela de leitura sem saber por quê (decisão 059).
  const [editando, setEditando] = React.useState(false);
  const ehRevisao = modo === "revisao";
  const travado = modo === "leitura" && !editando;
  const ehEdicao =
    modo === "edicao" || ehRevisao || (modo === "leitura" && editando);
  const ultimaFoto = fotos.length > 0 ? fotos[fotos.length - 1] : null;

  const consumoCusto = consumo?.custo ?? 0;
  const consumoReceb = consumo?.recebimento ?? 0;

  // Na abertura o nome vem do job da produção; num job já aberto vem do
  // nome que o financeiro gravou (`dados-abertos` já resolve o fallback).
  const [nome, setNome] = React.useState(job.nome);
  // Chega com a categoria que a produção deu ao job no orçamento — o
  // financeiro confere e pode trocar. Só pré-seleciona o que está na
  // lista: categoria inativada desde o envio deixa o campo vazio, e aí o
  // rodapé pede para escolher, em vez de o servidor recusar no envio.
  const [categoriaId, setCategoriaId] = React.useState(() =>
    job.categoria_id && categorias.some((c) => c.id === job.categoria_id)
      ? job.categoria_id
      : "",
  );
  // Projeto NA VISÃO DO FINANCEIRO. Não é `job.projeto_id` — aquele é o
  // da produção, vem do orçamento e não muda aqui.
  const [projetoId, setProjetoId] = React.useState(
    () => job.projeto_financeiro_id ?? "",
  );
  const [projetoAberto, setProjetoAberto] = React.useState(false);
  const [criandoProjeto, setCriandoProjeto] = React.useState(false);
  const [nomeNovoProjeto, setNomeNovoProjeto] = React.useState("");
  const [criandoPending, setCriandoPending] = React.useState(false);
  /**
   * O combo desce do server component, então o projeto que acabou de ser
   * criado só aparece nele depois do `router.refresh()`. Guardar a linha
   * aqui evita a janela em que o campo mostra "Selecione o projeto"
   * logo depois de criar um.
   */
  const [projetoNovo, setProjetoNovo] =
    React.useState<ProjetoFinanceiroOpcao | null>(null);
  const [contaRecebId, setContaRecebId] = React.useState<string | null>(
    () => job.conta_recebimento_id,
  );
  const [contaPagId, setContaPagId] = React.useState<string | null>(
    () => job.conta_pagamento_id,
  );
  const [dropConta, setDropConta] = React.useState<
    "recebimento" | "pagamento" | null
  >(null);
  // Serviço: chega com o do job (gravado na abertura) ou o do orçamento
  // de origem — `dados.ts` já resolve o fallback. Trocar aqui não altera
  // o orçamento (decisão 055).
  const [servicoId, setServicoId] = React.useState(() =>
    job.servico_id && servicos.some((s) => s.id === job.servico_id)
      ? job.servico_id
      : "",
  );
  // Rateio de competência: de 1 a N linhas somando 100%. A abertura
  // começa com a competência sugerida em 100%; o job aberto, com o que
  // foi gravado.
  const compsIniciais = React.useMemo<LinhaCompetenciaForm[]>(
    () =>
      competenciasIniciais && competenciasIniciais.length > 0
        ? paraFormComp(competenciasIniciais)
        : [{ trimestre: trimestreSugerido, ano: anoSugerido, pctTexto: "100" }],
    [competenciasIniciais, trimestreSugerido, anoSugerido],
  );
  const [comps, setComps] = React.useState<LinhaCompetenciaForm[]>(compsIniciais);
  // O ano das pílulas é CONTEXTO de edição: escolher 2027 e clicar num
  // trimestre inclui 1T/2027 no rateio. Começa no ano da primeira
  // competência.
  const [anoAtivo, setAnoAtivo] = React.useState(compsIniciais[0].ano);
  const [curva, setCurva] = React.useState<LinhaPrevisaoForm[]>(() =>
    paraForm(curvaInicial, consumo?.custo ?? 0),
  );
  const [recebimento, setRecebimento] = React.useState<LinhaPrevisaoForm[]>(
    () => paraForm(recebimentoInicial, consumo?.recebimento ?? 0),
  );
  const [confirmarAberto, setConfirmarAberto] = React.useState(false);
  const [reprovarAberto, setReprovarAberto] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  // ---------- Previsão de custos (curva de desembolso) ----------
  const linhasCurva = curva.map((l) => ({
    data: l.data,
    valor: parseMoeda(l.valorTexto),
  }));
  const somaDaCurva = somaCurva(linhasCurva);
  const curvaBate = curvaFecha(linhasCurva, custoPrevisto);
  const difCurva = emCentavos(somaDaCurva - custoPrevisto);

  // Custo zero é legítimo: job 100% pago direto pelo cliente ao
  // fornecedor (tipos A/D) abre sem curva de desembolso.
  const semDesembolso = custoPrevisto <= 0;
  const curvaDatasOk = curva.every((l) => l.data.length === 10);
  const curvaValoresOk = linhasCurva.every((l) => l.valor > 0);
  const curvaOk =
    semDesembolso ||
    (curva.length > 0 && curvaDatasOk && curvaValoresOk && curvaBate);

  // ---------- Previsão de recebimento ----------
  const linhasReceb = recebimento.map((l) => ({
    data: l.data,
    valor: parseMoeda(l.valorTexto),
  }));
  const somaDoRecebimento = somaCurva(linhasReceb);
  const recebBate = curvaFecha(linhasReceb, faturamentoPrevisto);
  const difReceb = emCentavos(somaDoRecebimento - faturamentoPrevisto);

  // Espelho do custo zero: job sem faturamento previsto (tudo pago
  // direto pelo cliente ao fornecedor) abre sem previsão de entrada.
  const semRecebimento = faturamentoPrevisto <= 0;
  const recebDatasOk = recebimento.every((l) => l.data.length === 10);
  const recebValoresOk = linhasReceb.every((l) => l.valor > 0);
  const recebOk =
    semRecebimento ||
    (recebimento.length > 0 && recebDatasOk && recebValoresOk && recebBate);

  // ---------- Rateio de competência ----------
  const compsOrdenadas = ordenarCompetencias(comps);
  const compsNumericas: JobCompetencia[] = compsOrdenadas.map((c) => ({
    trimestre: c.trimestre,
    ano: c.ano,
    percentual: parsePct(c.pctTexto),
  }));
  const somaRateio =
    Math.round(compsNumericas.reduce((s, c) => s + c.percentual, 0) * 100) /
    100;
  const rateioFecha = Math.abs(somaRateio - 100) <= 0.011;
  const rateioValoresOk = compsNumericas.every((c) => c.percentual > 0);
  const rateioOk = comps.length > 0 && rateioValoresOk && rateioFecha;
  const temRateio = comps.length > 1;
  const chavesRateio = comps.map(chaveComp);

  const servicoOk = servicoId !== "";
  const nomeOk = nome.trim().length >= 2;
  const projetoOk = projetoId !== "";
  const podeAbrir =
    nomeOk &&
    projetoOk &&
    categoriaId !== "" &&
    servicoOk &&
    rateioOk &&
    curvaOk &&
    recebOk;

  const categoriaNome =
    categorias.find((c) => c.id === categoriaId)?.nome ?? "— não informada";
  const servicoNome =
    servicos.find((s) => s.id === servicoId)?.nome ?? "— não informado";
  const competenciaLabel = rateioLabel(compsNumericas);
  // "3T/2026 +1": o resumo curto ao lado do rótulo do campo.
  const competenciaResumo =
    compsOrdenadas.length === 0
      ? "—"
      : `${compsOrdenadas[0].trimestre}T/${compsOrdenadas[0].ano}${
          temRateio ? ` +${compsOrdenadas.length - 1}` : ""
        }`;

  // ---------- Projeto do financeiro ----------
  const projetosVisiveis = React.useMemo(
    () =>
      projetoNovo && !projetos.some((p) => p.id === projetoNovo.id)
        ? [...projetos, projetoNovo].sort((a, b) =>
            a.codigo.localeCompare(b.codigo),
          )
        : projetos,
    [projetos, projetoNovo],
  );
  const projetoSel = projetosVisiveis.find((p) => p.id === projetoId) ?? null;
  const projetoLabel = projetoSel?.nome ?? "Selecione o projeto";
  const projetoCodigo = projetoSel?.codigo ?? "";
  const projetoResumo = projetoSel
    ? `${projetoSel.nome} · ${projetoSel.codigo}`
    : "— não informado";
  // O projeto da produção fica como referência, e é explicitamente outra
  // coisa: mexer aqui não move o job em Orçamentos.
  const projetoDica = `Arrumação do financeiro. Na produção, o job segue em ${job.projeto_codigo ?? "—"}.`;

  // ---------- Contas bancárias ----------
  const contaReceb = contas.find((c) => c.id === contaRecebId) ?? null;
  const contaPag = contas.find((c) => c.id === contaPagId) ?? null;

  // ---------- Parte livre das previsões ----------
  // Distribuir e conferir só valem sobre o saldo: o que PP/nota já
  // consumiu está congelado e não entra na conta.
  const congeladoCurva = emCentavos(
    curva
      .filter((l) => l.congelada)
      .reduce((s, l) => s + parseMoeda(l.valorTexto), 0),
  );
  const congeladoReceb = emCentavos(
    recebimento
      .filter((l) => l.congelada)
      .reduce((s, l) => s + parseMoeda(l.valorTexto), 0),
  );
  const livreCusto = emCentavos(custoPrevisto - congeladoCurva);
  const livreReceb = emCentavos(faturamentoPrevisto - congeladoReceb);
  const temCongelado = congeladoCurva > 0 || congeladoReceb > 0;

  // Margem prevista: o que a California recebe menos o que ela
  // desembolsa. Não entra o que o cliente paga direto ao fornecedor —
  // esse dinheiro nunca passa pelo caixa da agência.
  const margem = emCentavos(faturamentoPrevisto - custoPrevisto);
  const margemPct =
    faturamentoPrevisto > 0 ? (margem / faturamentoPrevisto) * 100 : 0;

  // Contagem das linhas de cada bloco: aparece no rodapé da tabela de
  // previsões e no resumo do registro, na lateral.
  const qtdRecebimentosLabel = semRecebimento
    ? "Sem faturamento"
    : recebimento.length === 1
      ? "1 recebimento"
      : `${recebimento.length} recebimentos`;
  const qtdDatasCustoLabel = semDesembolso
    ? "Sem desembolso"
    : curva.length === 1
      ? "1 data"
      : `${curva.length} datas`;

  const textoValidacao = !nomeOk
    ? "Informe o nome do job."
    : !projetoOk
      ? "Selecione o projeto do job."
      : categoriaId === ""
      ? "Selecione a categoria do job."
      : !servicoOk
        ? "Selecione o serviço do job."
        : !rateioValoresOk
          ? "Cada competência do rateio precisa de um percentual maior que zero."
          : !rateioFecha
            ? "O rateio de competências precisa somar 100%."
      : !semRecebimento && !recebDatasOk
        ? "Preencha a data de todas as parcelas de recebimento."
        : !semRecebimento && !recebValoresOk
          ? "Cada parcela de recebimento precisa de um valor maior que zero."
          : !semRecebimento && !recebBate
            ? "As parcelas de recebimento precisam somar o faturamento previsto."
            : semDesembolso
              ? "Tudo pronto. Este job não tem desembolso previsto pela California — abre sem curva."
              : !curvaDatasOk
                ? "Preencha a data de todas as linhas da curva."
                : !curvaValoresOk
                  ? "Cada data da curva precisa de um valor maior que zero."
                  : !curvaBate
                    ? "A curva precisa somar o custo previsto."
                    : temRateio
                      ? `Tudo pronto: nome, categoria, serviço, competência rateada em ${comps.length} trimestres, recebimento e custos preenchidos.`
                      : "Tudo pronto: nome, categoria, serviço, competência, recebimento e custos preenchidos.";

  function atualizarCurva(id: string, patch: Partial<LinhaPrevisaoForm>) {
    setCurva((atual) =>
      atual.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    );
  }

  function atualizarRecebimento(
    id: string,
    patch: Partial<LinhaPrevisaoForm>,
  ) {
    setRecebimento((atual) =>
      atual.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    );
  }

  /**
   * Distribuir divide só o SALDO entre as linhas livres. As congeladas
   * ficam onde estão: o dinheiro delas já saiu (PP emitida) ou já foi
   * faturado (nota emitida). Sem nada congelado — que é o caso da
   * abertura — o saldo é o total e o comportamento é o de sempre.
   */
  function distribuirEntreLivres(
    linhas: LinhaPrevisaoForm[],
    totalLivre: number,
  ): LinhaPrevisaoForm[] {
    const livres = linhas.filter((l) => !l.congelada);
    const valores = dividirEmParcelas(Math.max(0, totalLivre), livres.length);
    let i = 0;
    return linhas.map((l) =>
      l.congelada
        ? l
        : { ...l, valorTexto: formatMoedaTexto(valores[i++] ?? 0) },
    );
  }

  function distribuirCurva() {
    setCurva((atual) => distribuirEntreLivres(atual, livreCusto));
  }

  function distribuirRecebimento() {
    setRecebimento((atual) => distribuirEntreLivres(atual, livreReceb));
  }

  function adicionarData() {
    setCurva((atual) => [
      ...atual,
      {
        // Date.now() só aqui, como chave de React — nada disso vai ao banco.
        id: `curva-nova-${Date.now()}`,
        data: proximaDataSugerida(
          atual.map((l) => ({ id: l.id, data: l.data, valor: 0 })),
          job.data_inicio_prevista,
          hojeIso,
        ),
        valorTexto: "0,00",
      },
    ]);
  }

  function adicionarParcelaRecebimento() {
    setRecebimento((atual) => [
      ...atual,
      {
        id: `recebimento-novo-${Date.now()}`,
        data: proximaDataRecebimento(
          atual.map((l) => ({ id: l.id, data: l.data, valor: 0 })),
          job.data_prevista_faturamento,
          hojeIso,
        ),
        valorTexto: "0,00",
      },
    ]);
  }

  /**
   * Linha congelada nunca sai, e a última linha livre também não: a
   * previsão precisa de pelo menos um lugar para o saldo pousar. Quando
   * TUDO está congelado (consumo cobriu a previsão inteira) não há linha
   * livre nenhuma, e aí não há o que remover mesmo.
   */
  function podeRemover(linhas: LinhaPrevisaoForm[], id: string): boolean {
    const alvo = linhas.find((l) => l.id === id);
    if (!alvo || alvo.congelada) return false;
    return linhas.filter((l) => !l.congelada).length > 1;
  }

  function removerDaCurva(id: string) {
    if (!podeRemover(curva, id)) return;
    setCurva((atual) => atual.filter((l) => l.id !== id));
  }

  function removerDoRecebimento(id: string) {
    if (!podeRemover(recebimento, id)) return;
    setRecebimento((atual) => atual.filter((l) => l.id !== id));
  }

  /**
   * Cria o projeto do financeiro e já vincula no formulário ("Criar
   * projeto para este job"). O código e o cliente são do servidor — aqui
   * só vai o nome.
   */
  function confirmarNovoProjeto() {
    const nomeLimpo = nomeNovoProjeto.trim();
    if (nomeLimpo.length < 2 || criandoPending) return;

    setErro(null);
    setCriandoPending(true);
    void criarProjetoFinanceiro(job.id, { nome: nomeLimpo }).then((res) => {
      setCriandoPending(false);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      // O combo desce do server component, então a linha nova só aparece
      // nele depois do refresh. Selecionar por id já deixa o formulário
      // válido antes disso.
      setProjetoNovo({
        id: res.id,
        codigo: res.codigo,
        nome: res.nome,
        cliente_id: job.cliente_id ?? "",
        cliente_nome: job.cliente_nome,
      });
      setProjetoId(res.id);
      setCriandoProjeto(false);
      setProjetoAberto(false);
      setNomeNovoProjeto("");
      router.refresh();
    });
  }

  // ---------- Rateio de competência ----------
  /** Clique numa pílula de trimestre: inclui no rateio, ou tira dele. */
  function alternarTrimestre(t: number) {
    const chave = chaveComp({ trimestre: t, ano: anoAtivo });
    if (chavesRateio.includes(chave)) {
      // A última competência não sai: o job precisa de pelo menos uma.
      if (comps.length === 1) return;
      setComps(igualar(comps.filter((c) => chaveComp(c) !== chave)));
    } else {
      setComps(igualar([...comps, { trimestre: t, ano: anoAtivo, pctTexto: "0" }]));
    }
  }

  /** "Dividir em mais de uma competência": entra o trimestre seguinte. */
  function dividirCompetencia() {
    const ultima = compsOrdenadas[compsOrdenadas.length - 1];
    const prox = proximaCompetencia(ultima);
    setComps(igualar([...comps, { ...prox, pctTexto: "0" }]));
    setAnoAtivo(prox.ano);
  }

  function removerCompetencia(chave: string) {
    if (comps.length < 2) return;
    setComps(igualar(comps.filter((c) => chaveComp(c) !== chave)));
  }

  function editarPercentual(chave: string, texto: string) {
    const limpo = texto.replace(/[^0-9.,]/g, "").slice(0, 6);
    setComps(
      comps.map((c) => (chaveComp(c) === chave ? { ...c, pctTexto: limpo } : c)),
    );
  }

  /** Presets do cabeçalho do rateio: 50/50, 60/40, 70/30 ou Igualar. */
  function aplicarPreset(pcts: number[] | null) {
    if (!pcts) {
      setComps(igualar(comps));
      return;
    }
    if (pcts.length !== comps.length) return;
    setComps(
      ordenarCompetencias(comps).map((c, i) => ({
        ...c,
        pctTexto: pctTexto(pcts[i]),
      })),
    );
  }

  /** O que as duas actions recebem — os campos são os mesmos. */
  function montarPayload() {
    return {
      nome_financeiro: nome.trim(),
      projeto_financeiro_id: projetoId,
      conta_recebimento_id: contaRecebId,
      conta_pagamento_id: contaPagId,
      categoria_id: categoriaId,
      servico_id: servicoId,
      competencias: compsNumericas,
      curva: semDesembolso
        ? []
        : linhasCurva.map((l) => ({
            data_prevista: l.data,
            valor: l.valor,
          })),
      recebimento: semRecebimento
        ? []
        : linhasReceb.map((l) => ({
            data_prevista: l.data,
            valor: l.valor,
          })),
    };
  }

  function confirmarAbertura() {
    setErro(null);
    startTransition(async () => {
      const res = await abrirJobNoFinanceiro(job.id, montarPayload());

      if (!res.ok) {
        setErro(res.message);
        setConfirmarAberto(false);
        return;
      }

      setConfirmarAberto(false);
      // Volta para a fila de abertura, e nao para o detalhe do job: quem
      // abre job costuma abrir varios em sequencia, e cair no modulo Jobs
      // obrigava a refazer o caminho de volta a cada um. O `?aba=` e o
      // mesmo destino que o "Reprovar job" ja usa (decisao do Tiago,
      // 04/09/2026).
      router.push("/financeiro/abertura-de-job?aba=aguardando");
      router.refresh();
    });
  }

  /**
   * Salvar a edição de um job já aberto. Sem modal de confirmação: o job
   * já existe, nada nasce daqui, e o aviso do que a edição reescreve já
   * está na faixa vermelha no topo do formulário.
   */
  function salvarEdicao() {
    setErro(null);
    startTransition(async () => {
      const res = await editarRegistroDaAbertura(job.id, montarPayload());

      if (!res.ok) {
        setErro(res.message);
        return;
      }

      setEditando(false);
      router.refresh();
    });
  }

  /**
   * "Registrar revisão de abertura" — a mesma gravação da edição, mas o
   * destino é a fila, como na abertura: quem revisa costuma ter mais de
   * um job no mural, e a revisão fecha o ciclo da errata (decisão 059).
   */
  function confirmarRevisao() {
    setErro(null);
    startTransition(async () => {
      const res = await editarRegistroDaAbertura(job.id, montarPayload());

      if (!res.ok) {
        setErro(res.message);
        setConfirmarAberto(false);
        return;
      }

      setConfirmarAberto(false);
      router.push("/financeiro/abertura-de-job?aba=aguardando");
      router.refresh();
    });
  }

  /** Desfaz a edição voltando tudo ao que veio do servidor. */
  function cancelarEdicao() {
    setErro(null);
    setNome(job.nome);
    setProjetoId(job.projeto_financeiro_id ?? "");
    setContaRecebId(job.conta_recebimento_id);
    setContaPagId(job.conta_pagamento_id);
    setCategoriaId(
      job.categoria_id && categorias.some((c) => c.id === job.categoria_id)
        ? job.categoria_id
        : "",
    );
    setServicoId(
      job.servico_id && servicos.some((s) => s.id === job.servico_id)
        ? job.servico_id
        : "",
    );
    setComps(compsIniciais);
    setAnoAtivo(compsIniciais[0].ano);
    setCurva(paraForm(curvaInicial, consumoCusto));
    setRecebimento(paraForm(recebimentoInicial, consumoReceb));
    setCriandoProjeto(false);
    setProjetoAberto(false);
    setDropConta(null);
    setEditando(false);
  }

  const dadosProducao: { rotulo: string; valor: string; mono?: boolean }[] = [
    { rotulo: "Job", valor: job.nome },
    { rotulo: "Código", valor: job.codigo, mono: true },
    {
      rotulo: "Projeto",
      valor:
        [job.projeto_nome, job.projeto_codigo].filter(Boolean).join(" · ") ||
        "—",
    },
    { rotulo: "Cliente", valor: job.cliente_nome ?? "—" },
    { rotulo: "Marca", valor: job.produto ?? "—" },
    // A que veio do orçamento — fixa. O que o financeiro escolher no
    // campo ao lado aparece no "Resumo do registro", não aqui: este
    // painel é o que a produção mandou.
    { rotulo: "Categoria", valor: job.categoria_nome ?? "— não informada" },
    // Idem: o serviço que veio do orçamento. O que o financeiro escolher
    // no campo Serviço aparece no "Resumo do registro".
    { rotulo: "Serviço", valor: job.servico_producao_nome ?? "— não informado" },
    {
      rotulo: "Cidade · Regional",
      valor: [job.cidade, job.regional_nome].filter(Boolean).join(" · ") || "—",
    },
    { rotulo: "GP Responsável", valor: job.responsavel_nome ?? "—" },
    { rotulo: "Produtor Responsável", valor: job.produtor_nome ?? "—" },
    {
      rotulo: "Início · fim",
      valor: formatPeriodo(job.data_inicio_prevista, job.data_fim_prevista),
      mono: true,
    },
    {
      // Mesma regra do diálogo de conferência: a data é de
      // recebimento, não de faturamento (27/08/2026).
      rotulo: "Recebimento em",
      valor: formatDataBr(job.data_prevista_faturamento),
      mono: true,
    },
  ];

  const resumoPlanilha =
    job.planilha_itens > 0
      ? `${job.planilha_grupos} ${job.planilha_grupos === 1 ? "agrupamento" : "agrupamentos"} · ${job.planilha_itens} ${job.planilha_itens === 1 ? "item" : "itens"} · orçado ${formatCurrency(job.planilha_orcado)}`
      : "Planilha interna sem itens.";

  return (
    <div className="flex flex-col gap-5 pb-6">
      {/* ---------- Cabeçalho ---------- */}
      {/* Job já aberto, registro travado: a faixa conta quando e por quem
          a abertura foi confirmada, e é dela que sai o "Editar registro". */}
      {/* A faixa virou o histórico (decisão 059): a abertura e cada
          revisão ou edição depois dela, cada uma com o seu "Visualizar".
          O "Editar registro" continua morando aqui. */}
      {travado && (
        <HistoricoDaAbertura fotos={fotos} onEditar={() => setEditando(true)} />
      )}

      {/* Revisando depois de uma errata: a errata e a abertura anterior
          no topo, com a foto inteira a um clique — é olhando para ela que
          se reconfere o resto (decisão 059). */}
      {ehRevisao && (
        <ResumoDaAberturaAnterior foto={ultimaFoto} revisao={revisao} />
      )}

      {/* Editando um job já aberto: o aviso do que está em jogo. O que
          esta edição NÃO toca (data e usuário da abertura) está dito de
          propósito — é a dúvida que aparece na hora de salvar. */}
      {modo !== "abertura" && ehEdicao && !ehRevisao && (
        <div className="flex flex-wrap items-center gap-2.5 rounded-2xl border border-california-red/30 bg-california-red/[0.04] px-[18px] py-3">
          <Pencil className="h-3.5 w-3.5 text-california-red" />
          <span className="text-[12.5px] font-semibold">
            Editando o registro da abertura
          </span>
          <span className="text-[12.5px] text-muted-foreground">
            salvar reescreve serviço, categoria, projeto e competência — a
            data e o usuário da abertura não mudam
          </span>
        </div>
      )}

      {/* O cabeçalho grande é só da fila. Dentro da aba do job aberto a
          página já tem o próprio (código, nome e situação), e repetir
          "Abrir job no financeiro" num job que já está aberto seria
          simplesmente falso. */}
      {modo === "abertura" && (
        <div>
          <Link
            href="/financeiro/abertura-de-job?aba=aguardando"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" />
            Voltar para a fila de abertura
          </Link>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <div className="rounded-lg bg-california-red/10 p-2">
              <Landmark className="h-5 w-5 text-california-red" />
            </div>
            <h1 className="text-[26px] font-bold tracking-tight">
              Abrir job no financeiro
            </h1>
            <span className="rounded-md border border-border bg-muted px-2.5 py-1 font-mono text-[12.5px] font-bold">
              {job.codigo}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-2.5 py-[3px] text-[10.5px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
              <ClipboardCheck className="h-3 w-3" />
              Em conferência
            </span>
          </div>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Confira os dados da produção ao lado — e a planilha interna do job
            — e complete o registro financeiro: nome, projeto, categoria,
            serviço, competência e as previsões de recebimento e de custos.
          </p>
        </div>
      )}

      {erro && (
        <div className="flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{erro}</span>
        </div>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* ---------- Coluna principal ---------- */}
        <div className="flex min-w-0 flex-col gap-5">
          {/* Registro no financeiro */}
          <section className="rounded-2xl border border-border bg-card shadow-soft">
            <header className="flex items-center gap-2.5 rounded-t-2xl border-b border-border bg-muted/50 px-5 py-3.5">
              <FileText className="h-4 w-4 text-california-red" />
              <h2 className="text-[15px] font-semibold">
                Registro no financeiro
              </h2>
            </header>

            <div className="grid gap-4 p-5 md:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="nome-financeiro"
                  className="text-[12.5px] font-semibold"
                >
                  Nome do job <span className="text-california-red">*</span>
                </label>
                <input
                  id="nome-financeiro"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  readOnly={travado}
                  maxLength={200}
                  className={cn(
                    "h-[42px] rounded-lg border border-border bg-white px-3.5 text-[13.5px] font-medium outline-none focus:border-california-red/40",
                    travado && "bg-muted/60 text-muted-foreground",
                  )}
                />
                <span className="text-[11px] text-muted-foreground">
                  {travado ? "Este nome" : "Editável. Este nome"} vale no
                  financeiro — a produção continua vendo o nome que ela
                  cadastrou.
                </span>
              </div>

              {/* Projeto na visão do financeiro. Trocar aqui NÃO move o job
                  em Orçamentos: `jobs.projeto_id` continua sendo o da
                  produção (migration 20260820000011). */}
              <div className="flex flex-col gap-1.5">
                <span className="text-[12.5px] font-semibold">
                  Projeto <span className="text-california-red">*</span>
                </span>
                <div className="flex items-center gap-2">
                  <Popover
                    open={projetoAberto}
                    onOpenChange={(o) => !travado && setProjetoAberto(o)}
                  >
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        disabled={travado}
                        className={cn(
                          "flex h-[42px] min-w-0 flex-1 items-center gap-2.5 rounded-lg border border-border bg-white px-3 text-left outline-none transition-colors",
                          !travado && "hover:border-[#d7d7d7]",
                          travado && "bg-muted/60",
                        )}
                      >
                        <Folder className="h-[15px] w-[15px] shrink-0 text-[#8a8a8a]" />
                        <span className="flex min-w-0 flex-1 items-baseline gap-2">
                          <span
                            className={cn(
                              "truncate text-[13.5px] font-semibold",
                              !projetoSel && "text-muted-foreground",
                            )}
                          >
                            {projetoLabel}
                          </span>
                          <span className="shrink-0 font-mono text-[11.5px] text-muted-foreground">
                            {projetoCodigo}
                          </span>
                        </span>
                        {!travado && (
                          <ChevronDown className="h-[15px] w-[15px] shrink-0 text-[#8a8a8a]" />
                        )}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[320px] p-1.5" align="start">
                      <p className="px-2.5 pb-2 pt-1.5 text-[10px] font-bold uppercase tracking-[0.09em] text-[#8a8a8a]">
                        Projetos abertos
                      </p>
                      {projetosVisiveis.length === 0 ? (
                        <p className="px-2.5 pb-2 text-[12px] text-muted-foreground">
                          Nenhum projeto do financeiro para este cliente. Crie
                          um no botão ao lado.
                        </p>
                      ) : (
                        projetosVisiveis.map((pr) => (
                          <button
                            key={pr.id}
                            type="button"
                            onClick={() => {
                              setProjetoId(pr.id);
                              setProjetoAberto(false);
                            }}
                            className={cn(
                              "block w-full rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-muted",
                              pr.id === projetoId &&
                                "bg-california-red/[0.06] text-california-red",
                            )}
                          >
                            <span className="flex items-baseline justify-between gap-3">
                              <span className="truncate font-semibold">
                                {pr.nome}
                              </span>
                              <span className="shrink-0 font-mono text-[11px] text-[#8a8a8a]">
                                {pr.codigo}
                              </span>
                            </span>
                            <span className="mt-0.5 block text-[11px] text-muted-foreground">
                              {pr.cliente_nome ?? "—"}
                            </span>
                          </button>
                        ))
                      )}
                    </PopoverContent>
                  </Popover>

                  {!travado && (
                    <Popover
                      open={criandoProjeto}
                      onOpenChange={setCriandoProjeto}
                    >
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          title="Criar projeto para este job"
                          aria-label="Criar projeto para este job"
                          className="inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-lg border border-border bg-white text-muted-foreground transition-colors hover:border-california-red hover:text-california-red"
                        >
                          <Plus className="h-[17px] w-[17px]" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        className="w-[420px] border-california-red/30 p-4"
                        align="end"
                      >
                        <p className="text-[12.5px] font-semibold">
                          Criar projeto para este job
                        </p>
                        <div className="mt-2.5 flex flex-wrap items-center gap-2">
                          <input
                            value={nomeNovoProjeto}
                            onChange={(e) => setNomeNovoProjeto(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                confirmarNovoProjeto();
                              }
                            }}
                            placeholder="Nome do novo projeto"
                            maxLength={200}
                            className="h-9 min-w-[180px] flex-1 rounded-lg border border-border bg-white px-3 text-[13px] font-medium outline-none focus:border-california-red/40"
                          />
                          <button
                            type="button"
                            onClick={confirmarNovoProjeto}
                            disabled={
                              nomeNovoProjeto.trim().length < 2 || criandoPending
                            }
                            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-california-red px-3 text-[12.5px] font-bold text-white transition-colors hover:bg-california-red-hover disabled:cursor-not-allowed disabled:opacity-45"
                          >
                            <Check className="h-3.5 w-3.5" />
                            {criandoPending ? "Criando..." : "Criar e vincular"}
                          </button>
                        </div>
                        <p className="mt-2.5 text-[11px] leading-relaxed text-muted-foreground">
                          O código é gerado pelo sistema e o cliente vem do
                          orçamento de origem. O projeto vale só no financeiro —
                          a produção continua vendo o job em{" "}
                          <span className="font-mono">
                            {job.projeto_codigo ?? "—"}
                          </span>
                          .
                        </p>
                      </PopoverContent>
                    </Popover>
                  )}
                </div>
                <span className="text-[11px] text-muted-foreground">
                  {projetoDica}
                </span>
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="categoria-job"
                  className="text-[12.5px] font-semibold"
                >
                  Categoria do job{" "}
                  <span className="text-california-red">*</span>
                </label>
                <Select
                  value={categoriaId}
                  onValueChange={setCategoriaId}
                  disabled={travado}
                >
                  <SelectTrigger id="categoria-job" className="h-[42px]">
                    <SelectValue placeholder="Selecione a categoria" />
                  </SelectTrigger>
                  <SelectContent>
                    {categorias.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-[11px] text-muted-foreground">
                  Vem do orçamento{" "}
                  <span className="font-mono">{job.orcamento_codigo ?? "—"}</span>
                  . Pode ser trocada aqui sem alterar o orçamento.
                </span>
                {categorias.length === 0 && (
                  <span className="text-[11px] text-california-red">
                    Nenhuma categoria de orçamento cadastrada. Cadastre em
                    Cadastros › Categorias.
                  </span>
                )}
              </div>

              {/* Serviço do job (decisão 055): pré-preenchido pelo orçamento
                  de origem, trocável aqui sem alterar o orçamento — o mesmo
                  contrato da categoria ao lado. */}
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="servico-job"
                  className="text-[12.5px] font-semibold"
                >
                  Serviço <span className="text-california-red">*</span>
                </label>
                <Select
                  value={servicoId}
                  onValueChange={setServicoId}
                  disabled={travado}
                >
                  <SelectTrigger
                    id="servico-job"
                    className={cn(
                      "h-[42px]",
                      !servicoOk && !travado && "border-california-red/45",
                    )}
                  >
                    <SelectValue placeholder="Selecione o serviço" />
                  </SelectTrigger>
                  <SelectContent>
                    {servicos.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-[11px] text-muted-foreground">
                  {servicoOk ? (
                    <>
                      Vem do orçamento{" "}
                      <span className="font-mono">
                        {job.orcamento_codigo ?? "—"}
                      </span>
                      . Pode ser trocado aqui sem alterar o orçamento.
                    </>
                  ) : (
                    "Obrigatório. Vem do orçamento — troque aqui sem alterar o orçamento."
                  )}
                </span>
                {servicos.length === 0 && (
                  <span className="text-[11px] text-california-red">
                    Nenhum serviço cadastrado. Cadastre em Cadastros ›
                    Categorias.
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/60 px-4 py-3">
                <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="text-[12.5px] font-semibold">
                    {modo === "abertura"
                      ? "Data de abertura · registrada automaticamente"
                      : "Data de abertura · registrada"}
                  </p>
                  <p className="text-[11.5px] text-muted-foreground">
                    {modo === "abertura"
                      ? "Gravada no momento da confirmação, junto do usuário responsável — não é editável."
                      : `Gravada na confirmação${abertoPorNome ? `, por ${abertoPorNome}` : ""}. Editar o registro não muda esta data.`}
                  </p>
                </div>
                {/* No job já aberto o que vale é a data GRAVADA. Mostrar o
                    relógio de agora aqui faria a tela afirmar que o job
                    foi aberto neste instante, toda vez que alguém abrisse
                    a aba. */}
                <span className="ml-auto whitespace-nowrap text-right font-mono text-[12.5px] font-semibold">
                  {modo === "abertura" ? agoraLabel : (abertoEmLabel ?? "—")}
                </span>
              </div>

              {/* Competência: de 1 a N trimestres (decisão 055). As pílulas
                  de trimestre são multi-seleção dentro do ano ativo; o ano
                  é contexto de edição — escolher 2027 e clicar num
                  trimestre inclui 1T/2027 no rateio. */}
              <div className="flex flex-col gap-[7px]">
                <div className="flex items-baseline gap-2">
                  <span className="text-[12.5px] font-semibold">
                    Competência <span className="text-california-red">*</span>
                  </span>
                  <span className="ml-auto font-mono text-[11px] font-semibold text-muted-foreground">
                    {competenciaResumo}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div
                    className={cn(
                      "inline-flex gap-0.5 rounded-lg bg-[#f1f0ec] p-[3px]",
                      travado && "opacity-85",
                    )}
                  >
                    {[1, 2, 3, 4].map((t) => {
                      const ligado = chavesRateio.includes(
                        chaveComp({ trimestre: t, ano: anoAtivo }),
                      );
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() => alternarTrimestre(t)}
                          disabled={travado}
                          aria-pressed={ligado}
                          className={cn(
                            "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                            ligado
                              ? "bg-white text-foreground shadow-sm"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {t}T
                        </button>
                      );
                    })}
                  </div>
                  <div
                    className={cn(
                      "inline-flex gap-0.5 rounded-lg bg-[#f1f0ec] p-[3px]",
                      travado && "opacity-85",
                    )}
                  >
                    {anos.map((a) => (
                      <button
                        key={a}
                        type="button"
                        onClick={() => setAnoAtivo(a)}
                        disabled={travado}
                        aria-pressed={anoAtivo === a}
                        className={cn(
                          "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                          anoAtivo === a
                            ? "bg-white text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {a}
                      </button>
                    ))}
                  </div>
                </div>
                <span className="text-[11px] text-muted-foreground [text-wrap:pretty]">
                  {travado
                    ? temRateio
                      ? `Job rateado em ${comps.length} competências, como foi registrado na abertura.`
                      : "Registrada na abertura. É o que vai para o registro contábil."
                    : temRateio
                      ? `Clique num trimestre para incluir ou tirar do rateio; troque o ano para alcançar ${anos[anos.length - 1]}.`
                      : `Sugerida pelo início do job (${formatDataBr(job.data_inicio_prevista)}). Clique em outro trimestre para ratear o job.`}
                </span>
                {!travado && !temRateio && (
                  <button
                    type="button"
                    onClick={dividirCompetencia}
                    className="inline-flex items-center gap-1.5 self-start rounded-lg border border-dashed border-[#d7d7d7] bg-white px-[11px] py-1.5 text-[11.5px] font-semibold text-muted-foreground transition-colors hover:border-california-red hover:text-california-red"
                  >
                    <Split className="h-[13px] w-[13px]" />
                    Dividir em mais de uma competência
                  </button>
                )}
              </div>

              {/* Rateio entre competências: só aparece com mais de uma. Guarda
                  só o percentual — receita e custo têm bases diferentes, e
                  as Previsões abaixo já dizem quando o dinheiro entra e sai. */}
              {temRateio && (
                <div className="overflow-hidden rounded-xl border border-border bg-white md:col-span-2">
                  <div className="flex flex-wrap items-center gap-2.5 border-b border-border bg-muted/60 px-[15px] py-[11px]">
                    <Split className="h-[15px] w-[15px] text-california-red" />
                    <span className="text-[12.5px] font-semibold">
                      Rateio entre competências
                    </span>
                    <span className="text-[11.5px] text-muted-foreground">
                      Divisão percentual do reconhecimento do job em{" "}
                      {comps.length} trimestres
                    </span>
                    {!travado && (
                      <div className="ml-auto flex items-center gap-1.5">
                        {[
                          { rotulo: "50 / 50", pcts: [50, 50] },
                          { rotulo: "60 / 40", pcts: [60, 40] },
                          { rotulo: "70 / 30", pcts: [70, 30] },
                          { rotulo: "Igualar", pcts: null },
                        ].map((p) => {
                          const ativo = !p.pcts || comps.length === 2;
                          return (
                            <button
                              key={p.rotulo}
                              type="button"
                              disabled={!ativo}
                              onClick={() => aplicarPreset(p.pcts)}
                              className={cn(
                                "rounded-[7px] border bg-white px-2.5 py-[5px] font-mono text-[11px] font-semibold transition-colors",
                                ativo
                                  ? "border-border text-muted-foreground hover:border-california-red hover:text-california-red"
                                  : "cursor-not-allowed border-[#f3f3f3] text-[#c9c9c9]",
                              )}
                            >
                              {p.rotulo}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-[112px_118px_minmax(0,1fr)_34px] items-center gap-3 border-b border-[#f1f0ec] px-[15px] py-2 text-[9.5px] font-bold uppercase tracking-[0.08em] text-[#8a8a8a]">
                    <span>Competência</span>
                    <span>% do job</span>
                    <span>Proporção</span>
                    <span />
                  </div>
                  {compsOrdenadas.map((c) => {
                    const chave = chaveComp(c);
                    const pct = parsePct(c.pctTexto);
                    return (
                      <div
                        key={chave}
                        className="grid grid-cols-[112px_118px_minmax(0,1fr)_34px] items-center gap-3 border-b border-[#f6f6f6] px-[15px] py-[9px]"
                      >
                        <span className="font-mono text-[12.5px] font-bold">
                          {c.trimestre}T/{c.ano}
                        </span>
                        <div
                          className={cn(
                            "flex h-[34px] items-center gap-1.5 rounded-lg border border-border px-2.5",
                            travado ? "bg-muted/60" : "bg-white",
                          )}
                        >
                          <input
                            aria-label={`Percentual de ${c.trimestre}T/${c.ano}`}
                            value={c.pctTexto}
                            readOnly={travado}
                            inputMode="decimal"
                            onChange={(e) =>
                              editarPercentual(chave, e.target.value)
                            }
                            className="w-full min-w-0 bg-transparent text-right font-mono text-[13px] font-semibold outline-none"
                          />
                          <span className="text-xs text-[#8a8a8a]">%</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-[#f1f0ec]">
                          <div
                            className="h-full rounded-full bg-california-red"
                            style={{
                              width: `${Math.max(0, Math.min(100, pct))}%`,
                            }}
                          />
                        </div>
                        {travado ? (
                          <span />
                        ) : (
                          <button
                            type="button"
                            title="Remover competência"
                            onClick={() => removerCompetencia(chave)}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-[7px] border border-border bg-white text-[#8a8a8a] transition-colors hover:border-california-red hover:text-california-red"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                  <div className="grid grid-cols-[112px_118px_minmax(0,1fr)_34px] items-center gap-3 bg-muted/50 px-[15px] py-[11px]">
                    <span className="text-[11px] font-bold uppercase tracking-[0.07em] text-muted-foreground">
                      Total
                    </span>
                    <span
                      className={cn(
                        "pr-[26px] text-right font-mono text-[13px] font-bold",
                        rateioFecha ? "text-emerald-700" : "text-california-red",
                      )}
                    >
                      {formatPercentualRateio(somaRateio)}
                    </span>
                    <span
                      className={cn(
                        "text-[11.5px] [text-wrap:pretty]",
                        rateioFecha
                          ? "text-muted-foreground"
                          : "text-california-red",
                      )}
                    >
                      {rateioFecha
                        ? "Rateio fecha em 100%. Recebimento e custo seguem nas datas das Previsões."
                        : somaRateio < 100
                          ? `Faltam ${formatPercentualRateio(100 - somaRateio)} para fechar 100%.`
                          : `Excede 100% em ${formatPercentualRateio(somaRateio - 100)}.`}
                    </span>
                    <span />
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Previsões — recebimento e custos numa tabela só.
              Layout D do protótipo "Abertura de Job - Financeiro":
              os dois cards viraram um, com três tiles no topo e a
              tabela partida em dois blocos (entrada em cima, saída
              embaixo). Um cabeçalho só, uma grade só — as colunas de
              recebimento e de custo passam a alinhar entre si, que era
              o motivo da fusão. */}
          <section className="rounded-2xl border border-border bg-card shadow-soft">
            <header className="flex flex-wrap items-center gap-2.5 rounded-t-2xl border-b border-border bg-muted/50 px-5 py-3.5">
              <TrendingDown className="h-4 w-4 text-california-red" />
              <h2 className="text-[15px] font-semibold">Previsões</h2>
              <span className="text-xs text-muted-foreground">
                Faturamento do orçamento + custo planejado da planilha
              </span>
              {/* As duas contas moram no mesmo cabeçalho: a que recebe e
                  a que paga. */}
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <ContaSeletor
                  rotulo="Recebimento em"
                  contas={contas}
                  selecionada={contaReceb}
                  travado={travado}
                  aberto={dropConta === "recebimento"}
                  onAbrir={(o) => setDropConta(o ? "recebimento" : null)}
                  onEscolher={(id) => {
                    setContaRecebId(id);
                    setDropConta(null);
                  }}
                />
                <ContaSeletor
                  rotulo="Pagamento em"
                  contas={contas}
                  selecionada={contaPag}
                  travado={travado}
                  aberto={dropConta === "pagamento"}
                  onAbrir={(o) => setDropConta(o ? "pagamento" : null)}
                  onEscolher={(id) => {
                    setContaPagId(id);
                    setDropConta(null);
                  }}
                />
              </div>
            </header>

            <div className="flex flex-col gap-[18px] p-5">
              <div className="grid gap-3.5 sm:grid-cols-3">
                <div className="rounded-xl border border-border px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.09em] text-muted-foreground">
                    Valor total do job
                  </p>
                  <p className="mt-1.5 whitespace-nowrap font-mono text-base font-bold">
                    {formatCurrency(job.valor_total)}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Fechamento do orçamento aprovado
                  </p>
                </div>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.09em] text-emerald-700">
                    Faturamento previsto
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <p className="whitespace-nowrap font-mono text-base font-bold">
                      {formatCurrency(faturamentoPrevisto)}
                    </p>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-2.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                      <Lock className="h-2.5 w-2.5" />
                      Do orçamento
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Total a receber do cliente neste job
                  </p>
                </div>
                <div className="rounded-xl border border-california-red/25 bg-california-red/5 px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.09em] text-[#b3323c]">
                    Custo previsto total
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <p className="whitespace-nowrap font-mono text-base font-bold">
                      {formatCurrency(custoPrevisto)}
                    </p>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-2.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                      <Lock className="h-2.5 w-2.5" />
                      Do planejado
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {semDesembolso
                      ? "Nenhum item de calha PP — a California não desembolsa neste job."
                      : "Planejado dos itens que a California paga (tipos que geram PP)"}
                  </p>
                </div>
              </div>

              <div className="overflow-hidden rounded-xl border border-border">
                <table className="w-full border-collapse text-[13.5px]">
                  <thead>
                    <tr className="border-b border-border text-left text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
                      <th className="w-14 px-4 py-2.5 font-semibold">#</th>
                      <th className="px-4 py-2.5 font-semibold">
                        Data prevista
                      </th>
                      <th className="px-4 py-2.5 text-right font-semibold">
                        Valor
                      </th>
                      <th className="w-28 px-4 py-2.5 text-right font-semibold">
                        % do total
                      </th>
                      <th className="w-14 px-4 py-2.5" aria-label="Remover" />
                    </tr>
                  </thead>
                  <tbody>
                    {/* ---------- Bloco de entrada ---------- */}
                    <tr>
                      <td colSpan={5} className="p-0">
                        <div className="flex flex-wrap items-center gap-2.5 border-y border-border bg-emerald-50/50 px-4 py-2.5">
                          <CalendarCheck className="h-3.5 w-3.5 text-emerald-700" />
                          <p className="text-[11px] font-bold uppercase tracking-[0.07em] text-emerald-700">
                            Parcelas de recebimento
                          </p>
                          <span className="text-[11.5px] text-muted-foreground">
                            Recebimento previsto para{" "}
                            {formatDataBr(job.data_prevista_faturamento)}
                          </span>
                          {!semRecebimento && (
                            <span className="ml-auto inline-flex items-center gap-2">
                              <span
                                className={cn(
                                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11.5px] font-semibold",
                                  recebBate
                                    ? "border-emerald-200 bg-white text-emerald-700"
                                    : "border-amber-200 bg-amber-50 text-amber-700",
                                )}
                              >
                                {recebBate ? (
                                  <Check className="h-3 w-3" />
                                ) : (
                                  <AlertTriangle className="h-3 w-3" />
                                )}
                                {recebBate
                                  ? "Parcelas fecham com o faturamento"
                                  : difReceb > 0
                                    ? `Sobra de ${formatCurrency(Math.abs(difReceb))}`
                                    : `Falta ${formatCurrency(Math.abs(difReceb))}`}
                              </span>
                              {!travado && (
                                <button
                                  type="button"
                                  onClick={distribuirRecebimento}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-2.5 py-1.5 text-[11.5px] font-semibold text-muted-foreground transition-colors hover:border-[#d7d7d7] hover:text-foreground"
                                >
                                  <Split className="h-3 w-3" />
                                  {congeladoReceb > 0
                                    ? "Distribuir o saldo"
                                    : "Distribuir"}
                                </button>
                              )}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* Faturamento previsto zero: nada a receber pela
                        California (o cliente paga tudo direto ao
                        fornecedor). O aviso substitui as linhas, como no
                        bloco de custos. */}
                    {semRecebimento ? (
                      <tr className="border-b border-border">
                        <td colSpan={5} className="bg-amber-50/60 px-4 py-3.5">
                          <div className="flex items-start gap-3">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                            <div>
                              <p className="text-[13px] font-semibold text-amber-800">
                                Nenhum faturamento previsto pela California
                              </p>
                              <p className="mt-1 text-xs leading-relaxed text-amber-800/80">
                                {saveConsumido > 0.005 ? (
                                  <>
                                    Este job é pago com saldo em save de outro
                                    job — o cliente já pagou por ele numa nota
                                    anterior. Não há nota a emitir aqui, e o
                                    job abre sem previsão de recebimento.
                                  </>
                                ) : (
                                  <>
                                    Todo o valor deste job é pago diretamente
                                    pelo cliente ao fornecedor — a California
                                    não emite nota. O job abre sem previsão de
                                    recebimento.
                                  </>
                                )}
                              </p>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      <>
                        {recebimento.map((linha, i) => {
                          const valor = parseMoeda(linha.valorTexto);
                          const pct =
                            faturamentoPrevisto > 0
                              ? (valor / faturamentoPrevisto) * 100
                              : 0;

                          return (
                            <tr
                              key={linha.id}
                              className="border-b border-b-[#f4f2f2]"
                            >
                              <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                                {`R${String(i + 1).padStart(2, "0")}`}
                              </td>
                              <td className="px-4 py-2.5">
                                <div className="w-[190px]">
                                  {linha.congelada || travado ? (
                                    <LinhaTravada
                                      texto={formatDataBr(linha.data)}
                                      congelada={Boolean(linha.congelada)}
                                      titulo={
                                        linha.congelada
                                          ? "Já faturado — esta parcela não pode mudar"
                                          : undefined
                                      }
                                    />
                                  ) : (
                                    /* Recebimento não segue as janelas de
                                       pagamento: quem manda na data de entrada
                                       é o cliente, não o calendário com que a
                                       California paga fornecedor. */
                                    <DatePicker
                                      name={`recebimento-data-${linha.id}`}
                                      defaultValue={linha.data}
                                      className="h-9 text-[13px]"
                                      onDateChange={(d) =>
                                        atualizarRecebimento(linha.id, {
                                          data: d
                                            ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
                                            : "",
                                        })
                                      }
                                    />
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-2.5">
                                {linha.congelada || travado ? (
                                  <p className="text-right font-mono text-[13px] font-semibold">
                                    {formatCurrency(valor)}
                                  </p>
                                ) : (
                                  <div className="ml-auto flex h-9 w-[180px] items-center gap-1.5 rounded-lg border border-border px-3">
                                    <span className="text-xs font-semibold text-muted-foreground">
                                      R$
                                    </span>
                                    <input
                                      aria-label={`Valor da parcela ${i + 1}`}
                                      value={linha.valorTexto}
                                      onChange={(e) =>
                                        atualizarRecebimento(linha.id, {
                                          valorTexto: e.target.value,
                                        })
                                      }
                                      onBlur={() =>
                                        atualizarRecebimento(linha.id, {
                                          valorTexto: formatMoedaTexto(
                                            parseMoeda(linha.valorTexto),
                                          ),
                                        })
                                      }
                                      inputMode="decimal"
                                      className="w-full min-w-0 border-0 bg-transparent text-right font-mono text-[13px] font-semibold outline-none"
                                    />
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono text-[12.5px] text-muted-foreground">
                                {faturamentoPrevisto > 0
                                  ? formatPercentual(pct)
                                  : "—"}
                              </td>
                              <td className="px-4 py-2.5">
                                {travado ? null : (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      removerDoRecebimento(linha.id)
                                    }
                                    disabled={
                                      !podeRemover(recebimento, linha.id)
                                    }
                                    aria-label={`Remover a parcela ${i + 1}`}
                                    title={
                                      linha.congelada
                                        ? "Parcela já faturada — não pode ser removida"
                                        : !podeRemover(recebimento, linha.id)
                                          ? "A previsão precisa de pelo menos uma parcela"
                                          : "Remover parcela"
                                    }
                                    className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-border bg-white text-california-red transition-colors hover:bg-california-red/5 disabled:cursor-not-allowed disabled:text-[#d7d7d7] disabled:hover:bg-white"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                        <tr className="border-b border-border bg-muted/40">
                          <td className="px-4 py-2.5" />
                          <td className="px-4 py-2.5">
                            {!travado && (
                              <button
                                type="button"
                                onClick={adicionarParcelaRecebimento}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-[#d7d7d7] bg-white px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-california-red hover:text-california-red"
                              >
                                <Plus className="h-3 w-3" />
                                Adicionar parcela
                              </button>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <span className="text-[11.5px] text-muted-foreground">
                              Soma{" "}
                            </span>
                            <strong className="font-mono text-[13px]">
                              {formatCurrency(somaDoRecebimento)}
                            </strong>
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-xs text-muted-foreground">
                            {faturamentoPrevisto > 0
                              ? formatPercentual(
                                  (somaDoRecebimento / faturamentoPrevisto) *
                                    100,
                                )
                              : "—"}
                          </td>
                          <td className="px-4 py-2.5" />
                        </tr>
                      </>
                    )}

                    {/* ---------- Bloco de saída ---------- */}
                    <tr>
                      <td colSpan={5} className="p-0">
                        <div className="flex flex-wrap items-center gap-2.5 border-y border-border bg-california-red/[0.045] px-4 py-2.5">
                          <CalendarDays className="h-3.5 w-3.5 text-[#b3323c]" />
                          <p className="text-[11px] font-bold uppercase tracking-[0.07em] text-[#b3323c]">
                            Custos · cronograma de desembolsos
                          </p>
                          <span className="text-[11.5px] text-muted-foreground">
                            Janelas de pagamento (dias 08 e 20) entre{" "}
                            {formatDataBr(job.data_inicio_prevista)} e{" "}
                            {formatDataBr(job.data_fim_prevista)}
                          </span>
                          {!semDesembolso && (
                            <span className="ml-auto inline-flex items-center gap-2">
                              <span
                                className={cn(
                                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11.5px] font-semibold",
                                  curvaBate
                                    ? "border-emerald-200 bg-white text-emerald-700"
                                    : "border-amber-200 bg-amber-50 text-amber-700",
                                )}
                              >
                                {curvaBate ? (
                                  <Check className="h-3 w-3" />
                                ) : (
                                  <AlertTriangle className="h-3 w-3" />
                                )}
                                {curvaBate
                                  ? "Curva fecha com o total"
                                  : difCurva > 0
                                    ? `Sobra de ${formatCurrency(Math.abs(difCurva))}`
                                    : `Falta ${formatCurrency(Math.abs(difCurva))}`}
                              </span>
                              {!travado && (
                                <button
                                  type="button"
                                  onClick={distribuirCurva}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-2.5 py-1.5 text-[11.5px] font-semibold text-muted-foreground transition-colors hover:border-[#d7d7d7] hover:text-foreground"
                                >
                                  <Split className="h-3 w-3" />
                                  {congeladoCurva > 0
                                    ? "Distribuir o saldo"
                                    : "Distribuir"}
                                </button>
                              )}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* Sem item de calha PP não há o que distribuir — o
                        aviso substitui as linhas do bloco. */}
                    {semDesembolso ? (
                      <tr>
                        <td colSpan={5} className="bg-amber-50/60 px-4 py-3.5">
                          <div className="flex items-start gap-3">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                            <div>
                              <p className="text-[13px] font-semibold text-amber-800">
                                Nenhum desembolso previsto pela California
                              </p>
                              <p className="mt-1 text-xs leading-relaxed text-amber-800/80">
                                Os custos deste job são pagos diretamente pelo
                                cliente ao fornecedor (itens de calha BV). O
                                planejado da planilha segue como controle
                                interno, mas não gera previsão de custos — o
                                job abre sem cronograma de desembolsos.
                              </p>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      <>
                        {curva.map((linha, i) => {
                          const valor = parseMoeda(linha.valorTexto);
                          const pct =
                            custoPrevisto > 0
                              ? (valor / custoPrevisto) * 100
                              : 0;
                          const fora =
                            linha.data.length === 10 &&
                            foraDoRateio(linha.data, compsNumericas);

                          return (
                            <tr
                              key={linha.id}
                              className="border-b border-b-[#f4f2f2]"
                            >
                              <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                                {`C${String(i + 1).padStart(2, "0")}`}
                              </td>
                              <td className="px-4 py-2.5">
                                <div className="w-[190px]">
                                  {linha.congelada || travado ? (
                                    <LinhaTravada
                                      texto={formatDataBr(linha.data)}
                                      congelada={Boolean(linha.congelada)}
                                      titulo={
                                        linha.congelada
                                          ? "Já consumida por PP emitida — esta data não pode mudar"
                                          : undefined
                                      }
                                    />
                                  ) : (
                                    <DatePicker
                                      name={`curva-data-${linha.id}`}
                                      defaultValue={linha.data}
                                      className="h-9 text-[13px]"
                                      // Pagamento só nas janelas: qualquer outro
                                      // dia fica apagado no calendário.
                                      dateDisabled={(d) =>
                                        !ehJanelaDePagamento(
                                          `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
                                        )
                                      }
                                      onDateChange={(d) =>
                                        atualizarCurva(linha.id, {
                                          data: d
                                            ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
                                            : "",
                                        })
                                      }
                                    />
                                  )}
                                  {fora && !linha.congelada && (
                                    <span className="mt-1 inline-flex items-center gap-1 text-[10.5px] font-medium text-amber-700">
                                      <AlertTriangle className="h-2.5 w-2.5" />
                                      Fora da competência {competenciaResumo}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-2.5">
                                {linha.congelada || travado ? (
                                  <p className="text-right font-mono text-[13px] font-semibold">
                                    {formatCurrency(valor)}
                                  </p>
                                ) : (
                                  <div className="ml-auto flex h-9 w-[180px] items-center gap-1.5 rounded-lg border border-border px-3">
                                    <span className="text-xs font-semibold text-muted-foreground">
                                      R$
                                    </span>
                                    <input
                                      aria-label={`Valor da data ${i + 1}`}
                                      value={linha.valorTexto}
                                      onChange={(e) =>
                                        atualizarCurva(linha.id, {
                                          valorTexto: e.target.value,
                                        })
                                      }
                                      onBlur={() =>
                                        atualizarCurva(linha.id, {
                                          valorTexto: formatMoedaTexto(
                                            parseMoeda(linha.valorTexto),
                                          ),
                                        })
                                      }
                                      inputMode="decimal"
                                      className="w-full min-w-0 border-0 bg-transparent text-right font-mono text-[13px] font-semibold outline-none"
                                    />
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono text-[12.5px] text-muted-foreground">
                                {custoPrevisto > 0
                                  ? formatPercentual(pct)
                                  : "—"}
                              </td>
                              <td className="px-4 py-2.5">
                                {travado ? null : (
                                  <button
                                    type="button"
                                    onClick={() => removerDaCurva(linha.id)}
                                    disabled={!podeRemover(curva, linha.id)}
                                    aria-label={`Remover a data ${i + 1}`}
                                    title={
                                      linha.congelada
                                        ? "Data já consumida por PP emitida — não pode ser removida"
                                        : !podeRemover(curva, linha.id)
                                          ? "A curva precisa de pelo menos uma data"
                                          : "Remover data"
                                    }
                                    className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-border bg-white text-california-red transition-colors hover:bg-california-red/5 disabled:cursor-not-allowed disabled:text-[#d7d7d7] disabled:hover:bg-white"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                        <tr className="bg-muted/40">
                          <td className="px-4 py-2.5" />
                          <td className="px-4 py-2.5">
                            {!travado && (
                              <button
                                type="button"
                                onClick={adicionarData}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-[#d7d7d7] bg-white px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-california-red hover:text-california-red"
                              >
                                <Plus className="h-3 w-3" />
                                Adicionar data
                              </button>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <span className="text-[11.5px] text-muted-foreground">
                              Soma{" "}
                            </span>
                            <strong className="font-mono text-[13px]">
                              {formatCurrency(somaDaCurva)}
                            </strong>
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-xs text-muted-foreground">
                            {custoPrevisto > 0
                              ? formatPercentual(
                                  (somaDaCurva / custoPrevisto) * 100,
                                )
                              : "—"}
                          </td>
                          <td className="px-4 py-2.5" />
                        </tr>
                      </>
                    )}
                  </tbody>
                </table>

                {/* O fechamento da tabela: entrada menos saída, e a
                    contagem das linhas dos dois blocos. */}
                <div className="flex flex-wrap items-center gap-5 border-t border-border bg-muted/60 px-4 py-3">
                  <span className="text-xs text-muted-foreground">
                    Margem prevista{" "}
                    <strong
                      className={cn(
                        "font-mono text-sm",
                        margem >= 0
                          ? "text-emerald-700"
                          : "text-california-red",
                      )}
                    >
                      {formatCurrency(margem)}
                      {faturamentoPrevisto > 0
                        ? ` · ${formatPercentual(margemPct)}`
                        : ""}
                    </strong>
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {qtdRecebimentosLabel} ·{" "}
                    {semDesembolso
                      ? qtdDatasCustoLabel
                      : `${qtdDatasCustoLabel} de custo`}
                  </span>
                </div>
              </div>

              <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/50 px-3.5 py-3">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  As duas previsões alimentam o fluxo de caixa do financeiro: o
                  bloco de cima é a entrada, o de baixo é a saída. A primeira
                  parcela de recebimento vem da data de faturamento do
                  orçamento e a soma tem que fechar com o faturamento previsto;
                  as datas de custo seguem as janelas de pagamento (dias 08 e
                  20, ou o dia útil seguinte) e fecham com o custo previsto.
                  Nada disso trava o realizado — a nota emitida abate a
                  previsão de recebimento, e cada PP emitida abate a de custos.
                  Datas fora da competência escolhida ficam sinalizadas.
                </p>
              </div>
            </div>
          </section>
        </div>

        {/* ---------- Coluna lateral ---------- */}
        <aside className="flex flex-col gap-4 lg:sticky lg:top-6">
          <div className="flex flex-col gap-2.5 rounded-2xl border border-border bg-card px-5 py-4 shadow-soft">
            <p className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">
              Dados da produção
            </p>
            {dadosProducao.map((d) => (
              <div
                key={d.rotulo}
                className="flex items-baseline justify-between gap-3"
              >
                <span className="text-[12.5px] text-muted-foreground">
                  {d.rotulo}
                </span>
                <span
                  className={
                    d.mono
                      ? "text-right font-mono text-[12.5px] font-semibold"
                      : "text-right text-[12.5px] font-semibold"
                  }
                >
                  {d.valor}
                </span>
              </div>
            ))}
            {/* Os dois números do fechamento, como no modal do envio:
                faturamento previsto em vermelho, valor total fechando. */}
            <div className="mt-0.5 flex items-baseline justify-between gap-3 border-t border-border pt-2.5">
              <span className="text-[12.5px] font-semibold">
                Faturamento previsto
              </span>
              <span className="font-mono text-[13px] font-bold text-california-red">
                {formatCurrency(job.faturamento_previsto)}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[12.5px] font-semibold">Valor total</span>
              <span className="font-mono text-[15px] font-bold">
                {formatCurrency(job.valor_total)}
              </span>
            </div>
            {/* Item 03 do protótipo: a planilha interna do job em leitura,
                dentro do próprio fluxo de abertura. */}
            <Link
              href={`/financeiro/abertura-de-job/${job.id}/planilha`}
              prefetch={false}
              className="mt-1.5 flex items-center gap-2.5 rounded-xl border border-border bg-muted/50 px-3.5 py-3 text-left transition-colors hover:border-california-red/50 hover:bg-california-red/5"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-white text-california-red">
                <Table2 className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-[12.5px] font-semibold">
                  Visualizar planilha interna
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {resumoPlanilha}
                </p>
              </div>
              <ArrowRight className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </Link>
          </div>

          {/* O que a produção escreveu ao enviar o job. Mesmo dado e mesmo
              rótulo da conferência: coluna `jobs.observacoes`, "Descritivo
              do Job" nas duas pontas desde 17/08/2026. */}
          <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card px-5 py-4 shadow-soft">
            <p className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">
              Descritivo do Job
            </p>
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">
              {job.observacoes?.trim() || "Sem descritivo do job."}
            </p>
            <div className="mt-0.5 flex items-baseline justify-between gap-3 border-t border-border pt-2.5">
              <span className="text-xs text-muted-foreground">Enviado por</span>
              <span className="text-right text-xs font-semibold">
                {enviadoPorNome ?? "—"}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs text-muted-foreground">
                Orçamento de origem
              </span>
              <span className="font-mono text-xs font-semibold">
                {job.orcamento_codigo ?? "—"}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-2.5 rounded-2xl border border-border bg-card px-5 py-4 shadow-soft">
            <p className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">
              Resumo do registro
            </p>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[12.5px] text-muted-foreground">
                Projeto
              </span>
              <span className="text-right text-[12.5px] font-semibold">
                {projetoResumo}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[12.5px] text-muted-foreground">
                Categoria
              </span>
              <span className="text-right text-[12.5px] font-semibold">
                {categoriaNome}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[12.5px] text-muted-foreground">
                Serviço
              </span>
              <span className="text-right text-[12.5px] font-semibold">
                {servicoNome}
              </span>
            </div>
            {/* Uma linha por competência: o rateio inteiro, com o
                percentual de cada trimestre. */}
            <div className="flex flex-col gap-1">
              <span className="text-[12.5px] text-muted-foreground">
                Competência
              </span>
              {compsNumericas.map((c) => (
                <div
                  key={chaveComp(c)}
                  className="flex items-baseline justify-between gap-2.5 pl-3"
                >
                  <span className="font-mono text-[12.5px] font-bold">
                    {c.trimestre}T/{c.ano}
                  </span>
                  <span className="font-mono text-xs font-semibold text-muted-foreground">
                    {formatPercentualRateio(c.percentual)}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[12.5px] text-muted-foreground">
                Faturamento previsto
              </span>
              <span className="font-mono text-[12.5px] font-semibold text-emerald-700">
                {formatCurrency(faturamentoPrevisto)}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[12.5px] text-muted-foreground">
                Recebimentos
              </span>
              <span className="text-[12.5px] font-semibold">
                {qtdRecebimentosLabel}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[12.5px] text-muted-foreground">
                Custo previsto
              </span>
              <span className="font-mono text-[12.5px] font-semibold">
                {formatCurrency(custoPrevisto)}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[12.5px] text-muted-foreground">
                Datas previstas
              </span>
              <span className="text-[12.5px] font-semibold">
                {qtdDatasCustoLabel}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2.5">
              <span className="text-[12.5px] text-muted-foreground">
                Margem prevista
              </span>
              <span
                className={cn(
                  "font-mono text-[13px] font-bold",
                  margem >= 0 ? "text-emerald-700" : "text-california-red",
                )}
              >
                {formatCurrency(margem)}
                {faturamentoPrevisto > 0
                  ? ` · ${formatPercentual(margemPct)}`
                  : ""}
              </span>
            </div>
          </div>
        </aside>
      </div>

      {/* ---------- Barra fixa de ação ---------- */}
      {/* Registro travado não tem barra: não há nada para confirmar, e
          "Editar registro" mora na faixa do topo. */}
      {!travado && (
        <div className="sticky bottom-0 z-10 -mx-5 -mb-6 flex flex-wrap items-center justify-between gap-4 border-t border-border bg-white/95 px-5 py-3.5 backdrop-blur md:-mx-8 md:-mb-8 md:px-8">
          <span
            className={cn(
              "inline-flex items-center gap-2 text-[12.5px] font-medium",
              podeAbrir ? "text-emerald-700" : "text-amber-700",
            )}
          >
            {podeAbrir ? (
              <CheckCircle2 className="h-3.5 w-3.5" />
            ) : (
              <AlertCircle className="h-3.5 w-3.5" />
            )}
            {textoValidacao}
          </span>
          <div className="flex items-center gap-2.5">
            {ehRevisao ? (
              <>
                <Link
                  href="/financeiro/abertura-de-job?aba=aguardando"
                  prefetch={false}
                  className="rounded-lg border border-border bg-white px-4 py-2.5 text-[13.5px] font-semibold transition-colors hover:bg-muted"
                >
                  Voltar para a fila
                </Link>
                <button
                  type="button"
                  onClick={() => setConfirmarAberto(true)}
                  disabled={!podeAbrir || pending}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-5 py-2.5 text-[13.5px] font-bold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Check className="h-4 w-4" />
                  Registrar revisão de abertura
                </button>
              </>
            ) : ehEdicao ? (
              <>
                <button
                  type="button"
                  onClick={cancelarEdicao}
                  disabled={pending}
                  className="rounded-lg border border-border bg-white px-4 py-2.5 text-[13.5px] font-semibold transition-colors hover:bg-muted disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={salvarEdicao}
                  disabled={!podeAbrir || pending}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-5 py-2.5 text-[13.5px] font-bold text-white transition-colors hover:bg-california-red-hover disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Check className="h-4 w-4" />
                  {pending ? "Salvando..." : "Salvar alterações"}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setReprovarAberto(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-4 py-2.5 text-[13.5px] font-semibold text-california-red transition-colors hover:border-california-red hover:bg-california-red/5"
                >
                  <CornerUpLeft className="h-4 w-4" />
                  Reprovar job
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmarAberto(true)}
                  disabled={!podeAbrir || pending}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-5 py-2.5 text-[13.5px] font-bold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Check className="h-4 w-4" />
                  Abrir job no financeiro
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ---------- Confirmação ---------- */}
      <Dialog open={confirmarAberto} onOpenChange={setConfirmarAberto}>
        <DialogContent className="max-h-[88vh] max-w-[470px] overflow-y-auto">
          <DialogHeader>
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <DialogTitle className="pt-4 text-[19px]">
              {ehRevisao
                ? `Registrar a revisão da abertura de ${job.codigo}?`
                : `Abrir ${job.codigo} no financeiro?`}
            </DialogTitle>
            <DialogDescription className="text-[13.5px] leading-relaxed">
              {ehRevisao
                ? "As previsões de recebimento e de custo passam a valer como estão aqui, a revisão da errata fecha, e o envio de PPs e o faturamento voltam. A data e o usuário da abertura não mudam."
                : "O job passa a existir no financeiro, aceita lançamentos e entra na lista de jobs abertos. A data de abertura é registrada agora."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2.5 rounded-xl border border-border px-4 py-4">
            <ResumoLinha rotulo="Nome do job" valor={nome.trim()} />
            <ResumoLinha rotulo="Projeto" valor={projetoResumo} />
            <ResumoLinha rotulo="Categoria" valor={categoriaNome} />
            <ResumoLinha rotulo="Serviço" valor={servicoNome} />
            <ResumoLinha rotulo="Competência" valor={competenciaLabel} mono />
            <ResumoLinha
              rotulo="Data de abertura"
              valor={ehRevisao ? (abertoEmLabel ?? "—") : agoraLabel}
              mono
            />
            <ResumoLinha
              rotulo="Recebimento"
              valor={
                semRecebimento
                  ? "Sem faturamento previsto"
                  : `${recebimento.length}× · ${formatDataBr(recebimento[0]?.data)}${
                      recebimento.length > 1
                        ? ` → ${formatDataBr(recebimento[recebimento.length - 1]?.data)}`
                        : ""
                    }`
              }
            />
            <ResumoLinha
              rotulo="Custo previsto"
              valor={formatCurrency(custoPrevisto)}
              mono
            />
            <ResumoLinha
              rotulo="Curva"
              valor={
                semDesembolso
                  ? "Sem desembolso previsto"
                  : `${curva.length}× · ${formatDataBr(curva[0]?.data)}${
                      curva.length > 1
                        ? ` → ${formatDataBr(curva[curva.length - 1]?.data)}`
                        : ""
                    }`
              }
            />
            <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2.5">
              <span className="text-[13px] font-semibold">
                Faturamento previsto
              </span>
              <span className="font-mono text-[13px] font-bold text-california-red">
                {formatCurrency(job.faturamento_previsto)}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[13px] font-semibold">Valor total</span>
              <span className="font-mono text-[15px] font-bold">
                {formatCurrency(job.valor_total)}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={() => setConfirmarAberto(false)}
              className="rounded-lg border border-border bg-white px-4 py-2.5 text-[13.5px] font-semibold transition-colors hover:bg-muted"
            >
              Voltar e revisar
            </button>
            <button
              type="button"
              onClick={ehRevisao ? confirmarRevisao : confirmarAbertura}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-[18px] py-2.5 text-[13.5px] font-bold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
            >
              <Check className="h-4 w-4" />
              {pending
                ? ehRevisao
                  ? "Registrando..."
                  : "Abrindo..."
                : ehRevisao
                  ? "Sim, registrar revisão"
                  : "Sim, abrir job"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <ReprovarDialog
        open={reprovarAberto}
        onOpenChange={setReprovarAberto}
        jobId={job.id}
        jobCodigo={job.codigo}
        gpNome={job.responsavel_nome}
        produtorNome={job.produtor_nome}
        redirecionarPara="/financeiro/abertura-de-job?aba=aguardando"
      />
    </div>
  );
}

function ResumoLinha({
  rotulo,
  valor,
  mono,
}: {
  rotulo: string;
  valor: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[13px] text-muted-foreground">{rotulo}</span>
      <span
        className={
          mono
            ? "text-right font-mono text-[13px] font-semibold"
            : "text-right text-[13px] font-semibold"
        }
      >
        {valor}
      </span>
    </div>
  );
}

/**
 * Escolhe a conta bancária da seção — uma para a entrada, uma para a
 * saída, como no protótipo (o seletor mora no cabeçalho da seção, e não
 * na linha da tabela: a conta é do job inteiro).
 *
 * Mostra o saldo de hoje em cada opção porque a pergunta que o financeiro
 * faz aqui é "de qual conta isso sai", e saldo é metade dessa resposta.
 * O número vem de `fc_saldos_por_conta`, a mesma função do Fluxo de
 * Caixa — nunca de uma conta feita à parte, que divergiria.
 */
function ContaSeletor({
  rotulo,
  contas,
  selecionada,
  travado,
  aberto,
  onAbrir,
  onEscolher,
}: {
  rotulo: string;
  contas: ContaBancariaOpcao[];
  selecionada: ContaBancariaOpcao | null;
  travado: boolean;
  aberto: boolean;
  onAbrir: (aberto: boolean) => void;
  onEscolher: (id: string | null) => void;
}) {
  // Sem conta cadastrada não há o que escolher, e um botão que não abre
  // nada é pior do que botão nenhum.
  if (contas.length === 0) return null;

  return (
    <div>
      <Popover open={aberto} onOpenChange={(o) => !travado && onAbrir(o)}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={travado}
            className={cn(
              "inline-flex h-[38px] items-center gap-2.5 rounded-[9px] border bg-white px-3 text-left transition-colors",
              aberto ? "border-california-red" : "border-border",
              !travado && "hover:border-[#d7d7d7]",
              travado && "bg-muted/60",
            )}
          >
            <Landmark className="h-[15px] w-[15px] shrink-0 text-muted-foreground" />
            <span className="flex flex-col items-start leading-[1.2]">
              <span className="text-[9px] font-bold uppercase tracking-[0.08em] text-[#8a8a8a]">
                {rotulo}
              </span>
              <span
                className={cn(
                  "whitespace-nowrap text-[12.5px] font-semibold",
                  !selecionada && "text-muted-foreground",
                )}
              >
                {selecionada?.rotulo ?? "Não definida"}
              </span>
            </span>
            {!travado && (
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[#8a8a8a]" />
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[318px] p-1.5" align="end">
          {contas.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onEscolher(c.id)}
              className={cn(
                "block w-full rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-muted",
                c.id === selecionada?.id &&
                  "bg-california-red/[0.06] text-california-red",
              )}
            >
              <span className="flex items-baseline justify-between gap-3">
                <span className="truncate font-semibold">{c.rotulo}</span>
                <span className="shrink-0 font-mono text-[11px] text-[#8a8a8a]">
                  {formatCurrency(c.saldo)}
                </span>
              </span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                {c.detalhe}
              </span>
            </button>
          ))}
          {/* A conta é opcional (o protótipo não marca com asterisco), e
              job sem faturamento previsto não tem por que ter conta de
              recebimento — então limpar precisa ser possível. */}
          {selecionada && (
            <button
              type="button"
              onClick={() => onEscolher(null)}
              className="mt-1 flex w-full items-center gap-1.5 rounded-lg border-t border-border px-2.5 py-2 text-left text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-3 w-3" />
              Não definir conta
            </button>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

/**
 * A data de uma linha que não aceita edição.
 *
 * Duas razões diferentes caem aqui, e a tela distingue as duas: a linha
 * está CONGELADA (PP ou nota já consumiu aquele dinheiro — cadeado) ou o
 * formulário inteiro está em leitura (job aberto, ninguém clicou em
 * "Editar registro" — sem cadeado, porque nada ali é definitivo, só está
 * travado no momento).
 */
function LinhaTravada({
  texto,
  congelada,
  titulo,
}: {
  texto: string;
  congelada: boolean;
  titulo?: string;
}) {
  return (
    <span
      title={titulo}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 font-mono text-[13px] font-medium",
        congelada ? "text-foreground" : "text-muted-foreground",
      )}
    >
      {congelada && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />}
      {texto}
    </span>
  );
}
