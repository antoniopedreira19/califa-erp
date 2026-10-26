"use server";

/**
 * A carga do histórico da planilha financeira (decisão 211, A1).
 *
 * O pacote (.json do script `empacotar.ts`) é lido no navegador e chega aqui
 * em partes: o limite do corpo da Server Action é 1 MB, e o pacote da
 * primeira carga passa de 20 MB. O que vem do navegador não é confiável, então
 * cada parte é conferida de novo aqui — as colunas e o formato de cada campo,
 * pelo contrato de `lib/historico-financeiro/pacote.ts` — e gravada pela
 * função do banco, que liga os textos aos cadastros, confere a conta e o
 * período e não repete linha. Concluir confere as linhas e as somas com o que
 * o pacote declarou; desfazer apaga as linhas e deixa o registro da carga.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  ESQUEMA_DO_CABECALHO,
  LINHAS_POR_PARTE,
  NOME_DA_TABELA,
  TABELAS_DO_PACOTE,
  colunasConferem,
  linhaComoObjeto,
  type TabelaDoPacote,
  type ValorDoPacote,
} from "@/lib/historico-financeiro/pacote";
import type { TabelaDoHistorico } from "@/lib/types";

const CAMINHO = "/financeiro/cadastros/historico";
const UUID = z.string().uuid();

type Resultado<T extends object = object> = ({ ok: true } & T) | { ok: false; message: string };

async function gate() {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    return { ok: false as const, message: "Só admin ou financeiro carrega o histórico da planilha." };
  }
  return { ok: true as const, session, supabase: createClient() };
}

/** As funções do banco levantam exceção com o texto pronto para a tela
 *  (`raise exception`, código P0001, e a trava de papel, 42501); o resto é
 *  erro técnico e vira a mensagem genérica. */
function mensagemDoBanco(erro: { code?: string; message: string }, generica: string): string {
  return erro.code === "P0001" || erro.code === "42501" ? erro.message : generica;
}

const ESQUEMA_PARA_INICIAR = ESQUEMA_DO_CABECALHO.extend({
  pacote: z.object({ arquivo: z.string().trim().min(1).max(255), sha256: z.string().regex(/^[0-9a-f]{64}$/) }),
});

export type CabecalhoParaIniciar = z.infer<typeof ESQUEMA_PARA_INICIAR>;

export async function iniciarCarga(cabecalho: CabecalhoParaIniciar): Promise<Resultado<{ cargaId: string }>> {
  const g = await gate();
  if (!g.ok) return g;
  const lido = ESQUEMA_PARA_INICIAR.safeParse(cabecalho);
  if (!lido.success) return { ok: false, message: "O cabeçalho do pacote não tem o formato esperado." };
  const { carga, planilha, pacote, esperado } = lido.data;
  const { data, error } = await g.supabase.rpc("historico_iniciar_carga", {
    p_tenant_id: g.session.activeTenant.id,
    p_cabecalho: { carga, planilha, pacote, esperado },
  });
  if (error) {
    console.error("[historico.iniciar]", error.message);
    return { ok: false, message: mensagemDoBanco(error, "Não foi possível começar a carga. Tente de novo.") };
  }
  revalidatePath(CAMINHO);
  return { ok: true, cargaId: data as string };
}

export async function gravarParte(
  cargaId: string,
  tabela: TabelaDoPacote,
  colunas: string[],
  linhas: ValorDoPacote[][],
): Promise<Resultado<{ gravadas: number }>> {
  const g = await gate();
  if (!g.ok) return g;
  if (!UUID.safeParse(cargaId).success) return { ok: false, message: "Carga inválida." };
  if (!TABELAS_DO_PACOTE.includes(tabela)) return { ok: false, message: "Tabela desconhecida." };
  const nome = NOME_DA_TABELA[tabela];
  if (!Array.isArray(colunas) || !colunasConferem(tabela, colunas)) {
    return { ok: false, message: `As colunas de ${nome.toLowerCase()} não são as do pacote.` };
  }
  if (!Array.isArray(linhas) || linhas.length === 0 || linhas.length > LINHAS_POR_PARTE) {
    return { ok: false, message: `Cada parte leva de 1 a ${LINHAS_POR_PARTE.toLocaleString("pt-BR")} linhas.` };
  }
  // A origem na planilha ajuda a achar a linha que não serve.
  const kAba = colunas.indexOf("aba");
  const kLinha = colunas.indexOf("linha");
  const objetos: Record<string, ValorDoPacote>[] = [];
  for (let k = 0; k < linhas.length; k++) {
    const r = linhaComoObjeto(tabela, linhas[k]);
    if (!r.ok) {
      const onde =
        kAba >= 0 && kLinha >= 0 && Array.isArray(linhas[k])
          ? `aba ${String(linhas[k][kAba])}, linha ${String(linhas[k][kLinha])}`
          : `linha ${k + 1} da parte`;
      return { ok: false, message: `${nome}, ${onde}: ${r.message}.` };
    }
    objetos.push(r.linha);
  }
  const { data, error } = await g.supabase.rpc("historico_gravar_parte", {
    p_carga_id: cargaId,
    p_tabela: tabela,
    p_linhas: objetos,
  });
  if (error) {
    console.error("[historico.gravar_parte]", tabela, error.message);
    return { ok: false, message: mensagemDoBanco(error, `Não foi possível gravar uma parte de ${nome.toLowerCase()}. Tente de novo.`) };
  }
  return { ok: true, gravadas: data as number };
}

