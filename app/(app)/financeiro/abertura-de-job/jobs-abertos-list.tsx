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
  SlidersHorizontal,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { formatCurrency, cn } from "@/lib/utils";
import { jobStatusBadgeClasses, jobStatusExibido, jobStatusLabel } from "@/lib/types";
import type { JobAberto } from "./dados-abertos";
import { BotaoRecolherTodos } from "@/app/(app)/_planilha/recolher-grupos";
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

/** O projeto do FINANCEIRO, com o da produção de reserva — o mesmo da faixa.
 *  Só o nome: o código do projeto não aparece (pedido do Tiago, 27/10/2026). */
function projetoDoJob(j: JobAberto): string {
  return (j.projeto_financeiro_nome ?? j.projeto_nome ?? "").trim();
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
  { chave: "servico", rotulo: "Serviço", tipo: "texto", celula: (j) => celulaTexto(j.servico_nome) },
  { chave: "categoria", rotulo: "Categoria", tipo: "texto", celula: (j) => celulaTexto(j.categoria_nome) },
  { chave: "produto", rotulo: "Marca", tipo: "texto", celula: (j) => celulaTexto(j.produto) },
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
  { chave: "produtor", rotulo: "Produtor responsável", tipo: "texto", celula: (j) => celulaTexto(j.produtor_nome) },
  { chave: "abertura", rotulo: "Abertura", tipo: "data", celula: (j) => celulaData(j.data_abertura_financeiro) },
  { chave: "evento", rotulo: "Data do evento", tipo: "data", celula: (j) => celulaData(j.data_evento) },
  { chave: "periodo", rotulo: "Período", tipo: "data", celula: (j) => celulaData(j.data_inicio_prevista) },
  { chave: "competencia", rotulo: "Competência", tipo: "texto", celula: (j) => celulaTexto(textoDaCompetencia(j)) },
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
  { chave: "desembolsos", rotulo: "Desembolsos", tipo: "valor", faixa: true, alinhar: "right", celula: (j) => celulaValor(j.custos, (n) => formatCurrency(n)) },
  { chave: "impostos", rotulo: "Impostos", tipo: "valor", faixa: true, alinhar: "right", celula: (j) => celulaValor(j.impostos, (n) => formatCurrency(n)) },
  { chave: "custo", rotulo: "Custo", tipo: "valor", faixa: true, alinhar: "right", celula: (j) => celulaValor(j.custo, (n) => formatCurrency(n)) },
  { chave: "aliquota", rotulo: "Alíquota", tipo: "valor", faixa: true, alinhar: "right", celula: (j) => celulaValor(j.aliquota, (n) => `${textoDoPercentual(n)}`) },
  { chave: "prazo_recebimento", rotulo: "Prazo de recebimento", tipo: "valor", faixa: true, alinhar: "right", celula: (j) => celulaValor(j.prazo_recebimento, (n) => `${n} dias`) },
  { chave: "prazo_pagamento", rotulo: "Prazo de pagamento", tipo: "valor", faixa: true, alinhar: "right", celula: (j) => celulaValor(j.prazo_pagamento, (n) => `${n} dias`) },
  {
    chave: "rentabilidade",
    rotulo: "Rentabilidade",
    tipo: "valor",
    faixa: true,
    alinhar: "right",
    celula: (j) => celulaValor(j.rentabilidade, (n) => formatCurrency(n)),
  },
  { chave: "recebido", rotulo: "Valor recebido", tipo: "valor", faixa: true, alinhar: "right", celula: (j) => celulaValor(j.valor_recebido, (n) => formatCurrency(n)) },
  { chave: "recebimento", rotulo: "Data de recebimento", tipo: "data", celula: (j) => celulaData(j.recebimento_data) },
  { chave: "nf", rotulo: "Nº da NF", tipo: "texto", celula: (j) => celulaTexto(j.numero_nf) },
  { chave: "data_faturamento", rotulo: "Data de faturamento", tipo: "data", celula: (j) => celulaData(j.data_faturamento) },
  // Empresa e Regional depois da Rentabilidade (decisão 234).
  { chave: "empresa", rotulo: "Empresa", tipo: "texto", celula: (j) => celulaTexto(j.empresa_nome) },
  { chave: "regional", rotulo: "Regional", tipo: "texto", celula: (j) => celulaTexto(j.regional_nome) },
  {
    chave: "status",
    rotulo: "Status",
    tipo: "texto",
    celula: (j) => celulaTexto(jobStatusLabel(jobStatusExibido(j.status, null))),
  },
];

