"use client";

/** ⚠️ Client component desde 21/08/2026, por causa de UMA coisa: a chave
 *  Bruto ⇄ Líquido. Ela vale para a planilha inteira — todos os grupos e
 *  o card de Totais —, então o estado tem que morar no ancestral comum
 *  dos três. Uma chave por grupo, como o design 3b desenha, deixaria o
 *  Totais sem bater com nenhum dos grupos.
 *
 *  Esta seção é a MESMA nas duas telas de job: a do GP (`/jobs/[jobId]`)
 *  e a do financeiro (`/financeiro/jobs/[jobId]`). Mexer aqui muda as
 *  duas, que é o que se quer — elas mostram a mesma planilha. */

import { COMITE_DA_PP_SEM_ACAO, type ComiteDaPP, type PedidoEmDecisao } from "@/lib/data/comite";
import * as React from "react";
import type { MidiaSystemDoJob } from "@/lib/calculos/midia-system";
import Link from "next/link";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  Clock,
  ClipboardList,
  Send,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SAVE } from "@/app/(app)/_planilha/blocos";
import { cn, formatCurrency } from "@/lib/utils";
import { nomeVersao } from "@/lib/nome-versao";
import type {
  Job,
  VersaoOrcamento,
  VersaoOrcamentoGrupo,
  ItemPlanilhaJob,
  JobItemRealizado,
  PedidoCompraNaLista,
  PPAEmitir,
  Fornecedor,
  Empresa,
  ItemBv,
  CategoriaModeloPlanilha,
  VersaoOrcamentoMes,
} from "@/lib/types";
import { VISAO_BV_PADRAO, type VisaoBv } from "@/lib/calculos/bv-planilha";
import { useRouter } from "next/navigation";
import { ChaveBrutoLiquido } from "@/app/(app)/_planilha/chave-bruto-liquido";
import { MenuExibirColunas } from "@/app/(app)/_planilha/exibir-colunas";
import { DicasDeTeclado } from "@/app/(app)/_planilha/selecao";
import {
  SAVE_VAZIO,
  situacaoDoSave,
  type EstadoSaveDaLinha,
} from "@/app/(app)/_planilha/save-coluna";
import {
  SaveDialog,
  type AcoesDoSaveNoJob,
  type LinhaDoSave,
  type MudancaNaLinha,
  type PortaDoConsumo,
} from "@/app/(app)/_planilha/save-dialog";
import type { SaldoDeSave } from "@/lib/data/saves";
import type { TomadorDaNf } from "./anexos-da-pp";
import {
  cancelarPedidoDeSave,
  enviarSavesParaAprovacao,
  registrarErrataDeSave,
  retirarSave,
  type ActionResult as ResultadoDaAcaoDeSave,
} from "./save-errata-actions";
import {
  BotaoRecolherTodos,
  useGruposRecolhiveis,
} from "@/app/(app)/_planilha/recolher-grupos";
import {
  JobItemRealizadoTable,
  type GrupoDoJob,
} from "./job-item-realizado-table";
import { JobTotaisCard } from "./job-totais-card";
import { AlterarOrcadoButton } from "./alterar-orcado-button";
import { EditarOrcadoButton } from "./editar-orcado-button";
import { EdicaoFinanceiroBarra } from "./edicao-financeiro-barra";
import {
  EdicaoFinanceiroConfirmarDialog,
  type ParcelaQueAcompanha,
} from "./edicao-financeiro-confirmar-dialog";
import { registrarAlteracaoDoFinanceiro } from "./actions-alteracao-financeiro";
import {
  distribuirDelta,
  emReais,
  linhasAlteradasPeloFinanceiro,
} from "@/lib/calculos/alteracao-financeiro";
import { ExportarInternaButton } from "./exportar-interna-button";
import {
  ConcluirPPsButton,
  type ItemEmAberto,
} from "./concluir-pps-button";
import {
  exigeSomaIgualAoOrcado,
  faltaParaFecharOOrcado,
  itemPrecisaDeConclusao,
  somaDasPPsNaoCanceladas,
} from "@/lib/calculos/pps-item";
import { paraEdicao, useRascunhoErrata } from "./errata-rascunho";
import { AvisoDoMesEnviado } from "./aviso-do-mes-enviado";
import { MesesQueFaltam } from "./meses-que-faltam";
import { ErrataProntaFaixa, quandoDaPronta } from "./errata-pronta-faixa";
import type { FechamentoDaAbertura } from "@/lib/calculos/abertura-do-job";
import { ErrataBarra } from "./errata-barra";
import { ErrataConfirmarDialog } from "./errata-confirmar-dialog";
import {
  registrarErrata,
  salvarErrataPronta,
  descartarErrataPronta,
} from "./actions-errata";
import {
  calcularResultadoOperacional,
  calcularTotaisVersao,
} from "@/lib/calculos/versao-totais";
import { configDaPlanilha } from "@/app/(app)/_planilha/modelo-planilha";
import { jobAceitaAcoesPlanilha, type ErrataPronta, type JobStatus } from "@/lib/types";
import { definirModoErrata } from "../modo-errata";
import {
  mesesDoTrimestre,
  nomeDoMes,
  rotuloMes,
  rotuloMesCurto,
  trimestreDe,
} from "@/lib/calculos/meses-trimestre";
import { ReguaMeses } from "@/app/(app)/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/regua-meses";
import { TrimestreEmpilhado } from "@/app/(app)/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/trimestre-empilhado";
import type {
  MesDeFaturamento,
  SituacaoDoMes,
} from "@/lib/calculos/faturamento-por-mes";
import { LinkSaidaDeModulo } from "@/components/financeiro/link-saida-de-modulo";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PlanilhaMidiaDoJob } from "./planilha-midia-do-job";
import type { MidiaDoDetalhe } from "../carregar-detalhe";
import { useProtegerSaida } from "@/components/voltar/estado";
import {
  montarHistorico,
  type DadosDoHistorico,
  type MudancaNaLinha as MudancaDoHistorico,
  type VersaoDaPlanilha,
} from "@/lib/calculos/historico-da-planilha";
import { carregarHistoricoDaPlanilha } from "./actions-historico";
import { BotaoHistorico, FaixaDaVersao, SeloDaLinha } from "./historico-da-planilha";
import { ParametrosDoJob, type AlteracaoDosParametros } from "./parametros-do-job";
import type { ParametrosDoJobGravados } from "@/lib/types";

/** A linha de parâmetros do job no financeiro (decisão 224): os que valem
 *  hoje, quem edita e o que já mudou. */
export interface ParametrosDoJobNaPlanilha {
  parametros: ParametrosDoJobGravados;
  /** `null` = só leitura. `naFila: false` = job aberto, só o câmbio. */
  edicao: { naFila: boolean } | null;
  alteracoes: AlteracaoDosParametros[];
}

const SEM_FATURAMENTO_MENSAL: MesDeFaturamento[] = [];

/** O "Editar orçado" do financeiro (decisão 115): o que a tela precisa saber
 *  além da planilha. A página do financeiro monta; a da produção manda
 *  `null`. */
export interface EdicaoDoFinanceiro {
  /** Por que o botão não abre: o job já tem nota emitida (P4). */
  travadoPor: string | null;
  /** Modelo mensal: ids dos meses com nota — as linhas deles não abrem. */
  mesesComNota: string[];
  /** A previsão de recebimento gravada, na ordem de `previsoesGravadas`
   *  (a mesma da action): o pop-up mostra cada parcela antes e depois. */
  recebimento: Array<{ data: string; valor: number; mes: string | null }>;
  /** Os envios para faturamento ainda SEM nota: as parcelas deles
   *  acompanham a alteração. */
  envios: Array<{
    id: string;
    mes: string | null;
    parcelas: Array<{ id: string; data_vencimento: string; valor: number }>;
  }>;
}

/** O planejado na edição do financeiro: nunca abre (decisão 115, P1). */
const MOTIVO_PLANEJADO_DO_FINANCEIRO =
  "O financeiro só edita o planejado com o job na fila da abertura. Depois dela, o planejado muda pela errata.";

