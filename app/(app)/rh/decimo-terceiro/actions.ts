"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { createClient } from "@/lib/supabase/server";
import { pode } from "@/lib/permissoes";
import { calcularLinhaDecimoTerceiro } from "@/lib/decimo-terceiro/calc";
import type { TipoContratacao } from "@/lib/types";

export type ActionResult<T = Record<string, never>> =
  | ({ ok: true } & T)
  | { ok: false; message: string };

const CriarFolhaInput = z.object({
  ano: z.number().int().min(2020).max(2100),
});

interface ColaboradorElegivel {
  id: string;
  nome: string;
  cpf: string | null;
  tipo_contratacao: TipoContratacao;
  funcao: string;
  data_admissao: string;
  salario: string;
  empresa_id: string | null;
}

/**
 * Cria a folha de 13º do ano: valida que não existe, puxa colaboradores
 * elegíveis (CLT, CLT_recibo, PJ, MEI com algum dia de vínculo no ano),
 * grava snapshot + campos calculados pra cada linha.
 *
 * Em caso de erro depois de inserir o cabeçalho, deleta a folha pra não
 * deixar um cabeçalho sem linhas (compensação; Supabase JS não expõe
 * transação explicita de leitura+escrita).
 */
export async function criarFolhaDecimoTerceiro(
  anoInput: number,
): Promise<ActionResult<{ id: string; total_linhas: number }>> {
  const session = await requireSession();
  if (!pode(session.activeRole, "rh.decimo_terceiro.editar")) {
    return { ok: false, message: "Sem permissão para esta ação." };
  }

  const parsed = CriarFolhaInput.safeParse({ ano: anoInput });
  if (!parsed.success) {
    return { ok: false, message: "Ano inválido." };
  }
  const ano = parsed.data.ano;
  const tenantId = session.activeTenant.id;

  const supabase = createClient();

  // 1. Já existe folha pro ano?
  const { data: existente } = await supabase
    .from("decimo_terceiro_folhas")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("ano", ano)
    .maybeSingle();
  if (existente) {
    return { ok: false, message: `Já existe folha de 13º para ${ano}.` };
  }

  // 2. Colaboradores elegíveis + salário vigente + empresa alocada.
  // Query 1: colaboradores com tipo elegível e vínculo no ano.
  const { data: colaboradores, error: errColab } = await supabase
    .from("colaboradores")
    .select("id, nome, cpf, tipo_contratacao, funcao, data_admissao, data_encerramento")
    .eq("tenant_id", tenantId)
    .in("tipo_contratacao", ["clt", "clt_recibo", "pj", "mei"])
    .lte("data_admissao", `${ano}-12-31`);
  if (errColab) {
    return { ok: false, message: `Falha ao buscar colaboradores: ${errColab.message}` };
  }

  const elegiveisIds = (colaboradores ?? [])
    .filter(
      (c) =>
        c.data_encerramento == null ||
        c.data_encerramento >= `${ano}-01-01`,
    )
    .map((c) => c.id);

  if (elegiveisIds.length === 0) {
    return { ok: false, message: "Nenhum colaborador elegível para 13º no ano." };
  }

  // Query 2: salário vigente de cada elegível.
  const { data: salarios, error: errSal } = await supabase
    .from("colaboradores_salarios")
    .select("colaborador_id, valor")
    .eq("tenant_id", tenantId)
    .is("data_fim", null)
    .in("colaborador_id", elegiveisIds);
  if (errSal) {
    return { ok: false, message: `Falha ao buscar salários: ${errSal.message}` };
  }

  // Query 3: alocação vigente (empresa) — pega qualquer uma (a primeira
  // por created_at) por simplicidade da Parte 1. Rateio real fica pra
  // parte futura.
  const { data: alocacoes, error: errAloc } = await supabase
    .from("colaboradores_alocacoes")
    .select("colaborador_id, empresa_id, created_at")
    .eq("tenant_id", tenantId)
    .is("data_fim", null)
    .in("colaborador_id", elegiveisIds)
    .order("created_at", { ascending: true });
  if (errAloc) {
    return { ok: false, message: `Falha ao buscar alocações: ${errAloc.message}` };
  }

  const salarioPorColab = new Map(
    (salarios ?? []).map((s) => [s.colaborador_id, s.valor]),
  );
  const empresaPorColab = new Map<string, string>();
  for (const a of alocacoes ?? []) {
    if (!empresaPorColab.has(a.colaborador_id) && a.empresa_id) {
      empresaPorColab.set(a.colaborador_id, a.empresa_id);
    }
  }

  // Monta elegiveis com todos os dados necessários; descarta quem não
  // tem salário vigente (não deveria acontecer no dataset atual).
  const elegiveis: ColaboradorElegivel[] = (colaboradores ?? [])
    .filter((c) => elegiveisIds.includes(c.id) && salarioPorColab.has(c.id))
    .map((c) => ({
      id: c.id,
      nome: c.nome,
      cpf: c.cpf,
      tipo_contratacao: c.tipo_contratacao as TipoContratacao,
      funcao: c.funcao,
      data_admissao: c.data_admissao,
      salario: salarioPorColab.get(c.id) as string,
      empresa_id: empresaPorColab.get(c.id) ?? null,
    }));

  if (elegiveis.length === 0) {
    return { ok: false, message: "Nenhum colaborador elegível com salário vigente." };
  }

  // 3. Insert do cabeçalho.
  const { data: folhaInserida, error: errFolha } = await supabase
    .from("decimo_terceiro_folhas")
    .insert({
      tenant_id: tenantId,
      ano,
      criada_por: session.profile.id,
    })
    .select("id")
    .single();
  if (errFolha || !folhaInserida) {
    return {
      ok: false,
      message: `Falha ao criar folha: ${errFolha?.message ?? "sem retorno"}`,
    };
  }
  const folhaId = folhaInserida.id;

  // 4. Monta as linhas com snapshot + calculados.
  const linhas = elegiveis.map((c) => {
    const salarioNum = Number(c.salario);
    const calc = calcularLinhaDecimoTerceiro({
      salario: salarioNum,
      dataAdmissao: new Date(`${c.data_admissao}T00:00:00Z`),
      ano,
      tipoContratacao: c.tipo_contratacao,
      totalAdiantado: 0,
    });
    const obsAuto = calc.avos === 0 ? "Admitido após 15/12 — sem direito a avos" : null;
    return {
      tenant_id: tenantId,
      folha_id: folhaId,
      colaborador_id: c.id,
      snapshot_nome: c.nome,
      snapshot_cpf: c.cpf,
      snapshot_tipo_contratacao: c.tipo_contratacao,
      snapshot_funcao: c.funcao,
      snapshot_data_admissao: c.data_admissao,
      snapshot_salario: salarioNum,
      snapshot_empresa_id: c.empresa_id,
      avos: calc.avos,
      total_adiantado: 0,
      primeira_parcela: calc.primeiraParcela,
      segunda_parcela: calc.segundaParcela,
      desconto_inss: calc.descontoInss,
      desconto_irrf: calc.descontoIrrf,
      total_bruto: calc.totalBruto,
      total_liquido: calc.totalLiquido,
      editado_manualmente: false,
      salario_editado: null,
      avos_editado: null,
      obs: obsAuto,
      created_by: session.profile.id,
      updated_by: session.profile.id,
    };
  });

  // 5. Bulk insert das linhas. Em erro, compensa deletando a folha.
  const { error: errLinhas } = await supabase
    .from("decimo_terceiro_linhas")
    .insert(linhas);
  if (errLinhas) {
    await supabase.from("decimo_terceiro_folhas").delete().eq("id", folhaId);
    return {
      ok: false,
      message: `Falha ao criar linhas: ${errLinhas.message}`,
    };
  }

  await logAuditEvent({
    acao: "decimo_terceiro.folha.criada",
    tenantId,
    entidadeTipo: "decimo_terceiro_folha",
    entidadeId: folhaId,
    metadata: { ano, total_linhas: linhas.length },
  });

  revalidatePath("/rh/decimo-terceiro");

  return { ok: true, id: folhaId, total_linhas: linhas.length };
}
