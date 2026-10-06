/**
 * O resumo de investimentos da Campanha (decisão 147): o plano inteiro, por
 * meio e mês — o que a aba CRONO do plano de mídia em Excel mostra. A visão
 * de cada meio de ponta a ponta, que a planilha por mês não tem.
 */

import { cn, formatCurrency } from "@/lib/utils";
import { ORCADO, VEICULACAO } from "@/app/(app)/_planilha/blocos";
import {
  contaDaLinha,
  nomeDoMesMidia,
  somar,
  type LinhaMidia,
  type MeioDaVersao,
  type ParametrosMidia,
} from "@/lib/calculos/midia-off";

const brl = (v: number) => formatCurrency(v, "BRL");
const inteiro = (v: number) => Math.round(v).toLocaleString("pt-BR");

export function ResumoDeInvestimentos({
  meios,
  linhas,
  meses,
  chaveDe,
  mesDe,
  params,
}: {
  meios: MeioDaVersao[];
  linhas: LinhaMidia[];
  /** Os meses da campanha, "2026-07". */
  meses: string[];
  /** A chave do meio e o mês da linha. */
  chaveDe: (l: LinhaMidia) => string;
  mesDe: (l: LinhaMidia) => string;
  params: ParametrosMidia;
}) {
  const porMeio = meios.map((m) => {
    const doMeio = linhas.filter((l) => chaveDe(l) === m.chave);
    return { m, doMeio, conta: somar(doMeio.map((l) => contaDaLinha(l, params))) };
  });
  const geral = somar(porMeio.map((x) => x.conta));
  const totalNoMes = (doMeio: LinhaMidia[], mes: string) =>
    doMeio.filter((l) => mesDe(l) === mes).reduce((t, l) => t + contaDaLinha(l, params).total, 0);
  const th = "px-3 py-2 font-semibold";
  const larg = meses.length ? 132 : 150;
  return (
    <div className="rounded-2xl border border-border bg-card shadow-soft">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Resumo de investimentos</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">O plano inteiro, por meio — o que a aba CRONO do Excel mostra.</p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full table-fixed border-collapse text-sm">
          <colgroup>
            <col />
            <col style={{ width: 168 }} />
            <col style={{ width: 104 }} />
            {meses.map((m) => (
              <col key={m} style={{ width: 116 }} />
            ))}
            <col style={{ width: larg }} />
            <col style={{ width: larg - 10 }} />
            <col style={{ width: larg }} />
            <col style={{ width: 76 }} />
          </colgroup>
          <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className={cn(th, "pl-6 text-left")}>Meio</th>
              <th className={cn(th, "text-left")}>Forma de compra</th>
              <th className={cn(th, "text-right")}>Volume</th>
              {meses.map((m) => (
                <th key={m} className={cn(th, "text-right")}>
                  {nomeDoMesMidia(m, true)}
                </th>
              ))}
              <th className={cn(th, "text-right")}>Veículos</th>
              <th className={cn(th, "text-right")}>Honorários</th>
              <th className={cn(th, "text-right")}>Total orçado</th>
              <th className={cn(th, "pr-6 text-right")}>Part.</th>
            </tr>
          </thead>
          <tbody>
            {porMeio.map(({ m, doMeio, conta }) => (
              <tr key={m.chave} className="border-t border-border">
                <td className="px-3 py-2.5 pl-6">
                  <span className="font-semibold text-foreground">{m.meio}</span>{" "}
                  <span className="ml-1 font-mono text-[11px] text-muted-foreground">{m.formato}</span>
                </td>
                <td className="px-3 py-2.5 text-muted-foreground">
                  {m.forma === "grade" ? "Grade de inserções" : "Período"} · {doMeio.length}{" "}
                  {doMeio.length === 1 ? "linha" : "linhas"}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-[12.5px]">
                  {inteiro(conta.quantidade)}{" "}
                  <span className="font-sans text-[11px] text-muted-foreground">{m.forma === "grade" ? "ins." : "un."}</span>
                </td>
                {meses.map((mes) => {
                  const v = totalNoMes(doMeio, mes);
                  return (
                    <td key={mes} className={cn("px-3 py-2.5 text-right font-mono text-[12.5px]", !v && "text-muted-foreground/50")}>
                      {v ? brl(v) : "—"}
                    </td>
                  );
                })}
                <td className="px-3 py-2.5 text-right font-mono text-[12.5px] text-muted-foreground">{brl(conta.notaVeiculo)}</td>
                <td className="px-3 py-2.5 text-right font-mono text-[12.5px] text-muted-foreground">{brl(conta.notaAgencia)}</td>
                <td className={cn("px-3 py-2.5 text-right font-mono text-[12.5px] font-semibold", ORCADO.texto)}>{brl(conta.total)}</td>
                <td className="px-3 py-2.5 pr-6 text-right font-mono text-[12.5px]">
                  {geral.total > 0 ? `${((conta.total / geral.total) * 100).toFixed(1).replace(".", ",")}%` : "—"}
                </td>
              </tr>
            ))}
            <tr className={VEICULACAO.peForte}>
              <td colSpan={3} className="px-3 py-2.5 pl-6 text-[10px] font-bold uppercase tracking-wider">
                Total do plano
              </td>
              {meses.map((mes) => (
                <td key={mes} className="px-3 py-2.5 text-right font-mono text-[13px] font-bold">
                  {brl(porMeio.reduce((t, x) => t + totalNoMes(x.doMeio, mes), 0))}
                </td>
              ))}
              <td className="px-3 py-2.5 text-right font-mono text-[13px] font-bold">{brl(geral.notaVeiculo)}</td>
              <td className="px-3 py-2.5 text-right font-mono text-[13px] font-bold">{brl(geral.notaAgencia)}</td>
              <td className={cn("px-3 py-2.5 text-right font-mono text-[13px] font-bold", ORCADO.texto)}>{brl(geral.total)}</td>
              <td className="px-3 py-2.5 pr-6 text-right font-mono text-[13px] font-bold">100%</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="px-6 py-3 text-[11.5px] text-muted-foreground">
        A linha por período entra no mês da data de início, como no CRONO.
      </p>
    </div>
  );
}
