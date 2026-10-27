import { cn } from "@/lib/utils";
import type { LinhaDaRentabilidade, RentabilidadeDosJobs, VisaoDaRentabilidade } from "@/lib/historico-financeiro/rentabilidade";
import { Valor } from "../_historico/filtros";

const ROTULO_DA_VISAO: Record<VisaoDaRentabilidade, string> = { cliente: "Cliente", marca: "Marca", job: "Job" };

/** As colunas de valor, com a dica de cada uma (de onde vem na aba Res. Jobs). */
const COLUNAS: readonly { chave: keyof LinhaDaRentabilidade; rotulo: string; dica: string; tipo: "valor" | "pct" }[] = [
  { chave: "receita", rotulo: "Receita", dica: "TOTAL RECEITA: o que o job recebeu nas contas (Tipo REC)", tipo: "valor" },
  { chave: "imposto", rotulo: "Imposto", dica: "IMPOSTO: os impostos das notas emitidas do job", tipo: "valor" },
  { chave: "custo", rotulo: "Custo", dica: "TOTAL CO: o custo operacional do job (Tipo CO)", tipo: "valor" },
  { chave: "resultado", rotulo: "Resultado", dica: "Receita − imposto − custo, como o Result. Op da Rentabilidade de Jobs", tipo: "valor" },
  { chave: "resultadoPct", rotulo: "%", dica: "O resultado sobre a receita", tipo: "pct" },
  {
    chave: "fee",
    rotulo: "Fee (planilha)",
    dica: "Calculado por dentro sobre a receita menos o imposto, com o percentual de fee do job na planilha (12% na California, 15% na CCH): (receita − imposto) × fee ÷ (1 + fee). Não é o honorário orçado.",
    tipo: "valor",
  },
  { chave: "rentabilidade", rotulo: "Rentabilidade", dica: "O resultado menos o fee (planilha)", tipo: "valor" },
  { chave: "rentabilidadePct", rotulo: "%", dica: "A rentabilidade sobre a receita", tipo: "pct" },
  { chave: "representatividadePct", rotulo: "Rep %", dica: "A parte da receita do período", tipo: "pct" },
];

function Percentual({ valor }: { valor: number | null }) {
  if (valor === null) return <span className="text-muted-foreground">—</span>;
  return <>{valor.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</>;
}

function Celula({ linha, coluna }: { linha: LinhaDaRentabilidade; coluna: (typeof COLUNAS)[number] }) {
  const v = linha[coluna.chave];
  return coluna.tipo === "pct" ? <Percentual valor={v as number | null} /> : <Valor valor={v as number} />;
}

/**
 * A rentabilidade dos jobs do histórico por cliente, marca ou job: as colunas
 * da aba Res. Jobs (receita, imposto, custo, resultado, fee e rentabilidade),
 * com o total em cima. Mesma grade fixa no cabeçalho e nas linhas.
 */
export function TabelaRentabilidade({ resultado, visao }: { resultado: RentabilidadeDosJobs; visao: VisaoDaRentabilidade }) {
  const { linhas, total } = resultado;
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
      <table className="w-full table-fixed text-sm" style={{ minWidth: 300 + 6 * 130 + 3 * 72 }}>
        <colgroup>
          <col style={{ width: 300 }} />
          {COLUNAS.map((c) => (
            <col key={c.chave} style={c.tipo === "pct" ? { width: 72 } : undefined} />
          ))}
        </colgroup>
        <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-4 py-3 text-left font-semibold">{ROTULO_DA_VISAO[visao]}</th>
            {COLUNAS.map((c) => (
              <th key={c.chave} className="px-3 py-3 text-right font-semibold" title={c.dica}>
                {c.rotulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          <tr className="bg-muted/30 font-semibold">
            <td className="px-4 py-2.5">
              Total <span className="font-normal text-muted-foreground">· {total.jobs} {total.jobs === 1 ? "job" : "jobs"}</span>
            </td>
            {COLUNAS.map((c) => (
              <td key={c.chave} className="px-3 py-2.5 text-right font-mono">
                <Celula linha={total} coluna={c} />
              </td>
            ))}
          </tr>
          {linhas.map((l) => (
            <tr key={l.chave}>
              <td className="px-4 py-2.5">
                <p className="truncate" title={l.rotulo}>
                  {l.rotulo}
                  {visao !== "job" && (
                    <span className="text-muted-foreground">
                      {" "}
                      · {l.jobs} {l.jobs === 1 ? "job" : "jobs"}
                    </span>
                  )}
                </p>
                {l.detalhe && (
                  <p className="truncate text-xs text-muted-foreground" title={l.detalhe}>
                    {l.detalhe}
                  </p>
                )}
              </td>
              {COLUNAS.map((c) => (
                <td key={c.chave} className={cn("px-3 py-2.5 text-right font-mono", c.tipo === "pct" && "text-muted-foreground")}>
                  <Celula linha={l} coluna={c} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
