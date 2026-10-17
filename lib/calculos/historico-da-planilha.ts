/**
 * O histórico de versões da Planilha Interna do job (decisão 186,
 * 17/10/2026): a planilha como ela estava depois de cada momento do job.
 *
 * Função pura, sem tabela nova: tudo sai do que o banco já guarda. A conta
 * anda de TRÁS PARA A FRENTE — parte da planilha de hoje (`jobs_itens_orcado`
 * e `jobs_grupos`) e desfaz cada momento, do mais novo ao mais antigo, com o
 * "de" que o histórico gravou:
 *   - alteração do financeiro (`jobs_alteracoes_financeiro_itens`): orçado,
 *     tipo e, desde 14/10/2026, o planejado;
 *   - errata (`jobs_erratas_itens`): alterada, nova, cancelada e a
 *     "removida" de antes da decisão 151, que apagava a linha — essa volta
 *     pela linha da versão aprovada que ficou sem cópia no job;
 *   - o save aprovado com a errata (`saves_aprovacoes.errata_id`): a linha
 *     sai do save e o planejado volta ao `planejado_antes_save`;
 *   - o pedido de save cancelado antes da decisão, ou recusado, quando ainda
 *     não contava para o financeiro: a linha sai do save sem errata;
 *   - a organização da errata (decisão 162, `jobs_erratas.estrutura`):
 *     agrupamento renomeado, novo, removido e item movido.
 * O envio para abertura e a abertura não mudam a planilha: são marcos.
 *
 * Limite conhecido: a ORDEM das linhas dentro do agrupamento antes de uma
 * errata que reorganizou é a da versão aprovada — a errata grava para onde
 * a linha foi, não a posição de onde ela saiu.
 *
 * Rodar o teste: `npm run test:historico-da-planilha`.
 */
import type {
  ErrataAcao,
  ItemPlanilhaJob,
  JobAlteracaoFinanceiroComItens,
  JobErrataComItens,
  JobGrupo,
  TipoCusto,
  VersaoOrcamentoGrupo,
} from "@/lib/types";

type Numero = number | string | null | undefined;

/** A linha do job como o histórico a lê (`jobs_itens_orcado`). */
export interface LinhaDoJobNoHistorico {
  id: string;
  item_versao_id: string | null;
  linha_vermelha: boolean | null;
  /** A âncora na versão aprovada. */
  grupo_id: string;
  /** O agrupamento do job (decisão 162) — o que a tela mostra. */
  job_grupo_id: string | null;
  ordem: Numero;
  item: string;
  tipo_custo: TipoCusto;
  categoria_id: string | null;
  valor_unitario_orcado: Numero;
  quantidade_orcada: Numero;
  dias_meses_orcado: Numero;
  valor_unitario_planejado: Numero;
  quantidade_planejada: Numero;
  dias_meses_planejado: Numero;
  bv_liquido_planejado: Numero;
  em_save: boolean | null;
  save_consumido: Numero;
  cancelada_em: string | null;
  planejado_antes_save: { valor_unitario: Numero; quantidade: Numero; dias_meses: Numero } | null;
}

/** A linha da versão aprovada (`versoes_orcamento_itens`): a ordem de antes
 *  da organização e a linha removida antes da decisão 151. */
export interface LinhaDaVersaoNoHistorico {
  id: string;
  grupo_id: string;
  ordem: Numero;
  item: string;
  tipo_custo: TipoCusto;
  categoria_id: string | null;
  valor_unitario_orcado: Numero;
  quantidade_orcada: Numero;
  dias_meses_orcado: Numero;
  valor_unitario_planejado: Numero;
  quantidade_planejada: Numero;
  dias_meses_planejado: Numero;
  bv_liquido_planejado: Numero;
  em_save: boolean | null;
}

/** O save aprovado (ou aguardando) junto com uma errata. */
export interface SaveDaErrataNoHistorico {
  errata_id: string;
  job_item_orcado_id: string | null;
}

/** O pedido de save que tirou a linha do save sem errata (decisão 099): o
 *  feito com o job aberto e cancelado antes da decisão, ou recusado. A
 *  errata que o pediu pôs a linha no save; este momento a tira. */
