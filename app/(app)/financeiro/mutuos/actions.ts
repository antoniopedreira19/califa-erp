"use server";

/**
 * Mútuo entre empresas (decisão 230). As regras moram nas funções do banco, e o
 * log de auditoria é gravado por elas, na mesma transação. Cancelar a baixa e
 * excluir são os da transferência.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { createClient } from "@/lib/supabase/server";
import type { DadosDoMutuo } from "@/lib/financeiro/mutuo";
import { carregarMutuos } from "./dados";

type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; message: string };

async function gateFinanceiro(acaoTentada: string) {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo: "transferencia_contas",
      entidadeId: null,
      metadata: { acao_tentada: acaoTentada, motivo: "sem_permissao_financeira" },
    });
    return { ok: false as const, message: "Apenas admin ou financeiro pode lançar mútuo." };
  }
  return { ok: true as const, session, supabase: createClient() };
}

/** O texto da exceção do banco já vem pronto para a tela; o técnico não. */
function mensagemDoBanco(msg: string, generica: string): string {
  const limpa = msg.replace(/^.*?(?:ERROR|erro):\s*/i, "").trim();
  if (limpa && !/["]|\b[a-z]+_[a-z_]+\b/.test(limpa)) return limpa;
  return generica;
}

function revalidar() {
  revalidatePath("/financeiro/mutuos");
  revalidatePath("/financeiro/conciliacao");
  revalidatePath("/financeiro/contas-a-receber");
  revalidatePath("/financeiro/fluxo-caixa");
}

const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data.");

const dadosSchema = z.object({
  conta_origem_id: z.string().uuid().nullable(),
  conta_destino_id: z.string().uuid().nullable(),
  fornecedor_id: z.string().uuid().nullable(),
  valor: z.number().positive("Informe o valor do mútuo."),
  data_prevista: dataIso,
  descricao: z.string().trim().max(200).nullable(),
  trimestre: z.number().int().min(1).max(4),
  ano: z.number().int(),
  juros_ao_mes: z.number().positive("Informe juros maiores que zero, ou deixe vazio.").nullable(),
});

export async function carregarDadosDoMutuo(): Promise<Result<{ dados: DadosDoMutuo }>> {
  const gate = await gateFinanceiro("mutuo.dados_consultados");
  if (!gate.ok) return gate;
  try {
    return { ok: true, dados: await carregarMutuos(gate.supabase, gate.session.activeTenant.id) };
  } catch (e) {
    console.error("[mutuo.dados]", e);
    return { ok: false, message: "Não foi possível abrir o formulário. Tente de novo." };
  }
}

export async function criarMutuo(input: unknown): Promise<Result<{ id: string; codigo: string }>> {
  const parsed = dadosSchema.extend({ transferir: z.boolean() }).safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };
  const { transferir, ...dados } = parsed.data;

  const gate = await gateFinanceiro("mutuo.criado");
  if (!gate.ok) return gate;

  const { data: id, error } = await gate.supabase.rpc("criar_mutuo", { p_dados: dados, p_transferir: transferir });
  if (error || !id) {
    console.error("[mutuo.criar]", error?.message);
    return { ok: false, message: mensagemDoBanco(error?.message ?? "", "Não foi possível lançar o mútuo. Tente novamente.") };
  }
  const { data: linha } = await gate.supabase.from("transferencias_contas").select("codigo").eq("id", id as string).maybeSingle();

  revalidar();
  return { ok: true, id: id as string, codigo: linha?.codigo ?? "" };
}

export async function lancarMutuoPelaLinha(input: unknown): Promise<Result<{ codigo: string; previsto: boolean }>> {
  const parsed = z
    .object({ dados: dadosSchema, linha_id: z.string().uuid(), par_id: z.string().uuid().nullable() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };

  const gate = await gateFinanceiro("mutuo.lancado_pela_linha");
  if (!gate.ok) return gate;

  const { data, error } = await gate.supabase.rpc("lancar_mutuo_pela_linha", {
    p_dados: parsed.data.dados,
    p_linha_id: parsed.data.linha_id,
    p_par_id: parsed.data.par_id,
  });
  if (error || !data) {
    console.error("[mutuo.pela_linha]", error?.message);
    return { ok: false, message: mensagemDoBanco(error?.message ?? "", "Não foi possível lançar o mútuo. Tente novamente.") };
  }

  revalidar();
  const r = data as { codigo: string; previsto: boolean };
  return { ok: true, codigo: r.codigo, previsto: r.previsto };
}

export async function corrigirMutuo(input: unknown): Promise<Result> {
  const parsed = z
    .object({ id: z.string().uuid(), dados: dadosSchema, motivo: z.string().trim().min(10, "Explique o motivo da correção em pelo menos 10 caracteres.") })
    .safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };

  const gate = await gateFinanceiro("mutuo.corrigido");
  if (!gate.ok) return gate;

  const { error } = await gate.supabase.rpc("corrigir_mutuo", {
    p_mutuo_id: parsed.data.id,
    p_dados: parsed.data.dados,
    p_motivo: parsed.data.motivo,
  });
  if (error) {
    console.error("[mutuo.corrigir]", error.message);
    return { ok: false, message: mensagemDoBanco(error.message, "Não foi possível corrigir o mútuo. Tente novamente.") };
  }

  revalidar();
  return { ok: true };
}

export async function definirJurosDaAbertura(input: unknown): Promise<Result> {
  const parsed = z
    .object({ id: z.string().uuid(), juros_ao_mes: z.number().positive("Informe juros maiores que zero, ou deixe vazio.").nullable() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };

  const gate = await gateFinanceiro("mutuo.juros_da_abertura");
  if (!gate.ok) return gate;

  const { error } = await gate.supabase.rpc("definir_juros_da_abertura", {
    p_abertura_id: parsed.data.id,
    p_juros_ao_mes: parsed.data.juros_ao_mes,
  });
  if (error) {
    console.error("[mutuo.juros]", error.message);
    return { ok: false, message: mensagemDoBanco(error.message, "Não foi possível guardar os juros. Tente novamente.") };
  }

  revalidar();
  return { ok: true };
}

export async function lancarIofDoMutuo(input: unknown): Promise<Result> {
  const parsed = z
    .object({
      linha_id: z.string().uuid(),
      com_empresa_contabil_id: z.string().uuid().nullable(),
      com_fornecedor_id: z.string().uuid().nullable(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };

  const gate = await gateFinanceiro("mutuo.iof_lancado");
  if (!gate.ok) return gate;

  const { error } = await gate.supabase.rpc("lancar_iof_do_mutuo", {
    p_linha_id: parsed.data.linha_id,
    p_com_empresa_contabil_id: parsed.data.com_empresa_contabil_id,
    p_com_fornecedor_id: parsed.data.com_fornecedor_id,
  });
  if (error) {
    console.error("[mutuo.iof]", error.message);
    return { ok: false, message: mensagemDoBanco(error.message, "Não foi possível lançar o IOF. Tente novamente.") };
  }

  revalidar();
  return { ok: true };
}