function dataBr(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** O texto da situação do mês na régua — o mesmo da barra do rodapé. */
const ROTULO_DA_SITUACAO: Record<SituacaoDoMes, string> = {
  em_veiculacao: "Em veiculação",
  a_enviar: "A enviar",
  na_fila: "Na fila do financeiro",
  faturado_parcial: "Faturado parcial",
  faturado: "Faturado",
  sem_faturamento: "Sem faturamento",
};

/** Referência estável para o default: um `[]` novo a cada render mudaria
 *  as dependências dos `useMemo` abaixo. */
const SEM_MESES: VersaoOrcamentoMes[] = [];

/** A chave do mês que a errata inclui (decisão 219): `mes-novo:2026-11`.
 *  É o `mes_id` dos agrupamentos novos dele até a errata ser registrada. */
function chaveDoMesNovo(mes: string): string {
  return `mes-novo:${mes.slice(0, 7)}`;
}

interface Props {
  job: Pick<
    Job,
    | "id"
    | "codigo"
    | "nome"
    | "status"
    | "projeto_id"
    | "orcamento_id"
    | "versao_orcamento_aprovada_id"
    | "empresa_id"
    | "responsavel_id"
  >;
  versao: Pick<
    VersaoOrcamento,
    | "id"
    | "numero_versao"
    | "moeda"
    | "percentual_honorarios"
    | "percentual_imposto"
    // Da cadeia internacional (decisão 072). Vêm do `Pick`, e não escritos
    // à mão, para o tipo acompanhar `VersaoOrcamento` sozinho.
    | "percentual_int_taxes"
    | "int_transaction_costs"
    | "moeda_estrangeira"
    | "cambio_compra"
  >;
  /** Qual fechamento este job usa — da categoria do ORÇAMENTO que o
   *  originou, nunca da do job (decisão 072). */
  modeloPlanilha: CategoriaModeloPlanilha;
  // ---- MODELO MENSAL (decisão 078)
  /** Os meses da versão aprovada. Vazio fora do modelo mensal. */
  meses?: VersaoOrcamentoMes[];
  /** `?mes=` da URL: `trimestre`, `2026-07` ou ausente (primeiro mês). */
  mesPedido?: string;
  /** Link da própria página já na aba da planilha, sem o `mes` — a régua
   *  acrescenta `&mes=`. Sem ele a régua não tem para onde navegar, e o
   *  job mensal aparece na planilha inteira. */
  hrefPlanilha?: string;
  /** O envio e as notas de cada mês (entrega 3). Mês enviado trava errata
   *  e save só nele. */
  faturamentoMensal?: MesDeFaturamento[];
  /** "Nome do Job" do orçamento — base do nome da versão. */
  nomeJob: string;
  grupos: VersaoOrcamentoGrupo[];
  itens: ItemPlanilhaJob[];
  realizadosMap: Map<string, JobItemRealizado>;
  categoriasMap: Map<string, string>;
  /** Errata, BV e Pedido de Produção — só com o job aberto. */
  podeAcoes: boolean;
  /** Save do job (decisão 099, revista em 24/09/2026): administrador ou
   *  qualquer GP (`jobs.consumir_save`), responsável pelo job ou não. O
   *  status do job decide o modo (pedido ou direto); telas de leitura
   *  mandam `false`. */
  podeMexerNoSave: boolean;
  /** GERAR, editar e cancelar PP. Separado de `podeAcoes` desde
   *  08/09/2026 (decisão 056): a PP passou a nascer na pré-abertura,
   *  enquanto errata e BV continuam esperando a abertura. O envio ao
   *  financeiro é a outra metade, e ela mora no painel do item. */
  podeGerarPP?: boolean;
  /** O papel envia PP ao financeiro (`jobs.enviar_pp`, decisão 136)?
   *  Obrigatório: é ele que tira do produtor o "Enviar" e o cancelamento
   *  de PP já enviada. Repassado à tabela. */
  papelEnviaPP: boolean;
  /** Comitê de Aprovações (decisão 223): as regras, quem aprova direto e o
   *  que ele já aprovou, por PP a emitir. Repassado ao formulário da PP. */
  comiteDaPP: ComiteDaPP;
  /** A planilha aberta pela caixa do Comitê (decisão 223). Repassado à
   *  tabela; nulo fora dela. */
  emDecisaoPP: (PedidoEmDecisao & { embutido: boolean }) | null;
  /** Corrige a NF da PP em avaliação sem aprovar (`jobs.corrigir_nf_pp`,
   *  revisão da decisão 152). Repassado à tabela e ao painel do item. */
  papelCorrigeNf: boolean;
  /** `cadastros.fornecedores.editar` — repassado à tabela. */
  podeCadastrarFornecedor?: boolean;
  podeEditarFornecedor?: boolean;
  /** Confirmar o BV — `jobs.confirmar_bv`, administrador e GP (decisão
   *  080). Telas de leitura mandam `false`. */
  podeConfirmarBv: boolean;
  /** Job já enviado para faturamento: o valor da nota está congelado em
   *  `jobs_envio_faturamento` e nem errata nem save podem mexer nele
   *  (decisão 028, nota de 27/08/2026). O servidor já recusava — sem
   *  isto a tela deixava montar a errata inteira antes de reprovar. */
  jaEnviadoParaFaturamento?: boolean;
  /** As linhas que uma errata ainda não revisada mudou (decisão 185): a PP
   *  delas não sai para o financeiro até a revisão da abertura ser salva.
   *  As outras enviam normalmente; gerar, editar e cancelar seguem
   *  liberados em todas. */
  linhasComEnvioTravado?: string[];
  /** Todas as PPs ativas de cada item realizado (PPs parciais). */
  ppsPorItemId: Map<string, PedidoCompraNaLista[]>;
  /** Decisão 153: as PPs a emitir de cada item, fora do realizado. */
  aEmitirPorItemId: Map<string, PPAEmitir[]>;
  /** Decisão 152: os CNPJs tomadores da NF e o de cada empresa emissora. */
  tomadoresDaNf: TomadorDaNf[];
  tomadorPorEmpresa: Record<string, string>;
  /** Decisão 189: as verbas de que o usuário presta contas — o botão do
   *  cartão da verba no painel do item. Telas de leitura não mandam. */
  ppsQuePossoPrestarContas?: string[];
  /** Decisão 216: o job Mídia System (`null` = não é). Na auditoria a PP
   *  vai sem NF; depois da liberação, a que foi sem nota presta contas. */
  midiaSystem: MidiaSystemDoJob | null;
  /** Decisão 156: o CNPJ que a PP nova já traz escolhido (regional do job →
   *  empresa gerencial → principal). Repassado à tabela. */
  cnpjPadraoDaPP: string | null;
  fornecedores: Array<Pick<Fornecedor, "id" | "nome" | "razao_social" | "status" | "cpf_cnpj">>;
  empresas: Array<Pick<Empresa, "id" | "razao_social" | "nome_fantasia" | "ativo" | "principal">>;
  /** Membros ativos do tenant — o nome de quem concluiu as PPs do item e
   *  do responsável da verba de produção anterior à decisão 171. */
  responsaveis: Array<{ id: string; nome: string }>;
  /** BV por id do item da versão. Só existe em item tipo A, AR ou D. */
  bvsPorItem: Record<string, ItemBv[]>;
  /** Estado do save por id do item da VERSÃO, como o BV. */
  savePorItem: Record<string, EstadoSaveDaLinha>;
  /** Saldos de save que o cliente deste job tem para gastar. */
  saldosDeSave: SaldoDeSave[];
  /** Nome do cliente — aparece no texto do formulário de save. */
  clienteNome: string;
  /** Linhas (`jobs_itens_orcado.id`) em destaque na planilha: a do pedido
   *  de save que o financeiro está aprovando, quando a planilha do job no
   *  financeiro abre a partir da aprovação (decisão 099, 22/09/2026).
   *  Obrigatória: quem não destaca manda `[]`. */
  destacarItens: string[];
  /** As linhas que uma errata ainda não revisada mudou (decisão 185), com
   *  a borda vermelha da revisão da abertura (revisão da 185, 19/10/2026):
   *  o financeiro vê onde a errata mexeu ao reconferir a abertura. Só a
   *  planilha do job no financeiro manda; obrigatória pelo motivo de
   *  `destacarItens`. */
  linhasDaRevisao: string[];
  /** Exportar a planilha interna do job (decisão 088). Quem vê a tela
   *  exporta; o freelancer, que só tem a visão restrita, não. */
  podeExportarInterna?: boolean;
  /** Job de serviço Interno (decisão 105): a errata trava tipo e
   *  planejado, e o save não existe — nem coluna, nem pedido. Obrigatória:
   *  prop opcional esconde a fronteira em que o campo some. */
  interno: boolean;
  /** Na tela do job no financeiro, "Ver versão aprovada" sai do módulo e
   *  pede confirmação, como o "Orçamento aprovado" da ficha (decisões 021
   *  e 108). Obrigatória pelo mesmo motivo de `interno`. */
  confirmarSaidaParaOrcamento: boolean;
  /** "Editar orçado" do financeiro (decisão 115). `null` na tela da
   *  produção e onde ninguém edita. Obrigatória pelo mesmo motivo de
   *  `interno`. */
  edicaoDoFinanceiro: EdicaoDoFinanceiro | null;
  /** A linha de parâmetros do job, embaixo do rótulo da planilha (decisão
   *  224). Só nas telas do financeiro; `null` na produção e na conferência
   *  em leitura. Obrigatória pelo mesmo motivo de `interno`. */
  parametrosDoJob: ParametrosDoJobNaPlanilha | null;
  /** O job como foi aberto (decisão 151, entrega 2): o card de Totais do
   *  job inteiro fecha a ótica Planejada sobre ele quando o valor do job
   *  mudou. `null` antes da abertura. Obrigatória pelo mesmo motivo de
   *  `interno`. */
  aberturaDoJob: FechamentoDaAbertura | null;
  /** A ótica com que o Resultado dos Totais abre. As planilhas em pop-up
   *  da abertura do job abrem em "Planejada" (Tiago, 08/10/2026); sem ela,
   *  "Realizada", como sempre. */
  resultadoInicial?: "planejada" | "realizada";
  /** A planilha em pop-up da abertura do job (19/10/2026): no modelo
   *  mensal (e na Mídia Off) a régua troca de mês aqui mesmo, sem navegar —
   *  navegar sairia da abertura e perderia o que foi preenchido. Abre na
   *  visão do Trimestre (na mídia, da Campanha), com todos os meses. */
  mesNoLugar?: boolean;
  /** Quem faz o quê na errata (decisão 159): o GP e o administrador
   *  REGISTRAM — a errata vai ao financeiro na hora; o produtor PREPARA —
   *  deixa a errata pronta para um GP enviar. `null` = não faz errata
   *  (financeiro, freelancer, telas de leitura). O status do job é
   *  conferido aqui. Obrigatória pelo mesmo motivo de `interno`. */
  papelNaErrata: "registra" | "prepara" | null;
  /** A errata pronta para envio do job, se houver (uma por job). `null`
   *  onde ela não se vê (financeiro). Obrigatória pelo mesmo motivo de
   *  `interno`. */
  errataPronta: ErrataPronta | null;
  /** Mídia Off (decisão 167): a planilha do job é a de mídia, só leitura.
   *  `null` nos outros modelos. Obrigatória pelo mesmo motivo de
   *  `interno`. */
  midia: MidiaDoDetalhe | null;
  /** O "Histórico" da barra (decisão 186): as versões da planilha, de cada
   *  momento do job, em leitura. Nas duas telas do job e na Abertura de Job
   *  do financeiro; fora da planilha da origem do save, que é só consulta.
   *  A Mídia Off não tem. Obrigatória pelo mesmo motivo de `interno`. */
  comHistorico: boolean;
}

/** O histórico na planilha (decisão 186): o botão da barra e, na versão
 *  antiga, a faixa de cima e o selo de cada linha que o momento mudou. */
interface HistoricoNaPlanilha {
  botao: React.ReactNode;
  antiga: {
    faixa: React.ReactNode;
    /** Ausente com o "Destacar o que mudou" desligado. */
    selo: ((itemId: string) => React.ReactNode) | undefined;
  } | null;
}

type PropsDaPlanilha = Omit<Props, "comHistorico"> & {
  historico: HistoricoNaPlanilha | null;
};

// A versão antiga não traz o realizado, as PPs, o BV nem o save: eles andam
// com a planilha atual. Referências estáveis, como `SEM_MESES`.
const SEM_REALIZADOS = new Map<string, JobItemRealizado>();
const SEM_PPS = new Map<string, PedidoCompraNaLista[]>();
const SEM_A_EMITIR = new Map<string, PPAEmitir[]>();
const SEM_BVS: Record<string, ItemBv[]> = {};
const SEM_SAVES: Record<string, EstadoSaveDaLinha> = {};
const SEM_LINHAS: string[] = [];

const ERRO_DO_HISTORICO = "Não foi possível carregar o histórico da planilha. Tente de novo.";

/** O que a planilha de hoje é, num texto: muda quando uma errata, uma
 *  alteração do financeiro ou um save mexem nela, e só aí. */
function assinaturaDaPlanilha(itens: ItemPlanilhaJob[], grupos: VersaoOrcamentoGrupo[]): string {
  return JSON.stringify([
    itens.map((i) => [
      i.id,
      i.grupo_id,
      i.ordem,
      i.item,
      i.tipo_custo,
      i.linha_vermelha,
      i.valor_unitario_orcado,
      i.quantidade_orcada,
      i.dias_meses_orcado,
      i.valor_unitario_planejado,
      i.quantidade_planejada,
      i.dias_meses_planejado,
      i.em_save,
      i.save_consumido,
      i.cancelada_em,
    ]),
    grupos.map((g) => [g.id, g.nome, g.ordem, g.mes_id]),
  ]);
}

/**
 * A planilha do job com o histórico de versões (decisão 186, 17/10/2026).
 * Guarda a versão escolhida e, quando ela não é a atual, entrega à mesma
 * planilha as linhas e os agrupamentos daquele momento, em leitura: sem
 * realizado, PP, BV, save, errata ou edição. O histórico só é lido quando
 * alguém abre o "Histórico" (a página não paga por ele) e a conta das
 * versões roda aqui (`montarHistorico`).
 */
export function JobRealizadoSection({ comHistorico, ...props }: Props) {
  const { job, versao, modeloPlanilha, itens, grupos, midia } = props;
  const [dados, setDados] = React.useState<DadosDoHistorico | null>(null);
  const [carregando, setCarregando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const [chave, setChave] = React.useState("atual");
  const [destacar, setDestacar] = React.useState(true);
  const pedido = React.useRef(0);

  // A planilha mudou de verdade (errata, alteração, save): o histórico lido
  // ficou velho, e a tela volta para a planilha atual. Pelo CONTEÚDO, e não
  // pela referência: a troca de mês da régua no mensal (`?mes=`) recarrega
  // a página e entrega uma lista nova com as mesmas linhas — e a versão
  // escolhida tem de ficar (revisão da decisão 186, 26/10/2026).
  const assinatura = React.useMemo(() => assinaturaDaPlanilha(itens, grupos), [itens, grupos]);
  React.useEffect(() => {
    pedido.current += 1;
    setDados(null);
    setErro(null);
    setCarregando(false);
    setChave("atual");
  }, [assinatura]);

  const versoes = React.useMemo(() => (dados ? montarHistorico(dados) : null), [dados]);
  const internacional = React.useMemo(
    () => configDaPlanilha(modeloPlanilha, versao).internacional,
    [modeloPlanilha, versao],
  );
  // O valor do job de cada versão, pela mesma conta do cabeçalho e da barra
  // da errata.
  const valores = React.useMemo(
    () =>
      new Map(
        (versoes ?? []).map((v) => [
          v.chave,
          calcularTotaisVersao(
            v.itens.map((i) => ({
              tipo_custo: i.tipo_custo,
              total_orcado: Number(i.total_orcado ?? 0),
              em_save: i.em_save,
              save_consumido: Number(i.save_consumido ?? 0),
            })),
            versao.percentual_honorarios,
            versao.percentual_imposto,
            internacional,
          ).valorJob,
        ]),
      ),
    [versoes, versao.percentual_honorarios, versao.percentual_imposto, internacional],
  );
  const valorDe = React.useCallback((v: VersaoDaPlanilha) => valores.get(v.chave) ?? 0, [valores]);

  const carregar = React.useCallback(() => {
    if (dados || carregando) return;
    const este = ++pedido.current;
    setCarregando(true);
    setErro(null);
    carregarHistoricoDaPlanilha(job.id)
      .then((r) => {
        if (este !== pedido.current) return;
        if (r.ok) setDados(r.dados);
        else setErro(r.message);
      })
      .catch(() => {
        if (este === pedido.current) setErro(ERRO_DO_HISTORICO);
      })
      .finally(() => {
        if (este === pedido.current) setCarregando(false);
      });
  }, [dados, carregando, job.id]);

  if (!comHistorico || midia) return <PlanilhaDoJob {...props} historico={null} />;

  const indice = versoes ? versoes.findIndex((v) => v.chave === chave) : -1;
  const antiga = versoes && indice > 0 ? versoes[indice] : null;
  const botao = (
    <BotaoHistorico
      versoes={versoes}
      carregando={carregando}
      erro={erro}
      selecionada={antiga ? antiga.chave : "atual"}
      valorDe={valorDe}
      moeda={versao.moeda}
      onAbrir={carregar}
      onEscolher={setChave}
    />
  );
  if (!versoes || !antiga) return <PlanilhaDoJob {...props} historico={{ botao, antiga: null }} />;

  const mudancaPorLinha = new Map<string, MudancaDoHistorico>();
  for (const m of antiga.mudancas) if (m.itemId) mudancaPorLinha.set(m.itemId, m);
  const anterior = versoes[indice + 1] ?? null;
  const faixa = (
    <FaixaDaVersao
      versao={antiga}
      valorJob={{ antes: anterior ? valorDe(anterior) : null, depois: valorDe(antiga) }}
      moeda={versao.moeda}
      temAnterior={anterior !== null}
      temProxima
      onAnterior={() => anterior && setChave(anterior.chave)}
      onProxima={() => setChave(versoes[indice - 1].chave)}
      onAtual={() => setChave("atual")}
      destacar={destacar}
      onDestacar={setDestacar}
    />
  );
  return (
    <PlanilhaDoJob
      // Outra versão é outra planilha: o rascunho e os recolhidos começam de
      // novo, e "Voltar para a atual" remonta a de hoje.
      key={antiga.chave}
      {...props}
      itens={antiga.itens}
      grupos={antiga.grupos}
      realizadosMap={SEM_REALIZADOS}
      ppsPorItemId={SEM_PPS}
      aEmitirPorItemId={SEM_A_EMITIR}
      bvsPorItem={SEM_BVS}
      savePorItem={SEM_SAVES}
      linhasComEnvioTravado={SEM_LINHAS}
      destacarItens={destacar ? [...mudancaPorLinha.keys()] : SEM_LINHAS}
      // A versão antiga não é a que a revisão confere.
      linhasDaRevisao={SEM_LINHAS}
      podeAcoes={false}
      podeMexerNoSave={false}
      podeGerarPP={false}
      papelEnviaPP={false}
      comiteDaPP={COMITE_DA_PP_SEM_ACAO}
      emDecisaoPP={null}
      papelCorrigeNf={false}
      podeCadastrarFornecedor={false}
      podeEditarFornecedor={false}
      podeConfirmarBv={false}
      podeExportarInterna={false}
      edicaoDoFinanceiro={null}
      aberturaDoJob={null}
      papelNaErrata={null}
      errataPronta={null}
      historico={{
        botao,
        antiga: {
          faixa,
          selo: destacar
            ? (id) => {
                const m = mudancaPorLinha.get(id);
                return m ? <SeloDaLinha mudanca={m} moeda={versao.moeda} /> : null;
              }
            : undefined,
        },
      }}
    />
  );
}

function PlanilhaDoJob({
  job,
  versao,
  nomeJob,
  grupos,
  itens,
  realizadosMap,
  categoriasMap,
  podeAcoes,
  podeMexerNoSave,
  podeExportarInterna = false,
  podeGerarPP = false,
  papelEnviaPP,
  comiteDaPP,
  emDecisaoPP,
  papelCorrigeNf,
  podeCadastrarFornecedor = false,
  podeEditarFornecedor = false,
  podeConfirmarBv,
  jaEnviadoParaFaturamento = false,
  linhasComEnvioTravado = [],
  ppsPorItemId,
  aEmitirPorItemId,
  tomadoresDaNf,
  tomadorPorEmpresa,
  ppsQuePossoPrestarContas = [],
  midiaSystem,
  cnpjPadraoDaPP,
  fornecedores,
  empresas,
  responsaveis,
  bvsPorItem,
  savePorItem,
  saldosDeSave,
  clienteNome,
  destacarItens,
  linhasDaRevisao,
  modeloPlanilha,
  meses: mesesSalvos = SEM_MESES,
  mesPedido,
  hrefPlanilha,
  faturamentoMensal = SEM_FATURAMENTO_MENSAL,
  interno,
  confirmarSaidaParaOrcamento,
  edicaoDoFinanceiro,
  parametrosDoJob,
  aberturaDoJob,
  resultadoInicial,
  mesNoLugar = false,
  papelNaErrata,
  errataPronta,
  midia,
  historico,
}: PropsDaPlanilha) {
  const router = useRouter();

  // Um só lugar decide como este job fecha — o mesmo objeto vai para a
  // barra de errata e para o card de Totais, que não podem discordar.
  const planilha = React.useMemo(
    () => configDaPlanilha(modeloPlanilha, versao),
    [modeloPlanilha, versao],
  );
  // Uma chave para a página inteira. Abre em Bruto: é a tela de sempre,
  // e quem não lida com BV nunca precisa saber que a outra existe.
  const [visao, setVisao] = React.useState<VisaoBv>(VISAO_BV_PADRAO);

  // MODO ERRATA — mesma razão da chave acima, levada ao extremo: a errata
  // muda a planilha, o card de Totais e a barra do rodapé ao mesmo tempo,
  // então o rascunho tem que morar no ancestral comum dos três. Antes de
  // 27/08/2026 isto era um drawer com uma segunda tabela, e o problema não
  // existia porque nada da tela reagia.
  // Os agrupamentos entram no rascunho desde 09/10/2026: a errata também
  // organiza a planilha (ordem, agrupamento novo, renomeado e removido).
  // O "Editar orçado" do financeiro (decisão 115) é o MESMO rascunho, com o
  // escopo dele. Na errata o planejado abre desde 15/10/2026 (volta atrás
  // da decisão 151); no financeiro, só com o job na fila da abertura
  // (revisão de 14/10/2026). Tipo, linha nova e a trava de PP ficam com a
  // tabela (`modoDaEdicao`).
  const modoFinanceiro = edicaoDoFinanceiro !== null;
  const planejadoNaFila = modoFinanceiro && job.status === "aguardando_abertura";
  const rascunho = useRascunhoErrata(itens, interno, grupos);
  const errata = React.useMemo(
    () =>
      modoFinanceiro && !planejadoNaFila
        ? {
            ...rascunho,
            planejadoLiberado: () => false,
            // No Interno o planejado acompanha o orçado (decisão 105): vale o
            // texto do rascunho, que diz isso.
            motivoPlanejadoTravado: (chave: string) =>
              interno ? rascunho.motivoPlanejadoTravado(chave) : MOTIVO_PLANEJADO_DO_FINANCEIRO,
          }
        : rascunho,
    [modoFinanceiro, planejadoNaFila, rascunho, interno],
  );
  // A barra de ações do job é irmã das abas e precisa sair de cena
  // enquanto a barra da errata está no ar — as duas grudam no mesmo pé de
  // janela. Nas telas que não têm barra de ações (financeiro, conferência
  // de abertura) ninguém escuta, e o sinal se perde sem efeito.
  React.useEffect(() => {
    definirModoErrata(errata.ativo);
    return () => definirModoErrata(false);
  }, [errata.ativo]);

  // Decisão 219: os meses do trimestre que esta errata inclui no job (o
  // mês que o GP esqueceu no orçamento). Vivem no rascunho: entram na tela
  // como meses do job e só existem no banco quando a errata é registrada.
  const [mesesNovos, setMesesNovos] = React.useState<string[]>([]);
  React.useEffect(() => {
    if (!errata.ativo) setMesesNovos([]);
  }, [errata.ativo]);
  const meses = React.useMemo(
    () =>
      mesesNovos.length === 0
        ? mesesSalvos
        : [
            ...mesesSalvos,
            ...mesesNovos.map(
              (mes): VersaoOrcamentoMes => ({
                id: chaveDoMesNovo(mes),
                tenant_id: "",
                versao_orcamento_id: versao.id,
                mes,
                incluido_na_errata_id: null,
                created_by: null,
                created_at: "",
                updated_at: "",
              }),
            ),
          ].sort((a, b) => a.mes.localeCompare(b.mes)),
    [mesesSalvos, mesesNovos, versao.id],
  );
  // Os meses do trimestre que o job não tem. Só no Fee e no Always On: a
  // Mídia Off tem a régua da campanha.
  const doTrimestre = React.useMemo(
    () =>
      modeloPlanilha === "mensal" && !midia && mesesSalvos.length > 0
        ? mesesDoTrimestre(trimestreDe(mesesSalvos[0].mes))
        : [],
    [modeloPlanilha, midia, mesesSalvos],
  );
  const faltamNoJob = doTrimestre.filter(
    (m) => !mesesSalvos.some((x) => x.mes.slice(0, 10) === m),
  );
  const faltamNaErrata = faltamNoJob.filter((m) => !mesesNovos.includes(m));

  // Errata com alteração ainda não registrada: o voltar e as abas da faixa
  // do projeto perguntam antes de descartar (decisão 108). O rascunho só
  // existe na memória da tela.
  const [saidaDaErrata, setSaidaDaErrata] = React.useState<string | null>(null);
  // Decisão 159: o produtor PREPARA a errata (deixa pronta para envio) e o
  // GP a REGISTRA. `abertaDaPronta` diz que o modo errata no ar é a errata
  // pronta reaberta — o envio a consome, e "Fechar" não a apaga.
  const prepara = papelNaErrata === "prepara";
  const [abertaDaPronta, setAbertaDaPronta] = React.useState(false);
  const [descartandoPronta, setDescartandoPronta] = React.useState(false);
  const [descartePendente, setDescartePendente] = React.useState(false);
  const [erroDescarte, setErroDescarte] = React.useState<string | null>(null);
  const prontaAberta = abertaDaPronta ? errataPronta : null;
  useProtegerSaida(errata.ativo && errata.temMudanca, (href) => setSaidaDaErrata(href));

  // Quem ainda não disse se sai mais PP (decisão 052) — o alcance do
  // botão "Concluir PPs" da barra. O servidor refaz esta lista antes de
  // gravar; aqui ela serve para contar, listar no aviso e apagar o botão
  // quando não sobrou ninguém.
  const itensEmAberto: ItemEmAberto[] = React.useMemo(() => {
    const lista: ItemEmAberto[] = [];
    for (const item of itens) {
      if (!itemPrecisaDeConclusao(item.tipo_custo, item.em_save === true)) {
        continue;
      }
      const realizado = realizadosMap.get(item.id);
      if (!realizado || realizado.pps_concluidas_em != null) continue;

      const pps = ppsPorItemId.get(realizado.id) ?? [];
      const emPPs = somaDasPPsNaoCanceladas(pps);
      // `A · Repasse` só fecha com as PPs cobrindo o orçado (decisão 062):
      // o botão mostra quanto falta e o deixa de fora do lote.
      const faltaAR = exigeSomaIgualAoOrcado(item.tipo_custo, item.em_save === true)
        ? faltaParaFecharOOrcado(emPPs, Number(item.total_orcado ?? 0))
        : 0;
      lista.push({
        itemRealizadoId: realizado.id,
        nome: item.item,
        situacao:
          pps.length === 0
            ? "nenhuma PP"
            : `${pps.length} ${pps.length === 1 ? "PP" : "PPs"} · ${formatCurrency(emPPs, versao.moeda)}`,
        faltaAR,
        faltaARTexto: formatCurrency(faltaAR, versao.moeda),
      });
    }
    return lista;
  }, [itens, realizadosMap, ppsPorItemId, versao.moeda]);

  const [confirmando, setConfirmando] = React.useState(false);
  const [salvando, setSalvando] = React.useState(false);
  const [erroErrata, setErroErrata] = React.useState<string | null>(null);
  // O mês enviado em que alguém clicou com a errata ligada: o aviso de por
  // que a linha não abre aparece acima da planilha dele (27/10/2026).
  const [tentouNoMes, setTentouNoMes] = React.useState<string | null>(null);

  // Os dois lados da conta, pela MESMA função que o card de Totais e o
  // servidor usam. Reimplementar aqui faria a barra mostrar um número e a
  // gravação outro.
  const paraTotais = React.useCallback(
    (lista: ItemPlanilhaJob[]) =>
      calcularTotaisVersao(
        lista.map((i) => ({
          tipo_custo: i.tipo_custo,
          total_orcado: Number(i.total_orcado ?? 0),
          em_save: i.em_save,
          save_consumido: Number(i.save_consumido ?? 0),
        })),
        versao.percentual_honorarios,
        versao.percentual_imposto,
        planilha.internacional,
      ),
    [
      versao.percentual_honorarios,
      versao.percentual_imposto,
      planilha.internacional,
    ],
  );

  const totaisAntes = React.useMemo(() => paraTotais(itens), [paraTotais, itens]);
  const totaisDepois = React.useMemo(
    () => paraTotais(errata.itens),
    [paraTotais, errata.itens],
  );

  // ---- "Editar orçado" do financeiro (decisão 115) ----------------------
  // As linhas mexidas (os valores do orçado e o tipo) e o que acompanha:
  // o envio ainda sem nota e a previsão de recebimento, parcela a parcela,
  // pela MESMA conta que a action grava (`distribuirDelta`).
  const linhasDoFinanceiro = React.useMemo(
    () =>
      modoFinanceiro && errata.ativo
        ? linhasAlteradasPeloFinanceiro(itens, errata.itens)
        : [],
    [modoFinanceiro, errata.ativo, errata.itens, itens],
  );
  const resumoDoFinanceiro =
    linhasDoFinanceiro.length === 0
      ? "nenhuma linha alterada ainda"
      : `${linhasDoFinanceiro.length} ${
          linhasDoFinanceiro.length === 1 ? "linha alterada" : "linhas alteradas"
        }`;

  async function confirmarEdicaoDoFinanceiro(motivo: string) {
    setSalvando(true);
    setErroErrata(null);
    const r = await registrarAlteracaoDoFinanceiro(job.id, {
      motivo,
      linhas: linhasDoFinanceiro.map((l) => ({
        job_item_orcado_id: l.id,
        valor_unitario: l.valorUnitarioPara,
        quantidade: l.quantidadePara,
        dias_meses: l.diasMesesPara,
        tipo_custo: l.tipoCustoPara,
        // Só com o job na fila e fora do Interno, em que o banco faz o
        // planejado seguir o orçado (revisão de 14/10/2026).
        ...(planejadoNaFila && !interno
          ? {
              valor_unitario_planejado: l.planUnitarioPara,
              quantidade_planejada: l.planQuantidadePara,
              dias_meses_planejado: l.planDiasMesesPara,
            }
          : {}),
      })),
    });
    setSalvando(false);
    if (!r.ok) {
      setErroErrata(r.message);
      return;
    }
    setConfirmando(false);
    errata.descartar();
    router.refresh();
  }

  async function confirmarErrata(descricao: string) {
    setSalvando(true);
    setErroErrata(null);
    const { descricao: _descricao, ...doRascunho } = errata.payload(descricao);
    void _descricao;
    const conteudo = { ...doRascunho, meses_novos: mesesNovosDoPayload() };
    // Quem prepara grava a errata pronta para envio (decisão 159); quem
    // registra envia ao financeiro — e, se a errata veio da pronta, a
    // consome no mesmo passo.
    const r = prepara
      ? await salvarErrataPronta(job.id, {
          errataProntaId: errataPronta?.id ?? null,
          descricao: descricao === "" ? null : descricao,
          ...conteudo,
        })
      : await registrarErrata(job.id, {
          descricao,
          ...conteudo,
          errataProntaId: prontaAberta?.id ?? null,
        });
    setSalvando(false);
    if (!r.ok) {
      setErroErrata(r.message);
      return;
    }
    setConfirmando(false);
    setAbertaDaPronta(false);
    errata.descartar();
    router.refresh();
  }

  async function confirmarDescarteDaPronta() {
    if (!errataPronta) return;
    setDescartePendente(true);
    setErroDescarte(null);
    const r = await descartarErrataPronta(job.id, errataPronta.id);
    setDescartePendente(false);
    if (!r.ok) {
      setErroDescarte(r.message);
      return;
    }
    setDescartandoPronta(false);
    router.refresh();
  }

  /** Liga o modo errata — com a errata pronta, se o job tiver uma (decisão
   *  159): só existe uma por vez, e quem abre continua dela. */
  function abrirErrata() {
    // A errata é edição do Orçado: o bloco volta à tela junto com ela,
    // esteja escondido ou não.
    setOrcadoVisivel(true);
    setErroErrata(null);
    setAbertaDaPronta(errataPronta !== null);
    // Decisão 219: a pronta que inclui mês volta com ele.
    setMesesNovos((errataPronta?.conteudo?.meses_novos ?? []).map((m) => m.mes));
    errata.ligar(errataPronta?.conteudo ?? null);
  }

  /** Decisão 219: o mês que falta entra no rascunho — com os itens do
   *  último mês do job, copiados como linhas novas, ou vazio — e a tela vai
   *  para ele. */
  function adicionarMes(mes: string, copiarItens: boolean) {
    const chave = chaveDoMesNovo(mes);
    setMesesNovos((atual) => (atual.includes(mes) ? atual : [...atual, mes]));
    const fonte = mesesSalvos[mesesSalvos.length - 1];
    if (copiarItens && fonte) {
      for (const g of errata.grupos.filter((x) => x.mes_id === fonte.id)) {
        const r = errata.criarGrupo(g.nome, chave);
        if (!r.ok) continue;
        for (const it of errata.itens.filter((i) => i.grupo_id === g.id && !i.cancelada_em)) {
          const k = errata.adicionar(r.id, it.linha_vermelha);
          errata.editarNome(k, it.item);
          errata.editarTipo(k, it.tipo_custo);
          if (it.linha_vermelha) continue;
          errata.editarCampo(k, "unitario", paraEdicao(Number(it.valor_unitario_orcado ?? 0)));
          errata.editarCampo(k, "quantidade", paraEdicao(Number(it.quantidade_orcada ?? 0)));
          errata.editarCampo(k, "diasMeses", paraEdicao(Number(it.dias_meses_orcado ?? 0)));
          errata.editarCampo(k, "planUnitario", paraEdicao(Number(it.valor_unitario_planejado ?? 0)));
          errata.editarCampo(k, "planQuantidade", paraEdicao(Number(it.quantidade_planejada ?? 0)));
          errata.editarCampo(k, "planDiasMeses", paraEdicao(Number(it.dias_meses_planejado ?? 0)));
        }
      }
    }
    if (hrefPlanilha && !mesNoLugar) {
      router.push(`${hrefPlanilha}&mes=${mes.slice(0, 7)}`, { scroll: false });
    }
  }

  /** Os meses novos que a errata leva: o deixado vazio não entra. */
  function mesesNovosDoPayload() {
    const mesDoGrupo = new Map(errata.grupos.map((g) => [g.id, g.mes_id ?? null]));
    return mesesNovos
      .map((mes) => ({ chave: chaveDoMesNovo(mes), mes }))
      .filter((m) => errata.itens.some((i) => mesDoGrupo.get(i.grupo_id) === m.chave));
  }

  /** Sai do modo errata sem gravar. A errata pronta, se havia, fica como
   *  estava: descartá-la é pela faixa. */
  function fecharErrata() {
    setAbertaDaPronta(false);
    errata.descartar();
  }

  // Recolher agrupamento, igual à planilha do orçamento: o subtotal e a
  // rentabilidade continuam à vista, que é o que justifica recolher.
  // Os do rascunho: o agrupamento criado na errata também recolhe.
  const gruposIds = React.useMemo(() => errata.grupos.map((g) => g.id), [errata.grupos]);
  const recolher = useGruposRecolhiveis(gruposIds);

  // SAVE — a coluna nasce recolhida na alça lateral e só abre sozinha
  // quando ESTE job já gera ou consome save (decisão 107). O saldo que o
  // cliente tem em outros jobs não abre mais a coluna. Quem nunca usou
  // liga pela alça ou pelo menu "Exibir" para criar o primeiro save.
  const [saveLigado, setSaveLigado] = React.useState(
    Object.keys(savePorItem).length > 0,
  );
  // O Interno não tem save (decisão 105).
  const temSave = saveLigado && !interno;
  const [linhaSave, setLinhaSave] = React.useState<ItemPlanilhaJob | null>(
    null,
  );

  // MENU "EXIBIR" (decisão 045). Estado de tela: não vai para o banco nem
  // para a URL. Orçado liga/desliga; Planejado e Realizado nunca saem —
  // o realizado é por onde se acompanham as PPs, e o planejado é o custo
  // com que ele se compara. As duas rentabilidades nascem fechadas: com
  // elas desligadas a planilha é a de sempre.
  const [orcadoVisivel, setOrcadoVisivel] = React.useState(true);
  const [rentabPlanejada, setRentabPlanejada] = React.useState(false);
  const [rentabRealizada, setRentabRealizada] = React.useState(false);
  // A linha cancelada por errata fica na planilha, zerada (decisão 151;
  // 15/10/2026). O "Exibir" a esconde; na errata ela volta à vista, para
  // quem corrige ver o que já saiu.
  const [canceladasVisiveis, setCanceladasVisiveis] = React.useState(true);
  const temCancelada = itens.some((i) => i.cancelada_em);
  // A linha com PP abre em sublinhas, uma por PP (decisão 208): a seta ao
  // lado do nome abre um item; o "Exibir" abre todos. Nasce fechado, como a
  // planilha de sempre.
  const [ppsNasLinhas, setPpsNasLinhas] = React.useState(false);
  const temPP = React.useMemo(
    () => [...ppsPorItemId.values()].some((pps) => pps.some((pp) => pp.status !== "cancelada")),
    [ppsPorItemId],
  );
  // A errata exige job aberto, a porta de `AlterarOrcadoButton`, e fecha
  // com o envio para faturamento. O financeiro chega aqui com `podeAcoes`
  // falso e não faz errata: desde a decisão 115 (28/09/2026) ele edita os
  // valores do orçado pelo "Editar orçado" (`edicaoDoFinanceiro`), que é
  // outra porta — fecha na primeira nota, não no envio.
  //
  // Modelo mensal (decisão 078): a porta fecha por MÊS. Só as tabelas dos
  // meses já enviados perdem a errata; o botão da errata só trava quando
  // todos os meses foram enviados.
  //
  // O SAVE deixou de seguir a porta da errata na decisão 099 (22/09/2026):
  // gerar save vale até o envio para ENCERRAMENTO, e só consumir e retirar
  // consumo fecham com o envio para faturamento (no mensal, pelo mês da
  // linha). Ver `modoDoSave` e `portaDoConsumo`, logo abaixo.
  const mesesEnviados = React.useMemo(
    () => new Set(faturamentoMensal.filter((m) => m.envio !== null).map((m) => m.mesId)),
    [faturamentoMensal],
  );
  // Com mês faltando no trimestre, a errata segue aberta mesmo com todos os
  // meses do job enviados: é por ela que o mês entra (decisão 219).
  const todosOsMesesEnviados =
    faturamentoMensal.length > 0 &&
    mesesEnviados.size === faturamentoMensal.length &&
    faltamNoJob.length === 0;
  // Decisão 159: a errata deixou de seguir `podeAcoes` (que continua
  // valendo para o BV) — o produtor também a faz, deixando-a pronta para
  // envio. Continua exigindo o job aberto.
  const errataLiberada =
    papelNaErrata !== null && jobAceitaAcoesPlanilha(job.status as JobStatus);
  const podeErrata = errataLiberada && !jaEnviadoParaFaturamento && !todosOsMesesEnviados;

  // "Editar orçado" do financeiro (decisão 115): até a primeira nota ou o
  // encerramento — o encerrado chega com `travadoPor`, montado pela página.
  // No mensal a trava da nota é por mês — só o mês com nota fica de fora
  // (P4 do Tiago, 28/09/2026).
  const mesesComNota = React.useMemo(
    () => new Set(edicaoDoFinanceiro?.mesesComNota ?? []),
    [edicaoDoFinanceiro],
  );
  const todosOsMesesComNota =
    faturamentoMensal.length > 0 &&
    faturamentoMensal.every((m) => mesesComNota.has(m.mesId));
  const motivoEdicaoTravada =
    edicaoDoFinanceiro?.travadoPor ??
    (todosOsMesesComNota
      ? "Todos os meses do job já têm nota emitida: o orçado não muda mais pelo financeiro."
      : null);
  const podeEditarOrcado = modoFinanceiro && motivoEdicaoTravada === null;
  /** O mês que fecha para quem edita nesta tela: na errata, o mês enviado;
   *  na edição do financeiro, o mês com nota. */
  const mesTravado = (mesId: string) =>
    modoFinanceiro ? mesesComNota.has(mesId) : mesesEnviados.has(mesId);

  // SAVE NO JOB (decisão 099). Três modos:
  //  - `pedido`: job aberto — cada mudança é errata de save, vira pedido ao
  //    financeiro e passa pelo "Prosseguir com envio" do pop-up;
  //  - `direto`: job devolvido pelo financeiro — o save volta a editar
  //    direto na cópia, sem pedido (§11);
  //  - leitura (`null`): pré-abertura, job encerrado, a planilha do
  //    financeiro — o pop-up só abre nas linhas com save (§18).
  // Quem age nos dois primeiros é o administrador ou qualquer GP
  // (`podeMexerNoSave`, 24/09/2026) — não a regra "admin ou responsável"
  // de errata e PP.
  const modoDoSave: "pedido" | "direto" | null = !podeMexerNoSave || interno
    ? null
    : jobAceitaAcoesPlanilha(job.status)
      ? "pedido"
      : job.status === "rejeitado_financeiro"
        ? "direto"
        : null;
  const motivoErrataTravada = jaEnviadoParaFaturamento
    ? "Job já enviado para faturamento: o valor da nota está congelado e não há mais errata. Fale com o financeiro antes da emissão da nota."
    : todosOsMesesEnviados
      ? "Todos os meses do job já foram enviados para faturamento: o valor das notas está congelado e não há mais errata."
      : null;

  // Cmd+Z / Ctrl+Z desfaz um passo do rascunho da errata.
  //
  // O listener é da janela porque a edição acontece em dezenas de inputs
  // da planilha, e o alvo do atalho é o RASCUNHO, não o campo focado —
  // esses inputs são controlados pelo React, então o desfazer nativo do
  // navegador não voltaria nada de qualquer jeito.
  //
  // O `textarea` fica de fora: é a descrição da errata, no pop-up de
  // confirmação, e lá o desfazer nativo é o certo.
  React.useEffect(() => {
    if (!errata.ativo) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey) return;
      if (e.key.toLowerCase() !== "z") return;
      const alvo = document.activeElement;
      if (alvo instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      errata.desfazer();
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [errata]);

  // ---- save: as portas e os números de cada linha (decisão 099) ----------
  const mesDoGrupo = React.useMemo(
    () => new Map(grupos.map((g) => [g.id, g.mes_id ?? null])),
    [grupos],
  );

  /** O consumo desta linha já não muda: o job foi enviado para faturamento
   *  ou, no modelo mensal, o mês dela foi (§14). */
  function portaDoConsumo(item: ItemPlanilhaJob): PortaDoConsumo | null {
    if (jaEnviadoParaFaturamento) return { motivo: "faturamento" };
    const mesId = mesDoGrupo.get(item.grupo_id) ?? null;
    if (mesId && mesesEnviados.has(mesId)) {
      const mes = meses.find((m) => m.id === mesId);
      return { motivo: "mes", mes: mes ? nomeDoMes(mes.mes) : "este mês" };
    }
    return null;
  }

  /** Gerar save exige a linha sem PP e sem BV ativos (§16) — o banco
   *  recusa; o pop-up avisa antes. As duas listas já vêm sem os cancelados. */
  function gerarTravadoPor(item: ItemPlanilhaJob): string | null {
    const realizadoId = realizadosMap.get(item.id)?.id;
    const temPP = realizadoId
      ? (ppsPorItemId.get(realizadoId)?.length ?? 0) > 0
      : false;
    const temBv = (bvsPorItem[item.id]?.length ?? 0) > 0;
    return temPP || temBv
      ? "O save só poderá ser gerado depois de PPs e BV serem cancelados."
      : null;
  }

  /** Os números do job antes e depois de uma mudança na linha, como a
   *  PRODUÇÃO vê — pela mesma conta do card de Totais (§5). */
  function simularSave(item: ItemPlanilhaJob, m: MudancaNaLinha) {
    const depois = paraTotais(
      itens.map((i) =>
        i.id !== item.id
          ? i
          : {
              ...i,
              em_save: m.tipo === "marcar" ? m.emSave : i.em_save,
              save_consumido:
                m.tipo === "consumo"
                  ? m.totalConsumido
                  : m.emSave
                    ? 0
                    : i.save_consumido,
            },
      ),
    );
    return {
      antes: {
        valorJob: totaisAntes.valorJob,
        faturamentoPrevisto: totaisAntes.faturamentoPrevisto,
      },
      depois: {
        valorJob: depois.valorJob,
        faturamentoPrevisto: depois.faturamentoPrevisto,
      },
    };
  }

  const depoisDaAcao = (r: ResultadoDaAcaoDeSave) => {
    if (r.ok) router.refresh();
    return r;
  };

  const acoesDoSave: AcoesDoSaveNoJob | null =
    linhaSave && modoDoSave
      ? {
          modo: modoDoSave,
          gerarTravadoPor: gerarTravadoPor(linhaSave),
          portaDoConsumo: portaDoConsumo(linhaSave),
          simular: (m) => simularSave(linhaSave, m),
          onMarcarSave: async (marcar) =>
            depoisDaAcao(
              await registrarErrataDeSave(job.id, linhaSave.orcado_id, {
                tipo: "marcar",
                emSave: marcar,
              }),
            ),
          onSalvarConsumo: async (origens) =>
            depoisDaAcao(
              await registrarErrataDeSave(job.id, linhaSave.orcado_id, {
                tipo: "consumo",
                origens,
              }),
            ),
          onCancelarPedido: async (pedidoId) =>
            depoisDaAcao(await cancelarPedidoDeSave(job.id, pedidoId)),
          onRetirar: async (alvo) => depoisDaAcao(await retirarSave(job.id, alvo)),
        }
      : null;

  // Job aberto antes do fluxo: linhas com save ou consumo que nunca foram
  // ao financeiro. Elas saem pelo botão "Enviar N saves para aprovação"
  // (§3, `momento = 'legado_botao'`).
  const linhasNaoEnviadas = React.useMemo(
    () =>
      itens.flatMap((it) => {
        const e = savePorItem[it.id];
        if (!e) return [];
        const gera = situacaoDoSave(e, "gera") === "nao_enviado";
        const consome = situacaoDoSave(e, "consome") === "nao_enviado";
        if (!gera && !consome) return [];
        return [
          {
            id: it.id,
            item: it.item,
            grupo: grupos.find((g) => g.id === it.grupo_id)?.nome ?? "—",
            tipo: gera ? ("gera" as const) : ("consome" as const),
            codigo: e.origens[0]?.codigo ?? "",
            valor: gera
              ? Number(it.total_orcado ?? 0)
              : Number(it.save_consumido ?? 0),
          },
        ];
      }),
    [itens, savePorItem, grupos],
  );
  const [enviandoLegado, setEnviandoLegado] = React.useState(false);

  const linhaDoDialog: LinhaDoSave | null = linhaSave
    ? {
        id: linhaSave.orcado_id,
        nome: linhaSave.item,
        grupoNome: grupos.find((g) => g.id === linhaSave.grupo_id)?.nome ?? "—",
        tipoCusto: linhaSave.tipo_custo,
        totalOrcado: Number(linhaSave.total_orcado ?? 0),
      }
    : null;

  // Antes da abertura a planilha aparece inteira — o que fica de fora são
  // as ações que geram documento. O aviso substitui o antigo bloco
  // "Realizado indisponível", que escondia a planilha toda.
  // A versão antiga do histórico (decisão 186) fica em leitura, sem o
  // realizado: a mesma chave que zera o realizado antes da abertura, sem a
  // faixa de "aguardando abertura".
  const vendoAntiga = historico?.antiga != null;
  const preAbertura =
    vendoAntiga ||
    job.status === "aguardando_abertura" ||
    job.status === "rejeitado_financeiro";

  // A planilha inteira numa tabela só desde 24/08/2026: os pares
  // grupo → itens são montados aqui e vão de uma vez para a tabela.
  //
  // A lista vem do RASCUNHO, não das props: com o modo errata desligado
  // ela é idêntica aos itens salvos, e com ele ligado já traz as linhas
  // novas e sem as removidas. É o que faz a planilha, o card de Totais e a
  // barra do rodapé mostrarem o mesmo número enquanto se digita.
  const gruposDaPlanilha = React.useMemo<GrupoDoJob[]>(() => {
    // Os agrupamentos também vêm do rascunho: renomeados, criados e sem
    // os removidos na errata. Fora dela são os do job.
    const porGrupo = new Map<string, ItemPlanilhaJob[]>();
    for (const g of errata.grupos) porGrupo.set(g.id, []);
    for (const it of errata.itens) porGrupo.get(it.grupo_id)?.push(it);
    return errata.grupos.map((g) => ({
      id: g.id,
      nome: g.nome,
      itens: porGrupo.get(g.id) ?? [],
    }));
  }, [errata.grupos, errata.itens]);

  // MODELO MENSAL (decisão 078): a planilha do job se reparte nos meses da
  // versão aprovada. O mês mora no GRUPO da versão, e o item do job aponta
  // para ele — nada de mês foi copiado para o job. As contas saem do
  // rascunho da errata, como o resto da tela, para a régua acompanhar o que
  // se digita.
  const mensal =
    modeloPlanilha === "mensal" &&
    meses.length > 0 &&
    (hrefPlanilha !== undefined || mesNoLugar);
  // No pop-up (`mesNoLugar`) o mês mora aqui, não na URL: abre no Trimestre.
  const [mesNoPopUp, setMesNoPopUp] = React.useState("trimestre");
  const mesDaTela = mesNoLugar ? mesNoPopUp : mesPedido;
  const dadosDosMeses = React.useMemo(() => {
    if (!mensal) return [];
    const mesDoGrupo = new Map(errata.grupos.map((g) => [g.id, g.mes_id]));
    return meses.map((m) => {
      const gruposDoMes = gruposDaPlanilha.filter(
        (g) => mesDoGrupo.get(g.id) === m.id,
      );
      const itensDoMes = gruposDoMes.flatMap((g) => g.itens);
      const totais = paraTotais(itensDoMes);
      const custoPlanejado = itensDoMes.reduce(
        (s, it) => s + Number(it.total_planejado ?? 0),
        0,
      );
      const resultado = calcularResultadoOperacional(
        totais.valorJob,
        totais.deducoesDoResultado,
        custoPlanejado,
      );
      return {
        mes: m,
        chave: m.mes.slice(0, 7),
        grupos: gruposDoMes,
        itens: itensDoMes,
        faturamento: totais.faturamentoPrevisto,
        custoPlanejado,
        resultadoOperacional: resultado.resultadoOperacional,
        resultadoGeral: resultado.resultadoGeral,
      };
    });
  }, [mensal, meses, errata.grupos, gruposDaPlanilha, paraTotais]);
  // Sem `?mes=`, abre no Total, como a planilha do orçamento: o mês só abre
  // sozinho quando é escolhido na régua (Tiago, 27/10/2026).
  const mesSelecionado =
    !mensal || mesDaTela === undefined || mesDaTela === "trimestre"
      ? null
      : (dadosDosMeses.find((d) => d.chave === mesDaTela) ??
        dadosDosMeses[0] ??
        null);
  // O que acompanha a alteração do financeiro (decisão 115): o pop-up mostra
  // o antes → depois de cada parcela que muda. No mensal só andam os meses
  // mexidos; no job normal, o faturamento do job inteiro.
  const acompanhamDoFinanceiro = React.useMemo(() => {
    const envio: ParcelaQueAcompanha[] = [];
    const recebimento: ParcelaQueAcompanha[] = [];
    if (!edicaoDoFinanceiro || linhasDoFinanceiro.length === 0) {
      return { envio, recebimento };
    }
    const deltaTotal = emReais(
      emReais(totaisDepois.faturamentoPrevisto) - emReais(totaisAntes.faturamentoPrevisto),
    );
    const deltaDoMes = new Map<string, number>();
    if (mensal) {
      const mesDoGrupo = new Map(grupos.map((g) => [g.id, g.mes_id]));
      for (const d of dadosDosMeses) {
        const salvosDoMes = itens.filter((it) => mesDoGrupo.get(it.grupo_id) === d.mes.id);
        const antes = emReais(paraTotais(salvosDoMes).faturamentoPrevisto);
        const delta = emReais(emReais(d.faturamento) - antes);
        if (Math.abs(delta) >= 0.005) deltaDoMes.set(d.mes.mes.slice(0, 7), delta);
      }
    }
    const blocosDoRecebimento = mensal
      ? [...deltaDoMes.entries()].map(([chave, delta]) => ({
          delta,
          linhas: edicaoDoFinanceiro.recebimento.filter((r) => r.mes?.slice(0, 7) === chave),
        }))
      : [{ delta: deltaTotal, linhas: edicaoDoFinanceiro.recebimento }];
    for (const bloco of blocosDoRecebimento) {
      const depois = distribuirDelta(bloco.linhas, bloco.delta);
      bloco.linhas.forEach((l, k) => {
        if (depois[k].valor === l.valor) return;
        recebimento.push({
          chave: `recebimento-${l.mes ?? ""}-${l.data}-${k}`,
          rotulo: `${l.mes ? `${nomeDoMes(l.mes)} · ` : ""}${dataBr(l.data)}`,
          antes: l.valor,
          depois: depois[k].valor,
        });
      });
    }
    for (const e of edicaoDoFinanceiro.envios) {
      const delta = e.mes ? (deltaDoMes.get(e.mes.slice(0, 7)) ?? 0) : mensal ? 0 : deltaTotal;
      const depois = distribuirDelta(e.parcelas, delta);
      e.parcelas.forEach((parcela, k) => {
        if (depois[k].valor === parcela.valor) return;
        envio.push({
          chave: parcela.id,
          rotulo: `${e.mes ? `${nomeDoMes(e.mes)} · ` : ""}Parcela ${k + 1} · ${dataBr(parcela.data_vencimento)}`,
          antes: parcela.valor,
          depois: depois[k].valor,
        });
      });
    }
    return { envio, recebimento };
  }, [
    edicaoDoFinanceiro,
    linhasDoFinanceiro,
    totaisAntes,
    totaisDepois,
    mensal,
    grupos,
    dadosDosMeses,
    itens,
    paraTotais,
  ]);

  const faturamentoDoMes = new Map(faturamentoMensal.map((m) => [m.mesId, m]));
  const faturadosNoTrimestre = faturamentoMensal.filter(
    (m) => m.situacao === "faturado",
  ).length;
  const descricaoDosMeses =
    dadosDosMeses.length === 1
      ? rotuloMes(dadosDosMeses[0].mes.mes)
      : dadosDosMeses.length > 1
        ? `${rotuloMesCurto(dadosDosMeses[0].mes.mes)} a ${nomeDoMes(
            dadosDosMeses[dadosDosMeses.length - 1].mes.mes,
          )} de ${dadosDosMeses[0].mes.mes.slice(0, 4)}`
        : "";

  // A trilha lateral aparece quando há ação (BV/PP) OU quando há BV
  // lançado para consultar num job sem ação — é a mesma condição que a
  // tabela usa para desenhá-la, e a reserva tem que acompanhar as duas.
  //
  // A exceção do BV para consulta foi escrita para o job ENCERRADO, que
  // é histórico. Na pré-abertura ela não vale: ali o BV ainda é ação
  // futura, o job pode ser devolvido, e a trilha tem que sumir por
  // inteiro — como o critério da Tela 2.1 pede (18/08/2026).
  const temBvLancado = itens.some((it) => bvsPorItem[it.id]);
  // `podeGerarPP` entra na conta desde 08/09/2026: na pré-abertura a
  // calha some para o BV e fica para a PP, então a reserva de 116px
  // precisa acompanhar as duas condições, não só `podeAcoes`.
  const temCalha = podeAcoes || podeGerarPP || (temBvLancado && !preAbertura);

  /** Uma tabela da planilha — a inteira, ou os grupos de um mês no modelo
   *  mensal. A errata é a MESMA em todos os recortes: o rascunho mora nesta
   *  seção, e cada tabela mostra só os grupos que recebe. */
  function tabela(
    gruposRecebidos: GrupoDoJob[],
    rotuloTotal?: string,
    mesFechado = false,
    /** Mês do trecho no mensal: é nele que o grupo novo da errata nasce. */
    mesId: string | null = null,
  ) {
    // Só a tabela esconde as canceladas: as contas (meses, Totais) seguem
    // com a lista inteira — a cancelada é zero dos dois lados.
    const gruposDoTrecho =
      canceladasVisiveis || errata.ativo
        ? gruposRecebidos
        : gruposRecebidos.map((g) => ({ ...g, itens: g.itens.filter((i) => !i.cancelada_em) }));
    // Um card para a planilha inteira — antes era um por grupo. Sem
    // `overflow-hidden`: a calha de ações precisa escapar do frame, e são
    // os filhos que arredondam os cantos.
    const tentativaNoMesEnviado =
      errata.ativo && !modoFinanceiro && mesFechado && mesId !== null;
    const mesDoAviso =
      tentativaNoMesEnviado && tentouNoMes === mesId
        ? meses.find((m) => m.id === mesId)
        : undefined;
    return (
      <>
      {mesDoAviso && (
        <AvisoDoMesEnviado mes={mesDoAviso.mes} onFechar={() => setTentouNoMes(null)} />
      )}
      <div
        className="rounded-2xl border border-border bg-card shadow-soft"
        onClickCapture={
          tentativaNoMesEnviado
            ? (e) => {
                // Recolher um grupo não é tentativa de errata.
                if (!(e.target as HTMLElement).closest("button")) setTentouNoMes(mesId);
              }
            : undefined
        }
      >
        <JobItemRealizadoTable
          jobId={job.id}
          ppsNasLinhas={ppsNasLinhas}
          grupos={gruposDoTrecho}
          rotuloTotal={rotuloTotal}
          realizadosMap={realizadosMap}
          categoriasMap={categoriasMap}
          moeda={versao.moeda}
          moedaEstrangeira={planilha.moedaEstrangeira}
          percentualImposto={versao.percentual_imposto}
          visao={visao}
          estaAberto={recolher.estaAberto}
          onAlternarGrupo={recolher.alternar}
          podeAcoes={podeAcoes}
          podeGerarPP={podeGerarPP}
          papelEnviaPP={papelEnviaPP}
          comiteDaPP={comiteDaPP}
          emDecisaoPP={emDecisaoPP}
          papelCorrigeNf={papelCorrigeNf}
          podeCadastrarFornecedor={podeCadastrarFornecedor}
          podeEditarFornecedor={podeEditarFornecedor}
          podeConfirmarBv={podeConfirmarBv}
          preAbertura={preAbertura}
          linhasComEnvioTravado={linhasComEnvioTravado}
          ppsPorItemId={ppsPorItemId}
          aEmitirPorItemId={aEmitirPorItemId}
          statusDoJob={job.status}
          tomadoresDaNf={tomadoresDaNf}
          tomadorPorEmpresa={tomadorPorEmpresa}
          ppsQuePossoPrestarContas={ppsQuePossoPrestarContas}
          midiaSystem={midiaSystem}
          cnpjPadraoDaPP={cnpjPadraoDaPP}
          fornecedores={fornecedores}
          empresas={empresas}
          responsaveis={responsaveis}
          jobEmpresaId={job.empresa_id ?? ""}
          jobResponsavelId={job.responsavel_id ?? ""}
          bvsPorItem={bvsPorItem}
          versaoLabel={`v${versao.numero_versao}`}
          saveVisivel={temSave}
          onAlternarSave={interno ? undefined : () => setSaveLigado((v) => !v)}
          savePorItem={savePorItem}
          // O pop-up de save abre em toda tela do job — em leitura onde não
          // se edita (decisão 099 §18). A errata ligada fecha a coluna: as
          // duas mexem na mesma linha.
          onAbrirSave={!errata.ativo && !interno && !vendoAntiga ? setLinhaSave : undefined}
          abrirSaveSoComSave={modoDoSave === null}
          destacarItens={destacarItens}
          destaque={vendoAntiga ? "historico" : "save"}
          linhasDaRevisao={linhasDaRevisao}
          seloDaLinha={historico?.antiga?.selo}
          errata={
            (modoFinanceiro ? podeEditarOrcado : podeErrata) && !mesFechado
              ? errata
              : undefined
          }
          modoDaEdicao={modoFinanceiro ? "financeiro" : "errata"}
          mesDoTrecho={mesId}
          podeEditarLinhas={!modoFinanceiro}
          orcadoVisivel={orcadoVisivel}
          rentabPlanejadaVisivel={rentabPlanejada}
          rentabRealizadaVisivel={rentabRealizada}
        />
      </div>
      </>
    );
  }

  function cardDeTotais(
    itensDoTrecho: ItemPlanilhaJob[],
    /** O trecho é o job inteiro? Só aí a foto da abertura vale (decisão
     *  151): o card de um mês do modelo mensal fica com a conta de sempre. */
    jobInteiro: boolean,
    titulo?: string,
    subtitulo?: string,
  ) {
    return (
      <JobTotaisCard
        itens={itensDoTrecho}
        realizadosMap={realizadosMap}
        bvsPorItem={bvsPorItem}
        jobAberto={!preAbertura}
        percentualHonorarios={versao.percentual_honorarios}
        percentualImposto={versao.percentual_imposto}
        moeda={versao.moeda}
        modeloPlanilha={modeloPlanilha}
        internacional={planilha.internacional}
        moedaEstrangeira={planilha.moedaEstrangeira}
        titulo={titulo}
        subtitulo={subtitulo}
        abertura={jobInteiro ? aberturaDoJob : null}
        // A versão antiga fecha só no planejado: o realizado é da atual.
        somentePlanejada={vendoAntiga}
        resultadoInicial={resultadoInicial}
      />
    );
  }

  // Mídia Off (decisão 167, entrega 2): a planilha do job é a de mídia, só
  // leitura. Depois de todos os hooks — o resto do componente não roda para
  // ela. A régua diz a situação do faturamento de cada mês.
  // A linha de parâmetros do job no financeiro (decisão 224): embaixo do
  // rótulo da planilha; na Mídia Off, acima da planilha de mídia.
  const linhaDeParametros = parametrosDoJob ? (
    <ParametrosDoJob
      jobId={job.id}
      jobCodigo={job.codigo}
      jobNome={nomeJob}
      moeda={versao.moeda}
      modelo={modeloPlanilha}
      parametros={parametrosDoJob.parametros}
      edicao={parametrosDoJob.edicao}
      alteracoes={parametrosDoJob.alteracoes}
      itens={itens.map((i) => ({
        tipo_custo: i.tipo_custo,
        total_orcado: Number(i.total_orcado ?? 0),
        em_save: i.em_save,
        save_consumido: Number(i.save_consumido ?? 0),
      }))}
    />
  ) : null;

  if (midia) {
    const enviados = faturamentoMensal.filter((m) => m.envio !== null).length;
    const comFaturamento = faturamentoMensal.filter((m) => m.faturamento > 0.004).length;
    return (
      <div className="flex flex-col gap-4">
      {linhaDeParametros}
      <PlanilhaMidiaDoJob
        job={job}
        nomeJob={nomeJob}
        versao={versao}
        meses={meses}
        grupos={grupos}
        midia={midia}
        mesPedido={mesPedido}
        hrefPlanilha={hrefPlanilha ?? `/jobs/${job.id}?aba=planilha`}
        noLugar={mesNoLugar}
        linkDaVersao={
          confirmarSaidaParaOrcamento ? (
            <LinkSaidaDeModulo
              href={`/orcamentos/${job.projeto_id}/${job.orcamento_id}/versoes/${versao.id}`}
              modulo="Orçamentos"
              descricao="A versão aprovada mora no módulo de Orçamentos — não existe cópia dela no financeiro. Você sai desta tela para abri-la."
              className="text-xs text-california-red hover:underline"
            >
              Ver versão aprovada
            </LinkSaidaDeModulo>
          ) : (
            <Link
              href={`/orcamentos/${job.projeto_id}/${job.orcamento_id}/versoes/${versao.id}`}
              prefetch={false}
              className="text-xs text-california-red hover:underline"
            >
              Ver versão aprovada →
            </Link>
          )
        }
        detalheDoMes={Object.fromEntries(
          faturamentoMensal.map((m) => [
            m.mes.slice(0, 7),
            m.situacao === "em_veiculacao" && m.ultimaVeiculacao
              ? `Em veiculação até ${dataBr(m.ultimaVeiculacao).slice(0, 5)}`
              : ROTULO_DA_SITUACAO[m.situacao],
          ]),
        )}
        detalheCampanha={
          job.status === "aguardando_abertura" || job.status === "rejeitado_financeiro"
            ? "Job aguardando abertura"
            : enviados === 0
              ? "Nenhum mês enviado"
              : `${enviados} de ${comFaturamento} ${comFaturamento === 1 ? "mês enviado" : "meses enviados"}`
        }
      />
      </div>
    );
  }

  return (
    // Quando dá pra gerar PP, reserva a calha da direita: a trilha de
    // "Adicionar BV" / "Abrir BV" / "Gerar PP" / "Ver PP" é posicionada
    // fora do card, e sem esse espaço ela era cortada na borda da página.
    //
    // 116px e não 126: a trilha tem 116px de botão ("Adicionar BV" é o
    // rótulo mais longo) + 10px de respiro, e esses 10px podem invadir o
    // padding do layout (32px) sem encostar na borda. Devolver os 10px ao
    // card é o que faz a tabela caber inteira — as bordas de 2px entre os
    // blocos somam ~5px que as porcentagens das colunas não preveem.
    // Os 12px a mais que a calha antiga foram devolvidos à página (o
    // max-w de JobDetalhe cresceu junto): a planilha não encolheu.
    <div className={cn("space-y-4", temCalha && "pr-[116px]")}>
      {historico?.antiga?.faixa}

      {preAbertura && !vendoAntiga && (
        <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
          <Clock className="mt-0.5 h-3.5 w-3.5 flex-none" />
          <span>
            {job.status === "aguardando_abertura"
              ? "Job aguardando abertura pelo financeiro — erratas e BVs ficam disponíveis após a abertura."
              : "Job devolvido pelo financeiro — erratas e BVs ficam disponíveis após a abertura."}{" "}
            Por enquanto, só <strong>PPs a emitir</strong>: gerar e enviar a PP
            voltam com a abertura.
          </span>
        </div>
      )}

      {/* A errata pronta para envio (decisão 159): some enquanto a errata
          está aberta — quem fala no rodapé é a barra dela. */}
      {errataPronta && errataLiberada && !errata.ativo && (
        <ErrataProntaFaixa
          pronta={errataPronta}
          modo={prepara ? "prepara" : "registra"}
          moeda={versao.moeda}
          travadoPor={motivoErrataTravada}
          onAbrir={abrirErrata}
          onDescartar={() => {
            setErroDescarte(null);
            setDescartandoPronta(true);
          }}
        />
      )}

      {/* A barra em duas linhas (decisão 186, pedido do Tiago no protótipo
          de 14/10/2026): o rótulo em cima; embaixo, o "Recolher todos" no
          canto esquerdo e o "Histórico" ao lado do Bruto/Líquido. Some na
          errata e na edição do financeiro: quem edita está na atual. */}
      <div className="space-y-2.5">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ClipboardList className="h-4 w-4 text-california-red" />
          <span>
            Planilha do job · {nomeVersao(nomeJob, versao.numero_versao)}
          </span>
        </div>
        {linhaDeParametros}
        <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {grupos.length > 0 && (
            <BotaoRecolherTodos
              algumAberto={recolher.algumAberto}
              onAlternarTodos={recolher.alternarTodos}
            />
          )}
        </div>
        <div className="flex items-center gap-3">
          {historico && !errata.ativo && historico.botao}
          <ChaveBrutoLiquido visao={visao} onChange={setVisao} />
          <MenuExibirColunas
            titulo="Colunas"
            blocos={[
              {
                chave: "save",
                rotulo: "Save",
                visivel: saveLigado,
                onAlternar: () => setSaveLigado((v) => !v),
              },
              // A errata edita o Orçado: enquanto ela está ligada o bloco
              // não pode sair da tela, e o item explica por quê.
              {
                chave: "orcado",
                rotulo: "Orçado",
                visivel: orcadoVisivel,
                onAlternar: errata.ativo
                  ? undefined
                  : () => setOrcadoVisivel((v) => !v),
                dica: errata.ativo
                  ? modoFinanceiro
                    ? "Na edição do orçado o bloco fica sempre aberto."
                    : "Na errata o Orçado fica sempre aberto."
                  : undefined,
              },
              {
                chave: "planejado",
                rotulo: "Planejado",
                visivel: true,
                dica: "O Planejado é sempre exibido.",
              },
              {
                chave: "realizado",
                rotulo: "Realizado",
                visivel: true,
                dica: "O Realizado é sempre exibido — é por ele que se acompanham as PPs.",
              },
            ]}
            secoes={[
              ...(temCancelada
                ? [
                    {
                      titulo: "Linhas",
                      itens: [
                        {
                          chave: "canceladas",
                          rotulo: "Linhas canceladas",
                          visivel: canceladasVisiveis || errata.ativo,
                          onAlternar: errata.ativo
                            ? undefined
                            : () => setCanceladasVisiveis((v) => !v),
                          dica: errata.ativo
                            ? "Na errata as linhas canceladas ficam à vista."
                            : undefined,
                        },
                      ],
                      dica: "A linha cancelada por errata fica zerada no orçado e no planejado.",
                    },
                  ]
                : []),
              // Decisão 208: as PPs embaixo de cada linha, como na planilha
              // exportada. Na errata a linha está sendo reescrita: fechadas.
              ...(temPP
                ? [
                    {
                      titulo: "PPs",
                      itens: [
                        {
                          chave: "pps_nas_linhas",
                          rotulo: "PPs abertas em todas as linhas",
                          visivel: ppsNasLinhas && !errata.ativo,
                          onAlternar: errata.ativo
                            ? undefined
                            : () => setPpsNasLinhas((v) => !v),
                          dica: errata.ativo
                            ? "Na errata as PPs ficam fechadas."
                            : undefined,
                        },
                      ],
                      dica: "Cada PP numa linha abaixo do item, como na planilha exportada. A seta ao lado do nome abre um item só.",
                    },
                  ]
                : []),
              {
                titulo: "Rentabilidade",
                itens: [
                  {
                    chave: "rentab_planejada",
                    rotulo: "Rentabilidade planejada",
                    visivel: rentabPlanejada,
                    onAlternar: () => setRentabPlanejada((v) => !v),
                  },
                  {
                    chave: "rentab_realizada",
                    rotulo: "Rentabilidade realizada",
                    visivel: rentabRealizada,
                    onAlternar: () => setRentabRealizada((v) => !v),
                  },
                ],
                dica: "Cada uma entra logo depois do bloco que a gera.",
              },
            ]}
          />
          {podeExportarInterna && (
            <ExportarInternaButton
              jobId={job.id}
              codigo={job.codigo}
              nome={job.nome}
              qtdGrupos={grupos.length}
              qtdItens={itens.length}
            />
          )}
          {/* Só no job aberto antes da aprovação de save existir: as linhas
              que nunca foram ao financeiro saem daqui (decisão 099). */}
          {modoDoSave === "pedido" &&
            linhasNaoEnviadas.length > 0 &&
            !errata.ativo && (
              <button
                type="button"
                onClick={() => setEnviandoLegado(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-california-red/30 hover:bg-california-red/[0.06]"
              >
                <Send className="h-3.5 w-3.5 text-california-red" />
                Enviar {linhasNaoEnviadas.length}{" "}
                {linhasNaoEnviadas.length === 1 ? "save" : "saves"} para aprovação
              </button>
            )}
          {errataLiberada && (
            <AlterarOrcadoButton
              ativo={errata.ativo}
              travadoPor={motivoErrataTravada}
              rotuloDaPronta={
                errataPronta
                  ? prepara
                    ? "Editar errata pronta"
                    : "Revisar errata pronta"
                  : null
              }
              onAlternar={() => {
                if (errata.ativo) {
                  fecharErrata();
                  return;
                }
                abrirErrata();
              }}
            />
          )}
          {/* O "Editar orçado" do financeiro (decisão 115), no mesmo lugar
              em que a produção tem o "Realizar errata". */}
          {modoFinanceiro && (
            <EditarOrcadoButton
              ativo={errata.ativo}
              travadoPor={motivoEdicaoTravada}
              onAlternar={() => {
                if (errata.ativo) {
                  errata.descartar();
                  return;
                }
                setOrcadoVisivel(true);
                errata.ligar();
              }}
            />
          )}
          {/* Segue a GERAÇÃO, e não a errata: "todas as PPs deste item já
              foram geradas" é afirmação sobre gerar, e o formulário de PP
              já faz a mesma pergunta na pré-abertura (decisão 056). */}
          {podeGerarPP && (
            <ConcluirPPsButton
              jobId={job.id}
              itensEmAberto={itensEmAberto}
            />
          )}
          {confirmarSaidaParaOrcamento ? (
            <LinkSaidaDeModulo
              href={`/orcamentos/${job.projeto_id}/${job.orcamento_id}/versoes/${versao.id}`}
              modulo="Orçamentos"
              descricao="A versão aprovada mora no módulo de Orçamentos — não existe cópia dela no financeiro. Você sai desta tela para abri-la."
              className="text-xs text-california-red hover:underline"
            >
              Ver versão aprovada
            </LinkSaidaDeModulo>
          ) : (
            <Link
              href={`/orcamentos/${job.projeto_id}/${job.orcamento_id}/versoes/${versao.id}`}
              prefetch={false}
              className="text-xs text-california-red hover:underline"
            >
              Ver versão aprovada →
            </Link>
          )}
        </div>
        </div>
      </div>

      {grupos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-12 text-center">
          <p className="text-sm text-muted-foreground">
            A versão aprovada não tem grupos.
          </p>
        </div>
      ) : mensal ? (
        <>
          <ReguaMeses
            titulo="Meses do job"
            moeda={versao.moeda}
            descricao={descricaoDosMeses}
            trimestre={{
              chave: "trimestre",
              // "Total" desde 27/10/2026; a chave na URL continua `trimestre`.
              rotulo: "Total",
              faturamento: dadosDosMeses.reduce((s, d) => s + d.faturamento, 0),
              resultadoGeral: null,
              detalhe:
                faturadosNoTrimestre === 0
                  ? "Nenhum mês faturado"
                  : `${faturadosNoTrimestre} de ${dadosDosMeses.length} ${
                      dadosDosMeses.length === 1 ? "mês faturado" : "meses faturados"
                    }`,
              href: `${hrefPlanilha}&mes=trimestre`,
            }}
            meses={dadosDosMeses.map((d) => ({
              chave: d.mes.id,
              rotulo: rotuloMesCurto(d.mes.mes),
              faturamento: d.faturamento,
              resultadoGeral: d.resultadoGeral,
              detalhe:
                ROTULO_DA_SITUACAO[
                  faturamentoDoMes.get(d.mes.id)?.situacao ?? "a_enviar"
                ],
              href: `${hrefPlanilha}&mes=${d.chave}`,
            }))}
            selecionado={mesSelecionado?.mes.id ?? "trimestre"}
            editar={null}
            acao={
              // Decisão 219: o mês que falta no trimestre, só na errata.
              errata.ativo && !modoFinanceiro && faltamNaErrata.length > 0 && mesesSalvos.length > 0 ? (
                <MesesQueFaltam
                  faltam={faltamNaErrata}
                  fonte={mesesSalvos[mesesSalvos.length - 1].mes}
                  onAdicionar={adicionarMes}
                />
              ) : undefined
            }
            onSelecionar={
              mesNoLugar
                ? (chave) =>
                    setMesNoPopUp(
                      dadosDosMeses.find((d) => d.mes.id === chave)?.chave ?? "trimestre",
                    )
                : undefined
            }
          />
          {mesSelecionado ? (
            <>
              {tabela(
                mesSelecionado.grupos,
                `Total de ${nomeDoMes(mesSelecionado.mes.mes)}`,
                mesTravado(mesSelecionado.mes.id),
                mesSelecionado.mes.id,
              )}
              <DicasDeTeclado editavel={errata.ativo} moverLinha={errata.ativo && !modoFinanceiro} />
              {cardDeTotais(
                mesSelecionado.itens,
                false,
                `Totais de ${nomeDoMes(mesSelecionado.mes.mes)}`,
                "Orçado × Planejado × Realizado · valores calculados a partir dos itens do mês.",
              )}
            </>
          ) : (
            <>
              <TrimestreEmpilhado
                moeda={versao.moeda}
                onAbrir={
                  mesNoLugar
                    ? (id) =>
                        setMesNoPopUp(
                          dadosDosMeses.find((d) => d.mes.id === id)?.chave ?? "trimestre",
                        )
                    : undefined
                }
                meses={dadosDosMeses.map((d) => ({
                  id: d.mes.id,
                  titulo: rotuloMes(d.mes.mes),
                  nome: nomeDoMes(d.mes.mes),
                  resumo: `${d.grupos.length} ${
                    d.grupos.length === 1 ? "grupo" : "grupos"
                  } · ${d.itens.length} ${d.itens.length === 1 ? "item" : "itens"}`,
                  faturamento: d.faturamento,
                  custoPlanejado: d.custoPlanejado,
                  resultadoOperacional: d.resultadoOperacional,
                  resultadoGeral: d.resultadoGeral,
                  href: `${hrefPlanilha}&mes=${d.chave}`,
                  conteudo: tabela(
                    d.grupos,
                    `Total de ${nomeDoMes(d.mes.mes)}`,
                    mesTravado(d.mes.id),
                    d.mes.id,
                  ),
                }))}
              />
              <DicasDeTeclado editavel={errata.ativo} moverLinha={errata.ativo && !modoFinanceiro} />
              {cardDeTotais(
                dadosDosMeses.flatMap((d) => d.itens),
                true,
                "Totais do trimestre",
                "Orçado × Planejado × Realizado · soma dos meses.",
              )}
            </>
          )}
        </>
      ) : (
        <>
          {tabela(gruposDaPlanilha)}
          {/* Fora do card, como na planilha do orçamento. Fora da errata a
              planilha é só leitura: só as setas. */}
          <DicasDeTeclado editavel={errata.ativo} moverLinha={errata.ativo && !modoFinanceiro} />
          {cardDeTotais(errata.itens, true)}
        </>
      )}
      <SaveDialog
        contexto="job"
        job={{ status: job.status, acoes: acoesDoSave }}
        open={linhaSave !== null}
        onOpenChange={(aberto) => !aberto && setLinhaSave(null)}
        linha={linhaDoDialog}
        estado={
          linhaSave ? (savePorItem[linhaSave.id] ?? SAVE_VAZIO) : SAVE_VAZIO
        }
        saldos={saldosDeSave}
        moeda={versao.moeda}
        percentualHonorarios={versao.percentual_honorarios}
        percentualImposto={versao.percentual_imposto}
        internacional={planilha.internacional}
        clienteNome={clienteNome}
      />

      <ConfirmDialog
        open={saidaDaErrata !== null}
        onOpenChange={(aberto) => !aberto && setSaidaDaErrata(null)}
        title={
          modoFinanceiro
            ? "Sair sem gravar a alteração?"
            : prepara
              ? "Sair sem salvar a errata?"
              : "Sair sem registrar a errata?"
        }
        description={
          modoFinanceiro
            ? "A edição do orçado ainda não foi confirmada e será descartada."
            : prepara
              ? "As alterações da errata ainda não foram salvas e serão descartadas."
              : "As alterações da errata ainda não foram registradas e serão descartadas."
        }
        confirmLabel="Sair e descartar"
        cancelLabel={modoFinanceiro ? "Continuar editando" : "Continuar na errata"}
        variant="destructive"
        onConfirm={() => {
          const destino = saidaDaErrata;
          setSaidaDaErrata(null);
          fecharErrata();
          if (destino) router.push(destino);
        }}
      />

      <EnviarSavesDialog
        open={enviandoLegado}
        onOpenChange={setEnviandoLegado}
        jobId={job.id}
        jobCodigo={job.codigo}
        linhas={linhasNaoEnviadas}
        moeda={versao.moeda}
        onEnviado={() => router.refresh()}
      />

      {errata.ativo && modoFinanceiro && (
        <EdicaoFinanceiroBarra
          resumo={resumoDoFinanceiro}
          temMudanca={linhasDoFinanceiro.length > 0}
          faturamento={{
            antes: totaisAntes.faturamentoPrevisto,
            depois: totaisDepois.faturamentoPrevisto,
          }}
          valorJob={{
            antes: totaisAntes.valorJob,
            depois: totaisDepois.valorJob,
          }}
          moeda={versao.moeda}
          onDescartar={errata.descartar}
          onDesfazer={errata.desfazer}
          podeDesfazer={errata.podeDesfazer}
          onConfirmar={() => {
            setErroErrata(null);
            setConfirmando(true);
          }}
          naAbertura={job.status === "aguardando_abertura"}
        />
      )}

      {errata.ativo && !modoFinanceiro && (
        <ErrataBarra
          resumo={errata.resumo}
          soOrganizacao={errata.mudancas.length === 0 && errata.estrutura.length > 0}
          temMudanca={errata.temMudanca}
          faturamento={{
            antes: totaisAntes.faturamentoPrevisto,
            depois: totaisDepois.faturamentoPrevisto,
          }}
          valorJob={{
            antes: totaisAntes.valorJob,
            depois: totaisDepois.valorJob,
          }}
          moeda={versao.moeda}
          onDescartar={fecharErrata}
          onDesfazer={errata.desfazer}
          podeDesfazer={errata.podeDesfazer}
          onConfirmar={() => {
            setErroErrata(null);
            setConfirmando(true);
          }}
          modo={prepara ? "prepara" : "registra"}
          pronta={
            prontaAberta
              ? {
                  autorNome: prontaAberta.preparadaPorNome,
                  quando: quandoDaPronta(prontaAberta.preparadaEm),
                }
              : null
          }
        />
      )}

      <ConfirmDialog
        open={descartandoPronta}
        onOpenChange={(aberto) => {
          if (!descartePendente) setDescartandoPronta(aberto);
        }}
        title="Descartar a errata pronta?"
        description={
          <>
            <p>
              {errataPronta && !prepara
                ? `A errata preparada por ${errataPronta.preparadaPorNome} sai do job sem ir ao financeiro.`
                : "A errata pronta para envio sai do job. Nada foi enviado ao financeiro."}
            </p>
            {erroDescarte && (
              <p role="alert" className="mt-2 text-california-red">
                {erroDescarte}
              </p>
            )}
          </>
        }
        confirmLabel="Descartar errata"
        cancelLabel="Voltar"
        variant="destructive"
        pending={descartePendente}
        onConfirm={confirmarDescarteDaPronta}
      />

      <EdicaoFinanceiroConfirmarDialog
        open={confirmando && modoFinanceiro}
        onOpenChange={(aberto) => {
          if (!salvando) setConfirmando(aberto);
        }}
        jobCodigo={job.codigo}
        jobNome={nomeJob}
        resumo={resumoDoFinanceiro}
        mudancas={linhasDoFinanceiro}
        orcado={{
          antes: totaisAntes.subtotalGeral,
          depois: totaisDepois.subtotalGeral,
        }}
        faturamento={{
          antes: totaisAntes.faturamentoPrevisto,
          depois: totaisDepois.faturamentoPrevisto,
        }}
        valorJob={{
          antes: totaisAntes.valorJob,
          depois: totaisDepois.valorJob,
        }}
        moeda={versao.moeda}
        envio={acompanhamDoFinanceiro.envio}
        recebimento={acompanhamDoFinanceiro.recebimento}
        planejadoAcompanha={interno}
        naAbertura={job.status === "aguardando_abertura"}
        salvando={salvando}
        erro={erroErrata}
        onConfirmar={confirmarEdicaoDoFinanceiro}
      />

      <ErrataConfirmarDialog
        open={confirmando && !modoFinanceiro}
        onOpenChange={(aberto) => {
          if (!salvando) setConfirmando(aberto);
        }}
        jobCodigo={job.codigo}
        jobNome={job.nome}
        resumo={errata.resumo}
        mudancas={errata.mudancas}
        estrutura={errata.estrutura}
        mesesNovos={mesesNovos.map((mes) => {
          const chave = chaveDoMesNovo(mes);
          const doMes = new Set(errata.grupos.filter((g) => g.mes_id === chave).map((g) => g.id));
          return { mes, itens: errata.itens.filter((i) => doMes.has(i.grupo_id)).length };
        })}
        orcado={{
          antes: totaisAntes.subtotalGeral,
          depois: totaisDepois.subtotalGeral,
        }}
        faturamento={{
          antes: totaisAntes.faturamentoPrevisto,
          depois: totaisDepois.faturamentoPrevisto,
        }}
        valorJob={{
          antes: totaisAntes.valorJob,
          depois: totaisDepois.valorJob,
        }}
        moeda={versao.moeda}
        faltaNomear={errata.faltaNomear}
        salvando={salvando}
        erro={erroErrata}
        onConfirmar={confirmarErrata}
        modo={prepara ? "prepara" : "registra"}
        pronta={
          prontaAberta
            ? {
                autorNome: prontaAberta.preparadaPorNome,
                quando: quandoDaPronta(prontaAberta.preparadaEm),
                descricao: prontaAberta.descricao,
              }
            : null
        }
      />
    </div>
  );
}

/** "Enviar N saves para aprovação?" — o job aberto antes da aprovação de
 *  save existir manda ao financeiro as linhas que nunca foram (decisão 099,
 *  `momento = 'legado_botao'`). Do protótipo aprovado, com o texto da spec. */
function EnviarSavesDialog({
  open,
  onOpenChange,
  jobId,
  jobCodigo,
  linhas,
  moeda,
  onEnviado,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  jobCodigo: string;
  linhas: {
    id: string;
    item: string;
    grupo: string;
    tipo: "gera" | "consome";
    /** Código do job de origem do consumo; vazio na linha que gera. */
    codigo: string;
    valor: number;
  }[];
  moeda: string;
  onEnviado: () => void;
}) {
  const [enviando, setEnviando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) setErro(null);
  }, [open]);

  async function enviar() {
    setEnviando(true);
    setErro(null);
    const r = await enviarSavesParaAprovacao(jobId);
    setEnviando(false);
    if (!r.ok) {
      setErro(r.message);
      return;
    }
    onOpenChange(false);
    onEnviado();
  }

  const n = linhas.length;
  return (
    <Dialog
      open={open}
      onOpenChange={(aberto) => {
        if (!enviando) onOpenChange(aberto);
      }}
    >
      <DialogContent className="max-w-[500px]">
        <DialogHeader>
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-california-red/10 text-california-red">
            <Send className="h-[21px] w-[21px]" />
          </div>
          <DialogTitle className="pt-4 text-xl leading-snug">
            Enviar {n} {n === 1 ? "save" : "saves"} para aprovação?
          </DialogTitle>
          <DialogDescription className="pt-1 leading-relaxed">
            O {jobCodigo} foi aberto antes de existir a aprovação de save, e
            estas linhas nunca foram enviadas ao financeiro. Os números do job
            já contam estas linhas como save; o crédito só fica disponível
            depois da aprovação.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 rounded-xl border border-border px-4 py-3.5">
          {linhas.map((l) => (
            <div key={l.id} className="flex items-baseline justify-between gap-3">
              <span className="inline-flex items-center gap-2 text-[13px] text-muted-foreground">
                {l.tipo === "gera" ? (
                  <span className={SAVE.botaoGera}>
                    <ArrowUpRight className="h-[11px] w-[11px]" />
                  </span>
                ) : (
                  <span className={SAVE.botaoCodigo}>
                    <ArrowDownLeft
                      className={cn("h-[9px] w-[9px] flex-none", SAVE.icone)}
                    />
                    {l.codigo}
                  </span>
                )}
                {l.grupo} · {l.item}
              </span>
              <span className="font-mono text-[13px] font-semibold">
                {formatCurrency(l.valor, moeda)}
              </span>
            </div>
          ))}
        </div>
        {erro && (
          <p className="rounded-lg border border-california-red/30 bg-california-red/5 px-3 py-2 text-xs text-california-red">
            {erro}
          </p>
        )}
        <div className="flex items-center justify-end gap-2.5">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={enviando}
          >
            Cancelar
          </Button>
          <Button type="button" onClick={() => void enviar()} disabled={enviando}>
            <Check className="h-4 w-4" />
            {enviando ? "Enviando…" : "Sim, enviar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
