"use client";

/**
 * Os impostos de cada NF (decisão 271): a visão Impostos ("Notas | Impostos"
 * acima da tabela), com o valor e a alíquota na mesma célula e o total de
 * cada imposto no pé.
 *
 * De onde vêm os números:
 *   Emitidas — ISS, PIS e COFINS pela alíquota do CNAE da nota no cadastro
 *   de impostos (como o "Impostos desta nota" do Faturar); IRPJ, adicional
 *   e CSLL estimados por nota com a presunção de 32%, como a planilha faz
 *   (o devido sai da apuração do trimestre); CBS/IBS da fase de teste
 *   (decisão 256), sem guia, fora do total. No histórico, os valores da
 *   própria planilha.
 *   Tomadas — as retenções destacadas na NF (a leitura ampliada da NF).
 */
import * as React from "react";
import { Eye } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TruncateTooltip } from "@/components/ui/truncate-tooltip";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { aliquotasDaReforma, type CadastroFiscal } from "@/lib/fiscal/cadastro";
import { cn } from "@/lib/utils";
import type { NotaEmitida, NotaTomada } from "./dados";
import { dataBR, moeda } from "./comum";

const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (n: number) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

export interface ValorDoImposto {
  aliquota: number | null;
  valor: number | null;
  /** Estimado por nota (IRPJ e CSLL das emitidas). */
  estimado?: boolean;
  /** Só registro, sem guia (CBS/IBS de 2026). */
  semGuia?: boolean;
}

export interface ColunaDeImposto {
  chave: string;
  rotulo: string;
  dica: string;
}

export interface ImpostosDaNota {
  porImposto: Record<string, ValorDoImposto>;
  /** A soma do que vira guia. */
  total: number;
  /** Emitidas: o retido pelo cliente. Tomadas: o líquido a pagar. */
  fecho: number;
  /** Emitidas: o retido por imposto (dica). */
  detalheDoFecho: Array<{ imposto: string; valor: number }>;
}

export const IMPOSTOS_DAS_EMITIDAS: ColunaDeImposto[] = [
  { chave: "iss", rotulo: "ISS", dica: "Pela alíquota do CNAE da nota no cadastro de impostos." },
  { chave: "pis", rotulo: "PIS", dica: "Pela alíquota do CNAE da nota no cadastro de impostos." },
  { chave: "cofins", rotulo: "COFINS", dica: "Pela alíquota do CNAE da nota no cadastro de impostos." },
  { chave: "irpj", rotulo: "IRPJ", dica: "Estimado por nota com a presunção de 32% (15%), como na planilha. O devido sai da apuração do trimestre." },
  { chave: "adicional", rotulo: "Adic. IR", dica: "Estimado por nota com a presunção de 32% (10%), como na planilha. No trimestre, só incide sobre o que passa de R$ 60 mil de lucro presumido." },
  { chave: "csll", rotulo: "CSLL", dica: "Estimado por nota com a presunção de 32% (9%), como na planilha. O devido sai da apuração do trimestre." },
  { chave: "cbsibs", rotulo: "CBS/IBS", dica: "Fase de teste de 2026 (decisão 256): registro na nota, sem guia. Fica fora do total." },
];

export const IMPOSTOS_DAS_TOMADAS: ColunaDeImposto[] = [
  { chave: "ISS", rotulo: "ISS retido", dica: "Destacado na NF: retido por nós e pago na guia do município." },
  { chave: "IRRF", rotulo: "IRRF", dica: "Destacado na NF: retido por nós, DARF 1708." },
  { chave: "PIS", rotulo: "PIS", dica: "Destacado na NF: retido por nós, DARF 5952 (com COFINS e CSLL)." },
  { chave: "COFINS", rotulo: "COFINS", dica: "Destacado na NF: retido por nós, DARF 5952." },
  { chave: "CSLL", rotulo: "CSLL", dica: "Destacado na NF: retido por nós, DARF 5952." },
];

