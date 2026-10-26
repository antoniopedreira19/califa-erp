"use client";

/**
 * Modal único de baixa da aba "Títulos a Pagar" (Tela 3.2) — serve as
 * três origens: parcela de PP, lançamento avulso e ocorrência de
 * recorrência.
 *
 * Duas decisões do Tiago moram aqui:
 *
 * 1. **Centro de custo é o plano de contas.** O protótipo pede "centro de
 *    custo do pagamento" obrigatório; no banco isso é o par Tipo +
 *    Subtipo que a baixa já exigia — a legenda do próprio protótipo diz
 *    "define onde o custo entra no DRE". Vem sugerido quando a origem já
 *    tem plano (avulsa/recorrência) e é editável.
 * 2. **Nenhuma conta bancária padrão.** A conta é escolhida na mão em
 *    toda baixa, de propósito. A exceção é quem abre a baixa já sabendo a
 *    conta: a aba Títulos da conciliação (pedido do Tiago em 02/10/2026)
 *    manda a conta em tela em `contaInicial`, e ela vem escolhida — e
 *    trocável.
 *
 * Decisão 125 (29/09/2026): o valor sai do quadro do topo e vira o bloco
 * "Valor a dar baixa" (`BlocoValorDaBaixa`, o mesmo de Títulos a Receber),
 * com a baixa parcial e a retenção na fonte. Parcial e retenção valem para
 * PP, avulso e recorrência; o cartão, a folha, a PP de verba, o desembolso,
 * a fatura, a devolução de verba e o que foi para uma remessa só aceitam o
 * valor inteiro. O formulário é um filho com `key` do título: o estado
 * recomeça a cada título (antes o efeito de abertura rodava a cada
 * renderização da tela, porque o `alvo` é remontado sempre).
 *
 * Módulo fiscal (entrega 2, 02/10/2026): na parcela de PP com a NF do
 * fornecedor registrada na aprovação, o aviso genérico dos impostos retidos
 * dá lugar ao bloco "No fiscal" (`components/financeiro/no-fiscal.tsx`):
 * as guias que a baixa faz nascer na Apuração, refeitas pela data e pelos
 * retidos do formulário.
 *
 * Decisões 196 e 197 (task 029, 21/10/2026), o protótipo "Conciliação com o
 * banco", versão Alternativa:
 * - a forma abre SEMPRE em PIX, a mais comum: nem a forma do título nem a
 *   da aprovação pré-preenchem. A exceção é a baixa aberta por uma linha do
 *   banco (`linhaDoBanco`, fase 3), em que o histórico diz a forma;
 * - o resumo do topo traz as três datas com os nomes certos: Vencimento (do
 *   documento, nunca muda) e Data prevista; a Data do pagamento é o campo;
 * - "+ Juros e multa" só no boleto (o banco cobra o atraso no próprio
 *   pagamento), com a dica do atraso contado do primeiro dia útil. Os juros
 *   vão num lançamento à parte, em 11 · Despesa com Juros, e não quitam o
 *   título;
 * - no cartão, o campo Fatura: vem a da data do pagamento, e dá para trocar
 *   por outra aberta ou por uma nova; fechada não recebe item.
 */

import * as React from "react";
import { format } from "date-fns";
import { AlertCircle, ArrowRightLeft, CreditCard, Info, Landmark, Plus } from "lucide-react";
import Link from "next/link";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { Combobox, COMBOBOX_COMO_SELECT } from "@/components/ui/combobox";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { MoneyInput } from "@/components/ui/money-input";
import {
  bandeiraCartaoLabel,
  formaPagamentoLabel,
  type ContaBancaria,
  type FormaPagamento,
  type ImpostoRetido,
  type PagamentoForaDoCadastroDaPP,
  type PedidoForaDoCadastro,
  type PlanoContaTipo,
  type PlanoContaSubtipo,
  type RetencaoDaBaixa,
} from "@/lib/types";
import { cn, formatCurrency } from "@/lib/utils";
import { atrasoDoPagamento, textoDoAtraso } from "@/lib/financeiro/atraso-do-pagamento";
import {
  competenciaParaOBanco,
  faturaDestino,
  opcoesDeFatura,
  rotuloDaCompetencia,
  type FaturaDoCartaoNaBaixa,
} from "@/lib/financeiro/fatura-do-cartao";
import { PagamentoForaDoCadastroCartao } from "@/components/financeiro/pagamento-fora-do-cadastro";
import {
  BlocoValorDaBaixa,
  useValorDaBaixa,
  type UltimaRetencao,
} from "@/components/financeiro/valor-da-baixa";
import {
  BUSCANDO_RETENCAO_DA_APROVACAO,
  useRetencaoDaAprovacao,
} from "@/components/financeiro/retencao-da-aprovacao";
import { parcelaDePPDaChave, type RetencaoDaAprovacao } from "@/lib/fiscal/retencao-da-aprovacao";
import { NoFiscalDoPagamento, useFiscalDaParcela } from "@/components/financeiro/no-fiscal";
import type { CartaoOption } from "@/components/financeiro/forma-pagamento-field";
import { AvisoDoPeriodoFechado, erroDoPeriodoFechado, usePeriodoFechado } from "@/components/financeiro/periodo-fechado";

