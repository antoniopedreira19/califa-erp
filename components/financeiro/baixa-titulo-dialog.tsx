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
 *    toda baixa, de propósito.
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
 * Módulo fiscal (02/10/2026): na parcela de PP, a baixa abre com as
 * retenções que o financeiro informou na APROVAÇÃO da PP — a chave "Reter
 * impostos na fonte" ligada, as alíquotas preenchidas e editáveis, e a
 * ajuda "Retenções informadas na aprovação da PP (data) · editáveis". Elas
 * são buscadas ao abrir (`useRetencaoDaAprovacao`), pela parcela da
 * `chave`; sem alíquota gravada, a baixa abre como antes.
 */

import * as React from "react";
import { format } from "date-fns";
import { AlertCircle, ArrowRightLeft, CreditCard, Info } from "lucide-react";
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
import { proximaFatura } from "@/lib/cartoes/proxima-fatura";
import type {
  ContaBancaria,
  FormaPagamento,
  PagamentoForaDoCadastroDaPP,
  PedidoForaDoCadastro,
  PlanoContaTipo,
  PlanoContaSubtipo,
  RetencaoDaBaixa,
} from "@/lib/types";
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
import { parcelaDePPDaChave } from "@/lib/fiscal/retencao-da-aprovacao";
import {
  FormaPagamentoField,
  type CartaoOption,
  type FormaPagamentoValue,
} from "@/components/financeiro/forma-pagamento-field";

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
  vencimento: string | null;
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
}

const MOTIVO_CARTAO = "No cartão, a baixa é sempre do valor inteiro: o item entra inteiro na fatura.";

