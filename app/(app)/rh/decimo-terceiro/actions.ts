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
import {
  montarFolhasParcela,
  type LinhaParaMontar,
} from "@/lib/decimo-terceiro/montar-folhas-parcela";
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
  /** Parte PJ do salário (pra híbrido CLT_recibo). NULL quando não híbrido ou sem valor. */
  valor_recibo: string | null;
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

  // Elegibilidade: colaboradores com algum vínculo no ano E QUE NÃO FORAM
  // desligados dentro do ano. Rescisões no ano têm 13º proporcional
  // calculado pelo módulo de Rescisões (/rh/rescisoes), então entrariam
  // em duplicata. Quem foi desligado APÓS 31/dez do ano continua elegível
  // (o 13º é dele). Quem está ativo (data_encerramento NULL) também.
  const elegiveisIds = (colaboradores ?? [])
    .filter(
      (c) =>
        c.data_encerramento == null ||
        c.data_encerramento > `${ano}-12-31`,
    )
    .map((c) => c.id);

  if (elegiveisIds.length === 0) {
    return { ok: false, message: "Nenhum colaborador elegível para 13º no ano." };
  }

  // Query 2: salário vigente de cada elegível, incluindo valor_recibo
  // pro CLT_recibo híbrido (parte PJ do salário).
  const { data: salarios, error: errSal } = await supabase
    .from("colaboradores_salarios")
    .select("colaborador_id, valor, valor_recibo")
    .eq("tenant_id", tenantId)
    .is("data_fim", null)
    .in("colaborador_id", elegiveisIds);
  if (errSal) {
    return { ok: false, message: `Falha ao buscar salários: ${errSal.message}` };
  }

  // Query 2.5: adiantamentos do ano por colaborador (Parte 2).
  const { data: adiantamentos, error: errAd } = await supabase
    .from("decimo_terceiro_adiantamentos")
    .select("colaborador_id, valor")
    .eq("tenant_id", tenantId)
    .eq("ano", ano)
    .in("colaborador_id", elegiveisIds);
  if (errAd) {
    return { ok: false, message: `Falha ao buscar adiantamentos: ${errAd.message}` };
  }
  const adiantadoPorColab = new Map<string, number>();
  for (const a of adiantamentos ?? []) {
    adiantadoPorColab.set(
      a.colaborador_id,
      (adiantadoPorColab.get(a.colaborador_id) ?? 0) + Number(a.valor),
    );
  }

  // Query 2.6: colaboradores que tiveram REAJUSTE no ano (Parte 4).
  // Reajuste = mudança salarial. Precisa ter linha no ano E outra linha
  // anterior (não é o salário inicial da contratação).
  const { data: salariosDoAno } = await supabase
    .from("colaboradores_salarios")
    .select("colaborador_id, data_inicio")
    .eq("tenant_id", tenantId)
    .in("colaborador_id", elegiveisIds)
    .gte("data_inicio", `${ano}-01-01`)
    .lte("data_inicio", `${ano}-12-31`);
  const colabsComLinhaNoAno = new Set(
    (salariosDoAno ?? []).map((r) => r.colaborador_id),
  );
  const colabsComLinhaNoAnoIds = Array.from(colabsComLinhaNoAno);
  const reajusteNoAnoSet = new Set<string>();
  if (colabsComLinhaNoAnoIds.length > 0) {
    const { data: anterioresAgg } = await supabase
      .from("colaboradores_salarios")
      .select("colaborador_id, data_inicio")
      .eq("tenant_id", tenantId)
      .in("colaborador_id", colabsComLinhaNoAnoIds)
      .lt("data_inicio", `${ano}-01-01`);
    const temAnterior = new Set(
      (anterioresAgg ?? []).map((r) => r.colaborador_id),
    );
    for (const id of colabsComLinhaNoAnoIds) {
      if (temAnterior.has(id)) reajusteNoAnoSet.add(id);
    }
  }

  // Query 3: alocação vigente (empresa) — usa hierarquia nova (itens).
  // Lê pacotes vigentes → busca primeiro item de cada pacote → mapeia
  // colaborador_id → empresa_id (item de maior percentual ou primeiro).
  const { data: pacotesVigentes, error: errAloc } = await supabase
    .from("colaboradores_alocacoes")
    .select("id, colaborador_id")
    .eq("tenant_id", tenantId)
    .is("data_fim", null)
    .in("colaborador_id", elegiveisIds);
  if (errAloc) {
    return { ok: false, message: `Falha ao buscar alocações: ${errAloc.message}` };
  }

  const pacoteIds = (pacotesVigentes ?? []).map((p) => p.id);
  const pacoteColabMap = new Map<string, string>(
    (pacotesVigentes ?? []).map((p) => [p.id, p.colaborador_id]),
  );
  const { data: itensAloc, error: errItens } = pacoteIds.length > 0
    ? await supabase
        .from("colaboradores_alocacoes_itens")
        .select("alocacao_id, empresa_id, percentual_empresa")
        .in("alocacao_id", pacoteIds)
        .order("percentual_empresa", { ascending: false })
    : { data: [], error: null };
  if (errItens) {
    return { ok: false, message: `Falha ao buscar alocações de itens: ${errItens.message}` };
  }

  const salarioPorColab = new Map(
    (salarios ?? []).map((s) => [s.colaborador_id, s.valor]),
  );
  const valorReciboPorColab = new Map(
    (salarios ?? []).map((s) => [s.colaborador_id, s.valor_recibo]),
  );
  const empresaPorColab = new Map<string, string>();
  for (const item of itensAloc ?? []) {
    const colaboradorId = pacoteColabMap.get(item.alocacao_id);
    if (colaboradorId && !empresaPorColab.has(colaboradorId) && item.empresa_id) {
      // Pega a empresa com maior percentual (já ordenado DESC acima)
      empresaPorColab.set(colaboradorId, item.empresa_id);
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
      valor_recibo: valorReciboPorColab.get(c.id) ?? null,
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
    const valorReciboNum =
      c.valor_recibo != null && Number(c.valor_recibo) > 0
        ? Number(c.valor_recibo)
        : null;
    const totalAdiantado = adiantadoPorColab.get(c.id) ?? 0;
    const calc = calcularLinhaDecimoTerceiro({
      salario: salarioNum,
      dataAdmissao: new Date(`${c.data_admissao}T00:00:00Z`),
      ano,
      tipoContratacao: c.tipo_contratacao,
      totalAdiantado,
      valorRecibo: valorReciboNum,
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
      snapshot_valor_recibo: calc.parteClt ? valorReciboNum : null,
      snapshot_empresa_id: c.empresa_id,
      avos: calc.avos,
      total_adiantado: totalAdiantado,
      primeira_parcela: calc.primeiraParcela,
      segunda_parcela: calc.segundaParcela,
      desconto_inss: calc.descontoInss,
      desconto_irrf: calc.descontoIrrf,
      total_bruto: calc.totalBruto,
      total_liquido: calc.totalLiquido,
      parte_clt_primeira_parcela: calc.parteClt?.primeiraParcela ?? null,
      parte_clt_segunda_parcela: calc.parteClt?.segundaParcela ?? null,
      parte_clt_desconto_inss: calc.parteClt?.descontoInss ?? null,
      parte_clt_desconto_irrf: calc.parteClt?.descontoIrrf ?? null,
      parte_clt_total_liquido: calc.parteClt?.totalLiquido ?? null,
      parte_pj_primeira_parcela: calc.partePj?.primeiraParcela ?? null,
      parte_pj_segunda_parcela: calc.partePj?.segundaParcela ?? null,
      parte_pj_total_liquido: calc.partePj?.totalLiquido ?? null,
      editado_manualmente: false,
      salario_editado: null,
      avos_editado: null,
      obs: obsAuto,
      teve_reajuste_no_ano: reajusteNoAnoSet.has(c.id),
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
      "id, folha_id, snapshot_tipo_contratacao, snapshot_data_admissao, snapshot_salario, snapshot_valor_recibo, total_adiantado",
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

  // Mantém o snapshot_valor_recibo quando o usuário NÃO editou o salário;
  // se editou o salário manualmente, o breakdown híbrido deixa de valer
  // (o edit substitui o total, sem reaplicar proporção).
  const valorReciboEfetivo =
    parsed.data.salario_editado != null
      ? null
      : linha.snapshot_valor_recibo != null
        ? Number(linha.snapshot_valor_recibo)
        : null;

  const calc = calcularLinhaDecimoTerceiro({
    salario: Number(linha.snapshot_salario),
    dataAdmissao: new Date(`${linha.snapshot_data_admissao}T00:00:00Z`),
    ano: folha.ano,
    tipoContratacao: linha.snapshot_tipo_contratacao as TipoContratacao,
    totalAdiantado: Number(linha.total_adiantado),
    salarioEditado: parsed.data.salario_editado,
    avosEditado: parsed.data.avos_editado,
    valorRecibo: valorReciboEfetivo,
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
      parte_clt_primeira_parcela: calc.parteClt?.primeiraParcela ?? null,
      parte_clt_segunda_parcela: calc.parteClt?.segundaParcela ?? null,
      parte_clt_desconto_inss: calc.parteClt?.descontoInss ?? null,
      parte_clt_desconto_irrf: calc.parteClt?.descontoIrrf ?? null,
      parte_clt_total_liquido: calc.parteClt?.totalLiquido ?? null,
      parte_pj_primeira_parcela: calc.partePj?.primeiraParcela ?? null,
      parte_pj_segunda_parcela: calc.partePj?.segundaParcela ?? null,
      parte_pj_total_liquido: calc.partePj?.totalLiquido ?? null,
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

  // Rebuscar salário vigente + valor_recibo (parte PJ do híbrido).
  const colabIds = linhas.map((l) => l.colaborador_id);
  const { data: salariosAtuais, error: errSal } = await supabase
    .from("colaboradores_salarios")
    .select("colaborador_id, valor, valor_recibo")
    .eq("tenant_id", tenantId)
    .is("data_fim", null)
    .in("colaborador_id", colabIds);
  if (errSal) {
    return { ok: false, message: `Falha ao buscar salários: ${errSal.message}` };
  }

  // Rebuscar data_admissao + data_encerramento atual.
  const { data: colabsAtuais, error: errCol } = await supabase
    .from("colaboradores")
    .select("id, data_admissao, data_encerramento")
    .eq("tenant_id", tenantId)
    .in("id", colabIds);
  if (errCol) {
    return { ok: false, message: `Falha ao buscar colaboradores: ${errCol.message}` };
  }

  // Rebuscar adiantamentos do ano (Parte 2).
  const { data: adiantamentos, error: errAd } = await supabase
    .from("decimo_terceiro_adiantamentos")
    .select("colaborador_id, valor")
    .eq("tenant_id", tenantId)
    .eq("ano", folha.ano)
    .in("colaborador_id", colabIds);
  if (errAd) {
    return { ok: false, message: `Falha ao buscar adiantamentos: ${errAd.message}` };
  }

  const salPorColab = new Map(
    (salariosAtuais ?? []).map((s) => [s.colaborador_id, s.valor]),
  );
  const reciboPorColab = new Map(
    (salariosAtuais ?? []).map((s) => [s.colaborador_id, s.valor_recibo]),
  );
  const admissaoPorColab = new Map(
    (colabsAtuais ?? []).map((c) => [c.id, c.data_admissao]),
  );
  const encerramentoPorColab = new Map(
    (colabsAtuais ?? []).map((c) => [c.id, c.data_encerramento as string | null]),
  );
  const fimDoAno = `${folha.ano}-12-31`;

  // Reajustes no ano (Parte 4). Reajuste = linha no ano + linha anterior.
  const { data: salariosDoAno } = await supabase
    .from("colaboradores_salarios")
    .select("colaborador_id")
    .eq("tenant_id", tenantId)
    .in("colaborador_id", colabIds)
    .gte("data_inicio", `${folha.ano}-01-01`)
    .lte("data_inicio", `${folha.ano}-12-31`);
  const colabsComLinhaNoAno = Array.from(
    new Set((salariosDoAno ?? []).map((r) => r.colaborador_id)),
  );
  const reajusteNoAnoSet = new Set<string>();
  if (colabsComLinhaNoAno.length > 0) {
    const { data: anteriores } = await supabase
      .from("colaboradores_salarios")
      .select("colaborador_id")
      .eq("tenant_id", tenantId)
      .in("colaborador_id", colabsComLinhaNoAno)
      .lt("data_inicio", `${folha.ano}-01-01`);
    const temAnterior = new Set(
      (anteriores ?? []).map((r) => r.colaborador_id),
    );
    for (const id of colabsComLinhaNoAno) {
      if (temAnterior.has(id)) reajusteNoAnoSet.add(id);
    }
  }
  const adiantadoPorColab = new Map<string, number>();
  for (const a of adiantamentos ?? []) {
    adiantadoPorColab.set(
      a.colaborador_id,
      (adiantadoPorColab.get(a.colaborador_id) ?? 0) + Number(a.valor),
    );
  }

  // Dispara os updates em batches de 25 em paralelo. 200+ em um só
  // Promise.all enfileira no PostgREST (limite de conexões concorrentes)
  // e fica muito pior que batches menores processados em sequência.
  const BATCH_SIZE = 25;
  const todosOsUpdates = linhas.map((l) => async () => {
      const salarioVigente =
        salPorColab.get(l.colaborador_id) ?? l.snapshot_salario;
      const admissaoAtual =
        admissaoPorColab.get(l.colaborador_id) ?? l.snapshot_data_admissao;
      const salarioNum = Number(salarioVigente);
      const reciboRaw = reciboPorColab.get(l.colaborador_id);
      const valorReciboNum =
        reciboRaw != null && Number(reciboRaw) > 0 ? Number(reciboRaw) : null;
      const totalAdiantado = adiantadoPorColab.get(l.colaborador_id) ?? 0;

      // Se o colaborador foi desligado DENTRO do ano, remove a linha da
      // folha. O 13º proporcional dele saiu pela Rescisão (módulo
      // /rh/rescisoes), então não deve aparecer na folha anual.
      const dataEnc = encerramentoPorColab.get(l.colaborador_id);
      const desligadoNoAno =
        dataEnc != null && dataEnc <= fimDoAno;
      if (desligadoNoAno) {
        return supabase
          .from("decimo_terceiro_linhas")
          .delete()
          .eq("id", l.id)
          .eq("tenant_id", tenantId);
      }

      const calc = calcularLinhaDecimoTerceiro({
        salario: salarioNum,
        dataAdmissao: new Date(`${admissaoAtual}T00:00:00Z`),
        ano: folha.ano,
        tipoContratacao: l.snapshot_tipo_contratacao as TipoContratacao,
        totalAdiantado,
        valorRecibo: valorReciboNum,
      });
      const obsAuto =
        calc.avos === 0 ? "Admitido após 15/12 — sem direito a avos" : null;
      return supabase
        .from("decimo_terceiro_linhas")
        .update({
          snapshot_salario: salarioNum,
          snapshot_valor_recibo: calc.parteClt ? valorReciboNum : null,
          snapshot_data_admissao: admissaoAtual,
          avos: calc.avos,
          total_adiantado: totalAdiantado,
          primeira_parcela: calc.primeiraParcela,
          segunda_parcela: calc.segundaParcela,
          desconto_inss: calc.descontoInss,
          desconto_irrf: calc.descontoIrrf,
          total_bruto: calc.totalBruto,
          total_liquido: calc.totalLiquido,
          parte_clt_primeira_parcela: calc.parteClt?.primeiraParcela ?? null,
          parte_clt_segunda_parcela: calc.parteClt?.segundaParcela ?? null,
          parte_clt_desconto_inss: calc.parteClt?.descontoInss ?? null,
          parte_clt_desconto_irrf: calc.parteClt?.descontoIrrf ?? null,
          parte_clt_total_liquido: calc.parteClt?.totalLiquido ?? null,
          parte_pj_primeira_parcela: calc.partePj?.primeiraParcela ?? null,
          parte_pj_segunda_parcela: calc.partePj?.segundaParcela ?? null,
          parte_pj_total_liquido: calc.partePj?.totalLiquido ?? null,
          obs: obsAuto,
          teve_reajuste_no_ano: reajusteNoAnoSet.has(l.colaborador_id),
          updated_by: session.profile.id,
        })
        .eq("id", l.id)
        .eq("tenant_id", tenantId);
    });

  const resultados: { error: { message: string } | null }[] = [];
  for (let i = 0; i < todosOsUpdates.length; i += BATCH_SIZE) {
    const batch = todosOsUpdates.slice(i, i + BATCH_SIZE);
    const batchRes = await Promise.all(batch.map((fn) => fn()));
    resultados.push(...batchRes);
  }

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
       empresa:empresas!decimo_terceiro_linhas_snapshot_empresa_id_fkey(nome_fantasia)`,
    )
    .eq("folha_id", folhaId)
    .eq("tenant_id", tenantId)
    .order("snapshot_nome", { ascending: true });
  if (errLinhas) {
    return { ok: false, message: `Falha ao buscar linhas: ${errLinhas.message}` };
  }

  type EmpresaEmbed = { nome_fantasia: string } | { nome_fantasia: string }[] | null;
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
      snapshot_empresa_nome: empresa?.nome_fantasia ?? null,
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

// ----------------- Fechar 1a e 2a parcela -----------------

type FecharParcelaOut = ActionResult<{
  total_linhas_geradas: number;
}>;

/**
 * Fecha a 1a parcela do 13o: cria 1 linha em folhas_pagamento por colaborador
 * da folha, com tipo='decimo_terceiro_1a_parcela', status='enviada' (vai
 * direto pra tela do financeiro aprovar). Atualiza status da folha pra
 * 'fechada_parcial_1'. So pode ser chamada quando status='rascunho'.
 *
 * Linhas com avos=0 (admitido apos 15/dez, sem direito) sao puladas — nao
 * geram linha em folhas_pagamento.
 */
export async function fecharPrimeiraParcelaDecimoTerceiro(
  folhaId: string,
): Promise<FecharParcelaOut> {
  return fecharParcela(folhaId, 1);
}

export async function fecharSegundaParcelaDecimoTerceiro(
  folhaId: string,
): Promise<FecharParcelaOut> {
  return fecharParcela(folhaId, 2);
}

async function fecharParcela(
  folhaId: string,
  numeroParcela: 1 | 2,
): Promise<FecharParcelaOut> {
  const session = await requireSession();
  if (!pode(session.activeRole, "rh.decimo_terceiro.editar")) {
    return { ok: false, message: "Sem permissão para esta ação." };
  }
  const tenantId = session.activeTenant.id;
  const supabase = createClient();

  const { data: folha, error: errFolha } = await supabase
    .from("decimo_terceiro_folhas")
    .select("id, ano, status")
    .eq("id", folhaId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (errFolha || !folha) {
    return { ok: false, message: "Folha não encontrada." };
  }

  const statusEsperado = numeroParcela === 1 ? "rascunho" : "fechada_parcial_1";
  if (folha.status !== statusEsperado) {
    const label = numeroParcela === 1 ? "a 1ª" : "a 2ª";
    return {
      ok: false,
      message: `A folha precisa estar em "${statusEsperado}" para fechar ${label} parcela. Status atual: ${folha.status}.`,
    };
  }

  // Carrega todas as linhas da folha com avos > 0 (quem tem direito a algo),
  // incluindo os campos necessários pra montar folhas híbridas corretamente.
  const { data: linhas, error: errLinhas } = await supabase
    .from("decimo_terceiro_linhas")
    .select(
      "id, colaborador_id, avos, primeira_parcela, segunda_parcela, snapshot_tipo_contratacao, parte_pj_primeira_parcela, parte_pj_segunda_parcela, parte_clt_primeira_parcela, parte_clt_segunda_parcela",
    )
    .eq("folha_id", folhaId)
    .eq("tenant_id", tenantId)
    .gt("avos", 0);
  if (errLinhas) {
    return {
      ok: false,
      message: `Falha ao carregar linhas da folha: ${errLinhas.message}`,
    };
  }
  if (!linhas || linhas.length === 0) {
    return { ok: false, message: "Nenhuma linha com direito a 13º nesta folha." };
  }

  const tipo =
    numeroParcela === 1
      ? "decimo_terceiro_1a_parcela"
      : "decimo_terceiro_2a_parcela";
  const agora = new Date().toISOString();

  // Monta as folhas de pagamento por linha: híbrido vira 2 linhas (california
  // com parte_pj + contabilidade com parte_clt); CLT puro → 1 contabilidade;
  // PJ/MEI puro → 1 california. Linhas com valor 0 são puladas (avos nulos
  // retornam array vazio da montarFolhasParcela).
  const linhasFolhaPagamento: {
    tenant_id: string;
    colaborador_id: string;
    competencia_ano: number;
    competencia_mes: number;
    salario_base: number;
    status: string;
    tipo: string;
    origem: string;
    enviada_em: string;
    enviada_por: string;
    data_pagamento_prevista: string;
    decimo_terceiro_linha_id: string;
    decimo_terceiro_adiantamento_id: null;
    created_by: string;
  }[] = [];

  for (const l of linhas) {
    const linhaParaMontar: LinhaParaMontar = {
      decimo_terceiro_linha_id: l.id,
      colaborador_id: l.colaborador_id,
      tipo_contratacao: l.snapshot_tipo_contratacao as LinhaParaMontar["tipo_contratacao"],
      primeira_parcela: Number(l.primeira_parcela),
      segunda_parcela: Number(l.segunda_parcela),
      parte_pj_primeira_parcela: l.parte_pj_primeira_parcela != null ? Number(l.parte_pj_primeira_parcela) : null,
      parte_pj_segunda_parcela: l.parte_pj_segunda_parcela != null ? Number(l.parte_pj_segunda_parcela) : null,
      parte_clt_primeira_parcela: l.parte_clt_primeira_parcela != null ? Number(l.parte_clt_primeira_parcela) : null,
      parte_clt_segunda_parcela: l.parte_clt_segunda_parcela != null ? Number(l.parte_clt_segunda_parcela) : null,
    };

    const folhasMontadas = montarFolhasParcela(linhaParaMontar, numeroParcela);
    for (const montada of folhasMontadas) {
      linhasFolhaPagamento.push({
        tenant_id: tenantId,
        colaborador_id: montada.colaborador_id,
        competencia_ano: folha.ano,
        competencia_mes: 12,
        salario_base: montada.salario_base,
        status: "enviada",
        tipo: montada.tipo,
        origem: montada.origem,
        enviada_em: agora,
        enviada_por: session.profile.id,
        data_pagamento_prevista: `${folha.ano}-12-${numeroParcela === 1 ? "30" : "20"}`,
        decimo_terceiro_linha_id: montada.decimo_terceiro_linha_id,
        decimo_terceiro_adiantamento_id: null,
        created_by: session.profile.id,
      });
    }
  }

  // Idempotência: antes de inserir, apaga linhas existentes do mesmo
  // decimo_terceiro_linha_id + tipo que ainda não foram aprovadas/pagas.
  // Linhas já aprovadas ou pagas ficam intocadas.
  const linhaIds = linhas.map((l) => l.id);
  if (linhaIds.length > 0) {
    const { error: errDelete } = await supabase
      .from("folhas_pagamento")
      .delete()
      .in("decimo_terceiro_linha_id", linhaIds)
      .eq("tipo", tipo)
      .not("status", "in", "(aprovada,paga)");
    if (errDelete) {
      return {
        ok: false,
        message: `Falha ao limpar folhas anteriores: ${errDelete.message}`,
      };
    }
  }

  if (linhasFolhaPagamento.length === 0) {
    return { ok: false, message: "Nenhuma linha gerada para enviar ao financeiro." };
  }

  const { error: errInsert } = await supabase
    .from("folhas_pagamento")
    .insert(linhasFolhaPagamento);
  if (errInsert) {
    return {
      ok: false,
      message: `Falha ao enviar ao financeiro: ${errInsert.message}`,
    };
  }

  // Atualiza status da folha
  const novoStatus =
    numeroParcela === 1 ? "fechada_parcial_1" : "fechada_parcial_2";
  const { error: errStatus } = await supabase
    .from("decimo_terceiro_folhas")
    .update({ status: novoStatus })
    .eq("id", folhaId)
    .eq("tenant_id", tenantId);
  if (errStatus) {
    return {
      ok: false,
      message: `Linhas enviadas, mas falha ao atualizar status: ${errStatus.message}`,
    };
  }

  await logAuditEvent({
    acao:
      numeroParcela === 1
        ? "decimo_terceiro.parcela_1a.fechada"
        : "decimo_terceiro.parcela_2a.fechada",
    tenantId,
    entidadeTipo: "decimo_terceiro_folha",
    entidadeId: folhaId,
    metadata: {
      ano: folha.ano,
      total_linhas_geradas: linhasFolhaPagamento.length,
      competencia_mes: 12,
    },
  });

  revalidatePath(`/rh/decimo-terceiro/${folha.ano}`);
  revalidatePath("/financeiro/contas-a-pagar");

  return { ok: true, total_linhas_geradas: linhasFolhaPagamento.length };
}

// ========================================================================
// Parte 2 — Adiantamentos de 13º durante o ano
// ========================================================================

const LancarAdiantamentoInput = z.object({
  ano: z.number().int().min(2020).max(2100),
  colaborador_id: z.string().uuid(),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida"),
  valor: z.number().positive(),
  obs: z.string().max(500).nullable(),
});

async function recalcularLinhaDeAdiantamento(
  tenantId: string,
  ano: number,
  colaboradorId: string,
  profileId: string,
): Promise<void> {
  const supabase = createClient();
  const { data: folha } = await supabase
    .from("decimo_terceiro_folhas")
    .select("id, ano")
    .eq("tenant_id", tenantId)
    .eq("ano", ano)
    .maybeSingle();
  if (!folha) return;

  const { data: linha } = await supabase
    .from("decimo_terceiro_linhas")
    .select(
      "id, snapshot_tipo_contratacao, snapshot_data_admissao, snapshot_salario, snapshot_valor_recibo, salario_editado, avos_editado",
    )
    .eq("folha_id", folha.id)
    .eq("colaborador_id", colaboradorId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!linha) return;

  const { data: todosAd } = await supabase
    .from("decimo_terceiro_adiantamentos")
    .select("valor")
    .eq("tenant_id", tenantId)
    .eq("ano", ano)
    .eq("colaborador_id", colaboradorId);
  const totalAdiantado = (todosAd ?? []).reduce(
    (acc, a) => acc + Number(a.valor),
    0,
  );

  const valorReciboNum =
    linha.snapshot_valor_recibo != null
      ? Number(linha.snapshot_valor_recibo)
      : null;
  const calc = calcularLinhaDecimoTerceiro({
    salario: Number(linha.snapshot_salario),
    dataAdmissao: new Date(`${linha.snapshot_data_admissao}T00:00:00Z`),
    ano,
    tipoContratacao: linha.snapshot_tipo_contratacao as TipoContratacao,
    totalAdiantado,
    salarioEditado:
      linha.salario_editado != null ? Number(linha.salario_editado) : null,
    avosEditado: linha.avos_editado,
    valorRecibo: valorReciboNum,
  });

  await supabase
    .from("decimo_terceiro_linhas")
    .update({
      total_adiantado: totalAdiantado,
      primeira_parcela: calc.primeiraParcela,
      segunda_parcela: calc.segundaParcela,
      desconto_inss: calc.descontoInss,
      desconto_irrf: calc.descontoIrrf,
      total_bruto: calc.totalBruto,
      total_liquido: calc.totalLiquido,
      parte_clt_primeira_parcela: calc.parteClt?.primeiraParcela ?? null,
      parte_clt_segunda_parcela: calc.parteClt?.segundaParcela ?? null,
      parte_clt_desconto_inss: calc.parteClt?.descontoInss ?? null,
      parte_clt_desconto_irrf: calc.parteClt?.descontoIrrf ?? null,
      parte_clt_total_liquido: calc.parteClt?.totalLiquido ?? null,
      parte_pj_primeira_parcela: calc.partePj?.primeiraParcela ?? null,
      parte_pj_segunda_parcela: calc.partePj?.segundaParcela ?? null,
      parte_pj_total_liquido: calc.partePj?.totalLiquido ?? null,
      updated_by: profileId,
    })
    .eq("id", linha.id)
    .eq("tenant_id", tenantId);
}

export async function lancarAdiantamentoDecimoTerceiro(input: {
  ano: number;
  colaborador_id: string;
  data: string;
  valor: number;
  obs: string | null;
}): Promise<ActionResult<{ id: string; conta_avulsa_id: string | null }>> {
  const session = await requireSession();
  if (!pode(session.activeRole, "rh.decimo_terceiro.editar")) {
    return { ok: false, message: "Sem permissão para esta ação." };
  }
  const parsed = LancarAdiantamentoInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Dados inválidos." };
  }
  const { ano, colaborador_id, data, valor, obs } = parsed.data;
  const tenantId = session.activeTenant.id;
  const supabase = createClient();

  const { data: colab } = await supabase
    .from("colaboradores")
    .select("id, nome, tipo_contratacao")
    .eq("id", colaborador_id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!colab) {
    return { ok: false, message: "Colaborador não encontrado." };
  }

  // Empresa alocada vigente — usa hierarquia nova (itens).
  // Pega o pacote vigente e seleciona a empresa com maior percentual.
  const { data: pacoteVigenteRaw } = await supabase
    .from("colaboradores_alocacoes")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("colaborador_id", colaborador_id)
    .is("data_fim", null)
    .limit(1);
  const pacoteId = pacoteVigenteRaw?.[0]?.id;
  let empresaId: string | null = null;
  if (pacoteId) {
    const { data: itensPacote, error: errItensAdiant } = await supabase
      .from("colaboradores_alocacoes_itens")
      .select("empresa_id, percentual_empresa")
      .eq("alocacao_id", pacoteId)
      .order("percentual_empresa", { ascending: false })
      .limit(1);
    if (errItensAdiant) {
      return {
        ok: false,
        message: `Falha ao buscar alocações de itens: ${errItensAdiant.message}`,
      };
    }
    empresaId = itensPacote?.[0]?.empresa_id ?? null;
  }
  if (!empresaId) {
    return {
      ok: false,
      message:
        "Colaborador sem empresa alocada — lançamento no financeiro não é possível.",
    };
  }

  // Plano de contas
  const { data: tipoRow } = await supabase
    .from("plano_contas_tipos")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("nome", "Despesa com Pessoal")
    .maybeSingle();
  if (!tipoRow) {
    return {
      ok: false,
      message: "Plano de contas 'Despesa com Pessoal' não configurado.",
    };
  }
  const { data: subtipoRow } = await supabase
    .from("plano_contas_subtipos")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("tipo_id", tipoRow.id)
    .eq("codigo", "004")
    .maybeSingle();
  if (!subtipoRow) {
    return { ok: false, message: "Subtipo '13° Salário' não configurado." };
  }

  // 1) Insert do adiantamento
  const { data: adiantInserido, error: errAd } = await supabase
    .from("decimo_terceiro_adiantamentos")
    .insert({
      tenant_id: tenantId,
      ano,
      colaborador_id,
      data,
      valor,
      obs,
      created_by: session.profile.id,
    })
    .select("id")
    .single();
  if (errAd || !adiantInserido) {
    return {
      ok: false,
      message: `Falha ao registrar adiantamento: ${errAd?.message ?? "sem retorno"}`,
    };
  }
  const adiantamentoId = adiantInserido.id;

  // 2) Cria conta_avulsa via service client (RH não tem permissão direta
  // mas o adiantamento de 13º é responsabilidade do RH).
  const { createServiceClient } = await import("@/lib/supabase/server");
  const service = createServiceClient();

  const { data: codigo } = await service.rpc("gerar_codigo_avulsa", {
    p_tenant_id: tenantId,
  });

  const dataBr = data.split("-").reverse().join("/");
  const { data: contaId, error: errAvulsa } = await service.rpc(
    "criar_conta_avulsa",
    {
      p_dados: {
        tenant_id: tenantId,
        empresa_id: empresaId,
        codigo: (codigo as string | null) ?? null,
        descricao: `13º Adiantamento · ${colab.nome} · ${dataBr}`,
        valor: valor.toFixed(2),
        natureza: "saida",
        status: "aprovada",
        data_prevista_pagamento: data,
        data_pagamento: data,
        data_pagamento_primeira: data,
        plano_conta_tipo_id: tipoRow.id,
        plano_conta_subtipo_id: subtipoRow.id,
        colaborador_id,
        parcela_numero: 1,
        parcela_total: 1,
        aprovada_em: new Date().toISOString(),
        aprovada_por: session.profile.id,
        criado_por: session.profile.id,
      },
      p_rateio: [],
    },
  );

  let contaAvulsaId: string | null = null;
  if (!errAvulsa && contaId) {
    contaAvulsaId = contaId as string;
    await supabase
      .from("decimo_terceiro_adiantamentos")
      .update({ conta_avulsa_id: contaAvulsaId })
      .eq("id", adiantamentoId)
      .eq("tenant_id", tenantId);
  } else {
    console.error("[13o.adiantamento.avulsa]", errAvulsa?.message);
  }

  // 3) Recalcula a linha correspondente, se já existe folha pro ano.
  await recalcularLinhaDeAdiantamento(
    tenantId,
    ano,
    colaborador_id,
    session.profile.id,
  );

  await logAuditEvent({
    acao: "decimo_terceiro.adiantamento.lancado",
    tenantId,
    entidadeTipo: "decimo_terceiro_adiantamento",
    entidadeId: adiantamentoId,
    metadata: { ano, colaborador_id, valor, conta_avulsa_id: contaAvulsaId },
  });

  revalidatePath(`/rh/decimo-terceiro/${ano}`);
  revalidatePath(`/rh/decimo-terceiro/${ano}/adiantamentos`);

  return { ok: true, id: adiantamentoId, conta_avulsa_id: contaAvulsaId };
}

export async function excluirAdiantamentoDecimoTerceiro(
  adiantamentoId: string,
): Promise<ActionResult<{ id: string }>> {
  const session = await requireSession();
  if (!pode(session.activeRole, "rh.decimo_terceiro.editar")) {
    return { ok: false, message: "Sem permissão para esta ação." };
  }
  const tenantId = session.activeTenant.id;
  const supabase = createClient();

  const { data: adiantamento } = await supabase
    .from("decimo_terceiro_adiantamentos")
    .select("id, ano, colaborador_id, conta_avulsa_id")
    .eq("id", adiantamentoId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!adiantamento) {
    return { ok: false, message: "Adiantamento não encontrado." };
  }

  const { error: errDel } = await supabase
    .from("decimo_terceiro_adiantamentos")
    .delete()
    .eq("id", adiantamentoId)
    .eq("tenant_id", tenantId);
  if (errDel) {
    return { ok: false, message: `Falha ao excluir: ${errDel.message}` };
  }

  // Nota: não estornamos conta_avulsa — financeiro cancela manualmente se
  // precisar. A FK no adiantamento é SET NULL; delete não quebra financeiro.
  await recalcularLinhaDeAdiantamento(
    tenantId,
    adiantamento.ano,
    adiantamento.colaborador_id,
    session.profile.id,
  );

  await logAuditEvent({
    acao: "decimo_terceiro.adiantamento.excluido",
    tenantId,
    entidadeTipo: "decimo_terceiro_adiantamento",
    entidadeId: adiantamentoId,
    metadata: {
      ano: adiantamento.ano,
      conta_avulsa_id: adiantamento.conta_avulsa_id,
    },
  });

  revalidatePath(`/rh/decimo-terceiro/${adiantamento.ano}`);
  revalidatePath(`/rh/decimo-terceiro/${adiantamento.ano}/adiantamentos`);

  return { ok: true, id: adiantamentoId };
}
