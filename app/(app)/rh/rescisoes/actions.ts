"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { checarPermissao } from "@/lib/permissoes-server";
import { createClient } from "@/lib/supabase/server";
import {
  calcularSnapshotRescisao,
  calcularTotalLiquido,
} from "@/lib/rh/calculo-rescisao";

type Result =
  | { ok: true; id?: string; message?: string }
  | { ok: false; message: string };

/**
 * Edita o ajuste manual (desconto de benefícios, outros descontos) da
 * rescisão em rascunho e recalcula o líquido. Só funciona enquanto
 * `status='rascunho'` — depois que foi ao financeiro, trava.
 */
export async function atualizarAjusteRescisao(input: {
  rescisao_id: string;
  ajuste_valor: number;
  ajuste_motivo: string | null;
}): Promise<Result> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "rh.colaboradores.editar");
  if (!gate.ok) return gate;

  if (!Number.isFinite(input.ajuste_valor) || input.ajuste_valor < 0) {
    return { ok: false, message: "Valor de ajuste inválido." };
  }

  const supabase = createClient();

  const { data: resc, error: selErr } = await supabase
    .from("rescisoes")
    .select("id, status, total_bruto")
    .eq("id", input.rescisao_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (selErr || !resc) {
    return { ok: false, message: "Rescisão não encontrada." };
  }
  if (resc.status !== "rascunho") {
    return {
      ok: false,
      message: "Rescisão já enviada ao financeiro — não pode ser editada.",
    };
  }

  const totalBruto = Number(resc.total_bruto ?? 0);
  const totalLiquido = calcularTotalLiquido(totalBruto, input.ajuste_valor);

  const { error: updErr } = await supabase
    .from("rescisoes")
    .update({
      ajuste_valor: input.ajuste_valor,
      ajuste_motivo: input.ajuste_motivo?.trim() || null,
      total_liquido: totalLiquido,
      updated_by: session.profile.id,
    })
    .eq("id", input.rescisao_id);

  if (updErr) {
    console.error("[rh.rescisao.ajuste]", updErr.message);
    return { ok: false, message: "Falha ao salvar o ajuste." };
  }

  await logAuditEvent({
    acao: "rescisao.ajuste_editado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "rescisao",
    entidadeId: input.rescisao_id,
    metadata: {
      ajuste_valor: input.ajuste_valor,
      total_liquido: totalLiquido,
    },
  });

  revalidatePath("/rh/rescisoes");
  return { ok: true };
}

/**
 * Recalcula o snapshot (salário vigente, avos, valores) a partir do
 * estado atual do colaborador. Usado quando o RH editou o salário
 * depois que a rescisão foi criada, ou quando a rescisão nasceu sem
 * salário (colaborador sem registro ativo em colaboradores_salarios).
 * Preserva o ajuste manual.
 */
export async function recalcularRescisao(
  rescisaoId: string,
): Promise<Result> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "rh.colaboradores.editar");
  if (!gate.ok) return gate;

  const supabase = createClient();

  const { data: resc, error: selErr } = await supabase
    .from("rescisoes")
    .select(
      "id, status, colaborador_id, data_rescisao, ajuste_valor, colaborador:colaboradores!colaborador_id(data_admissao)",
    )
    .eq("id", rescisaoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (selErr || !resc) {
    return { ok: false, message: "Rescisão não encontrada." };
  }
  if (resc.status !== "rascunho") {
    return {
      ok: false,
      message: "Rescisão já enviada ao financeiro — não pode ser recalculada.",
    };
  }

  const colab = resc.colaborador as unknown as { data_admissao: string } | null;
  if (!colab?.data_admissao) {
    return { ok: false, message: "Data de admissão do colaborador não encontrada." };
  }

  const snapshot = await calcularSnapshotRescisao(
    supabase,
    resc.colaborador_id as string,
    colab.data_admissao,
    resc.data_rescisao as string,
  );

  if (!snapshot) {
    return {
      ok: false,
      message:
        "Colaborador sem salário vigente registrado. Cadastre o salário antes de recalcular.",
    };
  }

  const totalLiquido = calcularTotalLiquido(
    snapshot.total_bruto,
    Number(resc.ajuste_valor ?? 0),
  );

  const { error: updErr } = await supabase
    .from("rescisoes")
    .update({
      ...snapshot,
      total_liquido: totalLiquido,
      updated_by: session.profile.id,
    })
    .eq("id", rescisaoId);

  if (updErr) {
    console.error("[rh.rescisao.recalcular]", updErr.message);
    return { ok: false, message: "Falha ao recalcular." };
  }

  await logAuditEvent({
    acao: "rescisao.recalculada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "rescisao",
    entidadeId: rescisaoId,
    metadata: {
      total_bruto: snapshot.total_bruto,
      total_liquido: totalLiquido,
    },
  });

  revalidatePath("/rh/rescisoes");
  return { ok: true };
}

