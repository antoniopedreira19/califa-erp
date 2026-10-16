"use client";

/**
 * O "a apurar no recebimento" dentro da lista por vencimento (decisão 183,
 * opção A do protótipo de 16/10/2026): no lucro presumido pelo caixa (hoje,
 * a Hitlab), PIS, COFINS, IRPJ e CSLL só nascem quando o cliente paga. Cada
 * imposto que ainda vai nascer vira uma linha "A apurar" na data em que vai
 * vencer — PIS e COFINS pelo mês do recebimento previsto, IRPJ e CSLL pelo
 * trimestre —, com os números de `blocosAApurar` e `irpjCsllAApurar` (os
 * mesmos do fluxo de caixa). O olho abre as parcelas a receber.
 */

import * as React from "react";
import { Eye, Hourglass } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { codigoDarf } from "@/lib/fiscal/codigos-darf";
import { dataBr, mesDe, r2 } from "@/lib/fiscal/datas";
import type { BlocoAApurar, LinhaAApurar } from "@/lib/fiscal/a-apurar";
import type { DadosDaApuracao, PJDaTela } from "./dados";
import { moeda } from "./ui";

/** Um imposto que ainda vai nascer no recebimento: uma linha da lista. */
export interface Projecao {
  chave: string;
  pj: string;
  tributo: "PIS" | "COFINS" | "IRPJ" | "CSLL";
  titulo: string;
  codigo: string | null;
  /** O mês do recebimento previsto (PIS e COFINS); nulo no IRPJ/CSLL. */
  competencia: string | null;
  trimestre: string;
  vencimento: string;
  valor: number;
  /** O que falta receber (a base do PIS e da COFINS). */
  aReceber: number;
  cotas: number;
  linhas: LinhaAApurar[];
}

export function projecoesDe(dados: DadosDaApuracao, pjPorId: Map<string, PJDaTela>): Projecao[] {
  const out: Projecao[] = [];
  for (const b of dados.aApurar) {
    const regime = pjPorId.get(b.pj)?.regime ?? "lucro_presumido";
    const porMes = new Map<string, LinhaAApurar[]>();
    for (const l of b.linhas) {
      const m = mesDe(l.recebimento);
      porMes.set(m, [...(porMes.get(m) ?? []), l]);
    }
    for (const [mes, linhas] of porMes) {
      for (const tributo of ["PIS", "COFINS"] as const) {
        out.push({
          chave: `a-apurar|${tributo}|${b.pj}|${mes}`,
          pj: b.pj,
          tributo,
          titulo: tributo,
          codigo: codigoDarf(tributo, regime),
          competencia: mes,
          trimestre: linhas[0].trimestre,
          vencimento: linhas[0].vencimento,
          valor: r2(linhas.reduce((s, l) => s + (tributo === "PIS" ? l.pis : l.cofins), 0)),
          aReceber: r2(linhas.reduce((s, l) => s + l.a_receber, 0)),
          cotas: 1,
          linhas,
        });
      }
    }
  }
  for (const p of dados.aApurarIrpjCsll) {
    const regime = pjPorId.get(p.pj)?.regime ?? "lucro_presumido";
    const linhas = dados.aApurar.find((b) => b.pj === p.pj)?.linhas.filter((l) => l.trimestre === p.trimestre) ?? [];
    for (const tributo of ["IRPJ", "CSLL"] as const) {
      const valor = tributo === "IRPJ" ? p.irpj : p.csll;
      if (valor <= 0) continue;
      out.push({
        chave: `a-apurar|${tributo}|${p.pj}|${p.trimestre}`,
        pj: p.pj,
        tributo,
        titulo: tributo === "IRPJ" ? "IRPJ (com adicional)" : "CSLL",
        codigo: codigoDarf(tributo, regime),
        competencia: null,
        trimestre: p.trimestre,
        vencimento: p.cotas[0]?.vencimento ?? "",
        valor,
        aReceber: r2(linhas.reduce((s, l) => s + l.a_receber, 0)),
        cotas: p.cotas.length,
        linhas,
      });
    }
  }
  return out;
}

