"use server";

/**
 * Decisão 266 — o "Criar Job de Pagamentos" da aba Visualizar Jobs.
 *
 * O financeiro cria um job que já nasce ABERTO, sem orçamento à vista, sem
 * GP nem produtor, para a produção lançar os custos de pagamentos que não
 * pertencem a um job de cliente. O cliente é a própria empresa
 * (`empresas.cliente_id`). Quem grava tudo, numa transação, é a função
 * `criar_job_de_pagamentos`: o projeto unificado (novo, se for o caso), o
 * projeto da produção e o orçamento aprovado e vazio por baixo do job, o
 * job, o agrupamento "Pagamentos", o rateio de competência e a foto da
 * abertura. Os códigos saem daqui, dos mesmos geradores do resto do
 * sistema.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { anoDoCodigoDeJob, gerarCodigoJob, proximoCodigoDeJob } from "@/lib/codigos/jobs";
import { gerarCodigoProjeto } from "@/lib/codigos/projetos";
import { gerarCodigoOrcamento } from "@/lib/codigos/orcamentos";
import { gerarCodigoProjetoFinanceiro } from "@/lib/codigos/projetos-financeiro";
import { listarProjetosFinanceiro } from "@/lib/data/projetos-financeiro";
import {
  jobDePagamentosSchema,
  type JobDePagamentosInput,
} from "@/lib/validations/job-de-pagamentos";

const SO_FINANCEIRO = "Só o administrador ou o financeiro cria job de pagamentos.";

export interface EmpresaDoJobDePagamentos {
  id: string;
  nome: string;
  /** A sigla do cliente que é a própria empresa; nula sem cadastro. */
  sigla: string | null;
  /** A prévia do código do próximo job da empresa (a sigla dela). */
  codigoPrevisto: string | null;
}

export interface OpcoesDoJobDePagamentos {
  empresas: EmpresaDoJobDePagamentos[];
  regionais: { id: string; nome: string; empresa_id: string }[];
  /** Os projetos unificados ativos, com a empresa dos jobs de cada um
   *  (decisão 228). Sem job ainda, `empresaId` é nulo e o projeto serve a
   *  qualquer empresa. */
  projetos: { id: string; nome: string; empresaId: string | null; empresaNome: string | null }[];
}

/**
 * As opções do pop-up, lidas só quando ele abre: a aba Visualizar Jobs é
 * aberta o dia todo, e o pop-up, de vez em quando (`docs/PERFORMANCE.md`).
 */
export async function carregarOpcoesDoJobDePagamentos(): Promise<
  { ok: true; opcoes: OpcoesDoJobDePagamentos } | { ok: false; message: string }
