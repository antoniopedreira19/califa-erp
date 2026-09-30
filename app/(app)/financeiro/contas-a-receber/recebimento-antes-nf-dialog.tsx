"use client";

/**
 * Recebimento antes da NF (decisão 130), pela linha da aba Faturamento.
 *
 * Dois diálogos:
 *
 * - `RecebimentoAntesNfDialog` registra: data, conta que recebeu, valor
 *   (até o saldo a faturar da linha menos o que já foi recebido antes) e o
 *   centro de custo — o mesmo que a baixa do título pediria.
 * - `RecebidosAntesNfDialog` abre pelo selo da linha: lista o que já foi
 *   recebido antes da nota, cada um com o seu cancelamento.
 *
 * Quando a NF da linha sai, o recebido vira a parcela 1 dela, já quitada
 * (o Faturar monta a parcela travada; `emitir_faturamento` confere).
 */

import * as React from "react";
import { format } from "date-fns";
import { AlertCircle, AlertTriangle, HandCoins, RotateCcw } from "lucide-react";
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
import type { ContaBancaria, PlanoContaTipo, PlanoContaSubtipo } from "@/lib/types";

/** Um recebimento antes da NF que ainda espera a nota. */
export interface RecebidoAntesDaNf {
  id: string;
  data: string;
  valor: number;
  contaNome: string;
  /** O tipo do plano de contas, "01 · Receita". */
  centroNome: string;
  subtipoNome: string;
}

/** A linha da aba Faturamento em que o recebimento entra. */
export interface AlvoDoRecebidoAntes {
  /** `nota:<id>` ou `bv:<id>` — recomeça o formulário a cada linha. */
  chave: string;
  envioNotaId: string | null;
  itemBvId: string | null;
  /** "TES-1013/26 · Nome do job". */
  titulo: string;
  /** O cliente, ou o fornecedor no BV. */
  contraparte: string;
  ehBv: boolean;
  /** "NF 2/2 · 2 vencimentos" no job; nulo no BV. */
  notaRotulo: string | null;
  /** Saldo a faturar da linha (a nota inteira, ou o BV). */
  saldo: number;
  recebidos: RecebidoAntesDaNf[];
}

