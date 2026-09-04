"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { checarPermissao, pode } from "@/lib/permissoes";
import { honorariosDoOrcamento } from "@/lib/data/clientes";
import { bloqueioAprovacaoVersao, versaoSchema } from "@/lib/validations/versoes";
import { ALIQUOTA_IMPOSTO_PADRAO, aliquotaParaValor } from "@/lib/impostos";
import {
  itemSchema,
  camposItemEditaveis,
  isCampoItemEditavel,
} from "@/lib/validations/itens";
import { grupoSchema } from "@/lib/validations/grupos";
import type {
  TipoCusto,
  VersaoOrcamento,
  VersaoOrcamentoGrupo,
  VersaoOrcamentoItem,
} from "@/lib/types";
import { aceitaBV } from "@/lib/calculos/versao-totais";
import { bvLiquido, planejadoEspelhaOrcado } from "@/lib/calculos/bv-planilha";

export type ActionResult =
  | { ok: true; id?: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

// ============================================================
// VERSÕES
// ============================================================

function extractVersaoInput(formData: FormData) {
  // Empty string dos numéricos → Zod aplica default na criação.
  const get = (k: string, fallback: string) => {
    const raw = formData.get(k)?.toString() ?? "";
    return raw.trim().length > 0 ? raw : fallback;
  };
  // `nome` não entra: desde 13/08/2026 o nome da versão é calculado
  // (nome do job + V{n}) e não existe caminho para gravá-lo.
  return {
    moeda: get("moeda", "BRL"),
    taxa_cambio: get("taxa_cambio", "1"),
    percentual_honorarios: get("percentual_honorarios", "0"),
    // Versão nova sem alíquota escolhida nasce na padrão (03/09/2026), não
    // em 0 — zero não casa com nenhuma alíquota da lista e travava a
    // aprovação. O drawer já manda a padrão; este default é a rede.
    percentual_imposto: get(
      "percentual_imposto",
      aliquotaParaValor(ALIQUOTA_IMPOSTO_PADRAO),
    ),
    status: (formData.get("status")?.toString() ?? "rascunho") as any,
  };
}

/** Extrai apenas os campos que o usuário efetivamente preencheu no edit.
 *  Campos vazios preservam o valor atual no banco. */
function extractVersaoPartial(formData: FormData): Record<string, unknown> {
  const partial: Record<string, unknown> = {};

  // `nome` não entra: o nome da versão é calculado, não gravado. Um
  // formulário que mande o campo é ignorado de propósito — a regra tem
  // que valer no servidor, não só no sumiço do input.

  const moeda = formData.get("moeda")?.toString().trim();
  if (moeda && moeda.length > 0) {
    partial.moeda = moeda.toUpperCase().slice(0, 3);
  }

  const taxa = formData.get("taxa_cambio")?.toString().trim();
  if (taxa && taxa.length > 0) {
    const n = Number(taxa);
    if (Number.isFinite(n) && n > 0) partial.taxa_cambio = n;
  }

  const honor = formData.get("percentual_honorarios")?.toString().trim();
  if (honor && honor.length > 0) {
    const n = Number(honor);
    if (Number.isFinite(n) && n >= 0 && n <= 100)
      partial.percentual_honorarios = n;
  }

  const imp = formData.get("percentual_imposto")?.toString().trim();
  if (imp && imp.length > 0) {
    const n = Number(imp);
    if (Number.isFinite(n) && n >= 0 && n <= 100)
      partial.percentual_imposto = n;
  }

  // `status` não entra: desde 17/08/2026 o status da versão é 100% do
  // sistema (aprovação, cascata de substituídas, `cancelarVersao`). Um
  // formulário que mande o campo é ignorado de propósito — a regra tem
  // que valer no servidor, não só no sumiço do input.

  return partial;
}

async function proximoNumeroVersao(
  orcamentoId: string,
  tenantId: string,
): Promise<number> {
  const supabase = createClient();
  const { data } = await supabase
    .from("versoes_orcamento")
    .select("numero_versao")
    .eq("orcamento_id", orcamentoId)
    .eq("tenant_id", tenantId)
    .order("numero_versao", { ascending: false })
    .limit(1)
    .maybeSingle<{ numero_versao: number }>();
  return (data?.numero_versao ?? 0) + 1;
}

function mapVersaoDbError(msg: string): string {
  if (msg.includes("uniq_versao_numero_por_orcamento")) {
    return "Já existe uma versão com esse número.";
  }
  if (msg.includes("uniq_versao_aprovada_por_orcamento")) {
    return "Já existe uma versão aprovada neste orçamento.";
  }
  if (msg.includes("percentuais_validos")) {
    return "Percentuais precisam estar entre 0 e 100.";
  }
  if (msg.includes("taxa_positiva")) {
    return "Taxa de câmbio precisa ser maior que zero.";
  }
  return "Não foi possível salvar a versão.";
}

/**
 * Cria a versão e REDIRECIONA para ela.
 *
 * O retorno é `ActionResult | void` porque `redirect()` no servidor não
 * devolve valor nenhum ao cliente: no caminho feliz o `await` do chamador
 * resolve `undefined` e a navegação já aconteceu. Só o erro volta como
 * objeto — por isso todo call site testa `res` antes de ler `res.ok`.
 */
export async function criarVersao(
  orcamentoId: string,
  formData: FormData,
): Promise<ActionResult | void> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "orcamentos.criar");
  if (!gate.ok) return gate;
  const parsed = versaoSchema.safeParse(extractVersaoInput(formData));

  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();

  const { data: orc } = await supabase
    .from("orcamentos")
    .select("id, status, projeto_id")
    .eq("id", orcamentoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ id: string; status: string; projeto_id: string }>();

  if (!orc) return { ok: false, message: "Orçamento não encontrado." };
  if (orc.status === "job_criado" || orc.status === "cancelado") {
    return {
      ok: false,
      message: `Não é possível criar versão em orçamento ${orc.status}.`,
    };
  }

  const projetoId = orc.projeto_id;

  // Honorários da versão nova vem do cadastro do cliente, nunca do form: o
  // drawer mostra o campo travado e não envia nada (11/08/2026).
  const honorariosCliente = await honorariosDoOrcamento(
    orcamentoId,
    session.activeTenant.id,
  );
  if (!honorariosCliente) {
    return {
      ok: false,
      message:
        "Não foi possível ler os honorários do cliente. Confira o cadastro do cliente do projeto.",
    };
  }

  const numero = await proximoNumeroVersao(orcamentoId, session.activeTenant.id);

  const { data, error } = await supabase
    .from("versoes_orcamento")
    .insert({
      ...parsed.data,
      percentual_honorarios: honorariosCliente.percentual,
      tenant_id: session.activeTenant.id,
      orcamento_id: orcamentoId,
      numero_versao: numero,
      created_by: session.profile.id,
    })
    .select("id, numero_versao")
    .single();

  if (error) {
    console.error("[versoes.criar]", error.message);
    return { ok: false, message: mapVersaoDbError(error.message) };
  }

  await logAuditEvent({
    acao: "versao_orcamento.criada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "versao_orcamento",
    entidadeId: data.id,
    metadata: { orcamento_id: orcamentoId, numero_versao: data.numero_versao },
  });

  revalidatePath(`/orcamentos/${projetoId}/${orcamentoId}`);
  redirect(`/orcamentos/${projetoId}/${orcamentoId}?v=${data.id}`);
}

