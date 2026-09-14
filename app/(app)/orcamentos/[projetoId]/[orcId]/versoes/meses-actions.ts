"use server";

/**
 * Meses da versão do orçamento mensal — Fee e Always On (decisão 078).
 *
 * "Editar meses" adiciona e apaga meses do trimestre, e "Copiar itens de
 * outro mês" monta um mês vazio a partir de outro. As três gravam por RPC
 * (migration 20260914200004), numa transação só; aqui ficam as regras que
 * devolvem frase de tela e a conta do período, que acompanha os meses.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { checarPermissao } from "@/lib/permissoes-server";
import {
  dataIsoValida,
  mesmoTrimestre,
  periodoQueAcompanhaOsMeses,
  primeiroDiaDoMes,
} from "@/lib/calculos/meses-trimestre";
import type { CategoriaModeloPlanilha } from "@/lib/types";

export type ResultadoMes =
  | { ok: true; itensCopiados?: number }
  | { ok: false; message: string };

type Supabase = ReturnType<typeof createClient>;

interface Contexto {
  versaoId: string;
  orcamentoId: string;
  projetoId: string;
  inicio: string | null;
  fim: string | null;
  meses: { id: string; mes: string }[];
}

async function carregarContexto(
  supabase: Supabase,
  tenantId: string,
  versaoId: string,
): Promise<{ ok: true; ctx: Contexto } | { ok: false; message: string }> {
  const { data: versao } = await supabase
    .from("versoes_orcamento")
    .select("id, orcamento_id, status")
    .eq("id", versaoId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ id: string; orcamento_id: string; status: string }>();
  if (!versao) return { ok: false, message: "Versão não encontrada." };
  if (versao.status === "aprovada" || versao.status === "cancelada") {
    return {
      ok: false,
      message: "Versão aprovada ou cancelada não aceita mudança nos meses.",
    };
  }

  const [orcRes, mesesRes] = await Promise.all([
    supabase
      .from("orcamentos")
      .select(
        "projeto_id, status, data_inicio_prevista, data_fim_prevista, " +
          // `!categoria_id`: `orcamentos` tem duas FKs para `categorias_dominio`.
          "categoria:categorias_dominio!categoria_id(modelo_planilha)",
      )
      .eq("id", versao.orcamento_id)
      .eq("tenant_id", tenantId)
      .maybeSingle<{
        projeto_id: string;
        status: string;
        data_inicio_prevista: string | null;
        data_fim_prevista: string | null;
        categoria: { modelo_planilha: CategoriaModeloPlanilha } | null;
      }>(),
    supabase
      .from("versoes_orcamento_meses")
      .select("id, mes")
      .eq("versao_orcamento_id", versaoId)
      .eq("tenant_id", tenantId)
      .order("mes", { ascending: true })
      .returns<{ id: string; mes: string }[]>(),
  ]);

  const orc = orcRes.data;
  if (!orc) return { ok: false, message: "Orçamento não encontrado." };
  if (orc.status === "aprovado" || orc.status === "job_criado") {
    return {
      ok: false,
      message: "Orçamento aprovado ou com job criado não aceita mudança nos meses.",
    };
  }
  if (orc.categoria?.modelo_planilha !== "mensal") {
    return {
      ok: false,
      message: "Só orçamentos de Fee e Always On são divididos em meses.",
    };
  }

  return {
    ok: true,
    ctx: {
      versaoId,
      orcamentoId: versao.orcamento_id,
      projetoId: orc.projeto_id,
      inicio: orc.data_inicio_prevista,
      fim: orc.data_fim_prevista,
      meses: mesesRes.data ?? [],
    },
  };
}

/** As frases que as RPCs levantam já estão em português; o resto vira a
 *  mensagem padrão da ação. */
function mensagemDoBanco(msg: string, padrao: string): string {
  if (msg.includes("pelo menos um mês")) {
    return "O orçamento precisa ter pelo menos um mês.";
  }
  if (msg.includes("mesmo trimestre")) {
    return "Os meses de um orçamento precisam ficar no mesmo trimestre.";
  }
  if (msg.includes("uniq_versoes_orcamento_meses_mes")) {
    return "Este mês já está no orçamento.";
  }
  if (msg.includes("mês vazio")) {
    return "O mês de destino já tem grupos. Só é possível copiar para um mês vazio.";
  }
  if (msg.includes("mês diferente")) {
    return "Escolha um mês diferente do atual.";
  }
  return padrao;
}

function revalidar(ctx: Contexto) {
  revalidatePath(`/orcamentos/${ctx.projetoId}`);
  revalidatePath(`/orcamentos/${ctx.projetoId}/${ctx.orcamentoId}`);
}