/** "1T 2026": a competência do job, como no filtro Ano. */
function textoDaCompetencia(j: JobAberto): string | null {
  if (!j.competencia_ano) return null;
  return j.competencia_trimestre ? `${j.competencia_trimestre}T ${j.competencia_ano}` : String(j.competencia_ano);
}

/** "18/10 a 08/11": o período previsto do job. */
function textoDoPeriodo(j: JobAberto): string {
  const d = (iso: string | null) => (iso ? formatDiaBr(iso).slice(0, 5) : null);
  const a = d(j.data_inicio_prevista);
  const b = d(j.data_fim_prevista);
  if (!a && !b) return "—";
  return a && b ? `${a} a ${b}` : (a ?? b ?? "—");
}

/**
 * As colunas que o "Exibir" liga e desliga (decisão 248), na ordem da
 * tabela. Código e Nome (ou Job) ficam sempre. `padrao`: nasce ligada.
 * `soPorJob`: só existe na visão "Por job" (em "Por projeto" a faixa já diz
 * o projeto).
 */
interface ColunaDaLista {
  chave: string;
  rotulo: string;
  grupo: "Job" | "Pessoas" | "Datas" | "Valores" | "Prazos" | "Faturamento";
  padrao: boolean;
  soPorJob?: boolean;
  direita?: boolean;
  celula: (j: JobAberto) => React.ReactNode;
}

const texto = (v: string | null | undefined) => <span className="text-muted-foreground">{v || "—"}</span>;
const valor = (v: number | null | undefined, forte = false) => (
  <span className={cn("whitespace-nowrap tabular-nums", forte && "font-semibold")}>{v === null || v === undefined ? "—" : formatCurrency(v)}</span>
);
const dia = (iso: string | null) => <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">{formatDiaBr(iso)}</span>;

