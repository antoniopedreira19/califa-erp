"use client";

/** O formulário do SAVE de uma linha — os dois lados do crédito.
 *
 *  Do design `Orcamento - Versao com Save.dc.html` (projeto Claude Design
 *  `69342d83`), 26/08/2026. Duas abas, porque são duas coisas opostas que
 *  cabem na mesma linha e nunca ao mesmo tempo:
 *
 *   - **Gerar** — esta linha é faturada aqui e o serviço não acontece; o
 *     valor vira crédito do cliente.
 *   - **Consumir** — esta linha é paga por saldo de outros jobs, e por
 *     isso sai do faturamento e entra no valor do job.
 *
 *  O saldo é do JOB, não da linha (decisão 028, nota de 26/08/2026): cada
 *  origem desconta do saldo do job dela, e uma linha pode beber de vários.
 *  As linhas que formaram cada saldo aparecem no detalhe, mas não são
 *  escolhidas uma a uma — não é assim que a operação trata o crédito.
 */

import * as React from "react";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Plus, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency } from "@/lib/utils";
import { receitaDeFaturamentoDaLinha } from "@/lib/calculos/versao-totais";
import type { TipoCusto } from "@/lib/types";
import type { SaldoDeSave } from "@/lib/data/saves";
import type { EstadoSaveDaLinha } from "./save-coluna";

export interface LinhaDoSave {
  id: string;
  nome: string;
  grupoNome: string;
  tipoCusto: TipoCusto;
  totalOrcado: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  linha: LinhaDoSave | null;
  estado: EstadoSaveDaLinha;
  saldos: SaldoDeSave[];
  moeda: string;
  percentualHonorarios: number;
  percentualImposto: number;
  clienteNome: string;
  /** Sem estas duas o formulário abre em leitura — é como o financeiro e a
   *  versão aprovada mostram o save. */
  onMarcarSave?: (marcar: boolean) => Promise<{ ok: boolean; message?: string }>;
  onSalvarConsumo?: (
    origens: { jobOrigemId: string; valor: number }[],
  ) => Promise<{ ok: boolean; message?: string }>;
}

interface OrigemNaTela {
  jobOrigemId: string;
  valor: number;
}

function paraNumero(raw: string): number {
  const limpo = raw.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(limpo);
  return Number.isFinite(n) ? n : 0;
}