export async function concluirCarga(
  cargaId: string,
): Promise<Resultado<{ linhas: Record<TabelaDoHistorico, number>; substituidas: number }>> {
  const g = await gate();
  if (!g.ok) return g;
  if (!UUID.safeParse(cargaId).success) return { ok: false, message: "Carga inválida." };
  const { data, error } = await g.supabase.rpc("historico_concluir_carga", { p_carga_id: cargaId });
  if (error) {
    console.error("[historico.concluir]", error.message);
    return { ok: false, message: mensagemDoBanco(error, "Não foi possível concluir a carga. Tente de novo.") };
  }
  revalidatePath(CAMINHO);
  const r = data as { linhas: Record<TabelaDoHistorico, number>; substituidas: number };
  return { ok: true, linhas: r.linhas, substituidas: r.substituidas };
}

/** Desfaz a carga ativa ou descarta a que ficou incompleta: as linhas saem, o registro fica. */
export async function desfazerCarga(cargaId: string): Promise<Resultado<{ situacao: "desfeita" | "descartada" }>> {
  const g = await gate();
  if (!g.ok) return g;
  if (!UUID.safeParse(cargaId).success) return { ok: false, message: "Carga inválida." };
  const { data, error } = await g.supabase.rpc("historico_desfazer_carga", { p_carga_id: cargaId });
  if (error) {
    console.error("[historico.desfazer]", error.message);
    return { ok: false, message: mensagemDoBanco(error, "Não foi possível desfazer a carga. Tente de novo.") };
  }
  revalidatePath(CAMINHO);
  return { ok: true, situacao: (data as { situacao: "desfeita" | "descartada" }).situacao };
}

/** As contas e as empresas do pacote que não estão cadastradas: sem elas, a carga não entra. */
export async function conferirCadastros(nomes: {
  contas: string[];
  empresas: string[];
}): Promise<Resultado<{ contas: string[]; empresas: string[] }>> {
  const g = await gate();
  if (!g.ok) return g;
  const lido = z
    .object({ contas: z.array(z.string().max(120)).max(100), empresas: z.array(z.string().max(120)).max(100) })
    .safeParse(nomes);
  if (!lido.success) return { ok: false, message: "Lista de cadastros inválida." };
  const tenantId = g.session.activeTenant.id;
  const [contasRes, empresasRes] = await Promise.all([
    g.supabase.from("contas_bancarias").select("nome").eq("tenant_id", tenantId),
    g.supabase.from("empresas").select("nome_fantasia, razao_social").eq("tenant_id", tenantId),
  ]);
  if (contasRes.error || empresasRes.error) {
    console.error("[historico.conferir]", contasRes.error?.message ?? empresasRes.error?.message);
    return { ok: false, message: "Não foi possível ler as contas e as empresas. Tente de novo." };
  }
  const contas = new Set((contasRes.data ?? []).map((c: { nome: string }) => c.nome));
  const empresas = new Set(
    (empresasRes.data ?? []).map((e: { nome_fantasia: string | null; razao_social: string }) => e.nome_fantasia ?? e.razao_social),
  );
  return {
    ok: true,
    contas: lido.data.contas.filter((c) => !contas.has(c)),
    empresas: lido.data.empresas.filter((e) => !empresas.has(e)),
  };
}
