"use client";

/** Painel "Destrinchar realizado" — as PPs de UM item da planilha.
 *
 *  Design: `PPs - Gerar e Enviar ao Financeiro.dc.html` (02/09/2026),
 *  que substituiu a ficha numérica da opção 2a de `Job - PPs Parciais -
 *  Opcoes`. O que mudou, e por quê (decisão 039):
 *
 *  - A PP nasce GERADA e fica aqui, no job, até alguém enviá-la ao
 *    financeiro. Enviar, editar, ver e cancelar são ações por PP, e o
 *    painel se parte em dois blocos: "Aguardando envio" em cima, "Já no
 *    financeiro" embaixo.
 *  - A referência do item virou o PLANEJADO (era o orçado), e "Em PPs
 *    emitidas" soma só o que já chegou ao financeiro — a gerada conta só
 *    na pendência. O número acende em vermelho quando passa do planejado.
 *  - O Saldo e o "máximo aceito" saíram: sem teto por PP eles não decidem
 *    mais nada. Passar do planejado não impede gerar; no envio, pede o
 *    responsável do job (ou administrador) e um "tem certeza?" com o
 *    quanto o item fica acima.
 *  - Fora da verba de produção, a PP sem anexo não envia: o pedido de NF
 *    aparece em vermelho na própria linha.
 *  - Com a abertura em revisão por errata (decisão 040), nada envia até o
 *    financeiro salvar a revisão. Gerar, editar e cancelar seguem.
 *  - 08/09/2026: a PP que já foi ao financeiro ganhou as duas ações que
 *    faltavam — "Ver formulário" (a ficha em leitura, que o PDF não
 *    mostra: empresa emissora, parcelamento, anexos, quem enviou, motivo
 *    da rejeição) e "Cancelar", que já era regra do servidor
 *    (`podeCancelarPP`) e só existia na aba "Pedidos de Produção".
 *  - 28/09/2026 (decisão 112, versão C do protótipo): cada PP mostra
 *    R$ Unit., QT e D/M, como a planilha. Com mais de uma PP no item a
 *    planilha deixa essas três colunas em "—" (01/09/2026), e a quebra
 *    é aqui. A PP virou duas linhas: em cima código, fornecedor e
 *    situação (ou o botão de enviar, na PP ainda no job); embaixo o trio,
 *    o total e os botões. As colunas têm largura fixa para os valores de
 *    uma PP ficarem embaixo dos da outra. Fundo branco, sem a cor do
 *    bloco REALIZADO — pedido do Tiago. O painel foi de 430 para 500 px.
 *  - 07/10/2026 (decisão 153, opção C do protótipo aprovado): a PP a
 *    emitir vem antes de tudo — "PPs a emitir" em cima, com um terceiro
 *    número, "Em PPs a emitir", fora do realizado. "Gerar PP" passa sempre
 *    pela revisão. A PP gerada não se edita mais: o envio abre o pop-up dos
 *    documentos (decisão 152), e a rejeitada tem "Cancelar e refazer". Com
 *    o job aguardando abertura ou devolvido pelo financeiro, só PP a
 *    emitir. O cartão da PP a emitir não leva texto embaixo: o item pode
 *    ter muitas PPs, e o espaço é delas (Tiago, 06/10/2026).
 *  - 13/10/2026 (decisão 173, revê a 153): a PP aguardando envio se edita
 *    de novo, no lugar — o lápis abre o formulário com ela, e salvar passa
 *    pela revisão. Antes do envio só o lápis; depois, só o "Ver
 *    formulário" — nunca os dois (Tiago, 14/10/2026).
 *  - 19/10/2026 (revisão da 153): "Cancelar e refazer" virou "Reemitir
 *    PP". Um produtor achou que perderia o formulário e teria de refazer a
 *    PP do zero; o pop-up agora começa pelo que fica (dados e anexos).
 *    No mesmo dia virou "Editar e Reemitir PP", com o botão de confirmar
 *    vermelho (pedidos do Tiago).
 */

import * as React from "react";
import {
  envioDispensaNf,
  midiaAguardaProducao,
  type MidiaSystemDoJob,
  type SituacaoMidia,
} from "@/lib/calculos/midia-system";
import { useRouter } from "next/navigation";
import {
  X,
  FilePlus,
  FileText,
  Info,
  Eye,
  ClipboardList,
  Send,
  Pencil,
  XCircle,
  Paperclip,
  AlertTriangle,
  Lock,
  CheckCircle2,
  Trash2,
  FilePenLine,
  CalendarClock,
  ClipboardCheck,
  PencilLine,
  Gavel,
  Undo2,
  AlertCircle,
} from "lucide-react";
import type { ComiteDaPP } from "@/lib/data/comite";
import { ppCobertaPeloComite, ppPassaDoOrcadoNoComite } from "@/lib/calculos/limites-orcamento";
import { formatDataAsHoraBr } from "@/lib/formatar-data-hora";
import { cancelarEnvioAoComite } from "@/app/(app)/comite/actions";
import {
  SolicitarAprovacaoDialog,
  linhasDoMotivoDaPP,
} from "@/app/(app)/comite/_componentes/motivo-do-caso";
import { Dialog, DrawerContent } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn, formatCurrency } from "@/lib/utils";
import { SituacaoVerbaChip } from "@/components/financeiro/situacao-verba-chip";
import { PPStatusChip } from "../pps/pp-status-chip";
import {
  nomeDoCartaoCorporativo,
  podeCancelarPP,
  type AnexoDaPPNaLista,
  type DevolucaoDaVerba,
  type PPAEmitir,
  type PPStatus,
  type PrestacaoDaVerba,
  type SituacaoVerba,
} from "@/lib/types";
import {
  producaoEditaPrestacao,
  rotuloDoBotaoDaPrestacao,
  somaComprovadaEmCentavos,
} from "@/lib/calculos/prestacao-da-verba";
import { BarraDoComprovado } from "@/components/financeiro/prestacao-da-verba";
import { passaDoPlanejado } from "@/lib/calculos/pps-item";
import type { ReembolsoTipo } from "@/lib/calculos/reembolso";
import {
  hojeEmSaoPauloIso,
  isoParaBr,
  ppAceitaQuarta,
  vencimentoAceitaEnvio,
} from "@/lib/calculos/janelas-pagamento";
import {
  AtualizarVencimento,
  prazoDeEnvioPerdido,
  useFeriadosNacionais,
} from "./prazo-de-envio-pp";
import {
  signedUrlPdf,
  cancelarPedidoCompra,
  cancelarERefazerPP,
  excluirPPAEmitir,
  gerarPPDaPPAEmitir,
  solicitarAprovacaoDaPP,
} from "./actions-pp";
import {
  EnvioDialog,
  FaixaAguardaAbertura,
  RevisaoDialog,
  SeloPPAEmitir,
  TextoDoReemitir,
  TOAST_DO_REEMITIR,
  textoAguardaAbertura,
  type PPParaEnviar,
} from "./pp-a-emitir-ui";
import type { TomadorDaNf } from "./anexos-da-pp";
import { CorrigirNfDialog } from "./corrigir-nf-da-pp";
import {
  marcarPPsConcluidasDoItem,
  reabrirItemParaNovaPP,
} from "./actions-conclusao";