/**
 * Cria linha em `folhas_pagamento` com `tipo='rescisao'` e
 * `status='enviada'`, apontando `rescisao_id` pra rescisão. A linha
 * aparece na aba People de `/financeiro/contas-a-pagar` pela view
 * `vw_people_aprovar_financeiro` — mesmo caminho de salário, férias e
 * 13º. A alocação do colaborador vira linha em
 * `folhas_pagamento_alocacoes` (empresa + regional, ou rateio da
 * empresa quando `usa_rateio_empresa=true`), igual gerar_folha_mensal.
 *
 * Quando o financeiro mudar a linha pra `status='paga'`, o trigger
 * `trg_folha_rescisao_propaga_pagamento` marca a rescisão como `paga`.
 */
export async function enviarRescisaoAoFinanceiro(
  rescisaoId: string,
): Promise<Result> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "rh.colaboradores.editar");
  if (!gate.ok) return gate;

  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  const { data: resc, error: selErr } = await supabase
    .from("rescisoes")
    .select("id, status, colaborador_id, data_rescisao, total_liquido")
    .eq("id", rescisaoId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (selErr || !resc) {
    return { ok: false, message: "Rescisão não encontrada." };
  }
  if (resc.status !== "rascunho") {
    return { ok: false, message: "Rescisão já foi enviada." };
  }

  const totalLiquido = Number(resc.total_liquido ?? 0);
  if (totalLiquido <= 0) {
    return {
      ok: false,
      message: "Total líquido zero ou negativo. Recalcule antes de enviar.",
    };
  }

  // Alocação atual do colaborador. Rescisão é um evento de folha como
  // qualquer outro: entra com a alocação do dia do desligamento. Quando
  // `usa_rateio_empresa=true`, puxamos o rateio padrão da empresa pra o
  // ano, do mesmo jeito que `gerar_folha_da_competencia`.
  const { data: aloc } = await supabase
    .from("colaboradores_alocacoes")
    .select("empresa_id, regional_id, usa_rateio_empresa")
    .eq("colaborador_id", resc.colaborador_id as string)
    .is("data_fim", null)
    .order("data_inicio", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!aloc?.empresa_id) {
    return {
      ok: false,
      message:
        "Colaborador sem alocação ativa — defina empresa antes de enviar.",
    };
  }

  const dataRescisao = new Date(
    (resc.data_rescisao as string) + "T00:00:00",
  );
  const competenciaAno = dataRescisao.getFullYear();
  const competenciaMes = dataRescisao.getMonth() + 1;
  const dataPrevista = new Date(dataRescisao);
  dataPrevista.setDate(dataPrevista.getDate() + 10);

  const { data: linhaFolha, error: folhaErr } = await supabase
    .from("folhas_pagamento")
    .insert({
      tenant_id: tenantId,
      colaborador_id: resc.colaborador_id as string,
      competencia_ano: competenciaAno,
      competencia_mes: competenciaMes,
      salario_base: totalLiquido,
      status: "enviada",
      origem: "california",
      tipo: "rescisao",
      rescisao_id: rescisaoId,
      data_pagamento_prevista: dataPrevista.toISOString().slice(0, 10),
      enviada_em: new Date().toISOString(),
      enviada_por: session.profile.id,
      created_by: session.profile.id,
    })
    .select("id")
    .single();

  if (folhaErr || !linhaFolha) {
    console.error("[rh.rescisao.enviar.folha]", folhaErr?.message);
    return {
      ok: false,
      message: "Falha ao criar linha em folhas de pagamento.",
    };
  }

  // Alocação da linha: rateio padrão da empresa quando
  // `usa_rateio_empresa`, senão 100% na empresa+regional específica.
  if (aloc.usa_rateio_empresa) {
    const { data: rateios } = await supabase
      .from("empresas_rateios_regionais")
      .select("regional_id, percentual")
      .eq("tenant_id", tenantId)
      .eq("empresa_id", aloc.empresa_id as string)
      .eq("ano_vigencia", competenciaAno)
      .gt("percentual", 0);
    if (rateios && rateios.length > 0) {
      await supabase.from("folhas_pagamento_alocacoes").insert(
        rateios.map((r) => ({
          tenant_id: tenantId,
          folha_id: linhaFolha.id,
          empresa_id: aloc.empresa_id as string,
          regional_id: r.regional_id as string,
          percentual: r.percentual as number,
        })),
      );
    }
  } else if (aloc.regional_id) {
    await supabase.from("folhas_pagamento_alocacoes").insert({
      tenant_id: tenantId,
      folha_id: linhaFolha.id,
      empresa_id: aloc.empresa_id as string,
      regional_id: aloc.regional_id as string,
      percentual: 100,
    });
  }

  const { error: updErr } = await supabase
    .from("rescisoes")
    .update({
      status: "enviada_financeiro",
      enviada_em: new Date().toISOString(),
      enviada_por: session.profile.id,
      updated_by: session.profile.id,
    })
    .eq("id", rescisaoId);

  if (updErr) {
    console.error("[rh.rescisao.enviar.update]", updErr.message);
  }

  await logAuditEvent({
    acao: "rescisao.enviada_financeiro",
    tenantId,
    entidadeTipo: "rescisao",
    entidadeId: rescisaoId,
    metadata: {
      folha_pagamento_id: linhaFolha.id,
      total_liquido: totalLiquido,
      empresa_id: aloc.empresa_id,
    },
  });

  revalidatePath("/rh/rescisoes");
  revalidatePath("/financeiro/contas-a-pagar");
  return { ok: true, id: linhaFolha.id };
}
