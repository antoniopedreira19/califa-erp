"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ChevronRight,
  Download,
  FolderTree,
  List,
  Loader2,
  Search,
} from "lucide-react";
import { formatCurrency, cn } from "@/lib/utils";
import { jobStatusBadgeClasses, jobStatusExibido, jobStatusLabel } from "@/lib/types";
import type { JobAberto } from "./dados-abertos";
import { RENTAB_VALOR } from "@/app/(app)/_planilha/blocos";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { compararCodigosDeJob } from "@/lib/codigos/jobs";
import {
  BarraDosFiltrosDeColuna,
  celulaData,
  celulaTexto,
  celulaValor,
  useFiltrosDeColuna,
  type ColunaFiltravel,
} from "@/components/ui/filtro-de-coluna";
import { formatDiaBr } from "@/lib/formatar-data-hora";

const TODOS = "Todos";

/**
 * Chips da esteira do faturamento. Cada job cai em exatamente um — a
 * decisão de 14/08/2026 foi trocar "Aguardando encerramento", que se
 * sobrepunha a "Faturado", pelos dois estados de dinheiro: recebido
 * (`Liquidado`) e vencido sem receber (`Inadimplente`).
 */
type Chip =
  | "todos"
  | "aguardando_faturamento"
  | "faturado"
  | "liquidado"
  | "inadimplente";

const CHIPS: { key: Chip; rotulo: string }[] = [
  { key: "todos", rotulo: "Todos" },
  { key: "aguardando_faturamento", rotulo: "Aguardando faturamento" },
  { key: "faturado", rotulo: "Faturado" },
  { key: "liquidado", rotulo: "Liquidado" },
  { key: "inadimplente", rotulo: "Inadimplente" },
];

/**
 * Como a tabela se arruma (design "Abertura de Job - Financeiro",
 * 24/08/2026).
 *
 * "Por projeto" é a tela de sempre: faixa do projeto e os jobs dele
 * embaixo. "Por job" é a lista corrida, ordenada pela abertura mais
 * recente — para quem procura UM job e não quer caçar em que projeto ele
 * foi parar. O padrão continua sendo por projeto: é a arrumação que o
 * financeiro já tinha, e trocá-la sem pedir mudaria a tela de todo mundo.
 */
type Modo = "projeto" | "job";

const MODOS: { key: Modo; rotulo: string; Icone: typeof FolderTree }[] = [
  { key: "projeto", rotulo: "Por projeto", Icone: FolderTree },
  { key: "job", rotulo: "Por job", Icone: List },
];

/** Ainda não virou nota — os dois estados anteriores ao faturamento. */
function aguardandoFaturamento(j: JobAberto): boolean {
  return (
    j.situacao_faturamento === "aguardando_envio" ||
    j.situacao_faturamento === "enviado"
  );
}

function noChip(j: JobAberto, chip: Chip): boolean {
  if (chip === "todos") return true;
  if (chip === "aguardando_faturamento") return aguardandoFaturamento(j);
  return j.situacao_faturamento === chip;
}

/** O projeto do FINANCEIRO, com o da produção de reserva — o mesmo da faixa. */
function projetoDoJob(j: JobAberto): string {
  const codigo = j.projeto_financeiro_codigo ?? j.projeto_codigo ?? "";
  const nome = j.projeto_financeiro_nome ?? j.projeto_nome ?? "";
  return `${codigo} ${nome}`.trim();
}

/**
 * As colunas que filtram e ordenam pelo título, como no Excel (pedido do
 * Tiago, 09/10/2026, decisão 165 — o mesmo filtro da aba PPs do job). As duas
 * arrumações usam as MESMAS colunas: o filtro feito "Por projeto" continua
 * valendo "Por job". Na lista "Por job", o título Job é o filtro do Nome
 * (a busca da coluna acha pelo código também).
 */
