import { cn } from "@/lib/utils";
import type { PercentualDoRateio, ResultadoPorRegional } from "@/lib/historico-financeiro/regional";
import { Valor } from "../_historico/filtros";

/**
 * O resultado por regional de uma empresa num período: as linhas das abas
 * Gerencial × as regionais, o que ficou sem regional e o total, que é o da
 * DRE do histórico. Os grupos (gastos fixos da regional e gerais) vêm com o
 * total em cima e as linhas deles recuadas; a dica da linha diz de onde ela
 * sai.
 */
export function TabelaRegional({ resultado }: { resultado: ResultadoPorRegional }) {
  const { colunas, temSemRegional, linhas } = resultado;
  const extras = (temSemRegional ? 1 : 0) + 1;
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
      <table className="w-full table-fixed text-sm" style={{ minWidth: 300 + (colunas.length + extras) * 130 }}>
        <colgroup>
          <col style={{ width: 300 }} />
          {colunas.map((c) => (
            <col key={c} />
          ))}
          {temSemRegional && <col />}
          <col />
        </colgroup>
        <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-4 py-3 text-left font-semibold">Linha</th>
            {colunas.map((c) => (
              <th key={c} className="px-4 py-3 text-right font-semibold">
                {c}
              </th>
            ))}
            {temSemRegional && (
              <th className="px-4 py-3 text-right font-semibold" title="Lançamentos sem regional, e o TD de ano sem percentual">
                Sem regional
              </th>
            )}
            <th className="px-4 py-3 text-right font-semibold">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {linhas.map((l) => (
            <tr key={l.chave} className={cn(l.tipo === "total" && "bg-muted/30 font-semibold", l.tipo === "grupo" && "font-semibold")}>
              <td className={cn("px-4 py-2.5", l.nivel === 1 && "pl-9 text-muted-foreground")} title={l.origem}>
                {l.rotulo}
              </td>
              {l.regionais.map((v, i) => (
                <td key={colunas[i]} className="px-4 py-2.5 text-right font-mono">
                  <Valor valor={v} />
                </td>
              ))}
              {temSemRegional && (
                <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">
                  <Valor valor={l.semRegional} />
                </td>
              )}
              <td className="px-4 py-2.5 text-right font-mono">
                <Valor valor={l.total} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const ROTULO_DO_GRUPO: Record<string, string> = { IMOB: "imobilizado", PL: "participação nos lucros" };
const percentual = (p: number) => `${p.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

/** Os percentuais de um ano, como a planilha registra: a linha do ano e as próprias de um trimestre e grupo. */
function linhasDoAno(rateio: readonly PercentualDoRateio[], ano: number) {
  const doAno = rateio.filter((r) => r.ano === ano);
  const chaves = [...new Set(doAno.map((r) => `${r.trimestre ?? ""}|${r.grupo ?? ""}`))];
  return chaves.map((chave) => {
    const linhas = doAno.filter((r) => `${r.trimestre ?? ""}|${r.grupo ?? ""}` === chave);
    const [trimestre, grupo] = chave.split("|");
    return {
      chave,
      quando: trimestre ? `${trimestre}º trimestre, ${ROTULO_DO_GRUPO[grupo] ?? grupo}` : "Ano",
      percentuais: new Map(linhas.map((r) => [r.regional, r.percentual])),
      origem: [...new Set(linhas.map((r) => r.origem))].join("; "),
    };
  });
}

/**
 * O rateio do ano em uso e, abrindo, o de todos os anos da empresa, com a
 * célula da planilha de onde cada percentual veio.
 */
export function RateioDaEmpresa({
  rateio,
  ano,
  colunas,
}: {
  rateio: readonly PercentualDoRateio[];
  ano: number;
  colunas: readonly string[];
}) {
  const anos = [...new Set(rateio.map((r) => r.ano))].sort();
  const regionais = [
    ...colunas.filter((c) => rateio.some((r) => r.regional === c)),
    ...[...new Set(rateio.map((r) => r.regional))].filter((r) => !colunas.includes(r)),
  ];
  const doAno = linhasDoAno(rateio, ano);
  return (
    <div className="space-y-2 rounded-2xl border border-border bg-card px-4 py-3 text-sm shadow-soft">
      {doAno.length === 0 ? (
        <p className="text-muted-foreground">
          A planilha não registra rateio em {ano}: o TD fica em &quot;Sem regional&quot;.
        </p>
      ) : (
        doAno.map((l) => (
          <p key={l.chave} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-[11px] uppercase text-muted-foreground">
              Rateio de {ano}
              {l.quando !== "Ano" && ` · ${l.quando}`}
            </span>
            {regionais
              .filter((r) => l.percentuais.has(r))
              .map((r) => (
                <span key={r} className="font-mono text-xs">
                  {r} {percentual(l.percentuais.get(r)!)}
                </span>
              ))}
            <span className="text-xs text-muted-foreground">{l.origem}</span>
          </p>
        ))
      )}
      {anos.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-xs font-semibold text-california-red hover:underline">
            Ver o rateio de todos os anos
          </summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full table-fixed text-xs" style={{ minWidth: 220 + regionais.length * 80 + 220 }}>
              <colgroup>
                <col style={{ width: 220 }} />
                {regionais.map((r) => (
                  <col key={r} style={{ width: 80 }} />
                ))}
                <col />
              </colgroup>
              <thead className="text-[11px] uppercase text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="py-2 pr-3 text-left font-semibold">Ano</th>
                  {regionais.map((r) => (
                    <th key={r} className="px-2 py-2 text-right font-semibold">
                      {r}
                    </th>
                  ))}
                  <th className="py-2 pl-4 text-left font-semibold">Origem na planilha</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {anos.flatMap((a) =>
                  linhasDoAno(rateio, a).map((l) => (
                    <tr key={`${a}|${l.chave}`} className={cn(a === ano && "font-semibold")}>
                      <td className="py-1.5 pr-3">
                        {a}
                        {l.quando !== "Ano" && <span className="font-normal text-muted-foreground"> · {l.quando}</span>}
                      </td>
                      {regionais.map((r) => (
                        <td key={r} className="px-2 py-1.5 text-right font-mono">
                          {l.percentuais.has(r) ? percentual(l.percentuais.get(r)!) : <span className="text-muted-foreground">—</span>}
                        </td>
                      ))}
                      <td className="truncate py-1.5 pl-4 text-muted-foreground" title={l.origem}>
                        {l.origem}
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