> {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    return { ok: false, message: SO_FINANCEIRO };
  }
  const tenantId = session.activeTenant.id;
  const supabase = createClient();
  // Só as empresas e regionais a que a pessoa tem acesso (a função do
  // banco confere de novo, por `can_access_empresa_regional`).
  const minhas = new Set(session.empresasVisiveis.map((e) => e.id));
  const regionalVisivel = (empresaId: string, regionalId: string) => {
    const r = session.regionaisVisiveisPorEmpresa[empresaId];
    return r === "all" || (Array.isArray(r) && r.includes(regionalId));
  };

  const [empresasRes, regionaisRes, projetos] = await Promise.all([
    supabase
      .from("empresas")
      .select("id, nome_fantasia, cliente:clientes!cliente_id(codigo_curto)")
      .eq("tenant_id", tenantId)
      .eq("ativo", true)
      .order("nome_fantasia"),
    supabase
      .from("regionais")
      .select("id, nome, empresa_id")
      .eq("tenant_id", tenantId)
      .eq("ativo", true)
      .eq("disponivel_em_projetos", true)
      .order("nome"),
    listarProjetosFinanceiro(tenantId, null, ""),
  ]);
  if (empresasRes.error || regionaisRes.error) {
    console.error("[job-de-pagamentos.opcoes]", (empresasRes.error ?? regionaisRes.error)?.message);
    return { ok: false, message: "Não foi possível carregar as empresas. Tente de novo." };
  }

  const empresas = ((empresasRes.data ?? []) as any[])
    .filter((e) => minhas.has(e.id))
    .map((e) => ({
      id: e.id as string,
      nome: e.nome_fantasia as string,
      sigla: (e.cliente?.codigo_curto as string | undefined) ?? null,
    }));

  // A prévia do código: a mesma conta de `gerarCodigoJob`, por sigla.
  const ano = anoDoCodigoDeJob();
  const siglas = Array.from(new Set(empresas.map((e) => e.sigla).filter((s): s is string => Boolean(s))));
  const usados = await Promise.all(
    siglas.map((sigla) =>
      supabase
        .from("codigos_de_job_usados")
        .select("codigo")
        .eq("tenant_id", tenantId)
        .like("codigo", `${sigla}-%/${ano}`),
    ),
  );
  const previaDaSigla = new Map<string, string>();
  siglas.forEach((sigla, i) => {
    previaDaSigla.set(
      sigla,
      proximoCodigoDeJob({
        sigla,
        ano,
        codigos: ((usados[i].data ?? []) as { codigo: string }[]).map((c) => c.codigo),
      }),
    );
  });

  const nomeDaEmpresa = new Map(empresas.map((e) => [e.id, e.nome]));
  return {
    ok: true,
    opcoes: {
      empresas: empresas.map((e) => ({
        ...e,
        codigoPrevisto: e.sigla ? (previaDaSigla.get(e.sigla) ?? null) : null,
      })),
      regionais: ((regionaisRes.data ?? []) as any[])
        .filter((r) => minhas.has(r.empresa_id) && regionalVisivel(r.empresa_id, r.id))
        .map((r) => ({ id: r.id as string, nome: r.nome as string, empresa_id: r.empresa_id as string })),
      projetos: projetos
        .map((p) => {
          const empresaId = p.empresas[0] ?? null;
          return {
            id: p.id,
            nome: p.nome,
            empresaId,
            empresaNome: empresaId ? (nomeDaEmpresa.get(empresaId) ?? null) : null,
          };
        })
        // Projeto de empresa a que a pessoa não tem acesso fica de fora.
        .filter((p) => !p.empresaId || minhas.has(p.empresaId))
        .sort(
          (a, b) =>
            (a.empresaNome ?? "~").localeCompare(b.empresaNome ?? "~", "pt-BR") ||
            a.nome.localeCompare(b.nome, "pt-BR"),
        ),
    },
  };
}

