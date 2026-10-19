"use server";

/**
 * A leitura do histórico de versões da Planilha Interna (decisão 186,
 * 17/10/2026). Só roda quando alguém abre o "Histórico": a página do job não
 * paga nada por ele. Traz o que a reconstrução precisa — a planilha de hoje
 * com o que as linhas guardam, os agrupamentos (os removidos inclusive), a
 * versão aprovada, as erratas, as alterações do financeiro, os saves que
 * vieram com errata e os registros da abertura que revisaram erratas — e a
 * conta (`montarHistorico`) roda no navegador.
 *
 * Só leitura, pelo cliente do usuário: a RLS de cada tabela decide o que ele
 * vê, a mesma que já decide a planilha (o freelancer, só no projeto dele).
 */

import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type {
  ErrataAcao,
  JobAlteracaoFinanceiroComItens,
  JobErrataComItens,
  JobGrupo,
  MudancaDeEstrutura,
  TipoCusto,
} from "@/lib/types";
import type {
  DadosDoHistorico,
  LinhaDaVersaoNoHistorico,
  LinhaDoJobNoHistorico,
} from "@/lib/calculos/historico-da-planilha";

export type ResultadoDoHistorico = { ok: true; dados: DadosDoHistorico } | { ok: false; message: string };

const ERRO = "Não foi possível carregar o histórico da planilha. Tente de novo.";

const COLUNAS_DA_LINHA =
  "id, item_versao_id, linha_vermelha, grupo_id, job_grupo_id, ordem, item, tipo_custo, categoria_id, " +
  "valor_unitario_orcado, quantidade_orcada, dias_meses_orcado, " +
  "valor_unitario_planejado, quantidade_planejada, dias_meses_planejado, " +
  "bv_liquido_planejado, em_save, save_consumido, cancelada_em, planejado_antes_save";

const COLUNAS_DA_VERSAO =
  "id, grupo_id, ordem, item, tipo_custo, categoria_id, " +
  "valor_unitario_orcado, quantidade_orcada, dias_meses_orcado, " +
  "valor_unitario_planejado, quantidade_planejada, dias_meses_planejado, " +
  "bv_liquido_planejado, em_save";

const num = (v: unknown) => Number(v ?? 0);
const numOuNulo = (v: unknown) => (v === null || v === undefined ? null : Number(v));

interface ErrataBruta {
  id: string;
  tenant_id: string;
  job_id: string;
  titulo: string;
  custo_orcado_antes: unknown;
  custo_orcado_depois: unknown;
  valor_job_antes: unknown;
  valor_job_depois: unknown;
  faturamento_previsto_antes: unknown;
  faturamento_previsto_depois: unknown;
  created_by: string | null;
  created_at: string;
  preparada_por: string | null;
  estrutura: MudancaDeEstrutura[] | null;
  autor: { nome: string | null } | null;
  itens: Array<Record<string, unknown> & { acao: ErrataAcao; tipo_custo_de: TipoCusto; tipo_custo_para: TipoCusto }>;
}

interface AlteracaoBruta {
  id: string;
  tenant_id: string;
  job_id: string;
  motivo: string;
  valor_job_antes: unknown;
  valor_job_depois: unknown;
  created_by: string | null;
  created_at: string;
  autor: { nome: string | null } | null;
  itens: Array<Record<string, unknown> & { tipo_custo: TipoCusto; tipo_custo_para: TipoCusto }>;
}

