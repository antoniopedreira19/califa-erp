"use client";

/**
 * Os diálogos de Impostos a Pagar (módulo fiscal, entrega 2 — desenho
 * aprovado pelo Tiago no protótipo de 30/09 a 02/10/2026):
 *
 * - **Dar baixa** (`BaixaImpostoDialog`, exportado: a aba Títulos da
 *   conciliação abre o mesmo, com a conta da conciliação já escolhida);
 * - **Baixa registrada** — conferir e, se preciso, cancelar com motivo;
 * - **Corrigir valor** — a guia da contabilidade veio diferente;
 * - **Lançamento avulso** — o imposto que não passou pela apuração.
 *
 * Tudo grava pelas Server Actions de `actions.ts`, que chamam as funções do
 * banco (a baixa vira um lançamento por parte do rateio, mais o de multa e
 * juros, e a conciliação mostra uma linha só).
 */

import * as React from "react";
import { format } from "date-fns";
import { AlertCircle, AlertTriangle, CreditCard, Eye, Pencil, Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { MoneyInput } from "@/components/ui/money-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { RateioLinhaInput } from "@/lib/types";
import { codigoDarf } from "@/lib/fiscal/codigos-darf";
import { nomeDoMes } from "@/lib/fiscal/datas";
import { RateioRegionalEditor } from "@/app/(app)/financeiro/contas-a-pagar/rateio-regional-editor";
import { CampoAnexo, LinkAnexo, useCampoDeAnexo } from "@/components/financeiro/anexo-de-imposto";
import {
  cancelarBaixaImposto,
  corrigirImposto,
  criarImpostoAvulso,
  darBaixaImposto,
} from "./actions";
import type {
  ContaDaBaixaDeImposto,
  DadosDosImpostos,
  ImpostoDaLista,
} from "./dados";

// ---------------------------------------------------------------------------
// Peças comuns
// ---------------------------------------------------------------------------

/** O centro de custo de cada imposto — o mesmo que `baixar_imposto` grava. */
export const CENTRO: Record<string, string> = {
  ISS: "03 · Custo Tributário · ISS",
  PIS: "03 · Custo Tributário · PIS",
  COFINS: "03 · Custo Tributário · COFINS",
  IRPJ: "03 · Custo Tributário · IRPJ",
  CSLL: "03 · Custo Tributário · CSLL",
  ISS_RET: "02 · Custo Operacional (repasse do ISS retido)",
  CSRF: "02 · Custo Operacional (repasse da CSRF retida)",
  IRRF: "02 · Custo Operacional (repasse do IRRF retido)",
  OUTRO: "03 · Custo Tributário · Outros",
};

export const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

export const moeda = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function br(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** Hoje em ISO local — `toISOString` volta em UTC e erra o dia à noite. */
export function hojeIso(): string {
  return format(new Date(), "yyyy-MM-dd");
}

export function somaDias(iso: string, dias: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const base = new Date(y, m - 1, d + dias);
  return format(base, "yyyy-MM-dd");
}

/** "PIS · cota 1/3". */
export const nomeDoImposto = (t: Pick<ImpostoDaLista, "titulo" | "cota_numero" | "cota_total">) =>
  `${t.titulo}${t.cota_numero ? ` · cota ${t.cota_numero}/${t.cota_total}` : ""}`;

/** O imposto do fornecedor que a agência só repassa (retido na fonte). */
const ehRetencao = (tributo: string) => tributo === "CSRF" || tributo === "IRRF" || tributo === "ISS_RET";

function Erro({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-california-red/40 bg-california-red/5 p-3 text-sm text-california-red">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

function Resumo({ t }: { t: ImpostoDaLista }) {
  return (
    <div className="grid grid-cols-[max-content_1fr_max-content_1fr] gap-x-4 gap-y-1.5 rounded-xl border border-border bg-muted/40 p-4 text-[13px]">
      <span className="text-muted-foreground">Imposto</span>
      <span className="font-semibold">
        {nomeDoImposto(t)}
        {t.codigo_receita && (
          <span className="ml-1 font-mono text-xs font-normal text-muted-foreground">DARF {t.codigo_receita}</span>
        )}
      </span>
      <span className="text-muted-foreground">Competência</span>
      <span>{t.rotulo_competencia}</span>
      <span className="text-muted-foreground">CNPJ</span>
      <span className="text-xs">
        {t.local} · <span className="font-mono">{t.cnpj}</span>
      </span>
      <span className="text-muted-foreground">Vencimento</span>
      <span className="font-mono text-xs">{br(t.vencimento)}</span>
    </div>
  );
}

function RateioPrevia({ t, total, multaJuros }: { t: ImpostoDaLista; total: number; multaJuros: number }) {
  return (
    <div className="rounded-xl border border-border">
      <p className="border-b border-border px-3 py-2 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
        Na conciliação: uma linha de {moeda(total)}, que se abre assim
      </p>
      <table className="w-full text-[12px]">
        <tbody>
          {t.rateio.map((r, i) => (
            <tr key={`${r.empresa_id}|${r.regional_id ?? ""}|${i}`} className="border-b border-border/70 last:border-0">
              <td className="px-3 py-1.5">
                {r.empresa}
                {r.regional && <span className="text-muted-foreground"> · {r.regional}</span>}
              </td>
              <td className="px-3 py-1.5 text-muted-foreground">{CENTRO[t.tributo] ?? CENTRO.OUTRO}</td>
              <td className="px-3 py-1.5 text-right font-mono">{moeda(r.valor)}</td>
            </tr>
          ))}
          {multaJuros > 0 && (
            <tr>
              <td className="px-3 py-1.5">Multa e juros</td>
              <td className="px-3 py-1.5 text-muted-foreground">11 · Despesa com Juros</td>
              <td className="px-3 py-1.5 text-right font-mono">{moeda(multaJuros)}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dar baixa
// ---------------------------------------------------------------------------

export interface BaixaDeImpostoFeita {
  mensagem: string;
  pago_em: string;
  conta_bancaria_id: string;
}

/**
 * A baixa de um imposto: data, conta, multa e juros (11 · Despesa com
 * Juros), a guia (já vem a da aprovação) e o comprovante, com a prévia do
 * rateio que a conciliação vai mostrar. Montado só enquanto aberto.
 */
export function BaixaImpostoDialog({
  imposto: t,
  contas,
  nomesDasPJs,
  tenantId,
  contaInicial,
  onClose,
  onBaixado,
}: {
  imposto: ImpostoDaLista;
  /** As contas ativas, sem as contas-espelho de cartão. */
  contas: ContaDaBaixaDeImposto[];
  /** PJ → nome, para o aviso "a guia é da X e a conta é da Y". */
  nomesDasPJs: Record<string, string>;
  tenantId: string;
  /** A conta já escolhida (a da conciliação aberta). */
  contaInicial?: string | null;
  onClose: () => void;
  onBaixado: (feita: BaixaDeImpostoFeita) => void;
}) {
  const [pending, startTransition] = React.useTransition();
  const [data, setData] = React.useState<string>(hojeIso);
  const [conta, setConta] = React.useState<string>(
    contaInicial && contas.some((c) => c.id === contaInicial) ? contaInicial : "",
  );
  const [multa, setMulta] = React.useState(0);
  const guia = useCampoDeAnexo(t.guia_path);
  const comprovante = useCampoDeAnexo(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [faltando, setFaltando] = React.useState<Set<string>>(new Set());

  const contaEscolhida = contas.find((c) => c.id === conta) ?? null;
  const atrasado = Boolean(data) && data > t.vencimento;
  const diasDeAtraso = atrasado ? Math.round((Date.parse(data) - Date.parse(t.vencimento)) / 86400000) : 0;
  const total = r2(t.valor + multa);

  function fechar() {
    if (pending) return;
    guia.descartarEnviados();
    comprovante.descartarEnviados();
    onClose();
  }

  function confirmar() {
    const falta = new Set<string>();
    if (!data) falta.add("data");
    if (!contaEscolhida) falta.add("conta");
    if (!guia.path) falta.add("guia");
    if (!comprovante.path) falta.add("comprovante");
    setFaltando(falta);
    if (falta.has("data")) return setErro("Informe a data do pagamento.");
    if (falta.has("conta")) return setErro("Selecione a conta que pagou a guia.");
    if (falta.has("guia")) return setErro("Anexe a guia (DARF ou guia municipal).");
    if (falta.has("comprovante")) return setErro("Anexe o comprovante de pagamento.");
    setErro(null);
    const nomeDaConta = contaEscolhida?.nome ?? "";
    startTransition(async () => {
      const res = await darBaixaImposto({
        imposto_id: t.id,
        pago_em: data,
        conta_bancaria_id: conta,
        multa_juros: multa,
        // A da aprovação vai como nula: o banco usa a que o imposto já tem.
        guia_path: guia.path === t.guia_path ? null : guia.path,
        comprovante_path: comprovante.path ?? "",
        valor_confirmado: t.valor,
      }).catch(() => ({ ok: false as const, message: "Não foi possível dar baixa. Tente novamente." }));
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      guia.confirmar();
      comprovante.confirmar();
      onBaixado({
        mensagem: `Baixa registrada: ${moeda(total)} saíram de ${nomeDaConta} em ${br(data)}. A linha já está na conciliação.`,
        pago_em: data,
        conta_bancaria_id: conta,
      });
    });
  }

  const pjDaConta = contaEscolhida ? contaEscolhida.empresa_contabil_id : null;

  return (
    <Dialog open onOpenChange={(o) => !o && fechar()}>
      <DialogContent className="sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-emerald-600" />
            Dar baixa no imposto
          </DialogTitle>
          <DialogDescription className="sr-only">
            Data, conta, multa e juros, guia e comprovante do pagamento do imposto.
          </DialogDescription>
        </DialogHeader>
        <Resumo t={t} />
        {erro && <Erro>{erro}</Erro>}
        <div className="space-y-3">
          <div className="grid grid-cols-2 items-start gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold">
                Data do pagamento <span className="text-california-red">*</span>
              </label>
              <DatePicker
                name="pago_em"
                defaultValue={data}
                onDateChange={(d) => {
                  setData(d ? format(d, "yyyy-MM-dd") : "");
                  setErro(null);
                }}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold">
                Conta que pagou <span className="text-california-red">*</span>
              </label>
              <Select
                value={conta || undefined}
                onValueChange={(v) => {
                  setConta(v);
                  setErro(null);
                }}
              >
                <SelectTrigger className={cn(faltando.has("conta") && !contaEscolhida && "border-california-red")}>
                  <SelectValue placeholder="Selecione a conta..." />
                </SelectTrigger>
                <SelectContent>
                  {contas.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">Nenhuma conta bancária ativa.</div>
                  ) : (
                    contas.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.nome} · {c.banco}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              {pjDaConta && pjDaConta !== t.empresa_contabil_id ? (
                <p className="flex items-center gap-1 text-[11px] font-medium text-amber-700">
                  <AlertTriangle className="h-3 w-3 flex-none" />
                  A guia é da {t.pj} e a conta é da {nomesDasPJs[pjDaConta] ?? "outra empresa"}.
                </p>
              ) : (
                <p className="text-[11px] text-muted-foreground">A guia é do CNPJ da {t.pj}.</p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-3 items-start gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold">Valor do imposto</label>
              <div className="flex h-11 items-center rounded-xl border border-border bg-muted/40 px-3.5 font-mono text-sm">
                {moeda(t.valor)}
              </div>
              {t.juros > 0 && <p className="text-[11px] text-muted-foreground">inclui juros da cota: {moeda(t.juros)}</p>}
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold">Multa e juros</label>
              <MoneyInput value={multa} onValueChange={setMulta} aria-label="Multa e juros" />
              <p className={cn("text-[11px]", atrasado ? "font-semibold text-california-red" : "text-muted-foreground")}>
                {atrasado
                  ? `Pago ${diasDeAtraso} ${diasDeAtraso === 1 ? "dia" : "dias"} depois do vencimento: informe o que veio na guia.`
                  : "Só quando a guia vier com acréscimo."}
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold">Total pago</label>
              <div className="flex h-11 items-center rounded-xl border border-border bg-white px-3.5 font-mono text-sm font-bold">
                {moeda(total)}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <CampoAnexo
              rotulo="Guia (DARF ou guia municipal)"
              obrigatorio
              path={guia.path}
              onChange={guia.trocar}
              tenantId={tenantId}
              pasta="guias"
              dica={t.guia_path && guia.path === t.guia_path ? "Anexada na aprovação." : undefined}
              aceita="PDF"
              destacar={faltando.has("guia") && !guia.path}
            />
            <CampoAnexo
              rotulo="Comprovante de pagamento"
              obrigatorio
              path={comprovante.path}
              onChange={comprovante.trocar}
              tenantId={tenantId}
              pasta="comprovantes"
              destacar={faltando.has("comprovante") && !comprovante.path}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold">Centro de custo</label>
            <div className="rounded-xl border border-border bg-muted/40 px-3.5 py-2.5 text-sm">
              {CENTRO[t.tributo] ?? CENTRO.OUTRO}
              {multa > 0 && <span className="text-muted-foreground"> · multa e juros em 11 · Despesa com Juros</span>}
            </div>
            {ehRetencao(t.tributo) && (
              <p className="text-[11px] text-muted-foreground">
                Guia de retenção: é o imposto do fornecedor que a agência só repassa. Fica no custo da PP de origem, que
                assim aparece completo (líquido pago + guia).
              </p>
            )}
          </div>
          <RateioPrevia t={t} total={total} multaJuros={multa} />
        </div>
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={fechar}
            disabled={pending}
            className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={confirmar}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <CreditCard className="h-4 w-4" />
            {pending ? "Confirmando..." : "Confirmar baixa"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Baixa registrada
// ---------------------------------------------------------------------------

export function BaixaRegistradaDialog({
  imposto: t,
  onClose,
  onCancelada,
}: {
  imposto: ImpostoDaLista;
  onClose: () => void;
  onCancelada: (mensagem: string) => void;
}) {
  const [pending, startTransition] = React.useTransition();
  const [cancelando, setCancelando] = React.useState(false);
  const [motivo, setMotivo] = React.useState("");
  const [erro, setErro] = React.useState<string | null>(null);
  const pago = t.status === "pago";

  function cancelar() {
    setErro(null);
    startTransition(async () => {
      const res = await cancelarBaixaImposto({ imposto_id: t.id, motivo: motivo.trim() }).catch(() => ({
        ok: false as const,
        message: "Não foi possível cancelar a baixa. Tente novamente.",
      }));
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      onCancelada("Baixa cancelada: o lançamento saiu da conciliação e o imposto voltou a A pagar.");
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5 text-california-red" />
            Baixa registrada
          </DialogTitle>
          <DialogDescription className="sr-only">O pagamento registrado deste imposto.</DialogDescription>
        </DialogHeader>
        <Resumo t={t} />
        {erro && <Erro>{erro}</Erro>}
        {pago ? (
          <div className="space-y-2 rounded-xl border border-border p-4 text-[13px]">
            <div className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5">
              <span className="text-muted-foreground">Pago em</span>
              <span className="font-mono text-xs">
                {br(t.pago_em)} · {t.conta_nome ?? "—"}
              </span>
              <span className="text-muted-foreground">Imposto</span>
              <span className="font-mono text-xs">{moeda(t.valor)}</span>
              {t.multa_juros > 0 && (
                <>
                  <span className="text-muted-foreground">Multa e juros</span>
                  <span className="font-mono text-xs">{moeda(t.multa_juros)} · 11 · Despesa com Juros</span>
                </>
              )}
              <span className="text-muted-foreground">Total</span>
              <span className="font-mono text-xs font-bold">{moeda(r2(t.valor + t.multa_juros))}</span>
              <span className="text-muted-foreground">Guia</span>
              <span className="min-w-0 text-xs">
                <LinkAnexo path={t.guia_path} />
              </span>
              <span className="text-muted-foreground">Comprovante</span>
              <span className="min-w-0 text-xs">
                <LinkAnexo path={t.comprovante_path} />
              </span>
              <span className="text-muted-foreground">Registrada por</span>
              <span className="text-xs">{t.baixado_por_nome ?? "—"}</span>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Sem baixa.</p>
        )}
        {t.correcoes.length > 0 && (
          <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-amber-900">
            <div className="min-w-0">
              Valor corrigido:{" "}
              {t.correcoes
                .map((c) => `${moeda(c.de)} → ${moeda(c.para)} em ${br(c.criado_em)} (${c.justificativa})`)
                .join("; ")}
            </div>
          </div>
        )}
        {cancelando ? (
          <div className="space-y-2 rounded-xl border border-california-red/30 bg-california-red/[0.04] p-3">
            <label className="text-xs font-semibold">
              Motivo do cancelamento <span className="text-california-red">*</span>
            </label>
            <Textarea
              rows={2}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex.: baixa lançada na conta errada."
            />
            <p className="text-[11.5px] text-muted-foreground">
              Cancelar tira o lançamento do extrato e o imposto volta a A pagar (decisão 120). O motivo precisa de pelo
              menos 10 caracteres.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCancelando(false)}
                disabled={pending}
                className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
              >
                Voltar
              </button>
              <button
                type="button"
                disabled={motivo.trim().length < 10 || pending}
                onClick={cancelar}
                className="rounded-lg bg-california-red px-3 py-2 text-sm font-semibold text-white hover:bg-california-red-hover disabled:opacity-50"
              >
                {pending ? "Cancelando..." : "Cancelar esta baixa"}
              </button>
            </div>
          </div>
        ) : (
          pago && (
            <div className="flex justify-between gap-2 border-t border-border pt-4">
              <button
                type="button"
                onClick={() => setCancelando(true)}
                className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:border-california-red hover:text-california-red"
              >
                Cancelar esta baixa
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
              >
                Fechar
              </button>
            </div>
          )
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Corrigir valor
// ---------------------------------------------------------------------------

export function CorrigirDialog({
  imposto: t,
  tenantId,
  onClose,
  onCorrigido,
}: {
  imposto: ImpostoDaLista;
  tenantId: string;
  onClose: () => void;
  onCorrigido: (mensagem: string) => void;
}) {
  const [pending, startTransition] = React.useTransition();
  const [para, setPara] = React.useState(t.valor);
  const [just, setJust] = React.useState("");
  const anexo = useCampoDeAnexo(null);
  const [erro, setErro] = React.useState<string | null>(null);

  function fechar() {
    if (pending) return;
    anexo.descartarEnviados();
    onClose();
  }

  function confirmar() {
    if (Math.abs(para - t.valor) < 0.01) return setErro("O valor novo é igual ao atual.");
    if (!(para > 0)) return setErro("Informe o valor corrigido.");
    if (t.juros > 0 && para <= t.juros) return setErro("O valor corrigido precisa ser maior que os juros da cota.");
    if (just.trim().length < 10) return setErro("Explique o motivo da correção (mínimo 10 caracteres).");
    setErro(null);
    startTransition(async () => {
      const res = await corrigirImposto({
        imposto_id: t.id,
        valor: para,
        justificativa: just.trim(),
        anexo_path: anexo.path,
      }).catch(() => ({ ok: false as const, message: "Não foi possível corrigir o valor. Tente novamente." }));
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      anexo.confirmar();
      onCorrigido(`Valor corrigido para ${moeda(para)}. O calculado e o aprovado ficam no histórico.`);
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && fechar()}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-5 w-5 text-california-red" />
            Corrigir valor
          </DialogTitle>
          <DialogDescription>Quando a contabilidade manda a guia com outro valor depois da aprovação.</DialogDescription>
        </DialogHeader>
        <Resumo t={t} />
        {erro && <Erro>{erro}</Erro>}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold">Valor atual</label>
            <div className="flex h-11 items-center rounded-xl border border-border bg-muted/40 px-3.5 font-mono text-sm">
              {moeda(t.valor)}
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold">
              Valor novo <span className="text-california-red">*</span>
            </label>
            <MoneyInput
              value={para}
              onValueChange={(v) => {
                setPara(v);
                setErro(null);
              }}
              aria-label="Valor novo"
            />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold">
            Motivo <span className="text-california-red">*</span>
          </label>
          <Textarea
            rows={3}
            value={just}
            onChange={(e) => {
              setJust(e.target.value);
              setErro(null);
            }}
            placeholder="Ex.: a contabilidade reemitiu a guia com o crédito de energia."
          />
        </div>
        <CampoAnexo
          rotulo="Guia nova (opcional)"
          path={anexo.path}
          onChange={anexo.trocar}
          tenantId={tenantId}
          pasta="correcoes"
          aceita="PDF"
        />
        {t.correcoes.length > 0 && (
          <div className="rounded-xl border border-border p-3 text-[12px]">
            <p className="mb-1 font-semibold">Correções anteriores</p>
            {t.correcoes.map((c) => (
              <p key={c.id} className="text-muted-foreground">
                {br(c.criado_em)} · {moeda(c.de)} → {moeda(c.para)} · {c.justificativa} · {c.autor}
              </p>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={fechar}
            disabled={pending}
            className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={confirmar}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-3 py-2 text-sm font-semibold text-white hover:bg-california-red-hover disabled:opacity-50"
          >
            {pending ? "Salvando..." : "Salvar correção"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Lançamento avulso
// ---------------------------------------------------------------------------

type TributoDoAvulso = "ISS" | "PIS" | "COFINS" | "IRPJ" | "CSLL" | "ISS_RET" | "CSRF" | "IRRF" | "OUTRO";

/** Os impostos do avulso, com o nome que o título leva (protótipo aprovado). */
const IMPOSTOS_AVULSO: Array<[TributoDoAvulso, string]> = [
  ["ISS", "ISS próprio"],
  ["PIS", "PIS"],
  ["COFINS", "COFINS"],
  ["IRPJ", "IRPJ"],
  ["CSLL", "CSLL"],
  ["ISS_RET", "ISS retido de fornecedores"],
  ["CSRF", "PIS/COFINS/CSLL retidos de fornecedores"],
  ["IRRF", "IRRF retido de fornecedores"],
  ["OUTRO", "Outro"],
];

const ehMunicipal = (tributo: string) => tributo === "ISS" || tributo === "ISS_RET";

/** "2026-T4" → "4º trimestre/2026"; "2026-10" → "outubro/2026". */
export function rotuloDaCompetencia(c: string): string {
  if (c.includes("-T")) {
    const [y, q] = c.split("-T");
    return `${q}º trimestre/${y}`;
  }
  return nomeDoMes(c);
}

/** As competências do avulso: os meses de um ano para trás até o próximo,
 *  e os trimestres deste ano e do anterior, do mais novo ao mais antigo. */
function competenciasDoAvulso(hoje: string): string[] {
  const [y, m] = hoje.split("-").map(Number);
  const meses: string[] = [];
  for (let i = 1; i >= -12; i--) {
    const d = new Date(y, m - 1 + i, 1);
    meses.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  const trimestreAtual = Math.ceil(m / 3);
  const trimestres: string[] = [];
  for (let q = trimestreAtual; q >= 1; q--) trimestres.push(`${y}-T${q}`);
  for (let q = 4; q >= 1; q--) trimestres.push(`${y - 1}-T${q}`);
  return [...meses, ...trimestres];
}

export function AvulsoDialog({
  dados,
  onClose,
  onCriado,
}: {
  dados: Pick<DadosDosImpostos, "tenantId" | "estabelecimentos" | "regimePorPJ" | "regionais">;
  onClose: () => void;
  /** `comBaixa`: "Criar e dar baixa" — a tela abre a baixa do novo imposto. */
  onCriado: (id: string, comBaixa: boolean, mensagem: string) => void;
}) {
  const [pending, startTransition] = React.useTransition();
  const hoje = React.useMemo(() => hojeIso(), []);
  const [imposto, setImposto] = React.useState<TributoDoAvulso | "">("");
  const [estabId, setEstabId] = React.useState("");
  const [competencia, setCompetencia] = React.useState("");
  const [venc, setVenc] = React.useState(() => somaDias(hoje, 5));
  const [valor, setValor] = React.useState(0);
  const [codigo, setCodigo] = React.useState("");
  const [descricao, setDescricao] = React.useState("");
  const [rateio, setRateio] = React.useState<RateioLinhaInput[]>([{ regional_id: "", percentual: 100 }]);
  const guia = useCampoDeAnexo(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const competencias = React.useMemo(() => competenciasDoAvulso(hoje), [hoje]);

  const estab = dados.estabelecimentos.find((e) => e.id === estabId) ?? null;
  /** O DARF que o imposto leva no regime da PJ (vazio = este). */
  const codigoSugerido =
    imposto && imposto !== "OUTRO" && !ehMunicipal(imposto) && estab
      ? codigoDarf(imposto, dados.regimePorPJ[estab.empresa_contabil_id] ?? "lucro_real")
      : null;

  function fechar() {
    if (pending) return;
    guia.descartarEnviados();
    onClose();
  }

  function criar(comBaixa: boolean) {
    if (!imposto) return setErro("Escolha o imposto.");
    if (!estab) return setErro("Escolha o CNPJ.");
    if (!competencia) return setErro("Escolha a competência.");
    if (!venc) return setErro("Informe o vencimento.");
    if (!(valor > 0)) return setErro("Informe o valor.");
    if (descricao.trim().length < 3) return setErro("Descreva o lançamento.");
    const soma = rateio.reduce((s, r) => s + r.percentual, 0);
    if (rateio.some((r) => !r.regional_id) || Math.abs(soma - 100) > 0.01) {
      return setErro("O rateio precisa somar 100% e ter as regionais escolhidas.");
    }
    // O valor de cada parte; a última fecha a conta (o banco confere a soma).
    const total = r2(valor);
    let acumulado = 0;
    const partes: Array<{ empresa_id: string; regional_id: string; valor: number }> = [];
    for (let i = 0; i < rateio.length; i++) {
      const r = rateio[i];
      const regional = dados.regionais.find((x) => x.id === r.regional_id);
      if (!regional) return setErro("O rateio precisa somar 100% e ter as regionais escolhidas.");
      const parte = i === rateio.length - 1 ? r2(total - acumulado) : r2((total * r.percentual) / 100);
      if (!(parte > 0)) return setErro("O valor é pequeno demais para este rateio.");
      acumulado = r2(acumulado + parte);
      partes.push({ empresa_id: regional.empresa_id, regional_id: regional.id, valor: parte });
    }
    const titulo = IMPOSTOS_AVULSO.find(([k]) => k === imposto)?.[1] ?? "Outro";
    setErro(null);
    startTransition(async () => {
      const res = await criarImpostoAvulso({
        tributo: imposto,
        titulo,
        codigo_receita: codigo.trim() || codigoSugerido || null,
        empresa_contabil_id: estab.empresa_contabil_id,
        estabelecimento_id: ehMunicipal(imposto) ? estab.id : null,
        competencia,
        rotulo_competencia: rotuloDaCompetencia(competencia),
        descricao: descricao.trim(),
        vencimento: venc,
        valor: total,
        rateio: partes,
        guia_path: guia.path,
      }).catch(() => ({ ok: false as const, message: "Não foi possível criar o lançamento. Tente novamente." }));
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      guia.confirmar();
      onCriado(
        res.id,
        comBaixa,
        comBaixa ? "Lançamento criado. Agora a baixa." : "Lançamento avulso criado em Impostos a Pagar.",
      );
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && fechar()}>
      <DialogContent className="sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5 text-california-red" />
            Novo imposto avulso
          </DialogTitle>
          <DialogDescription>
            Para o que não passou pela apuração: uma guia que a contabilidade mandou e o sistema não calculou.
          </DialogDescription>
        </DialogHeader>
        {erro && <Erro>{erro}</Erro>}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold">
                Imposto <span className="text-california-red">*</span>
              </label>
              <Select
                value={imposto || undefined}
                onValueChange={(v) => {
                  setImposto(v as TributoDoAvulso);
                  setErro(null);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  {IMPOSTOS_AVULSO.map(([k, r]) => (
                    <SelectItem key={k} value={k}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold">
                CNPJ <span className="text-california-red">*</span>
              </label>
              <Select
                value={estabId || undefined}
                onValueChange={(v) => {
                  setEstabId(v);
                  setErro(null);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  {dados.estabelecimentos.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      Nenhum CNPJ ativo no cadastro de impostos.
                    </div>
                  ) : (
                    dados.estabelecimentos.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.nome} · {e.cnpj}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold">
                Competência <span className="text-california-red">*</span>
              </label>
              <Select
                value={competencia || undefined}
                onValueChange={(v) => {
                  setCompetencia(v);
                  setErro(null);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  {competencias.map((m) => (
                    <SelectItem key={m} value={m}>
                      {rotuloDaCompetencia(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold">
                Vencimento <span className="text-california-red">*</span>
              </label>
              <DatePicker
                name="vencimento"
                defaultValue={venc}
                onDateChange={(d) => setVenc(d ? format(d, "yyyy-MM-dd") : "")}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold">
                Valor <span className="text-california-red">*</span>
              </label>
              <MoneyInput
                value={valor}
                onValueChange={(v) => {
                  setValor(v);
                  setErro(null);
                }}
                aria-label="Valor"
              />
            </div>
          </div>
          <div className="grid grid-cols-[180px_1fr] gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold">Código da guia</label>
              <Input
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                placeholder={codigoSugerido ?? "Ex.: 2089"}
                maxLength={20}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold">
                Descrição <span className="text-california-red">*</span>
              </label>
              <Input
                value={descricao}
                onChange={(e) => {
                  setDescricao(e.target.value);
                  setErro(null);
                }}
                placeholder="Ex.: diferença de IRPJ apontada pela contabilidade"
                maxLength={500}
              />
            </div>
          </div>
          <RateioRegionalEditor linhas={rateio} onChange={setRateio} regionais={dados.regionais} />
          <p className="-mt-1 text-[11px] text-muted-foreground">
            O rateio pode juntar empresas gerenciais diferentes, como na baixa das guias da apuração.
          </p>
          <CampoAnexo
            rotulo="Guia (DARF ou guia municipal)"
            path={guia.path}
            onChange={guia.trocar}
            tenantId={dados.tenantId}
            pasta="guias"
            aceita="PDF"
          />
        </div>
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={fechar}
            disabled={pending}
            className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => criar(false)}
            disabled={pending}
            className="rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:border-california-red/50 hover:text-california-red disabled:opacity-50"
          >
            Criar
          </button>
          <button
            type="button"
            onClick={() => criar(true)}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-3 py-2 text-sm font-semibold text-white hover:bg-california-red-hover disabled:opacity-50"
          >
            {pending ? "Criando..." : "Criar e dar baixa"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
