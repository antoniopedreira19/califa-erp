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

import * as React from "react";
import Link from "next/link";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  Clock,
  ClipboardList,
  Lock,
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
import { useRascunhoErrata } from "./errata-rascunho";
import { ErrataBarra } from "./errata-barra";
import { ErrataConfirmarDialog } from "./errata-confirmar-dialog";
import { registrarErrata } from "./actions-errata";
import {
  calcularResultadoOperacional,
  calcularTotaisVersao,
} from "@/lib/calculos/versao-totais";
import { configDaPlanilha } from "@/app/(app)/_planilha/modelo-planilha";
import { jobAceitaAcoesPlanilha } from "@/lib/types";
import { definirModoErrata } from "../modo-errata";
import {
  nomeDoMes,
  rotuloMes,
  rotuloMesCurto,
} from "@/lib/calculos/meses-trimestre";
import { ReguaMeses } from "@/app/(app)/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/regua-meses";
import { TrimestreEmpilhado } from "@/app/(app)/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/trimestre-empilhado";
import type {
  MesDeFaturamento,
  SituacaoDoMes,
} from "@/lib/calculos/faturamento-por-mes";

const SEM_FATURAMENTO_MENSAL: MesDeFaturamento[] = [];

/** O texto da situação do mês na régua — o mesmo da barra do rodapé. */
const ROTULO_DA_SITUACAO: Record<SituacaoDoMes, string> = {
  a_enviar: "A enviar",
  na_fila: "Na fila do financeiro",
  faturado_parcial: "Faturado parcial",
  faturado: "Faturado",
  sem_faturamento: "Sem faturamento",
};

function listaDeMeses(nomes: string[]): string {
  if (nomes.length <= 1) return nomes.join("");
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

/** Referência estável para o default: um `[]` novo a cada render mudaria
 *  as dependências dos `useMemo` abaixo. */
const SEM_MESES: VersaoOrcamentoMes[] = [];

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
  /** Errata devolveu o job ao mural do financeiro: nenhuma PP sai para o
   *  financeiro até a revisão da abertura ser salva (decisão 040). Gerar,
   *  editar e cancelar seguem liberados. */
  aberturaEmRevisao?: boolean;
  /** Todas as PPs ativas de cada item realizado (PPs parciais). */
  ppsPorItemId: Map<string, PedidoCompraNaLista[]>;
  fornecedores: Array<Pick<Fornecedor, "id" | "nome" | "razao_social" | "status" | "cpf_cnpj">>;
  empresas: Array<Pick<Empresa, "id" | "razao_social" | "nome_fantasia" | "ativo" | "principal">>;
  /** Membros ativos do tenant — usados no combo de Responsável da Verba de Produção. */
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
  /** Exportar a planilha interna do job (decisão 088). Quem vê a tela
   *  exporta; o freelancer, que só tem a visão restrita, não. */
  podeExportarInterna?: boolean;
  /** Job de serviço Interno (decisão 105): a errata trava tipo e
   *  planejado, e o save não existe — nem coluna, nem pedido. Obrigatória:
   *  prop opcional esconde a fronteira em que o campo some. */
  interno: boolean;
}

