import { ArrowDownRight, ArrowUpRight, Minus, Users, Wallet, AlertCircle, Activity } from "lucide-react";
import type { ContagemStatus } from "./folha-competencia-view";

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

/**
 * Faixa de 4 cards balanceados no topo do detalhe da folha.
 * Cada card tem: ícone · rótulo · número grande · linha auxiliar
 * (delta vs mês anterior nos 2 primeiros; contagem literal nos 2 últimos).
 * O card de progresso substitui os 4 antigos (Enviadas/Aprovadas/Pagas/Pendências).
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
        icone={<Wallet className="h-4 w-4" />}
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
        destaque
      />
      <CardKpi
        icone={<Users className="h-4 w-4" />}
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
        icone={<AlertCircle className="h-4 w-4" />}
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
      <CardProgressoFluxo
        total={colaboradoresAtual}
        contagem={contagem}
      />
    </div>
  );
}

function CardKpi({
  icone,
  rotulo,
  valorPrincipal,
  valorSubtitulo,
  rodape,
  destaque,
  tom,
}: {
  icone: React.ReactNode;
  rotulo: string;
  valorPrincipal: string;
  valorSubtitulo?: string;
  rodape: React.ReactNode;
  destaque?: boolean;
  tom?: "vermelho";
}) {
  const corValor =
    tom === "vermelho" && valorPrincipal !== "0"
      ? "text-california-red"
      : "text-foreground";
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-soft flex flex-col justify-between min-h-[128px]">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-california-red/10 text-california-red">
          {icone}
        </span>
        <span className="text-xs font-semibold uppercase tracking-wide">
          {rotulo}
        </span>
      </div>
      <div className="mt-3">
        <p
          className={`font-bold tabular-nums leading-none ${
            destaque ? "text-3xl" : "text-2xl"
          } ${corValor}`}
        >
          {valorPrincipal}
          {valorSubtitulo && (
            <span className="ml-1 text-sm font-medium text-muted-foreground">
              {valorSubtitulo}
            </span>
          )}
        </p>
        <div className="mt-2">{rodape}</div>
      </div>
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
 * Card dedicado ao Progresso do fluxo: mostra Enviadas e Pagas lado a lado
 * (2 marcos mais importantes), barra empilhada e legenda com os status
 * intermediarios (aprovadas, pendentes, rascunho) quando existem.
 */
function CardProgressoFluxo({
  total,
  contagem,
}: {
  total: number;
  contagem: ContagemStatus;
}) {
  // Enviadas = cumulativo (soma de tudo que ja saiu de rascunho)
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
    <div className="rounded-2xl border border-border bg-card p-5 shadow-soft flex flex-col justify-between min-h-[128px]">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-california-red/10 text-california-red">
          <Activity className="h-4 w-4" />
        </span>
        <span className="text-xs font-semibold uppercase tracking-wide">
          Progresso do fluxo
        </span>
      </div>

      <div className="mt-3 space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            Enviadas
          </span>
          <span className="text-xl font-bold tabular-nums text-foreground">
            {enviadasAcumulado}
            <span className="text-sm font-medium text-muted-foreground">
              /{total}
            </span>
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            Pagas
          </span>
          <span className="text-xl font-bold tabular-nums text-foreground">
            {contagem.paga}
            <span className="text-sm font-medium text-muted-foreground">
              /{total}
            </span>
          </span>
        </div>

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

/**
 * Barra empilhada mostrando o fluxo da folha: rascunho → enviada →
 * aprovada → paga, com pendente_correcao em vermelho no meio.
 * Ordem visual da esquerda pra direita: paga (fim do fluxo) até
 * rascunho (começo), pra dar sensação de "progresso pra direita".
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
    <div>
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
    </div>
  );
}
