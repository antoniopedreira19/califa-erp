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

interface Props {
  grupos: VersaoOrcamentoGrupo[];
  itens: ItemPlanilhaJob[];
  realizadosMap: Map<string, JobItemRealizado>;
  percentualHonorarios: number;
  percentualImposto: number;
  moeda: string;
}

const TIPOS: TipoCusto[] = ["A", "B", "C", "D"];

// A borda esquerda marca o início do bloco, então fica só na primeira célula
// (o filler); a célula de valor repete apenas o fundo.
const FUNDO_ORCADO = "bg-black/[0.015]";
const FUNDO_PLANEJADO = "bg-[#f7fbff]";
const FUNDO_REALIZADO = "bg-[#fefbf0]";

const ABRE_ORCADO = `border-l-2 border-l-[#e4e2dd] ${FUNDO_ORCADO}`;
const ABRE_PLANEJADO = `border-l-2 border-l-[#cfe0f7] ${FUNDO_PLANEJADO}`;
const ABRE_REALIZADO = `border-l-2 border-l-[#f0c874] ${FUNDO_REALIZADO}`;

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
        <table className="w-full min-w-[1160px] table-fixed border-collapse text-sm">
          <colgroup>
            <col className="w-[18%]" />
            <col className="w-[4%]" />
            <col className="w-[8.5%]" />
            <col className="w-[7.5%]" />
            <col className="w-[3%]" />
            <col className="w-[3%]" />
            <col className="w-[8.5%]" />
            <col className="w-[7.5%]" />
            <col className="w-[3%]" />
            <col className="w-[3%]" />
            <col className="w-[8.5%]" />
            <col className="w-[7.5%]" />
            <col className="w-[3%]" />
            <col className="w-[3%]" />
            <col className="w-[8.5%]" />
          </colgroup>
          <thead>
            <tr>
              <th colSpan={3} className="bg-muted/40 border-b border-border" />
              <th
                colSpan={4}
                className="text-center px-3 py-2 text-[11px] font-extrabold tracking-[0.1em] text-foreground bg-[#f1f0ec] border-b-[3px] border-b-[#282828] border-l-2 border-l-[#d7d7d7]"
              >
                ORÇADO
              </th>
              <th
                colSpan={4}
                className="text-center px-3 py-2 text-[11px] font-extrabold tracking-[0.1em] text-[#1e4fa3] bg-[#e8f0fd] border-b-[3px] border-b-[#2f6fdb] border-l-2 border-l-[#b9d1f4]"
              >
                PLANEJADO
              </th>
              <th
                colSpan={4}
                className="text-center px-3 py-2 text-[11px] font-extrabold tracking-[0.1em] text-[#92400e] bg-[#fef3c7] border-b-[3px] border-b-[#d97706] border-l-2 border-l-[#f0c874]"
              >
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
              <th colSpan={3} className="border-l-2 border-l-[#e4e2dd]" />
              <th className="text-right px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Total
              </th>
              <th
                colSpan={3}
                className="bg-[#f2f7fe] border-l-2 border-l-[#cfe0f7]"
              />
              <th className="text-right px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[#5a76a8] bg-[#f2f7fe]">
                Total
              </th>
              <th
                colSpan={3}
                className="bg-[#fefbf0] border-l-2 border-l-[#f0c874]"
              />
              <th className="text-right px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[#92400e] bg-[#fefbf0]">
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
                <td colSpan={3} className={ABRE_ORCADO} />
                <td
                  className={cn(
                    "px-3 py-3 text-right whitespace-nowrap font-mono text-[13px]",
                    FUNDO_ORCADO,
                  )}
                >
                  {formatCurrency(l.orcado, moeda)}
                </td>
                <td colSpan={3} className={ABRE_PLANEJADO} />
                <td
                  className={cn(
                    "px-3 py-3 text-right whitespace-nowrap font-mono text-[13px]",
                    FUNDO_PLANEJADO,
                  )}
                >
                  {l.planejado > 0 ? formatCurrency(l.planejado, moeda) : "—"}
                </td>
                <td colSpan={3} className={ABRE_REALIZADO} />
                <td
                  className={cn(
                    "px-3 py-3 text-right whitespace-nowrap font-mono text-[13px]",
                    FUNDO_REALIZADO,
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
              <td
                colSpan={3}
                className="bg-[#f1f0ec] border-l-2 border-l-[#d7d7d7] border-t-2 border-t-[#282828]"
              />
              <td className="px-3 py-3 text-right whitespace-nowrap font-mono text-[13px] font-bold bg-[#f1f0ec] border-t-2 border-t-[#282828]">
                {formatCurrency(subtotalGeral, moeda)}
              </td>
              <td
                colSpan={3}
                className="bg-[#e8f0fd] border-l-2 border-l-[#b9d1f4] border-t-2 border-t-[#2f6fdb]"
              />
              <td className="px-3 py-3 text-right whitespace-nowrap font-mono text-[13px] font-bold text-[#1e4fa3] bg-[#e8f0fd] border-t-2 border-t-[#2f6fdb]">
                {totalPlanejado > 0
                  ? formatCurrency(totalPlanejado, moeda)
                  : "—"}
              </td>
              <td
                colSpan={3}
                className="bg-[#fef3c7] border-l-2 border-l-[#f0c874] border-t-2 border-t-[#d97706]"
              />
              <td className="px-3 py-3 text-right whitespace-nowrap font-mono text-[13px] font-bold text-[#92400e] bg-[#fef3c7] border-t-2 border-t-[#d97706]">
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
              <td
                colSpan={4}
                className="bg-[#f1f0ec] border-l-2 border-l-[#d7d7d7] border-t border-t-[#e4e2dd]"
              />
              <td
                colSpan={3}
                className="bg-[#e8f0fd] border-l-2 border-l-[#b9d1f4] border-t border-t-[#cfe0f7]"
              />
              <td className="px-3 py-2.5 text-right whitespace-nowrap bg-[#e8f0fd] border-t border-t-[#cfe0f7]">
                <CelulaRentabilidade
                  orcado={subtotalGeral}
                  custo={totalPlanejado}
                  moeda={moeda}
                  corValor="text-[#1e4fa3]"
                  corPercentual="text-[#5a76a8]"
                />
              </td>
              <td
                colSpan={3}
                className="bg-[#fef3c7] border-l-2 border-l-[#f0c874] border-t border-t-[#f0c874]"
              />
              <td className="px-3 py-2.5 text-right whitespace-nowrap bg-[#fef3c7] border-t border-t-[#f0c874]">
                <CelulaRentabilidade
                  orcado={subtotalGeral}
                  custo={totalRealizado}
                  moeda={moeda}
                  corValor="text-[#92400e]"
                  corPercentual="text-[#a3703a]"
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