export async function atualizarVersao(
  versaoId: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "orcamentos.editar");
  if (!gate.ok) return gate;
  const updates = extractVersaoPartial(formData);

  const supabase = createClient();

  const { data: atual } = await supabase
    .from("versoes_orcamento")
    .select("orcamento_id, status, percentual_honorarios")
    .eq("id", versaoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{
      orcamento_id: string;
      status: string;
      percentual_honorarios: number;
    }>();

  if (!atual) return { ok: false, message: "Versão não encontrada." };
  if (atual.status === "aprovada") {
    return {
      ok: false,
      message: "Versão aprovada não pode ser alterada manualmente.",
    };
  }

  // Honorarios e o unico campo desta tela com trava de papel adicional:
  // o padrao vem do cadastro do cliente e so quem tem `orcamentos.editar_impostos`
  // (Admin + Gerente de Producao) pode divergir dele. Nao e gate de tela
  // — quem nao pode nem tem o campo habilitado, e sem esta checagem um
  // POST direto passaria por cima.
  const honorariosNovo = updates.percentual_honorarios;
  const honorariosMudou =
    typeof honorariosNovo === "number" &&
    Number(atual.percentual_honorarios) !== honorariosNovo;

  if (honorariosMudou && !pode(session.activeRole, "orcamentos.editar_impostos")) {
    return {
      ok: false,
      message:
        "Só administrador ou gerente de produção altera os honorários da versão. O padrão vem do cadastro do cliente.",
    };
  }
  if (!honorariosMudou) delete updates.percentual_honorarios;

  const { error } = await supabase
    .from("versoes_orcamento")
    .update(updates)
    .eq("id", versaoId)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[versoes.atualizar]", error.message);
    return { ok: false, message: mapVersaoDbError(error.message) };
  }

  await logAuditEvent({
    acao: "versao_orcamento.editada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "versao_orcamento",
    entidadeId: versaoId,
    metadata: honorariosMudou
      ? {
          campo: "percentual_honorarios",
          de: Number(atual.percentual_honorarios),
          para: honorariosNovo,
        }
      : undefined,
  });

  const { data: orcAtual } = await supabase
    .from("orcamentos")
    .select("projeto_id")
    .eq("id", atual.orcamento_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ projeto_id: string }>();
  const projetoIdAtual = orcAtual?.projeto_id;

  revalidatePath(`/orcamentos/${projetoIdAtual}/${atual.orcamento_id}`);
  return { ok: true, id: versaoId };
}

/** Duplica a versão e REDIRECIONA para a cópia. Ver `criarVersao` sobre o
 *  `| void` do retorno. */
