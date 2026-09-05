"use server";

import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { checarPermissao } from "@/lib/permissoes-server";
import { createClient } from "@/lib/supabase/server";
import { listarCidades, buscarSugestoesHibridas } from "@/lib/data/cidades";
import type { CidadeSugestao } from "@/lib/data/cidades";

/**
 * Busca de cidades do combobox do orçamento.
 *
 * Devolve o que ESTÁ no cadastro local do tenant + sugestões do IBGE que
 * ainda não foram cadastradas (com marcador `origem='ibge'`). Ao escolher
 * uma sugestão, o combobox chama `criarCidadeDoIBGE` pra materializá-la
 * no cadastro. Sem termo, mostra só o cadastro local (LIMITE_CIDADES).
 */
export async function buscarCidades(
  termo: string,
): Promise<CidadeSugestao[]> {
  const session = await requireSession();
  const q = termo.trim();
  if (q.length === 0) {
    const locais = await listarCidades(session.activeTenant.id);
    return locais.map((c) => ({
      origem: "local" as const,
      id: c.id,
      nome: c.nome,
      uf: c.uf,
    }));
  }
  return buscarSugestoesHibridas(session.activeTenant.id, q);
}

type CriarResult =
  | { ok: true; id: string; nome: string; uf: string | null }
  | { ok: false; message: string };

/**
 * Cria (ou reutiliza) uma cidade no cadastro do tenant a partir de uma
 * sugestão do IBGE. Usado quando o produtor escolhe uma cidade que ainda
 * não existe localmente — cadastra em 1 clique, sem sair do formulário.
 *
 * Idempotente: se já existir uma cidade com o mesmo `ibge_codigo` no
 * tenant (independente de estar ativa), reaproveita e reativa se preciso.
 * Permissão: `cadastros.cidades.inline` (produtor + up).
 */
export async function criarCidadeDoIBGE(
  ibgeCodigo: string,
  nome: string,
  uf: string,
): Promise<CriarResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "cadastros.cidades.inline");
  if (!gate.ok) return gate;

  if (!/^[0-9]{7}$/.test(ibgeCodigo)) {
    return { ok: false, message: "Código IBGE inválido." };
  }
  if (!/^[A-Z]{2}$/.test(uf)) {
    return { ok: false, message: "UF inválida." };
  }
  const nomeLimpo = nome.trim();
  if (nomeLimpo.length === 0 || nomeLimpo.length > 80) {
    return { ok: false, message: "Nome da cidade inválido." };
  }

  const supabase = createClient();

  // Idempotência: se essa cidade IBGE já existe no tenant, reusa. Reativa
  // caso estivesse inativa — o usuário acabou de pedir por ela.
  const { data: existente, error: buscaErr } = await supabase
    .from("cidades")
    .select("id, nome, uf, ativo")
    .eq("tenant_id", session.activeTenant.id)
    .eq("ibge_codigo", ibgeCodigo)
    .maybeSingle();

  if (buscaErr) {
    console.error("[cidades.criar_ibge.busca]", buscaErr.message);
    return { ok: false, message: "Não foi possível cadastrar a cidade." };
  }

  if (existente) {
    if (!existente.ativo) {
      const { error: reativarErr } = await supabase
        .from("cidades")
        .update({ ativo: true })
        .eq("id", existente.id)
        .eq("tenant_id", session.activeTenant.id);
      if (reativarErr) {
        console.error("[cidades.criar_ibge.reativar]", reativarErr.message);
        return { ok: false, message: "Não foi possível reativar a cidade." };
      }
    }
    return {
      ok: true,
      id: existente.id,
      nome: existente.nome,
      uf: existente.uf,
    };
  }

  const { data, error } = await supabase
    .from("cidades")
    .insert({
      tenant_id: session.activeTenant.id,
      nome: nomeLimpo,
      uf,
      ibge_codigo: ibgeCodigo,
      fonte: "ibge",
      created_by: session.profile.id,
    })
    .select("id, nome, uf")
    .single();

  if (error) {
    console.error("[cidades.criar_ibge]", error.message);
    // Concorrência: duas requisições viram null no lookup e caem no insert.
    // A segunda esbarra no unique index — refaz a busca e devolve o vencedor.
    if (error.message.includes("uniq_cidade_ibge_por_tenant")) {
      const { data: vencedor } = await supabase
        .from("cidades")
        .select("id, nome, uf")
        .eq("tenant_id", session.activeTenant.id)
        .eq("ibge_codigo", ibgeCodigo)
        .single();
      if (vencedor) {
        return { ok: true, id: vencedor.id, nome: vencedor.nome, uf: vencedor.uf };
      }
    }
    return { ok: false, message: "Não foi possível cadastrar a cidade." };
  }

  await logAuditEvent({
    acao: "cidade.criada_inline_ibge",
    tenantId: session.activeTenant.id,
    entidadeTipo: "cidade",
    entidadeId: data.id,
    metadata: { nome: nomeLimpo, uf, ibge_codigo: ibgeCodigo },
  });

  return { ok: true, id: data.id, nome: data.nome, uf: data.uf };
}