export interface BaixaTituloAlvo {
  /** Identifica o título e as baixas dele: o formulário recomeça quando
   *  ela muda (o objeto `alvo` é remontado a cada renderização).
   *
   *  Formato `${origem}-${id}-${nº de baixas}`, como a lista de Títulos a
   *  Pagar a monta: na parcela de PP (`pp-<id da parcela>-<n>`) é dela que
   *  a baixa tira a parcela para buscar as retenções da aprovação
   *  (módulo fiscal). Quem montar o `alvo` de uma parcela de PP em outra
   *  tela segue o mesmo formato. */
  chave: string;
  titulo: string;
  origem: string;
  parcela: string;
  /** O vencimento do documento: nunca muda (decisão 196). */
  vencimento: string | null;
  /** A data prevista do pagamento, a que o lápis repactua. */
  dataPrevista: string | null;
  /** O valor do título inteiro. */
  valor: number;
  /** O que falta pagar: o valor menos as baixas já feitas (decisão 125). */
  aberto: number;
  /** O fim da frase "Restam R$ X a pagar…". `null` fecha no ponto. */
  restoTexto: string | null;
  /** Por que esta origem só aceita o valor inteiro. `null` aceita a baixa
   *  parcial (o cartão ainda a desliga na hora, pela forma escolhida). */
  motivoSemParcial: string | null;
  /** A chave de retenção: some onde não há serviço de fornecedor, e fica
   *  desligada, com o motivo, no que foi para uma remessa (D15). */
  retencao: { mostra: false } | { mostra: true; motivo: string | null };
  /** A última retenção do mesmo fornecedor, para o "Repetir as alíquotas". */
  ultimaRetencao: UltimaRetencao | null;
  /** "+ Juros e multa" (decisão 196): PP, avulso e recorrência. O link só
   *  aparece com a forma boleto. */
  aceitaJuros: boolean;
  empresaId: string;
  planoContaTipoId: string | null;
  planoContaSubtipoId: string | null;
  /** Decisão 137: a PP de origem paga por outra chave ou conta. A baixa
   *  mostra para onde mandar o dinheiro e quem pediu. Null em toda outra
   *  origem e na PP paga pelo cadastro. */
  foraDoCadastro: {
    pagamento: PagamentoForaDoCadastroDaPP;
    pedido: PedidoForaDoCadastro | null;
  } | null;
  /**
   * `true` quando o título é uma devolução de verba de produção. Nesse
   * caso: (a) o campo Forma de pagamento é escondido — a RPC de baixa da
   * devolução não recebe forma; (b) o header do dialog troca para "Baixar
   * devolução" e o rótulo "Data em que o dinheiro voltou". Nem forma nem
   * cartão são coletados.
   */
  isDevolucao?: boolean;
  /**
   * `true` quando o cartão não entra como forma: na fatura de cartão (não
   * se paga cartão com cartão, e o banco recusa — 28/08/2026) e no título
   * que já tem baixa parcial (o restante não vai para a fatura).
   */
  semCartao?: boolean;
}

/**
 * A linha do extrato do banco que abriu a baixa (decisão 196; quem a manda
 * é a conciliação, na fase 3). A data, a conta e o valor vêm dela; a forma
 * vem do histórico. Sem ela, a baixa é a de sempre.
 */
export interface LinhaDoBancoNaBaixa {
  data: string;
  /** O valor que saiu do banco, positivo. */
  valor: number;
  /** A forma que o histórico do banco diz ("PAGFOR PIX" é PIX, "PAGAMENTO
   *  DE TITULO" e concessionária são boleto, "TED" é transferência). */
  forma: Exclude<FormaPagamento, "cartao_credito"> | null;
  /** O arquivo do extrato, para a nota do topo. */
  arquivo: string;
  /** O banco pagou menos que o título e nenhuma retenção explica: a baixa
   *  abre parcial com este valor (decisão 200). */
  parcial?: number | null;
  /** A retenção na fonte que explica o banco ter menos (o passo 3b do
   *  motor): a baixa abre com estas alíquotas, editáveis. */
  retencao?: Partial<Record<ImpostoRetido, number>> | null;
}

export interface BaixaTituloPayload {
  pago_em: string;
  /** `null` quando a forma é cartão: o item entra na fatura, e nada
   *  sai de conta bancária nenhuma (decisão 093). */
  conta_bancaria_id: string | null;
  plano_conta_tipo_id: string;
  plano_conta_subtipo_id: string;
  /** `null` quando `alvo.isDevolucao` — a RPC de devolução não usa. */
  forma_pagamento: FormaPagamento | null;
  cartao_credito_id: string | null;
  /** O valor a dar baixa: líquido + retidos (decisão 125). */
  valor_baixa: number;
  retencoes: RetencaoDaBaixa[];
  /** Juros e multa (decisão 196): saem da conta junto, mas num lançamento
   *  à parte, que não quita o título. Zero sem juros. */
  juros: number;
  /** A fatura escolhida no cartão (decisão 197): o dia 1 da competência.
   *  Nula fora do cartão. */
  fatura_competencia: string | null;
}

