"use server";

/**
 * A busca da NF do fornecedor pelo número (decisão 152, 07/10/2026).
 *
 * A mesma nota pode cobrir mais de uma PP. Quando a produção digita um
 * número que o fornecedor já tem no cadastro (`notas_fiscais_fornecedor`,
 * pela chave sem zeros à esquerda), a nota vem preenchida e travada: os
 * dados são os de lá, e só o financeiro corrige. Passa pela RPC
 * `notas_fiscais_do_fornecedor` (security definer) porque o freelancer não
 * lê o cadastro de notas.
 */

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";
import { checarPermissao } from "@/lib/permissoes-server";
import { hojeEmSaoPauloIso } from "@/lib/calculos/janelas-pagamento";

/** A nota do cadastro com aquele número, e as PPs que ela já cobre. */
export interface NotaExistente {
  nota_id: string;
  numero: string;
  numero_chave: string;
  /** "AAAA-MM-DD". */
  emissao: string;
  /** O valor TOTAL da nota. */
  valor: number;
  tomador: string;
  /** O financeiro já registrou (a nota já está na Apuração). */
  registrada: boolean;
  /** As PPs não canceladas que a nota cobre (sem a PP que está sendo editada). */
  pps: Array<{ id: string; codigo: string; valor_na_pp: number | null; status: string }>;
}

const entrada = z.object({
  fornecedorId: z.string().uuid(),
  numeros: z.array(z.string().trim().min(1).max(60)).min(1).max(30),
  excluirPPId: z.string().uuid().nullable(),
});

export async function buscarNotasDoFornecedor(
  fornecedorId: unknown,
  numeros: unknown,
  excluirPPId: unknown,
): Promise<{ ok: true; notas: NotaExistente[] } | { ok: false; message: string }> {
  const parsed = entrada.safeParse({ fornecedorId, numeros, excluirPPId: excluirPPId ?? null });
  if (!parsed.success) return { ok: true, notas: [] };
  await requireSession();
  const supabase = createClient();
  const { data, error } = await supabase.rpc("notas_fiscais_do_fornecedor", {
    p_fornecedor_id: parsed.data.fornecedorId,
    p_numeros: parsed.data.numeros,
    p_excluir_pp_id: parsed.data.excluirPPId,
  });
  if (error) {
    console.error("[pp.notas_do_fornecedor]", error.message);
    return { ok: false, message: "Não foi possível conferir a NF agora." };
  }
  const linhas = (data ?? []) as Array<{
    numero_chave: string;
    nota_id: string;
    numero: string;
    data_emissao: string;
    valor: number | string;
    tomador_estabelecimento_id: string;
    registrada: boolean;
    pps: Array<{ id: string; codigo: string; valor_na_pp: number | string | null; status: string }> | null;
  }>;
  return {
    ok: true,
    notas: linhas.map((l) => ({
      nota_id: l.nota_id,
      numero: l.numero,
      numero_chave: l.numero_chave,
      emissao: l.data_emissao.slice(0, 10),
      valor: Number(l.valor),
      tomador: l.tomador_estabelecimento_id,
      registrada: l.registrada === true,
      pps: (l.pps ?? []).map((p) => ({
        id: p.id,
        codigo: p.codigo,
        valor_na_pp: p.valor_na_pp === null ? null : Number(p.valor_na_pp),
        status: p.status,
      })),
    })),
  };
}

// ---------------------------------------------------------------------------
// A correção da NF da PP em avaliação (revisão da decisão 152, 07/10/2026)
// ---------------------------------------------------------------------------
//
// A PP já está no financeiro e a NF foi enviada errada — a parte desta PP
// maior que a PP, o CNPJ tomador trocado, o número digitado errado. Quem
// envia (GP e administrador) e o financeiro corrigem sem precisar aprovar:
// a parte desta PP sempre; os dados da nota enquanto o financeiro não a
// registrou, e aí a correção vale para todas as PPs com ela. O banco confere
// tudo de novo (`corrigir_notas_fiscais_da_pp`).

/** Uma NF da PP, como a correção a mostra. */
export interface NfDaPPParaCorrigir {
  anexo_id: string;
  nome: string;
  numero: string;
  /** "AAAA-MM-DD" ou "". */
  emissao: string;
  valor: number;
  tomador: string | null;
  /** A parte da nota nesta PP (null = a nota inteira). */
  valor_na_pp: number | null;
  created_at: string;
}

/** A PP em avaliação e as NFs dela. */
export interface PPParaCorrigirNf {
  id: string;
  codigo: string;
  valor: number;
  fornecedor_id: string;
  empresa_id: string;
  servico: string;
  nfs: NfDaPPParaCorrigir[];
}

type ResultadoCarga = { ok: true; pp: PPParaCorrigirNf } | { ok: false; message: string };