export async function carregarHistoricoDaPlanilha(jobId: unknown): Promise<ResultadoDoHistorico> {
  const id = z.string().uuid().safeParse(jobId);
  if (!id.success) return { ok: false, message: "Job não encontrado." };
  const session = await requireSession();
  const tenantId = session.activeTenant.id;
  const supabase = createClient();

  const { data: job, error: erroJob } = await supabase
    .from("jobs")
    .select(
      "id, created_at, versao_orcamento_aprovada_id, enviado_abertura_em, enviado_abertura_por, data_abertura_financeiro, aberto_por",
    )
    .eq("id", id.data)
    .eq("tenant_id", tenantId)
    .maybeSingle<{
      id: string;
      created_at: string;
      versao_orcamento_aprovada_id: string;
      enviado_abertura_em: string | null;
      enviado_abertura_por: string | null;
      data_abertura_financeiro: string | null;
      aberto_por: string | null;
    }>();
  if (erroJob) console.error("[job.historico.job]", erroJob.message);
  if (!job) return { ok: false, message: "Job não encontrado." };

  const [linhasRes, gruposRes, versaoRes, erratasRes, alteracoesRes, savesRes, desfeitosRes, revisoesRes] = await Promise.all([
    supabase
      .from("jobs_itens_orcado")
      .select(COLUNAS_DA_LINHA)
      .eq("job_id", job.id)
      .eq("tenant_id", tenantId)
      .returns<LinhaDoJobNoHistorico[]>(),
    supabase
      .from("jobs_grupos")
      .select("*")
      .eq("job_id", job.id)
      .eq("tenant_id", tenantId)
      .returns<JobGrupo[]>(),
    supabase
      .from("versoes_orcamento_itens")
      .select(COLUNAS_DA_VERSAO)
      .eq("versao_orcamento_id", job.versao_orcamento_aprovada_id)
      .eq("tenant_id", tenantId)
      .returns<LinhaDaVersaoNoHistorico[]>(),
    supabase
      .from("jobs_erratas")
      .select(
        "id, tenant_id, job_id, titulo, custo_orcado_antes, custo_orcado_depois, valor_job_antes, valor_job_depois, " +
          "faturamento_previsto_antes, faturamento_previsto_depois, created_by, created_at, preparada_por, estrutura, " +
          "autor:profiles!created_by(nome), itens:jobs_erratas_itens(*)",
      )
      .eq("job_id", job.id)
      .eq("tenant_id", tenantId)
      .returns<ErrataBruta[]>(),
    supabase
      .from("jobs_alteracoes_financeiro")
      .select(
        "id, tenant_id, job_id, motivo, valor_job_antes, valor_job_depois, created_by, created_at, " +
          "autor:profiles!created_by(nome), itens:jobs_alteracoes_financeiro_itens(*)",
      )
      .eq("job_id", job.id)
      .eq("tenant_id", tenantId)
      .returns<AlteracaoBruta[]>(),
    // Só o save que GERA e que chegou a valer (aprovado, ou aguardando a
    // decisão): o retirado e o recusado deixaram a linha como estava.
    supabase
      .from("saves_aprovacoes")
      .select("errata_id, job_item_orcado_id")
      .eq("job_id", job.id)
      .eq("tenant_id", tenantId)
      .eq("tipo", "gera")
      .in("situacao", ["aprovado", "aguardando"])
      .not("errata_id", "is", null)
      .returns<Array<{ errata_id: string; job_item_orcado_id: string | null }>>(),
    // O pedido de save feito com o job aberto que saiu sem errata: cancelado
    // antes da decisão, ou recusado (o recusado depois arquivado fica como
    // "retirado", com a justificativa da recusa). O aprovado e depois
    // retirado tem errata própria e fica de fora.
    supabase
      .from("saves_aprovacoes")
      .select(
        "id, job_item_orcado_id, item_descricao, grupo_nome, situacao, justificativa, decidido_em, decidido_por, retirado_em, retirado_por",
      )
      .eq("job_id", job.id)
      .eq("tenant_id", tenantId)
      .eq("tipo", "gera")
      .eq("momento", "job_aberto")
      .in("situacao", ["retirado", "recusado"])
      .not("job_item_orcado_id", "is", null)
      .returns<
        Array<{
          id: string;
          job_item_orcado_id: string;
          item_descricao: string | null;
          grupo_nome: string | null;
          situacao: "retirado" | "recusado";
          justificativa: string | null;
          decidido_em: string | null;
          decidido_por: string | null;
          retirado_em: string | null;
          retirado_por: string | null;
        }>
      >(),
    supabase
      .from("jobs_aberturas")
      .select("errata_id, registrado_em, registrado_por")
      .eq("job_id", job.id)
      .eq("tenant_id", tenantId)
      .not("errata_id", "is", null)
      .order("registrado_em", { ascending: true })
      .returns<Array<{ errata_id: string; registrado_em: string; registrado_por: string | null }>>(),
  ]);
  const erros = [linhasRes, gruposRes, versaoRes, erratasRes, alteracoesRes, savesRes, desfeitosRes, revisoesRes]
    .map((r) => r.error?.message)
    .filter(Boolean);
  if (erros.length > 0) {
    console.error("[job.historico]", erros.join(" | "));
    return { ok: false, message: ERRO };
  }

  type Desfeito = {
    id: string;
    job_item_orcado_id: string;
    item_descricao: string | null;
    grupo_nome: string | null;
    como: "cancelado" | "recusado";
    quando: string;
    por: string | null;
  };
  const desfeitos = (desfeitosRes.data ?? []).flatMap((s): Desfeito[] => {
    const base = {
      id: s.id,
      job_item_orcado_id: s.job_item_orcado_id,
      item_descricao: s.item_descricao,
      grupo_nome: s.grupo_nome,
    };
    if (s.decidido_em !== null && (s.situacao === "recusado" || !!s.justificativa))
      return [{ ...base, como: "recusado", quando: s.decidido_em, por: s.decidido_por }];
    if (s.decidido_em === null && s.retirado_em)
      return [{ ...base, como: "cancelado", quando: s.retirado_em, por: s.retirado_por }];
    return [];
  });

  // Os nomes de quem enviou, abriu, revisou e desfez o save. `aberto_por`
  // aponta para `auth.users`, sem embed: uma consulta só para todos.
  const revisoes = revisoesRes.data ?? [];
  const ids = [
    job.enviado_abertura_por,
    job.aberto_por,
    ...revisoes.map((r) => r.registrado_por),
    ...desfeitos.map((s) => s.por),
  ].filter((v): v is string => !!v);
  const nomes = new Map<string, string>();
  if (ids.length > 0) {
    const { data: pessoas, error } = await supabase
      .from("profiles")
      .select("id, nome")
      .in("id", [...new Set(ids)])
      .returns<Array<{ id: string; nome: string | null }>>();
    if (error) console.error("[job.historico.nomes]", error.message);
    for (const p of pessoas ?? []) if (p.nome) nomes.set(p.id, p.nome);
  }
  const nomeDe = (pessoa: string | null) => (pessoa ? (nomes.get(pessoa) ?? null) : null);

  const erratas: JobErrataComItens[] = (erratasRes.data ?? []).map(({ autor, itens, ...e }) => ({
    ...e,
    custo_orcado_antes: num(e.custo_orcado_antes),
    custo_orcado_depois: num(e.custo_orcado_depois),
    valor_job_antes: num(e.valor_job_antes),
    valor_job_depois: num(e.valor_job_depois),
    faturamento_previsto_antes: numOuNulo(e.faturamento_previsto_antes),
    faturamento_previsto_depois: numOuNulo(e.faturamento_previsto_depois),
    autor_nome: autor?.nome ?? null,
    preparada_por_nome: null,
    // A reconstrução converte cada número que lê; aqui só o tipo da linha.
    itens: (itens ?? []) as unknown as JobErrataComItens["itens"],
  }));
  const alteracoes: JobAlteracaoFinanceiroComItens[] = (alteracoesRes.data ?? []).map(({ autor, itens, ...a }) => ({
    ...a,
    custo_orcado_antes: 0,
    custo_orcado_depois: 0,
    valor_job_antes: num(a.valor_job_antes),
    valor_job_depois: num(a.valor_job_depois),
    faturamento_previsto_antes: 0,
    faturamento_previsto_depois: 0,
    recebimento_antes: [],
    recebimento_depois: [],
    impostos_antes: [],
    impostos_depois: [],
    envio_antes: [],
    envio_depois: [],
    autor_nome: autor?.nome ?? null,
    itens: (itens ?? []) as unknown as JobAlteracaoFinanceiroComItens["itens"],
  }));

  return {
    ok: true,
    dados: {
      versaoAprovadaId: job.versao_orcamento_aprovada_id,
      enviadoAberturaEm: job.enviado_abertura_em,
      enviadoAberturaPor: nomeDe(job.enviado_abertura_por),
      abertoEm: job.data_abertura_financeiro,
      abertoPor: nomeDe(job.aberto_por),
      criadoEm: job.created_at,
      linhas: linhasRes.data ?? [],
      grupos: gruposRes.data ?? [],
      linhasDaVersao: versaoRes.data ?? [],
      erratas,
      alteracoes,
      saves: savesRes.data ?? [],
      savesDesfeitos: desfeitos.map((s) => ({
        id: s.id,
        job_item_orcado_id: s.job_item_orcado_id,
        item: s.item_descricao ?? "",
        grupo: s.grupo_nome ?? "",
        como: s.como,
        quando: s.quando,
        por: nomeDe(s.por),
      })),
      revisoes: revisoes.map((r) => ({
        errata_id: r.errata_id,
        registrado_em: r.registrado_em,
        por: nomeDe(r.registrado_por),
      })),
    },
  };
}
