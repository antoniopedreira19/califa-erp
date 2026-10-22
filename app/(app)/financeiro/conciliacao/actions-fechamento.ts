"use server";

/**
 * O fechamento da conciliação (task 029, fase 4, decisão 205): fechar até o
 * último dia completo dos extratos e reabrir com motivo. As regras moram nas funções do
 * banco (`fechar_conciliacao`, `reabrir_conciliacao`) e no gatilho dos
 * lançamentos, que travam qualquer caminho; aqui só a forma da entrada e as
 * mensagens.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

type Resultado = { ok: true } | { ok: false; message: string };

const UUID = z.string().uuid();
const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** As funções do banco levantam exceção com o texto pronto para a tela; o
 *  que não for assim (erro técnico) vira a mensagem genérica. */
function mensagemDoBanco(msg: string, generica: string): string {
  const limpa = msg.replace(/^.*?(?:ERROR|erro):\s*/i, "").trim();
  if (limpa && !/["]|\b[a-z]+_[a-z_]+\b/.test(limpa)) return limpa;
  return generica;
}

async function gate() {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    return { ok: false as const, message: "Só admin ou financeiro concilia o extrato do banco." };
  }
  return { ok: true as const, session, supabase: createClient() };
}

function revalidar() {
  revalidatePath("/financeiro/conciliacao");
}

/** Fecha a conciliação da conta até o dia (o último dia completo dos
 *  extratos). O banco confere as três condições de novo. */
export async function fecharConciliacao(contaId: string, ate: string): Promise<Resultado> {
  if (!UUID.safeParse(contaId).success || !DATA.safeParse(ate).success) return { ok: false, message: "Entrada inválida." };
  const g = await gate();
  if (!g.ok) return g;
  const { error } = await g.supabase.rpc("fechar_conciliacao", { p_conta_id: contaId, p_ate: ate });
  if (error) {
    console.error("[conciliacao.fechar]", error.message);
    return { ok: false, message: mensagemDoBanco(error.message, "Não foi possível fechar a conciliação. Tente de novo.") };
  }
  revalidar();
  return { ok: true };
}

/** Reabre o período fechado da conta, com o motivo (10 caracteres ou mais). */
export async function reabrirConciliacao(contaId: string, motivo: string): Promise<Resultado> {
  if (!UUID.safeParse(contaId).success) return { ok: false, message: "Entrada inválida." };
  const texto = typeof motivo === "string" ? motivo.trim() : "";
  if (texto.length < 10) return { ok: false, message: "Explique o motivo (pelo menos 10 caracteres)." };
  if (texto.length > 1000) return { ok: false, message: "O motivo passa de 1.000 caracteres: resuma." };
  const g = await gate();
  if (!g.ok) return g;
  const { error } = await g.supabase.rpc("reabrir_conciliacao", { p_conta_id: contaId, p_motivo: texto });
  if (error) {
    console.error("[conciliacao.reabrir]", error.message);
    return { ok: false, message: mensagemDoBanco(error.message, "Não foi possível reabrir o período. Tente de novo.") };
  }
  revalidar();
  return { ok: true };
}