const COLUNAS: ColunaFiltravel<JobAberto>[] = [
  { chave: "codigo", rotulo: "Código", tipo: "texto", celula: (j) => celulaTexto(j.codigo) },
  {
    chave: "nome",
    rotulo: "Nome",
    tipo: "texto",
    celula: (j) => ({ ...celulaTexto(j.nome), busca: `${j.nome} ${j.nome_producao} ${j.codigo}` }),
  },
  {
    chave: "projeto",
    rotulo: "Projeto",
    tipo: "texto",
    // Árvore cliente ▸ projeto: o cliente marca todos os projetos dele.
    celula: (j) => ({ ...celulaTexto(projetoDoJob(j)), grupo: j.cliente_nome ?? "" }),
    rotuloSemGrupo: "(sem cliente)",
  },
  { chave: "cliente", rotulo: "Cliente", tipo: "texto", celula: (j) => celulaTexto(j.cliente_nome) },
  { chave: "gp", rotulo: "GP responsável", tipo: "texto", celula: (j) => celulaTexto(j.responsavel_nome) },
  { chave: "abertura", rotulo: "Abertura", tipo: "data", celula: (j) => celulaData(j.data_abertura_financeiro) },
  {
    chave: "valor",
    rotulo: "Valor do Job",
    tipo: "valor",
    faixa: true,
    alinhar: "right",
    celula: (j) => celulaValor(j.valor_total, (n) => formatCurrency(n)),
  },
  {
    // Sem o selo da esteira (decisão 207), a coluna é só o valor: filtra
    // por faixa. A situação continua nos chips de cima.
    chave: "faturamento",
    rotulo: "Faturamento",
    tipo: "valor",
    faixa: true,
    alinhar: "right",
    celula: (j) => celulaValor(j.valor_faturamento ?? 0, (n) => formatCurrency(n)),
  },
  {
    chave: "rentabilidade",
    rotulo: "Rentabilidade",
    tipo: "valor",
    faixa: true,
    alinhar: "right",
    celula: (j) => celulaValor(j.rentabilidade, (n) => formatCurrency(n)),
  },
];

interface GrupoProjeto {
  /** Id do projeto DO FINANCEIRO (ou do de produção, no fallback). */
  projetoId: string;
  codigo: string | null;
  nome: string | null;
  cliente: string | null;
  jobs: JobAberto[];
  total: number;
  faturamento: number;
  /** Soma das rentabilidades dos jobs do projeto; nula se nenhum tem. */
  rentabilidade: number | null;
  aberto: boolean;
  /**
   * O grupo tem projeto do financeiro de verdade? Falso só no fallback,
   * em job aberto antes da migration 20260820000011 que nunca foi
   * reeditado — aí a chave do grupo é o projeto da PRODUÇÃO, e a visão
   * agregada do financeiro não existe para ele.
   */
  temProjetoFinanceiro: boolean;
}

/**
 * Os anos em que o job tem competência, como texto do filtro. O rateio
 * (decisão 055) manda; job sem rateio gravado cai no ano da coluna.
 */
function anosDeCompetencia(j: JobAberto): string[] {
  if (j.competencia_anos.length > 0) return j.competencia_anos.map(String);
  return j.competencia_ano ? [String(j.competencia_ano)] : [];
}

/** Opções de um filtro, na ordem em que aparecem, sem repetir e sem vazio. */
function opcoesDe(linhas: JobAberto[], campo: (j: JobAberto) => string | null) {
  const vistos: string[] = [];
  for (const j of linhas) {
    const v = campo(j);
    if (v && !vistos.includes(v)) vistos.push(v);
  }
  return [TODOS, ...vistos.sort((a, b) => a.localeCompare(b, "pt-BR"))];
}

/** Soma das rentabilidades de um conjunto de jobs. Nula quando nenhum tem
 *  a conta feita — a faixa e o total mostram travessão, e não zero. */
function somaDasRentabilidades(jobs: JobAberto[]): number | null {
  const comConta = jobs.filter((j) => j.rentabilidade !== null);
  if (comConta.length === 0) return null;
  return comConta.reduce((s, j) => s + (j.rentabilidade ?? 0), 0);
}

/** "27,60%" — a rentabilidade sobre o valor do job, com as duas casas do
 *  registro da abertura: o mesmo número escrito do mesmo jeito. */
