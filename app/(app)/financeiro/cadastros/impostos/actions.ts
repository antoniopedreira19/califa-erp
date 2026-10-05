"use server";

/**
 * Cadastro de impostos (módulo fiscal, entrega 1 — 02/10/2026): as edições
 * da tela Cadastros do Financeiro › Impostos.
 *
 * Mesma trava das outras ações de cadastro do financeiro (contas bancárias,
 * plano de contas, cartões): admin ou financeiro, com `acao_negada` na
 * auditoria. A RLS das tabelas `fiscal_*` já restringe a escrita aos mesmos
 * dois papéis.
 *
 * Alíquota de CNAE e parâmetro NÃO se sobrescrevem: o valor novo entra numa
 * linha nova a partir de uma data, e a linha atual do CNAE fecha na véspera.
 * Assim as apurações antigas continuam com a alíquota da época.
 */

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";
import { dataBr } from "@/lib/fiscal/datas";
import { PRIMEIRA_COMPETENCIA, trimestreDe } from "@/lib/fiscal/apuracao";
import type { FiscalCnae, FiscalEstabelecimento } from "@/lib/types";
import {
  aliquotasPisCofins,
  cidadeDoCadastro,
  estabelecimentoSchema,
  idSchema,
  mensagemDaRaiz,
  novaVigenciaCnaeSchema,
  novaVigenciaParametrosSchema,
  novoCnaeSchema,
  novoEstabelecimentoSchema,
  novoFeriadoSchema,
  ordemDoNovo,
  problemaDoNovoEstabelecimento,
  receitaAnteriorSchema,
  vesperaDaVigencia,
} from "@/lib/validations/fiscal-cadastro";

type Result = { ok: true } | { ok: false; message: string };

const ROLES_PERMITIDOS = ["administrador", "financeiro"] as const;
const CAMINHO = "/financeiro/cadastros/impostos";

async function checarGate(acaoTentada: string) {
  const session = await requireSession();
  if (!(ROLES_PERMITIDOS as readonly string[]).includes(session.activeRole)) {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      metadata: { acao_tentada: acaoTentada },
    });
    return { ok: false as const, message: "Apenas admin ou financeiro altera o cadastro de impostos." };
  }
  return { ok: true as const, session, supabase: createClient() };
}

function primeiraMensagem(issues: { message: string }[]) {
  return issues[0]?.message ?? "Entrada inválida.";
}

function revalidar() {
  revalidatePath(CAMINHO);
  revalidatePath("/financeiro/cadastros");
}

/** numeric chega do PostgREST como texto ou número: sempre número aqui. */
function cnaeNumerico(c: FiscalCnae): FiscalCnae {
  return {
    ...c,
    aliquota_iss: c.aliquota_iss === null ? null : Number(c.aliquota_iss),
    aliquota_pis: Number(c.aliquota_pis),
    aliquota_cofins: Number(c.aliquota_cofins),
  };
}

/** O regime da PJ do CNPJ na data (lucro real quando não houver registro). */
async function regimeNaData(
  supabase: ReturnType<typeof createClient>,
  empresaContabilId: string,
  data: string,
): Promise<"lucro_real" | "lucro_presumido"> {
  const { data: r } = await supabase
    .from("fiscal_regimes")
    .select("regime")
    .eq("empresa_contabil_id", empresaContabilId)
    .lte("vigencia_inicio", data)
    .order("vigencia_inicio", { ascending: false })
    .limit(1)
    .maybeSingle<{ regime: "lucro_real" | "lucro_presumido" }>();
  return r?.regime ?? "lucro_real";
}

const MSG_PRESUMIDO = "No Lucro Presumido o PIS e a COFINS são sempre cumulativos, sem crédito.";

// ---------------------------------------------------------------------------
// CNPJ emissor: informar o CNPJ e ativar; vencimento do ISS (lápis da aba CNPJs)
// ---------------------------------------------------------------------------