export interface SaveDesfeitoNoHistorico {
  id: string;
  job_item_orcado_id: string;
  item: string;
  grupo: string;
  como: "cancelado" | "recusado";
  quando: string;
  por: string | null;
}

/** O registro da abertura que revisou uma errata (`jobs_aberturas`). */
export interface RevisaoNoHistorico {
  errata_id: string;
  registrado_em: string;
  por: string | null;
}

export interface DadosDoHistorico {
  /** `versao_orcamento_id` dos agrupamentos montados — o da versão aprovada. */
  versaoAprovadaId: string;
  enviadoAberturaEm: string | null;
  enviadoAberturaPor: string | null;
  /** `jobs.data_abertura_financeiro`. */
  abertoEm: string | null;
  abertoPor: string | null;
  /** Sem momento nenhum, a planilha de hoje "nasce" aqui. */
  criadoEm: string;
  linhas: LinhaDoJobNoHistorico[];
  /** Todos os agrupamentos do job, os removidos inclusive. */
  grupos: JobGrupo[];
  linhasDaVersao: LinhaDaVersaoNoHistorico[];
  erratas: JobErrataComItens[];
  alteracoes: JobAlteracaoFinanceiroComItens[];
  saves: SaveDaErrataNoHistorico[];
  savesDesfeitos: SaveDesfeitoNoHistorico[];
  revisoes: RevisaoNoHistorico[];
}

export type TipoDoMomento = "envio" | "fila" | "abertura" | "errata" | "alteracao" | "save" | "atual";

export type AcaoNaLinha = ErrataAcao | "save" | "movida";

/** O que um momento fez numa linha, visto do depois. */
export interface MudancaNaLinha {
  /** Id da linha na planilha da versão; `null` na linha que saiu. */
  itemId: string | null;
  item: string;
  grupo: string;
  acao: AcaoNaLinha;
  orcadoDe: number | null;
  orcadoPara: number | null;
  planejadoDe: number | null;
  planejadoPara: number | null;
  tipoDe: TipoCusto | null;
  tipoPara: TipoCusto | null;
  /** A linha entrou no save (`false → true`) ou saiu dele; nulo quando o
   *  momento não mexeu no save. */
  saveDe: boolean | null;
  savePara: boolean | null;
  /** Só no item movido: o agrupamento de onde ele saiu. */
  grupoDe: string | null;
}

export interface VersaoDaPlanilha {
  chave: string;
  tipo: TipoDoMomento;
  /** "Errata", "Edição do financeiro na fila"… */
  rotulo: string;
  /** O texto da errata ou o motivo da alteração. */
  descricao: string | null;
  quando: string;
  autor: string | null;
  /** O registro da abertura que revisou a errata, quando houve. */
  revisao: { quando: string; autor: string | null } | null;
  itens: ItemPlanilhaJob[];
  grupos: VersaoOrcamentoGrupo[];
  mudancas: MudancaNaLinha[];
  /** O que a errata mudou nos agrupamentos, em texto. */
  estrutura: string[];
  /** O valor do job que o histórico gravou depois do momento. Serve para
   *  conferir a reconstrução; nulo nos marcos sem valor gravado. */
  valorJobGravado: number | null;
}

const num = (v: Numero) => (v === null || v === undefined ? 0 : Number(v));
const numOuNulo = (v: Numero) => (v === null || v === undefined ? null : Number(v));
const ehNulo = (v: unknown) => v === null || v === undefined;

function comTotais(l: ItemPlanilhaJob): ItemPlanilhaJob {
  return {
    ...l,
    total_orcado: l.valor_unitario_orcado * l.quantidade_orcada * l.dias_meses_orcado,
    total_planejado: l.valor_unitario_planejado * l.quantidade_planejada * l.dias_meses_planejado,
  };
}

