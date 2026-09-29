"use client";

/**
 * O que um título JÁ BAIXADO abre quando você clica no olho, em "Títulos a
 * Receber", em "Títulos a Pagar" e na fatura do cartão.
 *
 * Mostra a baixa registrada — data, conta, centro de custo e os estornos
 * que ela já teve — e traz as duas ações da decisão 120, lado a lado no
 * cartão da baixa:
 *
 * - **Estornar**: uma transação nova, com data, conta e valor definidos
 *   agora. A baixa fica como está e o título continua pago. No receber é
 *   receita negativa; no pagar, despesa negativa. Vai até o que a baixa
 *   movimentou menos os estornos anteriores.
 * - **Cancelar esta baixa**: desfaz a baixa. O lançamento sai do extrato,
 *   sem linha nova, o título volta para Em aberto / A pagar, e os estornos
 *   da baixa saem junto. É a ferramenta de corrigir erro.
 *
 * Histórico: até 29/09/2026 havia um botão só, "Estornar baixa", que na
 * prática cancelava deixando duas linhas no extrato (o original riscado e
 * o reverso com a data do dia). O Tiago separou as duas ideias no
 * protótipo aprovado em 28/09 (seção 5).
 *
 * As duas ações abrem em dois tempos de propósito: o botão sozinho, e só
 * depois o formulário com o confirmar. Mexem em dinheiro que já foi para a
 * conciliação, então não ficam a um clique de quem só queria conferir.
 *
 * `sentido` só troca frases: em Contas a Receber o dinheiro entra, e
 * "Pago em" ou "volta para A pagar" seriam mentira na tela.
 */

import * as React from "react";
import { format } from "date-fns";
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  RotateCcw,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { MoedaInput } from "@/components/ui/moeda-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn, formatCurrency } from "@/lib/utils";

/** Um estorno já registrado sobre a baixa. */
export interface EstornoDaBaixa {
  id: string;
  data: string;
  valor: number;
  contaNome: string | null;
  motivo: string | null;
}

export interface BaixaRegistradaAlvo {
  titulo: string;
  origem: string;
  parcela: string;
  valor: number;
  /** Data em que o dinheiro entrou ou saiu — o `pago_em` do título. */
  pagoEm: string | null;
  contaNome: string | null;
  /** O centro de custo — o TIPO do plano de contas, "01 · Receita". */
  centroNome: string | null;
  /** O subtipo, na linha de baixo. `undefined` esconde a linha, para a
   *  aba que ainda manda o par concatenado em `centroNome`. */
  subtipoNome?: string | null;
  dataPagamento: string | null;
  vencOriginal: string | null;
  /** A baixa foi no cartão (decisão 093): o item está numa fatura e não
   *  saiu da conta bancária. Cancelar o tira da fatura. */
  viaCartao: boolean;
  /** É o pagamento de uma fatura de cartão: cancelar devolve a fatura
   *  para Fechada, e não há estorno. */
  ehFaturaDeCartao: boolean;
  /** O lançamento da baixa viva, onde o estorno se pendura. Nulo quando
   *  a baixa não tem um lançamento só (a fatura tem duas pernas). */
  baixaLancamentoId: string | null;
  /** O que a baixa movimentou — o teto do estorno, antes dos estornos. */
  valorMovimentado: number;
  /** Conta da baixa: vem escolhida no formulário do estorno. */
  contaBancariaId: string | null;
  estornos: EstornoDaBaixa[];
  /** Por que esta baixa não aceita estorno. `null` quando aceita. */
  semEstorno: string | null;
}

export interface DadosDoEstorno {
  data: string;
  contaBancariaId: string;
  valor: number;
  motivo: string;
}

