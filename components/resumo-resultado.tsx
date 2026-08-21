import { cn, formatCurrency } from "@/lib/utils";
import { calcularResultadoOperacional } from "@/lib/calculos/versao-totais";

interface Props {
  /**
   * Valor do job: o compromisso total do cliente — o que passa pela agência
   * mais o que ele paga direto ao fornecedor, com honorários e impostos.
   * É a base do resultado, como no card de Totais.
   */
  valorJob: number;
  /** Imposto embutido na receita. Sai da conta do resultado. */
  imposto: number;
  /** Soma do planejado dos itens: o desembolso esperado da agência. */
  custoPlanejado: number;
  /** Soma do realizado lançado. */
  custoRealizado: number;
  /** BV líquido a devolver ao resultado, por ótica. Ver `PainelResultado`. */
  bvPlanejado?: number;
  bvRealizado?: number;
  moeda: string;
}

/**
 * Resumo de resultado no cabeçalho do detalhe do job e da visão agregada do
 * projeto — a mesma ideia do `ResumoRentabilidade` da versão do orçamento.
 *
 * Formato de duas linhas desde 19/08/2026 (handoff "Job · Informações —
 * Cabeçalho", turno 1b): o Valor do Job fica isolado à esquerda porque é o
 * único número que não tem par, e cada linha da direita é um cenário
 * fechado — o custo e a rentabilidade que ele produz. A régua anterior
 * tinha cinco blocos irmãos, e planejado e realizado só se pareavam na
 * cabeça de quem lia.
 *
 * Resultado = (valor do job − impostos − custo) ÷ valor do job, a mesma conta
 * do "Resultado geral" do card de Totais. Sem custo lançado a conta não
 * existe: travessão, nunca um percentual inflado pelo faturamento inteiro.
 */
export function ResumoResultado({
  valorJob,
  imposto,
  custoPlanejado,
  custoRealizado,
  bvPlanejado = 0,
  bvRealizado = 0,
  moeda,
}: Props) {
  // O BV volta para a agência: ele REDUZ o custo na conta do resultado —
  // a mesma operação que o painel Resultado escreve como linha "+ BVs".
  // Sem isto o resumo do cabeçalho e o card de Totais mostrariam
  // percentuais diferentes para o mesmo projeto (docs/decisions/022).
  const { resultadoGeral: resultadoPlanejado } = calcularResultadoOperacional(
    valorJob,
    imposto,
    custoPlanejado - bvPlanejado,
  );
  const { resultadoGeral: resultadoRealizado } = calcularResultadoOperacional(
    valorJob,
    imposto,
    custoRealizado - bvRealizado,
  );

  return (
    <div className="flex items-stretch rounded-xl border border-border bg-card shadow-soft">
      <div className="flex flex-col justify-center gap-0.5 border-r border-border px-5 py-3">
        <span className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Valor do job
        </span>
        <span className="whitespace-nowrap font-mono text-[19px] font-bold leading-none text-foreground">
          {formatCurrency(valorJob, moeda)}
        </span>
      </div>

      <div className="flex flex-col">
        <Linha
          rotulo="Planejado"
          custo={custoPlanejado}
          resultado={resultadoPlanejado}
          ausente="sem planejado"
          moeda={moeda}
        />
        {/* Divisória mais leve que a borda do card: separa duas linhas do
            mesmo bloco, não dois blocos. */}
        <Linha
          rotulo="Realizado"
          custo={custoRealizado}
          resultado={resultadoRealizado}
          ausente="sem realizado"
          moeda={moeda}
          separador
        />
      </div>
    </div>
  );
}

function Linha({
  rotulo,
  custo,
  resultado,
  ausente,
  moeda,
  separador,
}: {
  rotulo: string;
  custo: number;
  resultado: number | null;
  ausente: string;
  moeda: string;
  separador?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-5 px-5 py-[9px]",
        separador && "border-t border-border/60",
      )}
    >
      <span className="w-[74px] text-[10.5px] font-bold uppercase tracking-[0.07em] text-muted-foreground">
        {rotulo}
      </span>
      <span
        className={cn(
          "w-[140px] whitespace-nowrap text-right font-mono text-base font-semibold",
          custo > 0 ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {custo > 0 ? formatCurrency(custo, moeda) : "—"}
      </span>
      <span className="flex min-w-[118px] items-baseline justify-end gap-1.5">
        {resultado === null ? (
          <>
            <span className="font-mono text-base font-bold text-muted-foreground">
              —
            </span>
            <span className="whitespace-nowrap text-[10px] text-muted-foreground">
              {ausente}
            </span>
          </>
        ) : (
          <>
            <span className="text-[11px] text-muted-foreground">rentab.</span>
            <span
              className={cn(
                "font-mono text-base font-bold",
                resultado >= 0 ? "text-emerald-700" : "text-california-red",
              )}
            >
              {`${resultado.toFixed(1).replace(".", ",")}%`}
            </span>
          </>
        )}
      </span>
    </div>
  );
}