export const FECHO = {
  emitidas: { total: "Total", fecho: "Retido pelo cliente", dicaFecho: "O que o cliente reteve na fonte ao pagar (nas baixas)." },
  tomadas: { total: "Total retido", fecho: "Líquido a pagar", dicaFecho: "O valor da NF menos as retenções que ela destaca." },
};

/** Os impostos de uma NF emitida. */
export function impostosDaEmitida(n: NotaEmitida, cad: CadastroFiscal | null): ImpostosDaNota {
  const vazio: ImpostosDaNota = { porImposto: {}, total: 0, fecho: n.retido, detalheDoFecho: n.retidoPorImposto };
  if (n.status === "cancelado") return vazio;
  const valor = n.valor_total;
  const de = (v: number | null | undefined, extra: Partial<ValorDoImposto> = {}): ValorDoImposto => ({
    aliquota: v == null || !valor ? null : r2((v / valor) * 100),
    valor: v == null ? null : r2(v),
    ...extra,
  });
  const p: Record<string, ValorDoImposto> = {};
  if (n.historico) {
    const h = n.impostosDaPlanilha;
    if (!h) return vazio;
    p.iss = de(h.iss);
    p.pis = de(h.pis);
    p.cofins = de(h.cofins);
    p.irpj = de(h.ir);
    p.adicional = de(h.adicional_ir);
    p.csll = de(h.csll);
  } else {
    const c = cad?.cnaes.find((x) => x.id === n.fiscal_cnae_id);
    if (!c) return vazio;
    const aliq = (a: number | null, extra: Partial<ValorDoImposto> = {}): ValorDoImposto => ({ aliquota: a, valor: a == null ? null : r2((valor * a) / 100), ...extra });
    p.iss = aliq(c.aliquota_iss);
    p.pis = aliq(Number(c.aliquota_pis));
    p.cofins = aliq(Number(c.aliquota_cofins));
    p.irpj = aliq(4.8, { estimado: true });
    p.adicional = aliq(3.2, { estimado: true });
    p.csll = aliq(2.88, { estimado: true });
    if (cad) {
      const a = aliquotasDaReforma(cad, n.data_emissao);
      const liquido = valor - (p.iss.valor ?? 0) - (p.pis.valor ?? 0) - (p.cofins.valor ?? 0);
      p.cbsibs = { aliquota: r2(a.cbs + a.ibs), valor: r2((liquido * (a.cbs + a.ibs)) / 100), semGuia: true };
    }
  }
  const total = r2(Object.values(p).reduce((s, x) => s + (x.semGuia ? 0 : x.valor ?? 0), 0));
  return { porImposto: p, total, fecho: n.retido, detalheDoFecho: n.retidoPorImposto };
}

/** Os impostos (retenções destacadas) de uma NF tomada. */
export function impostosDaTomada(n: NotaTomada): ImpostosDaNota {
  const p: Record<string, ValorDoImposto> = {};
  for (const r of n.leitura.retencoes) p[r.imposto] = { aliquota: r.aliquota, valor: r.valor };
  return { porImposto: p, total: n.leitura.retido, fecho: n.leitura.liquido, detalheDoFecho: [] };
}

/** Valor em cima, alíquota embaixo (visão Impostos e linha aberta). */
export function CelulaDoImposto({ v, forte }: { v: ValorDoImposto | undefined; forte?: boolean }) {
  if (!v || v.valor == null) return <span className="font-sans text-muted-foreground">—</span>;
  return (
    <div className="leading-tight">
      <div className={cn("font-mono text-[12.5px] tabular-nums", forte && "font-semibold", v.semGuia && "text-muted-foreground")}>
        {moeda(v.valor)}
        {v.estimado && <span className="text-amber-700">*</span>}
      </div>
      {v.aliquota != null && <div className="font-mono text-[10.5px] text-muted-foreground">{pct(v.aliquota)}</div>}
    </div>
  );
}

/** O título da coluna de imposto, com a dica. */
export function TituloDoImposto({ c, alinhar = "right" }: { c: ColunaDeImposto; alinhar?: "right" | "left" }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("cursor-default", alinhar === "right" && "block text-right")}>{c.rotulo}</span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs normal-case tracking-normal">
        {c.dica}
      </TooltipContent>
    </Tooltip>
  );
}

