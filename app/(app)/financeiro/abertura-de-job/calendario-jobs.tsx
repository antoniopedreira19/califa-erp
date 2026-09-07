"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  ArrowRight,
  Briefcase,
  CalendarDays,
  CalendarOff,
  CalendarRange,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  GanttChart,
  Info,
  Search,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { JobAberto } from "./dados-abertos";
import {
  SEMANA,
  celulasDoMes,
  dataBr,
  dataCurta,
  diaDaSemana,
  diaPorExtenso,
  diasEntre,
  distanciaLabel,
  mesDe,
  mesPorExtenso,
  numeroBr,
  semanaDe,
  somaDias,
  somaMeses,
  valorCurto,
} from "./calendario-datas";

const TODAS = "Todas";
const TODOS = "Todos";
const SEM_SERVICO = "Sem serviço";

/**
 * A paleta que colore o calendário, na ordem em que é distribuída.
 *
 * Vem do design "Calendário de Jobs" — as mesmas cinco cores que lá
 * separavam as categorias. O eixo mudou para SERVIÇO (decisão do Tiago,
 * 07/09/2026): a categoria hoje é "Evento" em 20 dos 25 jobs abertos e
 * deixaria a grade inteira de uma cor só, enquanto o serviço tem três
 * valores em uso.
 *
 * A cor não é gravada em lugar nenhum: sai da ordem alfabética dos
 * serviços PRESENTES na lista. Serviço novo entrando no cadastro pode
 * deslocar as cores dos que vêm depois dele no alfabeto — é o preço de
 * não ter uma coluna de cor no banco, e ninguém decora "Ativação é
 * azul": a legenda está sempre na tela, ao lado da grade.
 */
const PALETA = ["#B3323C", "#1D4ED8", "#7C3AED", "#047857", "#A16207"];

/** Job sem serviço no orçamento de origem. Cinza, e sempre por último. */
const COR_SEM_SERVICO = "#8a8a8a";

type Visao = "mes" | "ativos";
type Agrupamento = "nenhum" | "gp" | "cliente" | "regional" | "categoria" | "servico";
type Ordem = "evento" | "fim" | "inicio" | "custo" | "valor";

const AGRUPAMENTOS: { valor: Agrupamento; rotulo: string }[] = [
  { valor: "nenhum", rotulo: "Sem agrupamento" },
  { valor: "gp", rotulo: "Agrupar por GP" },
  { valor: "cliente", rotulo: "Agrupar por cliente" },
  { valor: "regional", rotulo: "Agrupar por regional" },
  { valor: "servico", rotulo: "Agrupar por serviço" },
  { valor: "categoria", rotulo: "Agrupar por categoria" },
];

const ORDENS: { valor: Ordem; rotulo: string }[] = [
  { valor: "evento", rotulo: "Proximidade do evento" },
  { valor: "fim", rotulo: "Ordenar por fim" },
  { valor: "inicio", rotulo: "Ordenar por início" },
  { valor: "custo", rotulo: "Ordenar por custo previsto" },
  { valor: "valor", rotulo: "Ordenar por valor do job" },
];

const servicoDe = (j: JobAberto) => j.servico_nome ?? SEM_SERVICO;

/**
 * O job está EM ANDAMENTO nessa data?
 *
 * Comparação de string, que em `YYYY-MM-DD` já é cronológica. Job sem
 * uma das pontas fica de fora: sem intervalo não há como dizer em que
 * dias ele corre. Ele continua aparecendo pela data de evento, que é
 * outra coluna — some da conta de "ativos", não do calendário.
 */
function ativoEm(j: JobAberto, dia: string): boolean {
  if (!j.data_inicio_prevista || !j.data_fim_prevista) return false;
  return j.data_inicio_prevista <= dia && dia <= j.data_fim_prevista;
}

const classeCampo =
  "h-8 rounded-lg border border-border bg-white px-2.5 text-[12.5px] font-medium text-foreground outline-none focus:border-california-red/40";

const classeNav =
  "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-white text-muted-foreground transition-colors hover:border-california-red/40 hover:text-california-red";

const classeBotao =
  "inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-white px-3 text-xs font-semibold text-muted-foreground transition-colors hover:border-california-red/40 hover:text-california-red";

/**
 * O Calendário de Jobs — a terceira aba da Abertura de Job.
 *
 * São duas leituras da MESMA lista, e a diferença entre elas é o que o
 * design deixou explícito no subtítulo: a grade do mês mostra as DATAS
 * DE EVENTO; a visão de data mostra tudo que está EM ANDAMENTO entre o
 * início e o fim previstos, que é uma pergunta diferente e muito mais
 * populosa (um evento em setembro costuma ter dois meses de job em
 * volta).
 *
 * A lista desce pronta do server component — a mesma de "Visualizar
 * Jobs", sem query nova. Trocar de aba, de mês ou de dia é só estado de
 * tela: nada aqui volta ao banco.
 */