export interface PPDoItem {
  id: string;
  codigo: string;
  status: PPStatus;
  fornecedorNome: string;
  /** O trio da PP, nas mesmas colunas do item na planilha:
   *  valor = valorUnitario × quantidade × diasMeses. Obrigatórios: campo
   *  opcional num tipo de linha montado por `.map` some em silêncio. */
  valorUnitario: number;
  quantidade: number;
  diasMeses: number;
  valor: number;
  verbaProducao: boolean;
  /** Decisão 187: na PP de reembolso, despesas ou veículo próprio — o envio
   *  cobra os comprovantes. Null fora do reembolso. Obrigatório pelo mesmo
   *  motivo do trio. */
  reembolsoTipo: ReembolsoTipo | null;
  /** Tem pelo menos um anexo. Fora da verba, é o que libera o envio. */
  temAnexo: boolean;
  /** Onde a verba está depois de paga (decisão 081). */
  situacaoVerba: SituacaoVerba | null;
  /** Decisão 189: a prestação também se faz daqui, pelo cartão da verba.
   *  O cartão mostra o que já foi salvo e o que já está com o financeiro.
   *  Obrigatórios pelo mesmo motivo do trio; fora da verba, null. */
  prestacao: PrestacaoDaVerba | null;
  devolucao: DevolucaoDaVerba | null;
  /** O papel presta contas desta verba (decisões 164 e 171). */
  podePrestarContas: boolean;
  /** Decisão 216: a PP que foi sem NF na auditoria da Mídia System, e onde
   *  a prestação da nota está. Null fora disso. */
  situacaoMidia: SituacaoMidia | null;
  /** Decisões 152 e 153 — obrigatórios pelo mesmo motivo do trio. */
  fornecedorId: string | null;
  empresaId: string;
  /** O CNPJ da PP (decisão 156): o tomador esperado das notas. Obrigatório
   *  pelo mesmo motivo do trio. */
  estabelecimentoId: string | null;
  /** Decisão 157: o 1º vencimento e quando a PP foi gerada, para a
   *  data-limite de envio. Obrigatórios pelo mesmo motivo do trio. */
  prazoPagamento: string;
  geradaEm: string;
  /** Pagamento urgente: o "Atualizar vencimento" oferece também as quartas
   *  de exceções (decisão 172), como na verba. Obrigatório pelo mesmo
   *  motivo do trio. */
  urgente: boolean;
  servico: string;
  /** Os anexos gravados: o envio abre com eles. */
  anexos: AnexoDaPPNaLista[];
  /** A PP rejeitada que esta substitui ("Cancelar e refazer"). */
  substitui: string | null;
  motivoRejeicao: string | null;
  /** "Pronta para envio" (08/10/2026): o produtor conferiu os documentos e
   *  deixou a PP para o GP enviar. Obrigatórios pelo mesmo motivo do trio. */
  prontaParaEnvioEm: string | null;
  prontaParaEnvioPorNome: string | null;
  /** Decisão 161: paga por boleto — o envio exige o boleto e a nota.
   *  Obrigatório pelo mesmo motivo do trio. */
  pagaPorBoleto: boolean;
  /** Decisão 209: a PP do cartão corporativo vai sem nota. Obrigatório
   *  pelo mesmo motivo do trio. */
  cartaoCorporativo: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemNome: string;
  grupoNome: string;
  moeda: string;
  /** PLANEJADO do item — a referência da PP desde 02/09/2026. */
  totalPlanejado: number;
  /** A conta do planejado, embaixo do total no cartão do topo. */
  unitarioPlanejado: number;
  quantidadePlanejada: number;
  dmPlanejado: number;
  /** PPs do item, sem as canceladas (o servidor já as tira do mapa). */
  pps: PPDoItem[];
  /** Soma de TODAS as PPs do item menos as canceladas — a gerada entra
   *  desde 11/09/2026 (decisão 074). É o mesmo número que o realizado da
   *  linha na planilha, e é contra o planejado que ele acende. */
  emPPs: number;
  /** Por que o ENVIO ao financeiro está fechado, para a faixa e o
   *  `title` do botão. Null = envio liberado.
   *
   *  São dois motivos, e o painel não precisa distinguir: o job ainda
   *  não foi aberto (decisão 056) ou a errata devolveu a abertura à
   *  revisão (decisão 040). Nos dois, gerar, editar e cancelar seguem. */
  envioBloqueadoPor: string | null;
  /** Id da âncora do realizado — o marco "todas as PPs geradas" é
   *  gravado nela (decisão 052). */
  itemRealizadoId: string;
  /** O item já está marcado. Troca o rodapé: some o botão de marcar, e
   *  "Nova PP" passa a pedir confirmação. */
  concluido: boolean;
  /** Quem marcou e quando — a faixa verde do topo. */
  concluidoPorNome: string | null;
  concluidoEmLabel: string | null;
  /** Quem pode gerar também pode enviar e cancelar. Null quando o usuário
   *  só lê — a tela do financeiro, o job congelado. */
  onNovaPP: (() => void) | null;
  /** Abre a ficha da PP em leitura. Vale para
   *  quem só lê: a PP que já foi ao financeiro não é editável por
   *  ninguém, e o formulário dela precisava ficar visível. */
  onVerFormulario: (pp: PPDoItem) => void;
  /** Mensagem de sucesso para o toast de quem abriu o painel. */
  onMensagem?: (mensagem: string) => void;
  /** Decisão 153: as PPs a emitir do item, fora do realizado. */
  aEmitir: PPAEmitir[];
  /** Comitê de Aprovações (decisão 223): a PP a emitir que leva o
   *  realizado acima do orçado do item vai a ele antes de gerar. */
  comiteDaPP: ComiteDaPP;
  totalOrcado: number;
  linhaVermelha: boolean;
  /** O realizado do item (PPs menos devoluções aprovadas), a base da regra
   *  do Comitê — a mesma do formulário e do servidor. */
  realizadoDoItem: number;
  /** O status do job — aguardando abertura e devolvido só aceitam PP a emitir. */
  statusDoJob: string;
  /** O formulário pediu a revisão desta PP a emitir (o "Gerar PP" dele). */
  pedidoDeRevisao: { id: string; vez: number; depoisDe: string | null } | null;
  /** Abre o formulário da PP a emitir. Null quando o usuário só lê. */
  onEditarAEmitir: ((a: PPAEmitir) => void) | null;
  /** Decisão 173: abre o formulário com a PP gerada, para editar no lugar.
   *  Null quando o usuário só lê. */
  onEditarPP: ((pp: PPDoItem) => void) | null;
  /** "Cancelar e refazer" devolveu esta PP a emitir: o formulário abre nela. */
  onRefeita: (aEmitirId: string) => void;
  /** Quem refaz a rejeitada é quem envia (decisão 136). */
  podeRefazer: boolean;
  /** O papel envia ao financeiro (`jobs.enviar_pp`, decisão 136). Sem ele —
   *  produtor e freelancer —, o botão do envio vira "Deixar pronta para
   *  envio" (08/10/2026). */
  papelEnviaPP: boolean;
  /** Nomes para os cartões e os pop-ups da PP a emitir. */
  nomeDoFornecedor: (id: string | null) => string;
  nomeDoResponsavel: (id: string | null) => string;
  nomeDaEmpresa: (id: string) => string;
  /** Decisão 152: os CNPJs tomadores da NF e o de cada empresa emissora. */
  tomadores: TomadorDaNf[];
  tomadorPorEmpresa: Record<string, string>;
  /** Decisão 156: o CNPJ padrão do job, para a PP a emitir salva antes de
   *  07/10/2026, que não tem o CNPJ nos dados. */
  cnpjPadraoDaPP: string | null;
  /** Corrige a NF da PP em avaliação sem aprovar (`jobs.corrigir_nf_pp`,
   *  revisão da decisão 152): GP, administrador e financeiro. Vale também
   *  na tela do financeiro, onde o painel é só leitura. */
  podeCorrigirNf: boolean;
  /** Decisão 189: abre a gaveta da prestação de contas da verba, a mesma
   *  da aba de PPs. Null onde o painel só lê. */
  onPrestarContas: ((pp: PPDoItem) => void) | null;
  /** Decisão 216: o job Mídia System — na auditoria a PP vai sem NF.
   *  `null` = o job não é Mídia System. */
  midiaSystem: MidiaSystemDoJob | null;
}

