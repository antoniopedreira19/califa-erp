import { cn } from "@/lib/utils";
import type { LinhaDaDre } from "@/lib/historico-financeiro/dre";

/**
 * A DRE de uma empresa num ano: as linhas na ordem da planilha, os quatro
 * trimestres e o ano. O subtotal vem destacado; a dica da linha diz de onde
 * ela sai (o Tipo ou a chave da coluna Jobs, e a regra do sinal).
 */
export function TabelaDre({
  linhas,
  depoisDoHistorico,
  fimDoHistorico,
}: {
  linhas: LinhaDaDre[];
  /** Os trimestres que terminam depois do fim do histórico carregado. */
  depoisDoHistorico: [boolean, boolean, boolean, boolean];
  fimDoHistorico: string;
}) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
      <table className="w-full min-w-[900px] table-fixed text-sm">
        <colgroup>
          <col style={{ width: 360 }} />
          <col />
          <col />
          <col />
          <col />
          <col />
        </colgroup>
        <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-4 py-3 text-left font-semibold">Linha</th>
            {depoisDoHistorico.map((depois, i) => (
              <th
                key={i}
                className="px-4 py-3 text-right font-semibold"
                title={depois ? `Termina depois de ${fimDoHistorico}: só o que a planilha lançou até lá` : undefined}
              >
                {i + 1}º tri{depois ? "*" : ""}
              </th>
            ))}
            <th className="px-4 py-3 text-right font-semibold">Ano</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {linhas.map((l) => (
            <tr key={l.chave} className={cn(l.subtotal && "bg-muted/30 font-semibold")}>
              <td className="px-4 py-2.5" title={l.origem}>
                {l.rotulo}
              </td>
              {l.trimestres.map((v, i) => (
                <td key={i} className={cn("px-4 py-2.5 text-right font-mono", depoisDoHistorico[i] && "text-muted-foreground")}>
                  <Valor valor={v} />
                </td>
              ))}
              <td className="px-4 py-2.5 text-right font-mono">
                <Valor valor={l.ano} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Valor({ valor }: { valor: number }) {
  if (valor === 0) return <span className="text-muted-foreground">—</span>;
  return <>{valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</>;
}
