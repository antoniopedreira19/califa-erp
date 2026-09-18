/**
 * Os blocos de resumo da página inicial da Conciliação (decisão 091):
 * consolidado e as duas quebras do saldo, por tipo de conta e por empresa.
 * Server components puros — só recebem dados já calculados.
 */
import { formatCurrency } from "@/lib/utils";
import { TIPO_CONTA_LABEL, type ContaResumo } from "./hub-periodo";

export type Fatia = { chave: string; saldo: number; contas: number };

export function fatiarPorTipo(contas: ContaResumo[]): Fatia[] {
  return fatiar(contas, (c) => TIPO_CONTA_LABEL[c.tipo] ?? c.tipo);
}

export function fatiarPorEmpresa(contas: ContaResumo[]): Fatia[] {
  return fatiar(contas, (c) => c.empresaContabil);
}

function fatiar(contas: ContaResumo[], chaveDe: (c: ContaResumo) => string): Fatia[] {
  const mapa = new Map<string, Fatia>();
  // Só conta ativa: as fatias têm de somar o mesmo consolidado que o card
  // ao lado mostra, senão os percentuais não fecham em 100%.
  for (const c of contas.filter((x) => x.ativa)) {
    const chave = chaveDe(c);
    const atual = mapa.get(chave) ?? { chave, saldo: 0, contas: 0 };
    atual.saldo += c.saldoAtual;
    atual.contas += 1;
    mapa.set(chave, atual);
  }
  return [...mapa.values()].sort((a, b) => b.saldo - a.saldo);
}

export function CardConsolidado({
  totais,
  inativas,
}: {
  totais: {
    saldo: number;
    creditos: number;
    debitos: number;
    contas: number;
  };
  inativas?: { contas: number; saldo: number };
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
        Saldo consolidado
      </p>
      <p
        className={`mt-1 font-mono text-2xl font-semibold ${
          totais.saldo < 0 ? "text-california-red" : "text-foreground"
        }`}
      >
        {formatCurrency(totais.saldo)}
      </p>
      <div className="mt-4 space-y-2 border-t border-border pt-3 text-xs">
        <Linha label="Entradas no período" valor={totais.creditos} cor="text-emerald-700" />
        <Linha label="Saídas no período" valor={totais.debitos} cor="text-california-red" />
        <div className="flex items-center justify-between border-t border-border pt-2">
          <span className="font-medium">Resultado</span>
          <span className="font-mono font-semibold">
            {formatCurrency(totais.creditos - totais.debitos)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Contas ativas</span>
          <span className="font-mono">{totais.contas}</span>
        </div>
        {inativas && inativas.contas > 0 && (
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              Fora do total · {inativas.contas}{" "}
              {inativas.contas === 1 ? "conta inativa" : "contas inativas"}
            </span>
            <span className="font-mono">{formatCurrency(inativas.saldo)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function Linha({
  label,
  valor,
  cor,
}: {
  label: string;
  valor: number;
  cor: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono ${cor}`}>{formatCurrency(valor)}</span>
    </div>
  );
}

/**
 * Uma quebra do saldo (por tipo de conta, por empresa). `deitado` troca a
 * pilha por colunas — é o que a V6 usa na faixa do topo.
 */
export function BlocoQuebra({
  titulo,
  fatias,
  deitado = false,
  percentual = false,
}: {
  titulo: string;
  fatias: Fatia[];
  deitado?: boolean;
  /** Quanto cada fatia representa do total do bloco. Sai junto da contagem
   *  de contas — ao lado do valor não cabe no painel de 300px. */
  percentual?: boolean;
}) {
  const maior = Math.max(1, ...fatias.map((f) => Math.abs(f.saldo)));
  const total = fatias.reduce((a, f) => a + f.saldo, 0);
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {titulo}
      </p>
      <div
        className={
          deitado
            ? "mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-3"
            : "mt-3 space-y-3"
        }
      >
        {fatias.map((f) => (
          <div key={f.chave}>
            {/* Deitado, rótulo e valor empilham: "Cartão de crédito" ao lado
                de um valor em mono não cabe em três colunas. */}
            <div
              className={
                deitado
                  ? "space-y-0.5"
                  : "flex items-baseline justify-between gap-2"
              }
            >
              <span className="block truncate text-xs font-medium">
                {f.chave}
              </span>
              {/* A porcentagem acompanha o VALOR, não a contagem de contas:
                  ao lado de "7 contas" ela se lia como percentual de contas. */}
              <span className="flex shrink-0 items-baseline justify-end gap-1.5">
                <span
                  className={`font-mono ${
                    deitado ? "text-base font-semibold" : "text-xs"
                  } ${f.saldo < 0 ? "text-california-red" : "text-foreground"}`}
                >
                  {formatCurrency(f.saldo)}
                </span>
                {percentual && total !== 0 && (
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {((f.saldo / total) * 100).toLocaleString("pt-BR", {
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 1,
                    })}
                    %
                  </span>
                )}
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full ${
                  f.saldo < 0 ? "bg-california-red" : "bg-foreground/70"
                }`}
                style={{
                  width: `${Math.max(2, (Math.abs(f.saldo) / maior) * 100)}%`,
                }}
              />
            </div>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {f.contas} {f.contas === 1 ? "conta" : "contas"}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