export async function duplicarVersao(
  versaoId: string,
): Promise<ActionResult | void> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "orcamentos.duplicar");
  if (!gate.ok) return gate;
  const supabase = createClient();

  const { data: original } = await supabase
    .from("versoes_orcamento")
    .select("*")
    .eq("id", versaoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<VersaoOrcamento>();

  if (!original) return { ok: false, message: "Versão original não encontrada." };

  // Duplicar CRIA uma versão, então vale a mesma trava de `criarVersao`:
  // orçamento com job criado ou cancelado não recebe versão nova. A checagem
  // faltava aqui — o botão "Duplicar" da lista antiga não tinha gate nenhum,
  // e um orçamento fechado aceitava ganhar uma v+1 pelo caminho da cópia.
  // Traz status e projeto_id de uma vez: o status trava a operação aqui, o
  // projeto_id monta o destino lá embaixo.
  const { data: orcDup } = await supabase
    .from("orcamentos")
    .select("status, projeto_id")
    .eq("id", original.orcamento_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ status: string; projeto_id: string }>();

  if (orcDup?.status === "job_criado" || orcDup?.status === "cancelado") {
    return {
      ok: false,
      message: `Não é possível criar versão em orçamento ${orcDup.status}.`,
    };
  }

  const numero = await proximoNumeroVersao(
    original.orcamento_id,
    session.activeTenant.id,
  );

  const { data: nova, error } = await supabase
    .from("versoes_orcamento")
    .insert({
      tenant_id: session.activeTenant.id,
      orcamento_id: original.orcamento_id,
      numero_versao: numero,
      nome: original.nome ? `${original.nome} (cópia)` : null,
      status: "rascunho",
      moeda: original.moeda,
      taxa_cambio: original.taxa_cambio,
      percentual_honorarios: original.percentual_honorarios,
      percentual_imposto: original.percentual_imposto,
      created_by: session.profile.id,
    })
    .select("id")
    .single();

  if (error || !nova) {
    console.error("[versoes.duplicar]", error?.message);
    return { ok: false, message: mapVersaoDbError(error?.message ?? "") };
  }

  // Duplica grupos e mapeia old_id → new_id pra reatribuir os itens.
  const { data: gruposOriginais } = await supabase
    .from("versoes_orcamento_grupos")
    .select("id, nome, ordem")
    .eq("versao_orcamento_id", versaoId)
    .eq("tenant_id", session.activeTenant.id)
    .order("ordem");

  const grupoMap = new Map<string, string>();
  if (gruposOriginais && gruposOriginais.length > 0) {
    const gruposRows = gruposOriginais.map((g: any) => ({
      tenant_id: session.activeTenant.id,
      versao_orcamento_id: nova.id,
      nome: g.nome,
      ordem: g.ordem,
    }));
    const { data: novosGrupos, error: gErr } = await supabase
      .from("versoes_orcamento_grupos")
      .insert(gruposRows)
      .select("id, nome, ordem");
    if (gErr) {
      console.error("[versoes.duplicar.grupos]", gErr.message);
    } else if (novosGrupos) {
      // Associação por (nome, ordem) — combinação única na versão nova.
      for (const orig of gruposOriginais as any[]) {
        const novo = novosGrupos.find(
          (g: any) => g.nome === orig.nome && g.ordem === orig.ordem,
        );
        if (novo) grupoMap.set(orig.id, novo.id);
      }
    }
  }

  const { data: itens } = await supabase
    .from("versoes_orcamento_itens")
    .select(
      "ordem, grupo_id, categoria_id, planilha_origem, item, tipo_custo, " +
      "valor_unitario_orcado, quantidade_orcada, dias_meses_orcado, " +
      "valor_unitario_planejado, quantidade_planejada, dias_meses_planejado, " +
      "fornecedor_id, observacoes",
    )
    .eq("versao_orcamento_id", versaoId)
    .eq("tenant_id", session.activeTenant.id);

  if (itens && itens.length > 0) {
    const rows = itens
      .map((i: any) => {
        const novoGrupoId = grupoMap.get(i.grupo_id);
        if (!novoGrupoId) return null;
        return {
          ...i,
          tenant_id: session.activeTenant.id,
          versao_orcamento_id: nova.id,
          grupo_id: novoGrupoId,
          categoria_id: i.categoria_id,
        };
      })
      .filter((r): r is any => r !== null);

    if (rows.length > 0) {
      const { error: itensErr } = await supabase
        .from("versoes_orcamento_itens")
        .insert(rows);
      if (itensErr) {
        console.error("[versoes.duplicar.itens]", itensErr.message);
      }
    }
  }

  await logAuditEvent({
    acao: "versao_orcamento.criada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "versao_orcamento",
    entidadeId: nova.id,
    metadata: {
      orcamento_id: original.orcamento_id,
      numero_versao: numero,
      duplicada_de: versaoId,
    },
  });

  const projetoIdDup = orcDup?.projeto_id;

  revalidatePath(`/orcamentos/${projetoIdDup}/${original.orcamento_id}`);
  redirect(`/orcamentos/${projetoIdDup}/${original.orcamento_id}?v=${nova.id}`);
}

/**
 * Apaga a versão de verdade — grupos, itens e os BVs deles vão junto.
 *
 * Substituiu `cancelarVersao` em 21/08/2026. Cancelar marcava a versão como
 * `cancelada` e a deixava no banco, ainda visível e selecionável nas abas;
 * o Tiago apontou que isso não resolve nada, porque uma versão que continua
 * existindo e navegável já está resolvida por simplesmente NÃO ser aprovada
 * (decisão 023).
 *
 * Três coisas travam a exclusão, e as três respondem com texto em vez de
 * erro de FK:
 *
 * 1. **Versão aprovada** — apagá-la esvaziaria `orcamentos.versao_aprovada_id`
 *    em silêncio (a FK é ON DELETE SET NULL), desfazendo a aprovação sem
 *    passar pelo fluxo dela. Quem quer mesmo usa "Cancelar aprovação" antes.
 * 2. **Versão que virou job** — `jobs.versao_orcamento_aprovada_id` é ON
 *    DELETE RESTRICT, então o banco já barraria; aqui a recusa é legível.
 * 3. **Última versão do orçamento** — o orçamento nasce com a v1 e nunca
 *    ficou sem nenhuma. Deletar a última criaria um estado que só existe no
 *    código.
 *
 * O delete em si é UMA chamada à RPC `deletar_versao_orcamento`, e não três
 * deletes seguidos pelo PostgREST. Três chamadas são três transações: se a
 * última falhar, a versão fica no banco sem os itens e sem os grupos, em
 * silêncio. Aconteceu na conferência desta entrega, quando o GRANT de DELETE
 * ainda faltava. A RPC também fixa a ordem item → grupo → versão, que importa
 * porque `versoes_orcamento_itens.grupo_id` é ON DELETE RESTRICT (ver a
 * migration 20260821000005).
 */