export async function atualizarEstabelecimento(input: unknown): Promise<Result> {
  const parsed = estabelecimentoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: primeiraMensagem(parsed.error.issues) };
  const gate = await checarGate("fiscal_estabelecimento.atualizado");
  if (!gate.ok) return gate;
  const tenantId = gate.session.activeTenant.id;
  const v = parsed.data;

  const { data: atual, error: errAtual } = await gate.supabase
    .from("fiscal_estabelecimentos")
    .select("*")
    .eq("id", v.id)
    .eq("tenant_id", tenantId)
    .maybeSingle<FiscalEstabelecimento>();
  if (errAtual) return { ok: false, message: `Falha ao carregar o CNPJ emissor: ${errAtual.message}` };
  if (!atual) return { ok: false, message: "CNPJ emissor não encontrado." };
  if (atual.cnpj && !v.cnpj) {
    return {
      ok: false,
      message: "O CNPJ já informado não se apaga. Para tirar o estabelecimento do Faturar, desmarque Ativo.",
    };
  }

  // A raiz do CNPJ (8 primeiros dígitos) é a da empresa: matriz e filiais
  // de uma PJ dividem a mesma raiz.
  if (v.cnpj) {
    const { data: empresa } = await gate.supabase
      .from("empresas_contabeis")
      .select("razao_social, cnpj")
      .eq("id", atual.empresa_contabil_id)
      .eq("tenant_id", tenantId)
      .maybeSingle<{ razao_social: string; cnpj: string }>();
    const raiz = empresa ? mensagemDaRaiz(v.cnpj, empresa) : null;
    if (raiz) return { ok: false, message: raiz };
  }

  const patch = {
    cnpj: v.cnpj,
    ativo: v.ativo,
    iss_dia: v.iss_dia,
    iss_retido_dia: v.iss_retido_dia,
    iss_regra: v.iss_regra,
    observacao: v.observacao,
  };

  const { error } = await gate.supabase
    .from("fiscal_estabelecimentos")
    .update(patch)
    .eq("id", v.id)
    .eq("tenant_id", tenantId);
  if (error) {
    if (error.code === "23505") return { ok: false, message: "Esse CNPJ já está em outro estabelecimento do cadastro." };
    return { ok: false, message: `Falha ao salvar o CNPJ emissor: ${error.message}` };
  }

  const antes: Record<string, unknown> = {};
  const depois: Record<string, unknown> = {};
  for (const k of Object.keys(patch) as (keyof typeof patch)[]) {
    if (atual[k] !== patch[k]) {
      antes[k] = atual[k];
      depois[k] = patch[k];
    }
  }
  await logAuditEvent({
    acao: "fiscal_estabelecimento.atualizado",
    tenantId,
    entidadeTipo: "fiscal_estabelecimento",
    entidadeId: v.id,
    metadata: { nome: atual.nome, antes, depois },
  });

  revalidar();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// CNPJ emissor novo (botão "Novo CNPJ emissor" da aba CNPJs)
// ---------------------------------------------------------------------------