const totalDe = (ps: Projecao[]) => r2(ps.reduce((s, p) => s + p.valor, 0));
const parcelasDe = (ps: Projecao[]) => new Set(ps.flatMap((p) => p.linhas.map((l) => l.titulo_id))).size;

const MES_CURTO = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const mesCurto = (c: string) => `${MES_CURTO[Number(c.slice(5, 7)) - 1]}/${c.slice(0, 4)}`;
const triCurto = (t: string) => `${t.split("-T")[1]}º tri/${t.slice(0, 4)}`;

function PilulaAApurar() {
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-full border border-dashed border-sky-300 bg-sky-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sky-800">
      A apurar
    </span>
  );
}

/** A linha do imposto a apurar, nas mesmas 13 colunas da lista. */
export function LinhaProjecao({ p, pj, onAbrir }: { p: Projecao; pj: PJDaTela | undefined; onAbrir: () => void }) {
  const parcelas = parcelasDe([p]);
  return (
    <tr onClick={onAbrir} className="cursor-pointer border-b border-border bg-sky-50/30 transition-colors last:border-0 hover:bg-accent/40">
      <td className="px-3 py-3">
        <span className="whitespace-nowrap font-mono text-xs font-semibold text-muted-foreground">{dataBr(p.vencimento)}</span>
        <span className="block text-[10.5px] text-muted-foreground">previsão</span>
        {p.cotas > 1 && <span className="block text-[10px] text-muted-foreground">1ª de {p.cotas} cotas</span>}
      </td>
      <td className="px-3 py-3">
        <span className="font-semibold">
          {p.titulo}
          {p.codigo && <span className="ml-1.5 font-mono text-[11px] font-medium text-muted-foreground">DARF {p.codigo}</span>}
        </span>
        <span className="block truncate text-[11px] text-muted-foreground">
          {parcelas === 1 ? p.linhas[0]?.rotulo.split(" · ").slice(0, 2).join(" · ") : `${parcelas} parcelas a receber`}
        </span>
      </td>
      <td className="px-3 py-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate font-medium">{pj?.nome ?? "—"}</span>
          <span className="truncate text-[11px] text-muted-foreground">federal · {pj?.rotulo_regime ?? ""}</span>
        </div>
      </td>
      <td className="px-2 py-3 text-center text-xs">{p.competencia ? mesCurto(p.competencia) : <span className="text-muted-foreground">—</span>}</td>
      <td className="px-2 py-3 text-center text-xs">
        <span className={cn(!p.competencia && "font-semibold")}>{triCurto(p.trimestre)}</span>
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-xs text-muted-foreground">
        {moeda(p.aReceber)}
        <span className="block font-sans text-[10px]">a receber</span>
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-xs text-muted-foreground">—</td>
      <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-xs text-muted-foreground">—</td>
      <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-xs text-muted-foreground">—</td>
      <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-sm font-bold italic tabular-nums text-muted-foreground">{moeda(p.valor)}</td>
      <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-xs text-muted-foreground">—</td>
      <td className="px-2 py-3 text-center">
        <PilulaAApurar />
      </td>
      <td className="px-2 py-3 text-center">
        <button
          type="button"
          title="Ver as parcelas a receber"
          aria-label="Ver as parcelas a receber"
          onClick={(e) => {
            e.stopPropagation();
            onAbrir();
          }}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:border-california-red hover:text-california-red"
        >
          <Eye className="h-3.5 w-3.5" />
        </button>
      </td>
    </tr>
  );
}