export async function deletarVersao(versaoId: string): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "orcamentos.editar");
  if (!gate.ok) return gate;
  const supabase = createClient();

  const { data: atual } = await supabase
    .from("versoes_orcamento")
    .select("orcamento_id, numero_versao, status")
    .eq("id", versaoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{
      orcamento_id: string;
      numero_versao: number;
      status: string;
    }>();

  if (!atual) return { ok: false, message: "Versão não encontrada." };

  if (atual.status === "aprovada") {
    return {
      ok: false,
      message:
        'Versão aprovada não pode ser deletada. Use "Cancelar aprovação" antes.',
    };
  }

  const { count: jobsVinculados } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("versao_orcamento_aprovada_id", versaoId)
    .eq("tenant_id", session.activeTenant.id);

  if ((jobsVinculados ?? 0) > 0) {
    return {
      ok: false,
      message: "Esta versão gerou um job e não pode ser deletada.",
    };
  }

  const { count: totalVersoes } = await supabase
    .from("versoes_orcamento")
    .select("id", { count: "exact", head: true })
    .eq("orcamento_id", atual.orcamento_id)
    .eq("tenant_id", session.activeTenant.id);

  if ((totalVersoes ?? 0) <= 1) {
    return {
      ok: false,
      message:
        "O orçamento precisa de ao menos uma versão. Crie outra antes de deletar esta.",
    };
  }

  // O que a linha era, para a auditoria — depois do delete não há de onde ler.
  const { count: qtdItens } = await supabase
    .from("versoes_orcamento_itens")
    .select("id", { count: "exact", head: true })
    .eq("versao_orcamento_id", versaoId)
    .eq("tenant_id", session.activeTenant.id);

  const { error } = await supabase.rpc("deletar_versao_orcamento", {
    p_versao_id: versaoId,
  });

  if (error) {
    console.error("[versoes.deletar]", error.message);
    // Sobrou alguma FK que as checagens acima não previram — a planilha
    // interna de um job (`jobs_itens_orcado`) é a candidata. Dizer isso é
    // mais útil que repetir "não foi possível".
    const emUso = /foreign key|violates|referenced/i.test(error.message);
    return {
      ok: false,
      message: emUso
        ? "Não foi possível deletar: há dados de job apontando para os itens desta versão."
        : "Não foi possível deletar a versão.",
    };
  }

  await logAuditEvent({
    acao: "versao_orcamento.deletada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "versao_orcamento",
    entidadeId: versaoId,
    metadata: {
      orcamento_id: atual.orcamento_id,
      numero_versao: atual.numero_versao,
      status_anterior: atual.status,
      itens_apagados: qtdItens ?? 0,
    },
  });

  const { data: orcDel } = await supabase
    .from("orcamentos")
    .select("projeto_id")
    .eq("id", atual.orcamento_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ projeto_id: string }>();

  revalidatePath(`/orcamentos/${orcDel?.projeto_id}/${atual.orcamento_id}`);
  return { ok: true, id: versaoId };
}

// ============================================================
// GRUPOS
// ============================================================

async function loadVersaoParaGrupo(
  versaoId: string,
  tenantId: string,
): Promise<{ orcamento_id: string; projeto_id: string; status: string } | null> {
  const supabase = createClient();
  const { data: versao } = await supabase
    .from("versoes_orcamento")
    .select("orcamento_id, status")
    .eq("id", versaoId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ orcamento_id: string; status: string }>();
  if (!versao) return null;
  const { data: orc } = await supabase
    .from("orcamentos")
    .select("projeto_id")
    .eq("id", versao.orcamento_id)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ projeto_id: string }>();
  return { ...versao, projeto_id: orc?.projeto_id ?? "" };
}

async function proximaOrdemGrupo(
  versaoId: string,
  tenantId: string,
): Promise<number> {
  const supabase = createClient();
  const { data } = await supabase
    .from("versoes_orcamento_grupos")
    .select("ordem")
    .eq("versao_orcamento_id", versaoId)
    .eq("tenant_id", tenantId)
    .order("ordem", { ascending: false })
    .limit(1)
    .maybeSingle<{ ordem: number }>();
  return (data?.ordem ?? 0) + 1;
}

function mapGrupoDbError(msg: string): string {
  if (msg.includes("uniq_grupo_nome_por_versao")) {
    return "Já existe um grupo com esse nome nesta versão.";
  }
  if (msg.includes("grupos_nome_nao_vazio")) {
    return "Nome do grupo não pode ficar vazio.";
  }
  return "Não foi possível salvar o grupo.";
}