export async function criarEstabelecimento(input: unknown): Promise<Result> {
  const parsed = novoEstabelecimentoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: primeiraMensagem(parsed.error.issues) };
  const gate = await checarGate("fiscal_estabelecimento.criado");
  if (!gate.ok) return gate;
  const tenantId = gate.session.activeTenant.id;
  const v = parsed.data;

  // As três leituras em paralelo: a empresa contábil; os CNPJs do cadastro
  // (matriz, nome e CNPJ repetidos, a ordem); e as cidades dos feriados
  // (o município entra com a grafia que o cadastro já usa).
  const [empresaRes, estabsRes, feriadosRes] = await Promise.all([
    gate.supabase
      .from("empresas_contabeis")
      .select("id, razao_social, nome_fantasia, cnpj, ativo")
      .eq("id", v.empresa_contabil_id)
      .eq("tenant_id", tenantId)
      .maybeSingle<{ id: string; razao_social: string; nome_fantasia: string | null; cnpj: string; ativo: boolean }>(),
    gate.supabase
      .from("fiscal_estabelecimentos")
      .select("empresa_contabil_id, nome, cnpj, papel, municipio, ordem")
      .eq("tenant_id", tenantId)
      .returns<
        Array<Pick<FiscalEstabelecimento, "empresa_contabil_id" | "nome" | "cnpj" | "papel" | "municipio" | "ordem">>
      >(),
    gate.supabase
      .from("fiscal_feriados")
      .select("municipio")
      .eq("tenant_id", tenantId)
      .not("municipio", "is", null)
      .returns<Array<{ municipio: string }>>(),
  ]);
  if (empresaRes.error) return { ok: false, message: `Falha ao carregar a empresa contábil: ${empresaRes.error.message}` };
  if (estabsRes.error) return { ok: false, message: `Falha ao carregar os CNPJs emissores: ${estabsRes.error.message}` };
  if (feriadosRes.error) return { ok: false, message: `Falha ao carregar os feriados: ${feriadosRes.error.message}` };
  const e = empresaRes.data;
  if (!e) return { ok: false, message: "Empresa contábil não encontrada. Recarregue a página." };
  const empresa = { id: e.id, nome: e.nome_fantasia ?? e.razao_social, razao_social: e.razao_social, cnpj: e.cnpj, ativo: e.ativo };
  const existentes = estabsRes.data ?? [];

  const problema = problemaDoNovoEstabelecimento(v, empresa, existentes);
  if (problema) return { ok: false, message: problema };

  const cidades = [...existentes.map((x) => x.municipio), ...(feriadosRes.data ?? []).map((f) => f.municipio)];
  const linha = {
    tenant_id: tenantId,
    empresa_contabil_id: empresa.id,
    nome: v.nome,
    cnpj: v.cnpj,
    papel: v.papel,
    municipio: cidadeDoCadastro(v.municipio, cidades),
    uf: v.uf,
    iss_dia: v.iss_dia,
    iss_retido_dia: v.iss_retido_dia,
    iss_regra: v.iss_regra,
    ativo: v.ativo,
    ordem: ordemDoNovo(existentes),
    observacao: v.observacao,
  };

  const { data: novo, error } = await gate.supabase
    .from("fiscal_estabelecimentos")
    .insert(linha)
    .select("id")
    .single<{ id: string }>();
  if (error || !novo) {
    // Dois índices únicos: o nome (`uq_fiscal_estab_nome`) e o CNPJ
    // (`uq_fiscal_estab_cnpj`). A conferência acima pega os dois; aqui fica
    // a corrida com outra pessoa cadastrando ao mesmo tempo.
    if (error?.code === "23505") {
      return {
        ok: false,
        message: error.message.includes("uq_fiscal_estab_nome")
          ? "Já existe um CNPJ emissor com esse nome."
          : "Esse CNPJ já está em outro estabelecimento do cadastro.",
      };
    }
    return { ok: false, message: `Falha ao cadastrar o CNPJ emissor: ${error?.message ?? "sem retorno"}` };
  }

  await logAuditEvent({
    acao: "fiscal_estabelecimento.criado",
    tenantId,
    entidadeTipo: "fiscal_estabelecimento",
    entidadeId: novo.id,
    metadata: {
      nome: linha.nome,
      empresa_contabil: empresa.razao_social,
      papel: linha.papel,
      cnpj: linha.cnpj,
      municipio: linha.municipio,
      uf: linha.uf,
      iss_dia: linha.iss_dia,
      iss_retido_dia: linha.iss_retido_dia,
      iss_regra: linha.iss_regra,
      ativo: linha.ativo,
      ordem: linha.ordem,
      observacao: linha.observacao,
    },
  });

  revalidar();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// CNAE: alíquotas novas com vigência
// ---------------------------------------------------------------------------