export function PainelPPsItem({
  open,
  onOpenChange,
  itemNome,
  grupoNome,
  moeda,
  totalPlanejado,
  unitarioPlanejado,
  quantidadePlanejada,
  dmPlanejado,
  pps,
  emPPs,
  envioBloqueadoPor,
  itemRealizadoId,
  concluido,
  concluidoPorNome,
  concluidoEmLabel,
  onNovaPP,
  onVerFormulario,
  onMensagem,
  aEmitir,
  comiteDaPP,
  totalOrcado,
  linhaVermelha,
  realizadoDoItem,
  statusDoJob,
  pedidoDeRevisao,
  onEditarAEmitir,
  onEditarPP,
  onRefeita,
  podeRefazer,
  papelEnviaPP,
  nomeDoFornecedor,
  nomeDoResponsavel,
  nomeDaEmpresa,
  tomadores,
  tomadorPorEmpresa,
  cnpjPadraoDaPP,
  podeCorrigirNf,
  onPrestarContas,
  midiaSystem,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);
  const [cancelando, setCancelando] = React.useState<PPDoItem | null>(null);
  /** Aviso de "gerar nova PP num item completo" (decisão 052). */
  const [avisandoNovaPP, setAvisandoNovaPP] = React.useState(false);
  // Decisão 153: a revisão antes de gerar, o envio com os documentos, a
  // exclusão da PP a emitir e o "Cancelar e refazer" da rejeitada.
  const [revisando, setRevisando] = React.useState<PPAEmitir | null>(null);
  const [erroDaRevisao, setErroDaRevisao] = React.useState<string | null>(null);
  const [enviando, setEnviando] = React.useState<PPDoItem | null>(null);
  /** O pop-up dos documentos serve aos dois: o GP envia; o produtor e o
   *  freelancer deixam pronta para o GP enviar (08/10/2026). */
  const [modoDoEnvio, setModoDoEnvio] = React.useState<"enviar" | "preparar">("enviar");
  const [excluindo, setExcluindo] = React.useState<PPAEmitir | null>(null);
  const [refazendo, setRefazendo] = React.useState<PPDoItem | null>(null);
  /** Revisão da decisão 152: a NF da PP em avaliação, corrigida sem aprovar. */
  const [corrigindoNf, setCorrigindoNf] = React.useState<PPDoItem | null>(null);

  const podeAgir = onNovaPP !== null;
  // Comitê de Aprovações (decisão 223), por PP a emitir.
  const [pedindoComite, setPedindoComite] = React.useState<PPAEmitir | null>(null);
  const comiteDoCartao = (a: PPAEmitir) => {
    const pedido = comiteDaPP.pedidos[a.id] ?? null;
    const realizadoComAPP = Math.round((realizadoDoItem + a.valor) * 100) / 100;
    const valorAprovado = comiteDaPP.valorAprovado[a.id] ?? null;
    const vai =
      !comiteDaPP.aprovaDireto &&
      ppPassaDoOrcadoNoComite(comiteDaPP.regras, realizadoComAPP, totalOrcado, linhaVermelha) &&
      !ppCobertaPeloComite(valorAprovado, a.valor);
    return { pedido, realizadoComAPP, valorAprovado, vai, aguardando: pedido?.status === "pendente" };
  };
  function cancelarComite(pedidoId: string) {
    setErro(null);
    startTransition(async () => {
      const res = await cancelarEnvioAoComite(pedidoId);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      onMensagem?.("Envio ao Comitê cancelado.");
      router.refresh();
    });
  }
  async function solicitarComite(motivo: string): Promise<string | null> {
    if (!pedindoComite) return null;
    const res = await solicitarAprovacaoDaPP(pedindoComite.id, motivo);
    if (!res.ok) return res.message;
    setPedindoComite(null);
    onMensagem?.("Aprovação da PP solicitada ao Comitê.");
    router.refresh();
    return null;
  }
  const pendentes = pps.filter((pp) => pp.status === "gerada");
  const enviadas = pps.filter((pp) => pp.status !== "gerada");
  const excede = passaDoPlanejado(emPPs, totalPlanejado);
  const emAEmitir = Math.round(aEmitir.reduce((s, a) => s + a.valor, 0) * 100) / 100;
  const travaDaAbertura = textoAguardaAbertura(statusDoJob);
  // Prazo de envio (decisão 157).
  const feriados = useFeriadosNacionais();
  const hoje = hojeEmSaoPauloIso();
  // Decisão 164: na alimentação e no transporte, o titular guardado na PP.
  const contraparte = (a: PPAEmitir) =>
    a.cartao_corporativo
      ? nomeDoCartaoCorporativo(a.cartao_plataforma)
      : !a.verba_producao
      ? nomeDoFornecedor(a.fornecedor_id)
      : a.verba_titular_nome
        ? a.verba_titular_nome
        : nomeDoResponsavel(a.responsavel_verba_id);

  React.useEffect(() => {
    if (!open) {
      setErro(null);
      setCancelando(null);
      setAvisandoNovaPP(false);
      setRevisando(null);
      setEnviando(null);
      setExcluindo(null);
      setRefazendo(null);
      setCorrigindoNf(null);
    }
  }, [open]);

  // O "Gerar PP" do formulário salva a PP a emitir, fecha e pede a revisão
  // aqui. Ela abre quando a PP a emitir chega pelo refresh.
  const vezDaRevisao = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (!pedidoDeRevisao || vezDaRevisao.current === pedidoDeRevisao.vez) return;
    const alvo = aEmitir.find((a) => a.id === pedidoDeRevisao.id);
    // A PP a emitir editada já estava na lista: espera a versão salva
    // (19/10/2026 — a revisão abria com os dados de antes da edição).
    if (!alvo || alvo.updated_at === pedidoDeRevisao.depoisDe) return;
    vezDaRevisao.current = pedidoDeRevisao.vez;
    setErroDaRevisao(null);
    setRevisando(alvo);
  }, [pedidoDeRevisao, aEmitir]);

  function gerar() {
    if (!revisando) return;
    const alvo = revisando;
    setErroDaRevisao(null);
    startTransition(async () => {
      const res = await gerarPPDaPPAEmitir(alvo.id);
      if (!res.ok) {
        setErroDaRevisao(res.message);
        return;
      }
      setRevisando(null);
      onMensagem?.(
        alvo.tipo_verba === "reembolso"
          ? `Pedido de Produção ${res.codigo} gerado. Envie ao financeiro com os comprovantes.`
          : `Pedido de Produção ${res.codigo} gerado. Envie ao financeiro quando a nota chegar.`,
      );
      router.refresh();
    });
  }

  function excluir() {
    if (!excluindo) return;
    const alvo = excluindo;
    startTransition(async () => {
      const res = await excluirPPAEmitir(alvo.id);
      setExcluindo(null);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      onMensagem?.("PP a emitir excluída.");
      router.refresh();
    });
  }

  function refazer() {
    if (!refazendo) return;
    const alvo = refazendo;
    startTransition(async () => {
      const res = await cancelarERefazerPP(alvo.id);
      setRefazendo(null);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      onMensagem?.(TOAST_DO_REEMITIR(res.codigo));
      router.refresh();
      onRefeita(res.aEmitirId);
    });
  }

  /** "Todas as PPs deste item já foram geradas" — o botão do rodapé.
   *  Não gera nem envia nada: só fecha o item. */
  function marcar() {
    setErro(null);
    startTransition(async () => {
      const res = await marcarPPsConcluidasDoItem(itemRealizadoId);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      onMensagem?.("Item marcado: todas as PPs dele já foram geradas.");
      router.refresh();
    });
  }

  /** Nova PP: direto no item em aberto; com aviso no item marcado, porque
   *  gerar mais uma PP ali REABRE o item e devolve o saldo do planejado
   *  para a previsão de custo. */
  function pedirNovaPP() {
    if (!onNovaPP) return;
    if (!concluido) {
      onNovaPP();
      return;
    }
    setAvisandoNovaPP(true);
  }

  function confirmarNovaPP() {
    setErro(null);
    startTransition(async () => {
      const res = await reabrirItemParaNovaPP(itemRealizadoId);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      setAvisandoNovaPP(false);
      router.refresh();
      onNovaPP?.();
    });
  }

  function verPdf(ppId: string) {
    startTransition(async () => {
      const res = await signedUrlPdf(ppId);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      window.open(res.url, "_blank", "noopener,noreferrer");
    });
  }

  /** O envio abre o pop-up dos documentos (decisão 152): a PP gerada não
   *  se edita, e a nota do fornecedor entra ali. O "tem certeza?" acima do
   *  planejado vem dentro dele. */
  function pedirEnvio(pp: PPDoItem) {
    setErro(null);
    setModoDoEnvio("enviar");
    setEnviando(pp);
  }

  /** O produtor confere os documentos com as regras do envio e deixa a PP
   *  pronta; reabre quantas vezes quiser até o GP enviar. */
  function pedirPreparo(pp: PPDoItem) {
    setErro(null);
    setModoDoEnvio("preparar");
    setEnviando(pp);
  }

  function cancelar() {
    if (!cancelando) return;
    const alvo = cancelando;
    startTransition(async () => {
      const res = await cancelarPedidoCompra(alvo.id);
      setCancelando(null);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      onMensagem?.(`${alvo.codigo} cancelada.`);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="sm:max-w-[500px]">
        <div className="flex items-start justify-between gap-3 border-b border-border px-6 py-5">
          <div className="flex flex-col gap-1">
            <h2 className="text-[17px] font-bold tracking-tight">
              Destrinchar realizado
            </h2>
            <p className="text-[12.5px] text-muted-foreground">
              {itemNome} · grupo {grupoNome}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Fechar"
            className="inline-flex h-7 w-7 items-center justify-center rounded-[9px] border border-border bg-card text-muted-foreground hover:bg-muted"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* O item está fechado: não sai mais PP daqui, e a previsão de
            custo dele já passou a valer o que as PPs dizem. */}
        {concluido && (
          <div className="flex items-start gap-2.5 border-b border-emerald-100 bg-emerald-50/70 px-6 py-3">
            <CheckCircle2 className="mt-0.5 h-[15px] w-[15px] shrink-0 text-emerald-700" />
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[12.5px] font-bold text-emerald-700">
                Todas as PPs deste item foram geradas
              </span>
              <span className="text-[11px] leading-snug text-emerald-800/80">
                {[concluidoPorNome, concluidoEmLabel]
                  .filter(Boolean)
                  .join(" · ")}
                {concluidoPorNome || concluidoEmLabel ? " · " : ""}
                a previsão de custo passa a usar as PPs do item
              </span>
            </div>
          </div>
        )}

        <div className="relative flex flex-1 flex-col gap-[18px] overflow-y-auto px-6 py-4">
          {erro && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-california-red/30 bg-california-red/5 px-3 py-2 text-xs text-california-red">
              <span>{erro}</span>
              <button type="button" onClick={() => setErro(null)} aria-label="Fechar aviso">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Os dois números do design: a referência e o que já está
              comprometido. O Saldo saiu — sem teto ele não decide nada. */}
          <div className="grid grid-cols-3 overflow-hidden rounded-[14px] border border-border bg-card">
            <FichaNumero
              rotulo="Planejado do item"
              valor={formatCurrency(totalPlanejado, moeda)}
              conta={`${formatCurrency(unitarioPlanejado, moeda)} × ${formatarFator(quantidadePlanejada)} × ${formatarFator(dmPlanejado)}`}
              className="border-r border-border"
            />
            <FichaNumero
              rotulo="Em PPs emitidas"
              valor={formatCurrency(emPPs, moeda)}
              conta={`${pps.length} ${pps.length === 1 ? "PP" : "PPs"}`}
              corValor={excede ? "text-california-red" : undefined}
              className="border-r border-border"
            />
            {/* Decisão 153: o valor das PPs a emitir, à parte do realizado. */}
            <FichaNumero
              rotulo="Em PPs a emitir"
              valor={formatCurrency(emAEmitir, moeda)}
              conta={`${aEmitir.length} · fora do realizado`}
              corValor="text-muted-foreground"
            />
          </div>

          {/* Job aguardando abertura ou devolvido: só PP a emitir. */}
          {travaDaAbertura && <FaixaAguardaAbertura texto={travaDaAbertura} />}

          {!travaDaAbertura && envioBloqueadoPor && pendentes.length > 0 && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" />
              <p className="text-[11.5px] leading-relaxed text-amber-800">
                {envioBloqueadoPor}
              </p>
            </div>
          )}

          {pps.length === 0 && aEmitir.length === 0 && (
            <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-xs leading-relaxed text-muted-foreground">
              {concluido
                ? "Nenhuma PP neste item, e ele está marcado: é custo que não vai gerar PP. O planejado dele saiu da previsão de custo."
                : "Nenhuma PP gerada para este item ainda."}
            </div>
          )}

          {/* Decisão 153: a PP a emitir em cima — o próximo passo é gerar. */}
          {aEmitir.length > 0 && (
            <div className="flex flex-col gap-2.5">
              <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                PPs a emitir · {aEmitir.length}
              </span>
              {aEmitir.map((a) => {
                const c = comiteDoCartao(a);
                const prazoOk = vencimentoAceitaEnvio(a.dados.prazo_pagamento, hoje, feriados);
                const botaoComite = (
                  <button
                    type="button"
                    onClick={() => setPedindoComite(a)}
                    disabled={pending}
                    className="inline-flex flex-none items-center gap-1.5 whitespace-nowrap rounded-[9px] border border-california-red bg-california-red px-2.5 py-1 text-[11px] font-bold text-white transition-colors hover:bg-california-red-hover disabled:opacity-60"
                  >
                    <Gavel className="h-3 w-3" />
                    Solicitar aprovação
                  </button>
                );
                const avisoDoComite = c.aguardando && c.pedido ? (
                  <span className="flex flex-col gap-1.5">
                    <span className="text-[11px] font-semibold leading-snug text-amber-800">
                      Enviada em {formatDataAsHoraBr(c.pedido.enviadoEm)}.
                    </span>
                    <span className="text-[11px] leading-snug text-muted-foreground">Motivo: “{c.pedido.motivo}”</span>
                  </span>
                ) : c.vai && c.pedido?.status === "devolvido" ? (
                  <span className="flex flex-col gap-1">
                    <span className="text-[11px] font-semibold leading-snug text-red-700">
                      Devolvida pelo Comitê — {c.pedido.decididoPor}, {formatDataAsHoraBr(c.pedido.decididoEm)}: “{c.pedido.comentario}”
                    </span>
                    <span className="text-[11px] leading-snug text-muted-foreground">
                      Edite a PP pelo lápis e solicite a aprovação de novo.
                    </span>
                  </span>
                ) : c.vai ? (
                  <span className="flex items-start gap-1.5 text-[11px] font-semibold leading-snug text-california-red">
                    <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                    {c.valorAprovado !== null
                      ? `Ficou mais cara que o valor aprovado pelo Comitê (${formatCurrency(c.valorAprovado, moeda)}): precisa do Comitê de novo antes de gerar.`
                      : `Passa do orçado do item em ${formatCurrency(c.realizadoComAPP - totalOrcado, moeda)}: precisa do Comitê antes de gerar.`}
                  </span>
                ) : c.pedido?.status === "aprovado" ? (
                  <span className="flex items-start gap-1.5 text-[11px] font-semibold leading-snug text-emerald-700">
                    <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" />
                    Aprovada pelo Comitê — {c.pedido.decididoPor}, {formatDataAsHoraBr(c.pedido.decididoEm)}. Já pode gerar.
                  </span>
                ) : null;
                return (
                <CartaoPP
                  key={a.id}
                  pp={{
                    id: a.id,
                    codigo: "",
                    status: "gerada",
                    // Decisão 187: o cartão do reembolso a emitir diz que é
                    // reembolso; a revisão mostra só o titular.
                    fornecedorNome:
                      a.tipo_verba === "reembolso" ? `Reembolso — ${contraparte(a)}` : contraparte(a),
                    valorUnitario: a.dados.valor_unitario,
                    quantidade: a.dados.quantidade,
                    diasMeses: a.dados.dias_meses,
                    valor: a.valor,
                    verbaProducao: a.verba_producao,
                    // A PP a emitir ainda não foi ao financeiro.
                    situacaoMidia: null,
                    reembolsoTipo:
                      a.tipo_verba === "reembolso" ? (a.dados.reembolso_tipo ?? "despesas") : null,
                    temAnexo: a.anexos.length > 0,
                    situacaoVerba: null,
                    prestacao: null,
                    devolucao: null,
                    podePrestarContas: false,
                    fornecedorId: a.fornecedor_id,
                    empresaId: a.empresa_id,
                    estabelecimentoId: a.dados.estabelecimento_id ?? cnpjPadraoDaPP,
                    prazoPagamento: a.dados.prazo_pagamento,
                    geradaEm: a.created_at,
                    urgente: a.dados.urgente === true,
                    servico: a.servico,
                    anexos: [],
                    substitui: null,
                    motivoRejeicao: null,
                    // A PP a emitir ainda não é PP: nada a enviar.
                    prontaParaEnvioEm: null,
                    prontaParaEnvioPorNome: null,
                    pagaPorBoleto: a.dados.pagamento_fora_do_cadastro?.meio === "boleto",
                    cartaoCorporativo: a.cartao_corporativo,
                  }}
                  moeda={moeda}
                  codigo={<SeloPPAEmitir refaz={a.refaz?.codigo ?? null} />}
                  direita={
                    c.aguardando ? (
                      <span className="inline-flex flex-none items-center gap-1 whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-amber-800">
                        <Gavel className="h-3 w-3" />
                        Aguardando aprovação
                      </span>
                    ) : podeAgir && c.vai && travaDaAbertura === null ? (
                      botaoComite
                    ) : podeAgir ? (
                      <button
                        type="button"
                        onClick={() => {
                          setErroDaRevisao(null);
                          setRevisando(a);
                        }}
                        disabled={pending || travaDaAbertura !== null}
                        title={travaDaAbertura ?? undefined}
                        className={cn(
                          "inline-flex flex-none items-center gap-1.5 whitespace-nowrap rounded-[9px] border px-2.5 py-1 text-[11px] font-bold transition-colors",
                          travaDaAbertura
                            ? "cursor-not-allowed border-border bg-muted text-muted-foreground/70"
                            : "border-foreground bg-foreground text-white hover:opacity-90",
                        )}
                      >
                        <FilePlus className="h-3 w-3" />
                        Gerar PP
                      </button>
                    ) : null
                  }
                  botoes={
                    c.aguardando && c.pedido && onEditarAEmitir ? (
                      // Aguardando o Comitê: nem editar nem excluir; só
                      // cancelar o envio (o ícone, com a dica).
                      <BotaoIcone
                        titulo="Cancelar envio"
                        onClick={() => cancelarComite(c.pedido!.id)}
                        disabled={pending}
                      >
                        <Undo2 className="h-3 w-3" />
                      </BotaoIcone>
                    ) : onEditarAEmitir ? (
                      <>
                        <BotaoIcone
                          titulo="Editar a PP a emitir"
                          onClick={() => onEditarAEmitir(a)}
                          disabled={pending}
                        >
                          <Pencil className="h-3 w-3" />
                        </BotaoIcone>
                        <BotaoIcone
                          titulo="Excluir a PP a emitir"
                          onClick={() => setExcluindo(a)}
                          disabled={pending}
                        >
                          <Trash2 className="h-3 w-3" />
                        </BotaoIcone>
                      </>
                    ) : null
                  }
                  aviso={
                    avisoDoComite || !prazoOk ? (
                      <span className="flex flex-col gap-1.5">
                        {avisoDoComite}
                        {!prazoOk && (
                          <span className="flex items-start gap-1.5 text-[11px] leading-snug text-amber-800">
                            <CalendarClock className="mt-0.5 h-3 w-3 shrink-0" />
                            O prazo de envio do vencimento {isoParaBr(a.dados.prazo_pagamento)} já passou. Edite a PP a emitir e escolha outra data antes de gerar.
                          </span>
                        )}
                      </span>
                    ) : null
                  }
                />
                );
              })}
            </div>
          )}

          {pendentes.length > 0 && (
            <div className="flex flex-col gap-2.5">
              <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                Aguardando envio · {pendentes.length}
              </span>
              {pendentes.map((pp) => {
                // Decisão 209: o cartão corporativo vai sem nota.
                const semNF = !pp.verbaProducao && !pp.cartaoCorporativo && !pp.temAnexo;
                // Perdeu a data-limite de envio (decisão 157): só sai depois
                // do "Atualizar vencimento".
                const prazoPerdido = prazoDeEnvioPerdido(pp, hoje, feriados);
                // A nota entra no pop-up do envio (decisão 152).
                const podeEnviar =
                  podeAgir && !envioBloqueadoPor && !travaDaAbertura && !prazoPerdido;
                // Quem não envia deixa pronta para o GP (08/10/2026). Vale
                // até com a abertura em revisão ou o prazo perdido: preparar
                // não manda nada ao financeiro.
                const preparar = podeAgir && !papelEnviaPP;
                const pronta = pp.prontaParaEnvioEm !== null;
                return (
                  <CartaoPP
                    key={pp.id}
                    pp={pp}
                    moeda={moeda}
                    // Na PP ainda no job, o lugar da situação é do botão de
                    // enviar — a situação já está no título do bloco.
                    direita={
                      preparar ? (
                        <button
                          type="button"
                          onClick={() => pedirPreparo(pp)}
                          disabled={pending || travaDaAbertura !== null}
                          title={travaDaAbertura ?? (pronta ? "Reabrir a conferência: o GP ainda não enviou." : undefined)}
                          className={cn(
                            "inline-flex flex-none items-center gap-1.5 whitespace-nowrap rounded-[9px] border px-2.5 py-1 text-[11px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                            pronta
                              ? "border-border bg-white text-foreground hover:border-california-red/40 hover:text-california-red"
                              : "border-california-red bg-california-red text-white hover:bg-california-red-hover",
                          )}
                        >
                          {pronta ? <PencilLine className="h-3 w-3" /> : <ClipboardCheck className="h-3 w-3" />}
                          {pronta ? "Editar conferência" : "Deixar pronta para envio"}
                        </button>
                      ) : podeAgir ? (
                        <button
                          type="button"
                          onClick={() => pedirEnvio(pp)}
                          disabled={pending || !podeEnviar}
                          title={
                            travaDaAbertura ??
                            envioBloqueadoPor ??
                            (prazoPerdido ? "Atualize o vencimento antes de enviar." : undefined)
                          }
                          className={cn(
                            "inline-flex flex-none items-center gap-1.5 whitespace-nowrap rounded-[9px] border px-2.5 py-1 text-[11px] font-bold transition-colors",
                            podeEnviar
                              ? "border-california-red bg-california-red text-white hover:bg-california-red-hover"
                              : "cursor-not-allowed border-border bg-muted text-muted-foreground/70",
                            pending && "opacity-60",
                          )}
                        >
                          <Send className="h-3 w-3" />
                          Enviar ao financeiro
                        </button>
                      ) : (
                        <PPStatusChip status={pp.status} />
                      )
                    }
                    botoes={
                      <>
                        {/* Decisão 173: antes do envio, o formulário se
                            EDITA — só o lápis; depois do envio, só se vê (o
                            "Ver formulário" do bloco de baixo). Um ou outro,
                            nunca os dois (Tiago, 14/10/2026). Quem só lê o
                            job não tem o lápis e fica com a ficha. Com o job
                            devolvido à pré-abertura, o lápis fica apagado
                            com o motivo. */}
                        {onEditarPP ? (
                          <BotaoIcone
                            titulo={travaDaAbertura ?? "Editar PP"}
                            rotulo="Editar PP"
                            onClick={() => onEditarPP(pp)}
                            disabled={pending || travaDaAbertura !== null}
                          >
                            <Pencil className="h-3 w-3" />
                          </BotaoIcone>
                        ) : (
                          <BotaoIcone
                            titulo="Ver formulário"
                            onClick={() => onVerFormulario(pp)}
                            disabled={pending}
                          >
                            <ClipboardList className="h-3 w-3" />
                          </BotaoIcone>
                        )}
                        <BotaoIcone
                          titulo="Ver PDF"
                          onClick={() => verPdf(pp.id)}
                          disabled={pending}
                        >
                          <Eye className="h-3 w-3" />
                        </BotaoIcone>
                        {podeAgir && (
                          <BotaoIcone
                            titulo="Cancelar PP"
                            onClick={() => setCancelando(pp)}
                            disabled={pending}
                          >
                            <XCircle className="h-3 w-3" />
                          </BotaoIcone>
                        )}
                      </>
                    }
                    aviso={
                      semNF || pp.substitui || prazoPerdido || pronta ? (
                        <span className="flex flex-col gap-1">
                          {pronta && (
                            <span className="flex items-start gap-1.5 text-[11px] leading-snug text-amber-800">
                              <ClipboardCheck className="mt-0.5 h-3 w-3 shrink-0" />
                              <span>
                                <strong className="font-semibold">Pronta para envio</strong>
                                {pp.prontaParaEnvioPorNome ? ` · ${pp.prontaParaEnvioPorNome}` : ""} ·{" "}
                                {new Date(pp.prontaParaEnvioEm as string).toLocaleString("pt-BR", {
                                  day: "2-digit",
                                  month: "2-digit",
                                  year: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                                {preparar ? " · o GP envia pela aba Pedidos de Produção" : ""}
                              </span>
                            </span>
                          )}
                          {prazoPerdido && (
                            <AtualizarVencimento
                              quartaLiberada={ppAceitaQuarta({
                                urgente: pp.urgente,
                                verba: pp.verbaProducao,
                              })}
                              ppId={pp.id}
                              codigo={pp.codigo}
                              vencimento={pp.prazoPagamento}
                              limite={prazoPerdido.limite}
                              hojeIso={hoje}
                              feriados={feriados}
                              podeAtualizar={podeAgir}
                              onAtualizada={(m) => onMensagem?.(m)}
                            />
                          )}
                          {pp.substitui && (
                            <span className="text-[11px] leading-snug text-muted-foreground">
                              Substitui a <span className="font-mono">{pp.substitui}</span>, rejeitada e cancelada.
                            </span>
                          )}
                          {semNF && (
                            <span className="flex items-start gap-1.5 text-[11px] leading-snug text-amber-800">
                              <Paperclip className="mt-0.5 h-3 w-3 shrink-0" />
                              {/* Decisão 216: na auditoria, a nota pode ir depois. */}
                              {envioDispensaNf(midiaSystem)
                                ? "Job Mídia System em auditoria: a nota pode ir depois."
                                : "Ainda sem a nota do fornecedor: ela e os dados dela entram no envio."}
                            </span>
                          )}
                        </span>
                      ) : null
                    }
                  />
                );
              })}
            </div>
          )}

          {enviadas.length > 0 && (
            <div className="flex flex-col gap-2.5">
              <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                Já no financeiro
              </span>
              {enviadas.map((pp) => {
                const cancelavel = podeCancelarPP(pp.status);
                return (
                  <CartaoPP
                    key={pp.id}
                    pp={pp}
                    moeda={moeda}
                    direita={
                      pp.situacaoVerba ? (
                        <SituacaoVerbaChip situacao={pp.situacaoVerba} />
                      ) : (
                        <PPStatusChip status={pp.status} />
                      )
                    }
                    botoes={
                      <>
                        <BotaoIcone
                          titulo="Ver formulário"
                          onClick={() => onVerFormulario(pp)}
                          disabled={pending}
                        >
                          <ClipboardList className="h-3 w-3" />
                        </BotaoIcone>
                        <BotaoIcone
                          titulo="Ver PDF"
                          onClick={() => verPdf(pp.id)}
                          disabled={pending}
                        >
                          <Eye className="h-3 w-3" />
                        </BotaoIcone>
                        {/* Revisão da decisão 152: a NF enviada errada se
                            corrige sem o financeiro aprovar, enquanto a PP
                            está em avaliação. */}
                        {podeCorrigirNf &&
                          pp.status === "em_avaliacao" &&
                          pp.anexos.some((a) => a.documento_tipo === "nota_fiscal") && (
                            <BotaoIcone
                              titulo="Corrigir a NF"
                              onClick={() => setCorrigindoNf(pp)}
                              disabled={pending}
                            >
                              <FilePenLine className="h-3 w-3" />
                            </BotaoIcone>
                          )}
                        {/* Cancelar segue a regra do servidor
                            (`podeCancelarPP`): em avaliação e rejeitada
                            ainda voltam atrás; aprovada já é título a
                            pagar e paga precisaria de estorno. Nesses
                            dois o botão fica apagado com o motivo, em vez
                            de sumir — some parece falta de permissão. */}
                        {podeAgir && (
                          <BotaoIcone
                            titulo={
                              cancelavel
                                ? "Cancelar PP"
                                : motivoSemCancelar(pp.status)
                            }
                            rotulo="Cancelar PP"
                            onClick={() => setCancelando(pp)}
                            disabled={pending || !cancelavel}
                          >
                            <XCircle className="h-3 w-3" />
                          </BotaoIcone>
                        )}
                      </>
                    }
                    aviso={
                      // "Substitui" segue a PP depois do envio, não só antes.
                      // Decisão 189: a verba enviada mostra a prestação.
                      pp.status === "rejeitada" || pp.substitui || verbaComPrestacao(pp) ? (
                        <span className="flex flex-col gap-1.5">
                          {pp.substitui && (
                            <span className="text-[11px] leading-snug text-muted-foreground">
                              Substitui a <span className="font-mono">{pp.substitui}</span>, rejeitada e cancelada.
                            </span>
                          )}
                          {pp.status === "rejeitada" ? (
                            // A rejeitada não se edita (decisão 153): cancela e
                            // volta como PP a emitir, com os mesmos dados.
                            <span className="flex flex-col gap-1.5">
                              <span className="text-[11px] font-semibold leading-snug text-red-700">
                                Motivo da rejeição: {pp.motivoRejeicao ?? "—"}
                              </span>
                              {podeAgir && podeRefazer && (
                                <button
                                  type="button"
                                  onClick={() => setRefazendo(pp)}
                                  disabled={pending}
                                  className="inline-flex w-fit items-center gap-1.5 rounded-[9px] border border-california-red bg-california-red px-2.5 py-1 text-[11px] font-bold text-white hover:bg-california-red-hover disabled:opacity-50"
                                >
                                  <Pencil className="h-3 w-3" />
                                  Editar e Reemitir PP
                                </button>
                              )}
                            </span>
                          ) : verbaComPrestacao(pp) ? (
                            <PrestacaoNoCartao pp={pp} onAbrir={onPrestarContas} />
                          ) : null}
                        </span>
                      ) : null
                    }
                  />
                );
              })}
            </div>
          )}

        </div>

        {onNovaPP && (
          <div className="flex flex-col gap-2.5 border-t border-border bg-muted/30 px-6 py-4">
            {/* Marcar não abre formulário e não despacha nada: só declara
                que não sairão mais PPs deste item (decisão 052). */}
            {!concluido && (
              <button
                type="button"
                onClick={marcar}
                disabled={pending}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-[12.5px] font-bold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-50"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Marcar: todas as PPs geradas
              </button>
            )}
            <button
              type="button"
              onClick={pedirNovaPP}
              disabled={pending}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3.5 py-2.5 text-[13px] font-semibold transition-colors hover:bg-muted disabled:opacity-50"
            >
              <FilePlus className="h-3.5 w-3.5 text-california-red" />
              Nova PP para este item
            </button>
            <span className="text-center text-[11px] leading-snug text-muted-foreground">
              {concluido
                ? "O item está completo: gerar nova PP aqui pede confirmação e reabre o item."
                : pps.length === 0
                  ? "Item sem PP pode ser marcado: serve para custo que não vai gerar PP."
                  : "Marcar não envia nada ao financeiro — só diz que não sairão mais PPs deste item."}
            </span>
          </div>
        )}

        {/* Reabrir não é botão: é consequência de pedir mais uma PP num
            item já fechado. O aviso explica o efeito no fluxo de caixa
            antes de o formulário abrir (decisão 052). */}
        {avisandoNovaPP && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#282828]/30 p-5">
            <div className="flex w-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-elevated">
              <div className="flex flex-col gap-2.5 px-[18px] pb-3.5 pt-[18px]">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-california-red" />
                  <h3 className="text-[15px] font-bold tracking-tight">
                    Gerar nova PP num item completo?
                  </h3>
                </div>
                <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                  <strong className="text-foreground">{itemNome}</strong> está
                  marcado como{" "}
                  <strong className="text-foreground">
                    todas as PPs geradas
                  </strong>
                  . Continuar reabre o item: a previsão de custo volta a usar o
                  planejado até alguém marcar de novo.
                </p>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  As PPs já geradas continuam valendo. A reabertura fica
                  registrada no chat da Comunicação, com autor e data.
                </p>
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-border bg-muted/30 px-[18px] py-3">
                <button
                  type="button"
                  onClick={() => setAvisandoNovaPP(false)}
                  disabled={pending}
                  className="rounded-[10px] border border-border bg-card px-3.5 py-2 text-[12.5px] font-semibold hover:bg-muted disabled:opacity-50"
                >
                  Voltar
                </button>
                <button
                  type="button"
                  onClick={confirmarNovaPP}
                  disabled={pending}
                  className="rounded-[10px] bg-california-red px-[15px] py-2 text-[12.5px] font-bold text-white hover:bg-california-red-hover disabled:opacity-50"
                >
                  {pending ? "Reabrindo…" : "Sim, gerar nova PP"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Decisão 153: a revisão antes de gerar, sempre. */}
        {/* Comitê de Aprovações (decisão 223): o pedido da PP a emitir. */}
        <SolicitarAprovacaoDialog
          aberto={pedindoComite !== null}
          titulo="Solicitar a aprovação da PP?"
          descricao="O realizado do item com esta PP passa do orçado. Aprovada pelo Comitê, ela fica liberada para gerar."
          linhas={
            pedindoComite
              ? linhasDoMotivoDaPP({
                  item: itemNome,
                  linhaVermelha,
                  orcado: totalOrcado,
                  realizadoComAPP: Math.round((realizadoDoItem + pedindoComite.valor) * 100) / 100,
                })
              : []
          }
          motivoInicial={
            pedindoComite && comiteDaPP.pedidos[pedindoComite.id]?.status === "devolvido"
              ? comiteDaPP.pedidos[pedindoComite.id].motivo
              : ""
          }
          placeholder="Ex.: o cliente pediu um painel a mais no palco na reunião de ontem."
          onFechar={() => setPedindoComite(null)}
          onEnviar={solicitarComite}
        />
        <RevisaoDialog
          open={revisando !== null}
          onOpenChange={(o) => {
            if (!o && !pending) setRevisando(null);
          }}
          aEmitir={revisando}
          nomeDoFornecedor={revisando ? contraparte(revisando) : ""}
          nomeDaEmpresa={
            revisando
              ? (tomadores.find((t) => t.id === (revisando.dados.estabelecimento_id ?? cnpjPadraoDaPP))?.nome ?? "—")
              : ""
          }
          tomadores={tomadores}
          planejado={totalPlanejado}
          emitidasAntes={emPPs}
          moeda={moeda}
          pending={pending}
          erro={erroDaRevisao}
          onFecharErro={() => setErroDaRevisao(null)}
          onGerar={gerar}
          onEditar={() => {
            if (!revisando || !onEditarAEmitir) return;
            const alvo = revisando;
            setRevisando(null);
            onEditarAEmitir(alvo);
          }}
        />
        {/* Decisão 152: o envio com os documentos do fornecedor. */}
        {enviando && (
          <EnvioDialog
            modo={modoDoEnvio}
            pp={
              {
                id: enviando.id,
                codigo: enviando.codigo,
                estabelecimentoId: enviando.estabelecimentoId,
                valor: enviando.valor,
                servico: enviando.servico,
                fornecedorId: enviando.fornecedorId,
                verbaProducao: enviando.verbaProducao,
                reembolsoTipo: enviando.reembolsoTipo,
                anexos: enviando.anexos,
                pagaPorBoleto: enviando.pagaPorBoleto,
                cartaoCorporativo: enviando.cartaoCorporativo,
              } satisfies PPParaEnviar
            }
            onOpenChange={(o) => !o && setEnviando(null)}
            nomeDoFornecedor={enviando.fornecedorNome}
            nomeDaEmpresa={tomadores.find((t) => t.id === enviando.estabelecimentoId)?.nome ?? "—"}
            tomadores={tomadores}
            tomadorEsperado={enviando.estabelecimentoId}
            tomadorPorEmpresa={tomadorPorEmpresa}
            nomeDaEmpresaDe={nomeDaEmpresa}
            moeda={moeda}
            envioSemNf={envioDispensaNf(midiaSystem)}
            onEnviada={(codigo, emissora) => {
              setEnviando(null);
              onMensagem?.(
                (modoDoEnvio === "preparar"
                  ? `${codigo} pronta para envio. O GP envia pela aba Pedidos de Produção.`
                  : `${codigo} enviada ao financeiro.`) +
                  // Revisão da 156: a PP passou para o CNPJ do documento.
                  (emissora ? ` A empresa emissora passou para ${emissora.para}, o CNPJ do documento.` : ""),
              );
              router.refresh();
            }}
          />
        )}
        <CorrigirNfDialog
          alvo={corrigindoNf ? { id: corrigindoNf.id, codigo: corrigindoNf.codigo } : null}
          onOpenChange={(o) => !o && setCorrigindoNf(null)}
          fornecedorNome={corrigindoNf?.fornecedorNome ?? ""}
          nomeDaEmpresa={nomeDaEmpresa}
          tomadores={tomadores}
          tomadorPorEmpresa={tomadorPorEmpresa}
          onCorrigida={(codigo, emissora, aviso) => {
            setCorrigindoNf(null);
            onMensagem?.(
              aviso ??
                `NF da ${codigo} corrigida.${
                  // Revisão da 156: a PP passou para o CNPJ da nota corrigida.
                  emissora ? ` A empresa emissora passou para ${emissora.para}, o CNPJ da nota.` : ""
                }`,
            );
            router.refresh();
          }}
        />
        <ConfirmDialog
          open={excluindo !== null}
          onOpenChange={(o) => !o && setExcluindo(null)}
          title="Excluir a PP a emitir?"
          description={
            <>
              {excluindo ? contraparte(excluindo) : ""} ·{" "}
              <strong className="text-foreground">{formatCurrency(excluindo?.valor ?? 0, moeda)}</strong>. Some do item;
              nada foi gerado nem enviado.
            </>
          }
          confirmLabel="Excluir"
          cancelLabel="Voltar"
          variant="destructive"
          pending={pending}
          onConfirm={excluir}
        />
        <ConfirmDialog
          open={refazendo !== null}
          onOpenChange={(o) => !o && setRefazendo(null)}
          title={`Editar e reemitir a ${refazendo?.codigo ?? "PP"}?`}
          description={<TextoDoReemitir codigo={refazendo?.codigo ?? "PP"} />}
          confirmLabel="Editar e Reemitir PP"
          cancelLabel="Voltar"
          variant="primary"
          pending={pending}
          onConfirm={refazer}
        />

        <ConfirmDialog
          open={cancelando !== null}
          onOpenChange={(o) => !o && setCancelando(null)}
          title="Cancelar Pedido de Produção?"
          description={
            <>
              <strong className="text-foreground">{cancelando?.codigo}</strong>{" "}
              será cancelada. O PDF ganha o selo de cancelada e fica no histórico, com os anexos.
              {cancelando && cancelando.status !== "gerada" && (
                <>
                  {" "}
                  Ela já está no financeiro: cancelar a tira da fila de
                  avaliação e ela deixa de contar no realizado do item.
                </>
              )}
            </>
          }
          confirmLabel="Cancelar PP"
          cancelLabel="Voltar"
          variant="destructive"
          pending={pending}
          onConfirm={cancelar}
        />
      </DrawerContent>
    </Dialog>
  );
}

/** Por que esta PP não pode mais ser cancelada — o mesmo texto que
 *  `cancelarPedidoCompra` devolveria se alguém insistisse. */
function motivoSemCancelar(status: PPStatus): string {
  switch (status) {
    case "aprovada":
      return "PP já aprovada pelo financeiro — é título a pagar. Para cancelar, fale com o financeiro.";
    case "pago":
      return "PP já paga — cancelar exigiria estorno pelo financeiro.";
    case "cancelada":
      return "PP já está cancelada.";
    default:
      return "Esta PP não pode mais ser cancelada.";
  }
}

function BotaoIcone({
  titulo,
  rotulo,
  onClick,
  disabled,
  children,
}: {
  /** O `title` — vira a explicação inteira quando o botão está apagado. */
  titulo: string;
  /** O nome curto para o leitor de tela, quando o `title` é uma frase. */
  rotulo?: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={titulo}
      aria-label={rotulo ?? titulo}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-[29px] w-[29px] flex-none items-center justify-center rounded-[9px] border border-border bg-card text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function FichaNumero({
  rotulo,
  valor,
  conta,
  corValor,
  className,
}: {
  rotulo: string;
  valor: string;
  /** A linha de baixo: a conta do planejado, ou quantas PPs o item tem. */
  conta: string;
  corValor?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1 px-4 py-3.5", className)}>
      <span className="text-[9.5px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
        {rotulo}
      </span>
      <span className={cn("font-mono text-[15px] font-bold", corValor)}>
        {valor}
      </span>
      <span className="font-mono text-[11px] text-muted-foreground">{conta}</span>
    </div>
  );
}

/** QT e D/M são fatores, não dinheiro: sem R$ e sem zeros à toa. */
function formatarFator(n: number): string {
  return Number(n ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

/**
 * Uma PP no painel, em duas linhas (decisão 112). Em cima: código,
 * fornecedor e `direita` (a situação, ou o botão de enviar). Embaixo: o
 * trio e o total da PP, com os `botoes` na mesma linha. `aviso` (NF que
 * falta, prestação de contas) entra numa terceira linha, só quando existe.
 *
 * As larguras das colunas são fixas de propósito: num item com muitas
 * PPs, os valores de uma ficam embaixo dos da outra, como numa tabela.
 */
function CartaoPP({
  pp,
  moeda,
  direita,
  botoes,
  aviso,
  codigo,
}: {
  pp: PPDoItem;
  moeda: string;
  direita: React.ReactNode;
  botoes: React.ReactNode;
  aviso: React.ReactNode;
  /** No lugar do código: o selo da PP a emitir (decisão 153). */
  codigo?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border px-3.5 py-2.5">
      <div className="flex min-h-[26px] items-center gap-2.5">
        {codigo ?? (
          <span className="font-mono text-[11px] font-semibold text-muted-foreground">
            {pp.codigo}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">
          {pp.fornecedorNome}
        </span>
        {direita}
      </div>
      <div className="grid grid-cols-[100px_30px_34px_104px_minmax(0,1fr)_auto] items-end gap-x-2.5">
        <ValorDoTrio rotulo="R$ Unit.">
          {formatCurrency(pp.valorUnitario, moeda)}
        </ValorDoTrio>
        <ValorDoTrio rotulo="QT">{formatarFator(pp.quantidade)}</ValorDoTrio>
        <ValorDoTrio rotulo="D/M">{formatarFator(pp.diasMeses)}</ValorDoTrio>
        <ValorDoTrio rotulo="Total" forte>
          {formatCurrency(pp.valor, moeda)}
        </ValorDoTrio>
        <span />
        <span className="inline-flex items-center gap-1.5">{botoes}</span>
      </div>
      {aviso}
    </div>
  );
}

/** A verba enviada ao financeiro: o cartão mostra a prestação (decisão
 *  189). O reembolso não presta contas (decisão 187). */
function verbaComPrestacao(pp: PPDoItem): boolean {
  // Decisão 216: a PP que foi sem NF mostra a prestação da nota, no mesmo
  // lugar e com o mesmo botão.
  if (pp.situacaoMidia !== null) return true;
  return (
    pp.verbaProducao &&
    pp.reembolsoTipo === null &&
    (pp.status === "em_avaliacao" || pp.status === "aprovada" || pp.status === "pago")
  );
}

/**
 * A prestação no cartão da verba (decisão 189): a barra do comprovado, uma
 * linha com onde ela está e o botão que abre a gaveta — a mesma da aba de
 * PPs. Antes daqui, o cartão só dizia "Preste contas na aba de PPs".
 */
function PrestacaoNoCartao({
  pp,
  onAbrir,
}: {
  pp: PPDoItem;
  onAbrir: ((pp: PPDoItem) => void) | null;
}) {
  const pr = pp.prestacao;
  const docs = pr?.documentos ?? [];
  const n = docs.length;
  const qtd = n === 1 ? "1 documento" : `${n} documentos`;
  const comprovado = somaComprovadaEmCentavos(docs) / 100;
  const age =
    onAbrir !== null &&
    pp.podePrestarContas &&
    (midiaAguardaProducao(pp.situacaoMidia) ||
      producaoEditaPrestacao({
        verba_producao: pp.verbaProducao,
        tipo_verba: pp.reembolsoTipo ? "reembolso" : null,
        status: pp.status,
        prestacao: pr,
      }));
  const linha =
    pp.situacaoVerba === "concluida"
      ? "Prestação concluída."
      : pp.situacaoVerba === "devolucao_pendente"
        ? `Aprovada · estorno de ${formatCurrency(pp.devolucao?.valor ?? 0, "BRL")} a receber pelo financeiro.`
        : pr?.status === "em_avaliacao"
          ? n === 0
            ? "Sem gasto · com o financeiro."
            : `${qtd} · com o financeiro.`
          : pr?.status === "reprovada"
            ? "Reprovada pelo financeiro · corrija e reenvie."
            : n === 0
              ? pp.status === "pago"
                ? "Nenhum documento ainda."
                : "Já dá para juntar os documentos."
              : pp.status === "pago"
                ? `${qtd} salvo${n === 1 ? "" : "s"}, a enviar.`
                : `${n === 1 ? "1 salvo" : `${n} salvos`} · envio após pagar.`;
  // Decisão 216: a PP que foi sem NF não espera o pagamento para mandar a
  // nota, e na auditoria ainda não há o que mandar.
  const linhaMidia =
    pp.situacaoMidia === null
      ? null
      : pp.situacaoMidia === "sem_nf"
        ? "Foi sem NF · a nota entra depois da liberação."
        : pp.situacaoMidia === "aprovada"
          ? "NF conferida pelo financeiro."
          : pr?.status === "em_avaliacao"
            ? `${qtd} · com o financeiro.`
            : pr?.status === "reprovada"
              ? "Reprovada pelo financeiro · corrija e reenvie."
              : n === 0
                ? "Foi sem NF · anexe a nota do fornecedor."
                : `${qtd} salvo${n === 1 ? "" : "s"}, a enviar.`;
  const verBotao = onAbrir !== null && !age && pr !== null && pr.status !== "rascunho";
  return (
    <span className="flex flex-col gap-2">
      {n > 0 && (
        <BarraDoComprovado
          status={pr?.status ?? null}
          comprovado={comprovado}
          verba={pp.valor}
          devolucao={pp.devolucao}
          semSaldo={pp.situacaoMidia !== null}
          compacta
        />
      )}
      <span className="flex items-center gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] leading-snug text-muted-foreground">
          <Info className="h-3 w-3 flex-none" />
          <span className="truncate" title={linhaMidia ?? linha}>
            {linhaMidia ?? linha}
          </span>
        </span>
        <span className="flex-1" />
        {(age || verBotao) && onAbrir && (
          <button
            type="button"
            onClick={() => onAbrir(pp)}
            className={cn(
              "inline-flex w-fit flex-none items-center gap-1.5 rounded-[9px] border px-2.5 py-1 text-[11px] font-bold transition-colors",
              age
                ? "border-california-red bg-california-red text-white hover:bg-california-red-hover"
                : "border-border bg-white text-foreground hover:border-california-red/40 hover:text-california-red",
            )}
          >
            <FileText className="h-3 w-3" />
            {age ? rotuloDoBotaoDaPrestacao({ prestacao: pr }) : "Ver prestação"}
          </button>
        )}
      </span>
    </span>
  );
}

function ValorDoTrio({
  rotulo,
  forte,
  children,
}: {
  rotulo: string;
  forte?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span className="flex min-w-0 flex-col items-end leading-tight">
      <span className="text-[9px] font-bold uppercase tracking-[0.07em] text-muted-foreground">
        {rotulo}
      </span>
      <span
        className={cn(
          "mt-0.5 whitespace-nowrap font-mono",
          forte ? "text-[12.5px] font-bold" : "text-[12px]",
        )}
      >
        {children}
      </span>
    </span>
  );
}