export type ResultadoDoJobDePagamentos =
  | { ok: true; jobId: string; codigo: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

/** Mensagens que a função do banco escreve para o usuário. */
const ERROS_DO_BANCO = new Set(["P0001", "42501", "23514", "23505"]);

export async function criarJobDePagamentos(
  input: JobDePagamentosInput,
): Promise<ResultadoDoJobDePagamentos> {
  const session = await requireSession();
  const tenantId = session.activeTenant.id;
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId,
      entidadeTipo: "job",
      metadata: { acao_tentada: "job.pagamentos_criado", role: session.activeRole },
    });
    return { ok: false, message: SO_FINANCEIRO };
  }

  const parsed = jobDePagamentosSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const d = parsed.data;
  const supabase = createClient();

  const { data: empresa, error: empresaErro } = await supabase
    .from("empresas")
    .select("id, cliente_id")
    .eq("id", d.empresa_id)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ id: string; cliente_id: string | null }>();
  if (empresaErro || !empresa) {
    return { ok: false, message: "Empresa não encontrada." };
  }
  if (!empresa.cliente_id) {
    return { ok: false, message: "A empresa ainda não tem cadastro de cliente. Avise o administrador." };
  }

  // Os códigos: o do job pela sigla do cliente da empresa (decisão 114); o
  // do projeto unificado novo; e o do projeto da produção e do orçamento.
  // Projeto unificado que já tem jobs de pagamentos já tem o projeto da
  // produção: o orçamento entra nele, com o próximo número.
  let codigoJob: string;
  let codigoProjetoFinanceiro: string | null = null;
  let codigoProjeto: string | null = null;
  let codigoOrcamento: string;
  try {
    codigoJob = await gerarCodigoJob(supabase, tenantId, empresa.cliente_id);
    if (!d.projeto_financeiro_id) {
      codigoProjetoFinanceiro = await gerarCodigoProjetoFinanceiro(supabase, tenantId);
    }
    const existente = d.projeto_financeiro_id
      ? (
          await supabase
            .from("projetos")
            .select("id")
            .eq("tenant_id", tenantId)
            .eq("projeto_financeiro_de_pagamentos_id", d.projeto_financeiro_id)
            .maybeSingle<{ id: string }>()
        ).data
      : null;
    if (existente) {
      codigoOrcamento = await gerarCodigoOrcamento(supabase, existente.id, tenantId);
    } else {
      codigoProjeto = await gerarCodigoProjeto(supabase, tenantId);
      codigoOrcamento = `${codigoProjeto}-01`;
    }
  } catch (e) {
    console.error("[job-de-pagamentos.codigos]", (e as Error).message);
    return { ok: false, message: "Não foi possível gerar o código do job. Tente de novo." };
  }

  const { data, error } = await supabase.rpc("criar_job_de_pagamentos", {
    p_empresa_id: d.empresa_id,
    p_regional_id: d.regional_id,
    p_trimestre: d.competencia_trimestre,
    p_ano: d.competencia_ano,
    p_nome: d.nome,
    p_descritivo: d.descritivo,
    p_projeto_financeiro_id: d.projeto_financeiro_id,
    p_projeto_financeiro_novo: d.projeto_financeiro_id ? null : d.projeto_financeiro_novo,
    p_codigo_job: codigoJob,
    p_codigo_projeto_financeiro: codigoProjetoFinanceiro,
    p_codigo_projeto: codigoProjeto,
    p_codigo_orcamento: codigoOrcamento,
  });
  if (error || !data) {
    console.error("[job-de-pagamentos.criar]", error?.code, error?.message);
    const corrida = error?.code === "23505" && /duplicate key/i.test(error.message ?? "");
    return {
      ok: false,
      message: corrida
        ? "Outro job foi criado ao mesmo tempo com o mesmo código. Tente de novo."
        : error && ERROS_DO_BANCO.has(error.code ?? "") && error.message
          ? error.message
          : "Não foi possível criar o job. Tente de novo.",
    };
  }

  const r = data as {
    job_id: string;
    codigo: string;
    projeto_financeiro_id: string;
    projeto_financeiro_novo: boolean;
    projeto_id: string;
    orcamento_id: string;
  };

  if (r.projeto_financeiro_novo) {
    await logAuditEvent({
      acao: "projeto_financeiro.criado",
      tenantId,
      entidadeTipo: "projeto_financeiro",
      entidadeId: r.projeto_financeiro_id,
      metadata: {
        codigo: codigoProjetoFinanceiro,
        nome: d.projeto_financeiro_novo,
        job_id: r.job_id,
        na: "job_de_pagamentos",
      },
    });
  }
  await logAuditEvent({
    acao: "job.pagamentos_criado",
    tenantId,
    entidadeTipo: "job",
    entidadeId: r.job_id,
    metadata: {
      codigo: r.codigo,
      nome: d.nome,
      empresa_id: d.empresa_id,
      regional_id: d.regional_id,
      competencia: `${d.competencia_trimestre}T/${d.competencia_ano}`,
      projeto_financeiro_id: r.projeto_financeiro_id,
      projeto_id: r.projeto_id,
      orcamento_id: r.orcamento_id,
      decisao: "266",
    },
  });

  revalidatePath("/financeiro/abertura-de-job");
  revalidatePath("/financeiro");
  revalidatePath("/jobs");
  return { ok: true, jobId: r.job_id, codigo: r.codigo };
}
