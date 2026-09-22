"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { checarPermissao } from "@/lib/permissoes-server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  gerarFolhaSchema,
  linhaFolhaSchema,
} from "@/lib/validations/rh-folhas";

type ActionResult<T = Record<string, unknown>> =
  | ({ ok: true } & T)
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

function primeiroDiaDoMes(ano: number, mes: number): string {
  return `${ano}-${String(mes).padStart(2, "0")}-01`;
}

function ultimoDiaDoMes(ano: number, mes: number): string {
  const d = new Date(ano, mes, 0); // JS Date com month=0..11; mes aqui é 1..12, então mes=10 → Date(ano, 10, 0) = último dia de outubro
  return `${ano}-${String(mes).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Gera a folha de uma competência. Idempotente por colaborador.
 *
 * Novo modelo de alocação (2026-09-23):
 *   • Camada 1 tem 1 alocação vigente por colaborador — ou regional
 *     específica (100% ali) ou "toda a empresa" (regional_id=null,
 *     usa_rateio_empresa=true).
 *   • Snapshot da folha (`folhas_pagamento_alocacoes`) continua sendo
 *     N linhas com % somando 100 — o motor EXPANDE aqui:
 *       - regional específica → 1 linha 100%
 *       - toda a empresa → N linhas conforme rateio da empresa+ano da
 *         competência (empresas_rateios_regionais)
 *   • Se toggle=ON e a empresa não tem rateio configurado pra o ano da
 *     competência, colaborador é pulado com aviso.
 *
 * Regra de inclusão: entra todo colaborador que esteve ativo em qualquer
 * dia da competência (data_admissao <= último dia AND
 * (status=ativo OR data_encerramento >= primeiro dia)).
 */
export async function gerarFolha(input: {
  ano: number;
  mes: number;
}): Promise<
  ActionResult<{
    criadas: number;
    ja_existiam: number;
    pulados_sem_salario: string[];
    pulados_sem_alocacao: string[];
    pulados_sem_rateio: string[];
  }>
> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "rh.folhas.editar_rh");
  if (!gate.ok) return gate;

  const parsed = gerarFolhaSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Competência inválida.",
    };
  }
  const { ano, mes } = parsed.data;
  const primeiroDia = primeiroDiaDoMes(ano, mes);
  const ultimoDia = ultimoDiaDoMes(ano, mes);

  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  // Passo 1: quem entra na folha
  const { data: colaboradores, error: colabError } = await supabase
    .from("colaboradores")
    .select("id, nome")
    .eq("tenant_id", tenantId)
    .lte("data_admissao", ultimoDia)
    .or(`status.eq.ativo,data_encerramento.gte.${primeiroDia}`);

  if (colabError) {
    console.error("[folha.gerar.colaboradores]", colabError.message);
    return { ok: false, message: "Falha ao listar colaboradores." };
  }

  const colaboradoresCandidatos = (colaboradores ?? []) as {
    id: string;
    nome: string;
  }[];
  if (colaboradoresCandidatos.length === 0) {
    return {
      ok: true,
      criadas: 0,
      ja_existiam: 0,
      pulados_sem_salario: [],
      pulados_sem_alocacao: [],
      pulados_sem_rateio: [],
    };
  }

  // Passo 2: quem já tem folha nesta competência (idempotência)
  const { data: existentes } = await supabase
    .from("folhas_pagamento")
    .select("colaborador_id")
    .eq("tenant_id", tenantId)
    .eq("competencia_ano", ano)
    .eq("competencia_mes", mes);
  const jaTemFolha = new Set(
    ((existentes ?? []) as { colaborador_id: string }[]).map(
      (x) => x.colaborador_id,
    ),
  );
  const faltantes = colaboradoresCandidatos.filter(
    (c) => !jaTemFolha.has(c.id),
  );
  const jaExistiam = colaboradoresCandidatos.length - faltantes.length;

  if (faltantes.length === 0) {
    return {
      ok: true,
      criadas: 0,
      ja_existiam: jaExistiam,
      pulados_sem_salario: [],
      pulados_sem_alocacao: [],
      pulados_sem_rateio: [],
    };
  }

  // Passo 3: salário vigente + alocação vigente (1 por colaborador) + rateios do ano
  const faltantesIds = faltantes.map((c) => c.id);
  const [salariosRes, alocRes, rateiosRes] = await Promise.all([
    supabase
      .from("colaboradores_salarios")
      .select("colaborador_id, valor")
      .in("colaborador_id", faltantesIds)
      .eq("tenant_id", tenantId)
      .is("data_fim", null),
    supabase
      .from("colaboradores_alocacoes")
      .select("colaborador_id, empresa_id, regional_id, usa_rateio_empresa")
      .in("colaborador_id", faltantesIds)
      .eq("tenant_id", tenantId)
      .is("data_fim", null),
    supabase
      .from("empresas_rateios_regionais")
      .select("empresa_id, regional_id, percentual")
      .eq("tenant_id", tenantId)
      .eq("ano_vigencia", ano),
  ]);

  const salarioPor = new Map<string, string>();
  for (const s of (salariosRes.data ?? []) as {
    colaborador_id: string;
    valor: string | number;
  }[]) {
    salarioPor.set(s.colaborador_id, String(s.valor));
  }

  // Uma alocação vigente por colaborador (unique parcial garante isso).
  const alocPor = new Map<
    string,
    {
      empresa_id: string;
      regional_id: string | null;
      usa_rateio_empresa: boolean;
    }
  >();
  for (const a of (alocRes.data ?? []) as {
    colaborador_id: string;
    empresa_id: string;
    regional_id: string | null;
    usa_rateio_empresa: boolean;
  }[]) {
    alocPor.set(a.colaborador_id, {
      empresa_id: a.empresa_id,
      regional_id: a.regional_id,
      usa_rateio_empresa: a.usa_rateio_empresa,
    });
  }

  // Rateio por empresa: apenas as regionais com % > 0 no ano.
  const rateioPor = new Map<
    string,
    { regional_id: string; percentual: string }[]
  >();
  for (const r of (rateiosRes.data ?? []) as {
    empresa_id: string;
    regional_id: string;
    percentual: string | number;
  }[]) {
    const lista = rateioPor.get(r.empresa_id) ?? [];
    lista.push({
      regional_id: r.regional_id,
      percentual: String(r.percentual),
    });
    rateioPor.set(r.empresa_id, lista);
  }

  // Passo 4: separa quem pode entrar
  const pulados_sem_salario: string[] = [];
  const pulados_sem_alocacao: string[] = [];
  const pulados_sem_rateio: string[] = [];
  const paraCriar: {
    colab: { id: string; nome: string };
    salario: string;
    alocacoes: {
      empresa_id: string;
      regional_id: string;
      percentual: string;
    }[];
  }[] = [];

  for (const c of faltantes) {
    const salario = salarioPor.get(c.id);
    if (!salario) {
      pulados_sem_salario.push(c.nome);
      continue;
    }
    const aloc = alocPor.get(c.id);
    if (!aloc) {
      pulados_sem_alocacao.push(c.nome);
      continue;
    }

    // Expande no snapshot conforme o modo da Camada 1
    let alocSnapshot: {
      empresa_id: string;
      regional_id: string;
      percentual: string;
    }[];
    if (aloc.usa_rateio_empresa) {
      const rateio = rateioPor.get(aloc.empresa_id);
      if (!rateio || rateio.length === 0) {
        pulados_sem_rateio.push(c.nome);
        continue;
      }
      alocSnapshot = rateio.map((r) => ({
        empresa_id: aloc.empresa_id,
        regional_id: r.regional_id,
        percentual: r.percentual,
      }));
    } else {
      if (!aloc.regional_id) {
        pulados_sem_alocacao.push(c.nome);
        continue;
      }
      alocSnapshot = [
        {
          empresa_id: aloc.empresa_id,
          regional_id: aloc.regional_id,
          percentual: "100.00",
        },
      ];
    }
    paraCriar.push({ colab: c, salario, alocacoes: alocSnapshot });
  }

  if (paraCriar.length === 0) {
    return {
      ok: true,
      criadas: 0,
      ja_existiam: jaExistiam,
      pulados_sem_salario,
      pulados_sem_alocacao,
      pulados_sem_rateio,
    };
  }

  // Passo 5: insere folhas_pagamento em bulk
  const linhasFolha = paraCriar.map((p) => ({
    tenant_id: tenantId,
    colaborador_id: p.colab.id,
    competencia_ano: ano,
    competencia_mes: mes,
    salario_base: p.salario,
    status: "rascunho" as const,
    created_by: session.profile.id,
  }));

  const { data: folhaIds, error: insFolhaError } = await supabase
    .from("folhas_pagamento")
    .insert(linhasFolha)
    .select("id, colaborador_id");

  if (insFolhaError) {
    console.error("[folha.gerar.insert_folhas]", insFolhaError.message);
    return { ok: false, message: "Falha ao criar linhas da folha." };
  }

  const folhaIdPorColab = new Map<string, string>();
  for (const f of (folhaIds ?? []) as {
    id: string;
    colaborador_id: string;
  }[]) {
    folhaIdPorColab.set(f.colaborador_id, f.id);
  }

  // Passo 6: insere folhas_pagamento_alocacoes em bulk
  const linhasAloc: {
    tenant_id: string;
    folha_id: string;
    empresa_id: string;
    regional_id: string;
    percentual: string;
  }[] = [];
  for (const p of paraCriar) {
    const folhaId = folhaIdPorColab.get(p.colab.id);
    if (!folhaId) continue;
    for (const a of p.alocacoes) {
      linhasAloc.push({
        tenant_id: tenantId,
        folha_id: folhaId,
        empresa_id: a.empresa_id,
        regional_id: a.regional_id,
        percentual: a.percentual,
      });
    }
  }

  const { error: insAlocError } = await supabase
    .from("folhas_pagamento_alocacoes")
    .insert(linhasAloc);

  if (insAlocError) {
    console.error("[folha.gerar.insert_alocacoes]", insAlocError.message);
    // Rollback manual: deleta as folhas_pagamento criadas
    const service = createServiceClient();
    await service
      .from("folhas_pagamento")
      .delete()
      .in(
        "id",
        Array.from(folhaIdPorColab.values()),
      );
    return { ok: false, message: "Falha ao copiar alocações." };
  }

  await logAuditEvent({
    acao: "folha.gerada",
    tenantId,
    entidadeTipo: "folha",
    entidadeId: `${ano}-${String(mes).padStart(2, "0")}`,
    metadata: {
      ano,
      mes,
      criadas: paraCriar.length,
      ja_existiam: jaExistiam,
      pulados_sem_salario,
      pulados_sem_alocacao,
      pulados_sem_rateio,
    },
  });

  // Só revalida a lista: /rh/folhas. O hub /rh e a página da competência
  // não precisam ser marcados stale aqui — o hub não muda visualmente com
  // folha recém-criada (contagem no card é de pendências, não rascunhos),
  // e a página da competência é hidratada no primeiro acesso. Marcar
  // essas duas é trabalho de SSR gasto sem ninguém esperando.
  revalidatePath("/rh/folhas");
  return {
    ok: true,
    criadas: paraCriar.length,
    ja_existiam: jaExistiam,
    pulados_sem_salario,
    pulados_sem_alocacao,
    pulados_sem_rateio,
  };
}

/**
 * Edita uma linha da folha pelo RH. Só permitido quando status é
 * rascunho ou pendente_correcao. Se estava pendente_correcao, o
 * motivo_pendencia é limpo (mas o motivo permanece no audit).
 *
 * Regra da soma=100 é enforçada pelo constraint trigger deferred no
 * banco. Aqui só orquestra o swap: deleta as alocações antigas, insere
 * as novas — o trigger valida no commit.
 */
export async function editarLinhaFolhaRh(
  folhaId: string,
  payload: {
    salario_base: string;
    alocacoes: {
      empresa_id: string;
      regional_id: string;
      percentual: string;
    }[];
  },
): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "rh.folhas.editar_rh");
  if (!gate.ok) return gate;

  const parsed = linhaFolhaSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  // 1) Confirma que a linha existe, pertence ao tenant e está em estado editável pelo RH
  const { data: folha, error: folhaError } = await supabase
    .from("folhas_pagamento")
    .select(
      "id, salario_base, status, colaborador_id, competencia_ano, competencia_mes",
    )
    .eq("id", folhaId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (folhaError || !folha) {
    return { ok: false, message: "Linha da folha não encontrada." };
  }
  if (folha.status !== "rascunho" && folha.status !== "pendente_correcao") {
    return {
      ok: false,
      message: `Linha em status "${folha.status}" não é editável pelo RH.`,
    };
  }

  const valorAnterior = String(folha.salario_base);

  // 2) Atualiza o salario_base + limpa motivo_pendencia se estava pendente
  const patch: {
    salario_base: string;
    motivo_pendencia?: string | null;
  } = {
    salario_base: parsed.data.salario_base,
  };
  if (folha.status === "pendente_correcao") {
    patch.motivo_pendencia = null;
  }

  const { error: upError } = await supabase
    .from("folhas_pagamento")
    .update(patch)
    .eq("id", folhaId);
  if (upError) {
    console.error("[folha.editar_rh.folha]", upError.message);
    return { ok: false, message: "Falha ao atualizar a linha." };
  }

  // 3) Swap das alocações (deleta antigas, insere novas — trigger deferred valida no commit)
  const { error: delError } = await supabase
    .from("folhas_pagamento_alocacoes")
    .delete()
    .eq("folha_id", folhaId);
  if (delError) {
    console.error("[folha.editar_rh.del_aloc]", delError.message);
    return { ok: false, message: "Falha ao substituir alocações." };
  }

  const linhasAloc = parsed.data.alocacoes.map((a) => ({
    tenant_id: tenantId,
    folha_id: folhaId,
    empresa_id: a.empresa_id,
    regional_id: a.regional_id,
    percentual: a.percentual,
  }));

  const { error: insError } = await supabase
    .from("folhas_pagamento_alocacoes")
    .insert(linhasAloc);
  if (insError) {
    console.error("[folha.editar_rh.ins_aloc]", insError.message);
    if (insError.message.includes("Rateio de alocacoes")) {
      return {
        ok: false,
        message: "A soma dos percentuais das alocações precisa dar 100.",
      };
    }
    return { ok: false, message: "Falha ao gravar alocações." };
  }

  await logAuditEvent({
    acao: "folha.linha.editada_rh",
    tenantId,
    entidadeTipo: "folha",
    entidadeId: folhaId,
    metadata: {
      colaborador_id: folha.colaborador_id,
      competencia: `${folha.competencia_ano}-${String(folha.competencia_mes).padStart(2, "0")}`,
      salario_anterior: valorAnterior,
      salario_novo: parsed.data.salario_base,
      alocacoes_novas: parsed.data.alocacoes,
      status_anterior: folha.status,
    },
  });

  const chaveCompetencia = `${folha.competencia_ano}-${String(folha.competencia_mes).padStart(2, "0")}`;
  revalidatePath("/rh");
  revalidatePath("/rh/folhas");
  revalidatePath(`/rh/folhas/${chaveCompetencia}`);
  return { ok: true, id: folhaId };
}

/**
 * Envia uma linha de folha do RH para o financeiro. Muda status de
 * rascunho|pendente_correcao → enviada. Limpa motivo_pendencia se
 * estava em pendente_correcao.
 */
export async function enviarLinhaFolha(
  folhaId: string,
): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "rh.folhas.editar_rh");
  if (!gate.ok) return gate;

  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  const { data: folha, error: folhaError } = await supabase
    .from("folhas_pagamento")
    .select("id, status, competencia_ano, competencia_mes, colaborador_id")
    .eq("id", folhaId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (folhaError || !folha) {
    return { ok: false, message: "Linha da folha não encontrada." };
  }
  if (folha.status !== "rascunho" && folha.status !== "pendente_correcao") {
    return {
      ok: false,
      message: `Linha em status "${folha.status}" não pode ser enviada.`,
    };
  }

  const { error: upError } = await supabase
    .from("folhas_pagamento")
    .update({
      status: "enviada",
      motivo_pendencia: null,
      enviada_em: new Date().toISOString(),
      enviada_por: session.profile.id,
    })
    .eq("id", folhaId);
  if (upError) {
    console.error("[folha.enviar]", upError.message);
    return { ok: false, message: "Não foi possível enviar." };
  }

  await logAuditEvent({
    acao: "folha.linha.enviada",
    tenantId,
    entidadeTipo: "folha",
    entidadeId: folhaId,
    metadata: {
      colaborador_id: folha.colaborador_id,
      competencia: `${folha.competencia_ano}-${String(folha.competencia_mes).padStart(2, "0")}`,
      status_anterior: folha.status,
    },
  });

  const chave = `${folha.competencia_ano}-${String(folha.competencia_mes).padStart(2, "0")}`;
  revalidatePath("/rh");
  revalidatePath("/rh/folhas");
  revalidatePath(`/rh/folhas/${chave}`);
  revalidatePath("/financeiro/contas-a-pagar");
  return { ok: true, id: folhaId };
}

/**
 * Envia todas as linhas em rascunho|pendente_correcao de uma competência.
 * Ação em lote. Retorna quantas foram enviadas.
 */
export async function enviarFolhaInteira(
  ano: number,
  mes: number,
): Promise<
  ActionResult<{ enviadas: number; falhas: number }>
> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "rh.folhas.editar_rh");
  if (!gate.ok) return gate;

  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  const { data: linhas, error } = await supabase
    .from("folhas_pagamento")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("competencia_ano", ano)
    .eq("competencia_mes", mes)
    .in("status", ["rascunho", "pendente_correcao"]);

  if (error) {
    console.error("[folha.enviar_tudo.list]", error.message);
    return { ok: false, message: "Falha ao listar linhas." };
  }

  const ids = ((linhas ?? []) as { id: string }[]).map((l) => l.id);
  if (ids.length === 0) {
    return { ok: true, enviadas: 0, falhas: 0 };
  }

  const { error: upError } = await supabase
    .from("folhas_pagamento")
    .update({
      status: "enviada",
      motivo_pendencia: null,
      enviada_em: new Date().toISOString(),
      enviada_por: session.profile.id,
    })
    .in("id", ids);

  if (upError) {
    console.error("[folha.enviar_tudo.up]", upError.message);
    return { ok: false, message: "Falha ao enviar em lote." };
  }

  await logAuditEvent({
    acao: "folha.linha.enviada",
    tenantId,
    entidadeTipo: "folha",
    entidadeId: `${ano}-${String(mes).padStart(2, "0")}`,
    metadata: { competencia: `${ano}-${mes}`, quantidade: ids.length, lote: true },
  });

  const chave = `${ano}-${String(mes).padStart(2, "0")}`;
  revalidatePath("/rh");
  revalidatePath("/rh/folhas");
  revalidatePath(`/rh/folhas/${chave}`);
  revalidatePath("/financeiro/contas-a-pagar");
  return { ok: true, enviadas: ids.length, falhas: 0 };
}