/** O total a apurar no resumo do topo (só leitura). */
export function ItemDoResumo({ projecoes }: { projecoes: Projecao[] }) {
  if (projecoes.length === 0) return null;
  const n = parcelasDe(projecoes);
  return (
    <>
      <div className="h-5 w-px bg-border" />
      <div className="flex items-center gap-2.5">
        <Hourglass className="h-3.5 w-3.5 text-sky-700" />
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          A apurar no recebimento · {n} {n === 1 ? "parcela" : "parcelas"}
        </span>
        <span className="font-mono text-sm font-bold tabular-nums">{moeda(totalDe(projecoes))}</span>
      </div>
    </>
  );
}

/** As parcelas a receber que uma linha "A apurar" projeta. */
export function DialogoAApurar({
  dados,
  pjPorId,
  p,
  onClose,
}: {
  dados: DadosDaApuracao;
  pjPorId: Map<string, PJDaTela>;
  p: Projecao;
  onClose: () => void;
}) {
  const blocos: BlocoAApurar[] = dados.aApurar
    .filter((b) => b.pj === p.pj)
    .map((b) => ({ ...b, linhas: b.linhas.filter((l) => p.linhas.some((x) => x.titulo_id === l.titulo_id)) }));
  const irpj = dados.aApurarIrpjCsll.filter((x) => x.pj === p.pj && x.trimestre === p.trimestre);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[980px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Hourglass className="h-5 w-5 text-sky-700" />
            {p.titulo} · a apurar no recebimento
          </DialogTitle>
          <DialogDescription>
            No regime de caixa, PIS, COFINS, IRPJ e CSLL nascem quando o cliente paga. A previsão segue a data de recebimento de cada
            parcela e entra no fluxo de caixa.
          </DialogDescription>
        </DialogHeader>
        {blocos.map((b) => (
          <div key={b.pj} className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <span className="text-foreground">{pjPorId.get(b.pj)?.nome ?? b.pj_nome}</span> · {pjPorId.get(b.pj)?.rotulo_regime}
            </p>
            <div className="overflow-hidden rounded-xl border border-border">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-left text-[10.5px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-3 py-2 font-semibold">Nota</th>
                    <th className="px-3 py-2 font-semibold">Recebimento previsto</th>
                    <th className="px-3 py-2 text-right font-semibold">A receber</th>
                    <th className="px-3 py-2 text-right font-semibold">PIS + COFINS</th>
                    <th className="px-3 py-2 text-right font-semibold">Vencem em</th>
                    <th className="px-3 py-2 font-semibold">IRPJ e CSLL</th>
                  </tr>
                </thead>
                <tbody>
                  {b.linhas.map((l) => (
                    <tr key={l.titulo_id} className="border-b border-border last:border-0">
                      <td className="px-3 py-2">{l.rotulo}</td>
                      <td className="px-3 py-2 font-mono">
                        {dataBr(l.previsao)}
                        {/* Previsão que já passou: a projeção conta o recebimento a partir de amanhã. */}
                        {l.recebimento !== l.previsao && (
                          <span className="block font-sans text-[10.5px] text-muted-foreground">vencida · projetada para {dataBr(l.recebimento)}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{moeda(l.a_receber)}</td>
                      <td className="px-3 py-2 text-right font-mono">{moeda(l.pis_cofins)}</td>
                      <td className="px-3 py-2 text-right font-mono">{dataBr(l.vencimento)}</td>
                      <td className="px-3 py-2 text-muted-foreground">entra na base do {l.rotulo_trimestre}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {irpj.map((x) => (
              <p key={x.trimestre} className="text-[12.5px] text-muted-foreground">
                {x.rotulo_trimestre}: o que falta receber acrescenta <b className="font-semibold text-foreground">{moeda(x.irpj)}</b> de IRPJ e{" "}
                <b className="font-semibold text-foreground">{moeda(x.csll)}</b> de CSLL
                {x.cotas.length > 1 ? `, em ${x.cotas.length} cotas a partir de ${dataBr(x.cotas[0].vencimento)}` : `, em ${dataBr(x.cotas[0]?.vencimento)}`}.
              </p>
            ))}
          </div>
        ))}
      </DialogContent>
    </Dialog>
  );
}