export async function adicionarMesNaVersao(
  versaoId: string,
  mes: string,
): Promise<ResultadoMes> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "orcamentos.editar");
  if (!gate.ok) return gate;
  if (!dataIsoValida(mes)) return { ok: false, message: "Mês inválido." };

  const supabase = createClient();
  const carregado = await carregarContexto(supabase, session.activeTenant.id, versaoId);
  if (!carregado.ok) return carregado;
  const { ctx } = carregado;

  const mesNovo = primeiroDiaDoMes(mes);
  if (ctx.meses.some((m) => m.mes === mesNovo)) {
    return { ok: false, message: "Este mês já está no orçamento." };
  }
  // O trimestre é a identidade do orçamento: vale o dos meses que já
  // existem, ou, sem nenhum, o do período.
  const referencia = ctx.meses[0]?.mes ?? ctx.inicio;
  if (referencia && !mesmoTrimestre(referencia, mesNovo)) {
    return {
      ok: false,
      message: "Só dá para adicionar meses do mesmo trimestre do orçamento.",
    };
  }

  const periodo = periodoQueAcompanhaOsMeses(
    ctx.inicio && ctx.fim ? { inicio: ctx.inicio, fim: ctx.fim } : null,
    [...ctx.meses.map((m) => m.mes), mesNovo],
  );

  const { error } = await supabase.rpc("adicionar_mes_na_versao", {
    p_versao_id: versaoId,
    p_mes: mesNovo,
    p_inicio: periodo?.inicio ?? null,
    p_fim: periodo?.fim ?? null,
  });
  if (error) {
    console.error("[meses.adicionar]", error.message);
    return {
      ok: false,
      message: mensagemDoBanco(error.message, "Não foi possível adicionar o mês."),
    };
  }

  await logAuditEvent({
    acao: "versao_orcamento.mes_adicionado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "versao_orcamento",
    entidadeId: versaoId,
    metadata: { mes: mesNovo, periodo },
  });

  revalidar(ctx);
  return { ok: true };
}

export async function removerMesDaVersao(mesId: string): Promise<ResultadoMes> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "orcamentos.editar");
  if (!gate.ok) return gate;

  const supabase = createClient();
  const { data: mes } = await supabase
    .from("versoes_orcamento_meses")
    .select("id, versao_orcamento_id, mes")
    .eq("id", mesId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ id: string; versao_orcamento_id: string; mes: string }>();
  if (!mes) return { ok: false, message: "Mês não encontrado." };

  const carregado = await carregarContexto(
    supabase,
    session.activeTenant.id,
    mes.versao_orcamento_id,
  );
  if (!carregado.ok) return carregado;
  const { ctx } = carregado;

  if (ctx.meses.length <= 1) {
    return { ok: false, message: "O orçamento precisa ter pelo menos um mês." };
  }

  // O que sai junto, para a auditoria — depois do delete não há de onde ler.
  const { data: grupos } = await supabase
    .from("versoes_orcamento_grupos")
    .select("id")
    .eq("mes_id", mesId)
    .eq("tenant_id", session.activeTenant.id)
    .returns<{ id: string }[]>();
  const grupoIds = (grupos ?? []).map((g) => g.id);
  const { count: itensRemovidos } =
    grupoIds.length > 0
      ? await supabase
          .from("versoes_orcamento_itens")
          .select("id", { count: "exact", head: true })
          .in("grupo_id", grupoIds)
          .eq("tenant_id", session.activeTenant.id)
      : { count: 0 };

  const periodo = periodoQueAcompanhaOsMeses(
    ctx.inicio && ctx.fim ? { inicio: ctx.inicio, fim: ctx.fim } : null,
    ctx.meses.filter((m) => m.id !== mesId).map((m) => m.mes),
  );

  const { error } = await supabase.rpc("remover_mes_da_versao", {
    p_mes_id: mesId,
    p_inicio: periodo?.inicio ?? null,
    p_fim: periodo?.fim ?? null,
  });
  if (error) {
    console.error("[meses.remover]", error.message);
    const emUso = /foreign key|violates|referenced/i.test(error.message);
    return {
      ok: false,
      message: emUso
        ? "Não foi possível apagar: há dados de job apontando para os itens deste mês."
        : mensagemDoBanco(error.message, "Não foi possível apagar o mês."),
    };
  }

  await logAuditEvent({
    acao: "versao_orcamento.mes_removido",
    tenantId: session.activeTenant.id,
    entidadeTipo: "versao_orcamento",
    entidadeId: ctx.versaoId,
    metadata: {
      mes: mes.mes,
      grupos_removidos: grupoIds.length,
      itens_removidos: itensRemovidos ?? 0,
      periodo,
    },
  });

  revalidar(ctx);
  return { ok: true };
}

export async function copiarItensDoMes(
  origemMesId: string,
  destinoMesId: string,
): Promise<ResultadoMes> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "orcamentos.editar");
  if (!gate.ok) return gate;

  const supabase = createClient();
  const { data: meses } = await supabase
    .from("versoes_orcamento_meses")
    .select("id, versao_orcamento_id, mes")
    .in("id", [origemMesId, destinoMesId])
    .eq("tenant_id", session.activeTenant.id)
    .returns<{ id: string; versao_orcamento_id: string; mes: string }[]>();
  const origem = meses?.find((m) => m.id === origemMesId);
  const destino = meses?.find((m) => m.id === destinoMesId);
  if (!origem || !destino) return { ok: false, message: "Mês não encontrado." };
  if (origem.versao_orcamento_id !== destino.versao_orcamento_id) {
    return { ok: false, message: "Os dois meses precisam ser da mesma versão." };
  }

  const carregado = await carregarContexto(
    supabase,
    session.activeTenant.id,
    destino.versao_orcamento_id,
  );
  if (!carregado.ok) return carregado;

  const { data: copiados, error } = await supabase.rpc("copiar_mes_da_versao", {
    p_origem_mes_id: origemMesId,
    p_destino_mes_id: destinoMesId,
  });
  if (error) {
    console.error("[meses.copiar]", error.message);
    return {
      ok: false,
      message: mensagemDoBanco(error.message, "Não foi possível copiar os itens."),
    };
  }

  await logAuditEvent({
    acao: "versao_orcamento.mes_copiado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "versao_orcamento",
    entidadeId: destino.versao_orcamento_id,
    metadata: { origem: origem.mes, destino: destino.mes, itens: copiados ?? 0 },
  });

  revalidar(carregado.ctx);
  return { ok: true, itensCopiados: Number(copiados ?? 0) };
}
