"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  AlertTriangle,
  Building2,
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  CalendarCheck,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  CornerUpLeft,
  FileText,
  Folder,
  Info,
  Landmark,
  Lock,
  Pencil,
  Plus,
  Receipt,
  RotateCcw,
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
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import { NovaMarcaDialog } from "@/app/(app)/clientes/nova-marca-dialog";
import type { OpcoesDoRegistro } from "@/lib/data/opcoes-do-registro";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatCurrency, cn } from "@/lib/utils";
import { SAVE } from "@/app/(app)/_planilha/blocos";
import {
  formatPercentualRateio,
  nomeDoJobNoFinanceiro,
  ordenarCompetencias,
  rateioLabel,
  type JobCompetencia,
  type FotoDaAbertura,
} from "@/lib/types";
import type { ServicoOption } from "@/lib/data/servicos";
import type { JobNaFila, RevisaoDeErrata } from "../dados";
import {
  dataDeRecebimentoDoMes,
  type FaturamentoDoMes,
} from "@/lib/calculos/faturamento-por-mes";
import { nomeDoMes } from "@/lib/calculos/meses-trimestre";
import { distribuirDelta } from "@/lib/calculos/alteracao-financeiro";
import {
  formatDataAsHoraBr,
  formatDataBr,
  formatPeriodo,
  linhasDoRecebimentoEnviado,
} from "../formatos";
import {
  curvaFecha,
  dividirEmParcelas,
  ehJanelaDePagamento,
  emCentavos,
  foraDoRateio,
  proximaDataRecebimento,
  proximaDataSugerida,
  somaCurva,
  sugerirImpostos,
  type CurvaLinha,
  type RecebimentoLinha,
} from "../curva";
import {
  abrirJobNoFinanceiro,
  conferirNomeDeProjetoFinanceiro,
  editarRegistroDaAbertura,
  renomearProjetoFinanceiro,
} from "../actions";
import { ReprovarDialog } from "../reprovar-dialog";
import {
  HistoricoDaAbertura,
  ResumoDaAberturaAnterior,
} from "./historico-abertura";
import type { ProjetoFinanceiroOpcao } from "@/lib/data/projetos-financeiro";
import {
  BotaoTodosOsProjetos,
  LinhaDoProjetoUnificado,
  TodosOsProjetosDialog,
} from "./projetos-unificados";
import type { AprovacaoDeSave } from "../aprovacao-save";
// Só os TIPOS: `saves-da-abertura.ts` lê o banco (servidor) e não pode
// entrar no bundle do cliente (decisão 155).
import type {
  LinhaDeSaveDaAbertura,
  SavesDaAbertura,
} from "../saves-da-abertura";
import { IconeSave } from "../icone-save";
import { BotaoDaPlanilha, PopUpDaPlanilha } from "./planilha-em-leitura";
import { formatDiaBr } from "@/lib/formatar-data-hora";
import { rentabilidadeDoJob } from "@/lib/calculos/abertura-do-job";
import type { ContaBancariaOpcao } from "@/lib/data/contas-bancarias";
import { useVoltar } from "@/components/voltar/botao-voltar";
import { useProtegerSaida } from "@/components/voltar/estado";
import { nomeDaPagina } from "@/lib/voltar";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ExcecaoNaConfirmacao } from "@/app/(app)/_planilha/excecao-no-fechamento";
import { CampoMidiaSystem, type MidiaSystemNaAbertura } from "./campo-midia-system";

interface CategoriaOption {
  id: string;
  nome: string;
  /** Aparece travada no combo, com o selo "Em breve" (decisão 131). */
  em_breve: boolean;
}

/** O valor do campo Projeto quando o escolhido é o projeto novo do "+",
 *  que ainda não tem id: ele nasce com o job (decisão 119). */
const PROJETO_NOVO = "novo";

/** Uma linha do combo de projeto: as do servidor e a do projeto novo. */
type OpcaoDeProjeto = ProjetoFinanceiroOpcao & { novo: boolean };

/** O projeto unificado é da empresa dos jobs que já estão nele; o que só
 *  tem este job não prende a empresa (revisão da 228, 30/10/2026). */
function projetoDaEmpresa(p: ProjetoFinanceiroOpcao, empresaId: string) {
  return p.empresas.length === 0 || p.empresas.includes(empresaId);
}

/** "Novo": o projeto ainda não existe, e só nasce com o job. */
function SeloProjetoNovo() {
  return (
    <span
      title="Criado ao gravar"
      className="shrink-0 rounded-full bg-california-red/10 px-1.5 py-px text-[10px] font-bold uppercase tracking-[0.06em] text-california-red"
    >
      Novo
    </span>
  );
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
  /** Mês de referência — só no recebimento do job mensal (decisão 078). */
  mes: string | null;
}

/** Linha do cronograma de impostos: a parcela de recebimento de onde ela
 *  nasceu vai junto, para a tela dizer "Nota da parcela R01". */
interface LinhaImpostoForm extends LinhaPrevisaoForm {
  origem: string | null;
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
  /** Todos os projetos abertos do financeiro, os do cliente do job
   *  primeiro (decisão 228), para o combo. */
  projetos: ProjetoFinanceiroOpcao[];
  /**
   * O projeto do financeiro do último job aberto no mesmo projeto da
   * produção — o texto de fundo da busca do campo Projeto (decisão 111,
   * revisão de 28/09/2026). Nulo quando não há, e no job já aberto.
   */
  sugestaoDeProjeto: { nome: string; codigo: string; jobCodigo: string } | null;
  /** Contas ativas do tenant, com saldo de hoje. */
  contas: ContaBancariaOpcao[];
  custoPrevisto: number;
  /** Base das parcelas de recebimento — o que a California prevê receber. */
  faturamentoPrevisto: number;
  /**
   * Imposto embutido no faturamento previsto — o fechamento da versão
   * aprovada sobre o que a California emite nota. É contra ele que o
   * cronograma de recolhimento fecha (decisão 100).
   */
  impostoPrevisto: number;
  /** A alíquota da versão aprovada, só para o rótulo do card. */
  aliquotaImposto: number;
  /** Int. taxes da versão, em % — só no internacional, onde elas entram
   *  nos impostos previstos junto com o imposto brasileiro (os custos de
   *  transação ficam de fora, Tiago 23/09/2026). Nulo no nacional. */
  aliquotaIntTaxes: number | null;
  /**
   * As três parcelas da Rentabilidade: valor do job − impostos do valor do
   * job (e, no internacional, int. taxes e custos de transação) − custo
   * planejado. É a conta do resultado operacional planejado da planilha
   * interna (Tiago, 07/10/2026; até ali era faturamento − custo previsto −
   * impostos da nota, decisão 100 §4). Quem monta é a página, com os mesmos
   * números que ela mostra no resto da tela.
   */
  rentabilidade: { valorJob: number; deducoes: number; custoPlanejado: number };
  /** Quanto do orçado deste job é pago com crédito de outro job (save).
   *  Só serve para EXPLICAR um faturamento previsto zerado: sem save, ele
   *  significa "o cliente paga o fornecedor direto"; com save, significa
   *  "o cliente já pagou isto, num job anterior" (decisão 028).
   *  Obrigatória desde 07/10/2026: opcional, com 0 por padrão, ela deixou
   *  a página do job aberto montar o formulário sem ela, e o job pago por
   *  save dizia "pago diretamente pelo cliente ao fornecedor". */
  saveConsumido: number;
  /** O crédito que as linhas deste job em save geram (`totalGeradoEmSave`,
   *  em `dados.ts`) — o "Total gerado em save" do envio da produção. O
   *  cartão "Dados da produção" o mostra abaixo do valor total, junto do
   *  consumo (Tiago, 17/10/2026). Obrigatória, pelo mesmo motivo de
   *  `saveConsumido`. */
  saveGerado: number;
  /** As linhas do job em save e fora dele (`linhasDoSave`, em `dados.ts`).
   *  Só serve para EXPLICAR um custo previsto zero: a linha em save não tem
   *  custo neste job, e a de fora é paga pelo cliente direto ao fornecedor
   *  (escolha do Tiago, 07/10/2026). */
  linhasDoSave: { emSave: number; foraDoSave: number };
  /** Quem clicou em "Enviar job para abertura" na tela da versão. */
  enviadoPorNome: string | null;
  curvaInicial: CurvaLinha[];
  recebimentoInicial: RecebimentoLinha[];
  /** O cronograma de impostos gravado (decisão 100). Vazio na abertura e
   *  nos jobs abertos antes de 23/09/2026 — aí o cronograma nasce seguindo
   *  as parcelas de recebimento. */
  impostosIniciais: CurvaLinha[];
  /**
   * Fee e Always On (decisão 078): o faturamento de cada mês. Quando vem,
   * a previsão de recebimento é uma linha por mês com faturamento, no
   * valor do mês; o financeiro informa o dia e revisa as datas. Nulo nos
   * outros jobs.
   */
  faturamentoPorMes: FaturamentoDoMes[] | null;
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
  /** Quando e por quem o job foi aberto — o rodapé do modo leitura. */
  abertoEmLabel?: string | null;
  abertoPorNome?: string | null;
  /** As fotos do registro, da abertura à última revisão (decisão 059).
   *  Só chegam no job aberto. */
  fotos?: FotoDaAbertura[];
  /** A errata que devolveu o job ao mural — só no modo `revisao`. */
  revisao?: RevisaoDeErrata | null;
  /** As linhas que as erratas da revisão mudaram (decisão 185): o
   *  "Visualizar planilha interna" abre com elas em borda vermelha
   *  (revisão da 185, 19/10/2026). `[]` fora da revisão. Obrigatória: quem
   *  não destaca manda `[]`. */
  linhasDaRevisao: string[];
  /**
   * Aprovação de save (decisão 099): o pedido que esta revisão aprova.
   * Vem com o modo `revisao`; a faixa do topo vira "Aprovação de save ·
   * revisão da abertura" e o botão final aprova e registra. `null` em todo
   * o resto — a fila, a leitura, a edição e a revisão de errata.
   */
  aprovacaoSave: AprovacaoDeSave | null;
  /**
   * Os saves que vieram com o job (decisão 155, 07/10/2026): o bloco
   * "Saves deste job". Na abertura o financeiro marca "Aprovar save
   * gerado" e "Aprovar consumo de save", e abrir o job aprova os pedidos
   * — não há mais revisão por save. Recusar um save antes de abrir é o
   * "Reprovar job" de sempre. No job aberto, na revisão e na edição o bloco
   * aparece em leitura, com a situação de cada pedido. `null` (ou sem
   * linhas) deixa a tela exatamente como era. Obrigatória, sem default:
   * prop opcional esconde a fronteira em que o dado some (CLAUDE.md).
   */
  saves: SavesDaAbertura | null;
  /** As listas de Marca, Empresa e Regional do registro (decisão 214). */
  opcoesDoRegistro: OpcoesDoRegistro;
  /** Decisão 216: a liberação das NFs e as PPs que foram sem NF, para o
   *  campo Mídia System e o "Liberar NFs". Na fila, `MIDIA_SYSTEM_NA_FILA`.
   *  Obrigatória: prop opcional esconde a fronteira em que o dado some. */
  midiaSystem: MidiaSystemNaAbertura;
}

/** O atalho "Visualizar planilha interna" — link ou botão de aba, mesma cara. */
const CLASSE_ATALHO_PLANILHA =
  "mt-1.5 flex w-full items-center gap-2.5 rounded-xl border border-border bg-muted/50 px-3.5 py-3 text-left transition-colors hover:border-california-red/50 hover:bg-california-red/5";

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
 * Transforma a previsão guardada nas linhas da tela.
 *
 * ⚠️ Até 08/09/2026 esta função repartia a previsão em fatia CONGELADA
 * (a que PP ou nota emitida já tinha consumido, travada) e fatia livre —
 * a regra da decisão 021. A trava caiu inteira (decisão 061): quem edita
 * o registro redistribui as duas previsões à vontade, e o histórico de
 * fotos da decisão 059 é o que guarda como elas estavam antes.
 */
function paraForm(linhas: CurvaLinha[]): LinhaPrevisaoForm[] {
  return linhas.map((l) => ({
    id: l.id,
    data: l.data,
    valorTexto: formatMoedaTexto(l.valor),
    mes: null,
  }));
}

/**
 * O recebimento do job mensal: uma linha por mês com faturamento, no
 * valor do mês. A data vem da previsão gravada daquele mês; na abertura,
 * da data que a produção enviou para o mês (decisão 149, 06/10/2026). Até
 * ali ela nascia vazia, esperando o dia (Tiago, 14/09/2026) — e o mês sem
 * data enviada ainda nasce assim.
 */
function recebimentoMensalParaForm(
  meses: FaturamentoDoMes[],
  gravadas: RecebimentoLinha[],
): LinhaPrevisaoForm[] {
  return meses
    .filter((m) => m.faturamento > 0)
    .map((m) => ({
      id: `recebimento-${m.mes}`,
      data: gravadas.find((g) => g.mes === m.mes)?.data ?? "",
      valorTexto: formatMoedaTexto(m.faturamento),
      mes: m.mes,
    }));
}

/**
 * As parcelas acompanham a mudança do total — a regra do "Editar orçado"
 * (decisão 115): cada uma na proporção dela, com a mesma data, e a última
 * fecha o centavo.
 */
function acompanharTotal<T extends LinhaPrevisaoForm>(linhas: T[], delta: number): T[] {
  const valores = distribuirDelta(
    linhas.map((l) => ({ valor: parseMoeda(l.valorTexto) })),
    delta,
  );
  return linhas.map((l, i) => ({ ...l, valorTexto: formatMoedaTexto(valores[i].valor) }));
}

/** O dia comum às datas gravadas, para o campo "Dia do recebimento". Datas
 *  com dias diferentes (revisadas uma a uma) deixam o campo vazio. */
function diaComumDoRecebimento(linhas: RecebimentoLinha[]): string {
  const dias = new Set(
    linhas.filter((l) => l.mes && l.data.length === 10).map((l) => l.data.slice(8, 10)),
  );
  return dias.size === 1 ? String(Number([...dias][0])) : "";
}

/** "2026-10-01" → "Out": a coluna # do recebimento mensal. */
function mesCurto(mes: string): string {
  const nome = nomeDoMes(mes);
  return nome.charAt(0).toUpperCase() + nome.slice(1, 3);
}