/** A linha no formato da planilha — o mesmo de `carregar-detalhe.ts`. */
function paraLinha(o: {
  id: string;
  item_versao_id: string | null;
  linha_vermelha: boolean | null;
  grupo_id: string;
  ordem: Numero;
  item: string;
  tipo_custo: TipoCusto;
  categoria_id: string | null;
  valor_unitario_orcado: Numero;
  quantidade_orcada: Numero;
  dias_meses_orcado: Numero;
  valor_unitario_planejado: Numero;
  quantidade_planejada: Numero;
  dias_meses_planejado: Numero;
  bv_liquido_planejado: Numero;
  em_save: boolean | null;
  save_consumido: Numero;
  cancelada_em: string | null;
}): ItemPlanilhaJob {
  return comTotais({
    id: o.id,
    orcado_id: o.id,
    item_versao_id: o.item_versao_id,
    linha_vermelha: o.linha_vermelha === true,
    grupo_id: o.grupo_id,
    ordem: num(o.ordem),
    item: o.item,
    tipo_custo: o.tipo_custo,
    categoria_id: o.categoria_id,
    valor_unitario_orcado: num(o.valor_unitario_orcado),
    quantidade_orcada: ehNulo(o.quantidade_orcada) ? 1 : Number(o.quantidade_orcada),
    dias_meses_orcado: ehNulo(o.dias_meses_orcado) ? 1 : Number(o.dias_meses_orcado),
    total_orcado: 0,
    valor_unitario_planejado: num(o.valor_unitario_planejado),
    quantidade_planejada: num(o.quantidade_planejada),
    dias_meses_planejado: num(o.dias_meses_planejado),
    total_planejado: 0,
    bv_liquido_planejado: numOuNulo(o.bv_liquido_planejado),
    em_save: o.em_save === true,
    save_consumido: num(o.save_consumido),
    cancelada_em: o.cancelada_em,
    // A versão antiga fecha sobre ela mesma (decisão 175): sem foto da
    // abertura e sem o caso da linha que virou save depois dela.
    orcado_abertura: null,
    save_depois_da_abertura: false,
  });
}

function paraGrupo(g: JobGrupo, versaoAprovadaId: string): VersaoOrcamentoGrupo {
  return {
    id: g.id,
    tenant_id: g.tenant_id,
    versao_orcamento_id: versaoAprovadaId,
    nome: g.nome,
    ordem: g.ordem,
    mes_id: g.mes_id ?? null,
    meio: null,
    forma_compra: null,
    formato: null,
    created_at: g.created_at,
    updated_at: g.updated_at,
  };
}

interface Estado {
  itens: ItemPlanilhaJob[];
  grupos: VersaoOrcamentoGrupo[];
}

function copiar(e: Estado): Estado {
  return { itens: e.itens.map((i) => ({ ...i })), grupos: e.grupos.map((g) => ({ ...g })) };
}

function ordenado(e: Estado): Estado {
  return {
    itens: [...e.itens].sort((a, b) => a.ordem - b.ordem),
    grupos: [...e.grupos].sort((a, b) => a.ordem - b.ordem),
  };
}

function mudanca(m: Partial<MudancaNaLinha> & Pick<MudancaNaLinha, "item" | "grupo" | "acao">): MudancaNaLinha {
  return {
    itemId: null,
    orcadoDe: null,
    orcadoPara: null,
    planejadoDe: null,
    planejadoPara: null,
    tipoDe: null,
    tipoPara: null,
    saveDe: null,
    savePara: null,
    grupoDe: null,
    ...m,
  };
}

/** Um momento do job, do jeito que a reconstrução precisa dele. */
interface Momento {
  chave: string;
  tipo: Exclude<TipoDoMomento, "atual">;
  quando: string;
  autor: string | null;
  rotulo: string;
  descricao: string | null;
  revisao: VersaoDaPlanilha["revisao"];
  valorJobGravado: number | null;
  /** Recebe a planilha DEPOIS do momento e devolve a de ANTES, com o que
   *  mudou (visto do depois). */
  desfazer: (depois: Estado) => { antes: Estado; mudancas: MudancaNaLinha[]; estrutura: string[] };
}

const SEM_MUDANCA = (depois: Estado) => ({ antes: depois, mudancas: [], estrutura: [] });

/** A linha da errata que só pôs a linha no save ou a tirou dele: orçado e
 *  tipo iguais e o valor do job mudando. Nada mais faz isso — o planejado
 *  não entra no valor do job. */