export async function novaVigenciaCnae(input: unknown): Promise<Result> {
  const parsed = novaVigenciaCnaeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: primeiraMensagem(parsed.error.issues) };
  const gate = await checarGate("fiscal_cnae.nova_vigencia");
  if (!gate.ok) return gate;
  const tenantId = gate.session.activeTenant.id;
  const v = parsed.data;

  const { data: bruto, error: errAtual } = await gate.supabase
    .from("fiscal_cnaes")
    .select("*")
    .eq("id", v.cnae_id)
    .eq("tenant_id", tenantId)
    .maybeSingle<FiscalCnae>();
  if (errAtual) return { ok: false, message: `Falha ao carregar o CNAE: ${errAtual.message}` };
  if (!bruto) return { ok: false, message: "CNAE não encontrado." };
  const atual = cnaeNumerico(bruto);
  if (atual.vigencia_fim !== null || !atual.ativo) {
    return { ok: false, message: "Esta alíquota já foi substituída por outra. Recarregue a página." };
  }
  if (v.vigencia_inicio <= atual.vigencia_inicio) {
    return {
      ok: false,
      message: `A data tem de ser depois de ${dataBr(atual.vigencia_inicio)}, quando começou a alíquota atual.`,
    };
  }

  const { data: estab } = await gate.supabase
    .from("fiscal_estabelecimentos")
    .select("empresa_contabil_id, nome")
    .eq("id", atual.estabelecimento_id)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ empresa_contabil_id: string; nome: string }>();
  if (!estab) return { ok: false, message: "CNPJ emissor não encontrado." };
  if (!v.cumulativo && (await regimeNaData(gate.supabase, estab.empresa_contabil_id, v.vigencia_inicio)) === "lucro_presumido") {
    return { ok: false, message: MSG_PRESUMIDO };
  }

  const { aliquota_pis, aliquota_cofins } = aliquotasPisCofins(v.cumulativo, atual);
  if (
    v.aliquota_iss === atual.aliquota_iss &&
    aliquota_pis === atual.aliquota_pis &&
    aliquota_cofins === atual.aliquota_cofins &&
    v.cumulativo === atual.cumulativo
  ) {
    return { ok: false, message: "Nenhuma alíquota mudou." };
  }

  // 1º a linha nova; 2º a atual fecha na véspera. Se o fechamento falhar
  // (ou outra pessoa já tiver fechado), a linha nova sai: nunca ficam duas
  // linhas abertas do mesmo CNAE.
  const { data: nova, error: errNova } = await gate.supabase
    .from("fiscal_cnaes")
    .insert({
      tenant_id: tenantId,
      estabelecimento_id: atual.estabelecimento_id,
      codigo: atual.codigo,
      subitem: atual.subitem,
      descricao: atual.descricao,
      aliquota_iss: v.aliquota_iss,
      aliquota_pis,
      aliquota_cofins,
      cumulativo: v.cumulativo,
      vigencia_inicio: v.vigencia_inicio,
      vigencia_fim: null,
      ativo: true,
    })
    .select("id")
    .single<{ id: string }>();
  if (errNova || !nova) {
    if (errNova?.code === "23505") return { ok: false, message: "Já existe uma alíquota deste CNAE começando nessa data." };
    return { ok: false, message: `Falha ao registrar a alíquota nova: ${errNova?.message ?? "sem retorno"}` };
  }

  const vespera = vesperaDaVigencia(v.vigencia_inicio);
  const { data: fechadas, error: errFecha } = await gate.supabase
    .from("fiscal_cnaes")
    .update({ vigencia_fim: vespera })
    .eq("id", atual.id)
    .eq("tenant_id", tenantId)
    .is("vigencia_fim", null)
    .select("id");
  if (errFecha || !fechadas || fechadas.length !== 1) {
    await gate.supabase.from("fiscal_cnaes").delete().eq("id", nova.id).eq("tenant_id", tenantId);
    return {
      ok: false,
      message: errFecha
        ? `Falha ao fechar a alíquota atual: ${errFecha.message}`
        : "Esta alíquota mudou enquanto você editava. Recarregue a página.",
    };
  }

  await logAuditEvent({
    acao: "fiscal_cnae.nova_vigencia",
    tenantId,
    entidadeTipo: "fiscal_cnae",
    entidadeId: nova.id,
    metadata: {
      estabelecimento: estab.nome,
      codigo: atual.codigo,
      subitem: atual.subitem,
      linha_anterior_id: atual.id,
      linha_anterior_fim: vespera,
      vigencia_inicio: v.vigencia_inicio,
      antes: {
        aliquota_iss: atual.aliquota_iss,
        aliquota_pis: atual.aliquota_pis,
        aliquota_cofins: atual.aliquota_cofins,
        cumulativo: atual.cumulativo,
      },
      depois: { aliquota_iss: v.aliquota_iss, aliquota_pis, aliquota_cofins, cumulativo: v.cumulativo },
    },
  });

  revalidar();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// CNAE novo num CNPJ emissor