const COLUNAS_DA_LISTA: ColunaDaLista[] = [
  { chave: "servico", rotulo: "Serviço", grupo: "Job", padrao: true, celula: (j) => <span className="whitespace-nowrap text-muted-foreground">{j.servico_nome ?? "—"}</span> },
  { chave: "categoria", rotulo: "Categoria", grupo: "Job", padrao: true, celula: (j) => texto(j.categoria_nome) },
  { chave: "projeto", rotulo: "Projeto", grupo: "Job", padrao: true, soPorJob: true, celula: (j) => <CelulaProjeto j={j} /> },
  { chave: "cliente", rotulo: "Cliente", grupo: "Job", padrao: true, celula: (j) => texto(j.cliente_nome) },
  { chave: "produto", rotulo: "Marca", grupo: "Job", padrao: false, celula: (j) => texto(j.produto) },
  { chave: "gp", rotulo: "GP responsável", grupo: "Pessoas", padrao: true, celula: (j) => texto(j.responsavel_nome) },
  { chave: "produtor", rotulo: "Produtor responsável", grupo: "Pessoas", padrao: true, celula: (j) => texto(j.produtor_nome) },
  { chave: "abertura", rotulo: "Abertura", grupo: "Datas", padrao: true, celula: (j) => dia(j.data_abertura_financeiro) },
  { chave: "evento", rotulo: "Data do evento", grupo: "Datas", padrao: false, celula: (j) => dia(j.data_evento) },
  { chave: "periodo", rotulo: "Período", grupo: "Datas", padrao: false, celula: (j) => <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">{textoDoPeriodo(j)}</span> },
  { chave: "competencia", rotulo: "Competência", grupo: "Datas", padrao: false, celula: (j) => <span className="whitespace-nowrap text-muted-foreground">{textoDaCompetencia(j) ?? "—"}</span> },
  { chave: "valor", rotulo: "Valor do Job", grupo: "Valores", padrao: true, direita: true, celula: (j) => valor(j.valor_total, true) },
  { chave: "faturamento", rotulo: "Faturamento", grupo: "Valores", padrao: true, direita: true, celula: (j) => <CelulaFaturamento j={j} /> },
  {
    chave: "desembolsos",
    rotulo: "Desembolsos",
    grupo: "Valores",
    padrao: true,
    direita: true,
    celula: (j) => (
      <span className="flex flex-col items-end gap-px">
        {valor(j.custos)}
        <span className="whitespace-nowrap text-[11px] text-muted-foreground">
          {j.custos_do_previsto ? "previsto na abertura" : j.custos_realizado > 0 ? `pago ${formatCurrency(j.custos_realizado)}` : "nada pago"}
        </span>
      </span>
    ),
  },
  {
    chave: "custo",
    rotulo: "Custo",
    grupo: "Valores",
    padrao: false,
    direita: true,
    celula: (j) => <ValorComRealizado valor={j.custo} realizado={j.custo_realizado} />,
  },
  {
    chave: "impostos",
    rotulo: "Impostos",
    grupo: "Valores",
    padrao: true,
    direita: true,
    celula: (j) => <ValorComRealizado valor={j.impostos} realizado={j.impostos_realizado} />,
  },
  {
    chave: "aliquota",
    rotulo: "Alíquota",
    grupo: "Valores",
    padrao: true,
    direita: true,
    celula: (j) => <span className="whitespace-nowrap tabular-nums text-muted-foreground">{j.aliquota === null ? "—" : textoDoPercentual(j.aliquota)}</span>,
  },
  { chave: "rentabilidade", rotulo: "Rentabilidade", grupo: "Valores", padrao: true, celula: (j) => <CelulaRentabilidade j={j} /> },
  { chave: "recebido", rotulo: "Valor recebido", grupo: "Faturamento", padrao: false, direita: true, celula: (j) => valor(j.valor_recebido) },
  {
    chave: "recebimento",
    rotulo: "Data de recebimento",
    grupo: "Faturamento",
    padrao: false,
    celula: (j) =>
      j.recebimento_data ? (
        <span className="flex flex-col gap-px">
          {dia(j.recebimento_data)}
          <span className="text-[11px] text-muted-foreground">{j.recebimento_previsto ? "previsto" : "recebido"}</span>
        </span>
      ) : (
        texto(null)
      ),
  },
  { chave: "prazo_recebimento", rotulo: "Prazo de recebimento", grupo: "Prazos", padrao: false, direita: true, celula: (j) => <Dias n={j.prazo_recebimento} nota="abertura → recebimento" /> },
  { chave: "prazo_pagamento", rotulo: "Prazo de pagamento", grupo: "Prazos", padrao: false, direita: true, celula: (j) => <Dias n={j.prazo_pagamento} nota="abertura → pagamento" /> },
  { chave: "nf", rotulo: "Nº da NF", grupo: "Faturamento", padrao: false, celula: (j) => <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">{j.numero_nf ?? "—"}</span> },
  {
    chave: "data_faturamento",
    rotulo: "Data de faturamento",
    grupo: "Faturamento",
    padrao: false,
    // Sem nota emitida, fica vazia. Com mais de uma, a da primeira.
    celula: (j) =>
      j.data_faturamento ? (
        <span className="flex flex-col gap-px">
          {dia(j.data_faturamento)}
          {j.notas_emitidas > 1 && <span className="text-[11px] text-muted-foreground">1ª de {j.notas_emitidas} notas</span>}
        </span>
      ) : null,
  },
  { chave: "empresa", rotulo: "Empresa", grupo: "Job", padrao: true, celula: (j) => texto(j.empresa_nome) },
  { chave: "regional", rotulo: "Regional", grupo: "Job", padrao: true, celula: (j) => texto(j.regional_nome) },
  { chave: "status", rotulo: "Status", grupo: "Job", padrao: true, celula: (j) => <CelulaStatus j={j} /> },
];

const COLUNAS_PADRAO = COLUNAS_DA_LISTA.filter((c) => c.padrao).map((c) => c.chave);

const GRUPOS_DO_EXIBIR: ColunaDaLista["grupo"][] = ["Job", "Pessoas", "Datas", "Valores", "Prazos", "Faturamento"];

/** O valor como o fluxo de caixa conta (o planejado até o realizado
 *  acontecer), com quanto já aconteceu embaixo. */
function ValorComRealizado({ valor: v, realizado }: { valor: number | null; realizado: number }) {
  return (
    <span className="flex flex-col items-end gap-px">
      {valor(v)}
      <span className="whitespace-nowrap text-[11px] text-muted-foreground">
        {v === null ? "" : realizado > 0 ? `realizado ${formatCurrency(realizado)}` : "planejado"}
      </span>
    </span>
  );
}

function Dias({ n, nota }: { n: number | null; nota: string }) {
  return (
    <span className="flex flex-col items-end gap-px">
      <span className="whitespace-nowrap font-mono text-[13px] font-semibold">{n === null ? "—" : `${n} dias`}</span>
      <span className="whitespace-nowrap text-[11px] text-muted-foreground">{nota}</span>
    </span>
  );
}

/** O projeto do job na visão "Por job": leva à visão agregada do projeto do
 *  financeiro (decisão do Tiago, 24/08/2026). Sem ele, o nome fica texto. */
function CelulaProjeto({ j }: { j: JobAberto }) {
  return j.projeto_financeiro_id ? (
    <Link
      href={`/financeiro/projetos/${j.projeto_financeiro_id}`}
      prefetch={false}
      onClick={(e) => e.stopPropagation()}
      className="text-[12px] font-semibold text-california-red hover:text-california-red/80"
    >
      {j.projeto_financeiro_nome ?? "—"}
    </Link>
  ) : (
    <span className="text-[12px] text-muted-foreground">{j.projeto_nome ?? "—"}</span>
  );
}

/** O "Exibir": as colunas da lista, por grupo. */
function SeletorDeColunas({ exibir, onMudar }: { exibir: Set<string>; onMudar: (s: Set<string>) => void }) {
  const ligadas = COLUNAS_DA_LISTA.filter((c) => exibir.has(c.chave)).length;
  const alternar = (chave: string) => {
    const x = new Set(exibir);
    if (x.has(chave)) x.delete(chave);
    else x.add(chave);
    onMudar(x);
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-california-red/40 hover:text-california-red"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Exibir
          <span className="tabular-nums text-muted-foreground/70">{ligadas}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[720px] p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold">Colunas da lista</p>
          <span className="flex items-center gap-3 text-[11.5px] font-semibold">
            <button type="button" className="text-muted-foreground hover:text-california-red" onClick={() => onMudar(new Set(COLUNAS_DA_LISTA.map((c) => c.chave)))}>
              Todas
            </button>
            <button type="button" className="text-muted-foreground hover:text-california-red" onClick={() => onMudar(new Set(COLUNAS_PADRAO))}>
              Padrão
            </button>
          </span>
        </div>
        <div className="grid grid-cols-3 gap-x-4 gap-y-3">
          {GRUPOS_DO_EXIBIR.map((g) => (
            <div key={g} className="space-y-1">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{g}</p>
              {COLUNAS_DA_LISTA.filter((c) => c.grupo === g).map((c) => (
                <label key={c.chave} className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-[12.5px] hover:bg-muted/60">
                  <Checkbox checked={exibir.has(c.chave)} onCheckedChange={() => alternar(c.chave)} className="rounded" />
                  <span className="flex-1 whitespace-nowrap">{c.rotulo}</span>
                  {c.soPorJob && <span className="shrink-0 text-[10px] text-muted-foreground">por job</span>}
                </label>
              ))}
            </div>
          ))}
        </div>
        <p className="mt-3 border-t border-border pt-2 text-[11px] text-muted-foreground">
          Código e nome ficam sempre. Com muitas colunas, a tabela rola para o lado.
        </p>
      </PopoverContent>
    </Popover>
  );
}

interface GrupoProjeto {
  /** Id do projeto DO FINANCEIRO (ou do de produção, no fallback). */
  projetoId: string;
  nome: string | null;
  /** Ordem padrão dos grupos: a criação do projeto. */
  criadoEm: string | null;
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

/** Nome do job; o status mora na coluna Status (decisão 248). */
function NomeDoJob({ j }: { j: JobAberto }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{j.nome}</span>
      </span>
      {j.nome_producao !== j.nome && (
        <span className="text-[11px] text-muted-foreground">
          produção: {j.nome_producao}
        </span>
      )}
    </div>
  );
}

/** O status do job na coluna Status, com o selo de sempre (decisão 087). O
 *  pedido de cancelamento no ar não muda o status: enquanto o cancelamento
 *  não é efetivado, o job continua aberto (decisão 248). */
function CelulaStatus({ j }: { j: JobAberto }) {
  const status = jobStatusExibido(j.status, null);
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.05em]",
        jobStatusBadgeClasses(status),
      )}
    >
      {jobStatusLabel(status)}
    </span>
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
  // As colunas ligadas no "Exibir" (decisão 248), guardadas por tela neste
  // navegador, como os filtros de coluna. Sem nada guardado, as do padrão.
  const [exibir, setExibirEstado] = React.useState<Set<string>>(() => new Set(COLUNAS_PADRAO));
  const chaveDoExibir = `${daTela.guardarEm}:exibir`;
  React.useEffect(() => {
    try {
      const salvo = window.localStorage.getItem(chaveDoExibir);
      if (!salvo) return;
      const conhecidas = new Set(COLUNAS_DA_LISTA.map((c) => c.chave));
      setExibirEstado(new Set((JSON.parse(salvo) as string[]).filter((k) => conhecidas.has(k))));
    } catch {
      // Sem acesso ao armazenamento do navegador: fica o padrão.
    }
  }, [chaveDoExibir]);
  const setExibir = (x: Set<string>) => {
    setExibirEstado(x);
    try {
      window.localStorage.setItem(chaveDoExibir, JSON.stringify([...x]));
    } catch {
      // Sem acesso: a escolha vale até recarregar.
    }
  };
  const colunasPorProjeto = COLUNAS_DA_LISTA.filter((c) => exibir.has(c.chave) && !c.soPorJob);
  const colunasPorJob = COLUNAS_DA_LISTA.filter((c) => exibir.has(c.chave));
  // Até 10 colunas cabe na largura de antes; cada uma a mais alarga a tabela,
  // e o quadro rola para o lado.
  const largura = (n: number, base: number) => base + Math.max(0, n - 10) * 130;

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
        nome: primeiro.projeto_financeiro_nome ?? primeiro.projeto_nome,
        criadoEm: primeiro.projeto_criado_em,
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
    // A criação do projeto: a mesma ordem que o código dava, sem ele.
    return out.sort((a, b) => (a.criadoEm ?? "").localeCompare(b.criadoEm ?? ""));
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

        <div className="flex basis-full items-center gap-2.5">
          {/* Só em "Por projeto", no canto esquerdo da linha: recolhe ou
              expande todas as faixas de uma vez (o mesmo botão das
              planilhas). Com filtro, as faixas ficam abertas de qualquer
              jeito, então o botão some. */}
          {modo === "projeto" && grupos.length > 0 && !filtroAtivo && (
            <span>
              <BotaoRecolherTodos
                algumAberto={grupos.some((g) => g.aberto)}
                onAlternarTodos={() =>
                  setFechados(grupos.some((g) => g.aberto) ? new Set(grupos.map((g) => g.projetoId)) : new Set())
                }
              />
            </span>
          )}
          <span className="flex-1" />
          <SeletorDeColunas exibir={exibir} onMudar={setExibir} />
          <span className="ml-2 text-[10px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
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
          <table style={{ minWidth: largura(colunasPorProjeto.length, 1320) }} className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/60 text-left text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
                <th className="w-8 px-2 py-3" aria-label="Expandir" />
                <th className="px-4 py-3 font-semibold">{colunas.titulo("codigo")}</th>
                <th className="px-4 py-3 font-semibold">{colunas.titulo("nome")}</th>
                {colunasPorProjeto.map((c) => (
                  <th key={c.chave} className={cn("px-4 py-3 font-semibold", c.direita && "text-right")}>
                    {colunas.titulo(c.chave)}
                  </th>
                ))}
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
                    <td colSpan={3 + colunasPorProjeto.length} className="p-0">
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
                        <td className="min-w-[240px] px-4 py-3">
                          <NomeDoJob j={j} />
                        </td>
                        {colunasPorProjeto.map((c) => (
                          <td key={c.chave} className={cn("px-4 py-3", c.direita && "text-right")}>
                            {c.celula(j)}
                          </td>
                        ))}
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
          <table style={{ minWidth: largura(colunasPorJob.length, 1180) }} className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/60 text-left text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
                <th className="px-4 py-3 font-semibold">{colunas.titulo("nome", undefined, "Job")}</th>
                {colunasPorJob.map((c) => (
                  <th key={c.chave} className={cn("px-4 py-3 font-semibold", c.direita && "text-right")}>
                    {colunas.titulo(c.chave)}
                  </th>
                ))}
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
                  <td className="min-w-[240px] px-4 py-3">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <NomeDoJob j={j} />
                      <span className="whitespace-nowrap font-mono text-[11.5px] font-semibold text-[#b3323c]">
                        {j.codigo}
                      </span>
                    </div>
                  </td>
                  {colunasPorJob.map((c) => (
                    <td key={c.chave} className={cn("px-4 py-3", c.direita && "text-right")}>
                      {c.celula(j)}
                    </td>
                  ))}
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