export async function criarGrupo(
  versaoId: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "orcamentos.editar");
  if (!gate.ok) return gate;
  const parsed = grupoSchema.safeParse({
    nome: formData.get("nome")?.toString() ?? "",
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Nome inválido.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const versao = await loadVersaoParaGrupo(versaoId, session.activeTenant.id);
  if (!versao) return { ok: false, message: "Versão não encontrada." };
  if (versao.status === "aprovada") {
    return {
      ok: false,
      message: "Versão aprovada não aceita novos grupos.",
    };
  }

  const supabase = createClient();
  const ordem = await proximaOrdemGrupo(versaoId, session.activeTenant.id);

  const { data, error } = await supabase
    .from("versoes_orcamento_grupos")
    .insert({
      tenant_id: session.activeTenant.id,
      versao_orcamento_id: versaoId,
      nome: parsed.data.nome,
      ordem,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[grupos.criar]", error.message);
    return { ok: false, message: mapGrupoDbError(error.message) };
  }

  revalidatePath(`/orcamentos/${versao.projeto_id}/${versao.orcamento_id}`);
  return { ok: true, id: data.id };
}

export async function renomearGrupo(
  grupoId: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "orcamentos.editar");
  if (!gate.ok) return gate;
  const parsed = grupoSchema.safeParse({
    nome: formData.get("nome")?.toString() ?? "",
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Nome inválido.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();
  const { data: grupo } = await supabase
    .from("versoes_orcamento_grupos")
    .select("versao_orcamento_id")
    .eq("id", grupoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<Pick<VersaoOrcamentoGrupo, "versao_orcamento_id">>();

  if (!grupo) return { ok: false, message: "Grupo não encontrado." };

  const versao = await loadVersaoParaGrupo(
    grupo.versao_orcamento_id,
    session.activeTenant.id,
  );
  if (!versao) return { ok: false, message: "Versão não encontrada." };
  if (versao.status === "aprovada") {
    return { ok: false, message: "Versão aprovada não permite renomear grupo." };
  }

  const { error } = await supabase
    .from("versoes_orcamento_grupos")
    .update({ nome: parsed.data.nome })
    .eq("id", grupoId)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[grupos.renomear]", error.message);
    return { ok: false, message: mapGrupoDbError(error.message) };
  }

  revalidatePath(`/orcamentos/${versao.projeto_id}/${versao.orcamento_id}`);
  return { ok: true, id: grupoId };
}

export async function removerGrupo(grupoId: string): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "orcamentos.editar");
  if (!gate.ok) return gate;
  const supabase = createClient();

  const { data: grupo } = await supabase
    .from("versoes_orcamento_grupos")
    .select("versao_orcamento_id")
    .eq("id", grupoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<Pick<VersaoOrcamentoGrupo, "versao_orcamento_id">>();

  if (!grupo) return { ok: false, message: "Grupo não encontrado." };

  const versao = await loadVersaoParaGrupo(
    grupo.versao_orcamento_id,
    session.activeTenant.id,
  );
  if (!versao) return { ok: false, message: "Versão não encontrada." };
  if (versao.status === "aprovada") {
    return { ok: false, message: "Versão aprovada não permite remover grupo." };
  }

  const supabase2 = createClient();
  const { count } = await supabase2
    .from("versoes_orcamento_itens")
    .select("id", { count: "exact", head: true })
    .eq("grupo_id", grupoId)
    .eq("tenant_id", session.activeTenant.id);

  if ((count ?? 0) > 0) {
    return {
      ok: false,
      message: `Remova os ${count} ${count === 1 ? "item" : "itens"} do grupo antes de excluí-lo.`,
    };
  }

  const { error } = await supabase
    .from("versoes_orcamento_grupos")
    .delete()
    .eq("id", grupoId)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[grupos.remover]", error.message);
    return { ok: false, message: "Não foi possível remover o grupo." };
  }

  revalidatePath(`/orcamentos/${versao.projeto_id}/${versao.orcamento_id}`);
  return { ok: true, id: grupoId };
}

// ============================================================
// ITENS (agora sempre dentro de um grupo)
// ============================================================

function extractItemInput(formData: FormData) {
  return {
    item: formData.get("item")?.toString() ?? "",
    tipo_custo: (formData.get("tipo_custo")?.toString() ?? "A") as any,
    valor_unitario_orcado:
      formData.get("valor_unitario_orcado")?.toString() ?? "0",
    quantidade_orcada: formData.get("quantidade_orcada")?.toString() ?? "1",
    dias_meses_orcado: formData.get("dias_meses_orcado")?.toString() ?? "1",
    categoria_id: (formData.get("categoria_id")?.toString() || "") || null,
    valor_unitario_planejado:
      formData.get("valor_unitario_planejado")?.toString() ?? "0",
    quantidade_planejada:
      formData.get("quantidade_planejada")?.toString() ?? "0",
    dias_meses_planejado:
      formData.get("dias_meses_planejado")?.toString() ?? "0",
  };
}

async function proximaOrdemItem(
  versaoId: string,
  tenantId: string,
): Promise<number> {
  const supabase = createClient();
  const { data } = await supabase
    .from("versoes_orcamento_itens")
    .select("ordem")
    .eq("versao_orcamento_id", versaoId)
    .eq("tenant_id", tenantId)
    .order("ordem", { ascending: false })
    .limit(1)
    .maybeSingle<{ ordem: number }>();
  return (data?.ordem ?? 0) + 1;
}

async function assertVersaoEditavel(
  versaoId: string,
  tenantId: string,
): Promise<{ orcamento_id: string; projeto_id: string } | { error: string }> {
  const supabase = createClient();
  const { data } = await supabase
    .from("versoes_orcamento")
    .select("orcamento_id, status")
    .eq("id", versaoId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ orcamento_id: string; status: string }>();

  if (!data) return { error: "Versão não encontrada." };
  if (data.status === "aprovada") {
    return { error: "Versão aprovada não permite alterar itens." };
  }
  const { data: orc } = await supabase
    .from("orcamentos")
    .select("projeto_id")
    .eq("id", data.orcamento_id)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ projeto_id: string }>();
  return { orcamento_id: data.orcamento_id, projeto_id: orc?.projeto_id ?? "" };
}

export async function adicionarItem(
  grupoId: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "orcamentos.editar");
  if (!gate.ok) return gate;
  const parsed = itemSchema.safeParse(extractItemInput(formData));

  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();
  const { data: grupo } = await supabase
    .from("versoes_orcamento_grupos")
    .select("id, versao_orcamento_id")
    .eq("id", grupoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ id: string; versao_orcamento_id: string }>();

  if (!grupo) return { ok: false, message: "Grupo não encontrado." };

  const check = await assertVersaoEditavel(
    grupo.versao_orcamento_id,
    session.activeTenant.id,
  );
  if ("error" in check) return { ok: false, message: check.error };

  const ordem = await proximaOrdemItem(
    grupo.versao_orcamento_id,
    session.activeTenant.id,
  );

  const { data, error } = await supabase
    .from("versoes_orcamento_itens")
    .insert({
      ...parsed.data,
      tenant_id: session.activeTenant.id,
      versao_orcamento_id: grupo.versao_orcamento_id,
      grupo_id: grupo.id,
      ordem,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[itens.adicionar]", error.message);
    return { ok: false, message: "Não foi possível adicionar o item." };
  }

  revalidatePath(`/orcamentos/${check.projeto_id}/${check.orcamento_id}`);
  return { ok: true, id: data.id };
}

export async function atualizarItem(
  itemId: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "orcamentos.editar");
  if (!gate.ok) return gate;
  const parsed = itemSchema.safeParse(extractItemInput(formData));

  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();
  const { data: item } = await supabase
    .from("versoes_orcamento_itens")
    .select("versao_orcamento_id")
    .eq("id", itemId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<Pick<VersaoOrcamentoItem, "versao_orcamento_id">>();

  if (!item) return { ok: false, message: "Item não encontrado." };

  const check = await assertVersaoEditavel(
    item.versao_orcamento_id,
    session.activeTenant.id,
  );
  if ("error" in check) return { ok: false, message: check.error };

  const { error } = await supabase
    .from("versoes_orcamento_itens")
    .update(parsed.data)
    .eq("id", itemId)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[itens.atualizar]", error.message);
    return { ok: false, message: "Não foi possível atualizar o item." };
  }

  revalidatePath(`/orcamentos/${check.projeto_id}/${check.orcamento_id}`);
  return { ok: true, id: itemId };
}