// ---------------------------------------------------------------------------

export async function criarCnae(input: unknown): Promise<Result> {
  const parsed = novoCnaeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: primeiraMensagem(parsed.error.issues) };
  const gate = await checarGate("fiscal_cnae.criado");
  if (!gate.ok) return gate;
  const tenantId = gate.session.activeTenant.id;
  const v = parsed.data;

  const { data: estab } = await gate.supabase
    .from("fiscal_estabelecimentos")
    .select("id, empresa_contabil_id, nome")
    .eq("id", v.estabelecimento_id)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ id: string; empresa_contabil_id: string; nome: string }>();
  if (!estab) return { ok: false, message: "CNPJ emissor não encontrado." };
  if (!v.cumulativo && (await regimeNaData(gate.supabase, estab.empresa_contabil_id, v.vigencia_inicio)) === "lucro_presumido") {
    return { ok: false, message: MSG_PRESUMIDO };
  }

  let repetido = gate.supabase
    .from("fiscal_cnaes")
    .select("id")
    .eq("estabelecimento_id", estab.id)
    .eq("codigo", v.codigo)
    .is("vigencia_fim", null)
    .eq("ativo", true);
  repetido = v.subitem === null ? repetido.is("subitem", null) : repetido.eq("subitem", v.subitem);
  const { data: jaExiste, error: errRep } = await repetido.limit(1);
  if (errRep) return { ok: false, message: `Falha ao conferir o CNAE: ${errRep.message}` };
  if (jaExiste && jaExiste.length > 0) {
    return {
      ok: false,
      message: "Este CNAE já está neste CNPJ. Para mudar as alíquotas, use o lápis da linha.",
    };
  }

  const { aliquota_pis, aliquota_cofins } = aliquotasPisCofins(v.cumulativo);
  const { data: novo, error } = await gate.supabase
    .from("fiscal_cnaes")
    .insert({
      tenant_id: tenantId,
      estabelecimento_id: estab.id,
      codigo: v.codigo,
      subitem: v.subitem,
      descricao: v.descricao,
      aliquota_iss: v.aliquota_iss,
      aliquota_pis,
      aliquota_cofins,
      cumulativo: v.cumulativo,
      vigencia_inicio: v.vigencia_inicio,
      vigencia_fim: null,
      ativo: true,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !novo) {
    if (error?.code === "23505") return { ok: false, message: "Este CNAE já está neste CNPJ com essa data." };
    return { ok: false, message: `Falha ao cadastrar o CNAE: ${error?.message ?? "sem retorno"}` };
  }

  await logAuditEvent({
    acao: "fiscal_cnae.criado",
    tenantId,
    entidadeTipo: "fiscal_cnae",
    entidadeId: novo.id,
    metadata: {
      estabelecimento: estab.nome,
      codigo: v.codigo,
      subitem: v.subitem,
      descricao: v.descricao,
      aliquota_iss: v.aliquota_iss,
      aliquota_pis,
      aliquota_cofins,
      cumulativo: v.cumulativo,
      vigencia_inicio: v.vigencia_inicio,
    },
  });

  revalidar();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Feriados
// ---------------------------------------------------------------------------

export async function criarFeriado(input: unknown): Promise<Result> {
  const parsed = novoFeriadoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: primeiraMensagem(parsed.error.issues) };
  const gate = await checarGate("fiscal_feriado.criado");
  if (!gate.ok) return gate;
  const tenantId = gate.session.activeTenant.id;
  const v = parsed.data;

  // Feriado local só de cidade que tem CNPJ emissor (é onde vence o ISS).
  if (v.municipio !== null) {
    const { data: cidades } = await gate.supabase
      .from("fiscal_estabelecimentos")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("municipio", v.municipio)
      .limit(1);
    if (!cidades || cidades.length === 0) {
      return { ok: false, message: "Escolha uma cidade dos CNPJs emissores." };
    }
  }

  const { data: novo, error } = await gate.supabase
    .from("fiscal_feriados")
    .insert({ tenant_id: tenantId, data: v.data, nome: v.nome, municipio: v.municipio })
    .select("id")
    .single<{ id: string }>();
  if (error || !novo) {
    if (error?.code === "23505") {
      return {
        ok: false,
        message: v.municipio
          ? `Já existe um feriado de ${v.municipio} em ${dataBr(v.data)}.`
          : `Já existe um feriado nacional em ${dataBr(v.data)}.`,
      };
    }
    return { ok: false, message: `Falha ao cadastrar o feriado: ${error?.message ?? "sem retorno"}` };
  }

  await logAuditEvent({
    acao: "fiscal_feriado.criado",
    tenantId,
    entidadeTipo: "fiscal_feriado",
    entidadeId: novo.id,
    metadata: { data: v.data, nome: v.nome, municipio: v.municipio },
  });

  revalidar();
  return { ok: true };
}