/** O fecho (retido pelo cliente / líquido a pagar), com o detalhe na dica. */
export function CelulaDoFecho({ i }: { i: ImpostosDaNota }) {
  if (i.fecho <= 0.004) return <span className="font-sans text-muted-foreground">—</span>;
  if (!i.detalheDoFecho.length) return <span className="font-mono text-[12.5px] tabular-nums">{moeda(i.fecho)}</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-default font-mono text-[12.5px] tabular-nums">{moeda(i.fecho)}</span>
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-xs">
        {i.detalheDoFecho.map((d) => (
          <div key={d.imposto}>
            {d.imposto}: {moeda(d.valor)}
          </div>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}

/** As somas de cada imposto (o pé das tabelas de impostos). */
export function somarImpostos(lista: ImpostosDaNota[], colunas: ColunaDeImposto[]) {
  const porImposto: Record<string, number> = {};
  for (const c of colunas) porImposto[c.chave] = r2(lista.reduce((s, i) => s + (i.porImposto[c.chave]?.valor ?? 0), 0));
  return { porImposto, total: r2(lista.reduce((s, i) => s + i.total, 0)), fecho: r2(lista.reduce((s, i) => s + i.fecho, 0)) };
}

/** "Notas | Impostos" acima da tabela. */
export function AlternarVisao({ visao, onTrocar, desabilitado }: { visao: "notas" | "impostos"; onTrocar: (v: "notas" | "impostos") => void; desabilitado?: boolean }) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-white p-0.5">
      {(["notas", "impostos"] as const).map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onTrocar(v)}
          disabled={desabilitado && v === "impostos"}
          aria-pressed={visao === v}
          className={cn(
            "rounded-md px-3 py-1.5 text-[12.5px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45",
            visao === v ? "bg-california-red text-white" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {v === "notas" ? "Notas" : "Impostos"}
        </button>
      ))}
    </div>
  );
}

/** Uma linha da visão Impostos, igual nas duas abas. */
export interface LinhaDaVisao {
  id: string;
  numero: string;
  valor: number;
  emissao: string;
  /** Emitidas: o tomador. Tomadas: o emitente. */
  nome: string;
  documento: string | null;
  cnae: string | null;
  cancelada: boolean;
  impostos: ImpostosDaNota;
  onVer: (() => void) | null;
}

