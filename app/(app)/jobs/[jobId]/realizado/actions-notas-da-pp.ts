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
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

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
  pps: Array<{ codigo: string; valor_na_pp: number | null; status: string }>;
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
    pps: Array<{ codigo: string; valor_na_pp: number | string | null; status: string }> | null;
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
        codigo: p.codigo,
        valor_na_pp: p.valor_na_pp === null ? null : Number(p.valor_na_pp),
        status: p.status,
      })),
    })),
  };
}