function formatMoney(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatarData(iso: string): string {
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${ano}`;
}

export function somaDosRecebidos(recebidos: RecebidoAntesDaNf[]): number {
  return recebidos.reduce((s, r) => s + Math.round(r.valor * 100), 0) / 100;
}

// ---------------------------------------------------------------------------
// Registrar
// ---------------------------------------------------------------------------

export interface RecebidoAntesPayload {
  data: string;
  conta_bancaria_id: string;
  valor: number;
  plano_conta_tipo_id: string;
  plano_conta_subtipo_id: string;
}

export function RecebimentoAntesNfDialog({
  alvo,
  onOpenChange,
  contas,
  tipos,
  subtipos,
  pending,
  erro,
  onConfirm,
}: {
  alvo: AlvoDoRecebidoAntes | null;
  onOpenChange: (open: boolean) => void;
  contas: ContaBancaria[];
  tipos: PlanoContaTipo[];
  subtipos: PlanoContaSubtipo[];
  pending: boolean;
  erro: string | null;
  onConfirm: (payload: RecebidoAntesPayload) => void;
}) {
  return (
    <Dialog open={alvo !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HandCoins className="h-5 w-5 text-amber-700" />
            Recebimento antes da NF
          </DialogTitle>
        </DialogHeader>
        {alvo && (
          <FormularioDoRecebido
            key={alvo.chave}
            alvo={alvo}
            contas={contas}
            tipos={tipos}
            subtipos={subtipos}
            pending={pending}
            erro={erro}
            onCancelar={() => onOpenChange(false)}
            onConfirm={onConfirm}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function FormularioDoRecebido({
  alvo,
  contas,
  tipos,
  subtipos,
  pending,
  erro,
  onCancelar,
  onConfirm,
}: {
  alvo: AlvoDoRecebidoAntes;
  contas: ContaBancaria[];
  tipos: PlanoContaTipo[];
  subtipos: PlanoContaSubtipo[];
  pending: boolean;
  erro: string | null;
  onCancelar: () => void;
  onConfirm: (payload: RecebidoAntesPayload) => void;
}) {
  const hoje = format(new Date(), "yyyy-MM-dd");
  const [data, setData] = React.useState(hoje);
  const [contaId, setContaId] = React.useState("");
  const [valor, setValor] = React.useState(0);
  const [tipoId, setTipoId] = React.useState("");
  const [subtipoId, setSubtipoId] = React.useState("");
  const [erroLocal, setErroLocal] = React.useState<string | null>(null);

  const jaRecebido = somaDosRecebidos(alvo.recebidos);
  const limite = Math.max(0, Math.round((alvo.saldo - jaRecebido) * 100) / 100);

  // Toda conta ativa, de qualquer empresa (decisão de 29/08/2026), como na
  // baixa do título.
  const contasAtivas = contas.filter((c) => c.ativo);
  const tiposAtivos = tipos.filter((t) => t.ativo);
  const subtiposDoTipo = tipoId
    ? subtipos.filter((s) => s.tipo_id === tipoId && s.ativo)
    : [];

  function handleSubmit() {
    setErroLocal(null);
    if (!data || !contaId || valor <= 0) {
      setErroLocal("Informe a data, a conta que recebeu e o valor.");
      return;
    }
    if (valor > limite + 0.004) {
      setErroLocal(
        `O valor passa do saldo a faturar ${alvo.ehBv ? "do BV" : "da nota"} (${formatMoney(limite)}).`,
      );
      return;
    }
    if (!tipoId || !subtipoId) {
      setErroLocal("Selecione o centro de custo do recebimento.");
      return;
    }
    onConfirm({
      data,
      conta_bancaria_id: contaId,
      valor,
      plano_conta_tipo_id: tipoId,
      plano_conta_subtipo_id: subtipoId,
    });
  }

  const mensagemErro = erro ?? erroLocal;

  return (
    <>
      <div className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 rounded-xl border border-border bg-muted/50 p-4 text-[13px]">
        <span className="text-muted-foreground">{alvo.ehBv ? "BV" : "Job"}</span>
        <span className="font-semibold">{alvo.titulo}</span>
        <span className="text-muted-foreground">{alvo.ehBv ? "Fornecedor" : "Cliente"}</span>
        <span>{alvo.contraparte}</span>
        {alvo.notaRotulo && (
          <>
            <span className="text-muted-foreground">Nota do envio</span>
            <span className="font-mono">{alvo.notaRotulo}</span>
          </>
        )}
        <span className="text-muted-foreground">Saldo a faturar</span>
        <span className="font-mono font-bold">{formatMoney(alvo.saldo)}</span>
        {jaRecebido > 0 && (
          <>
            <span className="text-muted-foreground">Já recebido antes da NF</span>
            <span className="font-mono">{formatMoney(jaRecebido)}</span>
          </>
        )}
      </div>

      {mensagemErro && (
        <div className="flex items-start gap-2 rounded-lg border border-california-red/40 bg-california-red/5 p-3 text-sm text-california-red">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{mensagemErro}</span>
        </div>
      )}

      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold">
              Data do recebimento <span className="text-california-red">*</span>
            </label>
            <DatePicker
              name="data_recebimento_antes_nf"
              defaultValue={hoje}
              onDateChange={(d) => {
                setData(d ? format(d, "yyyy-MM-dd") : "");
                setErroLocal(null);
              }}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold">
              Conta que recebeu <span className="text-california-red">*</span>
            </label>
            <Select
              value={contaId}
              onValueChange={(v) => {
                setContaId(v);
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
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold">
            Valor recebido <span className="text-california-red">*</span>
          </label>
          <MoneyInput
            value={valor}
            onValueChange={(v) => {
              setValor(v);
              setErroLocal(null);
            }}
          />
          <p className="text-[11.5px] text-muted-foreground">
            Até {formatMoney(limite)}, o que falta faturar {alvo.ehBv ? "do BV" : "da nota"}
            {jaRecebido > 0 ? " menos o que já foi recebido antes" : ""}.
          </p>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold">
            Centro de custo do recebimento <span className="text-california-red">*</span>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <Combobox
              items={tiposAtivos.map((t) => ({
                value: t.id,
                label: `${t.codigo} · ${t.nome}`,
              }))}
              value={tipoId || null}
              onChange={(v) => {
                const novo = v ?? "";
                setTipoId(novo);
                // Trocar o tipo invalida o subtipo — o banco recusa o par.
                setSubtipoId((atual) =>
                  subtipos.find((s) => s.id === atual)?.tipo_id === novo ? atual : "",
                );
                setErroLocal(null);
              }}
              placeholder={tiposAtivos.length === 0 ? "Nenhum tipo cadastrado" : "Tipo..."}
              buscaPlaceholder="Escreva o código ou o nome"
              disabled={tiposAtivos.length === 0}
              className={COMBOBOX_COMO_SELECT}
            />
            <Combobox
              items={subtiposDoTipo.map((s) => ({ value: s.id, label: s.nome }))}
              value={subtipoId || null}
              onChange={(v) => {
                setSubtipoId(v ?? "");
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
          <p className="text-[11.5px] text-muted-foreground">
            O mesmo da baixa do título: define onde a receita entra no DRE.
          </p>
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
          <HandCoins className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" />
          <span>
            O dinheiro entra no extrato agora, e {alvo.ehBv ? "o BV" : "a nota"} continua
            na aba Faturamento com o valor recebido marcado na linha. Quando a NF for
            emitida, este valor entra como a{" "}
            <strong className="font-semibold text-foreground">parcela 1, já recebida</strong>,
            com esta data. Nada entra de novo na conta.
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
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          <HandCoins className="h-4 w-4" />
          {pending ? "Registrando..." : "Registrar recebimento"}
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Ver e cancelar
// ---------------------------------------------------------------------------

const MOTIVO_MINIMO = 10;
const MOTIVO_MAXIMO = 500;

export function RecebidosAntesNfDialog({
  alvo,
  onOpenChange,
  pending,
  erro,
  onCancelar,
}: {
  alvo: AlvoDoRecebidoAntes | null;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  erro: string | null;
  onCancelar: (recebido: RecebidoAntesDaNf, motivo: string) => void;
}) {
  return (
    <Dialog open={alvo !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HandCoins className="h-5 w-5 text-amber-700" />
            Recebido antes da NF
          </DialogTitle>
        </DialogHeader>
        {alvo && (
          // A lista recomeça quando muda o que ela mostra: depois de um
          // cancelamento, o item que estava em confirmação já não existe.
          <ListaDosRecebidos
            key={`${alvo.chave}|${alvo.recebidos.map((r) => r.id).join(",")}`}
            alvo={alvo}
            pending={pending}
            erro={erro}
            onFechar={() => onOpenChange(false)}
            onCancelar={onCancelar}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ListaDosRecebidos({
  alvo,
  pending,
  erro,
  onFechar,
  onCancelar,
}: {
  alvo: AlvoDoRecebidoAntes;
  pending: boolean;
  erro: string | null;
  onFechar: () => void;
  onCancelar: (recebido: RecebidoAntesDaNf, motivo: string) => void;
}) {
  const [cancelando, setCancelando] = React.useState<string | null>(null);
  const [motivo, setMotivo] = React.useState("");
  const total = somaDosRecebidos(alvo.recebidos);
  const varios = alvo.recebidos.length > 1;

  return (
    <>
      <div className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 rounded-xl border border-border bg-muted/50 p-4 text-[13px]">
        <span className="text-muted-foreground">{alvo.ehBv ? "BV" : "Job"}</span>
        <span className="font-semibold">{alvo.titulo}</span>
        <span className="text-muted-foreground">{alvo.ehBv ? "Fornecedor" : "Cliente"}</span>
        <span>{alvo.contraparte}</span>
        <span className="text-muted-foreground">Recebido antes da NF</span>
        <span className="font-mono font-bold">{formatMoney(total)}</span>
        <span className="text-muted-foreground">Situação</span>
        <span className="font-semibold text-amber-800">Aguardando a emissão da NF</span>
      </div>

      <div className="max-h-[46vh] space-y-2.5 overflow-y-auto">
        {alvo.recebidos.map((r, i) => {
          const emCancelamento = cancelando === r.id;
          return (
            <div
              key={r.id}
              className={
                emCancelamento
                  ? "rounded-xl border border-california-red/30 bg-california-red/[0.03] p-4"
                  : "rounded-xl border border-amber-200 bg-amber-50/50 p-4"
              }
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] font-bold uppercase tracking-wide text-amber-800">
                  {varios ? `Recebimento ${i + 1} · ` : ""}Recebido em {formatarData(r.data)}
                </p>
                {cancelando === null && (
                  <button
                    type="button"
                    onClick={() => {
                      setCancelando(r.id);
                      setMotivo("");
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-california-red/40 bg-white px-2.5 py-1.5 text-[12px] font-semibold text-california-red transition-colors hover:bg-california-red/5"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Cancelar este recebimento
                  </button>
                )}
              </div>
              <div className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-[13px]">
                <span className="text-muted-foreground">Entrou na conta</span>
                <span>
                  <b className="font-mono">{formatMoney(r.valor)}</b>{" "}
                  <span className="text-muted-foreground">· {r.contaNome}</span>
                </span>
                <span className="text-muted-foreground">Centro de custo</span>
                <span>
                  {r.centroNome}
                  <span className="text-muted-foreground"> · {r.subtipoNome}</span>
                </span>
              </div>

              {emCancelamento && (
                <div className="mt-3 space-y-2 border-t border-california-red/20 pt-3">
                  <p className="flex items-start gap-2 text-[13px]">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-california-red" />
                    <span>
                      O recebimento é desfeito: o lançamento de{" "}
                      <b className="font-mono">{formatMoney(r.valor)}</b> sai do extrato,
                      sem linha nova, e o valor sai do selo da linha. Fica no log de
                      auditoria quem cancelou, quando e por quê.
                    </span>
                  </p>
                  <label className="text-xs font-semibold">
                    Motivo do cancelamento <span className="text-california-red">*</span>
                  </label>
                  <textarea
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    maxLength={MOTIVO_MAXIMO}
                    rows={2}
                    autoFocus
                    className="w-full rounded-lg border border-border bg-white p-2 text-sm"
                    placeholder="Ex.: recebimento lançado na linha errada; conta errada."
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground">
                      {motivo.trim().length}/{MOTIVO_MAXIMO} caracteres · mínimo{" "}
                      {MOTIVO_MINIMO}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setCancelando(null)}
                        disabled={pending}
                        className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
                      >
                        Voltar
                      </button>
                      <button
                        type="button"
                        onClick={() => onCancelar(r, motivo.trim())}
                        disabled={pending || motivo.trim().length < MOTIVO_MINIMO}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-california-red-hover disabled:opacity-50"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        {pending ? "Cancelando..." : "Confirmar cancelamento"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-[12.5px] text-muted-foreground text-pretty">
        Quando a NF {alvo.ehBv ? "do BV" : "desta nota"} for emitida,{" "}
        {varios ? "estes valores entram" : "este valor entra"} como a parcela 1, já
        recebida{varios ? " (uma baixa para cada recebimento)" : ", com esta data"}.
      </p>

      {erro && (
        <div className="flex items-start gap-2 rounded-lg border border-california-red/40 bg-california-red/5 p-3 text-sm text-california-red">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{erro}</span>
        </div>
      )}

      <div className="flex items-center justify-end border-t border-border pt-4">
        <button
          type="button"
          onClick={onFechar}
          className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
        >
          Fechar
        </button>
      </div>
    </>
  );
}
