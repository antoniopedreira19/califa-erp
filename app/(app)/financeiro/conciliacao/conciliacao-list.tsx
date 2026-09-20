"use client";
import * as React from "react";
import Link from "next/link";
import { ChevronRight, CreditCard, ExternalLink, Info } from "lucide-react";
import type { LancamentoLinha } from "@/lib/calculos/saldo-conta";
import type { DetalheDaFatura } from "@/lib/data/fatura-cartao-extrato";
import { limparDescricaoDaFatura } from "@/lib/cartoes/descricao-fatura";
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
  detalhesFatura = {},
}: {
  linhas: LancamentoLinha[];
  highlight?: string;
  /** Por id do lançamento: o que o pagamento de uma fatura de cartão abre
   *  — centro de custo → itens (decisão 093, entrega 3). */
  detalhesFatura?: Record<string, DetalheDaFatura>;
}) {
  const rowRefs = React.useRef<Record<string, HTMLTableRowElement | null>>({});
  // Duas camadas de abertura: a linha do pagamento, e cada centro dentro
  // dela. Chaves: id do lançamento, e `${lancamento}|${tipo}`.
  const [abertos, setAbertos] = React.useState<Set<string>>(() => new Set());
  const alternar = (chave: string) =>
    setAbertos((prev) => {
      const prox = new Set(prev);
      if (prox.has(chave)) prox.delete(chave);
      else prox.add(chave);
      return prox;
    });

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
            const estornada = l.estornada;
            const temSave = l.origens.some((o) => o.tipo === "save");
            const temRateio = l.rateio.length > 1;
            const temOrigensMultiplas = l.origens.length > 1;
            const jobParaColuna = derivarJobParaColuna(l);
            const detalhe = detalhesFatura[l.id];
            const aberta = !!detalhe && abertos.has(l.id);
            return (
              <React.Fragment key={l.id}>
              <tr
                ref={(el) => {
                  rowRefs.current[l.id] = el;
                }}
                className={cn(
                  "border-b border-border last:border-0 transition-colors hover:bg-muted/30",
                  aberta && "bg-muted/20",
                )}
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
                  {detalhe ? (
                    <button
                      type="button"
                      onClick={() => alternar(l.id)}
                      aria-expanded={aberta}
                      aria-label={aberta ? "Recolher os itens da fatura" : "Ver os itens da fatura"}
                      className="inline-flex items-center gap-1.5 text-left hover:text-california-red"
                    >
                      <ChevronRight
                        className={cn(
                          "h-3.5 w-3.5 shrink-0 text-california-red transition-transform",
                          aberta && "rotate-90",
                        )}
                      />
                      <span>{limparPrefixoDescricao(l.descricao, l.origem)}</span>
                      <span className="text-[10px] text-muted-foreground">
                        · {detalhe.centros.length}{" "}
                        {detalhe.centros.length === 1 ? "centro de custo" : "centros de custo"}
                      </span>
                    </button>
                  ) : (
                    limparPrefixoDescricao(l.descricao, l.origem)
                  )}
                </td>
                <td className="px-3 py-2 text-xs">
                  {l.fornecedor_nome ?? (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                  {jobParaColuna.tipo === "link" ? (
                    <Link
                      href={`/jobs/${jobParaColuna.id}?from=financeiro`}
                      prefetch={false}
                      className="text-california-red hover:underline"
                    >
                      {jobParaColuna.codigo}
                    </Link>
                  ) : jobParaColuna.tipo === "multi" ? (
                    <span className="italic text-muted-foreground/70 font-sans">
                      Múltiplos
                    </span>
                  ) : (
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
                {/* variáveis temSave/temRateio/temOrigensMultiplas continuam
                    sendo lidas pelo popover pra decidir qual seção mostrar,
                    mas o ESTILO do botão não muda mais entre linhas. */}
              </tr>
              {aberta && detalhe && (
                <LinhasDaFatura
                  lancamentoId={l.id}
                  detalhe={detalhe}
                  abertos={abertos}
                  alternar={alternar}
                />
              )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * O pagamento da fatura aberto em dois níveis (decisão 093, entrega 3):
 * uma linha por CENTRO DE CUSTO, com o total dele, e dentro de cada um os
 * ITENS — data, descrição, fornecedor, job, subtipo, valor. O rodapé
 * confere: a soma dos centros é o débito da linha do pagamento.
 *
 * Linhas de tabela, não uma tabela dentro da célula: assim as colunas de
 * valor ficam na mesma vertical do Débito da linha-mãe.
 */
function LinhasDaFatura({
  lancamentoId,
  detalhe,
  abertos,
  alternar,
}: {
  lancamentoId: string;
  detalhe: DetalheDaFatura;
  abertos: Set<string>;
  alternar: (chave: string) => void;
}) {
  // As células seguem as colunas da linha-mãe: valor sob DÉBITO (o que
  // fecha com o pagamento), nome sob DESCRIÇÃO, fornecedor, job e o
  // subtipo sob CENTRO DE CUSTO. Sem isso os números ficavam soltos na
  // borda direita e o olho não batia a soma.
  return (
    <>
      {detalhe.centros.map((c) => {
        const chave = `${lancamentoId}|${c.tipo_codigo}`;
        const abertoCentro = abertos.has(chave);
        return (
          <React.Fragment key={chave}>
            <tr className="border-b border-border/60 bg-muted/10 text-xs">
              <td colSpan={2} />
              <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono font-semibold">
                {formatMoney(c.total)}
              </td>
              <td />
              <td colSpan={7} className="px-3 py-1.5">
                <button
                  type="button"
                  onClick={() => alternar(chave)}
                  aria-expanded={abertoCentro}
                  className="inline-flex items-center gap-1.5 pl-4 font-medium hover:text-california-red"
                >
                  <ChevronRight
                    className={cn(
                      "h-3 w-3 shrink-0 text-muted-foreground transition-transform",
                      abertoCentro && "rotate-90",
                    )}
                  />
                  <span className="font-mono text-muted-foreground">{c.tipo_codigo}</span>
                  <span>{c.tipo_nome}</span>
                  <span className="text-[10px] text-muted-foreground">
                    · {c.itens.length} {c.itens.length === 1 ? "item" : "itens"}
                  </span>
                </button>
              </td>
            </tr>
            {abertoCentro &&
              c.itens.map((it) => (
                <tr key={it.id} className="border-b border-border/40 bg-muted/5 text-[11.5px]">
                  <td className="whitespace-nowrap px-3 py-1.5 pl-6 font-mono text-muted-foreground">
                    {formatDate(it.data)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono text-emerald-700">
                    {it.valor < 0 ? formatMoney(-it.valor) : ""}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono">
                    {it.valor > 0 ? formatMoney(it.valor) : ""}
                  </td>
                  <td />
                  <td className="px-3 py-1.5 pl-8">
                    {limparPrefixoDescricao(limparDescricaoDaFatura(it.descricao), it.origem)}
                    {it.papel === "ajuste" && (
                      <span className="ml-1.5 rounded border border-slate-300 bg-slate-100 px-1 py-0.5 text-[9px] font-semibold uppercase text-slate-700">
                        ajuste
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground">
                    {it.fornecedor_nome ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 font-mono">
                    {it.job_id && it.job_codigo ? (
                      <Link
                        href={`/jobs/${it.job_id}?from=financeiro`}
                        prefetch={false}
                        className="text-california-red hover:underline"
                      >
                        {it.job_codigo}
                      </Link>
                    ) : (
                      <span className="font-sans italic text-muted-foreground/70">—</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground">{it.subtipo_nome}</td>
                  <td colSpan={3} />
                </tr>
              ))}
          </React.Fragment>
        );
      })}
      <tr className="border-b border-border bg-muted/10 text-xs">
        <td colSpan={2} />
        <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono font-bold">
          {formatMoney(detalhe.total)}
        </td>
        <td />
        <td colSpan={7} className="px-3 py-1.5 pl-7 text-muted-foreground">
          Total da fatura {detalhe.codigo} · fecha {formatDate(detalhe.competencia_fechamento)} ·{" "}
          {detalhe.centros.reduce((s, c) => s + c.itens.length, 0)} itens
        </td>
      </tr>
    </>
  );
}

/**
 * Popover com os campos que saíram da tabela principal: Regional, Origem
 * (com Recorrente e Cartão), Documento, além do detalhe de rateio de
 * regionais e do breakdown de origens (jobs cobertos + save).
 *
 * Cor do botão é sempre a mesma (vermelho California suave). A ideia
 * anterior de mudar a cor quando havia save/rateio/multi-origem foi
 * rejeitada — a distinção confundia mais do que ajudava. O popover se
 * adapta: seções de save/rateio só aparecem quando existem.
 */
export function DetalhesPopover({
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
  const origemTag = tagDaOrigem(linha.origem);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Ver detalhes do lançamento"
          className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-california-red/40 text-california-red transition-colors hover:bg-california-red/5"
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

/**
 * Decide o que mostrar na coluna Job da tabela:
 *
 * 1. FK direta `lançamento.job_id` set → link pra esse job (PP, avulsa
 *    de job específico, desembolso de job).
 * 2. FK null MAS as origens (`vw_lancamento_origens`) apontam pra UM
 *    único job → link. É o caso do recebimento de NF que cobre um job
 *    só, direto e/ou via save do próprio job.
 * 3. Mais de um job nas origens → "Múltiplos". A pessoa abre o popover
 *    pra ver o breakdown de "de onde vem este dinheiro".
 * 4. Nenhum job em nenhum lugar → "Não Vinculado" (fatura de cartão,
 *    lançamento manual, ajuste, etc).
 */
export function derivarJobParaColuna(
  linha: LancamentoLinha,
):
  | { tipo: "link"; id: string; codigo: string }
  | { tipo: "multi" }
  | { tipo: "nao_vinculado" } {
  if (linha.job_id && linha.job_codigo) {
    return { tipo: "link", id: linha.job_id, codigo: linha.job_codigo };
  }
  const jobsUnicos = new Map<string, string>();
  for (const o of linha.origens) {
    if (o.job_id && o.codigo) jobsUnicos.set(o.job_id, o.codigo);
  }
  const arr = Array.from(jobsUnicos.entries());
  if (arr.length === 1) {
    return { tipo: "link", id: arr[0][0], codigo: arr[0][1] };
  }
  if (arr.length > 1) return { tipo: "multi" };
  return { tipo: "nao_vinculado" };
}

/**
 * A descrição gravada no banco vem prefixada com "PP" ou "Avulsa" pra
 * origens de compra ("PP PP-00009 1/3 — ..."). Com a tag movida pro
 * popover, esse prefixo virou redundante — vira "PP PP-00009 1/3" na
 * tela. Remove só quando bate com o tipo de origem, pra não estropiar
 * descrições que legitimamente começam com essas letras.
 */
export function limparPrefixoDescricao(descricao: string, origem: string): string {
  if (origem.startsWith("pp_") && descricao.startsWith("PP ")) {
    return descricao.slice(3);
  }
  if (origem.startsWith("avulsa_") && descricao.startsWith("Avulsa ")) {
    return descricao.slice(7);
  }
  return descricao;
}

export function trimestreDe(iso: string): string {
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