export async function removerFeriado(input: unknown): Promise<Result> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Feriado inválido." };
  const gate = await checarGate("fiscal_feriado.removido");
  if (!gate.ok) return gate;
  const tenantId = gate.session.activeTenant.id;

  const { data: removidos, error } = await gate.supabase
    .from("fiscal_feriados")
    .delete()
    .eq("id", parsed.data.id)
    .eq("tenant_id", tenantId)
    .select("id, data, nome, municipio");
  if (error) return { ok: false, message: `Falha ao remover o feriado: ${error.message}` };
  const f = removidos?.[0] as { id: string; data: string; nome: string; municipio: string | null } | undefined;
  if (!f) return { ok: false, message: "Feriado não encontrado. Recarregue a página." };

  await logAuditEvent({
    acao: "fiscal_feriado.removido",
    tenantId,
    entidadeTipo: "fiscal_feriado",
    entidadeId: f.id,
    metadata: { data: f.data, nome: f.nome, municipio: f.municipio },
  });

  revalidar();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Parâmetros: valor novo a partir de uma data (linha nova por chave)
// ---------------------------------------------------------------------------

export async function novaVigenciaParametros(input: unknown): Promise<Result> {
  const parsed = novaVigenciaParametrosSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: primeiraMensagem(parsed.error.issues) };
  const gate = await checarGate("fiscal_parametro.nova_vigencia");
  if (!gate.ok) return gate;
  const tenantId = gate.session.activeTenant.id;
  const v = parsed.data;
  const chaves = Array.from(new Set(v.valores.map((x) => x.chave)));

  const { data: linhas, error: errLinhas } = await gate.supabase
    .from("fiscal_parametros")
    .select("chave, valor, descricao, vigencia_inicio")
    .eq("tenant_id", tenantId)
    .in("chave", chaves);
  if (errLinhas) return { ok: false, message: `Falha ao carregar os parâmetros: ${errLinhas.message}` };

  const ultima = new Map<string, { valor: number; descricao: string; vigencia_inicio: string }>();
  for (const l of (linhas ?? []) as { chave: string; valor: number | string; descricao: string; vigencia_inicio: string }[]) {
    const atual = ultima.get(l.chave);
    if (!atual || l.vigencia_inicio > atual.vigencia_inicio) {
      ultima.set(l.chave, { valor: Number(l.valor), descricao: l.descricao, vigencia_inicio: l.vigencia_inicio });
    }
  }

  const novas: { tenant_id: string; chave: string; valor: number; descricao: string; vigencia_inicio: string }[] = [];
  const mudancas: { chave: string; antes: number; depois: number }[] = [];
  for (const x of v.valores) {
    const u = ultima.get(x.chave);
    if (!u) return { ok: false, message: "Parâmetro não encontrado. Recarregue a página." };
    if (v.vigencia_inicio <= u.vigencia_inicio) {
      return {
        ok: false,
        message: `A data tem de ser depois de ${dataBr(u.vigencia_inicio)}, quando começou o valor atual.`,
      };
    }
    if (x.valor === u.valor) continue;
    novas.push({ tenant_id: tenantId, chave: x.chave, valor: x.valor, descricao: u.descricao, vigencia_inicio: v.vigencia_inicio });
    mudancas.push({ chave: x.chave, antes: u.valor, depois: x.valor });
  }
  if (novas.length === 0) return { ok: false, message: "Nenhum valor mudou." };

  const { error } = await gate.supabase.from("fiscal_parametros").insert(novas);
  if (error) {
    if (error.code === "23505") return { ok: false, message: "Já existe um valor deste parâmetro começando nessa data." };
    return { ok: false, message: `Falha ao registrar o valor novo: ${error.message}` };
  }

  await logAuditEvent({
    acao: "fiscal_parametro.nova_vigencia",
    tenantId,
    entidadeTipo: "fiscal_parametro",
    entidadeId: null,
    metadata: { vigencia_inicio: v.vigencia_inicio, mudancas },
  });

  revalidar();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// LC 224/2025: a receita recebida antes da Apuração (decisão 145, item 7)