/**
 * Grava UM campo de UM item — usada pela edição inline da planilha.
 * `campo` chega do cliente, então passa pela allowlist antes de virar
 * UPDATE. Os totais são colunas GENERATED: o banco recalcula sozinho.
 */
/** Tipos em que o cliente paga o fornecedor direto — os únicos com BV. */

/**
 * Chamado quando um item deixa de ser tipo A, AR ou D. O BV só faz sentido
 * nesses dois (é neles que o cliente paga o fornecedor direto e sobra
 * comissão), então a troca de tipo tem que decidir o destino do BV que
 * estava lá.
 *
 * - `a_negociar` → cancela junto, mesmo mecanismo do botão "Remover BV".
 * - `confirmado` / `recebido` → BLOQUEIA a troca de tipo. O BV já foi ao
 *   financeiro; cancelá-lo por um efeito colateral de outra célula seria
 *   apagar dinheiro sem que ninguém pedisse.
 *
 * Retorna a mensagem de bloqueio, ou null quando a troca pode seguir.
 */
async function resolverBvAoSairDoTipoComBv(
  itemId: string,
  tenantId: string,
  itemNome: string,
): Promise<string | null> {
  const supabase = createClient();

  const { data: bv } = await supabase
    .from("itens_bv")
    .select("id, valor, situacao")
    .eq("item_versao_id", itemId)
    .eq("tenant_id", tenantId)
    .neq("situacao", "cancelado")
    .maybeSingle<{ id: string; valor: number; situacao: string }>();

  if (!bv) return null;

  if (bv.situacao !== "a_negociar") {
    return bv.situacao === "recebido"
      ? "Este item tem BV já recebido. Não é possível mudar o tipo de custo."
      : "Este item tem BV já confirmado e enviado ao financeiro. Não é possível mudar o tipo de custo.";
  }

  const { error } = await supabase
    .from("itens_bv")
    .update({ situacao: "cancelado" })
    .eq("id", bv.id)
    .eq("tenant_id", tenantId);

  if (error) {
    console.error("[itens.tipoCusto.cancelaBv]", error.message);
    return "Não foi possível cancelar o BV deste item. Tipo de custo não alterado.";
  }

  await logAuditEvent({
    acao: "item_bv.cancelado",
    tenantId,
    entidadeTipo: "item_bv",
    entidadeId: bv.id,
    metadata: {
      item_versao_id: itemId,
      item: itemNome,
      valor: bv.valor,
      motivo: "tipo_custo_perdeu_bv",
    },
  });

  return null;
}

/** As três colunas do bloco PLANEJADO — as que `A` e `D` não digitam. */
const CAMPOS_PLANEJADO_DO_ITEM: readonly string[] = [
  "valor_unitario_planejado",
  "quantidade_planejada",
  "dias_meses_planejado",
];

export async function atualizarCampoItem(
  itemId: string,
  campo: string,
  valor: string | null,
): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "orcamentos.editar");
  if (!gate.ok) return gate;

  if (!isCampoItemEditavel(campo)) {
    return { ok: false, message: "Campo não editável." };
  }

  const parsed = camposItemEditaveis[campo].safeParse(valor ?? undefined);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.errors[0]?.message ?? "Valor inválido.",
    };
  }

  const supabase = createClient();

  // Um único round-trip: item + versão (embed to-one, payload mínimo).
  // Esta é a escrita de maior frequência do app — cada Enter numa célula
  // chega aqui, então não dá para encadear consultas como no atualizarItem.
  const { data: item, error: loadError } = await supabase
    .from("versoes_orcamento_itens")
    .select(
      "item, tipo_custo, versao_orcamento_id, " +
        "versao:versoes_orcamento!inner(orcamento_id, status)",
    )
    .eq("id", itemId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{
      item: string;
      tipo_custo: TipoCusto;
      versao_orcamento_id: string;
      versao: { orcamento_id: string; status: string };
    }>();

  if (loadError) {
    console.error("[itens.atualizarCampo.load]", loadError.message);
    return { ok: false, message: "Não foi possível carregar o item." };
  }
  if (!item?.versao) return { ok: false, message: "Item não encontrado." };
  if (item.versao.status === "aprovada") {
    return { ok: false, message: "Versão aprovada não permite alterar itens." };
  }

  // BV só existe em item tipo A, AR ou D. Sair desses tipos tem que resolver
  // o BV que estava lá, senão ele fica órfão no banco e invisível na
  // tela. A consulta extra só roda nesse caso: o caminho quente (cada
  // Enter numa célula numérica) continua com um round-trip só.
  if (campo === "tipo_custo" && !aceitaBV(String(parsed.data))) {
    const bloqueio = await resolverBvAoSairDoTipoComBv(
      itemId,
      session.activeTenant.id,
      item.item,
    );
    if (bloqueio) return { ok: false, message: bloqueio };
  }

  // `A` e `D`: o planejado ESPELHA o orçado e não é digitado. A tela já
  // trava as células, mas Server Action é endpoint — sem esta guarda a
  // escrita seguiria alcançável pelo console do navegador, e o item
  // ficaria com um planejado que a planilha não mostra.
  const tipoDepois = (
    campo === "tipo_custo" ? String(parsed.data) : item.tipo_custo
  ) as TipoCusto;
  const espelha = planejadoEspelhaOrcado(tipoDepois);

  if (espelha && CAMPOS_PLANEJADO_DO_ITEM.includes(campo)) {
    return {
      ok: false,
      message:
        "Em custo A e D o planejado acompanha o orçado — não é digitado.",
    };
  }

  // Quem GRAVA o espelho é o trigger `trg_planejado_espelha_orcado`, no
  // Postgres — são seis caminhos de escrita diferentes chegando nesta
  // tabela, e replicar a conta em cada um é como ela se perde. Aqui fica
  // só a recusa, que é o que devolve uma mensagem em português ao usuário
  // em vez de um erro de banco.
  const { error } = await supabase
    .from("versoes_orcamento_itens")
    .update({ [campo]: parsed.data })
    .eq("id", itemId)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[itens.atualizarCampo]", campo, error.message);
    return { ok: false, message: "Não foi possível salvar a alteração." };
  }

  const { data: orcCampo } = await supabase
    .from("orcamentos")
    .select("projeto_id")
    .eq("id", item.versao.orcamento_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ projeto_id: string }>();
  const projetoIdCampo = orcCampo?.projeto_id;

  revalidatePath(`/orcamentos/${projetoIdCampo}/${item.versao.orcamento_id}`);
  return { ok: true, id: itemId };
}

