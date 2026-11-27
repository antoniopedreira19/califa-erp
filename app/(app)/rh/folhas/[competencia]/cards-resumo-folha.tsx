import {
  Activity,
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  Minus,
  Users,
  Wallet,
} from "lucide-react";
import type { ContagemStatus } from "./folha-competencia-view";

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

/**
 * Faixa de 4 KPI cards balanceados no topo do detalhe da folha.
 *
 * Padrão visual:
 * - Header top-left: ícone sutil + label em uppercase muted.
 * - Main centralizado: valor principal grande em bold.
 * - Footer bottom-left: contexto discreto (delta vs mês anterior ou aviso).
 *
 * O card de Progresso tem corpo diferente (duas métricas + barra + legenda),
 * mas segue o mesmo header e a mesma caixa.
 */
export function CardsResumoFolha({
  totalAtual,
  totalAnterior,
  colaboradoresAtual,
  colaboradoresAnterior,
  contagem,
  nomeCompetenciaAnterior,
  temMesAnterior,
}: {
  totalAtual: number;
  totalAnterior: number;
  colaboradoresAtual: number;
  colaboradoresAnterior: number;
  contagem: ContagemStatus;
  nomeCompetenciaAnterior: string;
  temMesAnterior: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <CardKpi
        icone={<Wallet className="h-3.5 w-3.5" />}
        rotulo="Total da folha"
        valorPrincipal={brl.format(totalAtual)}
        rodape={
          <Delta
            atual={totalAtual}
            anterior={totalAnterior}
            temAnterior={temMesAnterior}
            nomeAnterior={nomeCompetenciaAnterior}
            formatador={(v) => brl.format(v)}
          />
        }
      />
      <CardKpi
        icone={<Users className="h-3.5 w-3.5" />}
        rotulo="Colaboradores"
        valorPrincipal={String(colaboradoresAtual)}
        rodape={
          <Delta
            atual={colaboradoresAtual}
            anterior={colaboradoresAnterior}
            temAnterior={temMesAnterior}
            nomeAnterior={nomeCompetenciaAnterior}
            formatador={(v) => String(v)}
            unidadeSufixo=" pessoas"
          />
        }
      />
      <CardKpi
        icone={<AlertCircle className="h-3.5 w-3.5" />}
        rotulo="Pendências"
        valorPrincipal={String(contagem.pendente_correcao)}
        rodape={
          contagem.pendente_correcao > 0 ? (
            <span className="text-xs font-medium text-california-red">
              Corrigir e reenviar ao financeiro
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">
              Nenhuma pendência aberta
            </span>
          )
        }
        tom={contagem.pendente_correcao > 0 ? "vermelho" : undefined}
      />
      <CardProgressoFluxo total={colaboradoresAtual} contagem={contagem} />
    </div>
  );
}

/**
 * Molde: header top-left (icon+label) · main centralizado (valor grande) ·
 * footer bottom-left (rodape).
 */
function CardKpi({
  icone,
  rotulo,
  valorPrincipal,
  rodape,
  tom,
}: {
  icone: React.ReactNode;
  rotulo: string;
  valorPrincipal: string;
  rodape: React.ReactNode;
  tom?: "vermelho";
}) {
  const corValor =
    tom === "vermelho" && valorPrincipal !== "0"
      ? "text-california-red"
      : "text-foreground";
  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-soft flex flex-col min-h-[160px]">
      {/* Header: icon sutil + label, top-left */}
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icone}
        <span className="text-[11px] font-semibold uppercase tracking-wider">
          {rotulo}
        </span>
      </div>

      {/* Main: valor centralizado (horizontal + vertical) no espaço disponível */}
      <div className="flex-1 flex items-center justify-center py-3">
        <p
          className={`text-3xl font-bold tabular-nums leading-none ${corValor}`}
        >
          {valorPrincipal}
        </p>
      </div>

      {/* Footer: contexto discreto, bottom-left */}
      <div className="text-left">{rodape}</div>
    </div>
  );
}