// ---------------------------------------------------------------------------

/**
 * Registra (ou troca) a receita bruta recebida por uma PJ num trimestre
 * anterior ao início da Apuração. A sobra de limite e o ajuste do ano da
 * LC 224 usam a receita do ano inteiro; os trimestres dentro da Apuração vêm
 * dos recebimentos e não se informam aqui.
 */
export async function registrarReceitaAnterior(input: unknown): Promise<Result> {
  const parsed = receitaAnteriorSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: primeiraMensagem(parsed.error.issues) };
  const gate = await checarGate("fiscal_receita_anterior.registrada");
  if (!gate.ok) return gate;
  const tenantId = gate.session.activeTenant.id;
  const v = parsed.data;
  if (v.trimestre >= trimestreDe(PRIMEIRA_COMPETENCIA)) {
    return { ok: false, message: "Esse trimestre já está na Apuração: a receita dele vem dos recebimentos." };
  }

  const { data: antes, error: erroAntes } = await gate.supabase
    .from("fiscal_receitas_anteriores")
    .select("receita_bruta")
    .eq("tenant_id", tenantId)
    .eq("empresa_contabil_id", v.empresa_contabil_id)
    .eq("trimestre", v.trimestre)
    .maybeSingle<{ receita_bruta: number | string }>();
  if (erroAntes) return { ok: false, message: `Falha ao ler a receita registrada: ${erroAntes.message}` };

  const { error } = await gate.supabase.from("fiscal_receitas_anteriores").upsert(
    {
      tenant_id: tenantId,
      empresa_contabil_id: v.empresa_contabil_id,
      trimestre: v.trimestre,
      receita_bruta: Math.round(v.receita_bruta * 100) / 100,
      observacao: v.observacao || null,
      informado_por: gate.session.profile.id,
    },
    { onConflict: "tenant_id,empresa_contabil_id,trimestre" },
  );
  if (error) return { ok: false, message: `Falha ao registrar a receita: ${error.message}` };

  await logAuditEvent({
    acao: "fiscal_receita_anterior.registrada",
    tenantId,
    entidadeTipo: "fiscal_receita_anterior",
    entidadeId: null,
    metadata: {
      empresa_contabil_id: v.empresa_contabil_id,
      trimestre: v.trimestre,
      antes: antes ? Number(antes.receita_bruta) : null,
      depois: Math.round(v.receita_bruta * 100) / 100,
    },
  });

  revalidar();
  revalidatePath("/financeiro/fiscal");
  return { ok: true };
}

