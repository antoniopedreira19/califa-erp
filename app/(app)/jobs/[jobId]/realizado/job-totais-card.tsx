import { Calculator } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import {
  calcularTotaisVersao,
  calcularTotaisPlanejados,
  calcularTotaisRealizado,
  calcularVariacao,
} from "@/lib/calculos/versao-totais";
import {
  agregarRentabilidadePorProjeto,
  type JobParaAgregar,
} from "@/lib/calculos/projeto-totais";
import {
  tipoCustoLabel,
  type TipoCusto,
  type VersaoOrcamentoGrupo,
  type VersaoOrcamentoItem,
  type JobItemRealizado,
} from "@/lib/types";

interface Props {
  grupos: VersaoOrcamentoGrupo[];
  itens: VersaoOrcamentoItem[];
  realizadosMap: Map<string, JobItemRealizado>;
  percentualHonorarios: number;
  percentualImposto: number;
  moeda: string;
}

const TIPOS: TipoCusto[] = ["A", "B", "C", "D"];

const CELULA_ORCADO = "border-l-2 border-l-[#e4e2dd] bg-black/[0.015]";
const CELULA_PLANEJADO = "border-l-2 border-l-[#cfe0f7] bg-[#f7fbff]";
const CELULA_REALIZADO = "border-l-2 border-l-[#f0c874] bg-[#fefbf0]";

function formatarPercentual(p: number): string {
  return `${p.toFixed(1).replace(".", ",")}%`;
}

