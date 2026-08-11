import { Calculator, Info } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import {
  calcularTotaisVersao,
  calcularTotaisPlanejados,
  calcularTotaisRealizado,
  calcularRentabilidade,
} from "@/lib/calculos/versao-totais";
import {
  agregarRentabilidadePorProjeto,
  type JobParaAgregar,
} from "@/lib/calculos/projeto-totais";
import { PainelResultado } from "@/components/painel-resultado";
import {
  tipoCustoLabel,
  type TipoCusto,
  type VersaoOrcamentoGrupo,
  type ItemPlanilhaJob,
  type JobItemRealizado,
} from "@/lib/types";
import { ColunasJob, LARGURA_MINIMA_JOB } from "@/app/(app)/_planilha/grade-job";
import {
  ORCADO,
  PLANEJADO,
  REALIZADO,
  FAIXA_ROTULO,
  RENTAB_VALOR,
} from "@/app/(app)/_planilha/blocos";

interface Props {
  grupos: VersaoOrcamentoGrupo[];
  itens: ItemPlanilhaJob[];
  realizadosMap: Map<string, JobItemRealizado>;
  percentualHonorarios: number;
  percentualImposto: number;
  moeda: string;
}

const TIPOS: TipoCusto[] = ["A", "B", "C", "D"];

function formatarPercentual(p: number): string {
  return `${p.toFixed(1).replace(".", ",")}%`;
}

/** Taxa configurada na versão: 12 -> "12%", 19.53 -> "19,53%". */
function formatarTaxa(p: number): string {
  return `${String(p).replace(".", ",")}%`;
}

/** Linha "rótulo ......... valor" dos painéis de fechamento e resultado. */
function LinhaValor({
  rotulo,
  valor,
  destaque,
}: {
  rotulo: React.ReactNode;
  valor: React.ReactNode;
  destaque?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span
        className={cn(
          "text-sm",
          destaque ? "font-semibold text-foreground" : "text-muted-foreground",
        )}
      >
        {rotulo}
      </span>
      <span
        className={cn(
          "whitespace-nowrap font-mono text-sm",
          destaque && "font-semibold",
        )}
      >
        {valor}
      </span>
    </div>
  );
}

/** Célula "R$ x,xx / y,y%" das linhas de Rentabilidade do rodapé. */
function CelulaRentabilidade({
  orcado,
  custo,
  moeda,
  corValor,
  corPercentual,
}: {
  orcado: number;
  custo: number;
  moeda: string;
  corValor: string;
  corPercentual: string;
}) {
  const { rentabilidade, percentual } = calcularRentabilidade(orcado, custo);

  if (custo <= 0) {
    return <span className="font-mono text-sm text-muted-foreground">—</span>;
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className={cn("font-mono text-[13px] font-bold", corValor)}>
        {formatCurrency(rentabilidade, moeda)}
      </span>
      {percentual !== null && (
        <span className={cn("font-mono text-[10.5px]", corPercentual)}>
          {formatarPercentual(percentual)}
        </span>
      )}
    </div>
  );
}

