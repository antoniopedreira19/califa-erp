"use client";
import * as React from "react";
import { CreditCard, ExternalLink, Info } from "lucide-react";
import type { LancamentoLinha } from "@/lib/calculos/saldo-conta";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { abrirDocumentoDoLancamento } from "./actions-documento";

export function ConciliacaoList({
  linhas,
  highlight,
}: {
  linhas: LancamentoLinha[];
  highlight?: string;
}) {
  const rowRefs = React.useRef<Record<string, HTMLTableRowElement | null>>({});

  React.useEffect(() => {
    if (!highlight) return;
    const el = rowRefs.current[highlight];
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.classList.add("animate-pulse", "bg-yellow-50");
      const timer = setTimeout(
        () => el.classList.remove("animate-pulse", "bg-yellow-50"),
        2000,
      );
      return () => clearTimeout(timer);
    }
  }, [highlight, linhas]);

  if (linhas.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border py-16 text-center">
        <p className="text-sm text-muted-foreground">
          Nenhum lançamento nesse período pra essa conta.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[1200px] text-sm">
        <thead className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground">
          {/* Ordem da tabela: extrato bancário puro à esquerda (Data, Crédito,
              Débito, Saldo), contexto do lançamento à direita (Descrição,
              Fornecedor, Job, Centro de Custo, Trimestre, Empresa). Regional,
              Origem, Documento e rateio/save moveram pro botão de detalhes
              (ⓘ) — a coluna Origem/Rateado inline poluía sem necessidade. */}
          <tr>
            <th className="px-3 py-2 text-left">Data</th>
            <th className="px-3 py-2 text-right">Crédito</th>
            <th className="px-3 py-2 text-right">Débito</th>
            <th className="px-3 py-2 text-right">Saldo</th>
            <th className="px-3 py-2 text-left">Descrição</th>
            <th className="px-3 py-2 text-left">Fornecedor</th>
            <th className="px-3 py-2 text-left">Job</th>
            <th className="px-3 py-2 text-left">Centro de Custo</th>
            <th className="px-3 py-2 text-center">Trimestre</th>
            <th className="px-3 py-2 text-left">Empresa</th>
            <th className="w-10 px-3 py-2 text-center" aria-label="Detalhes" />
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => {
            const estornada =
              l.origem === "pp_baixa_estornada" ||
              l.origem === "avulsa_baixa_estornada";
            const temSave = l.origens.some((o) => o.tipo === "save");
            const temRateio = l.rateio.length > 1;
            const temOrigensMultiplas = l.origens.length > 1;
            return (
              <tr
                key={l.id}
                ref={(el) => {
                  rowRefs.current[l.id] = el;
                }}
                className="border-b border-border last:border-0 transition-colors hover:bg-muted/30"
              >
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                  {formatDate(l.data_movimento)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs text-emerald-700">
                  {l.credito > 0 ? formatMoney(l.credito) : ""}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs text-california-red">
                  {l.debito > 0 ? formatMoney(l.debito) : ""}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs font-semibold">
                  {formatMoney(l.saldo)}
                </td>
                <td
                  className={cn(
                    "px-3 py-2 text-xs",
                    estornada && "text-muted-foreground line-through",
                  )}
                >
                  {l.descricao}
                </td>
                <td className="px-3 py-2 text-xs">
                  {l.fornecedor_nome ?? (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                  {l.job_codigo ?? (
                    <span className="italic text-muted-foreground/70 font-sans">
                      Não Vinculado
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs">
                  <span className="text-foreground">{l.tipo_nome}</span>
                  <span className="text-muted-foreground"> · </span>
                  <span className="text-muted-foreground">{l.subtipo_nome}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-center font-mono text-xs text-muted-foreground">
                  {trimestreDe(l.data_movimento)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs">
                  {l.empresa_nome ?? (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="w-10 px-3 py-2 text-center">
                  <DetalhesPopover
                    linha={l}
                    temSave={temSave}
                    temRateio={temRateio}
                    temOrigensMultiplas={temOrigensMultiplas}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Popover com os campos que saíram da tabela principal: Regional, Origem
 * (com Recorrente e Cartão), Documento, além do detalhe de rateio de
 * regionais e do breakdown de origens (jobs cobertos + save).
 *
 * O ícone Info fica visível o tempo todo — a ausência dele significaria
 * "esta linha não tem contexto", o que não é verdade nunca. Cor mais
 * viva quando existe save ou rateio, avisando que o clique traz algo
 * além do metadado padrão.
 */
function DetalhesPopover({
  linha,
  temSave,
  temRateio,
  temOrigensMultiplas,
}: {
  linha: LancamentoLinha;
  temSave: boolean;
  temRateio: boolean;
  temOrigensMultiplas: boolean;
}) {
  const alerta = temSave || temRateio || temOrigensMultiplas;
  const origemTag = tagDaOrigem(linha.origem);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Ver detalhes do lançamento"
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded-full border border-border transition-colors hover:bg-muted",
            alerta && "border-california-red/40 text-california-red",
          )}
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" side="left" className="w-80">
        <div className="space-y-3 text-xs">
          <div className="flex items-center gap-2 border-b border-border pb-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.07em] text-muted-foreground">
              Detalhes do lançamento
            </p>
            {origemTag && (
              <span
                className={cn(
                  "inline-flex items-center rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase",
                  origemTag.classes,
                )}
              >
                {origemTag.label}
              </span>
            )}
          </div>

          <Grupo label="Origem">
            {linha.origem_codigo ? (
              <span className="inline-flex flex-wrap items-center gap-1.5">
                <span className="font-mono">{linha.origem_codigo}</span>
                {linha.origem_recorrente && (
                  <span className="inline-flex items-center rounded border border-border bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase text-muted-foreground">
                    Recorrente
                  </span>
                )}
                {linha.cartao_label && (
                  <span className="inline-flex items-center gap-1 rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-700">
                    <CreditCard className="h-2.5 w-2.5" />
                    {linha.cartao_label}
                  </span>
                )}
              </span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </Grupo>

          <Grupo label="Documento">
            {linha.documento_label ? (
              linha.documento_path ? (
                <BotaoDocumento
                  lancamentoId={linha.id}
                  label={linha.documento_label}
                />
              ) : (
                <span className="font-mono">{linha.documento_label}</span>
              )
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </Grupo>

          <Grupo label="Regional">
            {linha.regional_nome ? (
              <span>{linha.regional_nome}</span>
            ) : temRateio ? (
              <div className="flex flex-col gap-0.5">
                {linha.rateio.map((r) => (
                  <div
                    key={r.regional_nome}
                    className="flex items-baseline justify-between gap-4"
                  >
                    <span>{r.regional_nome}</span>
                    <span className="font-mono text-muted-foreground">
                      {r.percentual.toFixed(2)}%
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </Grupo>

          <Grupo label="Plano de contas (código)">
            <span className="font-mono text-muted-foreground">
              {linha.tipo_codigo} · {linha.subtipo_codigo}
            </span>
          </Grupo>

          {(temSave || temOrigensMultiplas) && (
            <div className="border-t border-border pt-2">
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.07em] text-muted-foreground">
                De onde vem este dinheiro
              </p>
              <div className="flex flex-col gap-1">
                {linha.origens.map((o, i) => (
                  <div
                    key={`${o.tipo}-${o.codigo ?? i}`}
                    className="flex items-baseline justify-between gap-4"
                  >
                    <span className="flex items-baseline gap-2">
                      <span className="font-mono font-semibold">
                        {o.codigo ?? "—"}
                      </span>
                      <span
                        className={
                          o.tipo === "save" ? "text-[#5f5d57]" : undefined
                        }
                      >
                        {o.tipo === "save"
                          ? "saldo em save — crédito do cliente"
                          : (o.nome ?? "")}
                      </span>
                    </span>
                    <span className="whitespace-nowrap font-mono font-semibold">
                      {formatMoney(o.valor)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Grupo({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-bold uppercase tracking-[0.07em] text-muted-foreground">
        {label}
      </p>
      <div>{children}</div>
    </div>
  );
}

/**
 * Abre o documento fiscal numa aba. A URL é assinada na hora e vive um
 * minuto: precisa ser derivada no clique, nunca vir pronta do servidor.
 */
function BotaoDocumento({
  lancamentoId,
  label,
}: {
  lancamentoId: string;
  label: string;
}) {
  const [carregando, setCarregando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        disabled={carregando}
        onClick={async () => {
          setCarregando(true);
          setErro(null);
          const r = await abrirDocumentoDoLancamento(lancamentoId);
          setCarregando(false);
          if (!r.ok) {
            setErro(r.message);
            return;
          }
          window.open(r.url, "_blank", "noopener,noreferrer");
        }}
        className="inline-flex items-center gap-1 font-mono text-california-red hover:underline disabled:opacity-50"
      >
        {label}
        <ExternalLink className="h-2.5 w-2.5" />
      </button>
      {erro && <span className="text-[10px] text-california-red">{erro}</span>}
    </span>
  );
}

function tagDaOrigem(
  origem: string,
): { label: string; classes: string } | null {
  if (origem.startsWith("pp_")) {
    return {
      label: "PP",
      classes: "border-blue-200 bg-blue-50 text-blue-700",
    };
  }
  if (origem.startsWith("avulsa_")) {
    return {
      label: "Avulsa",
      classes: "border-slate-300 bg-slate-100 text-slate-700",
    };
  }
  return null;
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

function trimestreDe(iso: string): string {
  const m = parseInt(iso.slice(5, 7), 10);
  if (m <= 3) return "T1";
  if (m <= 6) return "T2";
  if (m <= 9) return "T3";
  return "T4";
}

function formatMoney(n: number): string {
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