function textoDoPercentual(pct: number): string {
  return `${pct.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

/** Faturamento sem o selo da esteira (decisão 207): o valor e, quando a
 *  nota já saiu, o número dela. */
function CelulaFaturamento({ j }: { j: JobAberto }) {
  return (
    <div className="flex flex-col items-end gap-px">
      <span className="whitespace-nowrap font-semibold tabular-nums">
        {formatCurrency(j.valor_faturamento)}
      </span>
      {j.numero_nf && (
        <span className="font-mono text-[10.5px] text-muted-foreground">
          NF {j.numero_nf}
        </span>
      )}
    </div>
  );
}

/** Rentabilidade: a mesma do job (decisão 207), em grafite — positiva ou
 *  negativa, como nas planilhas — e, embaixo, em % do valor do job. */
function CelulaRentabilidade({ j }: { j: JobAberto }) {
  if (j.rentabilidade === null) {
    return <div className="text-right text-muted-foreground">—</div>;
  }
  return (
    <div className="flex flex-col items-end gap-px">
      <span className={cn("whitespace-nowrap font-semibold tabular-nums", RENTAB_VALOR)}>
        {formatCurrency(j.rentabilidade)}
      </span>
      <span className="whitespace-nowrap text-[11px] tabular-nums text-muted-foreground">
        {textoDoPercentual(j.rentabilidade_pct ?? 0)}
      </span>
    </div>
  );
}

/** Nome do job com o selo de status, quando ele não é `aberto`. */
function NomeDoJob({ j }: { j: JobAberto }) {
  // O pedido de cancelamento no ar também ganha selo (decisão 169): o job
  // está parado, esperando a decisão na fila.
  const status = jobStatusExibido(j.status, null, j.cancelamento_pendente);
  return (
    <div className="flex flex-col gap-0.5">
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{j.nome}</span>
        {/* Só quando o status NÃO é `aberto`: com a aba listando
            encerrados, sem esta marca não dá para distinguir um do
            outro. Um badge em toda linha seria ruído — a maioria é
            aberta. */}
        {status !== "aberto" && (
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.05em]",
              // Mesma cor do selo em todo o sistema (decisão 087): encerrado
              // violeta — a cor que esta marca já tinha — e finalizado verde.
              jobStatusBadgeClasses(status),
            )}
          >
            {jobStatusLabel(status)}
          </span>
        )}
      </span>
      {j.nome_producao !== j.nome && (
        <span className="text-[11px] text-muted-foreground">
          produção: {j.nome_producao}
        </span>
      )}
    </div>
  );
}

/**
 * Em que tela a lista está. As duas mostram as mesmas colunas (decisão 207,
 * Tiago, 23/10/2026); muda o que é da tela: onde os filtros dos títulos
 * ficam guardados (cada tela com os seus), o texto da lista vazia e o nome
 * do arquivo do Excel. Texto e não objeto: constante de módulo
 * `"use client"` chega ao server component como proxy.
 */
export type TelaDaLista = "abertura" | "resultado";

const DA_TELA: Record<TelaDaLista, { guardarEm: string; semJobs: string; arquivo: string }> = {
  abertura: {
    guardarEm: "abertura-visualizar-jobs",
    semJobs: "Nenhum job aberto ainda. Abra um job na aba ao lado.",
    arquivo: "Jobs no financeiro",
  },
  resultado: {
    guardarEm: "resultado-de-job",
    semJobs: "Nenhum job aberto no financeiro ainda.",
    arquivo: "Resultado de Job",
  },
};

export function JobsAbertosList({
  linhas,
  tela,
}: {
  linhas: JobAberto[];
  tela: TelaDaLista;
}) {
  const daTela = DA_TELA[tela];
  const router = useRouter();
  const [busca, setBusca] = React.useState("");
  const [chip, setChip] = React.useState<Chip>("todos");
  const [regional, setRegional] = React.useState(TODOS);
  const [gp, setGp] = React.useState(TODOS);
  const [produto, setProduto] = React.useState(TODOS);
  const [ano, setAno] = React.useState(TODOS);
  const [modo, setModo] = React.useState<Modo>("projeto");
  const [dropAberto, setDropAberto] = React.useState<string | null>(null);
  // Grupos nascem abertos: guardamos os FECHADOS para não precisar semear
  // o state com os ids dos projetos no mount. Mesmo padrão de /jobs.
  const [fechados, setFechados] = React.useState<Set<string>>(new Set());

  const filtros = [
    {
      key: "regional",
      rotulo: "Regional",
      valor: regional,
      set: setRegional,
      opcoes: opcoesDe(linhas, (j) => j.regional_nome),
    },
    {
      key: "gp",
      rotulo: "GP responsável",
      valor: gp,
      set: setGp,
      opcoes: opcoesDe(linhas, (j) => j.responsavel_nome),
    },
    {
      key: "produto",
      rotulo: "Marca",
      valor: produto,
      set: setProduto,
      opcoes: opcoesDe(linhas, (j) => j.produto),
    },
    {
      key: "ano",
      rotulo: "Ano",
      valor: ano,
      set: setAno,
      // Ano da COMPETÊNCIA — o eixo contábil do financeiro, não o do
      // calendário do job. Job rateado em dois anos entra nas duas
      // opções (decisão 055).
      opcoes: [
        TODOS,
        ...Array.from(
          new Set(linhas.flatMap((j) => anosDeCompetencia(j))),
        ).sort(),
      ],
    },
  ];

  const filtroDeCima =
    busca.trim() !== "" ||
    chip !== "todos" ||
    regional !== TODOS ||
    gp !== TODOS ||
    produto !== TODOS ||
    ano !== TODOS;

  /** Os jobs que passam nos filtros de CIMA. Os filtros dos títulos vêm
   *  depois, sobre esta lista — e valem para as DUAS arrumações. */
  const doTopo = React.useMemo(() => {
    const q = busca.trim().toLowerCase();

    return linhas.filter((j) => {
      if (!noChip(j, chip)) return false;
      if (regional !== TODOS && j.regional_nome !== regional) return false;
      if (gp !== TODOS && j.responsavel_nome !== gp) return false;
      if (produto !== TODOS && j.produto !== produto) return false;
      if (ano !== TODOS && !anosDeCompetencia(j).includes(ano)) return false;
      if (q === "") return true;
      // Busca também pelo nome da produção: quem procura pode lembrar do
      // nome antigo, não do que o financeiro deu.
      return [j.codigo, j.nome, j.nome_producao]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [linhas, busca, chip, regional, gp, produto, ano]);

  const colunas = useFiltrosDeColuna(doTopo, COLUNAS, { guardarEm: daTela.guardarEm });
  /** Os jobs que passam em tudo — a base das DUAS visões e dos totais. */
  const visiveis = colunas.visiveis;
  const filtroAtivo = filtroDeCima || colunas.filtrando;

  const grupos = React.useMemo<GrupoProjeto[]>(() => {
    // Agrupa pelo projeto DO FINANCEIRO — é a arrumação desta aba, e ela
    // é independente da produção (decisão do Tiago, 20/08/2026). Job
    // aberto antes da migration 20260820000011 e nunca reeditado pode não
    // ter projeto do financeiro; nesse caso cai no da produção, para não
    // sumir da lista nem virar um grupo "sem projeto".
    const porProjeto = new Map<string, JobAberto[]>();
    for (const j of visiveis) {
      const chave = j.projeto_financeiro_id ?? j.projeto_id;
      const arr = porProjeto.get(chave) ?? [];
      arr.push(j);
      porProjeto.set(chave, arr);
    }

    const out: GrupoProjeto[] = [];
    // Com ordem pelo título, os jobs de cada projeto vêm naquela ordem e o
    // projeto entra na posição do seu primeiro job.
    for (const [projetoId, jobs] of porProjeto) {
      const primeiro = jobs[0];
      out.push({
        projetoId,
        codigo: primeiro.projeto_financeiro_codigo ?? primeiro.projeto_codigo,
        nome: primeiro.projeto_financeiro_nome ?? primeiro.projeto_nome,
        cliente: primeiro.cliente_nome,
        jobs,
        total: jobs.reduce((s, j) => s + (j.valor_total ?? 0), 0),
        faturamento: jobs.reduce((s, j) => s + (j.valor_faturamento ?? 0), 0),
        rentabilidade: somaDasRentabilidades(jobs),
        // Com filtro ativo o grupo abre sempre: fechado esconderia
        // justamente o job que o filtro encontrou.
        aberto: filtroAtivo ? true : !fechados.has(projetoId),
        temProjetoFinanceiro: primeiro.projeto_financeiro_id !== null,
      });
    }
    if (colunas.ordenacao) return out;
    return out.sort((a, b) =>
      (a.codigo ?? "").localeCompare(b.codigo ?? "", "pt-BR"),
    );
  }, [visiveis, filtroAtivo, fechados, colunas.ordenacao]);

  /**
   * A lista corrida da visão "Por job": abertura mais recente primeiro,
   * código decrescente no empate (ano e número — decisão 114). Sem a faixa do projeto, ordenar por
   * código deixaria os jobs novos no fim da página.
   */
  const linhasPorJob = React.useMemo(
    () =>
      colunas.ordenacao
        ? visiveis
        : visiveis
        .slice()
        .sort(
          (a, b) =>
            (b.data_abertura_financeiro ?? "").localeCompare(
              a.data_abertura_financeiro ?? "",
            ) || compararCodigosDeJob(b.codigo, a.codigo),
        ),
    [visiveis, colunas.ordenacao],
  );

  const totalVisivel = visiveis.reduce((s, j) => s + (j.valor_total ?? 0), 0);
  // Os dois números do design particionam o visível: ou a nota saiu, ou
  // ainda não. Somam o valor de faturamento, não o valor do job.
  const soma = (fn: (j: JobAberto) => boolean) =>
    visiveis.filter(fn).reduce((s, j) => s + (j.valor_faturamento ?? 0), 0);

  const totalAguardando = soma(aguardandoFaturamento);
  const totalFaturado = soma((j) => !aguardandoFaturamento(j));
  // Liquidado e inadimplente são recortes DENTRO do faturado. Só aparecem
  // quando existem — enquanto o módulo de recebimento não roda, a linha
  // fica igual à do design.
  const totalLiquidado = soma((j) => j.situacao_faturamento === "liquidado");
  const totalInadimplente = soma(
    (j) => j.situacao_faturamento === "inadimplente",
  );
  const totalRentabilidade = somaDasRentabilidades(visiveis);
  // O % do total é sobre o valor dos jobs que têm a conta feita.
  const valorComRentabilidade = visiveis
    .filter((j) => j.rentabilidade !== null)
    .reduce((s, j) => s + (j.valor_total ?? 0), 0);

  function toggleGrupo(id: string) {
    setFechados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /**
   * A linha clicada abre o job em **Informações do Job**, e não em
   * "Abertura do Job", que é o padrão da página (decisão do Tiago,
   * 08/09/2026, estendendo o que já valia no Calendário de Jobs).
   *
   * Vale para as duas arrumações — por projeto e por job —, porque as
   * duas passam por aqui.
   */
  function abrirJob(id: string) {
    router.push(`/financeiro/jobs/${id}?aba=info`);
  }

  const [exportando, setExportando] = React.useState(false);
  const [erroExportar, setErroExportar] = React.useState(false);

  /**
   * Baixa em Excel o que está na tela, na ordem da arrumação escolhida
   * (pedido do Tiago, 16/10/2026). Grupo recolhido não esconde job do
   * arquivo: recolher é só visual. O gerador vem por import dinâmico — o
   * ExcelJS só desce para quem clica.
   */
  async function exportar() {
    if (exportando || visiveis.length === 0) return;
    setExportando(true);
    setErroExportar(false);
    try {
      const { baixarJobsEmExcel } = await import("./exportar-lista");
      const ordem = modo === "projeto" ? grupos.flatMap((g) => g.jobs) : linhasPorJob;
      await baixarJobsEmExcel(ordem, filtroAtivo, daTela.arquivo);
    } catch (e) {
      console.error("[abertura.exportar-lista]", e);
      setErroExportar(true);
    } finally {
      setExportando(false);
    }
  }

  const vazio = (
    <p className="px-4 py-12 text-center text-sm text-muted-foreground">
      {linhas.length === 0
        ? daTela.semJobs
        : "Nenhum job aberto encontrado com esses filtros."}
    </p>
  );

  return (
    <div className="space-y-4">
      {/* Chips da esteira do faturamento, antes dos filtros — é por eles
          que o financeiro entra na tela. */}
      <div className="flex flex-wrap items-center gap-2">
        {CHIPS.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setChip(c.key)}
            aria-pressed={chip === c.key}
            className={cn(
              "h-[34px] rounded-full border px-3.5 text-[12.5px] font-semibold transition-colors",
              chip === c.key
                ? "border-california-red bg-california-red text-white"
                : "border-border bg-white text-muted-foreground hover:border-[#d7d7d7] hover:text-foreground",
            )}
          >
            {c.rotulo}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-2.5">
          {erroExportar && (
            <span className="text-[12px] text-california-red">
              Não foi possível gerar a planilha. Tente de novo.
            </span>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={exportar}
                disabled={exportando || visiveis.length === 0}
                className="inline-flex h-[34px] items-center gap-1.5 rounded-lg border border-border bg-white px-3.5 text-[12.5px] font-semibold text-foreground transition-colors hover:border-california-red/30 hover:bg-california-red/[0.06] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {exportando ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-california-red" />
                ) : (
                  <Download className="h-3.5 w-3.5 text-california-red" />
                )}
                {exportando ? "Exportando…" : "Exportar Excel"}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="end">
              {visiveis.length === 1
                ? "O job da lista"
                : `Os ${visiveis.length} jobs da lista`}
              {filtroAtivo ? ", com os filtros aplicados" : ""}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Filtros + busca */}
      <div className="flex flex-wrap items-center gap-2">
        {filtros.map((f) => {
          const ativo = f.valor !== TODOS;
          return (
            <div key={f.key} className="relative">
              <button
                type="button"
                onClick={() =>
                  setDropAberto(dropAberto === f.key ? null : f.key)
                }
                aria-expanded={dropAberto === f.key}
                className={cn(
                  "flex h-[38px] items-center justify-between gap-2 rounded-lg border bg-white px-3 text-[12.5px] font-medium transition-colors",
                  ativo
                    ? "border-california-red text-foreground"
                    : "border-border text-muted-foreground hover:border-[#d7d7d7]",
                )}
              >
                {ativo ? `${f.rotulo}: ${f.valor}` : f.rotulo}
                <ChevronRight className="h-3.5 w-3.5 rotate-90 text-muted-foreground" />
              </button>
              {dropAberto === f.key && (
                <>
                  {/* Clique fora fecha o menu sem precisar de listener global. */}
                  <button
                    type="button"
                    aria-label="Fechar filtro"
                    onClick={() => setDropAberto(null)}
                    className="fixed inset-0 z-10 cursor-default"
                  />
                  <div className="absolute left-0 top-11 z-20 min-w-[200px] rounded-xl border border-border bg-white p-1.5 shadow-elevated">
                    {f.opcoes.map((o) => (
                      <button
                        key={o}
                        type="button"
                        onClick={() => {
                          f.set(o);
                          setDropAberto(null);
                        }}
                        className={cn(
                          "block w-full rounded-lg px-2.5 py-2 text-left text-[13px] font-medium transition-colors hover:bg-muted",
                          o === f.valor
                            ? "text-california-red"
                            : "text-foreground",
                        )}
                      >
                        {o}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          );
        })}

        <div className="relative ml-auto flex items-center">
          <Search className="absolute left-3 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome ou código"
            className="h-[38px] w-64 rounded-lg border border-border bg-white pl-9 pr-3 text-[12.5px] outline-none focus:border-california-red/40"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3.5 text-[12.5px] text-muted-foreground">
        <span>
          {/* "jobs", e não "jobs abertos": desde 21/08/2026 a aba lista
              também os encerrados. */}
          {visiveis.length === 1
            ? "1 job no financeiro"
            : `${visiveis.length} jobs no financeiro`}
        </span>
        <span className="h-3 w-px bg-[#dcdcdc]" />
        <span>
          Faturado{" "}
          <strong className="tabular-nums text-foreground">
            {formatCurrency(totalFaturado)}
          </strong>
        </span>
        <span className="h-3 w-px bg-[#dcdcdc]" />
        <span>
          Aguardando faturamento{" "}
          <strong className="tabular-nums text-foreground">
            {formatCurrency(totalAguardando)}
          </strong>
        </span>
        {totalLiquidado > 0 && (
          <>
            <span className="h-3 w-px bg-[#dcdcdc]" />
            <span>
              Liquidado{" "}
              <strong className="tabular-nums text-emerald-700">
                {formatCurrency(totalLiquidado)}
              </strong>
            </span>
          </>
        )}
        {totalInadimplente > 0 && (
          <>
            <span className="h-3 w-px bg-[#dcdcdc]" />
            <span>
              Inadimplente{" "}
              <strong className="tabular-nums text-california-red">
                {formatCurrency(totalInadimplente)}
              </strong>
            </span>
          </>
        )}
        <span className="h-3 w-px bg-[#dcdcdc]" />
        <span>
          Rentabilidade{" "}
          {totalRentabilidade === null ? (
            <strong className="text-foreground">—</strong>
          ) : (
            <>
              <strong className={cn("tabular-nums", RENTAB_VALOR)}>
                {formatCurrency(totalRentabilidade)}
              </strong>
              {valorComRentabilidade > 0 && (
                <span className="tabular-nums">
                  {" "}
                  ({textoDoPercentual((totalRentabilidade / valorComRentabilidade) * 100)})
                </span>
              )}
            </>
          )}
        </span>
        <span className="h-3 w-px bg-[#dcdcdc]" />
        <span>
          Valor do Job{" "}
          <strong className="tabular-nums text-foreground">
            {formatCurrency(totalVisivel)}
          </strong>
        </span>

        <div className="ml-auto flex items-center gap-2.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
            Organizar por
          </span>
          <div
            role="group"
            aria-label="Como organizar a lista"
            className="flex items-center gap-[3px] rounded-[9px] bg-[#f1f0ec] p-[3px]"
          >
            {MODOS.map(({ key, rotulo, Icone }) => (
              <button
                key={key}
                type="button"
                aria-pressed={modo === key}
                onClick={() => setModo(key)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-[7px] px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-california-red/30",
                  modo === key
                    ? "bg-white text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
                    : "bg-transparent text-[#8a8a8a] hover:text-foreground",
                )}
              >
                <Icone className="h-[13px] w-[13px]" />
                {rotulo}
              </button>
            ))}
          </div>
        </div>
      </div>

      {colunas.ativo && (
        <BarraDosFiltrosDeColuna
          visiveis={colunas.visiveis.length}
          total={colunas.total}
          singular="job"
          plural="jobs"
          onLimpar={colunas.limpar}
        />
      )}

      {modo === "projeto" ? (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
          <table className="w-full min-w-[1320px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/60 text-left text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
                <th className="w-8 px-2 py-3" aria-label="Expandir" />
                <th className="px-4 py-3 font-semibold">{colunas.titulo("codigo")}</th>
                <th className="px-4 py-3 font-semibold">{colunas.titulo("nome")}</th>
                <th className="px-4 py-3 font-semibold">{colunas.titulo("projeto")}</th>
                <th className="px-4 py-3 font-semibold">{colunas.titulo("cliente")}</th>
                <th className="px-4 py-3 font-semibold">{colunas.titulo("gp")}</th>
                <th className="px-4 py-3 font-semibold">{colunas.titulo("abertura")}</th>
                <th className="px-4 py-3 text-right font-semibold">{colunas.titulo("valor")}</th>
                <th className="px-4 py-3 text-right font-semibold">{colunas.titulo("faturamento")}</th>
                <th className="px-4 py-3 text-right font-semibold">{colunas.titulo("rentabilidade")}</th>
              </tr>
            </thead>
            <tbody>
              {grupos.map((g) => (
                <React.Fragment key={g.projetoId}>
                  <tr
                    role="button"
                    tabIndex={0}
                    aria-expanded={g.aberto}
                    onClick={() => toggleGrupo(g.projetoId)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleGrupo(g.projetoId);
                      }
                    }}
                    className={cn(
                      "cursor-pointer border-b border-border transition-colors hover:bg-[#f0eeee]/85 focus-visible:bg-[#f0eeee]/85 focus-visible:outline-none",
                      g.aberto ? "bg-muted/90" : "bg-muted/40",
                    )}
                  >
                    <td colSpan={10} className="p-0">
                      <div className="grid grid-cols-[32px_1fr_auto_auto_auto_auto_auto] items-center gap-4 py-[11px] pl-2 pr-4">
                        <div className="flex items-center justify-center">
                          <span
                            className={cn(
                              "flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-transform duration-150",
                              g.aberto && "rotate-90",
                            )}
                          >
                            <ChevronRight className="h-4 w-4" />
                          </span>
                        </div>
                        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                          <span className="font-mono text-xs font-semibold text-[#b3323c]">
                            {g.codigo ?? "—"}
                          </span>
                          <span className="text-[13.5px] font-semibold">
                            {g.nome ?? "Projeto"}
                          </span>
                          <span className="h-3 w-px bg-[#dcdcdc]" />
                          <span className="text-xs text-muted-foreground">
                            {g.cliente ?? "—"}
                          </span>
                        </div>
                        <span className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
                          {g.jobs.length === 1
                            ? "1 job"
                            : `${g.jobs.length} jobs`}
                        </span>
                        <span className="whitespace-nowrap text-[13px] font-bold tabular-nums">
                          {formatCurrency(g.total)}
                        </span>
                        <RotuloDaFaixa
                          rotulo="Faturamento"
                          valor={g.faturamento}
                          cor="text-foreground"
                        />
                        <RotuloDaFaixa
                          rotulo="Rentabilidade"
                          valor={g.rentabilidade}
                          cor={RENTAB_VALOR}
                        />
                        {/* Tela do PRÓPRIO financeiro: o módulo não
                            encaminha para telas de outros módulos, e o
                            agregado aqui é pelo projeto do financeiro
                            (decisão do Tiago, 20/08/2026). */}
                        {g.temProjetoFinanceiro && (
                          <Link
                            href={`/financeiro/projetos/${g.projetoId}`}
                            prefetch={false}
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.06em] text-california-red hover:text-california-red/80"
                          >
                            Visão agregada
                            <ArrowRight className="h-3 w-3" />
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>

                  {g.aberto &&
                    g.jobs.map((j, i) => (
                      <tr
                        key={j.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => abrirJob(j.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            abrirJob(j.id);
                          }
                        }}
                        className="cursor-pointer border-b border-b-[#f4f2f2] transition-colors hover:bg-muted/70 focus-visible:bg-muted/70 focus-visible:outline-none"
                      >
                        {/* Calha da árvore: a vertical desce até o meio da
                            última linha e o traço encosta no código. */}
                        <td className="relative w-8 px-2 py-3">
                          <span
                            aria-hidden="true"
                            className="absolute left-[23px] top-0 w-px bg-[#dad7d7]"
                            style={{
                              height: i === g.jobs.length - 1 ? "50%" : "100%",
                            }}
                          />
                          <span
                            aria-hidden="true"
                            className="absolute left-6 top-1/2 h-px w-[9px] bg-[#dad7d7]"
                          />
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-semibold text-[#b3323c]">
                          {j.codigo}
                        </td>
                        <td className="px-4 py-3">
                          <NomeDoJob j={j} />
                        </td>
                        {/* Repete o projeto da faixa de propósito: com o
                            grupo colapsado a linha vira resultado de busca
                            solto, e "de que projeto é isso?" some. É o
                            projeto do FINANCEIRO — o mesmo por que a faixa
                            agrupa. */}
                        <td className="px-4 py-3 text-muted-foreground">
                          <div className="flex flex-col gap-0.5">
                            <span className="whitespace-nowrap font-mono text-[11px] font-semibold text-[#b3323c]">
                              {j.projeto_financeiro_codigo ??
                                j.projeto_codigo ??
                                "—"}
                            </span>
                            <span className="text-[12px]">
                              {j.projeto_financeiro_nome ??
                                j.projeto_nome ??
                                "—"}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {j.cliente_nome ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {j.responsavel_nome ?? "—"}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                          {formatDiaBr(j.data_abertura_financeiro)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums">
                          {formatCurrency(j.valor_total)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          <CelulaFaturamento j={j} />
                        </td>
                        <td className="px-4 py-3">
                          <CelulaRentabilidade j={j} />
                        </td>
                      </tr>
                    ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>

          {grupos.length === 0 && vazio}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
          <table className="w-full min-w-[1180px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/60 text-left text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
                <th className="px-4 py-3 font-semibold">{colunas.titulo("nome", undefined, "Job")}</th>
                <th className="px-4 py-3 font-semibold">{colunas.titulo("projeto")}</th>
                <th className="px-4 py-3 font-semibold">{colunas.titulo("cliente")}</th>
                <th className="px-4 py-3 font-semibold">{colunas.titulo("gp")}</th>
                <th className="px-4 py-3 font-semibold">{colunas.titulo("abertura")}</th>
                <th className="px-4 py-3 text-right font-semibold">{colunas.titulo("valor")}</th>
                <th className="px-4 py-3 text-right font-semibold">{colunas.titulo("faturamento")}</th>
                <th className="px-4 py-3 text-right font-semibold">{colunas.titulo("rentabilidade")}</th>
              </tr>
            </thead>
            <tbody>
              {linhasPorJob.map((j) => (
                <tr
                  key={j.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => abrirJob(j.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      abrirJob(j.id);
                    }
                  }}
                  className="cursor-pointer border-b border-b-[#f4f2f2] transition-colors hover:bg-muted/70 focus-visible:bg-muted/70 focus-visible:outline-none"
                >
                  <td className="px-4 py-3">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <NomeDoJob j={j} />
                      <span className="whitespace-nowrap font-mono text-[11.5px] font-semibold text-[#b3323c]">
                        {j.codigo}
                      </span>
                    </div>
                  </td>
                  {/* Sem a faixa do projeto, é o código que leva à visão
                      agregada (decisão do Tiago, 24/08/2026). Job sem
                      projeto do financeiro não tem essa tela — aí o código
                      fica como texto. */}
                  <td className="px-4 py-3">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      {j.projeto_financeiro_id ? (
                        <Link
                          href={`/financeiro/projetos/${j.projeto_financeiro_id}`}
                          prefetch={false}
                          onClick={(e) => e.stopPropagation()}
                          className="whitespace-nowrap font-mono text-xs font-semibold text-california-red hover:text-california-red/80"
                        >
                          {j.projeto_financeiro_codigo ?? "—"}
                        </Link>
                      ) : (
                        <span className="whitespace-nowrap font-mono text-xs font-semibold text-[#b3323c]">
                          {j.projeto_codigo ?? "—"}
                        </span>
                      )}
                      <span className="text-[12px] text-muted-foreground">
                        {j.projeto_financeiro_nome ?? j.projeto_nome ?? "—"}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {j.cliente_nome ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {j.responsavel_nome ?? "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {formatDiaBr(j.data_abertura_financeiro)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums">
                    {formatCurrency(j.valor_total)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <CelulaFaturamento j={j} />
                  </td>
                  <td className="px-4 py-3">
                    <CelulaRentabilidade j={j} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {linhasPorJob.length === 0 && vazio}
        </div>
      )}
    </div>
  );
}

/** Faturamento e Rentabilidade somados do projeto, na faixa do grupo. */
function RotuloDaFaixa({
  rotulo,
  valor,
  cor,
}: {
  rotulo: string;
  /** Nula: nenhum job do projeto tem a conta feita — travessão. */
  valor: number | null;
  cor: string;
}) {
  return (
    <span className="flex flex-col items-end gap-px whitespace-nowrap">
      <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {rotulo}
      </span>
      <span className={cn("text-[12.5px] font-semibold tabular-nums", cor)}>
        {valor === null ? "—" : formatCurrency(valor)}
      </span>
    </span>
  );
}