export function JobTotaisCard({
  grupos,
  itens,
  realizadosMap,
  percentualHonorarios,
  percentualImposto,
  moeda,
}: Props) {
  const {
    subtotaisPorTipo,
    subtotalGeral,
    honorarios,
    imposto,
    faturamento,
  } = calcularTotaisVersao(itens, percentualHonorarios, percentualImposto);

  const { totalPlanejado } = calcularTotaisPlanejados(itens);

  // Enriquece itens com total_realizado do map (0 se sem lancamento)
  const itensComRealizado = itens.map((it) => {
    const r = realizadosMap.get(it.id);
    return { total_realizado: r ? Number(r.total_realizado ?? 0) : 0 };
  });
  const { totalRealizado } = calcularTotaisRealizado(itensComRealizado);

  // Agrupamentos por grupo — reusa a mesma funcao usada na pagina de projeto,
  // garantindo que visao individual e visao agregada calculam da mesma forma.
  const jobParaAgregar: JobParaAgregar = {
    grupos: grupos.map((g) => ({
      id: g.id,
      nome: g.nome,
      created_at: g.created_at,
    })),
    itens: itens.map((i) => ({
      id: i.id,
      grupo_id: i.grupo_id,
      total_orcado: i.total_orcado,
      total_planejado: i.total_planejado,
    })),
    realizadosPorItemId: realizadosMap as unknown as Map<
      string,
      { total_realizado: number | string | null }
    >,
  };
  const { linhas: linhasAgregadas } = agregarRentabilidadePorProjeto(
    [jobParaAgregar],
    "primeiroEncontro",
  );
  const linhas = linhasAgregadas.map((l) => ({
    id: l.chaveNormalizada,
    nome: l.nomeExibicao,
    orcado: l.orcado,
    planejado: l.planejado,
    realizado: l.realizado,
  }));

  const realizadoPorTipo: Record<TipoCusto, number> = { A: 0, B: 0, C: 0, D: 0 };
  for (const it of itens) {
    const r = realizadosMap.get(it.id);
    if (r) {
      realizadoPorTipo[it.tipo_custo] += Number(r.total_realizado ?? 0);
    }
  }

  const planejadoPorTipo: Record<TipoCusto, number> = { A: 0, B: 0, C: 0, D: 0 };
  for (const it of itens) {
    planejadoPorTipo[it.tipo_custo] += Number(it.total_planejado ?? 0);
  }

  const { variacaoRS, variacaoPct } = calcularVariacao(
    totalRealizado,
    totalPlanejado,
  );

  const resultadoReal =
    totalRealizado > 0 ? faturamento - imposto - totalRealizado : null;
  const resultadoPct =
    resultadoReal !== null && faturamento > 0
      ? (resultadoReal / faturamento) * 100
      : null;

  const corVariacao = variacaoRS > 0 ? "text-california-red" : "text-emerald-700";

  return (
    <div className="rounded-2xl border border-border bg-card shadow-soft">
      <div className="flex items-center gap-2 border-b border-border p-6">
        <Calculator className="h-5 w-5 text-california-red" />
        <div>
          <h2 className="text-lg font-semibold leading-none tracking-tight">
            Totais do job
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Orcado x Planejado x Realizado — comparacao lado a lado.
          </p>
        </div>
      </div>

      {/* Camada 1: por grupo */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="bg-muted/40 border-b border-border" />
              <th className="text-center px-4 py-2 text-[11px] font-extrabold tracking-[0.1em] text-foreground bg-[#f1f0ec] border-b-[3px] border-b-[#282828] border-l-2 border-l-[#d7d7d7]">
                ORÇADO
              </th>
              <th className="text-center px-4 py-2 text-[11px] font-extrabold tracking-[0.1em] text-[#1e4fa3] bg-[#e8f0fd] border-b-[3px] border-b-[#2f6fdb] border-l-2 border-l-[#b9d1f4]">
                PLANEJADO
              </th>
              <th className="text-center px-4 py-2 text-[11px] font-extrabold tracking-[0.1em] text-[#92400e] bg-[#fef3c7] border-b-[3px] border-b-[#d97706] border-l-2 border-l-[#f0c874]">
                REALIZADO
              </th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.id} className="border-b border-border">
                <td className="px-4 py-2 text-sm text-muted-foreground">{l.nome}</td>
                <td className={cn("px-4 py-2 text-right font-mono text-sm", CELULA_ORCADO)}>
                  {formatCurrency(l.orcado, moeda)}
                </td>
                <td className={cn("px-4 py-2 text-right font-mono text-sm", CELULA_PLANEJADO)}>
                  {l.planejado > 0 ? formatCurrency(l.planejado, moeda) : "—"}
                </td>
                <td className={cn("px-4 py-2 text-right font-mono text-sm", CELULA_REALIZADO)}>
                  {l.realizado > 0 ? formatCurrency(l.realizado, moeda) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-t-border">
              <td className="px-4 py-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Subtotal geral
              </td>
              <td className={cn("px-4 py-3 text-right font-mono text-sm font-bold", CELULA_ORCADO)}>
                {formatCurrency(subtotalGeral, moeda)}
              </td>
              <td className={cn("px-4 py-3 text-right font-mono text-sm font-bold text-[#1e4fa3]", CELULA_PLANEJADO)}>
                {totalPlanejado > 0 ? formatCurrency(totalPlanejado, moeda) : "—"}
              </td>
              <td className={cn("px-4 py-3 text-right font-mono text-sm font-bold text-[#92400e]", CELULA_REALIZADO)}>
                {totalRealizado > 0 ? formatCurrency(totalRealizado, moeda) : "—"}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Camada 2: por tipo de custo */}
      <div className="border-t border-border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="bg-muted/20 border-b border-border" />
              <th className="text-center px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/20 border-b border-border">
                ORÇADO
              </th>
              <th className="text-center px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/20 border-b border-border">
                PLANEJADO
              </th>
              <th className="text-center px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/20 border-b border-border">
                REALIZADO
              </th>
            </tr>
          </thead>
          <tbody>
            {TIPOS.map((t) => (
              <tr key={t} className="border-b border-border last:border-0">
                <td className="px-4 py-2 text-xs text-muted-foreground">
                  {tipoCustoLabel(t)}
                </td>
                <td className="px-4 py-2 text-right font-mono text-xs">
                  {formatCurrency(subtotaisPorTipo[t], moeda)}
                </td>
                <td className="px-4 py-2 text-right font-mono text-xs">
                  {planejadoPorTipo[t] > 0
                    ? formatCurrency(planejadoPorTipo[t], moeda)
                    : "—"}
                </td>
                <td className="px-4 py-2 text-right font-mono text-xs">
                  {realizadoPorTipo[t] > 0
                    ? formatCurrency(realizadoPorTipo[t], moeda)
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Camada 3: honorarios, impostos, faturamento */}
      <div className="border-t border-border grid grid-cols-3 gap-4 p-6 bg-muted/10">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Honorários</p>
          <p className="mt-1 font-mono text-sm font-semibold">
            {formatCurrency(honorarios, moeda)}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Impostos (gross-up)</p>
          <p className="mt-1 font-mono text-sm font-semibold">
            {formatCurrency(imposto, moeda)}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Faturamento</p>
          <p className="mt-1 font-mono text-sm font-semibold text-california-red">
            {formatCurrency(faturamento, moeda)}
          </p>
        </div>
      </div>

      {/* Camada 4: resumo do realizado */}
      <div className="border-t border-border p-6 space-y-3">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted-foreground">Total Realizado</span>
          <span className="font-mono text-base font-bold text-[#92400e]">
            {totalRealizado > 0 ? formatCurrency(totalRealizado, moeda) : "—"}
          </span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted-foreground">Variação vs Planejado</span>
          <span className={cn("font-mono text-base font-bold", corVariacao)}>
            {(totalPlanejado <= 0 || totalRealizado === 0) ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              <>
                {formatCurrency(variacaoRS, moeda)}{" "}
                {variacaoPct !== null && (
                  <span className="text-sm">({formatarPercentual(variacaoPct)})</span>
                )}
              </>
            )}
          </span>
        </div>
        <div className="flex items-baseline justify-between border-t border-border pt-3">
          <span className="text-sm font-semibold">
            Resultado Real
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              (Faturamento − Impostos − Realizado)
            </span>
          </span>
          <span className={cn(
            "font-mono text-lg font-extrabold",
            resultadoReal === null
              ? "text-muted-foreground"
              : resultadoReal >= 0
                ? "text-emerald-700"
                : "text-california-red",
          )}>
            {resultadoReal === null
              ? "—"
              : (
                <>
                  {formatCurrency(resultadoReal, moeda)}{" "}
                  {resultadoPct !== null && (
                    <span className="text-sm">({formatarPercentual(resultadoPct)})</span>
                  )}
                </>
              )}
          </span>
        </div>
      </div>
    </div>
  );
}