function soMexeuNoSave(i: JobErrataComItens["itens"][number]): boolean {
  return (
    Math.round(num(i.total_de) * 100) === Math.round(num(i.total_para) * 100) &&
    i.tipo_custo_de === i.tipo_custo_para &&
    Math.round(num(i.efeito_valor_job) * 100) !== 0
  );
}

/** As versões da planilha, da mais nova (a atual) para a mais antiga. */
export function montarHistorico(d: DadosDoHistorico): VersaoDaPlanilha[] {
  const aberturaMs = d.abertoEm ? Date.parse(d.abertoEm) : null;
  const gruposPorId = new Map(d.grupos.map((g) => [g.id, g]));
  const grupoDoJobDaAncora = new Map(d.grupos.map((g) => [g.grupo_versao_id, g.id]));
  const linhaDaVersao = new Map(d.linhasDaVersao.map((v) => [v.id, v]));
  const linhaDeHoje = new Map(d.linhas.map((l) => [l.id, l]));
  const revisaoDaErrata = new Map(
    d.revisoes.map((r) => [r.errata_id, { quando: r.registrado_em, autor: r.por }]),
  );
  const savesDaErrata = new Map<string, Set<string>>();
  for (const s of d.saves) {
    if (!s.job_item_orcado_id) continue;
    const linhas = savesDaErrata.get(s.errata_id) ?? new Set<string>();
    linhas.add(s.job_item_orcado_id);
    savesDaErrata.set(s.errata_id, linhas);
  }
  const nomeDoGrupo = (e: Estado, id: string) =>
    e.grupos.find((g) => g.id === id)?.nome ?? gruposPorId.get(id)?.nome ?? "—";
  const ordemDaVersao = (l: ItemPlanilhaJob) => {
    const v = l.item_versao_id ? linhaDaVersao.get(l.item_versao_id) : undefined;
    return v ? num(v.ordem) : l.ordem;
  };

  const momentos: Momento[] = [];

  if (d.enviadoAberturaEm) {
    momentos.push({
      chave: "envio",
      tipo: "envio",
      quando: d.enviadoAberturaEm,
      autor: d.enviadoAberturaPor,
      rotulo: "Enviado para abertura",
      descricao: null,
      revisao: null,
      valorJobGravado: null,
      desfazer: SEM_MUDANCA,
    });
  }

  for (const a of d.alteracoes) {
    const naFila = aberturaMs === null || Date.parse(a.created_at) < aberturaMs;
    momentos.push({
      chave: `alteracao-${a.id}`,
      tipo: naFila ? "fila" : "alteracao",
      quando: a.created_at,
      autor: a.autor_nome,
      rotulo: naFila ? "Edição do financeiro na fila" : "Alteração do financeiro",
      descricao: a.motivo || null,
      revisao: null,
      valorJobGravado: numOuNulo(a.valor_job_depois),
      desfazer: (depois) => {
        const antes = copiar(depois);
        const mudancas: MudancaNaLinha[] = [];
        for (const i of a.itens) {
          const l = antes.itens.find((x) => x.id === i.job_item_orcado_id);
          if (!l) continue;
          const para = { orcado: l.total_orcado, planejado: l.total_planejado, tipo: l.tipo_custo };
          l.valor_unitario_orcado = num(i.valor_unitario_de);
          l.quantidade_orcada = num(i.quantidade_de);
          l.dias_meses_orcado = num(i.dias_meses_de);
          l.tipo_custo = i.tipo_custo;
          // Antes de 14/10/2026 a alteração não guardava o planejado (e o
          // financeiro não o editava): fica o que a linha tem.
          if (!ehNulo(i.total_planejado_de)) {
            l.valor_unitario_planejado = num(i.valor_unitario_planejado_de);
            l.quantidade_planejada = num(i.quantidade_planejada_de);
            l.dias_meses_planejado = num(i.dias_meses_planejado_de);
          }
          Object.assign(l, comTotais(l));
          mudancas.push(
            mudanca({
              itemId: l.id,
              item: l.item,
              grupo: nomeDoGrupo(depois, l.grupo_id),
              acao: "alterada",
              orcadoDe: l.total_orcado,
              orcadoPara: para.orcado,
              planejadoDe: l.total_planejado,
              planejadoPara: para.planejado,
              tipoDe: l.tipo_custo,
              tipoPara: para.tipo,
            }),
          );
        }
        return { antes, mudancas, estrutura: [] };
      },
    });
  }

  if (d.abertoEm) {
    momentos.push({
      chave: "abertura",
      tipo: "abertura",
      quando: d.abertoEm,
      autor: d.abertoPor,
      rotulo: "Job aberto no financeiro",
      descricao: null,
      revisao: null,
      valorJobGravado: null,
      desfazer: SEM_MUDANCA,
    });
  }

  for (const e of d.erratas) {
    const saves = savesDaErrata.get(e.id) ?? new Set<string>();
    // "Errata de save": todas as linhas dela só entraram no save ou saíram
    // dele (pelo pedido ligado ou pelo efeito gravado, como no desfazer).
    const soSave =
      e.itens.length > 0 &&
      e.itens.every(
        (i) =>
          (i.job_item_orcado_id !== null && saves.has(i.job_item_orcado_id)) ||
          (i.acao === "alterada" && soMexeuNoSave(i)),
      );
    momentos.push({
      chave: `errata-${e.id}`,
      tipo: "errata",
      quando: e.created_at,
      autor: e.autor_nome,
      rotulo: soSave ? "Errata de save" : "Errata",
      descricao: e.titulo || null,
      revisao: revisaoDaErrata.get(e.id) ?? null,
      valorJobGravado: numOuNulo(e.valor_job_depois),
      desfazer: (depois) => {
        let antes = copiar(depois);
        const mudancas: MudancaNaLinha[] = [];
        const estrutura: string[] = [];

        // ---- A organização (decisão 162): primeiro os agrupamentos voltam
        // (o renomeado ao nome de antes, o removido volta, o novo sai), depois
        // os itens voltam ao agrupamento de antes, pelo nome de antes.
        const passos = e.estrutura ?? [];
        if (passos.length > 0) {
          for (const p of passos) {
            if (p.tipo === "grupo_renomeado") {
              const g = antes.grupos.find((x) => x.id === p.chave);
              if (g) g.nome = p.de;
              estrutura.push(`Agrupamento "${p.de}" renomeado para "${p.para}"`);
            } else if (p.tipo === "grupo_removido") {
              const g = gruposPorId.get(p.chave);
              if (g && !antes.grupos.some((x) => x.id === g.id)) antes.grupos.push(paraGrupo(g, d.versaoAprovadaId));
              estrutura.push(`Agrupamento "${p.nome}" ficou vazio e saiu`);
            } else if (p.tipo === "grupo_novo") {
              const criado = d.grupos.find((g) => g.criado_na_errata_id === e.id && g.nome === p.nome);
              if (criado) antes.grupos = antes.grupos.filter((g) => g.id !== criado.id);
              estrutura.push(`Agrupamento "${p.nome}" criado`);
            }
          }
          for (const p of passos) {
            if (p.tipo !== "item_movido") continue;
            const l = antes.itens.find((x) => x.id === p.chave);
            const g = antes.grupos.find((x) => x.nome === p.de);
            if (l && g) l.grupo_id = g.id;
            mudancas.push(
              mudanca({ itemId: p.chave, item: p.item, grupo: p.para, grupoDe: p.de, acao: "movida" }),
            );
          }
          antes.itens = antes.itens.map((l) => ({ ...l, ordem: ordemDaVersao(l) }));
        }

        // ---- As linhas
        for (const i of e.itens) {
          const id = i.job_item_orcado_id;
          if (i.acao === "nova") {
            // A linha nova que uma errata de antes da decisão 151 apagou depois
            // perdeu o id (a chave foi a nulo com ela): é a que a remoção, já
            // desfeita, devolveu com o mesmo nome.
            const alvo =
              id ??
              antes.itens.find((x) => x.id.startsWith("removida-") && x.item === i.item_nome)?.id ??
              null;
            const l = (alvo ? antes.itens.find((x) => x.id === alvo) : undefined) ?? depois.itens.find((x) => x.id === id);
            antes.itens = antes.itens.filter((x) => x.id !== alvo);
            mudancas.push(
              mudanca({
                itemId: alvo,
                item: i.item_nome,
                grupo: i.grupo_nome,
                acao: "nova",
                orcadoPara: l ? l.total_orcado : num(i.total_para),
                planejadoPara: l ? l.total_planejado : numOuNulo(i.total_planejado_para),
                tipoPara: i.tipo_custo_para,
              }),
            );
            continue;
          }
          if (i.acao === "removida") {
            // Antes da decisão 151 a linha era apagada: volta pela linha da
            // versão aprovada que ficou sem cópia no job, ou pelo "de" que a
            // errata gravou.
            const usadas = new Set(antes.itens.map((x) => x.item_versao_id).filter(Boolean));
            const daVersao = d.linhasDaVersao.find(
              (v) => !usadas.has(v.id) && v.item === i.item_nome && grupoDoJobDaAncora.has(v.grupo_id),
            );
            const l = daVersao
              ? paraLinha({
                  ...daVersao,
                  id: `removida-${e.id}-${daVersao.id}`,
                  item_versao_id: daVersao.id,
                  linha_vermelha: false,
                  grupo_id: grupoDoJobDaAncora.get(daVersao.grupo_id) ?? daVersao.grupo_id,
                  save_consumido: 0,
                  cancelada_em: null,
                })
              : paraLinha({
                  id: `removida-${e.id}-${i.id}`,
                  item_versao_id: null,
                  linha_vermelha: i.linha_vermelha,
                  grupo_id: (i.grupo_id && grupoDoJobDaAncora.get(i.grupo_id)) ?? i.grupo_id ?? "",
                  // Sem a posição de onde saiu: entra no fim do agrupamento.
                  ordem: Number.MAX_SAFE_INTEGER,
                  item: i.item_nome,
                  tipo_custo: i.tipo_custo_de,
                  categoria_id: null,
                  valor_unitario_orcado: i.valor_unitario_de,
                  quantidade_orcada: i.quantidade_de,
                  dias_meses_orcado: i.dias_meses_de,
                  valor_unitario_planejado: i.valor_unitario_planejado_de,
                  quantidade_planejada: i.quantidade_planejada_de,
                  dias_meses_planejado: i.dias_meses_planejado_de,
                  bv_liquido_planejado: null,
                  em_save: false,
                  save_consumido: 0,
                  cancelada_em: null,
                });
            antes.itens.push(l);
            mudancas.push(
              mudanca({
                item: i.item_nome,
                grupo: i.grupo_nome,
                acao: "removida",
                orcadoDe: l.total_orcado,
                orcadoPara: 0,
                planejadoDe: l.total_planejado,
                planejadoPara: 0,
                tipoDe: l.tipo_custo,
              }),
            );
            continue;
          }
          const l = antes.itens.find((x) => x.id === id);
          if (!l) continue;
          const para = { orcado: l.total_orcado, planejado: l.total_planejado, tipo: l.tipo_custo, save: l.em_save };
          if (i.acao === "cancelada") l.cancelada_em = null;
          l.valor_unitario_orcado = num(i.valor_unitario_de);
          // Antes de 27/08/2026 a errata não mexia em QT e D/M.
          if (!ehNulo(i.quantidade_de)) l.quantidade_orcada = num(i.quantidade_de);
          if (!ehNulo(i.dias_meses_de)) l.dias_meses_orcado = num(i.dias_meses_de);
          l.tipo_custo = i.tipo_custo_de;
          // Antes de 07/09/2026 a errata não mexia no planejado.
          if (!ehNulo(i.total_planejado_de)) {
            l.valor_unitario_planejado = num(i.valor_unitario_planejado_de);
            l.quantidade_planejada = num(i.quantidade_planejada_de);
            l.dias_meses_planejado = num(i.dias_meses_planejado_de);
          }
          // A linha que entrou no save com a errata (ou saiu dele). O save
          // aprovado com ela diz isso pelo pedido (`saves_aprovacoes`); os
          // de antes da decisão 099 e os que entraram e saíram, pelo efeito
          // que a errata gravou: orçado e tipo iguais e o valor do job
          // mudando só podem ser o save — o planejado não entra no valor do
          // job. O planejado volta ao de antes do save.
          const efeito = Math.round(num(i.efeito_valor_job) * 100);
          const virouSave = (id !== null && saves.has(id)) || (soMexeuNoSave(i) && efeito < 0);
          const saiuDoSave = !virouSave && soMexeuNoSave(i) && efeito > 0;
          if (saiuDoSave) l.em_save = true;
          if (virouSave) {
            l.em_save = false;
            const antesDoSave = linhaDeHoje.get(l.id)?.planejado_antes_save;
            if (antesDoSave) {
              l.valor_unitario_planejado = num(antesDoSave.valor_unitario);
              l.quantidade_planejada = num(antesDoSave.quantidade);
              l.dias_meses_planejado = num(antesDoSave.dias_meses);
            }
          }
          Object.assign(l, comTotais(l));
          mudancas.push(
            mudanca({
              itemId: l.id,
              item: i.item_nome,
              grupo: i.grupo_nome,
              acao: virouSave ? "save" : i.acao === "cancelada" ? "cancelada" : "alterada",
              orcadoDe: l.total_orcado,
              orcadoPara: para.orcado,
              planejadoDe: l.total_planejado,
              planejadoPara: para.planejado,
              tipoDe: l.tipo_custo,
              tipoPara: para.tipo,
              saveDe: l.em_save !== para.save ? l.em_save : null,
              savePara: l.em_save !== para.save ? para.save : null,
            }),
          );
        }
        antes = ordenado(antes);
        return { antes, mudancas, estrutura };
      },
    });
  }

  for (const s of d.savesDesfeitos) {
    momentos.push({
      chave: `save-${s.id}`,
      tipo: "save",
      quando: s.quando,
      autor: s.por,
      rotulo: s.como === "recusado" ? "Save recusado pelo financeiro" : "Pedido de save cancelado",
      descricao: null,
      revisao: null,
      valorJobGravado: null,
      desfazer: (depois) => {
        const antes = copiar(depois);
        const l = antes.itens.find((x) => x.id === s.job_item_orcado_id);
        if (!l || l.em_save) return { antes: depois, mudancas: [], estrutura: [] };
        l.em_save = true;
        return {
          antes,
          mudancas: [
            mudanca({
              itemId: l.id,
              item: s.item || l.item,
              grupo: s.grupo || nomeDoGrupo(depois, l.grupo_id),
              acao: "alterada",
              orcadoDe: l.total_orcado,
              orcadoPara: l.total_orcado,
              planejadoDe: l.total_planejado,
              planejadoPara: l.total_planejado,
              tipoDe: l.tipo_custo,
              tipoPara: l.tipo_custo,
              saveDe: true,
              savePara: false,
            }),
          ],
          estrutura: [],
        };
      },
    });
  }

  // Dois momentos no mesmo instante ficam na ordem em que foram listados
  // (o envio antes da edição na fila, a abertura antes da errata).
  momentos.sort((a, b) => Date.parse(a.quando) - Date.parse(b.quando));

  let estado: Estado = ordenado({
    itens: d.linhas.map((l) => paraLinha({ ...l, grupo_id: l.job_grupo_id ?? l.grupo_id })),
    grupos: d.grupos.filter((g) => !g.removido_em).map((g) => paraGrupo(g, d.versaoAprovadaId)),
  });
  const atual: VersaoDaPlanilha = {
    chave: "atual",
    tipo: "atual",
    rotulo: "Planilha atual",
    descricao: null,
    quando: momentos.length > 0 ? momentos[momentos.length - 1].quando : d.criadoEm,
    autor: null,
    revisao: null,
    itens: estado.itens,
    grupos: estado.grupos,
    mudancas: [],
    estrutura: [],
    valorJobGravado: null,
  };
  const anteriores: VersaoDaPlanilha[] = [];
  for (let k = momentos.length - 1; k >= 0; k--) {
    const m = momentos[k];
    const { antes, mudancas, estrutura } = m.desfazer(estado);
    anteriores.push({
      chave: m.chave,
      tipo: m.tipo,
      rotulo: m.rotulo,
      descricao: m.descricao,
      quando: m.quando,
      autor: m.autor,
      revisao: m.revisao,
      itens: estado.itens,
      grupos: estado.grupos,
      mudancas,
      estrutura,
      valorJobGravado: m.valorJobGravado,
    });
    estado = antes;
  }
  return [atual, ...anteriores];
}