/** A tabela da visão Impostos: valor e alíquota na mesma célula, total no pé. */
export function TabelaDosImpostos({
  linhas,
  colunas,
  rotulos,
  rotuloNome,
  limite,
}: {
  linhas: LinhaDaVisao[];
  colunas: ColunaDeImposto[];
  rotulos: { total: string; fecho: string; dicaFecho: string };
  rotuloNome: string;
  /** Quantas linhas desenhar; o total do pé soma todas. */
  limite: number;
}) {
  const valem = linhas.filter((l) => !l.cancelada);
  const soma = somarImpostos(
    valem.map((l) => l.impostos),
    colunas,
  );
  const valorTotal = r2(valem.reduce((s, l) => s + l.valor, 0));
  const temEstimado = valem.some((l) => colunas.some((c) => l.impostos.porImposto[c.chave]?.estimado));
  return (
    <div className="space-y-2">
      <div className="relative overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
        <Table className="table-fixed">
          <colgroup>
            <col className="w-[96px]" />
            <col className="w-[128px]" />
            <col className="w-[100px]" />
            <col />
            <col className="w-[120px]" />
            {colunas.map((c) => (
              <col key={c.chave} className="w-[100px]" />
            ))}
            <col className="w-[120px]" />
            <col className="w-[128px]" />
            <col className="w-[56px]" />
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead>NF</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Emissão</TableHead>
              <TableHead>{rotuloNome}</TableHead>
              <TableHead>CNAE</TableHead>
              {colunas.map((c) => (
                <TableHead key={c.chave} className="border-l border-border/60">
                  <TituloDoImposto c={c} />
                </TableHead>
              ))}
              <TableHead className="border-l border-border/60 text-right">{rotulos.total}</TableHead>
              <TableHead className="text-right">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="cursor-default">{rotulos.fecho}</span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs normal-case tracking-normal">
                    {rotulos.dicaFecho}
                  </TooltipContent>
                </Tooltip>
              </TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.length === 0 && (
              <TableRow>
                <TableCell colSpan={colunas.length + 8} className="py-12 text-center text-muted-foreground">
                  Nenhuma nota com esses filtros.
                </TableCell>
              </TableRow>
            )}
            {linhas.slice(0, limite).map((l) => (
              <TableRow key={l.id} className={l.cancelada ? "text-muted-foreground" : undefined}>
                <TableCell className={cn("font-mono text-[13px] font-bold", l.cancelada && "line-through")}>{l.numero}</TableCell>
                <TableCell className={cn("text-right font-mono text-[13px] font-semibold tabular-nums", l.cancelada && "line-through")}>{moeda(l.valor)}</TableCell>
                <TableCell className="font-mono text-[12px]">{dataBR(l.emissao)}</TableCell>
                <TableCell>
                  <TruncateTooltip text={l.nome} className="text-[13px]" />
                  {l.documento && <div className="font-mono text-[11px] text-muted-foreground">{l.documento}</div>}
                </TableCell>
                <TableCell className="font-mono text-[11px] leading-tight">{l.cnae ?? <span className="font-sans text-muted-foreground">—</span>}</TableCell>
                {colunas.map((c) => (
                  <TableCell key={c.chave} className="border-l border-border/60 text-right">
                    {l.cancelada ? <span className="text-muted-foreground">—</span> : <CelulaDoImposto v={l.impostos.porImposto[c.chave]} />}
                  </TableCell>
                ))}
                <TableCell className="border-l border-border/60 text-right">
                  {l.cancelada || l.impostos.total <= 0.004 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <div className="leading-tight">
                      <div className="font-mono text-[12.5px] font-semibold tabular-nums">{moeda(l.impostos.total)}</div>
                      <div className="font-mono text-[10.5px] text-muted-foreground">{pct(r2((l.impostos.total / l.valor) * 100))}</div>
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right">{l.cancelada ? <span className="text-muted-foreground">—</span> : <CelulaDoFecho i={l.impostos} />}</TableCell>
                <TableCell className="text-right">
                  {l.onVer && (
                    <button
                      type="button"
                      onClick={l.onVer}
                      aria-label={`Ver a NF ${l.numero}`}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-white text-muted-foreground transition-colors hover:border-california-red/40 hover:text-california-red"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {valem.length > 0 && (
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableCell className="text-[12px] font-bold">Total</TableCell>
                <TableCell className="text-right font-mono text-[13px] font-bold tabular-nums">{moeda(valorTotal)}</TableCell>
                <TableCell colSpan={3} className="text-[11.5px] text-muted-foreground">
                  {valem.length === 1 ? "1 nota" : `${valem.length} notas`}
                </TableCell>
                {colunas.map((c) => (
                  <TableCell key={c.chave} className="border-l border-border/60 text-right font-mono text-[12.5px] font-semibold tabular-nums">
                    {soma.porImposto[c.chave] > 0.004 ? moeda(soma.porImposto[c.chave]) : <span className="font-sans text-muted-foreground">—</span>}
                  </TableCell>
                ))}
                <TableCell className="border-l border-border/60 text-right">
                  <div className="leading-tight">
                    <div className="font-mono text-[12.5px] font-bold tabular-nums">{moeda(soma.total)}</div>
                    <div className="font-mono text-[10.5px] text-muted-foreground">{valorTotal ? pct(r2((soma.total / valorTotal) * 100)) : ""}</div>
                  </div>
                </TableCell>
                <TableCell className="text-right font-mono text-[12.5px] font-bold tabular-nums">{soma.fecho > 0.004 ? moeda(soma.fecho) : "—"}</TableCell>
                <TableCell />
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {temEstimado && (
        <p className="text-[11.5px] text-amber-700">* IRPJ, adicional e CSLL estimados por nota, como na planilha. O devido sai da apuração do trimestre.</p>
      )}
    </div>
  );
}
