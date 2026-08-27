"use client";

import * as React from "react";
import { ChevronRight, Filter, TrendingUp } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  chaveComposicao,
  montarMatrizFluxo,
  rotuloMes,
  type ClasseFluxo,
  type DetalheFluxo,
  type ItemComposicao,
  type LinhaFluxo,
  type NaturezaFluxo,
} from "@/lib/calculos/fluxo-caixa-matriz";

export interface JobNoFluxo {
  id: string;
  codigo: string;
  nome: string;
}

export interface ContaNoFluxo {
  id: string;
  rotulo: string;
}

/**
 * Prazos de UM job, em dias. Nulo quando falta a data que fecha o prazo —
 * a tela mostra travessão em vez de inventar número.
 */
export interface PrazosDoJob {
  jobId: string;
  faturamento: number | null;
  recebimento: number | null;
  total: number | null;
}

interface Props {
  linhas: LinhaFluxo[];
  /** Jobs que a tela cobre. Um só = aba do job; vários = projeto. */
  jobs: JobNoFluxo[];
  contas: ContaNoFluxo[];
  prazos: PrazosDoJob[];
  hoje: string;
  moeda: string;
  /**
   * Texto abaixo do título. A aba do job e a do projeto contam a mesma
   * coisa com escopo diferente.
   */
  descricao: string;
}

const TODOS = "todos";

/**
 * A matriz período × natureza do fluxo de caixa, de um job ou de um
 * projeto inteiro.
 *
 * Cada natureza abre nas TRÊS classes de `vw_fluxo_caixa`: o que já
 * passou pela conta, o que tem documento em aberto e o que ainda é só a
 * previsão gravada na abertura. É a mesma separação do Fluxo de Caixa
 * geral — aqui filtrada nos jobs da tela.
 *
 * Com mais de um job, cada sub-linha ABRE mostrando quanto cada job pôs
 * naquele mês (decisão do Tiago, 21/08/2026), e a barra de filtros
 * permite isolar um job ou uma conta bancária. Filtrar remonta a matriz
 * aqui mesmo — as linhas já desceram todas, então não há ida ao servidor.
 */