export function AberturaForm({
  job,
  categorias,
  servicos,
  projetos,
  sugestaoDeProjeto,
  contas,
  custoPrevisto,
  faturamentoPrevisto,
  impostoPrevisto,
  aliquotaImposto,
  aliquotaIntTaxes,
  rentabilidade,
  saveConsumido,
  saveGerado,
  linhasDoSave,
  enviadoPorNome,
  curvaInicial,
  recebimentoInicial,
  impostosIniciais,
  faturamentoPorMes,
  trimestreSugerido,
  anoSugerido,
  competenciasIniciais,
  anos,
  hojeIso,
  agoraLabel,
  modo = "abertura",
  abertoEmLabel,
  abertoPorNome,
  fotos = [],
  revisao = null,
  linhasDaRevisao,
  aprovacaoSave,
  saves,
  opcoesDoRegistro,
  midiaSystem: midiaSystemInfo,
}: Props) {
  const router = useRouter();
  // Revisão aberta pela fila volta à fila; pela Visualizar Jobs, volta lá
  // (decisão 108). A reserva é a fila, o destino fixo de antes.
  const voltar = useVoltar("/financeiro/abertura-de-job?aba=aguardando");

  // Modo leitura só destrava quando alguém clica em "Editar registro".
  // A revisão já nasce destravada: reconferir a abertura depois de uma
  // errata É editar, e pedir um clique a mais para isso era o que deixava
  // o financeiro numa tela de leitura sem saber por quê (decisão 059).
  const [editando, setEditando] = React.useState(false);
  const ehRevisao = modo === "revisao";
  const travado = modo === "leitura" && !editando;
  // Decisão 216: a caixa "Mídia System" — na fila nasce desmarcada; no job
  // aberto, como está gravada.
  const [midiaSystem, setMidiaSystem] = React.useState(job.midia_system);
  const resumoMidia = !midiaSystem
    ? "Não"
    : midiaSystemInfo.liberadoEm
      ? "Sim · NFs liberadas"
      : "Sim · PPs sem NF até a liberação";
  const ehEdicao =
    modo === "edicao" || ehRevisao || (modo === "leitura" && editando);
  const ultimaFoto = fotos.length > 0 ? fotos[fotos.length - 1] : null;
  // O botão que fecha a revisão. Na aprovação de save é ele que aprova
  // (decisão 099): só este registro aprova, e o texto diz isso.
  const rotuloDoRegistro = aprovacaoSave
    ? aprovacaoSave.tipo === "gera"
      ? "Aprovar save e registrar revisão"
      : "Aprovar consumo e registrar revisão"
    : "Registrar revisão de abertura";

  // Na abertura o nome vem do job da produção; num job já aberto, do nome
  // que o financeiro gravou. Até 16/10/2026 nascia sempre do da produção, e
  // salvar uma edição ou revisão sem retocar o campo apagava o nome do
  // financeiro (AMB-1019/26 e ANI-1002/26 em 07/10/2026).
  const [nome, setNome] = React.useState(() => nomeDoJobNoFinanceiro(job));
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
  // Os jobs abertos embaixo de cada linha da lista (opção A) e o painel
  // com todos os projetos unificados (opção B) — decisão 228, 30/10/2026.
  const [projetosComJobsAbertos, setProjetosComJobsAbertos] = React.useState<
    Set<string>
  >(new Set());
  const [painelDeProjetosAberto, setPainelDeProjetosAberto] = React.useState(false);
  const [buscaProjeto, setBuscaProjeto] = React.useState("");
  /**
   * O projeto novo do "+": só o nome, reservado no formulário. Ele nasce
   * no banco quando o job abre (ou o registro é salvo), junto com o job —
   * todo projeto do financeiro tem pelo menos um job (decisão 119). Até
   * 28/09/2026 o "+" gravava na hora, e desistir deixava projeto solto.
   */
  const [nomeProjetoNovo, setNomeProjetoNovo] = React.useState<string | null>(
    null,
  );
  /**
   * Nomes trocados pelo lápis nesta visita. O renomear grava na hora, mas
   * a lista desce do server component; sem `router.refresh()` no meio do
   * preenchimento, o nome novo vem daqui.
   */
  const [nomesEditados, setNomesEditados] = React.useState<
    Record<string, string>
  >({});
  // O popover do botão ao lado do campo: "+" cria, lápis renomeia.
  const [cadastroProjetoAberto, setCadastroProjetoAberto] =
    React.useState(false);
  const [nomeNoCadastro, setNomeNoCadastro] = React.useState("");
  const [cadastroPending, setCadastroPending] = React.useState(false);
  const [erroCadastro, setErroCadastro] = React.useState<string | null>(null);
  // Depois de salvar, o job volta do servidor com o projeto de verdade —
  // inclusive o que acabou de nascer do nome reservado.
  React.useEffect(() => {
    setProjetoId(job.projeto_financeiro_id ?? "");
    setNomeProjetoNovo(null);
  }, [job.projeto_financeiro_id]);
  const [contaRecebId, setContaRecebId] = React.useState<string | null>(
    () => job.conta_recebimento_id,
  );
  const [contaPagId, setContaPagId] = React.useState<string | null>(
    () => job.conta_pagamento_id,
  );
  // Nasce vazia na abertura, como as outras duas, e é obrigatória quando há
  // imposto a recolher (decisão 100).
  const [contaImpId, setContaImpId] = React.useState<string | null>(
    () => job.conta_impostos_id,
  );
  const [dropConta, setDropConta] = React.useState<
    "recebimento" | "pagamento" | "impostos" | null
  >(null);
  // Serviço: chega com o do job (gravado na abertura) ou o do orçamento
  // de origem — `dados.ts` já resolve o fallback. Trocar aqui não altera
  // o orçamento (decisão 055).
  const [servicoId, setServicoId] = React.useState(() =>
    job.servico_id && servicos.some((s) => s.id === job.servico_id)
      ? job.servico_id
      : "",
  );
  // Marca, empresa e regional do job (decisão 214): chegam com as do job —
  // a marca do projeto, a empresa do projeto e a regional do orçamento — e
  // o financeiro confere e pode trocar. Valem para o job inteiro.
  const { marcas, empresas, regionais, marcasNoCadastro } = opcoesDoRegistro;
  const marcaDoJob = () =>
    job.produto_id && marcas.some((m) => m.id === job.produto_id) ? job.produto_id : "";
  const empresaDoJob = () =>
    job.empresa_id && empresas.some((e) => e.id === job.empresa_id) ? job.empresa_id : "";
  const regionalDoJob = () =>
    job.regional_id &&
    regionais.some((r) => r.id === job.regional_id && r.empresa_id === job.empresa_id)
      ? job.regional_id
      : "";
  const [marcaId, setMarcaId] = React.useState(marcaDoJob);
  // A marca criada pelo "+" entra na lista na hora: ela já está no
  // cadastro do cliente, como no "+" do formulário de projeto.
  const [marcasLocais, setMarcasLocais] = React.useState(marcas);
  const [novaMarcaAberta, setNovaMarcaAberta] = React.useState(false);
  const [empresaId, setEmpresaId] = React.useState(empresaDoJob);
  const [regionalId, setRegionalId] = React.useState(regionalDoJob);
  const regionaisDaEmpresa = regionais.filter((r) => r.empresa_id === empresaId);
  function trocarEmpresa(id: string) {
    setEmpresaId(id);
    // O projeto unificado é de uma empresa só (revisão da 228, 30/10/2026):
    // o escolhido sai se for de outra. O novo do "+" fica — ele nasce na
    // empresa do job.
    const escolhido = projetos.find((p) => p.id === projetoId);
    if (escolhido && !projetoDaEmpresa(escolhido, id)) setProjetoId("");
    const daNova = regionais.filter((r) => r.empresa_id === id);
    // Com uma regional só, ela já fica escolhida; com mais, a pessoa
    // escolhe — a de antes era de outra empresa.
    if (!daNova.some((r) => r.id === regionalId)) {
      setRegionalId(daNova.length === 1 ? daNova[0].id : "");
    }
  }

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
    paraForm(curvaInicial),
  );
  const mensal = faturamentoPorMes !== null;
  const recebimentoDoServidor = () =>
    faturamentoPorMes
      ? recebimentoMensalParaForm(faturamentoPorMes, recebimentoInicial)
      : paraForm(recebimentoInicial);
  const [recebimento, setRecebimento] = React.useState<LinhaPrevisaoForm[]>(
    recebimentoDoServidor,
  );
  const [diaRecebimento, setDiaRecebimento] = React.useState(() =>
    diaComumDoRecebimento(recebimentoInicial),
  );
  // Os seletores de data são não controlados: aplicar o dia os remonta.
  const [rodadaDoDia, setRodadaDoDia] = React.useState(0);
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
  // Por que o custo é zero (07/10/2026): linha em save não tem custo neste
  // job (decisão 028 §9). Até aqui o aviso dizia sempre "pago direto pelo
  // cliente ao fornecedor (itens de calha BV)", e o job todo em save, sem
  // nenhum item de calha BV, saía com a explicação errada.
  const custoZeroPeloSave: "todo" | "misto" | null =
    semDesembolso && linhasDoSave.emSave > 0
      ? linhasDoSave.foraDoSave > 0
        ? "misto"
        : "todo"
      : null;
  const curvaDatasOk = curva.every((l) => l.data.length === 10);
  const curvaValoresOk = linhasCurva.every((l) => l.valor > 0);
  const curvaOk =
    semDesembolso ||
    (curva.length > 0 && curvaDatasOk && curvaValoresOk && curvaBate);

  // ---------- Previsão de recebimento ----------
  const linhasReceb = recebimento.map((l) => ({
    mes: l.mes,
    data: l.data,
    valor: parseMoeda(l.valorTexto),
  }));
  const somaDoRecebimento = somaCurva(linhasReceb);
  // No mensal as linhas fecham com a soma dos meses, que pode diferir do
  // total do job por centavos de arredondamento.
  const totalDoRecebimento = faturamentoPorMes
    ? somaCurva(faturamentoPorMes.map((m) => ({ valor: m.faturamento })))
    : faturamentoPrevisto;
  const recebBate = curvaFecha(linhasReceb, totalDoRecebimento);
  const difReceb = emCentavos(somaDoRecebimento - totalDoRecebimento);

  // Espelho do custo zero: job sem faturamento previsto (tudo pago
  // direto pelo cliente ao fornecedor) abre sem previsão de entrada.
  const semRecebimento = faturamentoPrevisto <= 0;
  const recebDatasOk = recebimento.every((l) => l.data.length === 10);
  const recebValoresOk = linhasReceb.every((l) => l.valor > 0);
  const recebOk =
    semRecebimento ||
    (recebimento.length > 0 && recebDatasOk && recebValoresOk && recebBate);

  // ---------- Previsão de impostos (cronograma de recolhimento) ----------
  // Enquanto ninguém mexe nos VALORES das linhas de imposto, elas SEGUEM
  // as parcelas de recebimento: uma por parcela, na proporção dela. A data
  // nasce vazia e é escolhida à mão — escolher a data não solta o
  // cronograma. Mexer em valor, incluir, tirar ou distribuir solta; "Seguir
  // as parcelas" prende de novo.
  const semImposto = impostoPrevisto <= 0;
  const [datasImposto, setDatasImposto] = React.useState<
    Record<string, string>
  >({});
  const impostosSugeridos: LinhaImpostoForm[] = sugerirImpostos(
    recebimento.map((l, i) => ({
      valor: parseMoeda(l.valorTexto),
      origem: l.mes ? mesCurto(l.mes) : `R${String(i + 1).padStart(2, "0")}`,
    })),
    impostoPrevisto,
  ).map((l) => ({
    id: l.id,
    data: datasImposto[l.id] ?? "",
    valorTexto: formatMoedaTexto(l.valor),
    mes: null,
    origem: l.origem,
  }));
  // Job já aberto com cronograma gravado: ele chega SOLTO — é o que foi
  // registrado, e não uma sugestão. "Seguir as parcelas" refaz a partir do
  // recebimento.
  const impostosDoServidor = (): LinhaImpostoForm[] | null =>
    impostosIniciais.length > 0
      ? paraForm(impostosIniciais).map((l) => ({ ...l, origem: null }))
      : null;
  const [impostosSoltos, setImpostosSoltos] = React.useState<
    LinhaImpostoForm[] | null
  >(impostosDoServidor);
  const impostos = impostosSoltos ?? impostosSugeridos;
  const impostosSeguem = impostosSoltos === null;
  const linhasImp = impostos.map((l) => ({
    data: l.data,
    valor: parseMoeda(l.valorTexto),
  }));
  const somaDosImpostos = somaCurva(linhasImp);
  const impostosBate = curvaFecha(linhasImp, impostoPrevisto);
  const difImpostos = emCentavos(somaDosImpostos - impostoPrevisto);
  const impDatasOk = impostos.every((l) => l.data.length === 10);
  const impValoresOk = linhasImp.every((l) => l.valor > 0);

  // ---------- Os números do servidor mudaram (decisão 115) ----------
  // O "Editar orçado" do financeiro grava na hora, pela aba Planilha desta
  // mesma página, e o refresh traz faturamento, imposto e previsões novos
  // com o formulário montado (as abas escondem, não desmontam).
  //   * Em leitura, o formulário é o registro gravado: relê as previsões.
  //   * Preenchendo a abertura ou editando o registro, o que já foi
  //     preenchido fica, e o recebimento ACOMPANHA como na regra da 115:
  //     cada parcela na proporção dela, com a mesma data; no mensal, o valor
  //     de cada mês é o da planilha. Os impostos soltos acompanham do mesmo
  //     jeito — os que seguem as parcelas se refazem sozinhos. A curva de
  //     desembolso não acompanha (Tiago, 28/09/2026): se o custo previsto
  //     mudar, a diferença aparece e o "Distribuir" resolve.
  const chaveDoServidor = JSON.stringify([
    faturamentoPrevisto,
    impostoPrevisto,
    custoPrevisto,
    curvaInicial,
    recebimentoInicial,
    impostosIniciais,
    faturamentoPorMes,
  ]);
  const doServidorAnterior = React.useRef({
    chave: chaveDoServidor,
    faturamento: faturamentoPrevisto,
    imposto: impostoPrevisto,
  });
  React.useEffect(() => {
    const antes = doServidorAnterior.current;
    if (antes.chave === chaveDoServidor) return;
    doServidorAnterior.current = {
      chave: chaveDoServidor,
      faturamento: faturamentoPrevisto,
      imposto: impostoPrevisto,
    };
    if (travado) {
      setCurva(paraForm(curvaInicial));
      setRecebimento(
        faturamentoPorMes
          ? recebimentoMensalParaForm(faturamentoPorMes, recebimentoInicial)
          : paraForm(recebimentoInicial),
      );
      setDiaRecebimento(diaComumDoRecebimento(recebimentoInicial));
      setImpostosSoltos(
        impostosIniciais.length > 0
          ? paraForm(impostosIniciais).map((l) => ({ ...l, origem: null }))
          : null,
      );
      setDatasImposto({});
      setRodadaDoDia((r) => r + 1);
      return;
    }
    if (faturamentoPorMes) {
      setRecebimento((atual) =>
        recebimentoMensalParaForm(
          faturamentoPorMes,
          atual.map((l) => ({
            id: l.id,
            data: l.data,
            valor: parseMoeda(l.valorTexto),
            mes: l.mes,
          })),
        ),
      );
    } else if (antes.faturamento !== faturamentoPrevisto) {
      setRecebimento((atual) =>
        faturamentoPrevisto <= 0
          ? []
          : atual.length === 0
            ? paraForm(recebimentoInicial)
            : acompanharTotal(atual, faturamentoPrevisto - antes.faturamento),
      );
    }
    if (antes.imposto !== impostoPrevisto) {
      setImpostosSoltos((atual) =>
        atual === null || atual.length === 0
          ? atual
          : acompanharTotal(atual, impostoPrevisto - antes.imposto),
      );
    }
  }, [
    chaveDoServidor,
    travado,
    faturamentoPrevisto,
    impostoPrevisto,
    curvaInicial,
    recebimentoInicial,
    impostosIniciais,
    faturamentoPorMes,
  ]);
  // As três contas são obrigatórias quando a previsão delas existe
  // (decisão 100) — até 23/09/2026 as de recebimento e pagamento eram
  // opcionais.
  const contaImpOk = semImposto || contaImpId !== null;
  const impostosOk =
    semImposto ||
    (impostos.length > 0 &&
      impDatasOk &&
      impValoresOk &&
      impostosBate &&
      contaImpOk);

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
  // ---------- Saves do job (decisão 155) ----------
  // Abrir o job aprova os saves que vieram com ele, e por isso só abre com
  // a aprovação marcada: uma caixa por tipo presente ("Aprovar save gerado",
  // "Aprovar consumo de save" — uma só para todo o consumo, de quantos jobs
  // de origem for). Só a abertura marca; nos outros modos o bloco é leitura.
  const linhasDeSave = saves?.linhas ?? [];
  const savesNaAbertura = modo === "abertura" && linhasDeSave.length > 0;
  const resumoSaves = resumirSaves(linhasDeSave);
  const [aprovaGera, setAprovaGera] = React.useState(false);
  const [aprovaConsumo, setAprovaConsumo] = React.useState(false);
  const faltaGera =
    savesNaAbertura && resumoSaves.gera.linhas > 0 && !aprovaGera;
  const faltaConsumo =
    savesNaAbertura && resumoSaves.consome.linhas > 0 && !aprovaConsumo;
  const faltaAprovarSaves = faltaGera || faltaConsumo;

  const podeAbrir =
    nomeOk &&
    projetoOk &&
    categoriaId !== "" &&
    servicoOk &&
    marcaId !== "" &&
    empresaId !== "" &&
    regionalId !== "" &&
    rateioOk &&
    curvaOk &&
    recebOk &&
    impostosOk &&
    (semRecebimento || contaRecebId !== null) &&
    (semDesembolso || contaPagId !== null) &&
    !faltaAprovarSaves;

  const categoriaNome =
    categorias.find((c) => c.id === categoriaId)?.nome ?? "— não informada";
  const servicoNome =
    servicos.find((s) => s.id === servicoId)?.nome ?? "— não informado";
  const marcaNome = marcasLocais.find((m) => m.id === marcaId)?.nome ?? "— não informada";
  const regionalNome =
    regionais.find((r) => r.id === regionalId)?.nome ?? "— não informada";
  const empresaNomeEscolhida =
    empresas.find((e) => e.id === empresaId)?.nome ?? "— não informada";
  const competenciaLabel = rateioLabel(compsNumericas);
  // "3T/2026 +1": o resumo curto ao lado do rótulo do campo.
  const competenciaResumo =
    compsOrdenadas.length === 0
      ? "—"
      : `${compsOrdenadas[0].trimestre}T/${compsOrdenadas[0].ano}${
          temRateio ? ` +${compsOrdenadas.length - 1}` : ""
        }`;

  // ---------- Projeto do financeiro ----------
  // A lista do servidor, com os nomes do lápis, e o projeto novo reservado
  // no topo — ele ainda não tem código: o sistema gera ao gravar.
  const projetosVisiveis = React.useMemo<OpcaoDeProjeto[]>(() => {
    const lista = projetos.filter((p) => projetoDaEmpresa(p, empresaId)).map((p) => ({
      ...p,
      nome: nomesEditados[p.id] ?? p.nome,
      novo: false,
    }));
    return nomeProjetoNovo === null
      ? lista
      : [
          {
            id: PROJETO_NOVO,
            codigo: "",
            nome: nomeProjetoNovo,
            cliente_id: job.cliente_id ?? "",
            cliente_nome: job.cliente_nome,
            clientes: [{ id: job.cliente_id ?? "", nome: job.cliente_nome }],
            empresas: [],
            jobs: [],
            novo: true,
          },
          ...lista,
        ];
  }, [projetos, nomesEditados, nomeProjetoNovo, job.cliente_id, job.cliente_nome, empresaId]);
  const projetoSel = projetosVisiveis.find((p) => p.id === projetoId) ?? null;
  // Sem acento e sem caixa, no nome e no código — o mesmo critério do
  // campo de fornecedor (`components/ui/combobox.tsx`).
  const projetosFiltrados = React.useMemo(() => {
    const normalizar = (t: string) =>
      t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const q = normalizar(buscaProjeto.trim());
    if (!q) return projetosVisiveis;
    return projetosVisiveis.filter(
      (p) =>
        // Pelo nome e pelos clientes que já estão dentro — o código do
        // projeto não aparece (27/10/2026).
        normalizar(p.nome).includes(q) ||
        p.clientes.some((c) => normalizar(c.nome ?? "").includes(q)),
    );
  }, [projetosVisiveis, buscaProjeto]);
  // A busca acha projeto de qualquer cliente (decisão 228); os do cliente
  // do job ficam num grupo à parte, em cima — o servidor já manda nessa
  // ordem, e o projeto novo é sempre deste cliente.
  const ehDoClienteDoJob = (p: OpcaoDeProjeto) =>
    p.novo ||
    p.cliente_id === job.cliente_id ||
    p.clientes.some((c) => c.id === job.cliente_id);
  const gruposDeProjeto = [
    {
      titulo: "Projetos abertos deste cliente",
      itens: projetosFiltrados.filter(ehDoClienteDoJob),
    },
    {
      titulo: "Projetos abertos de outros clientes",
      itens: projetosFiltrados.filter((p) => !ehDoClienteDoJob(p)),
    },
  ].filter((g) => g.itens.length > 0);
  function escolherProjeto(id: string) {
    setProjetoId(id);
    setProjetoAberto(false);
    setBuscaProjeto("");
  }
  function alternarJobsDoProjeto(id: string) {
    setProjetosComJobsAbertos((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }
  /** O ✕ do campo: zera a escolha e devolve o "+". O projeto novo
   *  reservado, que ainda não existe, sai junto. */
  function limparProjeto() {
    if (projetoId === PROJETO_NOVO) setNomeProjetoNovo(null);
    setProjetoId("");
  }
  const projetoLabel = projetoSel?.nome ?? "Selecione o projeto unificado";
  // Sem o código do projeto, que não aparece para o usuário (pedido do
  // Tiago, 27/10/2026).
  const projetoResumo = projetoSel
    ? projetoSel.novo
      ? `${projetoSel.nome} · projeto novo`
      : projetoSel.nome
    : "— não informado";
  // Quando o projeto novo passa a existir: é o que o "+" explica.
  const quandoNasceProjeto =
    modo === "abertura"
      ? "quando o job for aberto"
      : ehRevisao
        ? "quando a revisão for registrada"
        : "quando o registro for salvo";
  // O projeto da produção fica como referência, e é explicitamente outra
  // coisa: mexer aqui não move o job em Orçamentos.
  const projetoDica = `Arrumação do financeiro. Na produção, o job segue no projeto ${job.projeto_nome ?? "—"}.`;

  // ---------- Contas bancárias ----------
  const contaReceb = contas.find((c) => c.id === contaRecebId) ?? null;
  const contaPag = contas.find((c) => c.id === contaPagId) ?? null;
  const contaImp = contas.find((c) => c.id === contaImpId) ?? null;


  // Rentabilidade: valor do job − impostos − custo planejado, a mesma conta
  // do resultado operacional planejado da planilha interna (Tiago,
  // 07/10/2026). Até ali (decisão 100 §4) ela olhava só o caixa —
  // faturamento − custo previsto − impostos da nota —, e o job pago com
  // saldo de save de outro job, sem nada a faturar, saía com rentabilidade
  // negativa igual ao custo inteiro.
  // A conta mora em `rentabilidadeDoJob`: as listas do financeiro mostram
  // o mesmo número (decisão 207).
  const { valor: margem, percentual: margemPct } = rentabilidadeDoJob(rentabilidade);

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
  const qtdDatasImpostoLabel = semImposto
    ? "Sem imposto"
    : impostos.length === 1
      ? "1 data"
      : `${impostos.length} datas`;

  const textoValidacao = !nomeOk
    ? "Informe o nome do job."
    : !projetoOk
      ? "Selecione o projeto unificado do job."
      : categoriaId === ""
      ? "Selecione a categoria do job."
      : !servicoOk
        ? "Selecione o serviço do job."
        : marcaId === ""
          ? "Selecione a marca do job."
        : empresaId === ""
          ? "Selecione a empresa do job."
        : regionalId === ""
          ? empresaId !== empresaDoJob()
            ? `Selecione a regional da ${empresaNomeEscolhida}.`
            : "Selecione a regional do job."
        : !rateioValoresOk
          ? "Cada competência do rateio precisa de um percentual maior que zero."
          : !rateioFecha
            ? "O rateio de competências precisa somar 100%."
      : !semRecebimento && !recebDatasOk
        ? mensal
          ? "Informe o dia do recebimento, ou a data de cada mês."
          : "Preencha a data de todas as parcelas de recebimento."
        : !semRecebimento && !recebValoresOk
          ? "Cada parcela de recebimento precisa de um valor maior que zero."
          : !semRecebimento && !recebBate
            ? "As parcelas de recebimento precisam somar o faturamento previsto."
            : !semDesembolso && !curvaDatasOk
              ? "Preencha a data de todas as linhas da curva."
              : !semDesembolso && !curvaValoresOk
                ? "Cada data da curva precisa de um valor maior que zero."
                : !semDesembolso && !curvaBate
                  ? "A curva precisa somar o custo previsto."
                  : !semImposto && !impDatasOk
                    ? "Preencha a data de todos os recolhimentos de impostos."
                    : !semImposto && !impValoresOk
                      ? "Cada recolhimento de impostos precisa de um valor maior que zero."
                      : !semImposto && !impostosBate
                        ? "O recolhimento de impostos precisa somar os impostos previstos."
                        : !semRecebimento && !contaRecebId
                          ? "Selecione a conta de recebimento."
                        : !semDesembolso && !contaPagId
                          ? "Selecione a conta de pagamento."
                        : !contaImpOk
                          ? "Selecione a conta dos impostos."
                        // A aprovação dos saves é a última conferência
                        // (decisão 155): marca-se depois de conferir o resto.
                        : faltaAprovarSaves
                          ? faltaGera && faltaConsumo
                            ? "Marque a aprovação dos saves para abrir o job."
                            : faltaGera
                              ? "Marque “Aprovar save gerado” para abrir o job."
                              : "Marque “Aprovar consumo de save” para abrir o job."
                        : semDesembolso
                          ? "Tudo pronto. Este job não tem desembolso previsto pela California — abre sem curva."
                          : temRateio
                            ? `Tudo pronto: nome, categoria, serviço, marca, empresa, regional, competência rateada em ${comps.length} trimestres, recebimento, custos e impostos preenchidos.`
                            : "Tudo pronto: nome, categoria, serviço, marca, empresa, regional, competência, recebimento, custos e impostos preenchidos.";

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

  /** Divide o total em partes iguais entre as linhas — todas elas,
   *  desde que a trava das parcelas consumidas caiu (decisão 061). */
  function distribuirEntreLinhas(
    linhas: LinhaPrevisaoForm[],
    total: number,
  ): LinhaPrevisaoForm[] {
    const valores = dividirEmParcelas(Math.max(0, total), linhas.length);
    return linhas.map((l, i) => ({
      ...l,
      valorTexto: formatMoedaTexto(valores[i] ?? 0),
    }));
  }

  function distribuirCurva() {
    setCurva((atual) => distribuirEntreLinhas(atual, custoPrevisto));
  }

  function distribuirRecebimento() {
    setRecebimento((atual) =>
      distribuirEntreLinhas(atual, faturamentoPrevisto),
    );
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
        mes: null,
      },
    ]);
  }

  /** "Dia do recebimento": cada mês recebe nesse dia do mês seguinte. As
   *  datas continuam editáveis uma a uma depois. */
  function aplicarDiaDoRecebimento(texto: string) {
    const limpo = texto.replace(/\D/g, "").slice(0, 2);
    setDiaRecebimento(limpo);
    const dia = Number(limpo);
    if (!limpo || dia < 1 || dia > 31) return;
    setRecebimento((atual) =>
      atual.map((l) =>
        l.mes ? { ...l, data: dataDeRecebimentoDoMes(l.mes, dia) } : l,
      ),
    );
    setRodadaDoDia((r) => r + 1);
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
        mes: null,
      },
    ]);
  }

  /** A última linha não sai: a previsão precisa de pelo menos um lugar
   *  para o total pousar. */
  function podeRemover(linhas: LinhaPrevisaoForm[], id: string): boolean {
    if (!linhas.some((l) => l.id === id)) return false;
    return linhas.length > 1;
  }

  function removerDaCurva(id: string) {
    if (!podeRemover(curva, id)) return;
    setCurva((atual) => atual.filter((l) => l.id !== id));
  }

  function removerDoRecebimento(id: string) {
    if (!podeRemover(recebimento, id)) return;
    setRecebimento((atual) => atual.filter((l) => l.id !== id));
  }

  // ---------- Impostos ----------
  // Toda mexida numa linha de imposto parte do que está na tela (a
  // sugestão, enquanto o cronograma segue as parcelas) e o solta.
  function mexerNosImpostos(
    f: (atual: LinhaImpostoForm[]) => LinhaImpostoForm[],
  ) {
    setImpostosSoltos(f(impostos));
  }

  function atualizarImposto(id: string, patch: Partial<LinhaImpostoForm>) {
    // Só a data, com o cronograma seguindo as parcelas: guarda a data e
    // continua seguindo.
    if (impostosSeguem && Object.keys(patch).every((k) => k === "data")) {
      setDatasImposto((atual) => ({ ...atual, [id]: patch.data ?? "" }));
      return;
    }
    mexerNosImpostos((atual) =>
      atual.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    );
  }

  function distribuirImpostos() {
    mexerNosImpostos((atual) =>
      distribuirEntreLinhas(atual, impostoPrevisto).map((l, i) => ({
        ...l,
        origem: atual[i].origem,
      })),
    );
  }

  function adicionarDataImposto() {
    mexerNosImpostos((atual) => [
      ...atual,
      {
        id: `imposto-novo-${Date.now()}`,
        data: "",
        valorTexto: "0,00",
        mes: null,
        origem: null,
      },
    ]);
  }

  function removerDoImposto(id: string) {
    if (!podeRemover(impostos, id)) return;
    mexerNosImpostos((atual) => atual.filter((l) => l.id !== id));
  }

  /** Abre o popover do botão ao lado do campo, já com o nome certo. */
  function abrirCadastroProjeto(aberto: boolean) {
    setCadastroProjetoAberto(aberto);
    if (!aberto) return;
    setNomeNoCadastro(projetoSel?.nome ?? "");
    setErroCadastro(null);
  }

  /**
   * O botão do popover. Três casos, como no campo de fornecedor
   * (`campo-fornecedor.tsx`): sem projeto escolhido, o "+" reserva um
   * projeto novo; com o novo escolhido, o lápis troca o nome reservado;
   * com um que já existe, o lápis renomeia no banco, na hora.
   *
   * Reservar não grava nada — o projeto nasce com o job (decisão 119). O
   * nome é conferido agora mesmo assim: repetido é recusado pelo banco, e
   * saber disso só no fim da abertura seria tarde.
   */
  function confirmarCadastroProjeto() {
    const nomeLimpo = nomeNoCadastro.trim();
    if (nomeLimpo.length < 2 || cadastroPending) return;
    if (projetoSel && nomeLimpo === projetoSel.nome) {
      setCadastroProjetoAberto(false);
      return;
    }

    setErroCadastro(null);
    setCadastroPending(true);

    if (!projetoSel || projetoSel.novo) {
      void conferirNomeDeProjetoFinanceiro(nomeLimpo, null).then((res) => {
        setCadastroPending(false);
        if (!res.ok) {
          setErroCadastro(res.message);
          return;
        }
        setNomeProjetoNovo(nomeLimpo);
        setProjetoId(PROJETO_NOVO);
        setCadastroProjetoAberto(false);
        setProjetoAberto(false);
      });
      return;
    }

    const projetoEditado = projetoSel.id;
    void renomearProjetoFinanceiro(projetoEditado, nomeLimpo).then((res) => {
      setCadastroPending(false);
      if (!res.ok) {
        setErroCadastro(res.message);
        return;
      }
      setNomesEditados((atual) => ({ ...atual, [projetoEditado]: res.nome }));
      setCadastroProjetoAberto(false);
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
      // Um projeto que existe OU o nome do novo (decisão 119).
      projeto_financeiro_id:
        projetoId === "" || projetoId === PROJETO_NOVO ? null : projetoId,
      projeto_financeiro_novo:
        projetoId === PROJETO_NOVO ? nomeProjetoNovo : null,
      conta_recebimento_id: contaRecebId,
      conta_pagamento_id: contaPagId,
      conta_impostos_id: contaImpId,
      categoria_id: categoriaId,
      servico_id: servicoId,
      produto_id: marcaId,
      empresa_id: empresaId,
      regional_id: regionalId,
      midia_system: midiaSystem,
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
            mes: l.mes,
          })),
      impostos: semImposto
        ? []
        : linhasImp.map((l) => ({
            data_prevista: l.data,
            valor: l.valor,
          })),
    };
  }

  // ---------- Saída com preenchimento não gravado (decisão 111) ----------
  // A abertura só grava ao confirmar. Com as abas do job na mesma página,
  // consultar é trocar de aba, e o formulário fica montado; mas um link que
  // sai da página descartaria o que foi preenchido. A "foto" é o formulário
  // como ele chegou do servidor — todo o estado inicial vem das props, sem
  // efeito no mount, então a primeira renderização já é a foto certa.
  const assinatura = JSON.stringify(montarPayload());
  const [assinaturaInicial] = React.useState(assinatura);
  const preenchimentoPendente =
    modo === "abertura" && assinatura !== assinaturaInicial;
  const [saidaPendente, setSaidaPendente] = React.useState<string | null>(
    null,
  );

  // Fechar a aba e recarregar: o aviso do próprio navegador.
  React.useEffect(() => {
    if (!preenchimentoPendente) return;
    function avisar(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [preenchimentoPendente]);

  // O Voltar do topo e as saídas para outro módulo (decisão 108) caem na
  // mesma confirmação desta tela.
  useProtegerSaida(preenchimentoPendente, (href) => setSaidaPendente(href));

  // Os demais links que saem da página — o menu lateral e os links das abas
  // Informações e Planilha — navegam por dentro do app e passariam direto.
  // Um ouvinte na fase de CAPTURA os segura antes do onClick do Link do
  // Next. Clique com ctrl/cmd, botão do meio ou alvo em outra aba não
  // descarta nada e passa.
  React.useEffect(() => {
    if (!preenchimentoPendente) return;
    function segurar(e: MouseEvent) {
      if (
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey
      ) {
        return;
      }
      const alvo =
        e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (!(alvo instanceof HTMLAnchorElement)) return;
      if (alvo.target && alvo.target !== "_self") return;
      if (alvo.hasAttribute("download")) return;
      // O Voltar tem a proteção dele (acima): ele anota o rastro da aba
      // antes de sair, e segurá-lo aqui pularia essa anotação.
      if (alvo.closest("[data-voltar-da-pagina]")) return;
      const destino = new URL(alvo.href, window.location.href);
      if (destino.origin !== window.location.origin) return;
      // Mesma página — outra aba, outro mês da planilha: nada se perde.
      if (destino.pathname === window.location.pathname) return;
      e.preventDefault();
      e.stopPropagation();
      setSaidaPendente(destino.pathname + destino.search + destino.hash);
    }
    document.addEventListener("click", segurar, true);
    return () => document.removeEventListener("click", segurar, true);
  }, [preenchimentoPendente]);

  const nomeDoDestino = saidaPendente
    ? nomeDaPagina(saidaPendente, {})
    : null;

  function confirmarAbertura() {
    setErro(null);
    startTransition(async () => {
      // As caixas vão junto (decisão 155): a action confere que cada tipo
      // de save presente no job foi marcado antes de aprovar os pedidos.
      const res = await abrirJobNoFinanceiro(job.id, montarPayload(), {
        gera: aprovaGera,
        consumo: aprovaConsumo,
      });

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
      const res = await editarRegistroDaAbertura(job.id, montarPayload(), null);

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
      // Na aprovação de save (decisão 099) o mesmo registro leva o id do
      // pedido: a action aprova e registra a revisão, nessa ordem.
      const res = await editarRegistroDaAbertura(
        job.id,
        montarPayload(),
        aprovacaoSave?.pedidoId ?? null,
      );

      if (!res.ok) {
        setErro(res.message);
        setConfirmarAberto(false);
        // A aprovação pode ter entrado e o registro, não (a mensagem diz).
        // Reler a página tira a faixa de um pedido que já não aguarda — sem
        // isso, tentar de novo daria "já foi decidido".
        if (aprovacaoSave) router.refresh();
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
    setNome(nomeDoJobNoFinanceiro(job));
    setProjetoId(job.projeto_financeiro_id ?? "");
    setNomeProjetoNovo(null);
    setContaRecebId(job.conta_recebimento_id);
    setContaPagId(job.conta_pagamento_id);
    setContaImpId(job.conta_impostos_id);
    setMarcasLocais(marcas);
    setMarcaId(marcaDoJob());
    setEmpresaId(empresaDoJob());
    setRegionalId(regionalDoJob());
    setMidiaSystem(job.midia_system);
    setImpostosSoltos(impostosDoServidor());
    setDatasImposto({});
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
    setCurva(paraForm(curvaInicial));
    setRecebimento(recebimentoDoServidor());
    setDiaRecebimento(diaComumDoRecebimento(recebimentoInicial));
    setRodadaDoDia((r) => r + 1);
    setCadastroProjetoAberto(false);
    setProjetoAberto(false);
    setDropConta(null);
    setEditando(false);
  }

  const dadosProducao: { rotulo: string; valor: string; mono?: boolean }[] = [
    { rotulo: "Job", valor: job.nome },
    { rotulo: "Código", valor: job.codigo, mono: true },
    // Só o nome: o único código do painel é o do job (decisão 135).
    { rotulo: "Projeto", valor: job.projeto_nome ?? "—" },
    // A empresa do job, que vem do projeto (Tiago, 19/10/2026).
    { rotulo: "Empresa", valor: job.empresa_nome ?? "—" },
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
    // Mesma regra do diálogo de conferência: a data é de recebimento, não
    // de faturamento (27/08/2026). Sem faturamento previsto não há
    // recebimento (decisão 105); no Fee e no Always On, uma linha por mês
    // (decisão 149).
    ...linhasDoRecebimentoEnviado(
      job.data_prevista_faturamento,
      job.recebimento_previsto_por_mes,
      semRecebimento,
    ),
  ];

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
        <ResumoDaAberturaAnterior
          foto={ultimaFoto}
          revisao={revisao}
          aprovacaoSave={aprovacaoSave}
        />
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
            salvar reescreve serviço, categoria, marca, empresa, regional, projeto e competência — a
            data e o usuário da abertura não mudam
          </span>
        </div>
      )}

      {/* O cabeçalho grande da abertura ("Abrir job no financeiro") mora na
          página da fila desde a decisão 111, ACIMA das abas do job: o
          formulário é só o conteúdo da aba "Abertura do Job". Dentro da aba
          do job aberto a página já tem o próprio cabeçalho. */}

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
                  Projeto unificado <span className="text-california-red">*</span>
                </span>
                <div className="flex items-center gap-2">
                  <Popover
                    open={projetoAberto}
                    onOpenChange={(o) => {
                      if (travado) return;
                      setProjetoAberto(o);
                      if (!o) setBuscaProjeto("");
                    }}
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
                          {projetoSel?.novo && <SeloProjetoNovo />}
                        </span>
                        {/* Zerar a escolha devolve o "+" (decisão 119), como
                            o ✕ do campo de fornecedor. <span> e não
                            <button>: o gatilho já é um botão, e o clique
                            para aqui antes de abrir a lista. */}
                        {!travado && projetoSel && (
                          <span
                            role="button"
                            tabIndex={0}
                            aria-label="Limpar projeto"
                            title="Limpar projeto"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              limparProjeto();
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                e.stopPropagation();
                                limparProjeto();
                              }
                            }}
                            className="inline-flex h-5 w-5 flex-none items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors hover:bg-california-red/10 hover:text-california-red"
                          >
                            <X className="h-3 w-3" />
                          </span>
                        )}
                        {!travado && (
                          <ChevronDown className="h-[15px] w-[15px] shrink-0 text-[#8a8a8a]" />
                        )}
                      </button>
                    </PopoverTrigger>
                    {/* Busca digitável (decisão 111, revisão de 28/09): com
                        muitos projetos, a lista só se acha digitando. O
                        texto de fundo da busca traz a sugestão — o projeto
                        do último job aberto no mesmo projeto da produção —
                        para a pessoa digitar o nome que está vendo. */}
                    <PopoverContent
                      className="w-[var(--radix-popover-trigger-width)] min-w-[320px] p-0"
                      align="start"
                    >
                      <div className="border-b border-border p-2">
                        <Input
                          autoFocus
                          aria-label="Buscar projeto"
                          value={buscaProjeto}
                          onChange={(e) => setBuscaProjeto(e.target.value)}
                          onKeyDown={(e) => {
                            // Enter escolhe o primeiro da lista filtrada.
                            if (e.key === "Enter" && projetosFiltrados[0]) {
                              e.preventDefault();
                              escolherProjeto(projetosFiltrados[0].id);
                            }
                          }}
                          placeholder={
                            sugestaoDeProjeto
                              ? `Sugestão: ${sugestaoDeProjeto.nome} — último job deste projeto (${sugestaoDeProjeto.jobCodigo})`
                              : "Digite o nome do projeto"
                          }
                          className="h-9 text-[13px]"
                        />
                      </div>
                      <p className="border-b border-border px-4 py-2 text-[11.5px] text-muted-foreground">
                        Só os projetos unificados de{" "}
                        <strong className="font-semibold text-foreground">
                          {empresaNomeEscolhida}
                        </strong>
                        . Para ver os de outra empresa, troque a empresa do job.
                      </p>
                      <div className="max-h-72 overflow-y-auto px-1.5 pb-1.5">
                        {projetosVisiveis.length === 0 ? (
                          <p className="px-2.5 pb-2 pt-2.5 text-[12px] text-muted-foreground">
                            Nenhum projeto unificado aberto nesta empresa.
                            Crie um no “+” ao lado.
                          </p>
                        ) : projetosFiltrados.length === 0 ? (
                          <p className="px-2.5 pb-2 pt-2.5 text-[12px] text-muted-foreground">
                            Nenhum projeto com “{buscaProjeto.trim()}”.{" "}
                            {projetoSel
                              ? "Confira o nome, ou limpe o campo no ✕ e crie um no “+”."
                              : "Confira o nome ou crie um no “+” ao lado."}
                          </p>
                        ) : (
                          gruposDeProjeto.map((grupo) => (
                            <div key={grupo.titulo}>
                              <p className="px-2.5 pb-1 pt-2.5 text-[10px] font-bold uppercase tracking-[0.09em] text-[#8a8a8a]">
                                {grupo.titulo}
                              </p>
                              {grupo.itens.map((pr) => (
                                <LinhaDoProjetoUnificado
                                  key={pr.id}
                                  pr={pr}
                                  selecionado={pr.id === projetoId}
                                  seloNovo={<SeloProjetoNovo />}
                                  aberta={projetosComJobsAbertos.has(pr.id)}
                                  onEscolher={() => escolherProjeto(pr.id)}
                                  onAlternar={() => alternarJobsDoProjeto(pr.id)}
                                />
                              ))}
                            </div>
                          ))
                        )}
                      </div>
                      <BotaoTodosOsProjetos
                        onAbrir={() => {
                          setProjetoAberto(false);
                          setBuscaProjeto("");
                          setPainelDeProjetosAberto(true);
                        }}
                      />
                    </PopoverContent>
                  </Popover>
                  <TodosOsProjetosDialog
                    open={painelDeProjetosAberto}
                    onOpenChange={setPainelDeProjetosAberto}
                    projetos={projetosVisiveis}
                    ehDoClienteDoJob={ehDoClienteDoJob}
                    clienteDoJobNome={job.cliente_nome}
                    empresaNome={empresaNomeEscolhida}
                    jobCodigo={job.codigo}
                    selecionadoId={projetoId}
                    onEscolher={(id) => {
                      escolherProjeto(id);
                      setPainelDeProjetosAberto(false);
                    }}
                  />

                  {/* "+" cria, lápis revisa o escolhido — o MESMO botão
                      trocando de ícone, como no campo de fornecedor
                      (decisão 119). O ✕ do campo é o que devolve o "+". */}
                  {!travado && (
                    <Popover
                      open={cadastroProjetoAberto}
                      onOpenChange={abrirCadastroProjeto}
                    >
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          title={
                            projetoSel
                              ? "Editar nome do projeto"
                              : "Criar projeto para este job"
                          }
                          aria-label={
                            projetoSel
                              ? "Editar nome do projeto"
                              : "Criar projeto para este job"
                          }
                          className="inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-lg border border-border bg-white text-muted-foreground transition-colors hover:border-california-red hover:text-california-red"
                        >
                          {projetoSel ? (
                            <Pencil className="h-4 w-4" />
                          ) : (
                            <Plus className="h-[17px] w-[17px]" />
                          )}
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        className="w-[420px] border-california-red/30 p-4"
                        align="end"
                      >
                        <p className="text-[12.5px] font-semibold">
                          {projetoSel ? "Editar nome do projeto" : "Criar projeto para este job"}
                        </p>
                        <div className="mt-2.5 flex flex-wrap items-center gap-2">
                          <input
                            autoFocus
                            aria-label="Nome do projeto"
                            value={nomeNoCadastro}
                            onChange={(e) => {
                              setNomeNoCadastro(e.target.value);
                              setErroCadastro(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                confirmarCadastroProjeto();
                              }
                            }}
                            placeholder="Nome do novo projeto"
                            maxLength={200}
                            className="h-9 min-w-[180px] flex-1 rounded-lg border border-border bg-white px-3 text-[13px] font-medium outline-none focus:border-california-red/40"
                          />
                          <button
                            type="button"
                            onClick={confirmarCadastroProjeto}
                            disabled={
                              nomeNoCadastro.trim().length < 2 || cadastroPending
                            }
                            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-california-red px-3 text-[12.5px] font-bold text-white transition-colors hover:bg-california-red-hover disabled:cursor-not-allowed disabled:opacity-45"
                          >
                            <Check className="h-3.5 w-3.5" />
                            {cadastroPending
                              ? projetoSel && !projetoSel.novo
                                ? "Salvando..."
                                : "Conferindo..."
                              : projetoSel
                                ? "Salvar nome"
                                : "Criar e vincular"}
                          </button>
                        </div>
                        {erroCadastro && (
                          <p
                            role="alert"
                            className="mt-2 flex items-start gap-1.5 text-[11.5px] font-medium leading-snug text-california-red"
                          >
                            <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
                            {erroCadastro}
                          </p>
                        )}
                        <p className="mt-2.5 text-[11px] leading-relaxed text-muted-foreground">
                          {projetoSel && !projetoSel.novo ? (
                            <>
                              O nome muda na hora, para todos os jobs deste
                              projeto — não espera o resto do formulário. O
                              cliente não muda.
                            </>
                          ) : (
                            <>
                              O projeto é criado {quandoNasceProjeto}, junto com
                              o job — nenhum projeto fica sem job. O cliente
                              vem do orçamento de origem. Vale só no
                              financeiro: a produção continua vendo o job no
                              projeto {job.projeto_nome ?? "—"}.
                            </>
                          )}
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
                    {/* Em breve no fim, travada — como no formulário do
                        orçamento (decisão 131). */}
                    {[...categorias]
                      .sort((a, b) => Number(a.em_breve) - Number(b.em_breve))
                      .map((c) => (
                        <SelectItem
                          key={c.id}
                          value={c.id}
                          disabled={c.em_breve}
                          className={
                            c.em_breve
                              ? "text-muted-foreground/80 data-[disabled]:opacity-100"
                              : undefined
                          }
                        >
                          {c.nome}
                          {c.em_breve && (
                            <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-px align-[1px] text-[10.5px] font-semibold text-muted-foreground">
                              <Lock className="h-2.5 w-2.5" aria-hidden="true" />
                              Em breve
                            </span>
                          )}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <span className="text-[11px] text-muted-foreground">
                  Vem do orçamento{" "}
                  <span className="font-medium text-foreground/80">{job.orcamento_nome ?? "—"}</span>
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
                      <span className="font-medium text-foreground/80">
                        {job.orcamento_nome ?? "—"}
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

              {/* Empresa e regional, cliente e marca (decisão 214): duas
                  linhas logo depois de Categoria e Serviço. O cliente não
                  muda aqui; marca, empresa e regional chegam com as do job
                  e o financeiro pode trocar — vale para o job inteiro,
                  também na produção. A regional é sempre da empresa
                  escolhida. */}
              <div className="grid gap-4 md:col-span-2 md:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-1.5">
                  <label
                    htmlFor="empresa-job"
                    className="text-[12.5px] font-semibold"
                  >
                    Empresa <span className="text-california-red">*</span>
                  </label>
                  <Select
                    value={empresaId}
                    onValueChange={trocarEmpresa}
                    disabled={travado}
                  >
                    <SelectTrigger
                      id="empresa-job"
                      className={cn(
                        "h-[42px]",
                        !travado && empresaId === "" && "border-california-red/45",
                      )}
                    >
                      <SelectValue placeholder="Selecione a empresa" />
                    </SelectTrigger>
                    <SelectContent>
                      {empresas.map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-[11px] text-muted-foreground">
                    Vem da produção. A troca vale para o job todo, e a regional
                    segue a empresa.
                  </span>
                </div>

                <div className="flex min-w-0 flex-col gap-1.5">
                  <label
                    htmlFor="regional-job"
                    className="text-[12.5px] font-semibold"
                  >
                    Regional <span className="text-california-red">*</span>
                  </label>
                  <Select
                    value={regionalId}
                    onValueChange={setRegionalId}
                    disabled={travado}
                  >
                    <SelectTrigger
                      id="regional-job"
                      className={cn(
                        "h-[42px]",
                        !travado && regionalId === "" && "border-california-red/45",
                      )}
                    >
                      <SelectValue placeholder="Selecione a regional" />
                    </SelectTrigger>
                    <SelectContent>
                      {regionaisDaEmpresa.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-[11px] text-muted-foreground">
                    {empresaId
                      ? `Só as regionais da ${empresaNomeEscolhida}. A troca vale para o job todo, também na produção.`
                      : "Escolha a empresa primeiro."}
                  </span>
                </div>

                <div className="flex min-w-0 flex-col gap-1.5">
                  <span className="text-[12.5px] font-semibold">Cliente</span>
                  <div
                    title="O cliente vem do orçamento e não muda aqui"
                    className="flex h-[42px] min-w-0 items-center gap-2.5 rounded-lg border border-border bg-muted/60 px-3"
                  >
                    <Building2 className="h-[15px] w-[15px] shrink-0 text-[#8a8a8a]" />
                    <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">
                      {job.cliente_nome ?? "—"}
                    </span>
                    <Lock
                      className="h-3.5 w-3.5 shrink-0 text-[#8a8a8a]"
                      aria-label="Travado"
                    />
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    Vem do orçamento{" "}
                    <span className="font-medium text-foreground/80">
                      {job.orcamento_nome ?? "—"}
                    </span>
                    . Não muda no financeiro.
                  </span>
                </div>

                <div className="flex min-w-0 flex-col gap-1.5">
                  <label
                    htmlFor="marca-job"
                    className="text-[12.5px] font-semibold"
                  >
                    Marca <span className="text-california-red">*</span>
                  </label>
                  {/* Escolher uma marca do cliente ou cadastrar outra pelo
                      "+", o mesmo pop-up do campo Marcas do projeto. */}
                  <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                  <Combobox
                    id="marca-job"
                    items={marcasLocais.map((m) => ({
                      value: m.id,
                      label: m.nome,
                      descricao: m.padrao ? `${m.codigo} · marca geral do cliente` : m.codigo,
                    }))}
                    value={marcaId || null}
                    onChange={(v) => setMarcaId(v ?? "")}
                    disabled={travado}
                    placeholder="Selecione a marca"
                    buscaPlaceholder="Buscar marca..."
                    className={cn(
                      "h-[42px] border-border px-3.5 text-[13.5px] font-medium",
                      travado && "bg-muted/60 disabled:opacity-100 text-muted-foreground",
                      !travado && marcaId === "" && "border-california-red/45",
                    )}
                  />
                  </div>
                  {!travado && (
                    <button
                      type="button"
                      onClick={() => setNovaMarcaAberta(true)}
                      title="Cadastrar marca deste cliente"
                      aria-label="Cadastrar marca deste cliente"
                      className="inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-lg border border-border bg-white text-muted-foreground transition-colors hover:border-california-red hover:text-california-red"
                    >
                      <Plus className="h-[17px] w-[17px]" />
                    </button>
                  )}
                  </div>
                  {job.cliente_id && (
                    <NovaMarcaDialog
                      open={novaMarcaAberta}
                      onOpenChange={setNovaMarcaAberta}
                      clienteId={job.cliente_id}
                      clienteNome={job.cliente_nome ?? "cliente"}
                      marcasExistentes={
                        marcasNoCadastro + marcasLocais.length - marcas.length
                      }
                      descricao="Ela já fica escolhida neste job. O resto do registro continua como está."
                      onCriada={(m) => {
                        setMarcasLocais((l) => [...l, { ...m, padrao: false }]);
                        setMarcaId(m.id);
                      }}
                    />
                  )}
                  <span className="text-[11px] text-muted-foreground">
                    {marcaId === "" && !travado ? (
                      "Obrigatória. Escolha uma das marcas do cliente ou cadastre outra no “+”."
                    ) : (
                      <>
                        Vem do orçamento{" "}
                        <span className="font-medium text-foreground/80">
                          {job.orcamento_nome ?? "—"}
                        </span>
                        . A troca vale para o job todo, também na produção.
                      </>
                    )}
                  </span>
                </div>

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
              {/* Decisão 216: no fim do registro, em linha inteira. */}
              <CampoMidiaSystem
                modo={modo}
                travado={travado}
                marcado={midiaSystem}
                marcadoNoRegistro={job.midia_system}
                onMarcar={setMidiaSystem}
                info={midiaSystemInfo}
                jobId={job.id}
                jobCodigo={job.codigo}
              />
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
                Faturamento do orçamento + custo planejado da planilha +
                impostos do job
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
                <ContaSeletor
                  rotulo="Impostos em"
                  contas={contas}
                  selecionada={contaImp}
                  travado={travado}
                  aberto={dropConta === "impostos"}
                  onAbrir={(o) => setDropConta(o ? "impostos" : null)}
                  onEscolher={(id) => {
                    setContaImpId(id);
                    setDropConta(null);
                  }}
                />
              </div>
            </header>

            <div className="flex flex-col gap-[18px] p-5">
              <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
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
                    {custoZeroPeloSave === "todo"
                      ? "Todas as linhas estão em save — o custo nasce no job que consumir o saldo."
                      : custoZeroPeloSave === "misto"
                        ? "Linhas em save e itens de calha BV — a California não desembolsa neste job."
                        : semDesembolso
                          ? "Nenhum item de calha PP — a California não desembolsa neste job."
                          : job.modelo_planilha_orcamento === "midia_off"
                            ? // Decisão 167: o planejado da linha de mídia é o negociado.
                              "Notas dos veículos em A · Repasse, que a California paga — no A · Direto o veículo cobra do cliente"
                            : "Planejado dos itens que a California paga (tipos que geram PP)"}
                  </p>
                </div>
                <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.09em] text-violet-700">
                    Impostos previstos
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <p className="whitespace-nowrap font-mono text-base font-bold">
                      {formatCurrency(impostoPrevisto)}
                    </p>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-2.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                      <Lock className="h-2.5 w-2.5" />
                      Do orçamento
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {semImposto
                      ? "Sem faturamento pela California — não há nota, nem imposto a recolher."
                      : aliquotaIntTaxes !== null
                        ? `Imposto de ${formatPercentual(aliquotaImposto)} + taxas internacionais de ${formatPercentual(aliquotaIntTaxes)} do job`
                        : job.modelo_planilha_orcamento === "midia_off"
                          ? `Alíquota de ${formatPercentual(aliquotaImposto)} do job, sobre os honorários`
                          : `Alíquota de ${formatPercentual(aliquotaImposto)} do job, sobre o que a California fatura`}
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
                          {mensal ? (
                            <span className="inline-flex flex-wrap items-center gap-2 text-[11.5px] text-muted-foreground">
                              <label
                                htmlFor="dia-recebimento"
                                className="font-semibold text-foreground"
                              >
                                Dia do recebimento
                              </label>
                              {travado ? (
                                <span className="font-mono font-semibold text-foreground">
                                  {diaRecebimento || "—"}
                                </span>
                              ) : (
                                <input
                                  id="dia-recebimento"
                                  value={diaRecebimento}
                                  onChange={(e) =>
                                    aplicarDiaDoRecebimento(e.target.value)
                                  }
                                  inputMode="numeric"
                                  placeholder="20"
                                  aria-label="Dia do recebimento"
                                  className="h-7 w-12 rounded-md border border-border bg-white text-center font-mono text-[12.5px] font-semibold text-foreground outline-none focus:border-california-red"
                                />
                              )}
                              <span>
                                · uma linha por mês, recebida no mês seguinte.
                                Revise a data de cada mês se precisar.
                              </span>
                            </span>
                          ) : (
                            <span className="text-[11.5px] text-muted-foreground">
                              Recebimento previsto para{" "}
                              {formatDataBr(job.data_prevista_faturamento)}
                            </span>
                          )}
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
                              {!travado && !mensal && (
                                <button
                                  type="button"
                                  onClick={distribuirRecebimento}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-2.5 py-1.5 text-[11.5px] font-semibold text-muted-foreground transition-colors hover:border-[#d7d7d7] hover:text-foreground"
                                >
                                  <Split className="h-3 w-3" />
                                  Distribuir
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
                                {linha.mes
                                  ? mesCurto(linha.mes)
                                  : `R${String(i + 1).padStart(2, "0")}`}
                              </td>
                              <td className="px-4 py-2.5">
                                <div className="w-[190px]">
                                  {travado ? (
                                    <LinhaTravada texto={formatDataBr(linha.data)} />
                                  ) : (
                                    /* Recebimento não segue as janelas de
                                       pagamento: quem manda na data de entrada
                                       é o cliente, não o calendário com que a
                                       California paga fornecedor. */
                                    <DatePicker
                                      key={`${linha.id}-${rodadaDoDia}`}
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
                                {/* No mensal o valor é o faturamento do mês. */}
                                {travado || linha.mes ? (
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
                                {travado || linha.mes ? null : (
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
                                      !podeRemover(recebimento, linha.id)
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
                            {!travado && !mensal && (
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
                                  Distribuir
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
                                {custoZeroPeloSave === "todo" ? (
                                  <>
                                    Todas as linhas deste job estão em save: o
                                    serviço não acontece aqui, e sim no job que
                                    consumir o saldo. É lá que o custo nasce —
                                    este job abre sem cronograma de
                                    desembolsos.
                                  </>
                                ) : custoZeroPeloSave === "misto" ? (
                                  <>
                                    As linhas em save não têm custo neste job —
                                    o serviço acontece no job que consumir o
                                    saldo. As demais são pagas diretamente pelo
                                    cliente ao fornecedor (itens de calha BV).
                                    O planejado da planilha segue como controle
                                    interno, mas não gera previsão de custos —
                                    o job abre sem cronograma de desembolsos.
                                  </>
                                ) : (
                                  <>
                                    Os custos deste job são pagos diretamente
                                    pelo cliente ao fornecedor (itens de calha
                                    BV). O planejado da planilha segue como
                                    controle interno, mas não gera previsão de
                                    custos — o job abre sem cronograma de
                                    desembolsos.
                                  </>
                                )}
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
                                  {travado ? (
                                    <LinhaTravada texto={formatDataBr(linha.data)} />
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
                                  {fora && (
                                    <span className="mt-1 inline-flex items-center gap-1 text-[10.5px] font-medium text-amber-700">
                                      <AlertTriangle className="h-2.5 w-2.5" />
                                      Fora da competência {competenciaResumo}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-2.5">
                                {travado ? (
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
                                      !podeRemover(curva, linha.id)
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

                    {/* ---------- Bloco de impostos ---------- */}
                    {/* A segunda saída do caixa: o imposto da nota. Nasce das
                        parcelas de recebimento — cada nota gera o seu
                        recolhimento — e fecha com o imposto da versão
                        aprovada (decisão 100). */}
                    <tr>
                      <td colSpan={5} className="p-0">
                        <div className="flex flex-wrap items-center gap-2.5 border-y border-border bg-violet-50/70 px-4 py-2.5">
                          <Receipt className="h-3.5 w-3.5 text-violet-700" />
                          <p className="text-[11px] font-bold uppercase tracking-[0.07em] text-violet-700">
                            Impostos · cronograma de recolhimento
                          </p>
                          <span className="text-[11.5px] text-muted-foreground">
                            {impostosSeguem
                              ? "Um por parcela de recebimento · informe a data de cada um"
                              : "Cronograma ajustado à mão — não segue mais as parcelas de recebimento"}
                          </span>
                          {!semImposto && (
                            <span className="ml-auto inline-flex items-center gap-2">
                              <span
                                className={cn(
                                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11.5px] font-semibold",
                                  impostosBate
                                    ? "border-emerald-200 bg-white text-emerald-700"
                                    : "border-amber-200 bg-amber-50 text-amber-700",
                                )}
                              >
                                {impostosBate ? (
                                  <Check className="h-3 w-3" />
                                ) : (
                                  <AlertTriangle className="h-3 w-3" />
                                )}
                                {impostosBate
                                  ? "Recolhimento fecha com os impostos"
                                  : difImpostos > 0
                                    ? `Sobra de ${formatCurrency(Math.abs(difImpostos))}`
                                    : `Falta ${formatCurrency(Math.abs(difImpostos))}`}
                              </span>
                              {!travado && !impostosSeguem && (
                                <button
                                  type="button"
                                  onClick={() => setImpostosSoltos(null)}
                                  title="Refaz o cronograma a partir das parcelas de recebimento"
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-2.5 py-1.5 text-[11.5px] font-semibold text-muted-foreground transition-colors hover:border-[#d7d7d7] hover:text-foreground"
                                >
                                  <RotateCcw className="h-3 w-3" />
                                  Seguir as parcelas
                                </button>
                              )}
                              {!travado && (
                                <button
                                  type="button"
                                  onClick={distribuirImpostos}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-2.5 py-1.5 text-[11.5px] font-semibold text-muted-foreground transition-colors hover:border-[#d7d7d7] hover:text-foreground"
                                >
                                  <Split className="h-3 w-3" />
                                  Distribuir
                                </button>
                              )}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>

                    {semImposto ? (
                      <tr>
                        <td colSpan={5} className="bg-amber-50/60 px-4 py-3.5">
                          <div className="flex items-start gap-3">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                            <div>
                              <p className="text-[13px] font-semibold text-amber-800">
                                Nenhum imposto a recolher pela California
                              </p>
                              <p className="mt-1 text-xs leading-relaxed text-amber-800/80">
                                Sem faturamento previsto não há nota emitida
                                pela California neste job — e, sem nota, não há
                                imposto a recolher. O job abre sem cronograma de
                                impostos.
                              </p>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      <>
                        {impostos.map((linha, i) => {
                          const valor = parseMoeda(linha.valorTexto);
                          const pct =
                            impostoPrevisto > 0
                              ? (valor / impostoPrevisto) * 100
                              : 0;

                          return (
                            <tr
                              key={linha.id}
                              className="border-b border-b-[#f4f2f2]"
                            >
                              <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                                {`I${String(i + 1).padStart(2, "0")}`}
                              </td>
                              <td className="px-4 py-2.5">
                                <div className="w-[190px]">
                                  {travado ? (
                                    <LinhaTravada texto={formatDataBr(linha.data)} />
                                  ) : (
                                    /* Soltar ou prender o cronograma troca a
                                       origem das datas: a key remonta o
                                       seletor, que não é controlado. */
                                    <DatePicker
                                      key={`${linha.id}-${impostosSeguem ? "segue" : "solto"}`}
                                      name={`imposto-data-${linha.id}`}
                                      defaultValue={linha.data}
                                      className="h-9 text-[13px]"
                                      onDateChange={(d) =>
                                        atualizarImposto(linha.id, {
                                          data: d
                                            ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
                                            : "",
                                        })
                                      }
                                    />
                                  )}
                                  {linha.origem && (
                                    <span className="mt-1 block text-[10.5px] font-medium text-muted-foreground">
                                      {`Referente à parcela ${linha.origem}`}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-2.5">
                                {travado ? (
                                  <p className="text-right font-mono text-[13px] font-semibold">
                                    {formatCurrency(valor)}
                                  </p>
                                ) : (
                                  <div className="ml-auto flex h-9 w-[180px] items-center gap-1.5 rounded-lg border border-border px-3">
                                    <span className="text-xs font-semibold text-muted-foreground">
                                      R$
                                    </span>
                                    <input
                                      aria-label={`Valor do recolhimento ${i + 1}`}
                                      value={linha.valorTexto}
                                      onChange={(e) =>
                                        atualizarImposto(linha.id, {
                                          valorTexto: e.target.value,
                                        })
                                      }
                                      onBlur={() =>
                                        atualizarImposto(linha.id, {
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
                                {impostoPrevisto > 0
                                  ? formatPercentual(pct)
                                  : "—"}
                              </td>
                              <td className="px-4 py-2.5">
                                {travado ? null : (
                                  <button
                                    type="button"
                                    onClick={() => removerDoImposto(linha.id)}
                                    disabled={!podeRemover(impostos, linha.id)}
                                    aria-label={`Remover o recolhimento ${i + 1}`}
                                    title={
                                      !podeRemover(impostos, linha.id)
                                        ? "O cronograma precisa de pelo menos uma data"
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
                                onClick={adicionarDataImposto}
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
                              {formatCurrency(somaDosImpostos)}
                            </strong>
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-xs text-muted-foreground">
                            {impostoPrevisto > 0
                              ? formatPercentual(
                                  (somaDosImpostos / impostoPrevisto) * 100,
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
                    Rentabilidade{" "}
                    <strong
                      className={cn(
                        "font-mono text-sm",
                        margem >= 0
                          ? "text-emerald-700"
                          : "text-california-red",
                      )}
                    >
                      {formatCurrency(margem)}
                      {rentabilidade.valorJob > 0
                        ? ` · ${formatPercentual(margemPct)}`
                        : ""}
                    </strong>
                  </span>
                  {/* A conta por extenso: valor do job − impostos − custo
                      planejado, o resultado operacional planejado da
                      planilha interna. Como agora é a mesma conta, o selo
                      que comparava os dois números saiu (07/10/2026). */}
                  <span
                    className="font-mono text-[11.5px] text-muted-foreground"
                    title="Valor do job − impostos − custo planejado: o resultado operacional planejado da planilha interna."
                  >
                    {formatMoedaTexto(rentabilidade.valorJob)} −{" "}
                    {formatMoedaTexto(rentabilidade.deducoes)} −{" "}
                    {formatMoedaTexto(rentabilidade.custoPlanejado)}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {qtdRecebimentosLabel} ·{" "}
                    {semDesembolso
                      ? qtdDatasCustoLabel
                      : `${qtdDatasCustoLabel} de custo`}{" "}
                    ·{" "}
                    {semImposto
                      ? qtdDatasImpostoLabel
                      : `${qtdDatasImpostoLabel} de imposto`}
                  </span>
                </div>
              </div>

              <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/50 px-3.5 py-3">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  As três previsões alimentam o fluxo de caixa do financeiro: o
                  bloco de cima é a entrada; os de custos e de impostos são a
                  saída. A primeira parcela de recebimento vem da data de
                  faturamento do orçamento e a soma tem que fechar com o
                  faturamento previsto; as datas de custo seguem as janelas de
                  pagamento (dias 08 e 20, ou o dia útil seguinte) e fecham com
                  o custo previsto; o recolhimento de impostos nasce de cada
                  parcela de recebimento e fecha com os impostos da versão
                  aprovada, com a data escolhida à mão. Nada disso trava o
                  realizado — a nota emitida abate a previsão de recebimento,
                  e cada PP emitida abate a de custos. A de impostos ainda não
                  é abatida por nada: isso chega com o módulo fiscal. Datas de
                  recebimento e de custo fora da competência escolhida ficam
                  sinalizadas.
                </p>
              </div>
            </div>
          </section>

          {/* Saves deste job (decisão 155): na abertura, o que vai ser
              aprovado com ela; nos outros modos, em leitura, a situação de
              cada pedido. */}
          {saves && linhasDeSave.length > 0 && (
            <SavesDesteJob
              saves={saves}
              aAprovar={modo === "abertura"}
              aprovaGera={aprovaGera}
              aprovaConsumo={aprovaConsumo}
              onAprovaGera={setAprovaGera}
              onAprovaConsumo={setAprovaConsumo}
            />
          )}
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
            {/* O save do job, abaixo do valor total, como no envio da
                produção: o crédito que ele gera e o que ele consome do
                saldo de outro job. Zero não vira linha. Grafite do SAVE,
                de `blocos.ts` — a mesma cor do envio e do card de Totais
                (Tiago, 17/10/2026). */}
            {(saveGerado > 0.004 || saveConsumido > 0.004) && (
              <div className="flex flex-col gap-2.5 border-t border-border pt-2.5">
                {saveGerado > 0.004 && (
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[12.5px] font-semibold">
                      Total gerado em save
                    </span>
                    <span
                      className={cn(
                        "font-mono text-[13px] font-bold",
                        SAVE.textoApagado,
                      )}
                    >
                      {formatCurrency(saveGerado)}
                    </span>
                  </div>
                )}
                {saveConsumido > 0.004 && (
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[12.5px] font-semibold">
                      Consumo de save
                    </span>
                    <span
                      className={cn(
                        "font-mono text-[13px] font-bold",
                        SAVE.textoApagado,
                      )}
                    >
                      {formatCurrency(saveConsumido)}
                    </span>
                  </div>
                )}
              </div>
            )}
            {/* A planilha interna do job em leitura, num pop-up (revisão da
                decisão 155, 19/10/2026): a mesma forma dos atalhos do save, e
                nada do que foi preenchido se perde. Até ali o atalho trocava
                de aba (decisão 111) ou navegava até ela no job aberto. Na
                aprovação de um save a linha do pedido vem em destaque. */}
            <AtalhoDaPlanilhaInterna
              job={job}
              destacarItens={aprovacaoSave?.linhaId ? [aprovacaoSave.linhaId] : []}
              linhasDaRevisao={linhasDaRevisao}
            />
            {/* A planilha do job de origem do consumo, logo abaixo da
                planilha interna e no mesmo tipo de botão (decisão 155). */}
            {saves && <AtalhosDasOrigens saves={saves} />}
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
            {/* Quem mandou e quando (decisão 136). No reenvio, quem reenviou
                e, na linha de baixo, o primeiro envio. */}
            <div className="mt-0.5 flex items-baseline justify-between gap-3 border-t border-border pt-2.5">
              <span className="text-xs text-muted-foreground">
                {job.reenviado ? "Reenviado por" : "Enviado por"}
              </span>
              <span className="text-right">
                <span className="block text-xs font-semibold">
                  {enviadoPorNome ?? "—"}
                </span>
                <span className="block text-[11px] text-muted-foreground">
                  {formatDataAsHoraBr(job.enviado_em)}
                </span>
              </span>
            </div>
            {job.reenviado && (
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xs text-muted-foreground">Primeiro envio</span>
                <span className="text-right">
                  <span className="block text-xs font-semibold">
                    {job.primeiro_envio_por_nome ?? "—"}
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    {formatDataAsHoraBr(job.primeiro_envio_em)}
                  </span>
                </span>
              </div>
            )}
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs text-muted-foreground">
                Orçamento de origem
              </span>
              <span className="text-xs font-semibold">
                {job.orcamento_nome ?? "—"}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-2.5 rounded-2xl border border-border bg-card px-5 py-4 shadow-soft">
            <p className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">
              Resumo do registro
            </p>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[12.5px] text-muted-foreground">
                Projeto unificado
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
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[12.5px] text-muted-foreground">
                Mídia System
              </span>
              <span className="text-right text-[12.5px] font-semibold">
                {resumoMidia}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[12.5px] text-muted-foreground">
                Marca
              </span>
              <span className="text-right text-[12.5px] font-semibold">
                {marcaNome}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[12.5px] text-muted-foreground">
                Empresa
              </span>
              <span className="text-right text-[12.5px] font-semibold">
                {empresaNomeEscolhida}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[12.5px] text-muted-foreground">
                Regional
              </span>
              <span className="text-right text-[12.5px] font-semibold">
                {regionalNome}
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
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[12.5px] text-muted-foreground">
                Impostos previstos
              </span>
              <span className="font-mono text-[12.5px] font-semibold text-violet-700">
                {formatCurrency(impostoPrevisto)}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[12.5px] text-muted-foreground">
                Recolhimentos
              </span>
              <span className="text-[12.5px] font-semibold">
                {qtdDatasImpostoLabel}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2.5">
              <span className="text-[12.5px] text-muted-foreground">
                Rentabilidade
              </span>
              <span
                className={cn(
                  "font-mono text-[13px] font-bold",
                  margem >= 0 ? "text-emerald-700" : "text-california-red",
                )}
              >
                {formatCurrency(margem)}
                {rentabilidade.valorJob > 0
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
                {/* O mesmo destino do voltar do topo (decisão 108): a fila
                    para quem veio dela, Visualizar Jobs para quem veio de lá. */}
                <Link
                  href={voltar.href}
                  prefetch={false}
                  title={voltar.titulo}
                  onClick={(e) => {
                    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                    e.preventDefault();
                    voltar.irVoltar();
                  }}
                  className="rounded-lg border border-border bg-white px-4 py-2.5 text-[13.5px] font-semibold transition-colors hover:bg-muted"
                >
                  Voltar
                </Link>
                <button
                  type="button"
                  onClick={() => setConfirmarAberto(true)}
                  disabled={!podeAbrir || pending}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-5 py-2.5 text-[13.5px] font-bold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Check className="h-4 w-4" />
                  {rotuloDoRegistro}
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
              {aprovacaoSave
                ? `${aprovacaoSave.tipo === "gera" ? "O save" : "O consumo"} fica aprovado, as previsões de recebimento e de custo passam a valer como estão aqui e a revisão da abertura fecha. A data e o usuário da abertura não mudam.`
                : ehRevisao
                ? "As previsões de recebimento e de custo passam a valer como estão aqui, a revisão da errata fecha, e o envio de PPs e o faturamento voltam. A data e o usuário da abertura não mudam."
                : (
                  <>
                    O job passa a existir no financeiro, aceita lançamentos e
                    entra na lista de jobs abertos. A data de abertura é
                    registrada agora.
                    {/* Abrir aprova os saves do job (decisão 155). */}
                    {savesNaAbertura &&
                      (linhasDeSave.length === 1
                        ? " O save deste job fica aprovado."
                        : ` Os ${linhasDeSave.length} saves deste job ficam aprovados.`)}
                  </>
                )}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2.5 rounded-xl border border-border px-4 py-4">
            <ResumoLinha rotulo="Nome do job" valor={nome.trim()} />
            <ResumoLinha rotulo="Projeto unificado" valor={projetoResumo} />
            <ResumoLinha rotulo="Categoria" valor={categoriaNome} />
            <ResumoLinha rotulo="Serviço" valor={servicoNome} />
            <ResumoLinha rotulo="Mídia System" valor={resumoMidia} />
            <ResumoLinha rotulo="Cliente" valor={job.cliente_nome ?? "—"} />
            <ResumoLinha rotulo="Marca" valor={marcaNome} />
            <ResumoLinha rotulo="Empresa" valor={empresaNomeEscolhida} />
            <ResumoLinha rotulo="Regional" valor={regionalNome} />
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
            <ResumoLinha
              rotulo="Impostos previstos"
              valor={formatCurrency(impostoPrevisto)}
              mono
            />
            <ResumoLinha
              rotulo="Recolhimento"
              valor={
                semImposto
                  ? "Sem imposto a recolher"
                  : `${impostos.length}× · ${formatDataBr(impostos[0]?.data)}${
                      impostos.length > 1
                        ? ` → ${formatDataBr(impostos[impostos.length - 1]?.data)}`
                        : ""
                    }`
              }
            />
            {/* O que a abertura aprova junto (decisão 155). */}
            {savesNaAbertura && (
              <div className="flex items-baseline justify-between gap-3">
                <span className="shrink-0 text-[13px] text-muted-foreground">
                  Saves aprovados com a abertura
                </span>
                <span className="text-right text-[13px] font-semibold">
                  {textoDosSavesNaConfirmacao(resumoSaves)}
                </span>
              </div>
            )}
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

          {/* A exceção no fechamento da versão aprovada (decisão 206). */}
          {job.excecao_fechamento && (
            <ExcecaoNaConfirmacao taxas={job.excecao_fechamento.taxas} />
          )}

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
                : aprovacaoSave
                  ? rotuloDoRegistro
                  : ehRevisao
                    ? "Sim, registrar revisão"
                    : savesNaAbertura
                      ? linhasDeSave.length === 1
                        ? "Sim, abrir job e aprovar o save"
                        : "Sim, abrir job e aprovar os saves"
                      : "Sim, abrir job"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={saidaPendente !== null}
        onOpenChange={(aberto) => {
          if (!aberto) setSaidaPendente(null);
        }}
        title="Sair sem abrir o job?"
        description={
          <>
            <p>
              O que você preencheu na abertura do{" "}
              <span className="font-mono">{job.codigo}</span> só é gravado
              quando o job é aberto. Saindo desta página agora, o
              preenchimento se perde.
            </p>
            {nomeDoDestino && nomeDoDestino !== "a página anterior" && (
              <p className="mt-2">
                Destino:{" "}
                <strong className="font-semibold text-foreground">
                  {nomeDoDestino}
                </strong>
              </p>
            )}
          </>
        }
        confirmLabel="Sair e descartar"
        cancelLabel="Continuar na abertura"
        variant="destructive"
        onConfirm={() => {
          const destino = saidaPendente;
          setSaidaPendente(null);
          if (destino) router.push(destino);
        }}
      />

      <ReprovarDialog
        open={reprovarAberto}
        onOpenChange={setReprovarAberto}
        jobId={job.id}
        jobCodigo={job.codigo}
        gpNome={job.responsavel_nome}
        produtorNome={job.produtor_nome}
        enviadoPorNome={job.enviado_por_nome}
        enviadoEm={job.enviado_em}
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
 * A data de uma linha com o formulário em leitura — job aberto, ninguém
 * clicou em "Editar registro". Sem cadeado, porque nada ali é definitivo:
 * está travado no momento, não para sempre.
 *
 * ⚠️ Havia um segundo motivo até 08/09/2026: a linha CONGELADA, que PP ou
 * nota emitida já tinha consumido. Essa trava caiu (decisão 061).
 */
function LinhaTravada({ texto }: { texto: string }) {
  return (
    <span className="inline-flex h-9 items-center gap-1.5 font-mono text-[13px] font-medium text-muted-foreground">
      {texto}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Saves deste job — a aprovação do save dentro da abertura (decisão 155)
// ---------------------------------------------------------------------------

/** Totais por tipo e por job de origem: o resumo do bloco, a confirmação
 *  e os atalhos das planilhas de origem. */
function resumirSaves(linhas: LinhaDeSaveDaAbertura[]) {
  const gera = linhas.filter((l) => l.tipo === "gera");
  const consome = linhas.filter((l) => l.tipo === "consome");
  const porOrigem = new Map<
    string,
    { jobId: string; codigo: string; nome: string; valor: number; linhas: number }
  >();
  for (const l of consome) {
    for (const o of l.origens) {
      const atual = porOrigem.get(o.jobId) ?? {
        jobId: o.jobId,
        codigo: o.codigo,
        nome: o.nome,
        valor: 0,
        linhas: 0,
      };
      atual.valor = emCentavos(atual.valor + o.valor);
      atual.linhas += 1;
      porOrigem.set(o.jobId, atual);
    }
  }
  return {
    total: linhas.length,
    gera: {
      linhas: gera.length,
      credito: emCentavos(gera.reduce((t, l) => t + l.valor, 0)),
    },
    consome: {
      linhas: consome.length,
      valor: emCentavos(consome.reduce((t, l) => t + l.valor, 0)),
      porOrigem: [...porOrigem.values()].sort((a, b) => b.valor - a.valor),
    },
  };
}

/** "2 · crédito R$ 14.800,00 · consumo R$ 10.000,00 do TES-1009/26". */
function textoDosSavesNaConfirmacao(r: ReturnType<typeof resumirSaves>): string {
  const partes: string[] = [String(r.total)];
  if (r.gera.linhas > 0) partes.push(`crédito ${formatCurrency(r.gera.credito)}`);
  for (const o of r.consome.porOrigem) {
    partes.push(`consumo ${formatCurrency(o.valor)} do ${o.codigo}`);
  }
  return partes.join(" · ");
}

const linhasTexto = (n: number) => (n === 1 ? "1 linha" : `${n} linhas`);

/** Com mais de 5 linhas a tabela nasce recolhida nas 3 primeiras — o
 *  orçamento inteiro em save (decisão 154) tem dezenas. */
const LIMITE_TABELA_ABERTA = 5;
const LINHAS_TABELA_RECOLHIDA = 3;

/**
 * O selo da faixa de cada tipo: aprovado, ou ainda por decidir. Na abertura
 * a faixa leva a caixa; no job aberto, o selo da situação dos pedidos.
 */
function SeloDaFaixa({
  tom,
  children,
}: {
  tom: "ok" | "pendente" | "recusado";
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11.5px] font-semibold",
        tom === "ok" && "border-emerald-200 bg-white text-emerald-700",
        tom === "pendente" && "border-amber-200 bg-amber-50 text-amber-700",
        tom === "recusado" &&
          "border-california-red/25 bg-california-red/5 text-california-red",
      )}
    >
      {tom === "ok" ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
      {children}
    </span>
  );
}

/** O selo do tipo no job aberto, pela situação dos pedidos das linhas. */
function seloDaLeitura(linhas: LinhaDeSaveDaAbertura[]): React.ReactNode {
  if (linhas.length === 0) return null;
  if (linhas.every((l) => l.situacao === "aprovado")) {
    return <SeloDaFaixa tom="ok">Aprovado com a abertura</SeloDaFaixa>;
  }
  if (linhas.some((l) => l.situacao === "recusado")) {
    return <SeloDaFaixa tom="recusado">Recusado</SeloDaFaixa>;
  }
  if (linhas.some((l) => l.situacao === "aguardando")) {
    return <SeloDaFaixa tom="pendente">Aguardando aprovação</SeloDaFaixa>;
  }
  return null;
}

/** A caixa de aprovação de um tipo, compacta, na faixa do tipo — onde as
 *  Previsões põem "Parcelas fecham com o faturamento". */
function CaixaNaFaixa({
  rotulo,
  marcada,
  onMarcar,
}: {
  rotulo: string;
  marcada: boolean;
  onMarcar: (v: boolean) => void;
}) {
  const id = React.useId();
  return (
    <label
      htmlFor={id}
      className={cn(
        "inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1 text-[11.5px] font-semibold transition-colors",
        marcada
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-amber-300 bg-white text-foreground hover:border-amber-400",
      )}
    >
      <Checkbox
        id={id}
        checked={marcada}
        onCheckedChange={(v) => onMarcar(v === true)}
        className="h-3.5 w-3.5"
      />
      {rotulo}
    </label>
  );
}

/** Um bloco de resumo, como os quatro do topo das Previsões. */
function BlocoDeResumo({
  titulo,
  valor,
  apoio,
}: {
  titulo: string;
  valor: React.ReactNode;
  apoio: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border px-4 py-3">
      <p
        className={cn(
          "text-[10px] font-bold uppercase tracking-[0.09em]",
          SAVE.textoApagado,
        )}
      >
        {titulo}
      </p>
      <p className="mt-1.5 whitespace-nowrap font-mono text-base font-bold">{valor}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{apoio}</p>
    </div>
  );
}

/** O ícone da faixa: a direção do save, na cor do SAVE. */
function IconeDaFaixa({ tipo }: { tipo: "gera" | "consome" }) {
  const Icone = tipo === "gera" ? ArrowUpRight : ArrowDownLeft;
  return (
    <span
      className={cn(
        "inline-flex h-[18px] w-[18px] items-center justify-center rounded-[5px] border border-current",
        SAVE.icone,
      )}
    >
      <Icone className="h-3 w-3" />
    </span>
  );
}

/** A faixa de cada tipo dentro da tabela, como "Parcelas de recebimento". */
function FaixaDoTipo({
  tipo,
  titulo,
  detalhe,
  direita,
}: {
  tipo: "gera" | "consome";
  titulo: string;
  detalhe: React.ReactNode;
  direita: React.ReactNode;
}) {
  return (
    <tr>
      <td colSpan={5} className="p-0">
        <div
          className={cn(
            "flex flex-wrap items-center gap-2.5 border-y border-border px-4 py-2.5",
            SAVE.linhaConsome,
          )}
        >
          <IconeDaFaixa tipo={tipo} />
          <p
            className={cn(
              "text-[11px] font-bold uppercase tracking-[0.07em]",
              SAVE.textoApagado,
            )}
          >
            {titulo}
          </p>
          <span className="text-[11.5px] text-muted-foreground">{detalhe}</span>
          {direita && <span className="ml-auto inline-flex items-center gap-2">{direita}</span>}
        </div>
      </td>
    </tr>
  );
}

/** Recolhe em 3 a partir de 6, como as tabelas do bloco sempre fizeram. */
function useRecolher<T>(itens: T[]) {
  const recolhivel = itens.length > LIMITE_TABELA_ABERTA;
  const [aberta, setAberta] = React.useState(!recolhivel);
  return {
    visiveis: aberta ? itens : itens.slice(0, LINHAS_TABELA_RECOLHIDA),
    recolhivel,
    aberta,
    alternar: () => setAberta((a) => !a),
  };
}

function LinhaDeRecolher({
  aberta,
  rotulo,
  onClick,
}: {
  aberta: boolean;
  rotulo: string;
  onClick: () => void;
}) {
  return (
    <tr>
      <td colSpan={5} className="p-0">
        <button
          type="button"
          onClick={onClick}
          className="flex w-full items-center justify-center gap-1.5 border-b border-border bg-muted/40 px-4 py-2 text-[12px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          {aberta ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          {aberta ? "Recolher" : rotulo}
        </button>
      </td>
    </tr>
  );
}

function LinhaDeSoma({ esquerda, valor }: { esquerda: React.ReactNode; valor: number }) {
  return (
    <tr className="border-b border-border">
      <td colSpan={3} className="px-4 py-2.5 text-[12px] text-muted-foreground">
        {esquerda}
      </td>
      <td className="whitespace-nowrap px-4 py-2.5 text-right text-[12px] text-muted-foreground">
        Soma{" "}
        <span className="font-mono text-[13.5px] font-bold text-foreground">
          {formatCurrency(valor)}
        </span>
      </td>
      <td />
    </tr>
  );
}

const valorMono = (v: number) => (
  <span className="font-mono font-semibold text-foreground">{formatCurrency(v)}</span>
);

const umOuVarios = (n: number, um: string, varios: string) =>
  n === 1 ? `1 ${um}` : `${n} ${varios}`;

/** "do saldo do TES-1009/26", ou "do saldo de 2 jobs". */
const doSaldo = (porOrigem: { codigo: string }[]) =>
  porOrigem.length === 1
    ? `do saldo do ${porOrigem[0].codigo}`
    : `do saldo de ${porOrigem.length} jobs`;

/** As origens de uma linha que consome: "do TES-1009/26"; de mais de um
 *  job, uma por linha, com quanto vem de cada uma. */
function origensDaLinha(l: LinhaDeSaveDaAbertura): React.ReactNode {
  const os = [...l.origens].sort((a, b) => b.valor - a.valor);
  if (os.length === 1) return `do ${os[0].codigo}`;
  return (
    <span className="flex flex-col gap-0.5">
      {os.map((o) => (
        <span key={o.jobId} className="whitespace-nowrap">
          {o.codigo} · {formatCurrency(o.valor)}
        </span>
      ))}
    </span>
  );
}

const DESCRICAO_DA_ORIGEM =
  "em leitura — a linha que gerou o saldo usado aqui aparece com o ícone de save.";
const DESCRICAO_DO_CONSUMIDOR =
  "em leitura — a linha que consome o saldo deste job aparece com o ícone de save.";

/**
 * "Saves deste job" (decisão 155, revista em 19/10/2026 a partir do
 * protótipo "Save na Abertura", opção B). No idioma das Previsões: blocos de
 * resumo no topo e uma tabela só, com uma faixa por tipo. Na abertura, a
 * caixa de aprovação mora na faixa do tipo; no job aberto, o selo da
 * situação dos pedidos. Cada tipo fecha com a linha de Soma. As linhas que
 * geram save têm a hachura da coluna Save da planilha e as que consomem, o
 * fundo grafite claro (`SAVE`, em `blocos.ts`). O ícone na ponta da linha
 * abre a planilha do outro job — a de origem, ou a de quem consome.
 *
 * No job aberto que gerou save, a faixa "Consumido por" lista os jobs que já
 * consumiram o crédito (consumo aprovado), e o resumo traz o livre da
 * `vw_saves_por_job`. A linha do consumo diz só "Pago com o saldo do …": o
 * saldo e as sobras de antes não se reconstroem depois que outros jobs
 * consomem da mesma origem.
 */
function SavesDesteJob({
  saves,
  aAprovar,
  aprovaGera,
  aprovaConsumo,
  onAprovaGera,
  onAprovaConsumo,
}: {
  saves: SavesDaAbertura;
  /** Modo `abertura`: as caixas marcam. Nos outros, o bloco é leitura. */
  aAprovar: boolean;
  aprovaGera: boolean;
  aprovaConsumo: boolean;
  onAprovaGera: (v: boolean) => void;
  onAprovaConsumo: (v: boolean) => void;
}) {
  const { linhas, clienteNome } = saves;
  const r = resumirSaves(linhas);
  const gera = linhas.filter((l) => l.tipo === "gera");
  const consome = linhas.filter((l) => l.tipo === "consome");
  const consumidores = aAprovar ? [] : saves.consumidores;
  const saldoDepois = emCentavos(saves.saldoDoClienteAntes + r.gera.credito);
  const somaDosConsumidores = emCentavos(consumidores.reduce((t, c) => t + c.valor, 0));
  const consumido = saves.credito?.consumido ?? somaDosConsumidores;
  const reservado = saves.credito?.reservado ?? 0;
  const livre = saves.credito?.livre ?? emCentavos(r.gera.credito - consumido - reservado);
  const rg = useRecolher(gera);
  const rc = useRecolher(consome);
  const rj = useRecolher(consumidores);

  const caixaOuSelo = (tipo: "gera" | "consome") =>
    aAprovar ? (
      <CaixaNaFaixa
        rotulo={tipo === "gera" ? "Aprovar save gerado" : "Aprovar consumo de save"}
        marcada={tipo === "gera" ? aprovaGera : aprovaConsumo}
        onMarcar={tipo === "gera" ? onAprovaGera : onAprovaConsumo}
      />
    ) : (
      seloDaLeitura(tipo === "gera" ? gera : consome)
    );

  const apoioDoLivre = [
    consumido > 0.004
      ? consumidores.length > 0
        ? `${formatCurrency(consumido)} consumidos por ${umOuVarios(consumidores.length, "job", "jobs")}`
        : `${formatCurrency(consumido)} consumidos`
      : "Nenhum job consumiu ainda",
    reservado > 0.004 ? `${formatCurrency(reservado)} reservados` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className="rounded-2xl border border-border bg-card shadow-soft">
      <header className="flex flex-wrap items-center gap-2.5 rounded-t-2xl border-b border-border bg-muted/50 px-5 py-3.5">
        <ArrowLeftRight className="h-4 w-4 text-california-red" />
        <h2 className="text-[15px] font-semibold">Saves deste job</h2>
        <span className="text-xs text-muted-foreground">
          {aAprovar
            ? "Confira as linhas e aprove cada tipo para abrir o job."
            : saves.aprovados
              ? `Aprovados com a abertura · ${formatDataAsHoraBr(saves.aprovados.em)}${
                  saves.aprovados.porNome ? ` · ${saves.aprovados.porNome}` : ""
                }`
              : null}
        </span>
        {saves.modoInteiro && (
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-2.5 py-1 text-[11px] font-semibold text-foreground">
            {saves.modoInteiro.tipo === "gera" && <IconeSave tipo="gera" origens={[]} />}
            {saves.modoInteiro.tipo === "gera"
              ? "Orçamento inteiro em save"
              : `Orçamento inteiro pago pelo saldo do ${saves.modoInteiro.codigo}`}
          </span>
        )}
      </header>

      <div className="flex flex-col gap-[18px] p-5">
        <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
          {gera.length > 0 && (
            <BlocoDeResumo
              titulo="Save gerado"
              valor={formatCurrency(r.gera.credito)}
              apoio={
                aAprovar
                  ? `${linhasTexto(gera.length)} · crédito para ${clienteNome} quando o job abrir`
                  : `${linhasTexto(gera.length)} · crédito de ${clienteNome}`
              }
            />
          )}
          {consome.length > 0 && (
            <BlocoDeResumo
              titulo="Consumo de save"
              valor={formatCurrency(r.consome.valor)}
              apoio={`${linhasTexto(consome.length)} · ${doSaldo(r.consome.porOrigem)}`}
            />
          )}
          {gera.length > 0 && aAprovar && (
            <BlocoDeResumo
              titulo={`Saldo de save de ${clienteNome}`}
              valor={
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-muted-foreground line-through">
                    {formatCurrency(saves.saldoDoClienteAntes)}
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                  {formatCurrency(saldoDepois)}
                </span>
              }
              apoio="Hoje → depois de abrir este job"
            />
          )}
          {gera.length > 0 && !aAprovar && (
            <BlocoDeResumo titulo="Livre do crédito" valor={formatCurrency(livre)} apoio={apoioDoLivre} />
          )}
        </div>

        <div className="overflow-hidden rounded-xl border border-border">
          {/* Layout automático: o bloco não é planilha (a regra do
              `table-fixed` é da planilha e dos Totais). Com colunas fixas,
              numa tela estreita o item sumia; aqui ele e o detalhe quebram
              linha, e o valor nunca quebra. */}
          <table className="w-full border-collapse text-[13.5px]">
            <thead>
              <tr className="border-b border-border text-left text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
                <th className="w-14 px-4 py-2.5 font-semibold">#</th>
                <th className="px-4 py-2.5 font-semibold">Grupo · item</th>
                <th className="px-4 py-2.5 font-semibold" />
                <th className="whitespace-nowrap px-4 py-2.5 text-right font-semibold">Valor</th>
                <th className="w-14 px-4 py-2.5" aria-label="Planilha" />
              </tr>
            </thead>
            <tbody>
              {gera.length > 0 && (
                <>
                  <FaixaDoTipo
                    tipo="gera"
                    titulo="Save gerado"
                    detalhe={aAprovar ? `crédito para ${clienteNome}` : `crédito de ${clienteNome}`}
                    direita={caixaOuSelo("gera")}
                  />
                  {rg.visiveis.map((l, i) => (
                    <tr key={l.id} className={cn("border-b border-border", SAVE.hachura)}>
                      <td className="px-4 py-2.5 font-mono text-[12px] text-muted-foreground">
                        S{String(i + 1).padStart(2, "0")}
                      </td>
                      <td className="px-4 py-2.5">
                        {l.grupo && <span className="text-muted-foreground">{l.grupo} · </span>}
                        <span className="font-medium">{l.item}</span>
                      </td>
                      <td className="px-4 py-2.5 text-[12px] text-muted-foreground">
                        {l.faturamentoDaLinha !== null && (
                          <>na nota {formatCurrency(l.faturamentoDaLinha)}</>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono font-semibold">
                        {formatCurrency(l.valor)}
                      </td>
                      <td />
                    </tr>
                  ))}
                  {rg.recolhivel && (
                    <LinhaDeRecolher
                      aberta={rg.aberta}
                      rotulo={`Mostrar as ${gera.length} linhas`}
                      onClick={rg.alternar}
                    />
                  )}
                  {/* O saldo do cliente (ou o livre do crédito) já está no
                      bloco de cima: a Soma fica só com o total. */}
                  <LinhaDeSoma valor={r.gera.credito} esquerda={null} />
                </>
              )}

              {consome.length > 0 && (
                <>
                  <FaixaDoTipo
                    tipo="consome"
                    titulo="Consumo de save"
                    detalhe={r.consome.porOrigem
                      .map((o) => `do ${o.codigo}${o.nome ? ` · ${o.nome}` : ""}`)
                      .join(" e ")}
                    direita={caixaOuSelo("consome")}
                  />
                  {rc.visiveis.map((l, i) => (
                    <tr key={l.id} className={cn("border-b border-border", SAVE.linhaConsome)}>
                      <td className="px-4 py-2.5 font-mono text-[12px] text-muted-foreground">
                        C{String(i + 1).padStart(2, "0")}
                      </td>
                      <td className="px-4 py-2.5">
                        {l.grupo && <span className="text-muted-foreground">{l.grupo} · </span>}
                        <span className="font-medium">{l.item}</span>
                      </td>
                      <td className="px-4 py-2.5 text-[12px] text-muted-foreground">
                        {origensDaLinha(l)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono font-semibold">
                        {formatCurrency(l.valor)}
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <span className="flex flex-col items-center gap-1">
                          {[...l.origens]
                            .sort((a, b) => b.valor - a.valor)
                            .map((o) => (
                              <BotaoDaPlanilha
                                key={o.jobId}
                                jobId={o.jobId}
                                codigo={o.codigo}
                                descricao={`${o.nome ? `${o.nome} · ` : ""}${DESCRICAO_DA_ORIGEM}`}
                              />
                            ))}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {rc.recolhivel && (
                    <LinhaDeRecolher
                      aberta={rc.aberta}
                      rotulo={`Mostrar as ${consome.length} linhas`}
                      onClick={rc.alternar}
                    />
                  )}
                  <LinhaDeSoma
                    valor={r.consome.valor}
                    esquerda={
                      aAprovar
                        ? r.consome.porOrigem.map((o, i) => {
                            const saldo = saves.saldoDasOrigens[o.jobId] ?? 0;
                            return (
                              <span key={o.jobId}>
                                {i > 0 && " · "}
                                Saldo do {o.codigo}:{" "}
                                <span className="font-mono">{formatCurrency(saldo)}</span> → sobram{" "}
                                {valorMono(emCentavos(saldo - o.valor))}
                              </span>
                            );
                          })
                        : `Pago com o saldo ${r.consome.porOrigem
                            .map((o) => `do ${o.codigo}`)
                            .join(" e ")}`
                    }
                  />
                </>
              )}

              {consumidores.length > 0 && (
                <>
                  <FaixaDoTipo
                    tipo="gera"
                    titulo="Consumido por"
                    detalhe={`${umOuVarios(consumidores.length, "job", "jobs")} · ${
                      consumidores.length === 1 ? "usa" : "usam"
                    } ${formatCurrency(somaDosConsumidores)} do crédito de ${formatCurrency(r.gera.credito)}`}
                    direita={null}
                  />
                  {rj.visiveis.map((c, i) => (
                    <tr key={c.jobId} className="border-b border-border">
                      <td className="px-4 py-2.5 font-mono text-[12px] text-muted-foreground">
                        J{String(i + 1).padStart(2, "0")}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="font-mono font-semibold">{c.codigo}</span>{" "}
                        <span className="text-muted-foreground">· {c.nome}</span>
                      </td>
                      <td className="px-4 py-2.5 text-[12px] text-muted-foreground">
                        {c.abertoEm ? `aberto em ${formatDiaBr(c.abertoEm)}` : null}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono font-semibold">
                        {formatCurrency(c.valor)}
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <BotaoDaPlanilha
                          jobId={c.jobId}
                          codigo={c.codigo}
                          descricao={`${c.nome} · ${DESCRICAO_DO_CONSUMIDOR}`}
                        />
                      </td>
                    </tr>
                  ))}
                  {rj.recolhivel && (
                    <LinhaDeRecolher
                      aberta={rj.aberta}
                      rotulo={`Mostrar os ${consumidores.length} jobs`}
                      onClick={rj.alternar}
                    />
                  )}
                  <LinhaDeSoma valor={somaDosConsumidores} esquerda={null} />
                </>
              )}
            </tbody>
          </table>
        </div>

        {aAprovar && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 shrink-0" />
            Se alguma linha não deveria ser save, não abra o job: use “Reprovar job”.
          </p>
        )}
      </div>
    </section>
  );
}

/** O atalho "Visualizar planilha interna": abre a planilha deste job num
 *  pop-up, em leitura, como os da origem (Tiago, 07/10/2026). Na aprovação
 *  de um save (decisão 099), a linha do pedido vem em destaque; na revisão
 *  depois de uma errata, as linhas que ela mudou vêm com a borda vermelha
 *  (revisão da decisão 185). A aba Planilha Interna continua no topo, e é
 *  nela que se edita. */
function AtalhoDaPlanilhaInterna({
  job,
  destacarItens,
  linhasDaRevisao,
}: {
  job: { id: string; codigo: string; nome: string };
  destacarItens: string[];
  linhasDaRevisao: string[];
}) {
  const [aberto, setAberto] = React.useState(false);
  return (
    <>
      <button type="button" onClick={() => setAberto(true)} className={CLASSE_ATALHO_PLANILHA}>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-white text-california-red">
          <Table2 className="h-4 w-4" />
        </div>
        <p className="min-w-0 text-[12.5px] font-semibold">Visualizar planilha interna</p>
        <ArrowRight className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>
      <PopUpDaPlanilha
        aberto={aberto}
        onOpenChange={setAberto}
        jobId={job.id}
        codigo={job.codigo}
        descricao={`${job.nome} · em leitura — as linhas com save aparecem com o ícone de save. Para editar, use a aba Planilha Interna.`}
        destacarItens={destacarItens}
        linhasDaRevisao={linhasDaRevisao}
      />
    </>
  );
}

/**
 * Um atalho por job de origem do consumo, no mesmo visual do "Visualizar
 * planilha interna", logo abaixo dele (decisão 155). "Visualizar planilha
 * de origem do save (código)", só o título (Tiago, 08/10/2026). Abre a
 * planilha do outro job num pop-up, em leitura, sem sair da abertura.
 */
function AtalhosDasOrigens({ saves }: { saves: SavesDaAbertura }) {
  const [escolhida, setEscolhida] = React.useState<{
    jobId: string;
    codigo: string;
    nome: string;
  } | null>(null);
  const [aberto, setAberto] = React.useState(false);
  const origens = resumirSaves(saves.linhas).consome.porOrigem;
  if (origens.length === 0) return null;
  return (
    <>
      {origens.map((o) => (
        <button
          key={o.jobId}
          type="button"
          onClick={() => {
            setEscolhida({ jobId: o.jobId, codigo: o.codigo, nome: o.nome });
            setAberto(true);
          }}
          className={CLASSE_ATALHO_PLANILHA}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-white text-california-red">
            <Table2 className="h-4 w-4" />
          </div>
          <p className="min-w-0 text-[12.5px] font-semibold">
            Visualizar planilha de origem do save{" "}
            <span className="whitespace-nowrap">({o.codigo})</span>
          </p>
          <ArrowRight className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      ))}
      {escolhida && (
        <PopUpDaPlanilha
          aberto={aberto}
          onOpenChange={setAberto}
          jobId={escolhida.jobId}
          codigo={escolhida.codigo}
          descricao={`${escolhida.nome ? `${escolhida.nome} · ` : ""}${DESCRICAO_DA_ORIGEM}`}
        />
      )}
    </>
  );
}