export function BaixaTituloDialog({
  open,
  onOpenChange,
  alvo,
  contas,
  tipos,
  subtipos,
  cartoes,
  formaPlanejada,
  cartaoPlanejadoId,
  pending,
  erro,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  alvo: BaixaTituloAlvo | null;
  contas: ContaBancaria[];
  tipos: PlanoContaTipo[];
  subtipos: PlanoContaSubtipo[];
  /** Cartões de crédito disponíveis para o seletor de forma de pagamento. */
  cartoes: CartaoOption[];
  /** Forma de pagamento pré-definida (avulso/recorrência herdam da origem). */
  formaPlanejada?: FormaPagamento | null;
  /** Cartão pré-selecionado quando `formaPlanejada` é "cartao_credito". */
  cartaoPlanejadoId?: string | null;
  pending: boolean;
  erro: string | null;
  onConfirm: (payload: BaixaTituloPayload) => void;
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
          // O cartão só vem sugerido onde ele cabe.
          formaPlanejada={
            alvo.semCartao && formaPlanejada === "cartao_credito" ? null : formaPlanejada ?? null
          }
          cartaoPlanejadoId={alvo.semCartao ? null : cartaoPlanejadoId ?? null}
          pending={pending}
          erro={erro}
          onCancelar={() => onOpenChange(false)}
          onConfirm={onConfirm}
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
  formaPlanejada,
  cartaoPlanejadoId,
  pending,
  erro,
  onCancelar,
  onConfirm,
}: {
  alvo: BaixaTituloAlvo;
  contas: ContaBancaria[];
  tipos: PlanoContaTipo[];
  subtipos: PlanoContaSubtipo[];
  cartoes: CartaoOption[];
  formaPlanejada: FormaPagamento | null;
  cartaoPlanejadoId: string | null;
  pending: boolean;
  erro: string | null;
  onCancelar: () => void;
  onConfirm: (payload: BaixaTituloPayload) => void;
}) {
  // Ao abrir: hoje como data, conta em branco (sem padrão, por decisão),
  // centro de custo sugerido pela origem quando existe, e forma de
  // pagamento pré-preenchida quando a origem já definiu.
  const [erroLocal, setErroLocal] = React.useState<string | null>(null);
  const [pagoEm, setPagoEm] = React.useState(format(new Date(), "yyyy-MM-dd"));
  const [contaId, setContaId] = React.useState("");
  const [tipoId, setTipoId] = React.useState(alvo.planoContaTipoId ?? "");
  const [subtipoId, setSubtipoId] = React.useState(alvo.planoContaSubtipoId ?? "");
  const [formaPagamento, setFormaPagamento] = React.useState<FormaPagamentoValue>({
    forma_pagamento: formaPlanejada,
    cartao_credito_id: cartaoPlanejadoId,
  });
  // Módulo fiscal: as retenções da aprovação da PP, buscadas ao abrir. Só
  // na parcela de PP com a retenção liberada (não a que foi para remessa).
  const aprovacao = useRetencaoDaAprovacao(
    alvo.retencao.mostra && alvo.retencao.motivo === null
      ? parcelaDePPDaChave(alvo.chave)
      : null,
  );
  const v = useValorDaBaixa(alvo.aberto, alvo.ultimaRetencao, aprovacao.retencao);

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

  function handleFormaPagamento(valor: FormaPagamentoValue) {
    // A data sugerida pelo campo (vencimento da fatura) NÃO entra aqui:
    // na baixa, a data é a do pagamento de fato, e é ela que decide em
    // qual fatura o item cai (decisão 093). Aceitar a sugestão jogaria o
    // item na fatura seguinte.
    setFormaPagamento(valor);
    setErroLocal(null);
  }

  const noCartao = formaPagamento.forma_pagamento === "cartao_credito";
  const cartaoEscolhido = noCartao
    ? cartoes.find((c) => c.id === formaPagamento.cartao_credito_id) ?? null
    : null;
  const faturaDestino = descreverFaturaDestino(cartaoEscolhido, pagoEm);

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
  React.useEffect(() => {
    if (motivoSemParcial !== null && v.parcial) v.setParcial(false);
    if (!retencaoLiberada && v.retem) v.setRetem(false);
    // `v` muda a cada renderização; o que decide é a regra.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motivoSemParcial, retencaoLiberada, v.parcial, v.retem]);

  function handleSubmit() {
    setErroLocal(null);
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
      if (!formaPagamento.forma_pagamento) {
        setErroLocal("Selecione a forma de pagamento.");
        return;
      }
      if (
        formaPagamento.forma_pagamento === "cartao_credito" &&
        !formaPagamento.cartao_credito_id
      ) {
        setErroLocal("Selecione o cartão de crédito.");
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
    onConfirm({
      pago_em: pagoEm,
      conta_bancaria_id: noCartao ? null : contaId,
      plano_conta_tipo_id: tipoId,
      plano_conta_subtipo_id: subtipoId,
      forma_pagamento: isDevolucao ? null : formaPagamento.forma_pagamento,
      cartao_credito_id: isDevolucao ? null : formaPagamento.cartao_credito_id,
      valor_baixa: v.valor,
      retencoes: v.retencoes(),
    });
  }

  const mensagemErro = erro ?? erroLocal;
  const baixaParcial = v.parcial && v.resta > 0.004;

  return (
    <>
      <div className="grid grid-cols-[max-content_1fr_max-content_1fr] gap-x-4 gap-y-1.5 rounded-xl border border-border bg-muted/40 p-4 text-[13px]">
        <span className="text-muted-foreground">Título</span>
        <span className="font-semibold">{alvo.titulo}</span>
        <span className="text-muted-foreground">Parcela</span>
        <span className="font-mono text-xs">{alvo.parcela}</span>
        <span className="text-muted-foreground">Origem</span>
        <span>{alvo.origem}</span>
        <span className="text-muted-foreground">Vencimento</span>
        <span className="font-mono text-xs">
          {alvo.vencimento ? formatarData(alvo.vencimento) : "—"}
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
        <div className={alvo.isDevolucao ? "space-y-1" : "grid grid-cols-2 items-start gap-3"}>
          <div className="space-y-1">
            <label className="text-xs font-semibold">
              {alvo.isDevolucao
                ? "Data em que o dinheiro voltou"
                : "Data do pagamento"}{" "}
              <span className="text-california-red">*</span>
            </label>
            <DatePicker
              name="pago_em"
              defaultValue={pagoEm}
              onDateChange={(d) => {
                setPagoEm(d ? format(d, "yyyy-MM-dd") : "");
                setErroLocal(null);
              }}
            />
          </div>

          {!alvo.isDevolucao && (
            <FormaPagamentoField
              cartoes={cartoes}
              value={formaPagamento}
              onChange={handleFormaPagamento}
              disabled={pending}
              obrigatorio
              semCartao={alvo.semCartao === true}
            />
          )}
        </div>

        {noCartao && (
          <div className="flex items-start gap-2 rounded-lg border border-california-red/30 bg-california-red/5 p-3 text-xs text-foreground">
            <CreditCard className="mt-0.5 h-3.5 w-3.5 shrink-0 text-california-red" />
            <span>
              {faturaDestino ? (
                <>
                  Entra na fatura de{" "}
                  <strong className="font-semibold">{faturaDestino.competencia}</strong>
                  {" — "}fecha {faturaDestino.fecha}, vence {faturaDestino.vence}.{" "}
                </>
              ) : (
                <>Escolha o cartão para ver em qual fatura o item entra. </>
              )}
              Nada sai da conta bancária agora: o dinheiro sai na baixa da fatura.
              Se essa competência já tiver fechado, o item cai na seguinte.
            </span>
          </div>
        )}

        {!noCartao && (
          <div className="space-y-1">
            <label className="text-xs font-semibold">
              {alvo.isDevolucao
                ? "Conta que receberá o dinheiro"
                : "Conta que realizará o pagamento"}{" "}
              <span className="text-california-red">*</span>
            </label>
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
          </div>
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
        />

        {v.retem && v.retido > 0 && (
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

function formatarData(iso: string): string {
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${ano}`;
}

/**
 * Em qual fatura o item vai cair, pela data do pagamento e pelo cartão
 * (decisão 093). Espelha `fatura_aberta_do_cartao` + `proxima_fatura_cartao`
 * do banco: dia do pagamento depois do fechamento → competência seguinte.
 * Não sabe se aquela competência já fechou — o texto avisa que, nesse
 * caso, o item rola para a próxima.
 */
function descreverFaturaDestino(
  cartao: CartaoOption | null,
  pagoEmISO: string,
): { competencia: string; fecha: string; vence: string } | null {
  if (!cartao || !pagoEmISO) return null;
  const [a, m, d] = pagoEmISO.split("-").map(Number);
  if (!a || !m || !d) return null;
  const data = new Date(a, m - 1, d);
  const fecha = cartao.dia_fechamento_fatura ?? cartao.dia_vencimento_fatura;

  let mesComp = data.getMonth();
  let anoComp = data.getFullYear();
  if (data.getDate() > fecha) {
    mesComp += 1;
    if (mesComp > 11) {
      mesComp = 0;
      anoComp += 1;
    }
  }
  const ultimoDia = new Date(anoComp, mesComp + 1, 0).getDate();
  const fechamento = new Date(anoComp, mesComp, Math.min(fecha, ultimoDia));
  const vencimento = proximaFatura(
    cartao.dia_vencimento_fatura,
    data,
    cartao.dia_fechamento_fatura,
  );

  const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return {
    competencia: `${MESES[mesComp]}/${String(anoComp).slice(2)}`,
    fecha: format(fechamento, "dd/MM/yyyy"),
    vence: format(vencimento, "dd/MM/yyyy"),
  };
}