export function CalendarioJobs({
  linhas,
  hoje,
}: {
  linhas: JobAberto[];
  /**
   * "hoje" em `YYYY-MM-DD`, no fuso de Brasília, calculado no servidor.
   * Não pode sair de `new Date()` aqui dentro: o servidor renderiza numa
   * data e o navegador em outra, e o React acusa divergência de
   * hidratação — o mesmo cuidado que `formatEnviadoEm` já toma na fila.
   */
  hoje: string;
}) {
  const router = useRouter();

  const [visao, setVisao] = React.useState<Visao>("mes");
  const [mes, setMes] = React.useState(() => mesDe(hoje));
  const [dia, setDia] = React.useState(hoje);
  const [servicoFiltro, setServicoFiltro] = React.useState<string | null>(null);
  const [popupAberto, setPopupAberto] = React.useState(false);

  const [busca, setBusca] = React.useState("");
  const [regional, setRegional] = React.useState(TODAS);
  const [gp, setGp] = React.useState(TODOS);
  const [agrupamento, setAgrupamento] = React.useState<Agrupamento>("nenhum");
  const [ordem, setOrdem] = React.useState<Ordem>("evento");
  const [fechados, setFechados] = React.useState<Set<string>>(new Set());

  // ---------------------------------------------------------------- cores
  // A ordem alfabética dos serviços presentes decide a cor. "Sem
  // serviço" fica fora da distribuição e sempre em cinza, para não
  // gastar uma cor da paleta com a ausência do dado.
  const cores = React.useMemo(() => {
    const nomes = Array.from(new Set(linhas.map(servicoDe)))
      .filter((s) => s !== SEM_SERVICO)
      .sort((a, b) => a.localeCompare(b, "pt-BR"));
    const mapa = new Map<string, string>();
    nomes.forEach((n, i) => mapa.set(n, PALETA[i % PALETA.length]));
    mapa.set(SEM_SERVICO, COR_SEM_SERVICO);
    return mapa;
  }, [linhas]);

  const cor = React.useCallback(
    (j: JobAberto) => cores.get(servicoDe(j)) ?? COR_SEM_SERVICO,
    [cores],
  );

  /** A lista depois do filtro da legenda — a base de TUDO na tela. */
  const jobs = React.useMemo(
    () =>
      servicoFiltro ? linhas.filter((j) => servicoDe(j) === servicoFiltro) : linhas,
    [linhas, servicoFiltro],
  );

  const legenda = React.useMemo(() => {
    const contagem = new Map<string, number>();
    for (const j of linhas) {
      const s = servicoDe(j);
      contagem.set(s, (contagem.get(s) ?? 0) + 1);
    }
    return Array.from(contagem.entries())
      .sort(([a], [b]) => {
        // "Sem serviço" sempre por último — é ausência de dado, não um
        // serviço a mais.
        if (a === SEM_SERVICO) return 1;
        if (b === SEM_SERVICO) return -1;
        return a.localeCompare(b, "pt-BR");
      })
      .map(([nome, total]) => ({
        nome,
        total,
        cor: cores.get(nome) ?? COR_SEM_SERVICO,
      }));
  }, [linhas, cores]);

  // ------------------------------------------------------------- indicadores
  const ativosHoje = React.useMemo(
    () => linhas.filter((j) => ativoEm(j, hoje)).length,
    [linhas, hoje],
  );

  const eventosNoMes = React.useMemo(
    () => jobs.filter((j) => j.data_evento && mesDe(j.data_evento) === mes).length,
    [jobs, mes],
  );

  const semana = React.useMemo(() => semanaDe(hoje), [hoje]);

  const eventosNaSemana = React.useMemo(
    () =>
      jobs.filter(
        (j) =>
          j.data_evento &&
          j.data_evento >= semana.inicio &&
          j.data_evento <= semana.fim,
      ).length,
    [jobs, semana],
  );

  // ------------------------------------------------------------ grade do mês
  const grade = React.useMemo(() => {
    const porDia = new Map<string, JobAberto[]>();
    for (const j of jobs) {
      if (!j.data_evento) continue;
      const lista = porDia.get(j.data_evento);
      if (lista) lista.push(j);
      else porDia.set(j.data_evento, [j]);
    }

    const celulas = celulasDoMes(mes).map((c) => ({
      ...c,
      ativos: jobs.filter((j) => ativoEm(j, c.iso)).length,
      eventos: porDia.get(c.iso) ?? [],
    }));

    // O pico serve a duas coisas: o resumo do mês e a intensidade do
    // badge de ativos de cada célula, que é relativa ao mês mostrado.
    let pico = 1;
    let picoDia = celulas[0]?.iso ?? mes + "-01";
    for (const c of celulas) {
      if (c.doMes && c.ativos > pico) {
        pico = c.ativos;
        picoDia = c.iso;
      }
    }
    return { celulas, pico, picoDia };
  }, [jobs, mes]);

  // ------------------------------------------------- jobs ativos numa data
  const ativosNoDia = React.useMemo(
    () => jobs.filter((j) => ativoEm(j, dia)),
    [jobs, dia],
  );

  const eventosNoDia = React.useMemo(
    () => jobs.filter((j) => j.data_evento === dia),
    [jobs, dia],
  );

  const opcoesRegional = React.useMemo(
    () => opcoesDe(linhas, (j) => j.regional_nome, TODAS),
    [linhas],
  );
  const opcoesGp = React.useMemo(
    () => opcoesDe(linhas, (j) => j.responsavel_nome, TODOS),
    [linhas],
  );

  const q = busca.trim().toLowerCase();
  const temFiltro = !!q || regional !== TODAS || gp !== TODOS;

  const filtrados = React.useMemo(
    () =>
      ativosNoDia.filter(
        (j) =>
          (regional === TODAS || j.regional_nome === regional) &&
          (gp === TODOS || j.responsavel_nome === gp) &&
          (!q ||
            `${j.codigo} ${j.nome} ${j.cliente_nome ?? ""} ${j.responsavel_nome ?? ""}`
              .toLowerCase()
              .includes(q)),
      ),
    [ativosNoDia, regional, gp, q],
  );

  const grupos = React.useMemo(() => {
    const chave = (j: JobAberto): string => {
      if (agrupamento === "gp") return j.responsavel_nome ?? "Sem GP";
      if (agrupamento === "cliente") return j.cliente_nome ?? "Sem cliente";
      if (agrupamento === "regional") return j.regional_nome ?? "Sem regional";
      if (agrupamento === "servico") return servicoDe(j);
      return j.categoria_nome ?? "Sem categoria";
    };

    const distanciaDoEvento = (j: JobAberto) =>
      j.data_evento ? Math.abs(diasEntre(dia, j.data_evento)) : Number.MAX_SAFE_INTEGER;

    const ordenar = (arr: JobAberto[]) =>
      arr.slice().sort((a, b) => {
        if (ordem === "fim")
          return (a.data_fim_prevista ?? "").localeCompare(b.data_fim_prevista ?? "");
        if (ordem === "inicio")
          return (a.data_inicio_prevista ?? "").localeCompare(
            b.data_inicio_prevista ?? "",
          );
        if (ordem === "custo") return b.custos - a.custos;
        if (ordem === "valor") return (b.valor_total ?? 0) - (a.valor_total ?? 0);
        return (
          distanciaDoEvento(a) - distanciaDoEvento(b) ||
          (a.data_fim_prevista ?? "").localeCompare(b.data_fim_prevista ?? "")
        );
      });

    if (agrupamento === "nenhum") {
      return filtrados.length
        ? [
            {
              rotulo: "Todos os jobs ativos",
              jobs: ordenar(filtrados),
              total: filtrados.reduce((s, j) => s + j.custos, 0),
            },
          ]
        : [];
    }

    const mapa = new Map<string, JobAberto[]>();
    for (const j of filtrados) {
      const k = chave(j);
      const lista = mapa.get(k);
      if (lista) lista.push(j);
      else mapa.set(k, [j]);
    }
    return Array.from(mapa.entries())
      .map(([rotulo, lista]) => ({
        rotulo,
        jobs: ordenar(lista),
        total: lista.reduce((s, j) => s + j.custos, 0),
      }))
      .sort(
        (a, b) =>
          b.jobs.length - a.jobs.length || a.rotulo.localeCompare(b.rotulo, "pt-BR"),
      );
  }, [filtrados, agrupamento, ordem, dia]);

  const terminandoEm7 = ativosNoDia.filter(
    (j) => j.data_fim_prevista && diasEntre(dia, j.data_fim_prevista) <= 7,
  ).length;

  // ------------------------------------------------------------------ ações
  function irParaDia(novo: string, novaVisao?: Visao) {
    setDia(novo);
    setMes(mesDe(novo));
    if (novaVisao) {
      setVisao(novaVisao);
      setPopupAberto(false);
    }
  }

  function abrirDia(iso: string) {
    setDia(iso);
    setPopupAberto(true);
  }

  /**
   * Clique numa linha do calendário — no pop-up do dia ou na tabela de
   * ativos — abre o job direto em **Informações do Job**, e não em
   * "Abertura do Job", que é o padrão da página (decisão do Tiago,
   * 07/09/2026).
   *
   * Quem chega pelo calendário está perguntando QUE job é aquele na
   * agenda: cliente, período, o que ele é. O registro da abertura é a
   * pergunta de quem vem da fila ou de "Visualizar Jobs" — essas duas
   * seguem caindo na aba de abertura, e por isso o `?aba=` fica aqui e
   * não vira o novo padrão da página.
   */
  function abrirJob(id: string) {
    router.push(`/financeiro/jobs/${id}?aba=info`);
  }

  function alternarGrupo(rotulo: string) {
    setFechados((prev) => {
      const next = new Set(prev);
      if (next.has(rotulo)) next.delete(rotulo);
      else next.add(rotulo);
      return next;
    });
  }

  function limparFiltros() {
    setBusca("");
    setRegional(TODAS);
    setGp(TODOS);
  }

  const indicadores = [
    {
      rotulo: "Jobs no calendário",
      Icone: Briefcase,
      cor: "#282828",
      valor: String(linhas.length),
      nota: "abertos e encerrados",
    },
    {
      rotulo: "Ativos hoje",
      Icone: Activity,
      cor: "#E74B56",
      valor: String(ativosHoje),
      nota: `em ${dataBr(hoje)}`,
    },
    {
      rotulo: `Eventos em ${mesPorExtenso(mes).split(" de ")[0].toLowerCase()}`,
      Icone: CalendarDays,
      cor: "#1D4ED8",
      valor: String(eventosNoMes),
      nota: "datas de evento no mês",
    },
    {
      rotulo: "Eventos na semana",
      Icone: CalendarRange,
      cor: "#047857",
      valor: String(eventosNaSemana),
      nota: `${dataCurta(semana.inicio)} a ${dataCurta(semana.fim)}`,
    },
  ];

  return (
    <div className="space-y-5">
      {/* A frase do design. Ela é o que separa as duas visões: a grade do
          mês responde "que eventos caem em cada dia", e a outra responde
          "o que está rodando nessa data" — perguntas diferentes sobre a
          mesma lista. */}
      <p className="max-w-3xl text-sm text-muted-foreground">
        O calendário reúne os jobs já abertos: as datas de evento no mês e, para
        qualquer data, tudo o que está em andamento entre o início e o fim
        previstos.
      </p>

      {/* ---------------------------------------------------- indicadores */}
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(166px,1fr))]">
        {indicadores.map((k) => (
          <div
            key={k.rotulo}
            className="rounded-2xl border border-border bg-white px-4 pb-3.5 pt-3 shadow-sm"
          >
            <div className="flex items-center gap-2 whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
              <span
                className="flex h-[18px] w-[18px] items-center justify-center rounded"
                style={{ backgroundColor: `${k.cor}1a`, color: k.cor }}
              >
                <k.Icone className="h-3 w-3" />
              </span>
              {k.rotulo}
            </div>
            <p className="mt-2 font-mono text-[23px] font-bold tabular-nums tracking-[-0.02em]">
              {k.valor}
            </p>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">{k.nota}</p>
          </div>
        ))}
      </div>

      {/* ------------------------------------------- alternador + legenda */}
      <div className="flex flex-wrap items-center gap-3.5">
        <div className="flex items-center gap-1 rounded-xl bg-[#f1f0ec] p-1">
          {(
            [
              { key: "mes", rotulo: "Eventos no mês", Icone: CalendarDays },
              { key: "ativos", rotulo: "Jobs ativos numa data", Icone: GanttChart },
            ] as const
          ).map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => {
                setVisao(v.key);
                setPopupAberto(false);
              }}
              className={cn(
                "inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-3.5 py-2 text-[12.5px] font-semibold transition-colors",
                visao === v.key
                  ? "bg-white text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <v.Icone className="h-3.5 w-3.5" />
              {v.rotulo}
            </button>
          ))}
        </div>

        <span className="h-[18px] w-px bg-[#e4e2dd]" />

        <div className="flex flex-wrap items-center gap-3.5">
          {legenda.map((s) => {
            const ligado = servicoFiltro === s.nome;
            return (
              <button
                key={s.nome}
                type="button"
                onClick={() => setServicoFiltro(ligado ? null : s.nome)}
                aria-pressed={ligado}
                className={cn(
                  "inline-flex items-center gap-1.5 whitespace-nowrap text-[11.5px] font-medium transition-colors",
                  ligado
                    ? "text-foreground"
                    : servicoFiltro
                      ? "text-[#b0ada6]"
                      : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span
                  className={cn(
                    "h-[7px] w-[7px] shrink-0 rounded-full",
                    servicoFiltro && !ligado && "opacity-35",
                  )}
                  style={{ backgroundColor: s.cor }}
                />
                {s.nome}
                <span className="font-mono text-[10px] font-bold text-[#b0ada6]">
                  {s.total}
                </span>
              </button>
            );
          })}
        </div>

        {servicoFiltro && (
          <button
            type="button"
            onClick={() => setServicoFiltro(null)}
            className="text-[11.5px] font-semibold text-california-red hover:underline"
          >
            Todos os serviços
          </button>
        )}
      </div>

      {/* ------------------------------------------------- visão: o mês */}
      {visao === "mes" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => setMes(somaMeses(mes, -1))}
              className={classeNav}
              aria-label="Mês anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <h2 className="min-w-[186px] text-[19px] font-bold tracking-[-0.02em]">
              {mesPorExtenso(mes)}
            </h2>
            <button
              type="button"
              onClick={() => setMes(somaMeses(mes, 1))}
              className={classeNav}
              aria-label="Próximo mês"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => irParaDia(hoje)}
              className={classeBotao}
            >
              <Crosshair className="h-3 w-3" />
              Hoje
            </button>
            <span className="text-[12.5px] text-muted-foreground">
              {eventosNoMes === 1 ? "1 evento" : `${eventosNoMes} eventos`} · pico de{" "}
              {grade.pico} jobs ativos em {dataBr(grade.picoDia)}
            </span>
            <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-[#a3a3a3]">
              <Info className="h-3 w-3" />o número no canto do dia é quantos jobs
              estão ativos nele
            </span>
          </div>

          <div className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
            <div className="grid grid-cols-7 border-b-[1.5px] border-[#c9c5bc] bg-[#efede8]">
              {SEMANA.map((d, i) => (
                <span
                  key={d}
                  className={cn(
                    "px-2.5 py-2.5 text-[10.5px] font-extrabold uppercase tracking-[0.1em]",
                    i === 0 || i === 6 ? "text-muted-foreground" : "text-[#3d3d3d]",
                    i !== 6 && "border-r border-[#ddd9d1]",
                  )}
                >
                  {d}
                </span>
              ))}
            </div>

            <div className="grid grid-cols-7">
              {grade.celulas.map((c, i) => {
                const selecionado = c.iso === dia;
                const ehHoje = c.iso === hoje;
                const fds = diaDaSemana(c.iso) === 0 || diaDaSemana(c.iso) === 6;
                const carga = grade.pico ? Math.min(1, c.ativos / grade.pico) : 0;
                const extras = c.eventos.length - 3;

                return (
                  <button
                    key={c.iso}
                    type="button"
                    onClick={() => abrirDia(c.iso)}
                    aria-label={`${diaPorExtenso(c.iso)} — ${
                      c.eventos.length === 1
                        ? "1 evento"
                        : `${c.eventos.length} eventos`
                    }, ${c.ativos === 1 ? "1 job ativo" : `${c.ativos} jobs ativos`}`}
                    className={cn(
                      "relative flex min-h-[112px] flex-col p-2.5 text-left transition-colors hover:bg-[#f1f0ec]/50",
                      i % 7 !== 6 && "border-r border-[#d6d3cb]",
                      "border-b border-[#d6d3cb]",
                      !c.doMes
                        ? "bg-[#fbfbfa]"
                        : selecionado
                          ? "bg-[rgba(40,40,40,0.04)]"
                          : fds
                            ? "bg-[rgba(246,245,242,0.45)]"
                            : "bg-white",
                    )}
                  >
                    {/* Destaque "C · Faixa no topo" — a opção padrão do
                        design. Marca o dia selecionado sem mexer no
                        número nem apertar a célula. */}
                    {selecionado && (
                      <span className="absolute inset-x-0 top-0 h-[3px] bg-[#282828]" />
                    )}

                    <div className="flex items-center justify-between gap-1.5">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span
                          className={cn(
                            "inline-flex h-[21px] min-w-[21px] items-center justify-center rounded-md font-mono text-[11.5px] font-bold",
                            ehHoje
                              ? "bg-[#282828] text-white"
                              : c.doMes
                                ? "text-foreground"
                                : "text-[#c2c0bb]",
                          )}
                        >
                          {c.iso.slice(8)}
                        </span>
                        {ehHoje && (
                          <span className="inline-flex shrink-0 items-center rounded-full bg-[rgba(40,40,40,0.07)] px-1.5 py-px text-[9px] font-bold uppercase tracking-[0.07em] text-muted-foreground">
                            hoje
                          </span>
                        )}
                      </div>
                      <span
                        className="inline-flex h-[17px] min-w-[24px] items-center justify-center rounded-full px-1.5 font-mono text-[9.5px] font-bold tabular-nums"
                        style={
                          c.doMes
                            ? {
                                backgroundColor: `rgba(40,40,40,${(0.035 + carga * 0.09).toFixed(3)})`,
                                color: `rgba(40,40,40,${(0.4 + carga * 0.42).toFixed(2)})`,
                              }
                            : {
                                backgroundColor: "rgba(40,40,40,0.03)",
                                color: "#cfcdc8",
                              }
                        }
                      >
                        {c.ativos}
                      </span>
                    </div>

                    <div className="mt-1.5 flex min-w-0 flex-col gap-[3px]">
                      {c.eventos.slice(0, 3).map((j) => (
                        <span
                          key={j.id}
                          className={cn(
                            "flex min-w-0 items-center gap-1.5 rounded px-1.5 py-[3px] text-[10.5px] leading-tight",
                            c.doMes
                              ? "bg-[#f6f5f2] text-foreground"
                              : "bg-[#f9f8f6] text-foreground opacity-50",
                          )}
                        >
                          <span
                            className="h-[5px] w-[5px] shrink-0 rounded-full"
                            style={{ backgroundColor: cor(j) }}
                          />
                          <span className="shrink-0 font-mono text-[9.5px] font-bold text-muted-foreground">
                            {j.codigo}
                          </span>
                          <span className="min-w-0 truncate">{j.nome}</span>
                        </span>
                      ))}
                    </div>

                    {extras > 0 && (
                      <span className="mt-1 pl-0.5 text-[10.5px] font-semibold text-muted-foreground">
                        +{extras} evento{extras > 1 ? "s" : ""}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------- visão: jobs ativos numa data */}
      {visao === "ativos" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => irParaDia(somaDias(dia, -1))}
              className={classeNav}
              aria-label="Dia anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <input
              type="date"
              value={dia}
              onChange={(e) => {
                if (e.target.value) irParaDia(e.target.value);
              }}
              aria-label="Data"
              className={cn(classeCampo, "font-semibold")}
            />
            <button
              type="button"
              onClick={() => irParaDia(somaDias(dia, 1))}
              className={classeNav}
              aria-label="Próximo dia"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => irParaDia(hoje)}
              className={classeBotao}
            >
              <Crosshair className="h-3 w-3" />
              Hoje
            </button>
            <span className="text-[12.5px] text-muted-foreground">
              {ativosNoDia.length} de {jobs.length} jobs ativos · {terminandoEm7}{" "}
              {terminandoEm7 === 1 ? "termina" : "terminam"} em até 7 dias
            </span>
            <button
              type="button"
              onClick={() => setVisao("mes")}
              className="ml-auto inline-flex items-center gap-1.5 text-xs font-semibold text-california-red hover:underline"
            >
              <CalendarDays className="h-3 w-3" />
              Ver o mês
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex items-center">
              <Search className="absolute left-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Job, cliente ou GP"
                className="h-8 w-[252px] rounded-lg border border-border bg-white pl-8 pr-2.5 text-[12.5px] font-medium outline-none focus:border-california-red/40"
              />
            </div>
            <select
              value={regional}
              onChange={(e) => setRegional(e.target.value)}
              aria-label="Regional"
              className={classeCampo}
            >
              {opcoesRegional.map((o) => (
                <option key={o} value={o}>
                  {o === TODAS ? "Todas as regionais" : o}
                </option>
              ))}
            </select>
            <select
              value={gp}
              onChange={(e) => setGp(e.target.value)}
              aria-label="GP"
              className={classeCampo}
            >
              {opcoesGp.map((o) => (
                <option key={o} value={o}>
                  {o === TODOS ? "Todos os GPs" : o}
                </option>
              ))}
            </select>
            <select
              value={agrupamento}
              onChange={(e) => {
                setAgrupamento(e.target.value as Agrupamento);
                setFechados(new Set());
              }}
              aria-label="Agrupamento"
              className={classeCampo}
            >
              {AGRUPAMENTOS.map((o) => (
                <option key={o.valor} value={o.valor}>
                  {o.rotulo}
                </option>
              ))}
            </select>
            <select
              value={ordem}
              onChange={(e) => setOrdem(e.target.value as Ordem)}
              aria-label="Ordenação"
              className={classeCampo}
            >
              {ORDENS.map((o) => (
                <option key={o.valor} value={o.valor}>
                  {o.rotulo}
                </option>
              ))}
            </select>
            {temFiltro && (
              <button type="button" onClick={limparFiltros} className={classeBotao}>
                <X className="h-3 w-3" />
                Limpar filtros
              </button>
            )}
          </div>

          <div className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
            <div className="max-h-[560px] overflow-auto [scrollbar-gutter:stable]">
              <div className="sticky top-0 z-[4] flex h-[38px] min-w-[1120px] items-stretch border-b border-border bg-[#fbfbfa]/95 text-[10px] font-bold uppercase tracking-[0.07em] text-muted-foreground backdrop-blur">
                <span className="flex min-w-0 flex-[1.5] items-center pl-3.5">Job</span>
                <span className="flex w-[118px] shrink-0 items-center">Categoria</span>
                <span className="flex w-[104px] shrink-0 items-center">Serviço</span>
                <span className="flex w-12 shrink-0 items-center">Reg.</span>
                <span className="flex min-w-0 flex-1 items-center pr-3.5">Cliente</span>
                <span className="flex min-w-0 flex-1 items-center pr-3.5">GP</span>
                <span className="flex w-[70px] shrink-0 items-center">Evento</span>
                <span className="flex w-[74px] shrink-0 items-center">Início</span>
                <span className="flex w-[74px] shrink-0 items-center">Fim</span>
                <span className="flex w-[108px] shrink-0 items-center justify-end pr-1">
                  Custo previsto
                </span>
                <span className="flex w-[108px] shrink-0 items-center justify-end pr-3.5">
                  Valor do job
                </span>
              </div>

              {grupos.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-4 py-14">
                  <span className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-[#f6f5f2] text-[#a3a3a3]">
                    <CalendarOff className="h-[18px] w-[18px]" />
                  </span>
                  <p className="text-[13.5px] font-semibold">
                    {ativosNoDia.length === 0
                      ? "Nenhum job ativo nessa data."
                      : "Nenhum job ativo nessa data com esses filtros."}
                  </p>
                  {temFiltro && (
                    <button
                      type="button"
                      onClick={limparFiltros}
                      className="text-xs font-semibold text-california-red hover:underline"
                    >
                      Limpar filtros
                    </button>
                  )}
                </div>
              ) : (
                grupos.map((g) => {
                  const aberto = !fechados.has(g.rotulo);
                  return (
                    <div key={g.rotulo}>
                      <button
                        type="button"
                        onClick={() => alternarGrupo(g.rotulo)}
                        aria-expanded={aberto}
                        className="sticky top-[38px] z-[2] flex h-[29px] min-w-[1120px] items-center gap-2.5 whitespace-nowrap border-y border-border bg-[#f6f5f2] px-3.5 text-[11px] font-bold uppercase tracking-[0.07em] text-muted-foreground"
                      >
                        <ChevronDown
                          className={cn(
                            "h-3.5 w-3.5 shrink-0 transition-transform",
                            !aberto && "-rotate-90",
                          )}
                        />
                        <span>{g.rotulo}</span>
                        <span className="inline-flex items-center rounded-full bg-[#e6e3dc] px-2 py-px font-mono text-[10.5px] tracking-normal">
                          {g.jobs.length}
                        </span>
                        {/* `normal-case` porque o `uppercase` da faixa do
                            grupo pega o total junto e vira "R$ 3,0 MI" —
                            o "mi" e o "mil" são minúsculos. */}
                        <span className="ml-auto font-mono text-[10.5px] normal-case tracking-normal">
                          {valorCurto(g.total)}
                        </span>
                      </button>

                      {aberto &&
                        g.jobs.map((j) => (
                          <LinhaAtiva
                            key={j.id}
                            job={j}
                            dia={dia}
                            cor={cor(j)}
                            onAbrir={() => abrirJob(j.id)}
                          />
                        ))}
                    </div>
                  );
                })
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3.5 border-t border-border bg-[#f6f5f2]/55 px-3.5 py-2.5 text-[11.5px] text-muted-foreground">
              <span>
                {filtrados.length} {filtrados.length === 1 ? "job" : "jobs"} ·{" "}
                {valorCurto(filtrados.reduce((s, j) => s + j.custos, 0))} de custo
                previsto ·{" "}
                {valorCurto(filtrados.reduce((s, j) => s + (j.valor_total ?? 0), 0))}{" "}
                em valor de job
              </span>
              <span className="ml-auto inline-flex items-center gap-1.5">
                <Info className="h-3 w-3" />
                custo previsto = planejado da planilha interna; item com todas as PPs
                geradas passa a entrar pelo realizado
              </span>
            </div>
          </div>
        </div>
      )}

      {/* -------------------------------------------------- pop-up do dia */}
      <Dialog open={popupAberto} onOpenChange={setPopupAberto}>
        <DialogContent className="flex max-h-[calc(100vh-80px)] w-full max-w-[1180px] flex-col gap-0 overflow-hidden p-0">
          <div className="flex items-start gap-3.5 border-b border-border px-5 py-4">
            <div className="min-w-0">
              <DialogTitle className="text-[16.5px] font-bold tracking-[-0.01em]">
                {diaPorExtenso(dia)}
              </DialogTitle>
              <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                {eventosNoDia.length === 1
                  ? "1 evento"
                  : `${eventosNoDia.length} eventos`}{" "}
                · {ativosNoDia.length} jobs ativos nessa data
              </p>
            </div>
            <button
              type="button"
              onClick={() => irParaDia(dia, "ativos")}
              className="ml-auto mr-8 inline-flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold transition-colors hover:border-california-red hover:text-california-red"
            >
              Ver os {ativosNoDia.length} jobs ativos nessa data
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {eventosNoDia.length === 0 ? (
              <p className="px-5 py-8 text-[13px] text-muted-foreground">
                Nenhuma data de evento nesse dia — só jobs em andamento.
              </p>
            ) : (
              <>
                <div className="sticky top-0 z-[2] flex h-[34px] min-w-[940px] items-stretch border-b border-border bg-[#fbfbfa]/95 text-[10px] font-bold uppercase tracking-[0.07em] text-muted-foreground backdrop-blur">
                  <span className="flex min-w-0 flex-[1.5] items-center pl-5">Job</span>
                  <span className="flex w-10 shrink-0 items-center">Reg.</span>
                  <span className="flex min-w-0 flex-1 items-center">Cliente</span>
                  <span className="flex min-w-0 flex-1 items-center">GP</span>
                  <span className="flex w-[70px] shrink-0 items-center">Evento</span>
                  <span className="flex w-[74px] shrink-0 items-center">Início</span>
                  <span className="flex w-[74px] shrink-0 items-center">Fim</span>
                  <span className="flex w-[108px] shrink-0 items-center justify-end pr-1">
                    Custo previsto
                  </span>
                  <span className="flex w-[108px] shrink-0 items-center justify-end pr-5">
                    Valor do job
                  </span>
                </div>
                {eventosNoDia.map((j) => (
                  <LinhaEvento
                    key={j.id}
                    job={j}
                    dia={dia}
                    hoje={hoje}
                    cor={cor(j)}
                    onAbrir={() => {
                      setPopupAberto(false);
                      abrirJob(j.id);
                    }}
                  />
                ))}
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3.5 border-t border-border bg-[#f6f5f2]/55 px-5 py-2.5 text-[11.5px] text-muted-foreground">
            <span>
              {valorCurto(ativosNoDia.reduce((s, j) => s + j.custos, 0))} de custo
              previsto nos {ativosNoDia.length} jobs ativos
              {eventosNoDia.length > 0 && (
                <>
                  {" · "}
                  {valorCurto(eventosNoDia.reduce((s, j) => s + j.custos, 0))} nos
                  eventos do dia
                </>
              )}
            </span>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Uma linha da tabela "Jobs ativos numa data". */
function LinhaAtiva({
  job,
  dia,
  cor,
  onAbrir,
}: {
  job: JobAberto;
  dia: string;
  cor: string;
  onAbrir: () => void;
}) {
  const restam = job.data_fim_prevista ? diasEntre(dia, job.data_fim_prevista) : null;
  const terminaLogo = restam !== null && restam <= 7;
  const distEvento = job.data_evento ? diasEntre(dia, job.data_evento) : null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onAbrir}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onAbrir();
        }
      }}
      className="flex h-[34px] min-w-[1120px] cursor-pointer items-center border-b border-[#f6f5f2] text-xs transition-colors hover:bg-[#fbfbfa]"
    >
      <div className="flex min-w-0 flex-[1.5] items-center gap-2 pl-3.5 pr-4">
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: cor }}
        />
        <span className="shrink-0 font-mono text-[10.5px] font-bold text-[#a3a3a3]">
          {job.codigo}
        </span>
        <span className="min-w-0 truncate">{job.nome}</span>
        {terminaLogo && (
          <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-california-red/10 px-1.5 py-px text-[9.5px] font-bold text-[#b3323c]">
            {restam! <= 0 ? "último dia" : `faltam ${restam}d`}
          </span>
        )}
      </div>
      <span className="w-[118px] shrink-0 truncate pr-3.5 text-[11.5px] text-muted-foreground">
        {job.categoria_nome ?? "—"}
      </span>
      <span className="w-[104px] shrink-0 truncate pr-3.5 text-[11.5px] text-muted-foreground">
        {job.servico_nome ?? "—"}
      </span>
      <span className="w-12 shrink-0 text-[11px] font-semibold text-muted-foreground">
        {job.regional_nome ?? "—"}
      </span>
      <span className="min-w-0 flex-1 truncate pr-3.5 text-muted-foreground">
        {job.cliente_nome ?? "—"}
      </span>
      <span className="min-w-0 flex-1 truncate pr-3.5 text-muted-foreground">
        {job.responsavel_nome ?? "—"}
      </span>
      <span
        className={cn(
          "w-[70px] shrink-0 text-[11px] font-semibold",
          distEvento === null
            ? "text-[#c2c0bb]"
            : Math.abs(distEvento) <= 3
              ? "text-[#b3323c]"
              : Math.abs(distEvento) <= 10
                ? "text-foreground"
                : "text-muted-foreground",
        )}
      >
        {distEvento === null ? "—" : distanciaLabel(distEvento)}
      </span>
      {/* Data fora do mês que se está olhando fica esmaecida: diz que o
          job já vinha de antes (ou segue depois) sem tirar o número da
          tela. É a leitura do design para as pontas "cortadas". */}
      <span
        className={cn(
          "w-[74px] shrink-0 font-mono text-[10.5px] tabular-nums",
          foraDoMes(job.data_inicio_prevista, dia)
            ? "text-[#b8b5ae]"
            : "text-muted-foreground",
        )}
      >
        {dataCurta(job.data_inicio_prevista)}
      </span>
      <span
        className={cn(
          "w-[74px] shrink-0 font-mono text-[10.5px] tabular-nums",
          terminaLogo
            ? "text-[#b3323c]"
            : foraDoMes(job.data_fim_prevista, dia)
              ? "text-[#b8b5ae]"
              : "text-muted-foreground",
        )}
      >
        {dataCurta(job.data_fim_prevista)}
      </span>
      <span className="w-[108px] shrink-0 pr-1 text-right font-mono text-[10.5px] tabular-nums text-foreground">
        {numeroBr(job.custos)}
      </span>
      <span className="w-[108px] shrink-0 pr-3.5 text-right font-mono text-[10.5px] tabular-nums text-muted-foreground">
        {numeroBr(job.valor_total ?? 0)}
      </span>
    </div>
  );
}

/**
 * Uma linha da tabela do pop-up do dia — os eventos daquela data.
 *
 * A coluna Evento aqui mede a distância a partir de HOJE, não do dia
 * selecionado. Na tabela de ativos é o contrário, e nas duas o motivo é o
 * mesmo: informar. Lá a pergunta é "nessa data, quão perto está o evento
 * deste job"; aqui TODO evento é do dia aberto, então medir pelo dia
 * selecionado daria "hoje" em todas as linhas — redundante e, quando o
 * dia aberto não é o de hoje, simplesmente falso.
 */
function LinhaEvento({
  job,
  dia,
  hoje,
  cor,
  onAbrir,
}: {
  job: JobAberto;
  dia: string;
  hoje: string;
  cor: string;
  onAbrir: () => void;
}) {
  const distEvento = job.data_evento ? diasEntre(hoje, job.data_evento) : null;
  const restam = job.data_fim_prevista ? diasEntre(dia, job.data_fim_prevista) : null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onAbrir}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onAbrir();
        }
      }}
      className="flex h-[34px] min-w-[940px] cursor-pointer items-center border-b border-[#f6f5f2] text-xs transition-colors hover:bg-[#fbfbfa]"
    >
      <div className="flex min-w-0 flex-[1.5] items-center gap-2 pl-5 pr-4">
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: cor }}
        />
        <span className="shrink-0 whitespace-nowrap font-mono text-[10.5px] font-bold text-[#a3a3a3]">
          {job.codigo}
        </span>
        <span className="min-w-0 truncate font-semibold">{job.nome}</span>
      </div>
      <span className="w-10 shrink-0 text-[11px] font-semibold text-muted-foreground">
        {job.regional_nome ?? "—"}
      </span>
      <span className="min-w-0 flex-1 truncate pr-3 text-muted-foreground">
        {job.cliente_nome ?? "—"}
      </span>
      <span className="min-w-0 flex-1 truncate pr-3 text-muted-foreground">
        {job.responsavel_nome ?? "—"}
      </span>
      {/* Mesma escala da tabela de ativos: vermelho quando o evento está
          a 3 dias ou menos, escuro até 10, apagado depois disso. */}
      <span
        className={cn(
          "w-[70px] shrink-0 text-[11px] font-semibold",
          distEvento === null
            ? "text-[#c2c0bb]"
            : Math.abs(distEvento) <= 3
              ? "text-[#b3323c]"
              : Math.abs(distEvento) <= 10
                ? "text-foreground"
                : "text-muted-foreground",
        )}
      >
        {distEvento === null ? "—" : distanciaLabel(distEvento)}
      </span>
      <span className="w-[74px] shrink-0 font-mono text-[10.5px] tabular-nums text-muted-foreground">
        {dataCurta(job.data_inicio_prevista)}
      </span>
      <span
        className={cn(
          "w-[74px] shrink-0 font-mono text-[10.5px] tabular-nums",
          restam !== null && restam <= 7 ? "text-[#b3323c]" : "text-muted-foreground",
        )}
      >
        {dataCurta(job.data_fim_prevista)}
      </span>
      <span className="w-[108px] shrink-0 pr-1 text-right font-mono text-[10.5px] tabular-nums text-foreground">
        {numeroBr(job.custos)}
      </span>
      <span className="w-[108px] shrink-0 pr-5 text-right font-mono text-[10.5px] tabular-nums text-muted-foreground">
        {numeroBr(job.valor_total ?? 0)}
      </span>
    </div>
  );
}

/** A data cai fora do mês do dia selecionado? */
function foraDoMes(data: string | null, dia: string): boolean {
  return !!data && mesDe(data) !== mesDe(dia);
}

/** Opções de um filtro, sem repetir e sem vazio, em ordem alfabética. */
function opcoesDe(
  linhas: JobAberto[],
  campo: (j: JobAberto) => string | null,
  rotuloTodos: string,
): string[] {
  const vistos = new Set<string>();
  for (const j of linhas) {
    const v = campo(j);
    if (v) vistos.add(v);
  }
  return [
    rotuloTodos,
    ...Array.from(vistos).sort((a, b) => a.localeCompare(b, "pt-BR")),
  ];
}
