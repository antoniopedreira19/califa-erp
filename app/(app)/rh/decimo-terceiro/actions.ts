"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { createClient } from "@/lib/supabase/server";
import { pode } from "@/lib/permissoes";
import { calcularLinhaDecimoTerceiro } from "@/lib/decimo-terceiro/calc";
import {
  gerarXlsxFolhaDecimoTerceiro,
  type LinhaExport,
} from "@/lib/decimo-terceiro/export-xlsx";
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

// ----------------- Editar linha -----------------

const EditarLinhaInput = z.object({
  salario_editado: z
    .number()
    .nonnegative()
    .nullable(),
  avos_editado: z.number().int().min(0).max(12).nullable(),
  obs: z.string().max(1000).nullable(),
});

export async function editarLinhaDecimoTerceiro(
  linhaId: string,
  input: {
    salario_editado: number | null;
    avos_editado: number | null;
    obs: string | null;
  },
): Promise<ActionResult<{ id: string }>> {
  const session = await requireSession();
  if (!pode(session.activeRole, "rh.decimo_terceiro.editar")) {
    return { ok: false, message: "Sem permissão para esta ação." };
  }
  const parsed = EditarLinhaInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Dados inválidos." };
  }

  const tenantId = session.activeTenant.id;
  const supabase = createClient();

  const { data: linha, error: errLinha } = await supabase
    .from("decimo_terceiro_linhas")
    .select(
      "id, folha_id, snapshot_tipo_contratacao, snapshot_data_admissao, snapshot_salario, total_adiantado",
    )
    .eq("id", linhaId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (errLinha || !linha) {
    return { ok: false, message: "Linha não encontrada." };
  }

  const { data: folha, error: errFolha } = await supabase
    .from("decimo_terceiro_folhas")
    .select("ano")
    .eq("id", linha.folha_id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (errFolha || !folha) {
    return { ok: false, message: "Folha não encontrada." };
  }

  const calc = calcularLinhaDecimoTerceiro({
    salario: Number(linha.snapshot_salario),
    dataAdmissao: new Date(`${linha.snapshot_data_admissao}T00:00:00Z`),
    ano: folha.ano,
    tipoContratacao: linha.snapshot_tipo_contratacao as TipoContratacao,
    totalAdiantado: Number(linha.total_adiantado),
    salarioEditado: parsed.data.salario_editado,
    avosEditado: parsed.data.avos_editado,
  });

  const editadoManualmente =
    parsed.data.salario_editado != null || parsed.data.avos_editado != null;

  const { error: errUpd } = await supabase
    .from("decimo_terceiro_linhas")
    .update({
      avos: calc.avos,
      primeira_parcela: calc.primeiraParcela,
      segunda_parcela: calc.segundaParcela,
      desconto_inss: calc.descontoInss,
      desconto_irrf: calc.descontoIrrf,
      total_bruto: calc.totalBruto,
      total_liquido: calc.totalLiquido,
      salario_editado: parsed.data.salario_editado,
      avos_editado: parsed.data.avos_editado,
      obs: parsed.data.obs,
      editado_manualmente: editadoManualmente,
      updated_by: session.profile.id,
    })
    .eq("id", linhaId)
    .eq("tenant_id", tenantId);
  if (errUpd) {
    return { ok: false, message: `Falha ao salvar: ${errUpd.message}` };
  }

  await logAuditEvent({
    acao: "decimo_terceiro.linha.editada",
    tenantId,
    entidadeTipo: "decimo_terceiro_linha",
    entidadeId: linhaId,
    metadata: {
      salario_editado: parsed.data.salario_editado,
      avos_editado: parsed.data.avos_editado,
    },
  });

  revalidatePath(`/rh/decimo-terceiro/${folha.ano}`);

  return { ok: true, id: linhaId };
}

// ----------------- Recalcular folha -----------------

export async function recalcularFolhaDecimoTerceiro(
  folhaId: string,
): Promise<ActionResult<{ total_recalculadas: number }>> {
  const session = await requireSession();
  if (!pode(session.activeRole, "rh.decimo_terceiro.editar")) {
    return { ok: false, message: "Sem permissão para esta ação." };
  }
  const tenantId = session.activeTenant.id;
  const supabase = createClient();

  const { data: folha, error: errFolha } = await supabase
    .from("decimo_terceiro_folhas")
    .select("id, ano")
    .eq("id", folhaId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (errFolha || !folha) {
    return { ok: false, message: "Folha não encontrada." };
  }

  const { data: linhas, error: errLinhas } = await supabase
    .from("decimo_terceiro_linhas")
    .select(
      "id, colaborador_id, snapshot_tipo_contratacao, snapshot_data_admissao, snapshot_salario, total_adiantado, editado_manualmente",
    )
    .eq("folha_id", folhaId)
    .eq("tenant_id", tenantId)
    .eq("editado_manualmente", false);
  if (errLinhas) {
    return { ok: false, message: `Falha ao buscar linhas: ${errLinhas.message}` };
  }

  if (!linhas || linhas.length === 0) {
    await supabase
      .from("decimo_terceiro_folhas")
      .update({
        recalculada_em: new Date().toISOString(),
        recalculada_por: session.profile.id,
      })
      .eq("id", folhaId)
      .eq("tenant_id", tenantId);
    return { ok: true, total_recalculadas: 0 };
  }

  // Rebuscar salário vigente de todos os colaboradores das linhas não editadas.
  const colabIds = linhas.map((l) => l.colaborador_id);
  const { data: salariosAtuais, error: errSal } = await supabase
    .from("colaboradores_salarios")
    .select("colaborador_id, valor")
    .eq("tenant_id", tenantId)
    .is("data_fim", null)
    .in("colaborador_id", colabIds);
  if (errSal) {
    return { ok: false, message: `Falha ao buscar salários: ${errSal.message}` };
  }

  // Rebuscar data_admissao atual (caso tenha mudado).
  const { data: colabsAtuais, error: errCol } = await supabase
    .from("colaboradores")
    .select("id, data_admissao")
    .eq("tenant_id", tenantId)
    .in("id", colabIds);
  if (errCol) {
    return { ok: false, message: `Falha ao buscar colaboradores: ${errCol.message}` };
  }

  const salPorColab = new Map(
    (salariosAtuais ?? []).map((s) => [s.colaborador_id, s.valor]),
  );
  const admissaoPorColab = new Map(
    (colabsAtuais ?? []).map((c) => [c.id, c.data_admissao]),
  );

  // Dispara os updates em paralelo (um por linha). Supabase JS não tem
  // bulk update com valores diferentes por linha; Promise.all vira ~2s
  // com 200 colaboradores em vez de 10-20s sequenciais.
  const resultados = await Promise.all(
    linhas.map(async (l) => {
      const salarioVigente =
        salPorColab.get(l.colaborador_id) ?? l.snapshot_salario;
      const admissaoAtual =
        admissaoPorColab.get(l.colaborador_id) ?? l.snapshot_data_admissao;
      const salarioNum = Number(salarioVigente);
      const calc = calcularLinhaDecimoTerceiro({
        salario: salarioNum,
        dataAdmissao: new Date(`${admissaoAtual}T00:00:00Z`),
        ano: folha.ano,
        tipoContratacao: l.snapshot_tipo_contratacao as TipoContratacao,
        totalAdiantado: Number(l.total_adiantado),
      });
      const obsAuto =
        calc.avos === 0 ? "Admitido após 15/12 — sem direito a avos" : null;
      return supabase
        .from("decimo_terceiro_linhas")
        .update({
          snapshot_salario: salarioNum,
          snapshot_data_admissao: admissaoAtual,
          avos: calc.avos,
          primeira_parcela: calc.primeiraParcela,
          segunda_parcela: calc.segundaParcela,
          desconto_inss: calc.descontoInss,
          desconto_irrf: calc.descontoIrrf,
          total_bruto: calc.totalBruto,
          total_liquido: calc.totalLiquido,
          obs: obsAuto,
          updated_by: session.profile.id,
        })
        .eq("id", l.id)
        .eq("tenant_id", tenantId);
    }),
  );

  const primeiroErro = resultados.find((r) => r.error);
  if (primeiroErro?.error) {
    return {
      ok: false,
      message: `Falha ao recalcular: ${primeiroErro.error.message}`,
    };
  }
  const total = linhas.length;

  await supabase
    .from("decimo_terceiro_folhas")
    .update({
      recalculada_em: new Date().toISOString(),
      recalculada_por: session.profile.id,
    })
    .eq("id", folhaId)
    .eq("tenant_id", tenantId);

  await logAuditEvent({
    acao: "decimo_terceiro.folha.recalculada",
    tenantId,
    entidadeTipo: "decimo_terceiro_folha",
    entidadeId: folhaId,
    metadata: { ano: folha.ano, total_recalculadas: total },
  });

  revalidatePath(`/rh/decimo-terceiro/${folha.ano}`);

  return { ok: true, total_recalculadas: total };
}

// ----------------- Exportar XLSX -----------------

export async function exportarFolhaDecimoTerceiroXlsx(
  folhaId: string,
): Promise<ActionResult<{ filename: string; base64: string }>> {
  const session = await requireSession();
  if (!pode(session.activeRole, "rh.decimo_terceiro.ver")) {
    return { ok: false, message: "Sem permissão para esta ação." };
  }
  const tenantId = session.activeTenant.id;
  const supabase = createClient();

  const { data: folha, error: errFolha } = await supabase
    .from("decimo_terceiro_folhas")
    .select("id, ano")
    .eq("id", folhaId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (errFolha || !folha) {
    return { ok: false, message: "Folha não encontrada." };
  }

  const { data: linhasRaw, error: errLinhas } = await supabase
    .from("decimo_terceiro_linhas")
    .select(
      `snapshot_nome, snapshot_tipo_contratacao, snapshot_data_admissao,
       snapshot_salario, avos, total_adiantado, primeira_parcela,
       segunda_parcela, desconto_inss, desconto_irrf, total_liquido, obs,
       empresa:empresas!decimo_terceiro_linhas_snapshot_empresa_id_fkey(nome)`,
    )
    .eq("folha_id", folhaId)
    .eq("tenant_id", tenantId)
    .order("snapshot_nome", { ascending: true });
  if (errLinhas) {
    return { ok: false, message: `Falha ao buscar linhas: ${errLinhas.message}` };
  }

  type EmpresaEmbed = { nome: string } | { nome: string }[] | null;
  interface LinhaRaw {
    snapshot_nome: string;
    snapshot_tipo_contratacao: string;
    snapshot_data_admissao: string;
    snapshot_salario: string;
    avos: number;
    total_adiantado: string;
    primeira_parcela: string;
    segunda_parcela: string;
    desconto_inss: string;
    desconto_irrf: string;
    total_liquido: string;
    obs: string | null;
    empresa: EmpresaEmbed;
  }

  const linhas: LinhaExport[] = ((linhasRaw ?? []) as LinhaRaw[]).map((l) => {
    const empresa = Array.isArray(l.empresa) ? l.empresa[0] : l.empresa;
    return {
      snapshot_nome: l.snapshot_nome,
      snapshot_empresa_nome: empresa?.nome ?? null,
      snapshot_tipo_contratacao: l.snapshot_tipo_contratacao as TipoContratacao,
      snapshot_data_admissao: l.snapshot_data_admissao,
      snapshot_salario: Number(l.snapshot_salario),
      avos: l.avos,
      total_adiantado: Number(l.total_adiantado),
      primeira_parcela: Number(l.primeira_parcela),
      segunda_parcela: Number(l.segunda_parcela),
      desconto_inss: Number(l.desconto_inss),
      desconto_irrf: Number(l.desconto_irrf),
      total_liquido: Number(l.total_liquido),
      obs: l.obs,
    };
  });

  const buffer = await gerarXlsxFolhaDecimoTerceiro(folha.ano, linhas);

  await logAuditEvent({
    acao: "decimo_terceiro.folha.exportada",
    tenantId,
    entidadeTipo: "decimo_terceiro_folha",
    entidadeId: folhaId,
    metadata: { ano: folha.ano, total_linhas: linhas.length },
  });

  return {
    ok: true,
    filename: `13-salario-${folha.ano}.xlsx`,
    base64: buffer.toString("base64"),
  };
}