export function SaveDialog({
  open,
  onOpenChange,
  linha,
  estado,
  saldos,
  moeda,
  percentualHonorarios,
  percentualImposto,
  clienteNome,
  onMarcarSave,
  onSalvarConsumo,
}: Props) {
  const editavel = Boolean(onMarcarSave && onSalvarConsumo);
  const [modo, setModo] = React.useState<"gerar" | "consumir">("consumir");
  const [origens, setOrigens] = React.useState<OrigemNaTela[]>([]);
  const [erro, setErro] = React.useState<string | null>(null);
  const [salvando, setSalvando] = React.useState(false);

  // Reabrir o formulário tem que mostrar o que está gravado, não o que
  // sobrou da última edição abandonada.
  React.useEffect(() => {
    if (!open) return;
    setErro(null);
    setModo(estado.emSave ? "gerar" : "consumir");
    setOrigens(
      estado.origens.map((o) => ({ jobOrigemId: o.jobId, valor: o.valor })),
    );
  }, [open, estado]);

  if (!linha) return null;

  const orcado = linha.totalOrcado;
  const faturamentoDaLinha = receitaDeFaturamentoDaLinha(
    orcado,
    linha.tipoCusto,
    percentualHonorarios,
    percentualImposto,
  );
  const totalConsumido = origens.reduce((s, o) => s + o.valor, 0);
  const sobra = orcado - totalConsumido;
  const passouDoOrcado = totalConsumido > orcado + 0.005;

  const saldoDe = (jobId: string) => saldos.find((s) => s.jobId === jobId);
  const naoEscolhidos = saldos.filter(
    (s) => !origens.some((o) => o.jobOrigemId === s.jobId) && s.disponivel > 0,
  );

  async function aplicar() {
    if (!editavel) return;
    setSalvando(true);
    setErro(null);
    const r =
      modo === "gerar"
        ? await onMarcarSave!(true)
        : await onSalvarConsumo!(origens.filter((o) => o.valor > 0));
    setSalvando(false);
    if (!r.ok) {
      setErro(r.message ?? "Não foi possível gravar.");
      return;
    }
    onOpenChange(false);
  }

  async function remover() {
    if (!editavel) return;
    setSalvando(true);
    setErro(null);
    const r = estado.emSave
      ? await onMarcarSave!(false)
      : await onSalvarConsumo!([]);
    setSalvando(false);
    if (!r.ok) {
      setErro(r.message ?? "Não foi possível remover.");
      return;
    }
    onOpenChange(false);
  }

  const temAlgumSave = estado.emSave || estado.origens.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl gap-0 overflow-hidden p-0">
        <div className="border-b border-border px-5 py-4">
          <DialogTitle className="text-[15px] font-bold">
            Save · {linha.nome}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Definir o save desta linha do orçamento.
          </DialogDescription>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Pastilha>{linha.grupoNome}</Pastilha>
            <Pastilha>Tipo {linha.tipoCusto}</Pastilha>
            <Pastilha destaque>
              {formatCurrency(orcado, moeda)} orçados
            </Pastilha>
            <Pastilha>
              {estado.emSave
                ? "Gera crédito"
                : estado.origens.length > 0
                  ? `Paga por ${estado.origens.length} job${estado.origens.length > 1 ? "s" : ""}`
                  : "Sem save definido"}
            </Pastilha>
          </div>
        </div>

        {/* Abas */}
        <div className="px-5 pt-3.5">
          <div className="inline-flex rounded-[10px] border border-border bg-muted/60 p-[3px]">
            {(["gerar", "consumir"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setModo(m)}
                disabled={!editavel}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60",
                  modo === m
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {m === "gerar"
                  ? "Gerar save nesta linha"
                  : "Consumir save de outro job"}
              </button>
            ))}
          </div>
        </div>

        <div className="max-h-[52vh] overflow-auto px-5 pb-1 pt-4">
          {modo === "gerar" ? (
            <ModoGerar
              orcado={orcado}
              faturamento={faturamentoDaLinha}
              moeda={moeda}
              percentualHonorarios={percentualHonorarios}
              percentualImposto={percentualImposto}
              estado={estado}
              clienteNome={clienteNome}
            />
          ) : (
            <ModoConsumir
              origens={origens}
              setOrigens={setOrigens}
              saldos={saldos}
              saldoDe={saldoDe}
              naoEscolhidos={naoEscolhidos}
              moeda={moeda}
              orcado={orcado}
              totalConsumido={totalConsumido}
              sobra={sobra}
              passouDoOrcado={passouDoOrcado}
              editavel={editavel}
            />
          )}
        </div>

        {erro && (
          <p className="mx-5 mb-1 rounded-lg border border-california-red/30 bg-california-red/5 px-3 py-2 text-xs text-california-red">
            {erro}
          </p>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3.5">
          <div>
            {editavel && temAlgumSave && (
              <button
                type="button"
                onClick={remover}
                disabled={salvando}
                className="text-xs font-semibold text-california-red hover:underline disabled:opacity-50"
              >
                Remover save
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={salvando}
            >
              {editavel ? "Cancelar" : "Fechar"}
            </Button>
            {editavel && (
              <Button
                type="button"
                onClick={aplicar}
                disabled={
                  salvando ||
                  (modo === "consumir" && (passouDoOrcado || origens.length === 0)) ||
                  (modo === "gerar" && estado.emSave)
                }
              >
                {salvando ? "Gravando…" : "Aplicar"}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Pastilha({
  children,
  destaque,
}: {
  children: React.ReactNode;
  destaque?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11.5px]",
        destaque
          ? "border-[#c9c6bf] bg-[#f3f2ee] font-mono font-semibold text-foreground"
          : "border-border bg-muted/40 text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

function ModoGerar({
  orcado,
  faturamento,
  moeda,
  percentualHonorarios,
  percentualImposto,
  estado,
  clienteNome,
}: {
  orcado: number;
  faturamento: number;
  moeda: string;
  percentualHonorarios: number;
  percentualImposto: number;
  estado: EstadoSaveDaLinha;
  clienteNome: string;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2.5">
        <ArrowUpRight className="mt-0.5 h-4 w-4 flex-none text-[#5f5d57]" />
        <div>
          <p className="text-sm font-semibold">Esta linha vira save</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            O cliente paga o valor nesta nota, o serviço não acontece neste
            projeto, e o valor vira crédito de {clienteNome} para um projeto
            seguinte. A linha sai do valor do job e continua no faturamento.
          </p>
        </div>
      </div>

      {estado.origens.length > 0 && (
        <div className="flex items-start gap-2.5 rounded-xl border border-california-red/30 bg-california-red/5 px-3.5 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-california-red" />
          <p className="text-xs leading-relaxed text-foreground">
            Esta linha hoje é paga com saldo de{" "}
            {estado.origens.length === 1 ? "um job" : `${estado.origens.length} jobs`}.
            Marcá-la como save desfaz esses consumos e devolve{" "}
            <strong>{formatCurrency(estado.saveConsumido, moeda)}</strong> aos
            saldos de origem.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Numero rotulo="Crédito gerado" valor={orcado} moeda={moeda} forte />
        <Numero
          rotulo="Faturamento desta linha"
          valor={faturamento}
          moeda={moeda}
          nota={`orçado + honorários ${percentualHonorarios}% + impostos ${percentualImposto}%`}
        />
      </div>

      <p className="text-[11.5px] leading-relaxed text-muted-foreground">
        São dois números, e os dois são verdadeiros: o{" "}
        <strong>crédito</strong> é o que o cliente tem a gastar depois; o{" "}
        <strong>faturamento</strong> é o que esta nota cobra por causa desta
        linha.
      </p>

      {estado.emSave && (
        <div className="rounded-xl border border-border bg-muted/30 px-3.5 py-3 text-xs leading-relaxed">
          {estado.destinos.length > 0 ? (
            <>
              <p className="font-semibold">
                O saldo deste job já foi consumido
              </p>
              <p className="mt-1 text-muted-foreground">
                O consumo é feito na planilha do job que gasta, sobre o saldo
                de {clienteNome}:{" "}
                {estado.destinos
                  .map((d) => `${d.codigo} ${formatCurrency(d.valor, moeda)}`)
                  .join(" · ")}
                .
              </p>
            </>
          ) : (
            <>
              <p className="font-semibold">
                Crédito ainda no saldo de {clienteNome}
              </p>
              <p className="mt-1 text-muted-foreground">
                Fica disponível como saldo do cliente. Quem consome é o
                próximo job, na planilha dele.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ModoConsumir({
  origens,
  setOrigens,
  saldos,
  saldoDe,
  naoEscolhidos,
  moeda,
  orcado,
  totalConsumido,
  sobra,
  passouDoOrcado,
  editavel,
}: {
  origens: OrigemNaTela[];
  setOrigens: React.Dispatch<React.SetStateAction<OrigemNaTela[]>>;
  saldos: SaldoDeSave[];
  saldoDe: (id: string) => SaldoDeSave | undefined;
  naoEscolhidos: SaldoDeSave[];
  moeda: string;
  orcado: number;
  totalConsumido: number;
  sobra: number;
  passouDoOrcado: boolean;
  editavel: boolean;
}) {
  const [adicionando, setAdicionando] = React.useState(false);

  if (saldos.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Este cliente ainda não tem saldo de save. O crédito nasce quando um
        job dele é aberto com linhas marcadas como save.
      </p>
    );
  }

  return (
    <div>
      <p className="mb-2.5 text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
        Saldos usados nesta linha
      </p>

      <div className="flex flex-col gap-2">
        {origens.map((o, i) => {
          const s = saldoDe(o.jobOrigemId);
          const sobraDoJob = (s?.disponivel ?? 0) - o.valor;
          return (
            <div
              key={o.jobOrigemId}
              className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3.5 rounded-xl border border-[#d7d5cf] bg-muted/20 px-3 py-2.5"
            >
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="font-mono text-xs font-bold">
                  {s?.codigo ?? "—"}
                </span>
                <span className="text-[13px]">{s?.nome ?? ""}</span>
                <span
                  className={cn(
                    "text-[11.5px]",
                    sobraDoJob < -0.005
                      ? "font-semibold text-california-red"
                      : "text-muted-foreground",
                  )}
                >
                  livre {formatCurrency(s?.disponivel ?? 0, moeda)} · sobra{" "}
                  {formatCurrency(sobraDoJob, moeda)}
                </span>
              </div>
              <input
                inputMode="decimal"
                defaultValue={o.valor.toLocaleString("pt-BR", {
                  minimumFractionDigits: 2,
                })}
                disabled={!editavel}
                onBlur={(e) => {
                  const v = paraNumero(e.target.value);
                  setOrigens((prev) =>
                    prev.map((p, j) => (j === i ? { ...p, valor: v } : p)),
                  );
                  e.target.value = v.toLocaleString("pt-BR", {
                    minimumFractionDigits: 2,
                  });
                }}
                className="h-[34px] w-[150px] rounded-lg border border-[#c9c6bf] px-2.5 text-right font-mono text-[13.5px] font-bold outline-none focus:border-california-red disabled:opacity-60"
              />
              {editavel && (
                <button
                  type="button"
                  title="Remover esta origem"
                  onClick={() =>
                    setOrigens((prev) => prev.filter((_, j) => j !== i))
                  }
                  className="ml-1 rounded-md p-1 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          );
        })}

        {editavel && naoEscolhidos.length > 0 && !adicionando && (
          <button
            type="button"
            onClick={() => setAdicionando(true)}
            className="inline-flex items-center gap-1.5 self-start rounded-[10px] border border-dashed border-[#c9c6bf] bg-card px-3 py-2 text-xs font-semibold text-[#5f5d57] hover:border-[#5f5d57]"
          >
            <Plus className="h-3 w-3" />
            Adicionar outro job
          </button>
        )}

        {adicionando && (
          <div className="rounded-xl border border-dashed border-[#c9c6bf] p-2">
            <p className="px-1 pb-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
              Saldos disponíveis deste cliente
            </p>
            <div className="flex flex-col">
              {naoEscolhidos.map((s) => (
                <button
                  key={s.jobId}
                  type="button"
                  onClick={() => {
                    // Entra já com o que falta para cobrir a linha, limitado
                    // ao que o job tem: é o preenchimento que quase sempre
                    // está certo, e ainda dá para editar.
                    const falta = Math.max(orcado - totalConsumido, 0);
                    setOrigens((prev) => [
                      ...prev,
                      {
                        jobOrigemId: s.jobId,
                        valor: Math.min(falta, s.disponivel),
                      },
                    ]);
                    setAdicionando(false);
                  }}
                  className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-muted"
                >
                  <span className="flex items-baseline gap-2">
                    <span className="font-mono text-xs font-bold">
                      {s.codigo}
                    </span>
                    <span className="text-[13px]">{s.nome}</span>
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {formatCurrency(s.disponivel, moeda)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mt-3.5 grid grid-cols-[1fr_auto] items-baseline gap-x-4">
        <span className="border-t border-border py-2.5 text-sm font-bold">
          Total consumido
        </span>
        <span
          className={cn(
            "whitespace-nowrap border-t border-border py-2.5 text-right font-mono text-[17px] font-bold",
            passouDoOrcado && "text-california-red",
          )}
        >
          {formatCurrency(totalConsumido, moeda)}
        </span>
        <span className="pb-2.5 text-[12.5px] text-muted-foreground">
          {/* O design pedia que fechasse exato com o orçado; o Tiago manteve
              o consumo parcial da decisão 028 §6 — o que sobra é faturado
              normalmente. */}
          {passouDoOrcado
            ? "não pode passar do orçado da linha"
            : sobra > 0.005
              ? "o que sobrar do orçado segue faturado normalmente"
              : "cobre o orçado inteiro da linha"}
        </span>
        <span
          className={cn(
            "flex items-center justify-end gap-1.5 pb-2.5 text-[11.5px] font-semibold",
            passouDoOrcado ? "text-california-red" : "text-muted-foreground",
          )}
        >
          <ArrowDownLeft className="h-3 w-3" />
          {passouDoOrcado
            ? `excede em ${formatCurrency(totalConsumido - orcado, moeda)}`
            : `faturado: ${formatCurrency(Math.max(sobra, 0), moeda)}`}
        </span>
      </div>
    </div>
  );
}

function Numero({
  rotulo,
  valor,
  moeda,
  nota,
  forte,
}: {
  rotulo: string;
  valor: number;
  moeda: string;
  nota?: string;
  forte?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-muted/20 px-3.5 py-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.07em] text-muted-foreground">
        {rotulo}
      </p>
      <p
        className={cn(
          "mt-1 font-mono font-bold",
          forte ? "text-[19px]" : "text-[17px]",
        )}
      >
        {formatCurrency(valor, moeda)}
      </p>
      {nota && (
        <p className="mt-0.5 text-[10.5px] text-muted-foreground">{nota}</p>
      )}
    </div>
  );
}