export function JobTotaisCard({
  grupos,
  itens,
  realizadosMap,
  percentualHonorarios,
  percentualImposto,
  moeda,
}: Props) {
  const { subtotaisPorTipo, subtotalGeral, honorarios, imposto, faturamento } =
    calcularTotaisVersao(itens, percentualHonorarios, percentualImposto);

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

  // Sem realizado lancado o rodape mostra travessao em vez de zero — a conta
  // do resultado em si mora no PainelResultado.
  const temRealizado = totalRealizado > 0;

  return (
    <div className="rounded-2xl border border-border bg-card shadow-soft">
      <div className="flex items-center gap-3 border-b border-border p-6">
        <Calculator className="h-5 w-5 text-california-red" />
        <div>
          <h2 className="text-lg font-semibold leading-none tracking-tight">
            Totais
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Orçado × Planejado × Realizado · valores calculados a partir dos
            itens.
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        {/* Mesma grade dos cards de agrupamento acima: as colunas Total
            de Orçado, Planejado e Realizado caem exatamente sob as de lá. */}
        <table
          className={cn(
            "w-full table-fixed border-collapse text-sm",
            LARGURA_MINIMA_JOB,
          )}
        >
          <ColunasJob />
          <thead>
            <tr>
              <th colSpan={3} className="bg-muted/40 border-b border-border" />
              <th colSpan={4} className={cn(FAIXA_ROTULO, ORCADO.faixa)}>
                ORÇADO
              </th>
              <th colSpan={4} className={cn(FAIXA_ROTULO, PLANEJADO.faixa)}>
                PLANEJADO
              </th>
              <th colSpan={4} className={cn(FAIXA_ROTULO, REALIZADO.faixa)}>
                REALIZADO
              </th>
            </tr>
            <tr className="bg-muted/40">
              <th
                colSpan={3}
                className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Agrupamento
              </th>
              <th colSpan={3} className={ORCADO.cabecalhoAbre} />
              <th
                className={cn(
                  "text-right px-3 py-2 text-[10px] font-semibold uppercase tracking-wider",
                  ORCADO.cabecalhoFim,
                )}
              >
                Total
              </th>
              <th colSpan={3} className={PLANEJADO.cabecalhoAbre} />
              <th
                className={cn(
                  "text-right px-3 py-2 text-[10px] font-semibold uppercase tracking-wider",
                  PLANEJADO.cabecalhoFim,
                )}
              >
                Total
              </th>
              <th colSpan={3} className={REALIZADO.cabecalhoAbre} />
              <th
                className={cn(
                  "text-right px-3 py-2 text-[10px] font-semibold uppercase tracking-wider",
                  REALIZADO.cabecalhoFim,
                )}
              >
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.id} className="border-b border-border">
                <td colSpan={3} className="px-3 py-3 text-sm">
                  {l.nome}
                </td>
                <td colSpan={3} className={ORCADO.celulaVazia} />
                <td
                  className={cn(
                    "px-3 py-3 text-right whitespace-nowrap font-mono text-[13px]",
                    ORCADO.celulaTotal,
                  )}
                >
                  {formatCurrency(l.orcado, moeda)}
                </td>
                <td colSpan={3} className={PLANEJADO.celulaVazia} />
                <td
                  className={cn(
                    "px-3 py-3 text-right whitespace-nowrap font-mono text-[13px]",
                    PLANEJADO.celulaTotal,
                  )}
                >
                  {l.planejado > 0 ? formatCurrency(l.planejado, moeda) : "—"}
                </td>
                <td colSpan={3} className={REALIZADO.celulaVazia} />
                <td
                  className={cn(
                    "px-3 py-3 text-right whitespace-nowrap font-mono text-[13px]",
                    REALIZADO.celulaTotal,
                  )}
                >
                  {l.realizado > 0 ? formatCurrency(l.realizado, moeda) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td
                colSpan={3}
                className="px-3 py-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-t border-t-border"
              >
                Total dos custos
              </td>
              <td colSpan={3} className={ORCADO.subtotalVazio} />
              <td className={cn("px-3 py-3 text-right whitespace-nowrap font-mono text-[13px] font-bold", ORCADO.subtotalValor)}>
                {formatCurrency(subtotalGeral, moeda)}
              </td>
              <td colSpan={3} className={PLANEJADO.subtotalVazio} />
              <td className={cn("px-3 py-3 text-right whitespace-nowrap font-mono text-[13px] font-bold", PLANEJADO.subtotalValor)}>
                {totalPlanejado > 0
                  ? formatCurrency(totalPlanejado, moeda)
                  : "—"}
              </td>
              <td colSpan={3} className={REALIZADO.subtotalVazio} />
              <td className={cn("px-3 py-3 text-right whitespace-nowrap font-mono text-[13px] font-bold", REALIZADO.subtotalValor)}>
                {temRealizado ? formatCurrency(totalRealizado, moeda) : "—"}
              </td>
            </tr>
            <tr>
              <td
                colSpan={3}
                className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-t border-t-border"
              >
                Rentabilidade
              </td>
              <td colSpan={4} className={cn("border-t border-t-[#dfeafb]", ORCADO.celulaVazia)} />
              <td colSpan={3} className={cn("border-t border-t-[#dcf5e8]", PLANEJADO.celulaVazia)} />
              <td className={cn("px-3 py-2.5 text-right whitespace-nowrap border-t border-t-[#dcf5e8]", PLANEJADO.celulaTotal)}>
                <CelulaRentabilidade
                  orcado={subtotalGeral}
                  custo={totalPlanejado}
                  moeda={moeda}
                  corValor={RENTAB_VALOR}
                  corPercentual={RENTAB_VALOR}
                />
              </td>
              <td colSpan={3} className={cn("border-t border-t-[#fbd8b8]", REALIZADO.celulaVazia)} />
              <td className={cn("px-3 py-2.5 text-right whitespace-nowrap border-t border-t-[#fbd8b8]", REALIZADO.celulaTotal)}>
                <CelulaRentabilidade
                  orcado={subtotalGeral}
                  custo={totalRealizado}
                  moeda={moeda}
                  corValor={RENTAB_VALOR}
                  corPercentual={RENTAB_VALOR}
                />
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="grid grid-cols-1 border-t border-border md:grid-cols-2">
        <div className="border-b border-border p-6 md:border-b-0 md:border-r">
          <p className="mb-3.5 text-[13px] font-bold uppercase tracking-wider">
            Fechamento do orçado · por tipo de custo
          </p>
          <div className="flex flex-col gap-1.5">
            {TIPOS.map((t) => (
              <LinhaValor
                key={t}
                rotulo={tipoCustoLabel(t)}
                valor={formatCurrency(subtotaisPorTipo[t], moeda)}
              />
            ))}
            <div className="mt-3 border-t border-border pt-3">
              <LinhaValor
                rotulo="Total dos custos"
                valor={formatCurrency(subtotalGeral, moeda)}
                destaque
              />
            </div>
            <LinhaValor
              rotulo={`Honorários (${formatarTaxa(percentualHonorarios)})`}
              valor={formatCurrency(honorarios, moeda)}
            />
            <LinhaValor
              rotulo={`Impostos (${formatarTaxa(percentualImposto)})`}
              valor={formatCurrency(imposto, moeda)}
            />
            <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-border pt-3.5">
              <span className="text-sm font-semibold">
                Faturamento previsto
              </span>
              <span className="whitespace-nowrap font-mono text-lg font-bold text-california-red">
                {formatCurrency(faturamento, moeda)}
              </span>
            </div>
          </div>
        </div>

        <PainelResultado
          faturamento={faturamento}
          imposto={imposto}
          orcado={subtotalGeral}
          custoPlanejado={totalPlanejado}
          custoRealizado={totalRealizado}
          honorarios={honorarios}
          taxaHonorarios={formatarTaxa(percentualHonorarios)}
          moeda={moeda}
        />
      </div>

      <div className="flex items-start gap-2 border-t border-border bg-muted/40 px-6 py-4 text-xs leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <p>
          <strong className="text-foreground">Honorários</strong> sobre A + B + D
          · <strong className="text-foreground">Impostos</strong> sobre B + C +
          honorários em <em>gross-up</em> ·{" "}
          <strong className="text-foreground">Faturamento</strong> = custos +
          honorários + impostos ·{" "}
          <strong className="text-foreground">Resultado operacional</strong> =
          faturamento − impostos − custo (planejado ou realizado) ·{" "}
          <strong className="text-foreground">Resultado geral</strong> =
          resultado operacional ÷ faturamento.
        </p>
      </div>
    </div>
  );
}
