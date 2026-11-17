"use client";
// Módulo Desembolsos (decisão 264): só os pedidos de quem está usando, para
// todo papel — administrador e financeiro incluídos, que conferem os de
// todos em Contas a Pagar › Desembolsos. Grade fixa; o clique abre a tela do
// pedido em leitura; a ação da linha (o que a pessoa tem a fazer) fica fora
// da tabela, ao lado da linha (pedido do Tiago, 17/11/2026).
import * as React from "react";
import { AlertTriangle, CheckCircle, FileText, Paperclip, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ContextoDoFormulario } from "./dados";
import type { PedidoDeDesembolso, StatusDoDesembolso } from "./tipos";
import { SeloStatus, brl, dataBr, linhaDoStatus } from "./comum";
import { TelaDoDesembolso } from "./tela";
import { FormularioDoPedido, type ModoDoForm } from "./formulario";

type Filtro = "todos" | StatusDoDesembolso;
const FILTROS: Array<{ key: Filtro; label: string }> = [
  { key: "todos", label: "Todos" },
  { key: "em_avaliacao", label: "Em avaliação" },
  { key: "aprovada", label: "Aprovados" },
  { key: "pago", label: "Pagos" },
  { key: "rejeitada", label: "Rejeitados" },
  { key: "cancelada", label: "Cancelados" },
];
const COLUNAS = ["Código", "Descrição", "Quem recebe", "Comprovante", "Valor", "Pagamento", "Status"];

const ROTULO_DO_TIPO: Record<string, string> = {
  nota_fiscal: "NF",
  cupom_fiscal: "Cupom fiscal",
  recibo: "Recibo",
  fatura: "Fatura",
  boleto: "Boleto",
  guia: "Guia",
  contrato: "Contrato",
  orcamento: "Orçamento",
  outro: "Outro",
};
const ORDEM_DO_COMPROVANTE = ["nota_fiscal", "cupom_fiscal", "recibo", "fatura", "boleto", "guia", "contrato", "orcamento", "outro"];

function acaoDaLinha(d: PedidoDeDesembolso): { rotulo: string; modo: ModoDoForm } | null {
  if (d.status === "rejeitada") return { rotulo: "Corrigir", modo: "corrigir" };
  if (d.status === "em_avaliacao" && d.anexos.length === 0) return { rotulo: "Anexar comprovante", modo: "anexar" };
  return null;
}

/** A célula "Comprovante": o tipo e o número do principal (a NF primeiro), e quantos mais. */
function CelulaComprovante({ d }: { d: PedidoDeDesembolso }) {
  const c =
    ORDEM_DO_COMPROVANTE.map((t) => d.anexos.find((a) => a.tipo === t)).find(Boolean) ?? d.anexos[0] ?? null;
  if (!c) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-california-red">
        <AlertTriangle className="h-3.5 w-3.5 flex-none" />
        Sem comprovante
      </span>
    );
  }
  const mais = d.anexos.length - 1;
  return (
    <p className="flex min-w-0 items-center gap-1.5 text-xs">
      {c.tipo === "nota_fiscal" ? (
        <FileText className="h-3.5 w-3.5 flex-none text-california-red" />
      ) : (
        <Paperclip className="h-3.5 w-3.5 flex-none text-muted-foreground" />
      )}
      <span className="truncate">
        <span className="font-semibold">{c.tipo ? ROTULO_DO_TIPO[c.tipo] ?? c.tipo : "Sem tipo"}</span>
        {c.numero ? <span className="font-mono"> {c.numero}</span> : null}
      </span>
      {mais > 0 && <span className="flex-none text-[11px] text-muted-foreground">+{mais}</span>}
    </p>
  );
}