export async function carregarNfsDaPPParaCorrigir(ppId: unknown): Promise<ResultadoCarga> {
  const id = z.string().uuid().safeParse(ppId);
  if (!id.success) return { ok: false, message: "PP não encontrada." };
  const session = await requireSession();
  const gate = await checarPermissao(session, "jobs.corrigir_nf_pp", { pp_id: id.data });
  if (!gate.ok) return { ok: false, message: gate.message };
  const supabase = createClient();
  const { data: pp, error } = await supabase
    .from("pedidos_compra")
    .select(
      "id, codigo, status, valor, verba_producao, fornecedor_id, empresa_id, servico, " +
        "anexos:pedidos_compra_anexos(id, arquivo_nome_original, documento_tipo, documento_numero, nf_data_emissao, nf_valor, nf_tomador_estabelecimento_id, nf_valor_na_pp, created_at)",
    )
    .eq("id", id.data)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{
      id: string;
      codigo: string;
      status: string;
      valor: number | string;
      verba_producao: boolean;
      fornecedor_id: string | null;
      empresa_id: string;
      servico: string | null;
      anexos: Array<{
        id: string;
        arquivo_nome_original: string;
        documento_tipo: string | null;
        documento_numero: string | null;
        nf_data_emissao: string | null;
        nf_valor: number | string | null;
        nf_tomador_estabelecimento_id: string | null;
        nf_valor_na_pp: number | string | null;
        created_at: string;
      }> | null;
    }>();
  if (error) console.error("[pp.corrigir_nf.carregar]", error.message);
  if (!pp) return { ok: false, message: "PP não encontrada." };
  if (pp.status !== "em_avaliacao") {
    return { ok: false, message: `A NF só se corrige com a PP em avaliação no financeiro; a ${pp.codigo} não está.` };
  }
  if (pp.verba_producao || !pp.fornecedor_id) {
    return { ok: false, message: "Verba de produção não tem nota fiscal." };
  }
  const nfs = (pp.anexos ?? [])
    .filter((a) => a.documento_tipo === "nota_fiscal")
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((a) => ({
      anexo_id: a.id,
      nome: a.arquivo_nome_original,
      numero: a.documento_numero ?? "",
      emissao: (a.nf_data_emissao ?? "").slice(0, 10),
      valor: a.nf_valor === null ? 0 : Number(a.nf_valor),
      tomador: a.nf_tomador_estabelecimento_id,
      valor_na_pp: a.nf_valor_na_pp === null ? null : Number(a.nf_valor_na_pp),
      created_at: a.created_at,
    }));
  if (nfs.length === 0) return { ok: false, message: `A ${pp.codigo} não tem NF anexada.` };
  return {
    ok: true,
    pp: {
      id: pp.id,
      codigo: pp.codigo,
      valor: Number(pp.valor),
      fornecedor_id: pp.fornecedor_id,
      empresa_id: pp.empresa_id,
      servico: pp.servico ?? "",
      nfs,
    },
  };
}

const correcaoSchema = z.object({
  ppId: z.string().uuid(),
  notas: z
    .array(
      z.object({
        anexo_id: z.string().uuid(),
        numero: z.string().trim().min(1).max(60),
        data_emissao: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        valor: z.number().positive(),
        tomador_estabelecimento_id: z.string().uuid(),
        valor_na_pp: z.number().positive(),
      }),
    )
    .min(1)
    .max(30),
});

export async function corrigirNfsDaPP(
  input: unknown,
): Promise<{ ok: true; codigo: string } | { ok: false; message: string }> {
  const parsed = correcaoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Preencha cada NF: número, data de emissão, valor, CNPJ tomador e valor nesta PP." };
  }
  const { ppId, notas } = parsed.data;
  const futura = notas.find((n) => n.data_emissao > hojeEmSaoPauloIso());
  if (futura) return { ok: false, message: `A data de emissão da NF ${futura.numero} está no futuro.` };

  const session = await requireSession();
  const gate = await checarPermissao(session, "jobs.corrigir_nf_pp", { pp_id: ppId });
  if (!gate.ok) return { ok: false, message: gate.message };
  const supabase = createClient();

  const { data: antes } = await supabase
    .from("pedidos_compra")
    .select(
      "codigo, job_id, valor, anexos:pedidos_compra_anexos(id, documento_tipo, documento_numero, nf_data_emissao, nf_valor, nf_tomador_estabelecimento_id, nf_valor_na_pp)",
    )
    .eq("id", ppId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{
      codigo: string;
      job_id: string;
      valor: number | string;
      anexos: Array<{
        id: string;
        documento_tipo: string | null;
        documento_numero: string | null;
        nf_data_emissao: string | null;
        nf_valor: number | string | null;
        nf_tomador_estabelecimento_id: string | null;
        nf_valor_na_pp: number | string | null;
      }> | null;
    }>();
  if (!antes) return { ok: false, message: "PP não encontrada." };

  const { error } = await supabase.rpc("corrigir_notas_fiscais_da_pp", {
    p_pp_id: ppId,
    p_notas: notas,
  });
  if (error) {
    console.error("[pp.corrigir_nf]", error.message);
    const limpa = error.message.replace(/^.*?(?:ERROR|erro):\s*/i, "").trim();
    return {
      ok: false,
      message: limpa && !/[_"]/.test(limpa) ? limpa : "Não foi possível corrigir a NF. Tente novamente.",
    };
  }

  await logAuditEvent({
    acao: "pedido_compra.nf_corrigida",
    tenantId: session.activeTenant.id,
    entidadeTipo: "pedido_compra",
    entidadeId: ppId,
    metadata: {
      pp_codigo: antes.codigo,
      valor_pp: Number(antes.valor),
      antes: (antes.anexos ?? [])
        .filter((a) => a.documento_tipo === "nota_fiscal")
        .map((a) => ({
          anexo_id: a.id,
          numero: a.documento_numero,
          data_emissao: a.nf_data_emissao,
          valor: a.nf_valor === null ? null : Number(a.nf_valor),
          tomador_estabelecimento_id: a.nf_tomador_estabelecimento_id,
          valor_na_pp: a.nf_valor_na_pp === null ? null : Number(a.nf_valor_na_pp),
        })),
      depois: notas,
      papel: session.activeRole,
    },
  });

  revalidatePath(`/jobs/${antes.job_id}`);
  revalidatePath(`/financeiro/jobs/${antes.job_id}`);
  revalidatePath("/financeiro/contas-a-pagar");
  return { ok: true, codigo: antes.codigo };
}