export function FluxoCaixaJobs({
  linhas,
  jobs,
  contas,
  prazos,
  hoje,
  moeda,
  descricao,
}: Props) {
  const [jobFiltro, setJobFiltro] = React.useState(TODOS);
  const [contaFiltro, setContaFiltro] = React.useState(TODOS);
  const [abertos, setAbertos] = React.useState<Record<string, boolean>>({});

  const agregado = jobs.length > 1;

  const linhasFiltradas = React.useMemo(
    () =>
      linhas.filter(
        (l) =>
          (jobFiltro === TODOS || l.jobId === jobFiltro) &&
          (contaFiltro === TODOS || l.contaBancariaId === contaFiltro),
      ),
    [linhas, jobFiltro, contaFiltro],
  );

  const fluxo = React.useMemo(
    () => montarMatrizFluxo(linhasFiltradas, hoje),
    [linhasFiltradas, hoje],
  );

  const jobPorId = React.useMemo(
    () => new Map(jobs.map((j) => [j.id, j])),
    [jobs],
  );

  // Prazo é por job e não soma: a média responde "quanto tempo este
  // projeto leva para virar dinheiro", que é a pergunta do card. Jobs sem
  // a data que fecha o prazo ficam de fora da média, em vez de entrarem
  // como zero e puxarem o número para baixo.
  const prazosVisiveis = React.useMemo(
    () =>
      jobFiltro === TODOS ? prazos : prazos.filter((p) => p.jobId === jobFiltro),
    [prazos, jobFiltro],
  );

  const media = (campo: keyof Omit<PrazosDoJob, "jobId">) => {
    const valores = prazosVisiveis
      .map((p) => p[campo])
      .filter((v): v is number => v !== null);
    if (valores.length === 0) return { dias: null as number | null, base: 0 };
    return {
      dias: Math.round(valores.reduce((s, v) => s + v, 0) / valores.length),
      base: valores.length,
    };
  };

  const cardsDePrazo = [
    { rotulo: "Prazo de faturamento", ...media("faturamento"), fim: "abertura → faturamento" },
    { rotulo: "Prazo de recebimento (do faturamento)", ...media("recebimento"), fim: "faturamento → último recebimento" },
    { rotulo: "Prazo de recebimento do job", ...media("total"), fim: "abertura → último recebimento" },
  ];

  const subLinhas = (tom: NaturezaFluxo) => {
    const valores = tom === "entrada" ? fluxo.entradas : fluxo.saidas;
    const detalhes =
      tom === "entrada" ? fluxo.detalhesReceber : fluxo.detalhesPagar;

    return [
      {
        classe: "movimento" as ClasseFluxo,
        rotulo: "Já movimentado na conta",
        // Era "recebimentos do cliente" / "PPs e contas pagas". Desde
        // 26/08/2026 o estorno soma nesta mesma linha, por decisão do
        // Tiago — o número é o do extrato —, e um rótulo que promete só
        // recebimento de cliente passaria a mentir. Quem discrimina é a
        // composição no hover.
        sub:
          tom === "entrada"
            ? "o que entrou na conta · passe o cursor para ver"
            : "o que saiu da conta · passe o cursor para ver",
        valores: valores.movimento,
        detalhes: [] as DetalheFluxo[],
        detalheTitulo: "",
      },
      {
        classe: "titulo" as ClasseFluxo,
        rotulo:
          tom === "entrada"
            ? "Títulos em aberto (a receber)"
            : "Títulos em aberto (a pagar)",
        sub:
          detalhes.length === 0
            ? "nenhum documento em aberto"
            : `${detalhes.length} ${detalhes.length === 1 ? "título" : "títulos"} · clique para ver`,
        valores: valores.titulo,
        detalhes,
        detalheTitulo:
          tom === "entrada"
            ? "Notas emitidas"
            : "PPs e contas que geraram estes títulos",
      },
      {
        classe: "previsao" as ClasseFluxo,
        rotulo: "Só previsão (abertura do job)",
        sub:
          tom === "entrada"
            ? "parcelas de recebimento"
            : "cronograma de desembolsos",
        valores: valores.previsao,
        detalhes: [] as DetalheFluxo[],
        detalheTitulo: "",
      },
    ];
  };

  const totalDe = (tom: NaturezaFluxo) => {
    const v = tom === "entrada" ? fluxo.entradas : fluxo.saidas;
    return fluxo.meses.map((_, i) => v.movimento[i] + v.titulo[i] + v.previsao[i]);
  };

  const colunas = fluxo.meses.length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start gap-2.5">
        <div className="flex items-center gap-2.5">
          <TrendingUp className="h-4 w-4 text-california-red" />
          <h2 className="text-base font-bold tracking-tight">
            Fluxo de caixa {agregado ? "do projeto" : "do job"}
          </h2>
        </div>
        <p className="min-w-[260px] flex-1 text-[12.5px] leading-relaxed text-muted-foreground">
          {descricao}
        </p>
      </div>

      {/* Filtros só onde há o que filtrar: na aba de um job só, um seletor
          com uma opção seria botão morto. */}
      {agregado && (
        <div className="flex flex-wrap items-center gap-2.5 rounded-2xl border border-border bg-card px-4 py-3 shadow-soft">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
            Filtrar
          </span>
          <SeletorFiltro
            rotulo="Job"
            valor={jobFiltro}
            onEscolher={setJobFiltro}
            opcoes={[
              { id: TODOS, rotulo: "Todos os jobs" },
              ...jobs.map((j) => ({ id: j.id, rotulo: `${j.codigo} · ${j.nome}` })),
            ]}
          />
          <SeletorFiltro
            rotulo="Conta"
            valor={contaFiltro}
            onEscolher={setContaFiltro}
            opcoes={[
              { id: TODOS, rotulo: "Todas as contas" },
              ...contas,
            ]}
          />
          {(jobFiltro !== TODOS || contaFiltro !== TODOS) && (
            <button
              type="button"
              onClick={() => {
                setJobFiltro(TODOS);
                setContaFiltro(TODOS);
              }}
              className="text-[11.5px] font-semibold text-california-red hover:underline"
            >
              Limpar
            </button>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <CardSaldo
          rotulo={`Saldo ${agregado ? "do projeto" : "do job"} hoje`}
          valor={fluxo.saldoHoje}
          moeda={moeda}
          nota="Entradas menos saídas já movimentadas"
        />
        <CardSaldo
          rotulo={`Saldo no fim ${agregado ? "do projeto" : "do job"}`}
          valor={fluxo.saldoFim}
          moeda={moeda}
          nota={`Projeção até ${fluxo.ultimoMesLabel}`}
          destacarPositivo
        />
      </div>

      <div className="rounded-2xl border border-border bg-card px-[22px] pb-[18px] pt-4 shadow-soft">
        <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.09em] text-[#8a8a8a]">
          Prazos {agregado && jobFiltro === TODOS ? "· média dos jobs" : "do job"}
        </p>
        <div className="grid gap-3.5 sm:grid-cols-3">
          {cardsDePrazo.map((p) => (
            <div
              key={p.rotulo}
              className="rounded-xl border border-border px-[15px] py-[13px]"
            >
              <p className="text-[11px] text-muted-foreground">{p.rotulo}</p>
              <p className="mt-1.5 flex items-baseline gap-1.5">
                <span className="font-mono text-[19px] font-bold">
                  {p.dias === null ? "—" : p.dias}
                </span>
                {p.dias !== null && (
                  <span className="text-[11.5px] text-muted-foreground">
                    dias
                  </span>
                )}
              </p>
              <p className="mt-1 text-[11px] text-[#8a8a8a]">
                {p.dias === null
                  ? "sem data para fechar o prazo"
                  : agregado && jobFiltro === TODOS
                    ? `${p.fim} · média de ${p.base} ${p.base === 1 ? "job" : "jobs"}`
                    : p.fim}
              </p>
            </div>
          ))}
        </div>
      </div>

      {colunas === 0 ? (
        <div className="rounded-2xl border border-border bg-card px-5 py-8 text-center text-sm text-muted-foreground shadow-soft">
          Nada no fluxo de caixa com esses filtros.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
          <table className="w-full min-w-[900px] border-collapse text-[13.5px]">
            <thead>
              <tr className="border-b border-border">
                <th className="w-[300px] px-5 py-3 text-left text-[10px] font-bold uppercase tracking-[0.07em] text-muted-foreground">
                  Período
                </th>
                {fluxo.meses.map((m, i) => (
                  <th
                    key={m}
                    className={cn(
                      "min-w-[120px] px-4 py-2.5 text-right",
                      i === fluxo.indiceEmCurso &&
                        "border-x border-california-red/25 bg-california-red/[0.04]",
                    )}
                  >
                    <span className="block font-mono text-xs font-bold text-foreground">
                      {rotuloMes(m)}
                    </span>
                    <span
                      className={cn(
                        "mt-0.5 block text-[9.5px] font-bold uppercase tracking-[0.07em]",
                        i === fluxo.indiceEmCurso
                          ? "text-california-red"
                          : "text-[#8a8a8a]",
                      )}
                    >
                      {i < fluxo.indiceEmCurso || fluxo.indiceEmCurso === -1
                        ? "Realizado"
                        : i === fluxo.indiceEmCurso
                          ? "Em curso"
                          : "Previsto"}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(["entrada", "saida"] as NaturezaFluxo[]).map((tom) => (
                <React.Fragment key={tom}>
                  <tr className="border-t border-border bg-[#f8f7f7]/60">
                    <td className="px-5 py-[11px] text-[13.5px] font-bold">
                      {tom === "entrada" ? "Entradas" : "Saídas"}
                    </td>
                    {totalDe(tom).map((v, i) => (
                      <Celula
                        key={i}
                        valor={v}
                        tom={tom}
                        moeda={moeda}
                        titulo={tom === "entrada" ? "Entradas" : "Saídas"}
                        mes={rotuloMes(fluxo.meses[i])}
                        quantos={
                          fluxo.composicao[chaveComposicao(tom, "total", i)]
                            ?.length ?? 0
                        }
                        itens={() =>
                          fluxo.composicao[
                            chaveComposicao(tom, "total", i)
                          ] ?? []
                        }
                      />
                    ))}
                  </tr>

                  {subLinhas(tom).map((linha) => {
                    const chave = `${tom}-${linha.classe}`;
                    const porJob = (fluxo.porJob[chave] ?? []).filter((c) =>
                      c.valores.some((v) => v !== 0),
                    );
                    // Com um job só, abrir por job repetiria a própria
                    // linha — aí só os documentos expandem.
                    const abreJobs = agregado && porJob.length > 0;
                    const expansivel = abreJobs || linha.detalhes.length > 0;
                    const aberto = Boolean(abertos[chave]);

                    return (
                      <React.Fragment key={chave}>
                        <tr
                          className={cn(
                            "border-t border-[#f4f2f2]",
                            expansivel && "cursor-pointer hover:bg-muted/40",
                          )}
                          onClick={
                            expansivel
                              ? () =>
                                  setAbertos((a) => ({ ...a, [chave]: !a[chave] }))
                              : undefined
                          }
                        >
                          <td className="py-[9px] pl-[30px] pr-5 text-muted-foreground">
                            <span className="flex items-center gap-[7px]">
                              {expansivel && (
                                <ChevronRight
                                  className={cn(
                                    "h-3 w-3 shrink-0 text-[#8a8a8a] transition-transform",
                                    aberto && "rotate-90",
                                  )}
                                />
                              )}
                              <span className="text-[12.5px]">{linha.rotulo}</span>
                            </span>
                            <span className="mt-0.5 block text-[11px] text-[#8a8a8a]">
                              {abreJobs
                                ? `${porJob.length} ${porJob.length === 1 ? "job" : "jobs"} · ${linha.sub}`
                                : linha.sub}
                            </span>
                          </td>
                          {linha.valores.map((v, i) => (
                            <Celula
                              key={i}
                              valor={v}
                              tom={tom}
                              moeda={moeda}
                              titulo={linha.rotulo}
                              mes={rotuloMes(fluxo.meses[i])}
                              quantos={
                                fluxo.composicao[
                                  chaveComposicao(tom, linha.classe, i)
                                ]?.length ?? 0
                              }
                              itens={() =>
                                fluxo.composicao[
                                  chaveComposicao(tom, linha.classe, i)
                                ] ?? []
                              }
                            />
                          ))}
                        </tr>

                        {/* Contribuição de cada job na sub-linha. */}
                        {aberto &&
                          abreJobs &&
                          porJob.map((c) => {
                            const job = jobPorId.get(c.jobId);
                            return (
                              <tr
                                key={`${chave}-${c.jobId}`}
                                className="border-t border-[#f4f2f2] bg-[#f8f7f7]/40"
                              >
                                <td className="py-2 pl-[52px] pr-5">
                                  <span className="flex items-baseline gap-2">
                                    <span className="font-mono text-[11px] font-semibold text-[#b3323c]">
                                      {job?.codigo ?? "—"}
                                    </span>
                                    <span className="truncate text-[12px] text-muted-foreground">
                                      {job?.nome ?? ""}
                                    </span>
                                  </span>
                                </td>
                                {c.valores.map((v, i) => (
                                  <Celula
                                    key={i}
                                    valor={v}
                                    tom={tom}
                                    moeda={moeda}
                                    discreta
                                    titulo={`${job?.codigo ?? "Job"} · ${linha.rotulo}`}
                                    mes={rotuloMes(fluxo.meses[i])}
                                    quantos={v > 0 ? 1 : 0}
                                    itens={() =>
                                      (
                                        fluxo.composicao[
                                          chaveComposicao(tom, linha.classe, i)
                                        ] ?? []
                                      ).filter((x) => x.jobId === c.jobId)
                                    }
                                  />
                                ))}
                              </tr>
                            );
                          })}

                        {/* Documentos por trás dos títulos. */}
                        {aberto && linha.detalhes.length > 0 && (
                          <tr>
                            <td
                              colSpan={colunas + 1}
                              className="border-t border-[#f4f2f2] bg-[#f8f7f7]/55 p-0"
                            >
                              <div className="flex flex-col gap-1.5 py-2.5 pl-11 pr-5">
                                <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#8a8a8a]">
                                  {linha.detalheTitulo}
                                </p>
                                {linha.detalhes.map((d) => (
                                  <div
                                    key={d.chave}
                                    className="flex flex-wrap items-center gap-3 rounded-[10px] border border-border bg-white px-3 py-[9px]"
                                  >
                                    <span className="font-mono text-xs font-bold text-california-red">
                                      {d.codigo}
                                    </span>
                                    {/* Com vários jobs, sem o código do job
                                        não dá para saber de qual documento
                                        se trata. */}
                                    {agregado && (
                                      <span className="whitespace-nowrap rounded-full border border-border bg-muted px-2 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground">
                                        {jobPorId.get(d.jobId)?.codigo ?? "—"}
                                      </span>
                                    )}
                                    <span className="min-w-0 flex-1 text-[12.5px]">
                                      {d.descricao}
                                    </span>
                                    <span className="whitespace-nowrap font-mono text-[11.5px] text-muted-foreground">
                                      venc. {formatDataBr(d.vencimento)}
                                    </span>
                                    <span className="whitespace-nowrap font-mono text-[12.5px] font-semibold">
                                      {formatCurrency(d.valor, moeda)}
                                    </span>
                                    <span
                                      className={cn(
                                        "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.05em]",
                                        d.situacao === "Vencido"
                                          ? "border-california-red/30 bg-california-red/[0.06] text-[#b3323c]"
                                          : "border-amber-200 bg-amber-50 text-amber-700",
                                      )}
                                    >
                                      {d.situacao}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </React.Fragment>
              ))}

              <tr className="border-t border-border">
                <td className="px-5 py-[11px] text-[13px] font-semibold">
                  Líquido do período
                </td>
                {fluxo.liquido.map((v, i) => {
                  const chave = chaveComposicao("liquido", "total", i);
                  return (
                    <Celula
                      key={i}
                      valor={v}
                      // `tom` não decide cor nem sinal no líquido; quem
                      // decide é o próprio valor.
                      tom="entrada"
                      liquido
                      moeda={moeda}
                      titulo="Líquido do período"
                      mes={rotuloMes(fluxo.meses[i])}
                      quantos={fluxo.composicao[chave]?.length ?? 0}
                      itens={() => fluxo.composicao[chave] ?? []}
                    />
                  );
                })}
              </tr>

              <tr className="border-t-2 border-foreground bg-[#f8f7f7]/90">
                <td className="px-5 py-3 text-[13px] font-bold">
                  Saldo acumulado {agregado ? "do projeto" : "do job"}
                </td>
                {fluxo.saldo.map((v, i) => (
                  <td
                    key={i}
                    className={cn(
                      "whitespace-nowrap px-4 py-3 text-right font-mono text-[13px] font-bold",
                      v < 0 ? "text-[#b3323c]" : "text-foreground",
                    )}
                  >
                    {formatCurrency(v, moeda)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SeletorFiltro({
  rotulo,
  valor,
  opcoes,
  onEscolher,
}: {
  rotulo: string;
  valor: string;
  opcoes: { id: string; rotulo: string }[];
  onEscolher: (id: string) => void;
}) {
  const [aberto, setAberto] = React.useState(false);
  const atual = opcoes.find((o) => o.id === valor) ?? opcoes[0];

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-[34px] max-w-[280px] items-center gap-2 rounded-lg border bg-white px-3 text-left transition-colors",
            valor === "todos" ? "border-border" : "border-california-red",
          )}
        >
          <span className="text-[10px] font-bold uppercase tracking-[0.07em] text-[#8a8a8a]">
            {rotulo}
          </span>
          <span className="truncate text-[12.5px] font-semibold">
            {atual?.rotulo}
          </span>
          <ChevronRight className="h-3 w-3 shrink-0 rotate-90 text-[#8a8a8a]" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="max-h-[320px] w-[300px] overflow-y-auto p-1.5" align="start">
        {opcoes.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => {
              onEscolher(o.id);
              setAberto(false);
            }}
            className={cn(
              "block w-full truncate rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-muted",
              o.id === valor && "bg-california-red/[0.06] text-california-red",
            )}
          >
            {o.rotulo}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Uma célula da matriz, com a composição do valor no hover e no clique.
 *
 * Decisão do Tiago, 26/08/2026: o número sozinho não diz de onde veio, e
 * na linha de movimento convivem recebimento de cliente e estorno de PP
 * — que somam juntos, porque o extrato da conta é esse, mas não
 * significam a mesma coisa. A composição é quem os separa.
 *
 * Hover abre com atraso curto (varrer a tabela com o mouse não pode
 * disparar um popover por célula) e fecha ao sair. O clique FIXA, para
 * dar tempo de ler uma lista longa e de rolar dentro dela.
 */
function Celula({
  valor,
  tom,
  moeda,
  discreta,
  itens,
  quantos = 0,
  titulo,
  mes,
  liquido,
}: {
  valor: number;
  tom: NaturezaFluxo;
  moeda: string;
  discreta?: boolean;
  /** Thunk: a lista só é montada quando o popover abre. */
  itens?: () => ItemComposicao[];
  /** Quantos documentos há por trás — barato, decide se a célula abre. */
  quantos?: number;
  titulo?: string;
  mes?: string;
  /**
   * Célula do "Líquido do período": o valor pode ser NEGATIVO, a cor sai
   * do sinal e não da natureza, e a composição mistura entrada e saída —
   * cada item aparece com o próprio sinal.
   */
  liquido?: boolean;
}) {
  const [aberto, setAberto] = React.useState(false);
  const [fixado, setFixado] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Quem manda é ter documento, não o valor: no líquido o zero pode ser
  // entrada e saída que se anulam, e essa célula tem o que mostrar.
  const temComposicao = Boolean(itens) && quantos > 0;

  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const entrar = () => {
    if (!temComposicao) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setAberto(true), 140);
  };

  const sair = () => {
    if (timer.current) clearTimeout(timer.current);
    if (!fixado) setAberto(false);
  };

  const clicar = (e: React.MouseEvent) => {
    if (!temComposicao) return;
    // A linha inteira já tem onClick para expandir os documentos; sem
    // isto, abrir a composição também sanfonaria a linha.
    e.stopPropagation();
    if (timer.current) clearTimeout(timer.current);
    setFixado((f) => !f);
    setAberto(true);
  };

  const lista = aberto && itens ? itens() : [];

  const celula = (
    <td
      onMouseEnter={entrar}
      onMouseLeave={sair}
      onClick={clicar}
      className={cn(
        "whitespace-nowrap px-4 text-right font-mono",
        discreta ? "py-2 text-[11.5px]" : "py-[11px] text-[12.5px]",
        temComposicao &&
          "cursor-pointer underline-offset-[3px] hover:underline hover:decoration-dotted",
        fixado && "bg-california-red/[0.05]",
        liquido
          ? // No líquido a cor sai do SINAL: sobrou dinheiro no mês (verde)
            // ou faltou (vermelho). A natureza não decide nada aqui.
            valor > 0
            ? "font-semibold text-emerald-700"
            : valor < 0
              ? "font-semibold text-[#b3323c]"
              : "text-[#c9c9c9]"
          : valor > 0
            ? tom === "entrada"
              ? cn("text-emerald-700", !discreta && "font-semibold")
              : cn("text-[#b3323c]", !discreta && "font-semibold")
            : "text-[#c9c9c9]",
      )}
    >
      {(liquido ? valor !== 0 : valor > 0) ? formatCurrency(valor, moeda) : "–"}
    </td>
  );

  if (!temComposicao) return celula;

  return (
    <Popover
      open={aberto}
      onOpenChange={(o) => {
        setAberto(o);
        if (!o) setFixado(false);
      }}
    >
      <PopoverAnchor asChild>{celula}</PopoverAnchor>
      <PopoverContent
        align="end"
        className="w-[400px] p-0"
        // Sem isto o popover de hover rouba o foco da tabela.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="border-b border-border px-3.5 py-2.5">
          <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#8a8a8a]">
            {titulo}
            {mes ? ` · ${mes}` : ""}
          </p>
          <p className="mt-0.5 flex items-baseline justify-between gap-3">
            <span
              className={cn(
                "font-mono text-[15px] font-bold",
                (liquido ? valor >= 0 : tom === "entrada")
                  ? "text-emerald-700"
                  : "text-[#b3323c]",
              )}
            >
              {formatCurrency(valor, moeda)}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {lista.length}{" "}
              {lista.length === 1 ? "lançamento" : "lançamentos"}
            </span>
          </p>
        </div>
        <div className="max-h-[260px] overflow-y-auto px-2 py-2">
          {lista.map((it) => (
            <div
              key={it.chave}
              className={cn(
                "rounded-lg px-2 py-[7px]",
                it.estorno && "bg-amber-50/70",
              )}
            >
              <div className="flex items-baseline justify-between gap-3">
                {/* O código sozinho na primeira linha: dividindo-a com o
                    selo, rótulo longo ("Cronograma de desembolsos")
                    truncava o código, que é o que identifica o
                    documento. */}
                <span className="truncate font-mono text-[11.5px] font-bold text-california-red">
                  {it.codigo}
                </span>
                {/* No líquido as duas naturezas convivem: sem o sinal
                    não dá para ver o que soma e o que subtrai. */}
                <span
                  className={cn(
                    "whitespace-nowrap font-mono text-[12px] font-semibold",
                    liquido &&
                      (it.natureza === "entrada"
                        ? "text-emerald-700"
                        : "text-[#b3323c]"),
                  )}
                >
                  {liquido ? (it.natureza === "entrada" ? "+ " : "− ") : ""}
                  {formatCurrency(it.valor, moeda)}
                </span>
              </div>
              <p className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                <span
                  className={cn(
                    "shrink-0 whitespace-nowrap rounded-full border px-1.5 py-px text-[9px] font-bold uppercase tracking-[0.04em]",
                    it.estorno
                      ? "border-amber-300 bg-amber-100/70 text-amber-800"
                      : "border-border bg-muted text-muted-foreground",
                  )}
                >
                  {it.rotulo}
                </span>
                <span className="shrink-0 whitespace-nowrap font-mono text-[10.5px] text-[#8a8a8a]">
                  {formatDataBr(it.data)}
                </span>
                {/* Nas linhas de previsão a descrição É o rótulo — a view
                    monta "Cronograma de desembolsos · JOB-0013 1/2" —, e
                    repetir a mesma frase ao lado do selo é ruído. */}
                {it.descricao !== it.rotulo && (
                  <span className="min-w-0 flex-1 truncate">
                    {it.descricao}
                  </span>
                )}
              </p>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function CardSaldo({
  rotulo,
  valor,
  moeda,
  nota,
  destacarPositivo,
}: {
  rotulo: string;
  valor: number;
  moeda: string;
  nota: string;
  destacarPositivo?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card px-[22px] py-[18px] shadow-soft">
      <p className="text-[10px] font-bold uppercase tracking-[0.09em] text-[#8a8a8a]">
        {rotulo}
      </p>
      <p
        className={cn(
          "mt-1.5 font-mono text-2xl font-bold",
          valor < 0
            ? "text-[#b3323c]"
            : destacarPositivo
              ? "text-emerald-700"
              : "text-foreground",
        )}
      >
        {formatCurrency(valor, moeda)}
      </p>
      <p className="mt-1 text-[11.5px] text-muted-foreground">{nota}</p>
    </div>
  );
}

function formatDataBr(iso: string | null): string {
  if (!iso) return "—";
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  if (!ano || !mes || !dia) return "—";
  return `${dia}/${mes}/${ano}`;
}