export function MeusDesembolsos({
  linhas,
  contexto,
  abrirInicial,
}: {
  linhas: PedidoDeDesembolso[];
  contexto: ContextoDoFormulario;
  /** O `?abrir=` (o endereço antigo do detalhe redireciona para cá). */
  abrirInicial: string | null;
}) {
  const [filtro, setFiltro] = React.useState<Filtro>("todos");
  const [busca, setBusca] = React.useState("");
  const [aberto, setAberto] = React.useState<string | null>(abrirInicial && linhas.some((l) => l.id === abrirInicial) ? abrirInicial : null);
  const [form, setForm] = React.useState<{ modo: ModoDoForm; id: string | null } | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const conta = (k: Filtro) => (k === "todos" ? linhas.length : linhas.filter((l) => l.status === k).length);
  const visiveis = linhas.filter((l) => {
    if (filtro !== "todos" && l.status !== filtro) return false;
    const q = busca.trim().toLowerCase();
    return !q || `${l.codigo} ${l.descricao} ${l.fornecedor?.nome ?? ""}`.toLowerCase().includes(q);
  });
  const pedidoAberto = aberto ? linhas.find((l) => l.id === aberto) ?? null : null;
  const pedidoDoForm = form?.id ? linhas.find((l) => l.id === form.id) ?? null : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          {FILTROS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFiltro(f.key)}
              className={cn(
                "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                filtro === f.key
                  ? "border-california-red bg-california-red text-white"
                  : "border-border bg-white text-muted-foreground hover:border-california-red/50",
              )}
            >
              {f.label}
              <span className={cn("tabular-nums", filtro === f.key ? "text-white/85" : "text-muted-foreground/70")}>{conta(f.key)}</span>
            </button>
          ))}
        </div>
        <div className="relative w-[320px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por código, descrição ou quem recebe..."
            aria-label="Buscar pedido"
            className="w-full rounded-lg border border-border bg-white py-2 pl-9 pr-3 text-sm focus:border-california-red focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={() => setForm({ modo: "novo", id: null })}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-california-red/90"
        >
          <Plus className="h-4 w-4" />
          Novo pedido de desembolso
        </button>
      </div>

      {/* A tabela é o cartão das 7 colunas; a ação de cada linha fica do lado
          de fora, alinhada à linha. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1180px] table-fixed border-separate border-spacing-0 text-sm">
          <colgroup>
            <col className="w-[116px]" />
            <col />
            <col className="w-[220px]" />
            <col className="w-[170px]" />
            <col className="w-[128px]" />
            <col className="w-[112px]" />
            <col className="w-[140px]" />
            <col className="w-[164px]" />
          </colgroup>
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
              {COLUNAS.map((t, i) => (
                <th
                  key={t}
                  className={cn(
                    "border-y border-border bg-card px-4 py-3 font-semibold [background-image:linear-gradient(hsl(var(--muted)/0.3),hsl(var(--muted)/0.3))]",
                    i === 0 && "rounded-tl-2xl border-l",
                    i === COLUNAS.length - 1 && "rounded-tr-2xl border-r",
                    t === "Valor" && "text-right",
                  )}
                >
                  {t}
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {visiveis.length === 0 && (
              <tr>
                <td
                  colSpan={COLUNAS.length}
                  className="rounded-b-2xl border-x border-b border-border bg-card px-4 py-12 text-center text-sm text-muted-foreground"
                >
                  {linhas.length === 0 ? "Você ainda não fez nenhum pedido de desembolso." : "Nenhum pedido seu com esse filtro."}
                </td>
                <td />
              </tr>
            )}
            {visiveis.map((d, n) => {
              const acao = acaoDaLinha(d);
              const sub = linhaDoStatus(d);
              const ultima = n === visiveis.length - 1;
              const celula = (i: number, extra?: string) =>
                cn(
                  "border-b border-border bg-card px-4 py-3 align-top transition-colors group-hover:[background-image:linear-gradient(hsl(var(--accent)/0.4),hsl(var(--accent)/0.4))]",
                  i === 0 && "border-l",
                  i === COLUNAS.length - 1 && "border-r",
                  ultima && i === 0 && "rounded-bl-2xl",
                  ultima && i === COLUNAS.length - 1 && "rounded-br-2xl",
                  extra,
                );
              return (
                // Com algo a fazer (corrigir, anexar), o clique leva direto ao formulário.
                <tr
                  key={d.id}
                  onClick={() => (acao ? setForm({ modo: acao.modo, id: d.id }) : setAberto(d.id))}
                  className="group cursor-pointer"
                >
                  <td className={celula(0)}>
                    <p className="font-mono text-xs font-bold text-california-red">{d.codigo}</p>
                    {d.reembolso && (
                      <span className="mt-1 inline-block rounded-full border border-sky-200 bg-sky-50 px-1.5 py-px text-[10px] font-semibold uppercase text-sky-700">
                        Reembolso
                      </span>
                    )}
                    {d.urgente && (
                      <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-california-red" title={d.justificativaUrgente ?? undefined}>
                        Urgente
                      </p>
                    )}
                  </td>
                  <td className={celula(1)}>
                    <p className="line-clamp-2 text-[13px] leading-snug" title={d.descricao}>
                      {d.descricao}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{d.empresa.nome}</p>
                  </td>
                  <td className={celula(2)}>
                    <p className="truncate text-[13px]" title={d.fornecedor?.nome ?? undefined}>
                      {d.reembolso ? "Você" : d.fornecedor?.nome ?? "—"}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {d.reembolso ? "Na sua conta do cadastro" : d.fornecedor?.documento ?? ""}
                    </p>
                  </td>
                  <td className={celula(3)}>
                    <CelulaComprovante d={d} />
                  </td>
                  <td className={celula(4, "text-right")}>
                    <p className="font-semibold tabular-nums">{brl(d.valor)}</p>
                    {d.parcelas.length > 1 && <p className="text-[11px] text-muted-foreground">em {d.parcelas.length}x</p>}
                  </td>
                  <td className={celula(5, "text-[13px] tabular-nums")}>{dataBr(d.prevista)}</td>
                  <td className={celula(6)}>
                    <SeloStatus status={d.status} />
                    {sub && <p className="mt-1 text-[11px] text-muted-foreground">{sub}</p>}
                  </td>
                  <td className="cursor-default py-3 pl-3 align-top" onClick={(e) => e.stopPropagation()}>
                    {acao && (
                      <button
                        type="button"
                        onClick={() => setForm({ modo: acao.modo, id: d.id })}
                        className="whitespace-nowrap rounded-lg bg-california-red px-3 py-1.5 text-xs font-semibold text-white shadow-soft transition-colors hover:bg-california-red/90"
                      >
                        {acao.rotulo}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <TelaDoDesembolso
        pedido={pedidoAberto}
        open={pedidoAberto !== null}
        onOpenChange={(o) => !o && setAberto(null)}
        financeiro={false}
        tomadores={contexto.tomadores}
        onAbrirForm={(modo, d) => setForm({ modo, id: d.id })}
      />
      <FormularioDoPedido
        aberto={form !== null}
        onAberto={(o) => !o && setForm(null)}
        modo={form?.modo ?? "novo"}
        pedido={pedidoDoForm}
        contexto={contexto}
        onSalvo={setToast}
      />
      {toast && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-[80] flex -translate-x-1/2 items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-elevated">
          <CheckCircle className="h-4 w-4" />
          {toast}
        </div>
      )}
    </div>
  );
}
