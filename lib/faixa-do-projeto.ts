/**
 * Faixa do projeto — decisão 106.
 *
 * As abas que levam da visão agregada a cada orçamento ou job do mesmo
 * projeto, acima das abas que cada tela já tinha. Aqui mora só o que é
 * regra: quais itens entram e para onde cada aba leva. O desenho está em
 * `components/faixa-do-projeto.tsx`.
 */

import { compararCodigosDeJob } from "@/lib/codigos/jobs";

export type ModuloDaFaixa = "orcamentos" | "jobs" | "financeiro";

/** Id da primeira aba, a da visão agregada. Nenhum uuid colide com ele. */
export const AGREGADA = "agregada";

/** `ativo` da página do projeto em Orçamentos (05/10/2026): a faixa aparece
 *  nela com o chip do projeto marcado. A página não é aba da faixa — o
 *  voltar de um orçamento continua levando a ela. */
export const PAGINA_DO_PROJETO = "projeto";

export interface ItemDaFaixa {
  id: string;
  /** Código mostrado na aba: o do job, nas abas de job. Nas de orçamento é
   *  `null` — o código do orçamento é só da base de dados e confundia a
   *  produção, que fala pelo código do job (29/09/2026). */
  codigo: string | null;
  nome: string;
  /** Rota da tela do item, sem query: a aba de seção entra no clique. */
  href: string;
  /** Orçamento aprovado ou com job: a agregada o mostra "Somente leitura". */
  travado: boolean;
  emRevisao: boolean;
}

/**
 * Abas de seção da página do job em cada módulo — as chaves do `?aba=`.
 * Fora destas, o valor da URL não é repassado.
 */
const ABAS_DO_JOB: Record<"jobs" | "financeiro", readonly string[]> = {
  jobs: ["info", "planilha", "pps", "chat"],
  financeiro: ["abertura", "info", "planilha", "fluxo", "chat"],
};

/** Aba em que a página do job abre sem `?aba=` — não precisa ir no link. */
const ABA_PADRAO: Record<"jobs" | "financeiro", string> = {
  jobs: "info",
  financeiro: "abertura",
};

/**
 * Para onde leva uma aba da faixa, dado onde a pessoa está agora.
 *
 * - Entre jobs, a aba de seção se mantém: quem está na Planilha Interna do
 *   JOB-0042 cai na Planilha Interna do JOB-0044.
 * - Da agregada para um job, abre na Planilha Interna (decisão do Tiago,
 *   25/09/2026), nos dois módulos. No Financeiro, se a agregada estiver no
 *   Fluxo de Caixa do Projeto, o job abre no Fluxo de Caixa do Job; e a
 *   volta de um job no fluxo cai na agregada no fluxo.
 * - Em Jobs, o `?from=jobs` acompanha: é ele que faz o voltar do job levar
 *   à lista de jobs, e não ao orçamento.
 * - Orçamentos não têm aba de seção a manter: o link é a rota do item.
 */
export function destinoDaAba(args: {
  modulo: ModuloDaFaixa;
  /** Id do item clicado, ou `AGREGADA`. */
  alvo: string;
  /** Id do item aberto agora, ou `AGREGADA`. */
  ativo: string;
  href: string;
  /** `?aba=` da URL atual. */
  abaAtual: string | null;
  /** `?from=` da URL atual. */
  from: string | null;
}): string {
  const { modulo, alvo, ativo, href, abaAtual, from } = args;
  if (modulo === "orcamentos") return href;

  const params = new URLSearchParams();

  if (alvo === AGREGADA) {
    if (modulo === "financeiro" && abaAtual === "fluxo") params.set("aba", "fluxo");
    return comQuery(href, params);
  }

  if (modulo === "jobs" && (ativo === AGREGADA || from === "jobs")) {
    params.set("from", "jobs");
  }

  let aba: string | null;
  if (ativo === AGREGADA) {
    aba = modulo === "financeiro" && abaAtual === "fluxo" ? "fluxo" : "planilha";
  } else {
    aba =
      abaAtual && ABAS_DO_JOB[modulo].includes(abaAtual) ? abaAtual : null;
  }
  if (aba && aba !== ABA_PADRAO[modulo]) params.set("aba", aba);

  return comQuery(href, params);
}

function comQuery(href: string, params: URLSearchParams): string {
  const q = params.toString();
  return q ? `${href}?${q}` : href;
}

/**
 * Orçamentos do projeto como abas. Entram os mesmos da visão agregada —
 * todos, menos arquivados (decisão 118), cancelados e recusados —, e o
 * aberto na tela sempre, para a faixa nunca ficar sem a aba marcada.
 */
export function itensDeOrcamentos(
  projetoId: string,
  orcamentos: Array<{
    id: string;
    codigo: string;
    nome: string;
    status: string;
    arquivado_em: string | null;
  }>,
  atualId: string | null,
): ItemDaFaixa[] {
  return orcamentos
    .filter(
      (o) =>
        o.id === atualId ||
        (!o.arquivado_em && o.status !== "cancelado" && o.status !== "recusado"),
    )
    // A ordem segue a do código (a de criação), mesmo sem mostrá-lo.
    .sort((a, b) => a.codigo.localeCompare(b.codigo))
    .map((o) => ({
      id: o.id,
      codigo: null,
      nome: o.nome,
      href: `/orcamentos/${projetoId}/${o.id}`,
      travado: o.status === "aprovado" || o.status === "job_criado",
      emRevisao: o.status === "em_revisao",
    }));
}

/**
 * Jobs do projeto como abas. Cada módulo diz quais entram — os mesmos da
 * agregada dele — e o job aberto na tela entra sempre.
 */
export function itensDeJobs(
  base: "/jobs/" | "/financeiro/jobs/",
  jobs: Array<{ id: string; codigo: string; nome: string; status: string }>,
  atualId: string | null,
  entra: (status: string) => boolean,
): ItemDaFaixa[] {
  return jobs
    .filter((j) => j.id === atualId || entra(j.status))
    // Ano e número do código (decisão 114): no texto puro, o AMB-0001/27
    // viria antes do AMB-1005/26 na virada do ano.
    .sort((a, b) => compararCodigosDeJob(a.codigo, b.codigo))
    .map((j) => ({
      id: j.id,
      codigo: j.codigo,
      nome: j.nome,
      href: `${base}${j.id}`,
      travado: false,
      emRevisao: false,
    }));
}
