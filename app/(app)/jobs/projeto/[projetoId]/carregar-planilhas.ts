import { createClient } from "@/lib/supabase/server";
import { calcularTotaisVersao } from "@/lib/calculos/versao-totais";
import {
  blocosDoItem,
  realizadoVemDasPPs,
  somarBlocosDosItens,
  type BvParaConta,
} from "@/lib/calculos/bv-planilha";
import { nomeDoJobNoFinanceiro, type JobStatus, type TipoCusto } from "@/lib/types";
import type {
  GrupoPlanilhaProjeto,
  ItemPlanilhaProjeto,
  JobPlanilhaProjeto,
} from "./tipos";

/**
 * Monta a planilha consolidada de um conjunto de jobs — um bloco por job,
 * com Orçado × Planejado × Realizado, pronto para `PlanilhaJobCard` e
 * `ProjetoTotaisCard`.
 *
 * Módulo próprio desde 21/08/2026, quando a visão agregada do projeto
 * ganhou uma versão no financeiro. As duas telas mostram a MESMA planilha
 * — o que muda é o recorte:
 *
 *   produção  — jobs de `jobs.projeto_id`, nome da produção
 *   financeiro — jobs de `jobs.projeto_financeiro_id`, nome do financeiro
 *
 * Quem decide o recorte é quem chama; aqui só chegam os ids. Duas cópias
 * desta montagem divergiriam na primeira errata.
 */