function formatarData(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

const MOTIVO_MINIMO = 10;
const MOTIVO_MAXIMO = 500;

/** Soma com os centavos certos: 0,1 + 0,2 não pode virar 0,30000000004. */
function somarCentavos(valores: number[]): number {
  return valores.reduce((acc, v) => acc + Math.round(v * 100), 0) / 100;
}

export function BaixaRegistradaDialog({
  open,
  onOpenChange,
  alvo,
  contas,
  pending,
  erro,
  onCancelar,
  onEstornar,
  sentido = "pagar",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  alvo: BaixaRegistradaAlvo | null;
  /** Contas bancárias ativas, para o estorno. Cartão não entra. */
  contas: Array<{ id: string; nome: string; banco: string }>;
  pending: boolean;
  erro: string | null;
  onCancelar: (motivo: string) => void;
  onEstornar: (dados: DadosDoEstorno) => void;
  /** Lado da conta. Só muda rótulos; a mecânica é a mesma. */
  sentido?: "pagar" | "receber";
}) {
  const ehReceber = sentido === "receber";
  const [acao, setAcao] = React.useState<"estornar" | "cancelar" | null>(null);
  const [erroLocal, setErroLocal] = React.useState<string | null>(null);

  // Cada abertura começa do zero: o modal é reusado entre linhas, e um
  // motivo digitado para um título não pode sobrar para o seguinte.
  //
  // A chave é o TÍTULO, não o objeto `alvo`: as telas montam o alvo de novo
  // a cada renderização, e a recusa do servidor (que chega como `erro` e
  // re-renderiza a tela) fechava o formulário e jogava fora o motivo
  // digitado (visto na conferência de 29/09/2026).
  const chaveDoAlvo = alvo
    ? `${alvo.titulo}|${alvo.parcela}|${alvo.pagoEm}|${alvo.baixaLancamentoId}`
    : null;
  React.useEffect(() => {
    if (!open) return;
    setAcao(null);
    setErroLocal(null);
  }, [open, chaveDoAlvo]);

  if (!alvo) return null;
  const mensagemErro = erro ?? erroLocal;

  const jaEstornado = somarCentavos(alvo.estornos.map((e) => e.valor));
  const maximo = somarCentavos([alvo.valorMovimentado, -jaEstornado]);
  const motivoSemEstorno =
    alvo.semEstorno ??
    (maximo <= 0 ? "Esta baixa já foi estornada por inteiro." : null);
  const podeEstornar = motivoSemEstorno === null && alvo.baixaLancamentoId !== null;

  const rotuloData = ehReceber ? "Data de recebimento" : "Data de pagamento";
  const SetaEstorno = ehReceber ? ArrowUpRight : ArrowDownLeft;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[660px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Check className="h-5 w-5 text-emerald-600" />
            Baixa registrada
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-[max-content_1fr_max-content_1fr] gap-x-4 gap-y-1.5 rounded-xl border border-border bg-muted/40 p-4 text-[13px]">
          <span className="text-muted-foreground">Título</span>
          <span className="font-semibold">{alvo.titulo}</span>
          <span className="text-muted-foreground">Parcela</span>
          <span className="font-mono text-xs">{alvo.parcela}</span>
          <span className="text-muted-foreground">Origem</span>
          <span>{alvo.origem}</span>
          <span className="text-muted-foreground">Valor</span>
          <span className="font-mono font-bold">
            {formatCurrency(alvo.valor, "BRL")}
          </span>
          <span className="text-muted-foreground">Venc. original</span>
          <span className="font-mono text-xs">
            {formatarData(alvo.vencOriginal)}
          </span>
          <span className="text-muted-foreground">{rotuloData}</span>
          <span className="font-mono text-xs">
            {formatarData(alvo.dataPagamento)}
          </span>
        </div>

        <div
          className={cn(
            "rounded-xl border p-4",
            acao === "cancelar"
              ? "border-california-red/30 bg-california-red/[0.03]"
              : acao === "estornar"
                ? "border-rose-200 bg-rose-50/40"
                : "border-emerald-200 bg-emerald-50/50",
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-800">
              {ehReceber ? "Recebido" : "Pago"} em {formatarData(alvo.pagoEm)}
            </p>
            {acao === null && (
              <div className="flex items-center gap-1.5">
                {/* O `title` vai no span: botão desabilitado não recebe o
                    mouse, e o motivo sumiria justamente quando importa. */}
                <span title={motivoSemEstorno ?? undefined}>
                  <button
                    type="button"
                    disabled={!podeEstornar}
                    onClick={() => {
                      setErroLocal(null);
                      setAcao("estornar");
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-2.5 py-1.5 text-[12px] font-semibold text-foreground transition-colors hover:border-rose-300 hover:text-rose-700 disabled:pointer-events-none disabled:opacity-40"
                  >
                    <SetaEstorno className="h-3.5 w-3.5" />
                    Estornar
                  </button>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setErroLocal(null);
                    setAcao("cancelar");
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-california-red/40 bg-white px-2.5 py-1.5 text-[12px] font-semibold text-california-red transition-colors hover:bg-california-red/5"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Cancelar esta baixa
                </button>
              </div>
            )}
          </div>

          <div className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-[13px]">
            <span className="text-muted-foreground">
              {alvo.viaCartao
                ? "Lançado no cartão"
                : ehReceber
                  ? "Entrou na conta"
                  : "Saiu da conta"}
            </span>
            <span>
              <b className="font-mono">
                {formatCurrency(alvo.valorMovimentado, "BRL")}
              </b>{" "}
              <span className="text-muted-foreground">
                · {alvo.contaNome ?? "—"}
              </span>
            </span>
            <span className="text-muted-foreground">Centro de custo</span>
            <span>
              {alvo.centroNome ?? "—"}
              {alvo.subtipoNome !== undefined && (
                <span className="text-muted-foreground">
                  {" "}
                  · {alvo.subtipoNome ?? "—"}
                </span>
              )}
            </span>
            {alvo.estornos.map((e) => (
              <React.Fragment key={e.id}>
                <span className="text-rose-700">Estorno</span>
                <span className="text-rose-800">
                  <b className="font-mono">{formatCurrency(e.valor, "BRL")}</b>{" "}
                  em {formatarData(e.data)} · {e.contaNome ?? "—"}
                  {e.motivo && (
                    <>
                      {" "}
                      · <i>“{e.motivo}”</i>
                    </>
                  )}
                </span>
              </React.Fragment>
            ))}
          </div>

          {acao === null && motivoSemEstorno && alvo.semEstorno && (
            <p className="mt-2 text-[11.5px] text-muted-foreground">
              {motivoSemEstorno}
            </p>
          )}

          {acao === "estornar" && alvo.baixaLancamentoId && (
            <FormEstorno
              key={alvo.baixaLancamentoId}
              ehReceber={ehReceber}
              contas={contas}
              contaInicial={alvo.contaBancariaId}
              maximo={maximo}
              pending={pending}
              onErro={setErroLocal}
              onVoltar={() => {
                setAcao(null);
                setErroLocal(null);
              }}
              onConfirmar={onEstornar}
            />
          )}

          {acao === "cancelar" && (
            <FormCancelamento
              ehReceber={ehReceber}
              alvo={alvo}
              pending={pending}
              onErro={setErroLocal}
              onVoltar={() => {
                setAcao(null);
                setErroLocal(null);
              }}
              onConfirmar={onCancelar}
            />
          )}
        </div>

        {mensagemErro && (
          <div className="flex items-start gap-2 rounded-lg border border-california-red/40 bg-california-red/5 p-3 text-sm text-california-red">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{mensagemErro}</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={pending}
            className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            Fechar
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** O formulário do estorno, dentro do cartão da baixa. */
function FormEstorno({
  ehReceber,
  contas,
  contaInicial,
  maximo,
  pending,
  onErro,
  onVoltar,
  onConfirmar,
}: {
  ehReceber: boolean;
  contas: Array<{ id: string; nome: string; banco: string }>;
  contaInicial: string | null;
  maximo: number;
  pending: boolean;
  onErro: (msg: string | null) => void;
  onVoltar: () => void;
  onConfirmar: (dados: DadosDoEstorno) => void;
}) {
  const [data, setData] = React.useState(format(new Date(), "yyyy-MM-dd"));
  const [contaId, setContaId] = React.useState(
    contaInicial && contas.some((c) => c.id === contaInicial) ? contaInicial : "",
  );
  const [centavos, setCentavos] = React.useState(String(Math.round(maximo * 100)));
  const [motivo, setMotivo] = React.useState("");
  const Seta = ehReceber ? ArrowUpRight : ArrowDownLeft;

  function confirmar() {
    onErro(null);
    const valor = Number(centavos || "0") / 100;
    if (!data || !contaId) {
      onErro("Informe a data e a conta do estorno.");
      return;
    }
    if (valor <= 0) {
      onErro("Informe o valor do estorno.");
      return;
    }
    if (valor > maximo) {
      onErro(
        `O estorno passa do que esta baixa movimentou (${formatCurrency(maximo, "BRL")}).`,
      );
      return;
    }
    if (motivo.trim().length < MOTIVO_MINIMO) {
      onErro(`Explique o motivo em pelo menos ${MOTIVO_MINIMO} caracteres.`);
      return;
    }
    onConfirmar({ data, contaBancariaId: contaId, valor, motivo: motivo.trim() });
  }

  return (
    <div className="mt-3 space-y-2.5 border-t border-rose-200 pt-3">
      <p className="flex items-start gap-2 text-[13px]">
        <Seta className="mt-0.5 h-4 w-4 shrink-0 text-rose-700" />
        <span>
          Registra uma transação nova:{" "}
          {ehReceber
            ? "o dinheiro sai da conta, de volta para o cliente"
            : "o dinheiro volta do fornecedor para a conta"}
          . Na conciliação, é{" "}
          {ehReceber ? (
            <>
              uma saída que reduz a receita (<b>receita negativa</b>)
            </>
          ) : (
            <>
              uma entrada que reduz a despesa (<b>despesa negativa</b>)
            </>
          )}
          . A baixa continua como está, e o título continua{" "}
          {ehReceber ? "recebido" : "pago"}.
        </span>
      </p>
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-semibold">
            Data do estorno <span className="text-california-red">*</span>
          </label>
          <DatePicker
            name="data_estorno"
            defaultValue={data}
            onDateChange={(d) => {
              setData(d ? format(d, "yyyy-MM-dd") : "");
              onErro(null);
            }}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold">
            Conta <span className="text-california-red">*</span>
          </label>
          <Select
            value={contaId}
            onValueChange={(v) => {
              setContaId(v);
              onErro(null);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Selecione a conta..." />
            </SelectTrigger>
            <SelectContent>
              {contas.length === 0 ? (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  Nenhuma conta bancária ativa.
                </div>
              ) : (
                contas.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.nome} · {c.banco}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold">
            Valor do estorno <span className="text-california-red">*</span>
          </label>
          <MoedaInput
            defaultValue={maximo.toFixed(2)}
            onCentavosChange={(c) => {
              setCentavos(c);
              onErro(null);
            }}
          />
          <p className="text-[11px] text-muted-foreground">
            Até {formatCurrency(maximo, "BRL")}.
          </p>
        </div>
      </div>
      <div className="space-y-1">
        <label className="text-xs font-semibold">
          Motivo do estorno <span className="text-california-red">*</span>
        </label>
        <textarea
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          maxLength={MOTIVO_MAXIMO}
          rows={2}
          className="w-full rounded-lg border border-border bg-white p-2 text-sm"
          placeholder={
            ehReceber
              ? "Ex.: o cliente pagou em duplicidade; valor acima do combinado."
              : "Ex.: o fornecedor devolveu parte do valor; cobrança em duplicidade."
          }
        />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">
          {motivo.trim().length}/{MOTIVO_MAXIMO} caracteres · mínimo{" "}
          {MOTIVO_MINIMO}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onVoltar}
            disabled={pending}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            Voltar
          </button>
          <button
            type="button"
            onClick={confirmar}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-rose-700 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-rose-800 disabled:opacity-50"
          >
            <Seta className="h-3.5 w-3.5" />
            {pending ? "Registrando..." : "Confirmar estorno"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** O aviso e o motivo do cancelamento, dentro do cartão da baixa. */
function FormCancelamento({
  ehReceber,
  alvo,
  pending,
  onErro,
  onVoltar,
  onConfirmar,
}: {
  ehReceber: boolean;
  alvo: BaixaRegistradaAlvo;
  pending: boolean;
  onErro: (msg: string | null) => void;
  onVoltar: () => void;
  onConfirmar: (motivo: string) => void;
}) {
  const [motivo, setMotivo] = React.useState("");
  const motivoOk = motivo.trim().length >= MOTIVO_MINIMO;
  const valor = (
    <b className="font-mono">{formatCurrency(alvo.valorMovimentado, "BRL")}</b>
  );
  const nEstornos = alvo.estornos.length;

  return (
    <div className="mt-3 space-y-2 border-t border-california-red/20 pt-3">
      <p className="flex items-start gap-2 text-[13px]">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-california-red" />
        <span>
          {alvo.ehFaturaDeCartao ? (
            <>
              O pagamento é desfeito: a fatura volta para <b>Fechada</b>, como
              se ainda não tivesse sido paga, e o lançamento de {valor} sai do
              extrato da conta e do cartão, sem linha nova.
            </>
          ) : alvo.viaCartao ? (
            <>
              A baixa é desfeita: o título volta para <b>A pagar</b> e sai da
              fatura do cartão, sem mexer em conta bancária. Se a fatura já
              fechou, reabra-a antes.
            </>
          ) : (
            <>
              A baixa é desfeita: o título volta para{" "}
              <b>{ehReceber ? "Em aberto" : "A pagar"}</b> e o lançamento de{" "}
              {valor} sai do extrato, sem linha nova.
            </>
          )}
          {nEstornos === 1 && " O estorno registrado nesta baixa sai junto."}
          {nEstornos > 1 &&
            ` Os ${nEstornos} estornos registrados nesta baixa saem junto.`}{" "}
          Fica no log de auditoria quem cancelou, quando e por quê.
        </span>
      </p>
      <label className="text-xs font-semibold">
        Motivo do cancelamento <span className="text-california-red">*</span>
      </label>
      <textarea
        value={motivo}
        onChange={(e) => {
          setMotivo(e.target.value);
          onErro(null);
        }}
        maxLength={MOTIVO_MAXIMO}
        rows={2}
        autoFocus
        className="w-full rounded-lg border border-border bg-white p-2 text-sm"
        placeholder="Ex.: baixa lançada no título errado; conta errada."
      />
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">
          {motivo.trim().length}/{MOTIVO_MAXIMO} caracteres · mínimo{" "}
          {MOTIVO_MINIMO}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onVoltar}
            disabled={pending}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            Voltar
          </button>
          <button
            type="button"
            onClick={() => onConfirmar(motivo.trim())}
            disabled={pending || !motivoOk}
            className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-california-red-hover disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {pending ? "Cancelando..." : "Confirmar cancelamento"}
          </button>
        </div>
      </div>
    </div>
  );
}
