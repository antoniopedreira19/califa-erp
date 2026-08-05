import { cn, formatCurrency } from "@/lib/utils";
import { calcularResultadoOperacional } from "@/lib/calculos/versao-totais";

interface Props {
  /** Custos + honorários + impostos — o que o cliente paga. */
  faturamento: number;
  /** Imposto embutido no faturamento. Sai da conta do resultado. */
  imposto: number;
  /** Soma do planejado dos itens: o desembolso esperado da agência. */
  custoPlanejado: number;
  /** Soma do realizado lançado. */
  custoRealizado: number;
  moeda: string;
}

/**
 * Resumo de resultado no cabeçalho da Planilha Interna do job e da visão
 * agregada do projeto — a mesma ideia do `ResumoRentabilidade` da versão do
 * orçamento, com as duas óticas (planejado e realizado) lado a lado.
 *
 * Resultado = (faturamento − impostos − custo) ÷ faturamento, a mesma conta
 * do "Resultado geral" do card de Totais. Sem custo lançado a conta não
 * existe: travessão, nunca um percentual inflado pelo faturamento inteiro.
 */
export function ResumoResultado({
  faturamento,
  imposto,
  custoPlanejado,
  custoRealizado,
  moeda,
}: Props) {
  const { resultadoGeral: resultadoPlanejado } = calcularResultadoOperacional(
    faturamento,
    imposto,
    custoPlanejado,
  );
  const { resultadoGeral: resultadoRealizado } = calcularResultadoOperacional(
    faturamento,
    imposto,
    custoRealizado,
  );

  return (
    <div className="flex divide-x divide-border rounded-xl border border-border bg-card shadow-soft">
      <Bloco label="Faturamento previsto">
        <span className="font-mono text-base font-bold text-foreground">
          {formatCurrency(faturamento, moeda)}
        </span>
      </Bloco>

      <Bloco label="Custo planejado">
        <Dinheiro valor={custoPlanejado} moeda={moeda} />
      </Bloco>

      <Bloco label="Custo realizado">
        <Dinheiro valor={custoRealizado} moeda={moeda} />
      </Bloco>

      <Bloco label="Resultado planejado">
        <Percentual valor={resultadoPlanejado} ausente="sem planejado" />
      </Bloco>

      <Bloco label="Resultado realizado">
        <Percentual valor={resultadoRealizado} ausente="sem realizado" />
      </Bloco>
    </div>
  );
}

function Dinheiro({ valor, moeda }: { valor: number; moeda: string }) {
  if (valor <= 0) {
    return (
      <span className="font-mono text-base font-bold text-muted-foreground">
        —
      </span>
    );
  }
  return (
    <span className="font-mono text-base font-bold text-foreground">
      {formatCurrency(valor, moeda)}
    </span>
  );
}

function Percentual({
  valor,
  ausente,
}: {
  valor: number | null;
  ausente: string;
}) {
  if (valor === null) {
    return (
      <span className="flex items-baseline gap-1.5">
        <span className="font-mono text-base font-bold text-muted-foreground">
          —
        </span>
        <span className="text-[10px] text-muted-foreground">{ausente}</span>
      </span>
    );
  }
  return (
    <span
      className={cn(
        "font-mono text-base font-bold",
        valor >= 0 ? "text-emerald-700" : "text-california-red",
      )}
    >
      {`${valor.toFixed(1).replace(".", ",")}%`}
    </span>
  );
}

function Bloco({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-4 py-2.5">
      <p className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 whitespace-nowrap leading-none">{children}</p>
    </div>
  );
}