function Delta({
  atual,
  anterior,
  temAnterior,
  nomeAnterior,
  formatador,
  unidadeSufixo,
}: {
  atual: number;
  anterior: number;
  temAnterior: boolean;
  nomeAnterior: string;
  formatador: (v: number) => string;
  unidadeSufixo?: string;
}) {
  if (!temAnterior) {
    return (
      <span className="text-xs text-muted-foreground">
        Primeira competência registrada
      </span>
    );
  }

  const diff = atual - anterior;

  if (anterior === 0) {
    return (
      <span className="text-xs text-muted-foreground">
        vs {nomeAnterior}: {formatador(anterior)}
        {unidadeSufixo ?? ""}
      </span>
    );
  }

  if (diff === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Minus className="h-3 w-3" />
        Estável vs {nomeAnterior}
      </span>
    );
  }

  const pct = (diff / anterior) * 100;
  const positivo = diff > 0;

  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium ${
        positivo ? "text-emerald-700" : "text-california-red"
      }`}
    >
      {positivo ? (
        <ArrowUpRight className="h-3 w-3" />
      ) : (
        <ArrowDownRight className="h-3 w-3" />
      )}
      {positivo ? "+" : "−"}
      {Math.abs(pct).toFixed(1).replace(".", ",")}% vs {nomeAnterior}
    </span>
  );
}

/**
 * Card do Progresso do fluxo: 2 marcos (Enviadas | Pagas) lado a lado, barra
 * empilhada no meio-baixo, legenda alinhada à esquerda. Mesmo header dos
 * outros 3 KPI cards.
 */
function CardProgressoFluxo({
  total,
  contagem,
}: {
  total: number;
  contagem: ContagemStatus;
}) {
  // Enviadas = cumulativo (soma de tudo que já saiu de rascunho)
  const enviadasAcumulado =
    contagem.enviada +
    contagem.aprovada +
    contagem.paga +
    contagem.pendente_correcao;

  const legendaItens: Array<{ n: number; cor: string; nome: string }> = [
    { n: contagem.aprovada, cor: "bg-emerald-400", nome: "aprovadas" },
    {
      n: contagem.pendente_correcao,
      cor: "bg-california-red",
      nome: "pendentes",
    },
    { n: contagem.rascunho, cor: "bg-muted-foreground/30", nome: "em rascunho" },
  ].filter((i) => i.n > 0);

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-soft flex flex-col min-h-[160px]">
      {/* Header igual aos outros KPI cards */}
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Activity className="h-3.5 w-3.5" />
        <span className="text-[11px] font-semibold uppercase tracking-wider">
          Progresso do fluxo
        </span>
      </div>

      {/* Main: dois blocos lado a lado, cada um com label pequena + número grande */}
      <div className="flex-1 flex items-center justify-center py-3">
        <div className="grid grid-cols-2 gap-6 w-full">
          <MetricaProgresso
            label="Enviadas"
            valor={enviadasAcumulado}
            total={total}
          />
          <MetricaProgresso label="Pagas" valor={contagem.paga} total={total} />
        </div>
      </div>

      {/* Footer: barra + legenda, alinhados à esquerda */}
      <div className="space-y-1.5">
        <BarraProgresso total={total} contagem={contagem} />
        {legendaItens.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
            {legendaItens.map((i, idx) => (
              <span key={idx} className="inline-flex items-center gap-1">
                <span className={`inline-block h-2 w-2 rounded-sm ${i.cor}`} />
                {i.n} {i.nome}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MetricaProgresso({
  label,
  valor,
  total,
}: {
  label: string;
  valor: number;
  total: number;
}) {
  return (
    <div className="flex flex-col items-center text-center">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="mt-0.5 text-2xl font-bold tabular-nums leading-none text-foreground">
        {valor}
        <span className="text-sm font-medium text-muted-foreground">
          /{total}
        </span>
      </span>
    </div>
  );
}

/**
 * Barra empilhada mostrando o fluxo da folha: rascunho → enviada →
 * aprovada → paga, com pendente_correcao em vermelho no meio.
 */
function BarraProgresso({
  total,
  contagem,
}: {
  total: number;
  contagem: ContagemStatus;
}) {
  if (total === 0) return null;

  const segmentos: Array<{ n: number; cor: string; nome: string }> = [
    { n: contagem.paga, cor: "bg-emerald-600", nome: "Pagas" },
    { n: contagem.aprovada, cor: "bg-emerald-400", nome: "Aprovadas" },
    { n: contagem.enviada, cor: "bg-blue-500", nome: "Enviadas" },
    {
      n: contagem.pendente_correcao,
      cor: "bg-california-red",
      nome: "Pendentes",
    },
    { n: contagem.rascunho, cor: "bg-muted", nome: "Rascunho" },
  ];

  return (
    <div
      className="flex h-2 w-full overflow-hidden rounded-full bg-muted"
      role="img"
      aria-label={`Progresso do fluxo: ${contagem.paga} pagas, ${contagem.aprovada} aprovadas, ${contagem.enviada} enviadas, ${contagem.pendente_correcao} pendentes, ${contagem.rascunho} rascunho`}
    >
      {segmentos.map((s, i) =>
        s.n > 0 ? (
          <div
            key={i}
            className={s.cor}
            style={{ width: `${(s.n / total) * 100}%` }}
            title={`${s.n} ${s.nome.toLowerCase()}`}
          />
        ) : null,
      )}
    </div>
  );
}