export async function removerItem(itemId: string): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "orcamentos.editar");
  if (!gate.ok) return gate;
  const supabase = createClient();

  const { data: item } = await supabase
    .from("versoes_orcamento_itens")
    .select("versao_orcamento_id")
    .eq("id", itemId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<Pick<VersaoOrcamentoItem, "versao_orcamento_id">>();

  if (!item) return { ok: false, message: "Item não encontrado." };

  const check = await assertVersaoEditavel(
    item.versao_orcamento_id,
    session.activeTenant.id,
  );
  if ("error" in check) return { ok: false, message: check.error };

  const { error } = await supabase
    .from("versoes_orcamento_itens")
    .delete()
    .eq("id", itemId)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[itens.remover]", error.message);
    return { ok: false, message: "Não foi possível remover o item." };
  }

  revalidatePath(`/orcamentos/${check.projeto_id}/${check.orcamento_id}`);
  return { ok: true, id: itemId };
}

// ============================================================
// APROVAÇÃO
// ============================================================

export async function aprovarVersao(versaoId: string): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "orcamentos.aprovar");
  if (!gate.ok) return gate;
  const supabase = createClient();

  // 1. Fetch versão + orçamento (com projeto_id pra revalidatePath)
  const { data: versao, error: errVer } = await supabase
    .from("versoes_orcamento")
    .select("id, status, orcamento_id, tenant_id, percentual_imposto")
    .eq("id", versaoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{
      id: string;
      status: string;
      orcamento_id: string;
      tenant_id: string;
      percentual_imposto: number;
    }>();

  if (errVer || !versao) {
    return { ok: false, message: "Versão não encontrada." };
  }

  if (!["rascunho", "em_revisao", "enviada_cliente"].includes(versao.status)) {
    return {
      ok: false,
      message: `Versão em status ${versao.status} não pode ser aprovada.`,
    };
  }


  // 2. Fetch orçamento pra validar status + projeto_id
  const { data: orc } = await supabase
    .from("orcamentos")
    .select("status, projeto_id")
    .eq("id", versao.orcamento_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ status: string; projeto_id: string }>();

  if (!orc) {
    return { ok: false, message: "Orçamento não encontrado." };
  }

  if (["job_criado", "aprovado", "cancelado"].includes(orc.status)) {
    return {
      ok: false,
      message: `Orçamento em status ${orc.status} não aceita nova aprovação.`,
    };
  }

  // 3. Verificar que a versão tem item E que ao menos um deles tem valor.
  //    Linha criada e não preenchida tem total_orcado 0 (coluna gerada:
  //    unitário × quantidade × dias). Aprovar assim travaria a versão e
  //    abriria job com orçado zerado.
  const [{ count: itensCount }, { count: comValorCount }, { count: orcadoZeradoCount }] =
    await Promise.all([
      supabase
        .from("versoes_orcamento_itens")
        .select("id", { count: "exact", head: true })
        .eq("versao_orcamento_id", versaoId)
        .eq("tenant_id", session.activeTenant.id),
      supabase
        .from("versoes_orcamento_itens")
        .select("id", { count: "exact", head: true })
        .eq("versao_orcamento_id", versaoId)
        .eq("tenant_id", session.activeTenant.id)
        .gt("total_orcado", 0),
      // Orçado zerado em qualquer item bloqueia (docs/decisions/011);
      // planejado zerado não entra na conta.
      supabase
        .from("versoes_orcamento_itens")
        .select("id", { count: "exact", head: true })
        .eq("versao_orcamento_id", versaoId)
        .eq("tenant_id", session.activeTenant.id)
        .eq("valor_unitario_orcado", 0),
    ]);

  // Alíquota escolhida + item com valor. Mesma função do botão "Aprovar
  // versão", para a tela e o servidor nunca discordarem do motivo.
  const bloqueio = bloqueioAprovacaoVersao({
    percentualImposto: Number(versao.percentual_imposto),
    qtdItens: itensCount ?? 0,
    qtdItensComValor: comValorCount ?? 0,
    qtdItensOrcadoZerado: orcadoZeradoCount ?? 0,
  });

  if (bloqueio) {
    return { ok: false, message: bloqueio };
  }

  const agora = new Date().toISOString();

  // 3b. CONGELA o BV de cada item no planejado.
  //
  // Depois da aprovação o BV continua editável — mas na planilha do JOB,
  // e lá ele já não pode mexer no planejado: o planejado é o compromisso
  // que o financeiro confere e abre. Sem este congelamento, editar o BV
  // no job reescreveria retroativamente o custo planejado da versão
  // aprovada. O valor novo se materializa no REALIZADO, e só quando
  // confirmado (docs/decisions/022).
  //
  // Falhar aqui NÃO aborta a aprovação: sem o congelamento a conta cai no
  // cálculo ao vivo, que dá o mesmo número enquanto ninguém mexer no BV.
  // Derrubar uma aprovação por causa disso seria pior que o defeito.
  const { data: bvsDaVersao, error: errBvs } = await supabase
    .from("itens_bv")
    .select("valor, item_versao_id, item:versoes_orcamento_itens!inner(versao_orcamento_id)")
    .eq("item.versao_orcamento_id", versaoId)
    .eq("tenant_id", session.activeTenant.id)
    .neq("situacao", "cancelado");

  if (errBvs) {
    console.error("[versao.aprovar.bv_congelar]", errBvs.message);
  } else {
    const taxa = Number(versao.percentual_imposto);
    await Promise.all(
      (bvsDaVersao ?? []).map((b: any) =>
        supabase
          .from("versoes_orcamento_itens")
          .update({ bv_liquido_planejado: bvLiquido(Number(b.valor ?? 0), taxa) })
          .eq("id", b.item_versao_id)
          .eq("tenant_id", session.activeTenant.id),
      ),
    );
  }

  // 4. Update versão (dispara trigger cascata pras outras versões)
  const { error: errUpdVer } = await supabase
    .from("versoes_orcamento")
    .update({
      status: "aprovada",
      aprovado_em: agora,
      aprovado_por: session.profile.id,
    })
    .eq("id", versaoId)
    .eq("tenant_id", session.activeTenant.id);

  if (errUpdVer) {
    console.error("[versao.aprovar]", errUpdVer.message);
    return { ok: false, message: "Não foi possível aprovar a versão." };
  }

  // 5. Update orçamento
  const { error: errUpdOrc } = await supabase
    .from("orcamentos")
    .update({
      status: "aprovado",
      versao_aprovada_id: versaoId,
      aprovado_em: agora,
      aprovado_por: session.profile.id,
    })
    .eq("id", versao.orcamento_id)
    .eq("tenant_id", session.activeTenant.id);

  if (errUpdOrc) {
    console.error("[orcamento.aprovar]", errUpdOrc.message);
    return {
      ok: false,
      message: "Versão aprovada mas orçamento não atualizado. Verifique manualmente.",
    };
  }

  await logAuditEvent({
    acao: "versao_orcamento.aprovada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "versao_orcamento",
    entidadeId: versaoId,
    metadata: { orcamento_id: versao.orcamento_id },
  });

  revalidatePath(`/orcamentos/${orc.projeto_id}`);
  revalidatePath(`/orcamentos/${orc.projeto_id}/${versao.orcamento_id}`);
  return { ok: true, id: versaoId };
}