export function JobRealizadoSection({
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
  podeCadastrarFornecedor = false,
  podeEditarFornecedor = false,
  podeConfirmarBv,
  jaEnviadoParaFaturamento = false,
  aberturaEmRevisao = false,
  ppsPorItemId,
  fornecedores,
  empresas,
  responsaveis,
  bvsPorItem,
  savePorItem,
  saldosDeSave,
  clienteNome,
  destacarItens,
  modeloPlanilha,
  meses = SEM_MESES,
  mesPedido,
  hrefPlanilha,
  faturamentoMensal = SEM_FATURAMENTO_MENSAL,
  interno,
}: Props) {
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
  const errata = useRascunhoErrata(itens, interno);
  // A barra de ações do job é irmã das abas e precisa sair de cena
  // enquanto a barra da errata está no ar — as duas grudam no mesmo pé de
  // janela. Nas telas que não têm barra de ações (financeiro, conferência
  // de abertura) ninguém escuta, e o sinal se perde sem efeito.
  React.useEffect(() => {
    definirModoErrata(errata.ativo);
    return () => definirModoErrata(false);
  }, [errata.ativo]);

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

  async function confirmarErrata(descricao: string) {
    setSalvando(true);
    setErroErrata(null);
    const r = await registrarErrata(job.id, errata.payload(descricao));
    setSalvando(false);
    if (!r.ok) {
      setErroErrata(r.message);
      return;
    }
    setConfirmando(false);
    errata.descartar();
    router.refresh();
  }

  // Recolher agrupamento, igual à planilha do orçamento: o subtotal e a
  // rentabilidade continuam à vista, que é o que justifica recolher.
  const gruposIds = React.useMemo(() => grupos.map((g) => g.id), [grupos]);
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
  // A errata exige job aberto, a porta de `AlterarOrcadoButton`, e fecha
  // com o envio para faturamento. O financeiro chega aqui com `podeAcoes`
  // falso e lê sem editar.
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
  const todosOsMesesEnviados =
    faturamentoMensal.length > 0 && mesesEnviados.size === faturamentoMensal.length;
  const podeErrata = podeAcoes && !jaEnviadoParaFaturamento && !todosOsMesesEnviados;

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
  const preAbertura =
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
    const porGrupo = new Map<string, ItemPlanilhaJob[]>();
    for (const g of grupos) porGrupo.set(g.id, []);
    for (const it of errata.itens) porGrupo.get(it.grupo_id)?.push(it);
    return grupos.map((g) => ({
      id: g.id,
      nome: g.nome,
      itens: porGrupo.get(g.id) ?? [],
    }));
  }, [grupos, errata.itens]);

  // MODELO MENSAL (decisão 078): a planilha do job se reparte nos meses da
  // versão aprovada. O mês mora no GRUPO da versão, e o item do job aponta
  // para ele — nada de mês foi copiado para o job. As contas saem do
  // rascunho da errata, como o resto da tela, para a régua acompanhar o que
  // se digita.
  const mensal =
    modeloPlanilha === "mensal" && meses.length > 0 && hrefPlanilha !== undefined;
  const dadosDosMeses = React.useMemo(() => {
    if (!mensal) return [];
    const mesDoGrupo = new Map(grupos.map((g) => [g.id, g.mes_id]));
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
  }, [mensal, meses, grupos, gruposDaPlanilha, paraTotais]);
  // Sem `?mes=`, abre no primeiro mês — como a planilha do orçamento.
  const mesSelecionado =
    !mensal || mesPedido === "trimestre"
      ? null
      : (dadosDosMeses.find((d) => d.chave === mesPedido) ??
        dadosDosMeses[0] ??
        null);
  const faturamentoDoMes = new Map(faturamentoMensal.map((m) => [m.mesId, m]));
  const faturadosNoTrimestre = faturamentoMensal.filter(
    (m) => m.situacao === "faturado",
  ).length;
  // "Julho e agosto já foram enviados para faturamento: errata e save ficam
  // travados nesses meses. Setembro continua editável." (design aprovado).
  // Desde a decisão 099 (§14) gerar save segue valendo no mês enviado, até
  // o encerramento: o que trava é a errata e o CONSUMO de save.
  const avisoDosMesesEnviados = (() => {
    if (!mensal || mesesEnviados.size === 0) return null;
    const enviados = dadosDosMeses.filter((d) => mesesEnviados.has(d.mes.id));
    const livres = dadosDosMeses.filter((d) => !mesesEnviados.has(d.mes.id));
    const nomesEnviados = listaDeMeses(enviados.map((d) => nomeDoMes(d.mes.mes)));
    const inicio = nomesEnviados.charAt(0).toUpperCase() + nomesEnviados.slice(1);
    const parte1 =
      enviados.length === 1
        ? `${inicio} já foi enviado para faturamento: errata e consumo de save ficam travados nesse mês.`
        : `${inicio} já foram enviados para faturamento: errata e consumo de save ficam travados nesses meses.`;
    if (livres.length === 0) return parte1;
    const nomesLivres = listaDeMeses(livres.map((d) => nomeDoMes(d.mes.mes)));
    const livresInicio = nomesLivres.charAt(0).toUpperCase() + nomesLivres.slice(1);
    return `${parte1} ${livresInicio} ${livres.length === 1 ? "continua editável" : "continuam editáveis"}.`;
  })();
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
    gruposDoTrecho: GrupoDoJob[],
    rotuloTotal?: string,
    mesEnviado = false,
  ) {
    // Um card para a planilha inteira — antes era um por grupo. Sem
    // `overflow-hidden`: a calha de ações precisa escapar do frame, e são
    // os filhos que arredondam os cantos.
    return (
      <div className="rounded-2xl border border-border bg-card shadow-soft">
        <JobItemRealizadoTable
          jobId={job.id}
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
          podeCadastrarFornecedor={podeCadastrarFornecedor}
          podeEditarFornecedor={podeEditarFornecedor}
          podeConfirmarBv={podeConfirmarBv}
          preAbertura={preAbertura}
          aberturaEmRevisao={aberturaEmRevisao}
          ppsPorItemId={ppsPorItemId}
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
          onAbrirSave={!errata.ativo && !interno ? setLinhaSave : undefined}
          abrirSaveSoComSave={modoDoSave === null}
          destacarItens={destacarItens}
          errata={podeErrata && !mesEnviado ? errata : undefined}
          orcadoVisivel={orcadoVisivel}
          rentabPlanejadaVisivel={rentabPlanejada}
          rentabRealizadaVisivel={rentabRealizada}
        />
      </div>
    );
  }

  function cardDeTotais(
    itensDoTrecho: ItemPlanilhaJob[],
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
      />
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
      {preAbertura && (
        <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
          <Clock className="mt-0.5 h-3.5 w-3.5 flex-none" />
          <span>
            {job.status === "aguardando_abertura"
              ? "Job aguardando abertura pelo financeiro — erratas e BVs ficam disponíveis após a abertura."
              : "Job devolvido pelo financeiro — erratas e BVs ficam disponíveis após a abertura."}{" "}
            Pedidos de produção já podem ser <strong>gerados</strong>; o envio
            ao financeiro é que espera a abertura, e o realizado só conta PP
            enviada.
          </span>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ClipboardList className="h-4 w-4 text-california-red" />
          <span>
            Planilha do job · {nomeVersao(nomeJob, versao.numero_versao)}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {grupos.length > 0 && (
            <BotaoRecolherTodos
              algumAberto={recolher.algumAberto}
              onAlternarTodos={recolher.alternarTodos}
            />
          )}
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
                  ? "Na errata o Orçado fica sempre aberto."
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
          {podeAcoes && (
            <AlterarOrcadoButton
              ativo={errata.ativo}
              travadoPor={motivoErrataTravada}
              onAlternar={() => {
                if (errata.ativo) {
                  errata.descartar();
                  return;
                }
                // A errata é edição do Orçado: o bloco volta à tela
                // junto com ela, esteja escondido ou não.
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
          <Link
            href={`/orcamentos/${job.projeto_id}/${job.orcamento_id}/versoes/${versao.id}`}
            prefetch={false}
            className="text-xs text-california-red hover:underline"
          >
            Ver versão aprovada →
          </Link>
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
              rotulo: "Trimestre",
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
          />
          {avisoDosMesesEnviados && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
              <Lock className="mt-0.5 h-3.5 w-3.5 flex-none" />
              <span>{avisoDosMesesEnviados}</span>
            </div>
          )}
          {mesSelecionado ? (
            <>
              {tabela(
                mesSelecionado.grupos,
                `Total de ${nomeDoMes(mesSelecionado.mes.mes)}`,
                mesesEnviados.has(mesSelecionado.mes.id),
              )}
              <DicasDeTeclado editavel={errata.ativo} />
              {cardDeTotais(
                mesSelecionado.itens,
                `Totais de ${nomeDoMes(mesSelecionado.mes.mes)}`,
                "Orçado × Planejado × Realizado · valores calculados a partir dos itens do mês.",
              )}
            </>
          ) : (
            <>
              <TrimestreEmpilhado
                moeda={versao.moeda}
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
                    mesesEnviados.has(d.mes.id),
                  ),
                }))}
              />
              <DicasDeTeclado editavel={errata.ativo} />
              {cardDeTotais(
                dadosDosMeses.flatMap((d) => d.itens),
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
          <DicasDeTeclado editavel={errata.ativo} />
          {cardDeTotais(errata.itens)}
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

      <EnviarSavesDialog
        open={enviandoLegado}
        onOpenChange={setEnviandoLegado}
        jobId={job.id}
        jobCodigo={job.codigo}
        linhas={linhasNaoEnviadas}
        moeda={versao.moeda}
        onEnviado={() => router.refresh()}
      />

      {errata.ativo && (
        <ErrataBarra
          resumo={errata.resumo}
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
          onDescartar={errata.descartar}
          onDesfazer={errata.desfazer}
          podeDesfazer={errata.podeDesfazer}
          onConfirmar={() => {
            setErroErrata(null);
            setConfirmando(true);
          }}
        />
      )}

      <ErrataConfirmarDialog
        open={confirmando}
        onOpenChange={(aberto) => {
          if (!salvando) setConfirmando(aberto);
        }}
        jobCodigo={job.codigo}
        jobNome={job.nome}
        resumo={errata.resumo}
        mudancas={errata.mudancas}
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
