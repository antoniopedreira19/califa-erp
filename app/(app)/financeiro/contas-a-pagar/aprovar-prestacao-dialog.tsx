"use client";

/**
 * O pop-up que aprova a prestação de contas da verba (decisão 081).
 *
 * Irmão do `AprovarPPDialog`: aqui também só entra decisão. A conferência —
 * documentos ao lado da PP, valores, quem enviou — acontece na tela de
 * trás. O que se decide é se aprova e, havendo saldo, quando o dinheiro
 * deve voltar: essa data vira a do estorno de verba em Títulos a Pagar.
 *
 * Decisão 189: as NFs da prestação vão para o cadastro de notas do fiscal
 * na aprovação, com o emitente procurado (ou cadastrado) pelo CNPJ. O
 * crédito de PIS/COFINS segue a regra da PP normal — automático, e o
 * financeiro só o tira, com motivo. Fatura e cupom não entram no cadastro.
 */

import * as React from "react";
import { AlertCircle, CheckCircle2, FileCheck2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { CadastroFiscal } from "@/lib/fiscal/cadastro";
import { MOTIVOS_SEM_CREDITO } from "@/lib/fiscal/calculos";
import { creditoDaNf, percentual } from "@/lib/fiscal/nf-da-pp";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { formatCurrency } from "@/lib/utils";
import { aprovarPrestacaoVerba } from "./prestacao-verba-actions";
import { FaixaQuemEnviou } from "./faixa-quem-enviou";
import type { EnvioDaPP } from "@/lib/data/eventos-da-pp";

export interface PrestacaoParaAprovar {
  /** Id da PP de verba. */
  id: string;
  codigo: string;
  valor: number;
  gasto: number;
  saldo: number;
  documentos: number;
  /** Nome do tipo do plano de contas da PP — o do estorno. */
  centroDeCusto: string;
  /** Decisão 136: o último envio da prestação. Quem presta contas é o
   *  administrador, o GP, o produtor ou o freela do job (decisões 164 e
   *  171), e o responsável da verba de produção anterior à 171. */
  envio: EnvioDaPP | null;
  responsavelVerbaNome: string | null;
  /** "Titular da verba" (decisões 164 e 171), ou "Responsável pela verba"
   *  na verba de produção anterior à 171. */
  rotuloQuemRecebe: string;
  gpResponsavelNome: string | null;
  /** Decisão 189: as NFs que a aprovação registra no cadastro de notas,
   *  como estão na conferência (com as correções do financeiro). */
  nfs: Array<{
    documento_id: string;
    numero: string;
    emissao: string;
    valor: number;
    tomador: string;
  }>;
}

const PILULA_DO_CREDITO: Record<"sim" | "nao", { texto: string; tom: string }> = {
  sim: { texto: "Gera crédito", tom: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  nao: { texto: "Não gera crédito", tom: "border-border bg-muted text-muted-foreground" },
};

/** "outubro/2026" → "out/2026". */
function mesCurto(mes: string): string {
  const [nome, ano] = mes.split("/");
  return ano ? `${nome.slice(0, 3)}/${ano}` : mes;
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export function AprovarPrestacaoDialog({
  open,
  onOpenChange,
  prestacao,
  cadastro,
  aguardarCorrecoes,
  onAprovada,
}: {
  open: boolean;
  onOpenChange: (aberto: boolean) => void;
  prestacao: PrestacaoParaAprovar | null;
  /** O cadastro de impostos: o regime do CNPJ tomador e as alíquotas do
   *  crédito de PIS/COFINS das NFs (decisão 189). */
  cadastro: CadastroFiscal;
  /** As correções da conferência que ainda estão indo ao servidor: a
   *  aprovação espera por elas (decisão 189). */
  aguardarCorrecoes: () => Promise<void>;
  onAprovada: (mensagem: string) => void;
}) {
  const [dataPrevista, setDataPrevista] = React.useState("");
  const [erro, setErro] = React.useState<string | null>(null);
  const [semCredito, setSemCredito] = React.useState(false);
  const [motivoSemCredito, setMotivoSemCredito] = React.useState("");
  const [pending, startTransition] = React.useTransition();

  React.useEffect(() => {
    if (!open) return;
    setDataPrevista("");
    setErro(null);
    setSemCredito(false);
    setMotivoSemCredito("");
  }, [open, prestacao?.id]);

  if (!prestacao) return null;
  const alvo = prestacao;
  const temSaldo = alvo.saldo > 0;
  const brl = (n: number) => formatCurrency(n, "BRL");
  const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const creditos = alvo.nfs.map((nf) => ({
    nf,
    credito: creditoDaNf({
      nf: {
        anexo_id: nf.documento_id,
        numero: nf.numero,
        emissao: nf.emissao,
        valor: nf.valor,
        tomador: nf.tomador,
        valor_na_pp: nf.valor,
        cobre_outra: false,
      },
      cadastro,
      semCredito,
      motivoSemCredito,
      hoje,
    }),
  }));
  const podeTirarCredito = creditos.some((c) => c.credito.automatico.gera);

  function aprovar() {
    if (temSaldo && !dataPrevista) {
      setErro("Escolha a data prevista da devolução antes de aprovar.");
      return;
    }
    if (semCredito && podeTirarCredito && !motivoSemCredito) {
      setErro("Escolha por que a NF não gera crédito de PIS/COFINS.");
      return;
    }
    startTransition(async () => {
      await aguardarCorrecoes();
      const res = await aprovarPrestacaoVerba({
        pp_id: alvo.id,
        data_prevista: temSaldo ? dataPrevista : null,
        notas: creditos.map((c) => ({
          documento_id: c.nf.documento_id,
          credito_retirado: c.credito.tirado,
          credito_motivo: c.credito.tirado ? motivoSemCredito : null,
        })),
      });
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      onAprovada(
        temSaldo
          ? `Prestação de ${alvo.codigo} aprovada · estorno de verba de ${brl(alvo.saldo)} para ${formatDate(dataPrevista)}.`
          : `Prestação de ${alvo.codigo} aprovada · a verba foi toda comprovada.`,
      );
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* `z-[60]`: aberto de dentro da tela cheia da PP, que está em `z-[55]`. */}
      <DialogContent className="z-[60] max-w-md" overlayClassName="z-[60]">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-baseline gap-2">
            <span>Aprovar prestação</span>
            <span className="font-mono text-california-red">{alvo.codigo}</span>
          </DialogTitle>
          <DialogDescription>
            {alvo.documentos === 0 ? (
              <>Verba de {brl(alvo.valor)} · sem gasto: a verba volta inteira.</>
            ) : (
              <>
                Verba de {brl(alvo.valor)} · {alvo.documentos}{" "}
                {alvo.documentos === 1 ? "documento conferido" : "documentos conferidos"}.
              </>
            )}
          </DialogDescription>
          {alvo.envio && (
            <FaixaQuemEnviou
              className="mt-2"
              rotulo={alvo.envio.reenviada ? "Prestação reenviada por" : "Prestação enviada por"}
              nome={alvo.envio.por_nome}
              em={alvo.envio.em}
              referencia={`${alvo.rotuloQuemRecebe}: ${alvo.responsavelVerbaNome ?? "—"} · GP responsável do job: ${alvo.gpResponsavelNome ?? "—"}`}
            />
          )}
        </DialogHeader>

        <div className="space-y-4">
          {erro && (
            <div className="flex items-start gap-2 rounded-lg border border-california-red/40 bg-california-red/5 p-3 text-sm text-california-red">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{erro}</span>
            </div>
          )}

          <div className="space-y-1.5 rounded-lg border border-border bg-muted/30 p-3 text-sm">
            <div className="flex justify-between">
              <span>Gasto comprovado</span>
              <span className="font-mono font-semibold">{brl(alvo.gasto)}</span>
            </div>
            {temSaldo ? (
              <div className="flex justify-between rounded-md bg-teal-50 px-2 py-1.5 font-semibold text-teal-800">
                <span>Estorno do saldo</span>
                <span className="font-mono">−{brl(alvo.saldo)}</span>
              </div>
            ) : (
              <p className="text-[12px] text-muted-foreground">
                Sem saldo: a verba foi toda comprovada.
              </p>
            )}
          </div>

          {/* Decisão 189: a NF da verba entra no cadastro de notas do
              fiscal, como a de qualquer PP. */}
          {creditos.length > 0 && (
            <div className="space-y-2 rounded-lg border border-border px-3 py-2.5">
              <p className="flex items-start gap-2 text-[12px]">
                <FileCheck2 className="mt-0.5 h-3.5 w-3.5 flex-none text-muted-foreground" />
                <span>
                  {creditos.length === 1 ? "1 NF vai" : `${creditos.length} NFs vão`} para o cadastro de notas
                  do fiscal: <span className="font-mono">{creditos.map((c) => c.nf.numero).join(", ")}</span>. O
                  emitente sem cadastro entra em Fornecedores, sem dados de pagamento.
                </span>
              </p>
              <p className="text-[12px] font-bold">Crédito de PIS/COFINS</p>
              {creditos.map(({ nf, credito }) => (
                <div key={nf.documento_id} className="space-y-0.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px]">
                    <span
                      className={cn(
                        "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                        PILULA_DO_CREDITO[credito.final.estado].tom,
                      )}
                    >
                      {PILULA_DO_CREDITO[credito.final.estado].texto}
                    </span>
                    <b
                      title={`PIS ${percentual(credito.aliquotaPis)} ${brl(credito.final.pis)} + COFINS ${percentual(credito.aliquotaCofins)} ${brl(credito.final.cofins)}`}
                      className={cn(
                        "font-mono font-semibold",
                        !credito.final.gera && "text-muted-foreground line-through decoration-muted-foreground/60",
                      )}
                    >
                      {brl(credito.final.total)}
                    </b>
                    <span className={cn("text-muted-foreground", !credito.final.gera && "line-through")}>
                      {creditos.length > 1 && `NF ${nf.numero} · `}
                      {credito.final.mes ? mesCurto(credito.final.mes) : "mês da emissão"}
                    </span>
                  </div>
                  {!credito.automatico.gera && (
                    <p className="text-[11px] leading-snug text-muted-foreground">{credito.automatico.motivo}</p>
                  )}
                </div>
              ))}
              {podeTirarCredito && (
                <>
                  <label className="flex w-fit cursor-pointer items-center gap-2 text-[12.5px] font-semibold">
                    <Checkbox
                      checked={semCredito}
                      disabled={pending}
                      onCheckedChange={(c) => {
                        setSemCredito(c === true);
                        if (c !== true) setMotivoSemCredito("");
                        setErro(null);
                      }}
                      aria-label="Não gera crédito"
                      className="rounded-[4px]"
                    />
                    Não gera crédito
                  </label>
                  {semCredito && (
                    <Select
                      value={motivoSemCredito === "" ? undefined : motivoSemCredito}
                      disabled={pending}
                      onValueChange={(x) => {
                        setMotivoSemCredito(x);
                        setErro(null);
                      }}
                    >
                      <SelectTrigger aria-label="Motivo" className="h-9 w-full text-xs">
                        <SelectValue placeholder="Motivo de não gerar crédito *" />
                      </SelectTrigger>
                      <SelectContent>
                        {MOTIVOS_SEM_CREDITO.map((m) => (
                          <SelectItem key={m} value={m} className="text-xs">
                            {m}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </>
              )}
            </div>
          )}

          {temSaldo && (
            <div className="space-y-2">
              <p className="text-sm font-bold">
                Data prevista da devolução <span className="text-california-red">*</span>
              </p>
              <DatePicker
                id="aprovar-prestacao-data-prevista"
                name="aprovar_prestacao_data_prevista"
                onDateChange={(d) => {
                  setDataPrevista(
                    d
                      ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
                      : "",
                  );
                  setErro(null);
                }}
              />
              <p className="text-[11px] text-muted-foreground">
                Quando o dinheiro deve voltar à conta. Vira a data do estorno de verba em Títulos a Pagar.
              </p>
            </div>
          )}

          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-[12px]">
            <span className="text-muted-foreground">Centro de custo</span>
            <strong>{alvo.centroDeCusto}</strong>
          </div>
          <p className="text-[11px] text-muted-foreground">
            O mesmo da PP.
            {temSaldo
              ? ` O realizado do item deixa de contar os ${brl(alvo.saldo)} não gastos.`
              : ""}
          </p>

          <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
            <span className="text-[11px] text-muted-foreground">
              {temSaldo ? "Cria 1 estorno em Títulos a Pagar" : "Não cria título"}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                disabled={pending}
                className="rounded-lg border border-border bg-white px-3.5 py-2 text-sm font-semibold hover:bg-muted disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={aprovar}
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                {pending ? "Aprovando…" : "Aprovar prestação"}
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