export async function cancelarAprovacaoVersao(
  versaoId: string,
): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "orcamentos.aprovar");
  if (!gate.ok) return gate;
  const supabase = createClient();

  // 1. Fetch versão
  const { data: versao } = await supabase
    .from("versoes_orcamento")
    .select("id, status, orcamento_id")
    .eq("id", versaoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ id: string; status: string; orcamento_id: string }>();

  if (!versao) {
    return { ok: false, message: "Versão não encontrada." };
  }

  if (versao.status !== "aprovada") {
    return { ok: false, message: "Só versões aprovadas podem ter aprovação cancelada." };
  }

  // 2. Fetch orçamento (deve estar 'aprovado', não 'job_criado')
  const { data: orc } = await supabase
    .from("orcamentos")
    .select("status, projeto_id")
    .eq("id", versao.orcamento_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ status: string; projeto_id: string }>();

  if (!orc) {
    return { ok: false, message: "Orçamento não encontrado." };
  }

  if (orc.status !== "aprovado") {
    return {
      ok: false,
      message: `Orçamento está em status ${orc.status} — desaprovação não permitida.`,
    };
  }

  // 3. Verifica que não existe job ativo (não-cancelado) pra este orçamento
  const { count: jobsAtivos } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("orcamento_id", versao.orcamento_id)
    .eq("tenant_id", session.activeTenant.id)
    .neq("status", "cancelado");

  if ((jobsAtivos ?? 0) > 0) {
    return {
      ok: false,
      message: "Cancele o job antes de desaprovar a versão.",
    };
  }

  // 4. Update versão: volta pra 'em_revisao', limpa aprovado_em/por
  const { error: errUpdVer } = await supabase
    .from("versoes_orcamento")
    .update({
      status: "em_revisao",
      aprovado_em: null,
      aprovado_por: null,
    })
    .eq("id", versaoId)
    .eq("tenant_id", session.activeTenant.id);

  if (errUpdVer) {
    console.error("[versao.cancelarAprovacao]", errUpdVer.message);
    return { ok: false, message: "Não foi possível cancelar a aprovação." };
  }

  // 5. Reverter cascata: outras versões 'substituida' do orçamento voltam pra 'em_revisao'
  const { error: errRev } = await supabase
    .from("versoes_orcamento")
    .update({ status: "em_revisao" })
    .eq("orcamento_id", versao.orcamento_id)
    .eq("tenant_id", session.activeTenant.id)
    .eq("status", "substituida");

  if (errRev) {
    console.error("[versao.reverter_cascata]", errRev.message);
    // não bloqueia; log e segue
  }

  // 6. Update orçamento
  const { error: errUpdOrc } = await supabase
    .from("orcamentos")
    .update({
      status: "em_revisao",
      versao_aprovada_id: null,
      aprovado_em: null,
      aprovado_por: null,
    })
    .eq("id", versao.orcamento_id)
    .eq("tenant_id", session.activeTenant.id);

  if (errUpdOrc) {
    console.error("[orcamento.cancelarAprovacao]", errUpdOrc.message);
    return {
      ok: false,
      message: "Versão desaprovada mas orçamento não atualizado. Verifique manualmente.",
    };
  }

  await logAuditEvent({
    acao: "versao_orcamento.aprovacao_cancelada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "versao_orcamento",
    entidadeId: versaoId,
    metadata: { orcamento_id: versao.orcamento_id },
  });

  revalidatePath(`/orcamentos/${orc.projeto_id}`);
  revalidatePath(`/orcamentos/${orc.projeto_id}/${versao.orcamento_id}`);
  return { ok: true, id: versaoId };
}