const MOTIVO_CARTAO = "No cartão, a baixa é sempre do valor inteiro: o item entra inteiro na fatura.";

const FORMAS_DA_CONTA: Exclude<FormaPagamento, "cartao_credito">[] = ["pix", "transferencia", "boleto"];

export function BaixaTituloDialog({
  open,
  onOpenChange,
  alvo,
  contas,
  tipos,
  subtipos,
  cartoes,
  faturas,
  cartaoPlanejadoId,
  pending,
  erro,
  onConfirm,
  contaInicial,
  linhaDoBanco = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  alvo: BaixaTituloAlvo | null;
  contas: ContaBancaria[];
  tipos: PlanoContaTipo[];
  subtipos: PlanoContaSubtipo[];
  /** Cartões de crédito disponíveis para a forma "Cartão de crédito". */
  cartoes: CartaoOption[];
  /** As faturas recentes dos cartões, de todo status: o campo Fatura usa as
   *  abertas e pula a competência que já fechou (decisão 197). */
  faturas: FaturaDoCartaoNaBaixa[];
  /** O cartão que vem escolhido quando a forma vira cartão (o previsto). */
  cartaoPlanejadoId?: string | null;
  pending: boolean;
  erro: string | null;
  onConfirm: (payload: BaixaTituloPayload) => void;
  /**
   * A conta que já vem escolhida (o `id`): a aba Títulos da conciliação
   * manda a conta em tela. Sem ela — ou com uma conta que não está entre
   * as ativas de `contas` —, a conta abre em branco, como sempre.
   */
  contaInicial?: string;
  /** A linha do banco que abriu a baixa (fase 3). */
  linhaDoBanco?: LinhaDoBancoNaBaixa | null;
}) {
  if (!alvo) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-emerald-600" />
            {alvo.isDevolucao ? "Baixar estorno de verba" : "Dar baixa no pagamento"}
          </DialogTitle>
        </DialogHeader>
        <FormularioDaBaixa
          key={alvo.chave}
          alvo={alvo}
          contas={contas}
          tipos={tipos}
          subtipos={subtipos}
          cartoes={cartoes}
          faturas={faturas}
          // O cartão só vem sugerido onde ele cabe.
          cartaoPlanejadoId={alvo.semCartao ? null : cartaoPlanejadoId ?? null}
          pending={pending}
          erro={erro}
          onCancelar={() => onOpenChange(false)}
          onConfirm={onConfirm}
          contaInicial={contaInicial ?? null}
          linhaDoBanco={linhaDoBanco}
        />
      </DialogContent>
    </Dialog>
  );
}

