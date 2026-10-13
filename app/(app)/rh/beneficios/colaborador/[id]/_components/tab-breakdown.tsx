import type { BeneficioCustoMensalLinha, BeneficioModoCusteio } from "@/lib/types";

const MODO_LABEL: Record<BeneficioModoCusteio, string> = {
  rateado: "Rateado 60/40",
  integral_empresa: "Integral empresa",
  integral_empresa_com_upgrade: "Integral + upgrade",
};

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

const formatarBrl = (n: number | null | undefined) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  });
};

export function TabBreakdown({
  breakdown,
  ano,
  mes,
}: {
  breakdown: BeneficioCustoMensalLinha[];
  ano: number;
  mes: number;
}) {
  if (breakdown.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/20 p-10 text-center text-sm text-muted-foreground">
        Nenhum vínculo ativo em {MESES[mes - 1]}/{ano}.
      </div>
    );
  }

  const semFaixa = breakdown.some(
    (l) =>
      l.valor_integral_titular === null ||
      l.valor_integral_titular === undefined ||
      !Number.isFinite(Number(l.valor_integral_titular)),
  );

  const totalEmpresa = breakdown.reduce((s, l) => {
    const v = Number(l.valor_empresa_titular);
    return s + (Number.isFinite(v) ? v : 0);
  }, 0);
  const totalColaborador = breakdown.reduce((s, l) => {
    const v = Number(l.valor_desconto_folha_total);
    return s + (Number.isFinite(v) ? v : 0);
  }, 0);

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Cálculo — {MESES[mes - 1]}/{ano}
      </h3>

      {semFaixa && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          Alguma linha abaixo não encontrou faixa de preço cadastrada para a
          idade. Confira o catálogo do benefício em questão.
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-soft">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left">Benefício</th>
              <th className="px-4 py-3 text-left">Modo</th>
              <th className="px-4 py-3 text-center">Idade</th>
              <th className="px-4 py-3 text-right">Integral titular</th>
              <th className="px-4 py-3 text-right">Empresa</th>
              <th className="px-4 py-3 text-right">Colab titular</th>
              <th className="px-4 py-3 text-center">Deps</th>
              <th className="px-4 py-3 text-right">Deps total</th>
              <th className="px-4 py-3 text-right">Desconto folha</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {breakdown.map((l) => {
              const semFaixaLinha =
                l.valor_integral_titular === null ||
                l.valor_integral_titular === undefined ||
                !Number.isFinite(Number(l.valor_integral_titular));
              return (
                <tr
                  key={l.vinculo_id}
                  className={semFaixaLinha ? "bg-amber-50/50" : ""}
                >
                  <td className="px-4 py-3 font-medium text-foreground">
                    {l.beneficio_nome}
                    {semFaixaLinha && (
                      <div className="mt-0.5 text-xs font-normal text-amber-700">
                        Faixa não cadastrada
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {MODO_LABEL[l.modo_custeio]}
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums">
                    {l.idade_titular}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatarBrl(l.valor_integral_titular)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-emerald-700">
                    {formatarBrl(l.valor_empresa_titular)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-amber-700">
                    {formatarBrl(l.valor_colaborador_titular)}
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums">
                    {l.qtde_dependentes}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-amber-700">
                    {formatarBrl(l.valor_dependentes_total)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold text-amber-800">
                    {formatarBrl(l.valor_desconto_folha_total)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="bg-muted/40 text-xs font-semibold">
            <tr>
              <td colSpan={4} className="px-4 py-3 text-right text-muted-foreground">
                TOTAL
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-emerald-700">
                {formatarBrl(totalEmpresa)}
              </td>
              <td colSpan={3} />
              <td className="px-4 py-3 text-right tabular-nums text-amber-800">
                {formatarBrl(totalColaborador)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
