"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { createClient } from "@/lib/supabase/server";

type ActionResult<T = Record<string, unknown>> =
  | ({ ok: true } & T)
  | { ok: false; message: string };

type LinhaRateio = { regional_id: string; percentual: number };

function podeEditarRateio(role: string): boolean {
  return role === "administrador" || role === "rh";
}

/**
 * Salva o rateio de uma empresa em um ano. Substituição atômica: apaga as
 * linhas existentes e insere as novas. Só grava regionais com % > 0 (o
 * modelo trata regionais ausentes como 0%, ver docs da migration).
 *
 * Trigger de banco garante soma=100 no commit — mas checamos antes pra
 * dar mensagem de erro clara.
 */
export async function salvarRateioAno(input: {
  empresa_id: string;
  ano: number;
  linhas: LinhaRateio[];
}): Promise<ActionResult> {
  const session = await requireSession();
  if (!podeEditarRateio(session.activeRole)) {
    return { ok: false, message: "Sem permissão." };
  }

  const { empresa_id, ano, linhas } = input;

  if (!Number.isInteger(ano) || ano < 2020 || ano > 2099) {
    return { ok: false, message: "Ano inválido." };
  }
  if (linhas.length === 0) {
    return {
      ok: false,
      message: "Informe ao menos uma regional com percentual.",
    };
  }
  const linhasLimpas = linhas
    .map((l) => ({
      regional_id: l.regional_id,
      percentual: Number(l.percentual),
    }))
    .filter((l) => l.regional_id && l.percentual > 0);
  if (linhasLimpas.length === 0) {
    return {
      ok: false,
      message: "Informe ao menos uma regional com percentual > 0.",
    };
  }
  const soma = linhasLimpas.reduce((acc, l) => acc + l.percentual, 0);
  if (Math.abs(soma - 100) >= 0.01) {
    return {
      ok: false,
      message: `A soma dos percentuais precisa dar 100 (atual: ${soma.toFixed(2)}).`,
    };
  }
  // Duplicidade de regional
  const set = new Set<string>();
  for (const l of linhasLimpas) {
    if (set.has(l.regional_id)) {
      return {
        ok: false,
        message: "A mesma regional aparece mais de uma vez no rateio.",
      };
    }
    set.add(l.regional_id);
  }

  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  // Bloqueia edição de anos anteriores ao vigente (proteção do histórico).
  const anoAtual = new Date().getFullYear();
  if (ano < anoAtual) {
    return {
      ok: false,
      message: `Rateio de ${ano} é histórico e não pode ser editado. Configure a partir de ${anoAtual}.`,
    };
  }

  // Verifica que a empresa pertence ao tenant
  const { data: empresa } = await supabase
    .from("empresas")
    .select("id, nome_fantasia")
    .eq("id", empresa_id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!empresa) {
    return { ok: false, message: "Empresa não encontrada." };
  }

  // Swap atômico via trigger deferred:
  //   1) apaga o existente
  //   2) insere o novo
  // trg_rateios_soma_100 é DEFERRABLE INITIALLY DEFERRED — checa no commit.
  const { error: delError } = await supabase
    .from("empresas_rateios_regionais")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("empresa_id", empresa_id)
    .eq("ano_vigencia", ano);
  if (delError) {
    console.error("[rh.rateios.del]", delError.message);
    return { ok: false, message: "Falha ao substituir rateio." };
  }

  const rows = linhasLimpas.map((l) => ({
    tenant_id: tenantId,
    empresa_id,
    ano_vigencia: ano,
    regional_id: l.regional_id,
    percentual: l.percentual.toFixed(2),
    created_by: session.profile.id,
  }));
  const { error: insError } = await supabase
    .from("empresas_rateios_regionais")
    .insert(rows);
  if (insError) {
    console.error("[rh.rateios.ins]", insError.message);
    if (insError.message.includes("Soma dos percentuais do rateio")) {
      return {
        ok: false,
        message:
          "Soma dos percentuais precisa dar 100 (bloqueio do banco).",
      };
    }
    if (insError.message.includes("fk_rateio_regional_pertence_empresa")) {
      return {
        ok: false,
        message: "Alguma regional selecionada não pertence a esta empresa.",
      };
    }
    return { ok: false, message: "Falha ao gravar rateio." };
  }

  await logAuditEvent({
    acao: "rateio.regional.salvo",
    tenantId,
    entidadeTipo: "empresa",
    entidadeId: empresa_id,
    metadata: {
      empresa_nome: empresa.nome_fantasia,
      ano,
      linhas: linhasLimpas,
    },
  });

  revalidatePath("/rh/rateios");
  return { ok: true };
}

/**
 * Copia o rateio de um ano origem pra um ano destino. Útil pro fluxo
 * "abrir o rateio de 2027 baseado em 2026, só ajustar o que mudou".
 */
export async function copiarRateioParaAno(input: {
  empresa_id: string;
  ano_origem: number;
  ano_destino: number;
}): Promise<ActionResult> {
  const session = await requireSession();
  if (!podeEditarRateio(session.activeRole)) {
    return { ok: false, message: "Sem permissão." };
  }

  const { empresa_id, ano_origem, ano_destino } = input;

  if (ano_destino <= ano_origem) {
    return {
      ok: false,
      message: "Ano destino precisa ser posterior ao ano origem.",
    };
  }
  if (ano_destino < new Date().getFullYear()) {
    return {
      ok: false,
      message: "Só é possível criar rateio para o ano corrente ou futuros.",
    };
  }

  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  const { data: linhasOrigem, error: errOrigem } = await supabase
    .from("empresas_rateios_regionais")
    .select("regional_id, percentual")
    .eq("tenant_id", tenantId)
    .eq("empresa_id", empresa_id)
    .eq("ano_vigencia", ano_origem);
  if (errOrigem) {
    console.error("[rh.rateios.copiar.origem]", errOrigem.message);
    return { ok: false, message: "Falha ao ler rateio de origem." };
  }
  if (!linhasOrigem || linhasOrigem.length === 0) {
    return {
      ok: false,
      message: `Empresa não tem rateio configurado em ${ano_origem}.`,
    };
  }

  // Se já existe destino, aborta pra evitar sobrescrita acidental.
  const { count: temDestino } = await supabase
    .from("empresas_rateios_regionais")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("empresa_id", empresa_id)
    .eq("ano_vigencia", ano_destino);
  if (temDestino && temDestino > 0) {
    return {
      ok: false,
      message: `Já existe rateio em ${ano_destino}. Edite ele direto.`,
    };
  }

  const rows = (linhasOrigem as any[]).map((l) => ({
    tenant_id: tenantId,
    empresa_id,
    ano_vigencia: ano_destino,
    regional_id: l.regional_id,
    percentual: String(l.percentual),
    created_by: session.profile.id,
  }));

  const { error: insError } = await supabase
    .from("empresas_rateios_regionais")
    .insert(rows);
  if (insError) {
    console.error("[rh.rateios.copiar.ins]", insError.message);
    return { ok: false, message: "Falha ao criar rateio do novo ano." };
  }

  await logAuditEvent({
    acao: "rateio.regional.copiado",
    tenantId,
    entidadeTipo: "empresa",
    entidadeId: empresa_id,
    metadata: { ano_origem, ano_destino, linhas: rows.length },
  });

  revalidatePath("/rh/rateios");
  return { ok: true };
}
