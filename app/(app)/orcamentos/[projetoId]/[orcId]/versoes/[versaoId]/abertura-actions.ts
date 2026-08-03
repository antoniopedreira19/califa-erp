"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { aberturaJobSchema } from "@/lib/validations/abertura-job";
import { calcularTotaisVersao } from "@/lib/calculos/versao-totais";
import { gerarCodigoJob } from "@/lib/codigos/jobs";
import type { VersaoOrcamentoItem } from "@/lib/types";

export type AberturaResult =
  | { ok: true; jobId: string; codigo: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

/** Máximo de cidades devolvidas por busca. O cadastro comporta a lista
 *  completa do Brasil — nunca carregue tudo no cliente. */
const LIMITE_CIDADES = 30;

/**
 * Busca de cidades para o dropdown do modal, feita no servidor.
 * Sem termo, devolve as primeiras em ordem alfabética.
 */
export async function buscarCidades(
  termo: string,
): Promise<{ id: string; nome: string }[]> {
  const session = await requireSession();
  const supabase = createClient();

  let query = supabase
    .from("cidades")
    .select("id, nome")
    .eq("tenant_id", session.activeTenant.id)
    .eq("ativo", true)
    .order("nome")
    .limit(LIMITE_CIDADES);

  const q = termo.trim();
  if (q.length > 0) {
    // Escapa os curingas do LIKE para que "%" digitado busque literal.
    const escaped = q.replace(/[%_]/g, (m) => `\\${m}`);
    query = query.ilike("nome", `%${escaped}%`);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[cidades.buscar]", error.message);
    return [];
  }
  return (data ?? []) as { id: string; nome: string }[];
}

function extractInput(formData: FormData) {
  return {
    nome: formData.get("nome")?.toString() ?? "",
    produto_id: formData.get("produto_id")?.toString() ?? "",
    cidade_id: formData.get("cidade_id")?.toString() ?? "",
    regional_id: formData.get("regional_id")?.toString() ?? "",
    data_inicio_prevista: formData.get("data_inicio_prevista")?.toString() ?? "",
    data_fim_prevista: formData.get("data_fim_prevista")?.toString() ?? "",
    data_prevista_faturamento:
      formData.get("data_prevista_faturamento")?.toString() ?? "",
    observacoes: formData.get("observacoes")?.toString() ?? "",
  };
}

function mapDbError(msg: string): string {
  if (msg.includes("uniq_jobs_codigo_por_tenant")) {
    return "Já existe um job com este código — tente novamente.";
  }
  if (msg.includes("uniq_jobs_por_orcamento_ativo")) {
    return "Este orçamento já tem um job ativo.";
  }
  if (msg.includes("uniq_jobs_principal_por_projeto")) {
    return "Já existe um job principal neste projeto.";
  }
  if (msg.includes("jobs_datas_ordem")) {
    return "A data de fim não pode ser anterior à data de início.";
  }
  if (msg.includes("orcamentos_datas_ordem")) {
    return "As datas não podem ser gravadas no orçamento: fim anterior ao início.";
  }
  return "Não foi possível enviar o job para abertura.";
}

/**
 * Envia o job para abertura a partir da versão aprovada.
 *
 * Diferenças em relação ao antigo `criarJob`:
 * - hierarquia é decidida aqui, sem perguntar: se o projeto já tem um job
 *   principal ativo, o novo nasce como sub-job dele (decisão do time em
 *   30/07/2026 — o projeto é o guarda-chuva, cada orçamento aprovado abre
 *   um job debaixo dele). Trocar o principal continua na tela do job;
 * - `valor_total` é recalculado a partir dos itens da versão, nunca vem
 *   do formulário;
 * - nome e datas informados no modal são gravados TAMBÉM no orçamento.
 */
export async function enviarJobParaAbertura(
  versaoId: string,
  formData: FormData,
): Promise<AberturaResult> {
  const session = await requireSession();
  const parsed = aberturaJobSchema.safeParse(extractInput(formData));

  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();

  // 1. Versão precisa estar aprovada e ser a versão aprovada do orçamento.
  const { data: versao } = await supabase
    .from("versoes_orcamento")
    .select(
      "id, status, orcamento_id, percentual_honorarios, percentual_imposto",
    )
    .eq("id", versaoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{
      id: string;
      status: string;
      orcamento_id: string;
      percentual_honorarios: number;
      percentual_imposto: number;
    }>();

  if (!versao) return { ok: false, message: "Versão não encontrada." };
  if (versao.status !== "aprovada") {
    return { ok: false, message: "Só a versão aprovada abre job." };
  }

  const { data: orc } = await supabase
    .from("orcamentos")
    .select("id, status, versao_aprovada_id, projeto_id")
    .eq("id", versao.orcamento_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{
      id: string;
      status: string;
      versao_aprovada_id: string | null;
      projeto_id: string;
    }>();

  if (!orc) return { ok: false, message: "Orçamento não encontrado." };
  if (orc.status !== "aprovado" || orc.versao_aprovada_id !== versaoId) {
    return {
      ok: false,
      message: "O orçamento não está aprovado nesta versão.",
    };
  }

  // 2. Um job ativo por orçamento (o unique index também barra; aqui é
  //    só pra devolver mensagem boa antes de gastar o resto).
  const { count: jobsDoOrcamento } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("orcamento_id", orc.id)
    .eq("tenant_id", session.activeTenant.id)
    .neq("status", "cancelado");

  if ((jobsDoOrcamento ?? 0) > 0) {
    return { ok: false, message: "Este orçamento já tem um job ativo." };
  }

  // 3. Produto e cidade precisam pertencer ao cliente/tenant certo — não
  //    basta serem uuid válido. Cliente vem do projeto.
  const { data: projeto } = await supabase
    .from("projetos")
    .select("id, cliente_id, responsavel_id")
    .eq("id", orc.projeto_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ id: string; cliente_id: string; responsavel_id: string }>();

  if (!projeto) return { ok: false, message: "Projeto não encontrado." };

  const [produtoRes, cidadeRes] = await Promise.all([
    supabase
      .from("cliente_produtos")
      .select("id, nome")
      .eq("id", parsed.data.produto_id)
      .eq("cliente_id", projeto.cliente_id)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle<{ id: string; nome: string }>(),
    supabase
      .from("cidades")
      .select("id, nome")
      .eq("id", parsed.data.cidade_id)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle<{ id: string; nome: string }>(),
  ]);

  if (!produtoRes.data) {
    return {
      ok: false,
      message: "Produto inválido para este cliente.",
      fieldErrors: { produto_id: ["Selecione um produto do cadastro do cliente."] },
    };
  }
  if (!cidadeRes.data) {
    return {
      ok: false,
      message: "Cidade inválida.",
      fieldErrors: { cidade_id: ["Selecione uma cidade do cadastro."] },
    };
  }

  // 4. Valor total = faturamento previsto, recalculado dos itens.
  const { data: itensBrutos, error: itensErr } = await supabase
    .from("versoes_orcamento_itens")
    .select("tipo_custo, total_orcado")
    .eq("versao_orcamento_id", versaoId)
    .eq("tenant_id", session.activeTenant.id);

  if (itensErr) {
    console.error("[abertura.itens]", itensErr.message);
    return { ok: false, message: "Não foi possível calcular o valor do job." };
  }

  const totais = calcularTotaisVersao(
    (itensBrutos ?? []) as unknown as VersaoOrcamentoItem[],
    Number(versao.percentual_honorarios ?? 0),
    Number(versao.percentual_imposto ?? 0),
  );

  let codigo: string;
  try {
    codigo = await gerarCodigoJob(supabase, session.activeTenant.id);
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }

  // 5. Nome e datas voltam para o orçamento, como avisa o modal.
  const { error: errOrcDados } = await supabase
    .from("orcamentos")
    .update({
      nome: parsed.data.nome,
      data_inicio_prevista: parsed.data.data_inicio_prevista,
      data_fim_prevista: parsed.data.data_fim_prevista,
    })
    .eq("id", orc.id)
    .eq("tenant_id", session.activeTenant.id);

  if (errOrcDados) {
    console.error("[abertura.orcamento_dados]", errOrcDados.message);
    return { ok: false, message: mapDbError(errOrcDados.message) };
  }

  // 6. Cria o job. `cidade` é texto no schema de jobs — gravamos o nome
  //    escolhido no cadastro, que já vem no formato "Salvador-BA".
  const { data: novo, error: errIns } = await supabase
    .from("jobs")
    .insert({
      tenant_id: session.activeTenant.id,
      codigo,
      projeto_id: orc.projeto_id,
      orcamento_id: orc.id,
      versao_orcamento_aprovada_id: versaoId,
      nome: parsed.data.nome,
      produto: produtoRes.data.nome,
      regional_id: parsed.data.regional_id,
      cidade: cidadeRes.data.nome,
      data_inicio_prevista: parsed.data.data_inicio_prevista,
      data_fim_prevista: parsed.data.data_fim_prevista,
      data_prevista_faturamento: parsed.data.data_prevista_faturamento,
      // Gravado mas ainda não exibido: a leitura entra quando a tela de
      // abertura do financeiro for refinada (decisão do time, 31/07/2026).
      observacoes: parsed.data.observacoes,
      responsavel_id: projeto.responsavel_id,
      valor_total: Number(totais.faturamento.toFixed(2)),
      // status default do banco = 'aguardando_abertura' — não sobrescreva
      created_by: session.profile.id,
    })
    .select("id")
    .single();

  if (errIns) {
    console.error("[abertura.job_insert]", errIns.message);
    return { ok: false, message: mapDbError(errIns.message) };
  }

  // 7. Orçamento passa a 'job_criado'.
  const { error: errOrcStatus } = await supabase
    .from("orcamentos")
    .update({ status: "job_criado" })
    .eq("id", orc.id)
    .eq("tenant_id", session.activeTenant.id);

  if (errOrcStatus) {
    console.error("[abertura.orcamento_status]", errOrcStatus.message);
    return {
      ok: false,
      message:
        "Job criado, mas o status do orçamento não atualizou. Verifique manualmente.",
    };
  }

  await logAuditEvent({
    acao: "job.enviado_para_abertura",
    tenantId: session.activeTenant.id,
    entidadeTipo: "job",
    entidadeId: novo.id,
    metadata: {
      codigo,
      orcamento_id: orc.id,
      versao_id: versaoId,
      valor_total: Number(totais.faturamento.toFixed(2)),
      data_prevista_faturamento: parsed.data.data_prevista_faturamento,
    },
  });

  revalidatePath(`/orcamentos/${orc.projeto_id}/${orc.id}/versoes/${versaoId}`);
  revalidatePath(`/orcamentos/${orc.projeto_id}/${orc.id}`);
  revalidatePath(`/orcamentos/${orc.projeto_id}`);
  revalidatePath("/jobs");
  revalidatePath("/financeiro/jobs-aguardando-abertura");

  return { ok: true, jobId: novo.id, codigo };
}