function FormularioDaBaixa({
  alvo,
  contas,
  tipos,
  subtipos,
  cartoes,
  faturas,
  cartaoPlanejadoId,
  pending,
  erro,
  onCancelar,
  onConfirm,
  contaInicial,
  linhaDoBanco,
}: {
  alvo: BaixaTituloAlvo;
  contas: ContaBancaria[];
  tipos: PlanoContaTipo[];
  subtipos: PlanoContaSubtipo[];
  cartoes: CartaoOption[];
  faturas: FaturaDoCartaoNaBaixa[];
  cartaoPlanejadoId: string | null;
  pending: boolean;
  erro: string | null;
  onCancelar: () => void;
  onConfirm: (payload: BaixaTituloPayload) => void;
  /** A conta que abre escolhida; `null` abre em branco. */
  contaInicial: string | null;
  linhaDoBanco: LinhaDoBancoNaBaixa | null;
}) {
  // Ao abrir: hoje como data (ou a da linha do banco), conta em branco (sem
  // padrão, por decisão — salvo a `contaInicial` de quem já sabe a conta, se
  // ela for ativa), centro de custo sugerido pela origem quando existe, e a
  // forma em PIX (decisão 196).
  const [erroLocal, setErroLocal] = React.useState<string | null>(null);
  const [pagoEm, setPagoEm] = React.useState(linhaDoBanco?.data ?? format(new Date(), "yyyy-MM-dd"));
  const [contaId, setContaId] = React.useState(() =>
    contaInicial && contas.some((c) => c.id === contaInicial && c.ativo)
      ? contaInicial
      : "",
  );
  const [tipoId, setTipoId] = React.useState(alvo.planoContaTipoId ?? "");
  const [subtipoId, setSubtipoId] = React.useState(alvo.planoContaSubtipoId ?? "");
  const [forma, setForma] = React.useState<FormaPagamento | null>(
    alvo.isDevolucao ? null : linhaDoBanco?.forma ?? "pix",
  );
  const [cartaoId, setCartaoId] = React.useState<string | null>(null);
  // A competência escolhida no campo Fatura; `null` segue a da data.
  const [competenciaEscolhida, setCompetenciaEscolhida] = React.useState<string | null>(null);
  // Juros e multa (decisão 196). A linha do banco que pagou mais que o título
  // abre com a diferença.
  const jurosDoBanco =
    linhaDoBanco && alvo.aceitaJuros
      ? Math.max(0, Math.round((linhaDoBanco.valor - alvo.aberto) * 100) / 100)
      : 0;
  const [comJuros, setComJuros] = React.useState(jurosDoBanco > 0.004);
  const [juros, setJuros] = React.useState<number | null>(jurosDoBanco > 0.004 ? jurosDoBanco : null);
  // Módulo fiscal (02/10/2026): na parcela de PP, a baixa abre com as
  // retenções que o financeiro informou na APROVAÇÃO — chave ligada,
  // alíquotas editáveis e a ajuda "Retenções informadas na aprovação da PP
  // (data) · editáveis". Buscadas ao abrir, pela parcela da `chave`; só com
  // a retenção liberada (não na que foi para remessa). Sem alíquota
  // gravada, a baixa abre como antes.
  const aprovacao = useRetencaoDaAprovacao(
    alvo.retencao.mostra && alvo.retencao.motivo === null
      ? parcelaDePPDaChave(alvo.chave)
      : null,
  );
  // A retenção que o motor sugeriu pela linha do banco (só para título sem
  // retenção na aprovação: as duas nunca chegam juntas).
  const retencaoDaLinha = React.useMemo<RetencaoDaAprovacao | null>(
    () => (linhaDoBanco?.retencao ? { data: null, aliquotas: linhaDoBanco.retencao, remessa: null } : null),
    [linhaDoBanco?.retencao],
  );
  const v = useValorDaBaixa(
    alvo.aberto,
    alvo.ultimaRetencao,
    aprovacao.retencao ?? retencaoDaLinha,
    linhaDoBanco?.parcial ?? null,
  );
  // Módulo fiscal (entrega 2): o bloco "No fiscal" — as guias que esta baixa
  // faz nascer na Apuração. A NF da PP é lida ao abrir, DEPOIS das retenções
  // da aprovação (as Server Actions vão uma de cada vez, e é aquela leitura
  // que trava o Confirmar).
  const fiscal = useFiscalDaParcela(parcelaDePPDaChave(alvo.chave));

  /**
   * Toda conta ativa entra, de qualquer empresa (decisão do Tiago em
   * 29/08/2026): "as contas em si não são específicas de uma empresa".
   * A empresa é do DOCUMENTO — ela continua vindo do título e sendo
   * gravada no lançamento. A conta é só o cano por onde o dinheiro passa.
   *
   * O banco já era assim desde a migration
   * `20260829100001_a_trava_de_empresa_sai_das_seis_ultimas`; aqui a
   * trava tinha ficado para trás, e escondia a conta recém-cadastrada sem
   * dizer por quê (09/09/2026).
   */
  const contasAtivas = contas.filter((c) => c.ativo);
  const tiposAtivos = tipos.filter((t) => t.ativo);
  const subtiposDoTipo = tipoId
    ? subtipos.filter((s) => s.tipo_id === tipoId && s.ativo)
    : [];

  function handleTipo(next: string) {
    setTipoId(next);
    // Trocar o tipo invalida o subtipo — o banco recusa o par incoerente.
    setSubtipoId((atual) =>
      subtipos.find((s) => s.id === atual)?.tipo_id === next ? atual : "",
    );
  }

  function handleForma(nova: FormaPagamento) {
    setForma(nova);
    setErroLocal(null);
    if (nova === "cartao_credito" && !cartaoId) {
      // O cartão previsto vem escolhido; com um cartão só, ele.
      const sugerido =
        cartoes.find((c) => c.id === cartaoPlanejadoId)?.id ?? (cartoes.length === 1 ? cartoes[0].id : null);
      setCartaoId(sugerido);
      setCompetenciaEscolhida(null);
    }
  }

  const noCartao = forma === "cartao_credito";
  const cartaoEscolhido = noCartao ? cartoes.find((c) => c.id === cartaoId) ?? null : null;
  const cartaoDaFatura = cartaoEscolhido
    ? {
        id: cartaoEscolhido.id,
        dia_vencimento_fatura: cartaoEscolhido.dia_vencimento_fatura,
        dia_fechamento_fatura: cartaoEscolhido.dia_fechamento_fatura ?? null,
      }
    : null;
  // A fatura da data do pagamento, as que dá para escolher e a escolhida
  // (decisão 197).
  const destino = cartaoDaFatura && pagoEm ? faturaDestino(cartaoDaFatura, pagoEm, faturas) : null;
  const opcoesFatura = cartaoDaFatura ? opcoesDeFatura(cartaoDaFatura, faturas, destino) : [];
  const faturaAlvo =
    opcoesFatura.find((o) => o.competencia === competenciaEscolhida) ??
    opcoesFatura.find((o) => o.padrao) ??
    destino;
  const foraDaData = !!faturaAlvo && !!destino && faturaAlvo.competencia !== destino.competencia;

  // Juros e multa só onde o atraso é cobrado no próprio pagamento: o
  // boleto (o banco calcula os encargos na hora). No PIX e na TED o valor é
  // o que a agência manda; a fatura do cartão e a conta de consumo cobram o
  // atraso na seguinte. A exceção é a linha do banco que pagou mais.
  const jurosDisponivel = alvo.aceitaJuros && !noCartao && (jurosDoBanco > 0.004 || forma === "boleto");
  const atraso = atrasoDoPagamento(pagoEm, alvo.vencimento);
  const jurosDaBaixa = jurosDisponivel && comJuros ? Math.round((juros ?? 0) * 100) / 100 : 0;

  // O cartão desliga a parcial e a retenção na hora (decisão 125).
  const motivoSemParcial = noCartao ? MOTIVO_CARTAO : alvo.motivoSemParcial;
  // Módulo fiscal: enquanto as retenções da aprovação não chegam, a chave
  // fica travada, com o "Buscando…" no lugar da ajuda.
  const retencao: BaixaTituloAlvo["retencao"] = noCartao
    ? { mostra: false }
    : aprovacao.buscando
      ? { mostra: true, motivo: BUSCANDO_RETENCAO_DA_APROVACAO }
      : alvo.retencao;
  const retencaoLiberada = retencao.mostra && retencao.motivo === null;
  // O bloco "No fiscal" ocupa o lugar do aviso genérico (e, enquanto a NF
  // da PP é buscada, o aviso espera, para não piscar).
  const blocoNoFiscal =
    fiscal.estado === "buscando" || (fiscal.estado === "pronto" && fiscal.fiscal !== null);
  React.useEffect(() => {
    if (motivoSemParcial !== null && v.parcial) v.setParcial(false);
    if (!retencaoLiberada && v.retem) v.setRetem(false);
    // `v` muda a cada renderização; o que decide é a regra.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motivoSemParcial, retencaoLiberada, v.parcial, v.retem]);

  // Aberta por uma linha do banco, a baixa só concilia quando o que sai da
  // conta (o líquido mais os juros) bate com ela.
  const saiDaConta = Math.round((v.liquido + jurosDaBaixa) * 100) / 100;
  const naoBate = !!linhaDoBanco && !noCartao && Math.abs(saiDaConta - linhaDoBanco.valor) > 0.004;
  const dataDiferenteDoBanco = !!linhaDoBanco && !!pagoEm && pagoEm !== linhaDoBanco.data;
  // O fechamento da conciliação (decisão 205): no cartão nada sai da conta
  // agora, e a trava não vale.
  const fechadoAte = usePeriodoFechado(noCartao ? null : contaId, pagoEm);

  function handleSubmit() {
    setErroLocal(null);
    // O período fechado vem antes de tudo (protótipo, `confirmar`).
    if (fechadoAte) {
      setErroLocal(erroDoPeriodoFechado(fechadoAte));
      return;
    }
    // Módulo fiscal: a parcela não sai sem a retenção que a aprovação da PP
    // decidiu — espera a busca voltar.
    if (aprovacao.buscando) {
      setErroLocal("Aguarde: buscando as retenções informadas na aprovação da PP.");
      return;
    }
    if (!pagoEm || (!noCartao && !contaId)) {
      setErroLocal(
        noCartao
          ? "Informe a data do pagamento."
          : "Informe a data e a conta que realizará o pagamento.",
      );
      return;
    }
    // Devolução de verba: RPC não recebe forma, então não coletamos nem
    // validamos.
    const isDevolucao = alvo.isDevolucao === true;
    if (!isDevolucao) {
      if (!forma) {
        setErroLocal("Selecione a forma de pagamento.");
        return;
      }
      if (noCartao && !cartaoId) {
        setErroLocal("Selecione o cartão de crédito.");
        return;
      }
      if (noCartao && !faturaAlvo) {
        setErroLocal("Escolha a fatura em que o item entra.");
        return;
      }
    }
    if (!tipoId || !subtipoId) {
      setErroLocal("Selecione o centro de custo do pagamento.");
      return;
    }
    const erroDoValor = v.erro();
    if (erroDoValor) {
      setErroLocal(erroDoValor);
      return;
    }
    if (naoBate && linhaDoBanco) {
      setErroLocal(
        `A baixa soma ${formatCurrency(saiDaConta, "BRL")} e a linha do banco é de ${formatCurrency(linhaDoBanco.valor, "BRL")}: ajuste o valor ou escolha outro título.`,
      );
      return;
    }
    onConfirm({
      pago_em: pagoEm,
      conta_bancaria_id: noCartao ? null : contaId,
      plano_conta_tipo_id: tipoId,
      plano_conta_subtipo_id: subtipoId,
      forma_pagamento: isDevolucao ? null : forma,
      cartao_credito_id: isDevolucao || !noCartao ? null : cartaoId,
      valor_baixa: v.valor,
      retencoes: v.retencoes(),
      juros: jurosDaBaixa,
      fatura_competencia: noCartao && faturaAlvo ? competenciaParaOBanco(faturaAlvo.competencia) : null,
    });
  }

  const mensagemErro = erro ?? erroLocal;
  const baixaParcial = v.parcial && v.resta > 0.004;
  const formas: FormaPagamento[] = alvo.semCartao ? FORMAS_DA_CONTA : [...FORMAS_DA_CONTA, "cartao_credito"];

  return (
    <>
      {linhaDoBanco && (
        <Nota tom="verde" icone={<Landmark className="mt-0.5 h-3.5 w-3.5 shrink-0" />}>
          Aberto pela conciliação com o banco: a data, a conta e o valor vêm do extrato ({linhaDoBanco.arquivo}).
          {linhaDoBanco.retencao
            ? " O banco pagou menos que o título, e a diferença bate com retenção na fonte: a baixa abre com ela, editável."
            : linhaDoBanco.parcial
              ? " O banco pagou menos que o título: a baixa abre parcial, com o valor do banco."
              : ""}{" "}
          Confira e confirme.
        </Nota>
      )}
      {naoBate && linhaDoBanco && (
        <Nota tom="vermelho">
          A baixa soma {formatCurrency(saiDaConta, "BRL")} e a linha do banco é de{" "}
          {formatCurrency(linhaDoBanco.valor, "BRL")}. Ela só concilia quando os dois baterem.
        </Nota>
      )}
      {fechadoAte && (
        <AvisoDoPeriodoFechado ate={fechadoAte} contaNome={contas.find((c) => c.id === contaId)?.nome ?? null} />
      )}
      {dataDiferenteDoBanco && linhaDoBanco && (
        <Nota tom="ambar">
          A data é diferente da do banco ({formatarData(linhaDoBanco.data)}). A baixa vale, mas o Extrato do
          sistema não bate com o do banco nesse dia: use a data do banco, a não ser que ele esteja errado.
        </Nota>
      )}

      <div className="grid grid-cols-[max-content_1fr_max-content_1fr] gap-x-4 gap-y-1.5 rounded-xl border border-border bg-muted/40 p-4 text-[13px]">
        <span className="text-muted-foreground">Título</span>
        <span className="font-semibold">{alvo.titulo}</span>
        <span className="text-muted-foreground">Origem</span>
        <span>
          {alvo.origem} · <span className="font-mono text-xs">{alvo.parcela}</span>
        </span>
        <span className="text-muted-foreground">Vencimento</span>
        <span className="font-mono text-xs">
          {alvo.vencimento ? formatarData(alvo.vencimento) : "—"}
        </span>
        <span className="text-muted-foreground">Data prevista</span>
        <span className="font-mono text-xs">
          {alvo.dataPrevista ? formatarData(alvo.dataPrevista) : "—"}
        </span>
      </div>

      {alvo.foraDoCadastro && (
        <PagamentoForaDoCadastroCartao
          pagamento={alvo.foraDoCadastro.pagamento}
          pedido={alvo.foraDoCadastro.pedido}
          rotulo="Pagar fora do cadastro"
        />
      )}

      {mensagemErro && (
        <div className="flex items-start gap-2 rounded-lg border border-california-red/40 bg-california-red/5 p-3 text-sm text-california-red">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{mensagemErro}</span>
        </div>
      )}

      <div className="space-y-3">
        <div className="grid grid-cols-2 items-start gap-3">
          <Campo
            rotulo={alvo.isDevolucao ? "Data em que o dinheiro voltou" : "Data do pagamento"}
          >
            <DatePicker
              name="pago_em"
              defaultValue={pagoEm}
              onDateChange={(d) => {
                setPagoEm(d ? format(d, "yyyy-MM-dd") : "");
                setErroLocal(null);
              }}
            />
          </Campo>

          {!noCartao && (
            <Campo
              rotulo={alvo.isDevolucao ? "Conta que receberá o dinheiro" : "Conta que realizará o pagamento"}
            >
              <Select
                value={contaId}
                onValueChange={(valor) => {
                  setContaId(valor);
                  setErroLocal(null);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a conta..." />
                </SelectTrigger>
                <SelectContent>
                  {contasAtivas.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      Nenhuma conta bancária ativa. Cadastre em
                      /financeiro/cadastros/contas-bancarias.
                    </div>
                  ) : (
                    contasAtivas.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.nome} · {c.banco}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </Campo>
          )}

          {!alvo.isDevolucao && (
            <Campo rotulo="Forma de pagamento">
              <Select value={forma ?? undefined} onValueChange={(f) => handleForma(f as FormaPagamento)} disabled={pending}>
                <SelectTrigger aria-required>
                  <SelectValue placeholder="Selecione a forma" />
                </SelectTrigger>
                <SelectContent>
                  {formas.map((f) => (
                    <SelectItem key={f} value={f}>
                      {formaPagamentoLabel(f)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Campo>
          )}

          {noCartao && (
            <Campo rotulo="Cartão">
              {cartoes.length === 0 ? (
                <p className="pt-2 text-xs text-muted-foreground">
                  Nenhum cartão cadastrado.{" "}
                  <Link
                    href="/financeiro/cadastros/cartoes-credito"
                    target="_blank"
                    className="text-california-red underline hover:no-underline"
                  >
                    Cadastrar cartão
                  </Link>
                  .
                </p>
              ) : (
                <Select
                  value={cartaoId ?? undefined}
                  onValueChange={(id) => {
                    setCartaoId(id);
                    setCompetenciaEscolhida(null);
                    setErroLocal(null);
                  }}
                  disabled={pending}
                >
                  <SelectTrigger aria-required>
                    <SelectValue placeholder="Selecione o cartão" />
                  </SelectTrigger>
                  <SelectContent>
                    {cartoes.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.nome} · {bandeiraCartaoLabel(c.bandeira)} · ••••{c.ultimos_4_digitos}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Campo>
          )}

          {noCartao && opcoesFatura.length > 0 && (
            <div className="col-span-2">
              <Campo
                rotulo="Fatura"
                ajuda="Vem pela data do pagamento. Troque se o banco lançou a compra em outra fatura. Fatura fechada não recebe item: reabra-a na aba Cartão."
              >
                <Select
                  value={faturaAlvo?.competencia}
                  onValueChange={(c) => {
                    setCompetenciaEscolhida(c);
                    setErroLocal(null);
                  }}
                  disabled={pending}
                >
                  <SelectTrigger aria-required>
                    <SelectValue placeholder="Selecione a fatura" />
                  </SelectTrigger>
                  <SelectContent>
                    {opcoesFatura.map((o) => (
                      <SelectItem key={o.competencia} value={o.competencia}>
                        {o.existente ? o.existente.codigo : "Nova fatura"} · {rotuloDaCompetencia(o.competencia)} · fecha{" "}
                        {formatarData(o.fecha)} · vence {formatarData(o.vence)}
                        {o.padrao ? " · pela data do pagamento" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Campo>
            </div>
          )}
        </div>

        {noCartao && (
          <Nota tom="violeta" icone={<CreditCard className="mt-0.5 h-3.5 w-3.5 shrink-0" />}>
            {faturaAlvo ? (
              <>
                Entra na fatura {faturaAlvo.existente?.codigo ?? "nova"} de{" "}
                <strong className="font-semibold">{rotuloDaCompetencia(faturaAlvo.competencia)}</strong>
                {" — "}fecha {formatarData(faturaAlvo.fecha)}, vence {formatarData(faturaAlvo.vence)}.{" "}
              </>
            ) : (
              <>Escolha o cartão para ver em qual fatura o item entra. </>
            )}
            Nada sai da conta bancária agora: o dinheiro sai na baixa da fatura.
          </Nota>
        )}
        {foraDaData && destino && (
          <Nota tom="ambar">
            Pela data do pagamento ({formatarData(pagoEm)}), o item cairia na fatura de{" "}
            {rotuloDaCompetencia(destino.competencia)}. Confira na fatura do banco em qual ele veio: é o valor dela
            que o fechamento vai bater.
          </Nota>
        )}

        <BlocoValorDaBaixa
          v={v}
          lado="pagar"
          valorDoTitulo={alvo.valor}
          parcelaRotulo={`Parcela ${alvo.parcela}`}
          restoTexto={alvo.restoTexto}
          parcial={
            motivoSemParcial === null
              ? { aceita: true }
              : { aceita: false, motivo: motivoSemParcial }
          }
          retencao={retencao}
          ajudaDaRetencao={aprovacao.ajuda}
          rodape={
            jurosDisponivel ? (
              comJuros ? (
                <div className="space-y-1 border-t border-border px-4 py-3">
                  <label htmlFor="baixa-juros" className="text-xs font-semibold">
                    Valor dos juros e da multa
                  </label>
                  <div className="flex items-center gap-3">
                    <div className="w-40 shrink-0">
                      <MoneyInput
                        id="baixa-juros"
                        value={juros}
                        onValueChange={setJuros}
                        aria-label="Valor dos juros e da multa"
                        className="h-9 text-right"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setComJuros(false);
                        setJuros(null);
                      }}
                      className="text-[12px] font-semibold text-muted-foreground hover:text-california-red hover:underline"
                    >
                      Remover
                    </button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {atraso.dias > 0 && alvo.vencimento ? (
                      <span className="font-semibold text-california-red">
                        Pago {textoDoAtraso(atraso, alvo.vencimento)}: informe os juros e a multa cobrados, se houver.
                      </span>
                    ) : jurosDoBanco > 0.004 ? (
                      "O banco pagou mais que o título: a diferença entra em 11 · Despesa com Juros."
                    ) : atraso.fimDeSemana && alvo.vencimento && atraso.vencimentoUtil && pagoEm > alvo.vencimento ? (
                      `O vencimento caiu num ${atraso.fimDeSemana} e passou para ${formatarData(atraso.vencimentoUtil)}: pago em dia, sem atraso.`
                    ) : (
                      "Só quando o boleto vier com acréscimo. Entra em 11 · Despesa com Juros."
                    )}
                  </p>
                </div>
              ) : (
                <div className="flex flex-wrap items-baseline gap-x-2.5 border-t border-border px-4 pb-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setComJuros(true)}
                    className="inline-flex items-center gap-1 self-center text-[13px] font-semibold text-california-red hover:underline"
                  >
                    <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
                    Juros e multa
                  </button>
                  {atraso.dias > 0 && (
                    <span className="text-[11.5px] text-muted-foreground">
                      Pago {atraso.dias} {atraso.dias === 1 ? "dia" : "dias"} depois do vencimento
                    </span>
                  )}
                </div>
              )
            ) : null
          }
        />

        {/* Módulo fiscal (entrega 2): na PP com a NF registrada, no lugar do
            aviso genérico, as guias que esta baixa faz nascer — com valor,
            mês e vencimento, refeitas pela data e pelos retidos do
            formulário. No cartão, a baixa não retém nada: o bloco some. */}
        {!noCartao && (
          <NoFiscalDoPagamento
            leitura={fiscal}
            pagoEm={pagoEm}
            retidos={v.retem && retencaoLiberada ? v.valores : null}
          />
        )}

        {/* O aviso genérico continua onde a baixa não chega à Apuração
            (avulso, recorrência, PP sem NF registrada). */}
        {!blocoNoFiscal && v.retem && v.retido > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-[12px] text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Os impostos retidos ficam para a agência recolher (guia do ISS e DARF),
              registrados imposto por imposto para o módulo fiscal.
            </span>
          </div>
        )}

        <div className="space-y-1">
          <label className="text-xs font-semibold">
            Centro de custo do pagamento{" "}
            <span className="text-california-red">*</span>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <Combobox
              items={tiposAtivos.map((t) => ({
                value: t.id,
                label: `${t.codigo} · ${t.nome}`,
              }))}
              value={tipoId || null}
              onChange={(valor) => handleTipo(valor ?? "")}
              placeholder={
                tiposAtivos.length === 0 ? "Nenhum tipo cadastrado" : "Tipo..."
              }
              buscaPlaceholder="Escreva o código ou o nome"
              disabled={tiposAtivos.length === 0}
              className={COMBOBOX_COMO_SELECT}
            />
            <Combobox
              items={subtiposDoTipo.map((s) => ({ value: s.id, label: s.nome }))}
              value={subtipoId || null}
              onChange={(valor) => {
                setSubtipoId(valor ?? "");
                setErroLocal(null);
              }}
              disabled={!tipoId || subtiposDoTipo.length === 0}
              placeholder={
                !tipoId
                  ? "Escolha o tipo primeiro"
                  : subtiposDoTipo.length === 0
                    ? "Nenhum subtipo cadastrado"
                    : "Subtipo..."
              }
              buscaPlaceholder="Escreva o nome do subtipo"
              className={COMBOBOX_COMO_SELECT}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Define onde o custo entra no DRE.
            {jurosDaBaixa > 0 ? " Os juros e a multa entram em 11 · Despesa com Juros." : ""}
          </p>
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
          <ArrowRightLeft className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
          <span>
            {noCartao ? (
              <>
                Ao confirmar, o item passa a pertencer à fatura do cartão e
                aparece no extrato dele, na aba{" "}
                <strong className="font-semibold text-foreground">Cartão</strong>.
              </>
            ) : linhaDoBanco ? (
              <>Ao confirmar, a baixa entra no Extrato já conciliada com a linha do banco, com a data dela.</>
            ) : (
              <>
                Ao confirmar, o pagamento é registrado e enviado para a{" "}
                <strong className="font-semibold text-foreground">Conciliação</strong>{" "}
                com a conta e o centro de custo escolhidos.
              </>
            )}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
        <button
          type="button"
          onClick={onCancelar}
          className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          <CreditCard className="h-4 w-4" />
          {pending
            ? "Confirmando..."
            : baixaParcial
              ? "Confirmar baixa parcial"
              : "Confirmar baixa"}
        </button>
      </div>
    </>
  );
}

function Campo({
  rotulo,
  ajuda,
  children,
}: {
  rotulo: string;
  ajuda?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-semibold">
        {rotulo} <span className="text-california-red">*</span>
      </label>
      {children}
      {ajuda && <p className="text-[11px] text-muted-foreground">{ajuda}</p>}
    </div>
  );
}

const TOM_DA_NOTA = {
  verde: "border-emerald-200 bg-emerald-50 text-emerald-900",
  ambar: "border-amber-200 bg-amber-50 text-amber-900",
  vermelho: "border-california-red/40 bg-california-red/5 text-california-red",
  violeta: "border-violet-200 bg-violet-50 text-violet-900",
} as const;

function Nota({
  tom,
  icone,
  children,
}: {
  tom: keyof typeof TOM_DA_NOTA;
  icone?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex items-start gap-2 rounded-lg border p-3 text-xs", TOM_DA_NOTA[tom])}>
      {icone ?? <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
      <span>{children}</span>
    </div>
  );
}

function formatarData(iso: string): string {
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${ano}`;
}