export async function carregarPlanilhasDosJobs(
  tenantId: string,
  jobIds: string[],
  opts: { usarNomeFinanceiro?: boolean } = {},
): Promise<JobPlanilhaProjeto[]> {
  if (jobIds.length === 0) return [];

  const supabase = createClient();

  const { data: jobsRaw, error: jobsErro } = await supabase
    .from("jobs")
    .select(
      "id, codigo, nome, nome_financeiro, status, versao_orcamento_aprovada_id, " +
        "responsavel:profiles!responsavel_id(nome), " +
        "versao:versoes_orcamento!versao_orcamento_aprovada_id(moeda, percentual_honorarios, percentual_imposto)",
    )
    .eq("tenant_id", tenantId)
    .in("id", jobIds)
    .order("codigo", { ascending: true });

  if (jobsErro) {
    console.error("[planilhas-do-projeto.jobs]", jobsErro.message);
    return [];
  }

  const jobs = (jobsRaw ?? []) as any[];
  if (jobs.length === 0) return [];

  const versaoIds = jobs.map((j) => j.versao_orcamento_aprovada_id);

  // Orçado vem da CÓPIA de cada job (`jobs_itens_orcado`), não da versão:
  // a errata altera a cópia, e a visão agregada precisa bater com a
  // Planilha Interna do job — a versão aprovada segue congelada.
  const [gruposRes, itensRes, realizadosRes, categoriasRes, bvsRes] =
    await Promise.all([
    supabase
      .from("versoes_orcamento_grupos")
      .select("id, nome, versao_orcamento_id, ordem")
      .eq("tenant_id", tenantId)
      .in("versao_orcamento_id", versaoIds)
      .order("ordem", { ascending: true }),
    supabase
      .from("jobs_itens_orcado")
      .select(
        "id, job_id, item_versao_id, grupo_id, ordem, item, tipo_custo, categoria_id, " +
          "valor_unitario_orcado, quantidade_orcada, dias_meses_orcado, total_orcado, " +
          "valor_unitario_planejado, quantidade_planejada, dias_meses_planejado, total_planejado, " +
          "bv_liquido_planejado, em_save, save_consumido",
      )
      .eq("tenant_id", tenantId)
      .in("job_id", jobIds)
      .order("ordem", { ascending: true }),
    supabase
      .from("jobs_itens_realizado")
      .select(
        "job_id, item_id, valor_unitario_realizado, quantidade_realizada, dias_meses_realizado, total_realizado",
      )
      .eq("tenant_id", tenantId)
      .in("job_id", jobIds),
    supabase.from("categorias").select("id, nome").eq("tenant_id", tenantId),
    // O BV entra na conta desde 21/08/2026: a vista Líquido desconta o
    // líquido dele do planejado e do realizado. Chaveado pelo item da
    // VERSÃO, que é a chave de `itens_bv`.
    supabase
      .from("itens_bv")
      .select(
        "item_versao_id, valor, situacao, item:versoes_orcamento_itens!inner(versao_orcamento_id)",
      )
      .eq("tenant_id", tenantId)
      .in("item.versao_orcamento_id", versaoIds)
      .neq("situacao", "cancelado"),
  ]);

  if (gruposRes.error) {
    console.error("[planilhas-do-projeto.grupos]", gruposRes.error.message);
  }
  if (itensRes.error) {
    console.error("[planilhas-do-projeto.orcado]", itensRes.error.message);
  }
  if (bvsRes.error) {
    console.error("[planilhas-do-projeto.bvs]", bvsRes.error.message);
  }

  const bvPorItemVersao = new Map<string, BvParaConta>(
    (bvsRes.data ?? []).map((b: any) => [
      b.item_versao_id as string,
      { valor: b.valor, situacao: b.situacao },
    ]),
  );

  const categoriasMap = new Map<string, string>();
  for (const c of (categoriasRes.data ?? []) as any[]) {
    categoriasMap.set(c.id, c.nome);
  }

  const gruposPorVersao = new Map<string, { id: string; nome: string }[]>();
  for (const g of (gruposRes.data ?? []) as any[]) {
    const arr = gruposPorVersao.get(g.versao_orcamento_id) ?? [];
    arr.push({ id: g.id, nome: g.nome });
    gruposPorVersao.set(g.versao_orcamento_id, arr);
  }

  const itensPorJob = new Map<string, any[]>();
  for (const it of (itensRes.data ?? []) as any[]) {
    const arr = itensPorJob.get(it.job_id) ?? [];
    arr.push(it);
    itensPorJob.set(it.job_id, arr);
  }

  // Chave por job + item da versão: `jobs_itens_realizado.item_id` aponta
  // pro item da versão, que se repete entre jobs de versões diferentes só
  // por acaso — o job_id evita qualquer cruzamento.
  const realizadosPorChave = new Map<
    string,
    { unit: number; qt: number; dm: number; total: number }
  >();
  for (const r of (realizadosRes.data ?? []) as any[]) {
    realizadosPorChave.set(`${r.job_id}/${r.item_id}`, {
      unit: num(r.valor_unitario_realizado),
      qt: num(r.quantidade_realizada),
      dm: num(r.dias_meses_realizado),
      total: num(r.total_realizado),
    });
  }

  return jobs.map((j) => {
    const itensDoJob = itensPorJob.get(j.id) ?? [];
    // Lida ANTES dos grupos: é ela que transforma o valor do BV em
    // líquido, e cada job tem a sua (a do orçamento aprovado dele).
    const aliquotaDoJob = num(j.versao?.percentual_imposto);
    // Job na fila de abertura não tem realizado nenhum — nem o do orçado
    // nas linhas `A` e `D`. Mesma regra da Planilha Interna.
    const jobAberto =
      j.status !== "aguardando_abertura" && j.status !== "rejeitado_financeiro";
    const gruposDaVersao =
      gruposPorVersao.get(j.versao_orcamento_aprovada_id) ?? [];

    const grupos: GrupoPlanilhaProjeto[] = gruposDaVersao.map((g) => {
      const itens: ItemPlanilhaProjeto[] = itensDoJob
        .filter((it) => it.grupo_id === g.id)
        .map((it) => {
          const real = realizadosPorChave.get(`${j.id}/${it.item_versao_id}`);
          const tipo = it.tipo_custo as TipoCusto;
          // Mesma função da Planilha Interna do job: a visão agregada não
          // pode ter uma segunda implementação da conta, ou ela e a tela
          // do job começam a divergir. Em `A` e `D` o realizado é o
          // ORÇADO — eles não geram PP.
          const blocos = blocosDoItem(
            {
              tipo_custo: tipo,
              total_orcado: it.total_orcado,
              total_planejado: it.total_planejado,
              bv_liquido_planejado: it.bv_liquido_planejado,
              // Sem isto a visão agregada contaria a linha em save na
              // rentabilidade e discordaria da Planilha Interna do job.
              em_save: it.em_save,
            },
            bvPorItemVersao.get(it.item_versao_id) ?? null,
            real?.total ?? 0,
            aliquotaDoJob,
            jobAberto,
          );
          // Linha em save não tem custo: nem PP, nem espelho do orçado.
          const emSave = it.em_save === true;
          const daPP = emSave || realizadoVemDasPPs(tipo) || !jobAberto;
          return {
            id: it.id,
            nome: it.item,
            tipo,
            categoria: it.categoria_id
              ? (categoriasMap.get(it.categoria_id) ?? null)
              : null,
            orcUnit: num(it.valor_unitario_orcado),
            orcQt: num(it.quantidade_orcada),
            orcDm: num(it.dias_meses_orcado),
            orcTotal: num(it.total_orcado),
            orcRentabilidade: blocos.orcadoRentabilidade,
            planUnit: num(it.valor_unitario_planejado),
            planQt: num(it.quantidade_planejada),
            planDm: num(it.dias_meses_planejado),
            // A quebra do realizado descreve as PPs; em `A` e `D`, que não
            // têm PP, ela espelha o orçado, como na planilha do job.
            realUnit: emSave ? 0 : daPP ? (real?.unit ?? 0) : num(it.valor_unitario_orcado),
            realQt: emSave ? 0 : daPP ? (real?.qt ?? 0) : num(it.quantidade_orcada),
            realDm: emSave ? 0 : daPP ? (real?.dm ?? 0) : num(it.dias_meses_orcado),
            planejado: blocos.planejado,
            realizado: blocos.realizado,
          };
        });

      const somaDoGrupo = somarBlocosDosItens(
        itens.map((i) => ({
          orcado: i.orcTotal,
          orcadoRentabilidade: i.orcRentabilidade,
          planejado: i.planejado,
          realizado: i.realizado,
        })),
      );

      return {
        id: g.id,
        nome: g.nome,
        itens,
        orcado: somaDoGrupo.orcado,
        orcadoRentabilidade: somaDoGrupo.orcadoRentabilidade,
        planejado: somaDoGrupo.planejado,
        realizado: somaDoGrupo.realizado,
      };
    });

    const percentualHonorarios = num(j.versao?.percentual_honorarios);
    const percentualImposto = num(j.versao?.percentual_imposto);

    // Mesma função da tela da versão e do card de Totais do job: o
    // fechamento do projeto é a soma dos fechamentos, não uma conta nova.
    const {
      subtotaisPorTipo,
      subtotalGeral,
      honorarios,
      imposto,
      faturamentoPrevisto,
      valorJob,
    } = calcularTotaisVersao(
      itensDoJob.map((it) => ({
        tipo_custo: it.tipo_custo as TipoCusto,
        total_orcado: num(it.total_orcado),
        // Sem os dois campos o fechamento voltaria a ser o de antes do
        // save: `valorJob` cheio e `faturamentoPrevisto` sem o crédito.
        em_save: it.em_save === true,
        save_consumido: num(it.save_consumido),
      })),
      percentualHonorarios,
      percentualImposto,
    );

    return {
      id: j.id,
      codigo: j.codigo,
      // No financeiro o bloco leva o nome do financeiro; na produção, o
      // dela. Mesmo contrato de `nome_financeiro` vs `nome`.
      nome: opts.usarNomeFinanceiro ? nomeDoJobNoFinanceiro(j) : j.nome,
      status: j.status as JobStatus,
      responsavel: j.responsavel?.nome ?? null,
      moeda: j.versao?.moeda ?? "BRL",
      percentualHonorarios,
      percentualImposto,
      grupos,
      orcado: subtotalGeral,
      ...(() => {
        const soma = somarBlocosDosItens(
          grupos.map((g) => ({
            orcado: g.orcado,
            orcadoRentabilidade: g.orcadoRentabilidade,
            planejado: g.planejado,
            realizado: g.realizado,
          })),
        );
        return {
          orcadoRentabilidade: soma.orcadoRentabilidade,
          planejado: soma.planejado,
          realizado: soma.realizado,
        };
      })(),
      subtotaisPorTipo,
      honorarios,
      imposto,
      faturamentoPrevisto,
      valorJob,
    };
  });
}

function num(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}
