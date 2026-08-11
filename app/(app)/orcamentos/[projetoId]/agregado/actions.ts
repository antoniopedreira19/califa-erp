"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { grupoSchema } from "@/lib/validations/grupos";
import { itemSchema } from "@/lib/validations/itens";
import { bvSchema } from "@/lib/validations/bv";
import type {
  AlteracoesProjetoPayload,
  OrcamentoEdicaoPayload,
  ParametrosVersao,
} from "../../_rascunho/tipos";
import { salvarOrcamentosDoProjeto } from "../multi/actions";

/** Tipos em que o cliente paga o fornecedor direto — os únicos com BV. */
const TIPOS_COM_BV = ["A", "D"];

/** Status do orçamento em que a planilha não se altera mais por aqui. */
const ORCAMENTO_CONGELADO = ["aprovado", "job_criado", "cancelado", "recusado"];

export type SalvarAlteracoesResult =
  | {
      ok: true;
      editados: number;
      criados: number;
      /** Id local → id real das linhas recém-inseridas. O editor troca os
       *  seus ids com isso; sem essa volta, um segundo "Salvar alterações"
       *  antes de a página recarregar inseriria as mesmas linhas de novo. */
      ids: Record<string, string>;
    }
  | { ok: false; message: string };

interface ItemAtual {
  id: string;
  grupo_id: string;
  item: string;
  tipo_custo: string;
  categoria_id: string | null;
  valor_unitario_orcado: number | string;
  quantidade_orcada: number | string;
  dias_meses_orcado: number | string;
  valor_unitario_planejado: number | string;
  quantidade_planejada: number | string;
  dias_meses_planejado: number | string;
  planilha_origem: string | null;
}

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function faixaPercentual(valor: unknown): number {
  const n = Number(valor);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

/**
 * Grava as alterações feitas na visão agregada.
 *
 * Recebe o estado desejado de cada orçamento já existente e reconcilia por
 * id contra o que está no banco — quem sumiu do payload é removido, quem
 * tem id é atualizado, quem não tem é inserido. Os orçamentos criados na
 * tela seguem pelo mesmo caminho do editor do orçamento do projeto.
 *
 * As travas de "não pode editar" são reconferidas aqui: a tela esconde os
 * botões, mas quem posta pode mandar qualquer coisa.
 */
export async function salvarAlteracoesDoProjeto(
  projetoId: string,
  formData: FormData,
): Promise<SalvarAlteracoesResult> {
  const session = await requireSession();
  const tenantId = session.activeTenant.id;

  const bruto = formData.get("payload")?.toString();
  if (!bruto) return { ok: false, message: "Nada para salvar." };

  let payload: AlteracoesProjetoPayload;
  try {
    payload = JSON.parse(bruto) as AlteracoesProjetoPayload;
  } catch {
    return { ok: false, message: "Alterações inválidas. Recarregue a tela." };
  }

  const editados = Array.isArray(payload.editados) ? payload.editados : [];
  const novos = Array.isArray(payload.novos) ? payload.novos : [];
  if (editados.length === 0 && novos.length === 0) {
    return { ok: false, message: "Nada para salvar." };
  }

  const supabase = createClient();

  const { data: projeto } = await supabase
    .from("projetos")
    .select("id")
    .eq("id", projetoId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ id: string }>();
  if (!projeto) return { ok: false, message: "Projeto não encontrado." };

  // ---------- Validação de forma, antes de qualquer escrita ----------
  for (const alvo of editados) {
    const erro = validarFormato(alvo);
    if (erro) return { ok: false, message: erro };
  }

  // ---------- Edições ----------
  const ids: Record<string, string> = {};
  for (const alvo of editados) {
    const res = await aplicarEdicao(alvo, projetoId, tenantId, session.profile.id);
    if (!res.ok) return res;
    Object.assign(ids, res.ids);
  }

  // ---------- Orçamentos novos ----------
  // Um por chamada: cada um tem os seus próprios parâmetros, e a action de
  // criação já cuida de código sequencial, importação e rollback.
  let criados = 0;
  for (const [i, novo] of novos.entries()) {
    const parametros: ParametrosVersao = payload.parametrosNovos?.[i] ?? {
      moeda: "BRL",
      taxa_cambio: 1,
      percentual_honorarios: 0,
      percentual_imposto: 0,
    };

    const fd = new FormData();
    fd.set(
      "payload",
      JSON.stringify({
        moeda: parametros.moeda,
        taxa_cambio: parametros.taxa_cambio,
        // Vai no payload por compatibilidade da tipagem; a action de criação
        // ignora e lê os honorários do cadastro do cliente do projeto.
        percentual_honorarios: parametros.percentual_honorarios,
        percentual_imposto: parametros.percentual_imposto,
        jobs: [novo],
      }),
    );
    if (novo.arquivoCampo) {
      const arquivo = formData.get(novo.arquivoCampo);
      if (arquivo instanceof File) fd.set(novo.arquivoCampo, arquivo);
    }

    const res = await salvarOrcamentosDoProjeto(projetoId, fd);
    if (!res.ok) {
      return {
        ok: false,
        message:
          editados.length > 0
            ? `As edições foram salvas, mas o orçamento novo falhou: ${res.message}`
            : res.message,
      };
    }
    criados += res.criados;
  }

  revalidatePath(`/orcamentos/${projetoId}`);
  revalidatePath(`/orcamentos/${projetoId}/agregado`);
  return { ok: true, editados: editados.length, criados, ids };
}

/** Valida nomes de grupo, itens e BVs. Sem tocar no banco. */
function validarFormato(alvo: OrcamentoEdicaoPayload): string | null {
  const grupos = Array.isArray(alvo.grupos) ? alvo.grupos : [];
  for (const grupo of grupos) {
    const nomeOk = grupoSchema.safeParse({ nome: grupo.nome ?? "" });
    if (!nomeOk.success) {
      return nomeOk.error.errors[0]?.message ?? "Grupo sem nome.";
    }
    for (const item of grupo.itens ?? []) {
      const itemOk = itemSchema.safeParse(item);
      if (!itemOk.success) {
        return `${grupo.nome}: ${itemOk.error.errors[0]?.message ?? "item inválido."}`;
      }
      if (item.bv) {
        if (!TIPOS_COM_BV.includes(itemOk.data.tipo_custo)) {
          return `${item.item}: BV só existe em item de custo tipo A ou D.`;
        }
        const bvOk = bvSchema.safeParse(item.bv);
        if (!bvOk.success) {
          return `${item.item}: ${bvOk.error.errors[0]?.message ?? "BV inválido."}`;
        }
      }
    }
  }
  return null;
}

async function aplicarEdicao(
  alvo: OrcamentoEdicaoPayload,
  projetoId: string,
  tenantId: string,
  profileId: string,
): Promise<SalvarAlteracoesResult> {
  const supabase = createClient();

  // ---------- Travas ----------
  const [orcRes, versaoRes] = await Promise.all([
    supabase
      .from("orcamentos")
      .select("id, codigo, nome, status, projeto_id")
      .eq("id", alvo.orcamentoId)
      .eq("tenant_id", tenantId)
      .maybeSingle<{
        id: string;
        codigo: string;
        nome: string;
        status: string;
        projeto_id: string;
      }>(),
    supabase
      .from("versoes_orcamento")
      .select("id, orcamento_id, status")
      .eq("id", alvo.versaoId)
      .eq("tenant_id", tenantId)
      .maybeSingle<{ id: string; orcamento_id: string; status: string }>(),
  ]);

  const orcamento = orcRes.data;
  const versao = versaoRes.data;

  if (!orcamento || orcamento.projeto_id !== projetoId) {
    return { ok: false, message: "Orçamento não encontrado neste projeto." };
  }
  if (!versao || versao.orcamento_id !== orcamento.id) {
    return { ok: false, message: `${orcamento.codigo}: versão não encontrada.` };
  }
  if (ORCAMENTO_CONGELADO.includes(orcamento.status)) {
    return {
      ok: false,
      message: `${orcamento.codigo} está em ${orcamento.status} e não pode mais ser editado aqui.`,
    };
  }
  if (versao.status === "aprovada") {
    return {
      ok: false,
      message: `${orcamento.codigo}: versão aprovada não permite alterar itens.`,
    };
  }

  // ---------- Parâmetros da versão ----------
  // `percentual_honorarios` NÃO entra aqui de propósito: em versão que já
  // existe ele só muda pelo "Editar" da tela da versão, e só com role
  // `administrador` (decisão de 11/08/2026). Esta tela preserva o gravado.
  const { error: paramErr } = await supabase
    .from("versoes_orcamento")
    .update({
      moeda: (alvo.parametros.moeda || "BRL").toUpperCase().slice(0, 3),
      taxa_cambio:
        Number(alvo.parametros.taxa_cambio) > 0
          ? Number(alvo.parametros.taxa_cambio)
          : 1,
      percentual_imposto: faixaPercentual(alvo.parametros.percentual_imposto),
    })
    .eq("id", versao.id)
    .eq("tenant_id", tenantId);

  if (paramErr) {
    console.error("[agregado.parametros]", paramErr.message);
    return {
      ok: false,
      message: `${orcamento.codigo}: não foi possível salvar os parâmetros.`,
    };
  }

  // ---------- Estado atual ----------
  const [gruposRes, itensRes] = await Promise.all([
    supabase
      .from("versoes_orcamento_grupos")
      .select("id, nome, ordem")
      .eq("versao_orcamento_id", versao.id)
      .eq("tenant_id", tenantId),
    supabase
      .from("versoes_orcamento_itens")
      .select(
        "id, grupo_id, item, tipo_custo, categoria_id, planilha_origem, " +
          "valor_unitario_orcado, quantidade_orcada, dias_meses_orcado, " +
          "valor_unitario_planejado, quantidade_planejada, dias_meses_planejado",
      )
      .eq("versao_orcamento_id", versao.id)
      .eq("tenant_id", tenantId),
  ]);

  const gruposAtuais = (gruposRes.data ?? []) as {
    id: string;
    nome: string;
    ordem: number;
  }[];
  const itensAtuais = (itensRes.data ?? []) as unknown as ItemAtual[];

  const bvsRes =
    itensAtuais.length > 0
      ? await supabase
          .from("itens_bv")
          .select("id, item_versao_id, fornecedor_id, valor, prazo_repasse")
          .eq("tenant_id", tenantId)
          .neq("situacao", "cancelado")
          .in(
            "item_versao_id",
            itensAtuais.map((i) => i.id),
          )
      : { data: [] as any[] };

  const bvsAtuais = new Map<
    string,
    { id: string; fornecedor_id: string | null; valor: number; prazo_repasse: string | null }
  >(
    ((bvsRes.data ?? []) as any[]).map((b) => [
      b.item_versao_id as string,
      {
        id: b.id as string,
        fornecedor_id: b.fornecedor_id as string | null,
        valor: num(b.valor),
        prazo_repasse: b.prazo_repasse as string | null,
      },
    ]),
  );

  // ---------- Grupos ----------
  const ids: Record<string, string> = {};
  const grupoIdPorIndice = new Map<number, string>();
  const gruposMantidos = new Set<string>();

  for (const [i, grupo] of alvo.grupos.entries()) {
    const ordem = i + 1;
    const nome = grupo.nome.trim();

    if (grupo.id) {
      const atual = gruposAtuais.find((g) => g.id === grupo.id);
      if (!atual) {
        return {
          ok: false,
          message: `${orcamento.codigo}: um grupo foi removido por outra pessoa enquanto você editava. Recarregue a tela.`,
        };
      }
      gruposMantidos.add(grupo.id);
      grupoIdPorIndice.set(i, grupo.id);
      if (atual.nome !== nome || atual.ordem !== ordem) {
        const { error } = await supabase
          .from("versoes_orcamento_grupos")
          .update({ nome, ordem })
          .eq("id", grupo.id)
          .eq("tenant_id", tenantId);
        if (error) {
          console.error("[agregado.grupo.update]", error.message);
          return {
            ok: false,
            message: `${orcamento.codigo}: não foi possível renomear o grupo "${nome}".`,
          };
        }
      }
    } else {
      const { data, error } = await supabase
        .from("versoes_orcamento_grupos")
        .insert({
          tenant_id: tenantId,
          versao_orcamento_id: versao.id,
          nome,
          ordem,
        })
        .select("id")
        .single();
      if (error || !data) {
        console.error("[agregado.grupo.insert]", error?.message);
        return {
          ok: false,
          message: `${orcamento.codigo}: não foi possível criar o grupo "${nome}".`,
        };
      }
      gruposMantidos.add(data.id);
      grupoIdPorIndice.set(i, data.id);
      ids[grupo.localId] = data.id;
    }
  }

  // ---------- Itens ----------
  const itensMantidos = new Set<string>();
  // A ordem é global dentro da versão, como no resto do app.
  let ordemItem = 0;

  for (const [i, grupo] of alvo.grupos.entries()) {
    const grupoId = grupoIdPorIndice.get(i);
    if (!grupoId) continue;

    for (const item of grupo.itens ?? []) {
      ordemItem += 1;
      const dados = itemSchema.parse(item);
      const linha = {
        ...dados,
        grupo_id: grupoId,
        ordem: ordemItem,
        planilha_origem: item.planilha_origem ?? null,
      };

      let itemId = item.id;

      if (itemId) {
        const atual = itensAtuais.find((it) => it.id === itemId);
        if (!atual) {
          return {
            ok: false,
            message: `${orcamento.codigo}: um item foi removido por outra pessoa enquanto você editava. Recarregue a tela.`,
          };
        }
        itensMantidos.add(itemId);
        if (mudou(atual, linha)) {
          const { error } = await supabase
            .from("versoes_orcamento_itens")
            .update(linha)
            .eq("id", itemId)
            .eq("tenant_id", tenantId);
          if (error) {
            console.error("[agregado.item.update]", error.message);
            return {
              ok: false,
              message: `${orcamento.codigo}: não foi possível salvar o item "${dados.item}".`,
            };
          }
        }
      } else {
        const { data, error } = await supabase
          .from("versoes_orcamento_itens")
          .insert({
            ...linha,
            tenant_id: tenantId,
            versao_orcamento_id: versao.id,
          })
          .select("id")
          .single();
        if (error || !data) {
          console.error("[agregado.item.insert]", error?.message);
          return {
            ok: false,
            message: `${orcamento.codigo}: não foi possível criar o item "${dados.item}".`,
          };
        }
        itemId = data.id;
        itensMantidos.add(itemId!);
        ids[item.localId] = itemId!;
      }

      // ---------- BV do item ----------
      const bvAtual = bvsAtuais.get(itemId!);
      const bvDesejado = item.bv ? bvSchema.parse(item.bv) : null;

      if (!bvDesejado && bvAtual) {
        // Removido na tela: cancela, mesmo caminho do botão "Remover BV".
        const { error } = await supabase
          .from("itens_bv")
          .update({ situacao: "cancelado" })
          .eq("id", bvAtual.id)
          .eq("tenant_id", tenantId);
        if (error) console.error("[agregado.bv.cancelar]", error.message);
      } else if (bvDesejado && !bvAtual) {
        const { error } = await supabase.from("itens_bv").insert({
          tenant_id: tenantId,
          item_versao_id: itemId,
          fornecedor_id: bvDesejado.fornecedor_id,
          valor: bvDesejado.valor,
          prazo_repasse: bvDesejado.prazo_repasse,
          situacao: "a_negociar",
          created_by: profileId,
        });
        if (error) {
          console.error("[agregado.bv.insert]", error.message);
          return {
            ok: false,
            message: `${orcamento.codigo}: não foi possível gravar o BV de "${dados.item}".`,
          };
        }
      } else if (bvDesejado && bvAtual) {
        const igual =
          bvAtual.fornecedor_id === bvDesejado.fornecedor_id &&
          bvAtual.valor === bvDesejado.valor &&
          bvAtual.prazo_repasse === bvDesejado.prazo_repasse;
        if (!igual) {
          const { error } = await supabase
            .from("itens_bv")
            .update({
              fornecedor_id: bvDesejado.fornecedor_id,
              valor: bvDesejado.valor,
              prazo_repasse: bvDesejado.prazo_repasse,
            })
            .eq("id", bvAtual.id)
            .eq("tenant_id", tenantId);
          if (error) console.error("[agregado.bv.update]", error.message);
        }
      }
    }
  }

  // ---------- Remoções ----------
  // Itens antes dos grupos: a FK entre os dois é `on delete restrict`.
  const itensRemovidos = itensAtuais
    .filter((it) => !itensMantidos.has(it.id))
    .map((it) => it.id);

  if (itensRemovidos.length > 0) {
    const { error } = await supabase
      .from("versoes_orcamento_itens")
      .delete()
      .in("id", itensRemovidos)
      .eq("tenant_id", tenantId);
    if (error) {
      console.error("[agregado.item.delete]", error.message);
      return {
        ok: false,
        message: `${orcamento.codigo}: não foi possível remover os itens excluídos.`,
      };
    }
  }

  const gruposRemovidos = gruposAtuais
    .filter((g) => !gruposMantidos.has(g.id))
    .map((g) => g.id);

  if (gruposRemovidos.length > 0) {
    const { error } = await supabase
      .from("versoes_orcamento_grupos")
      .delete()
      .in("id", gruposRemovidos)
      .eq("tenant_id", tenantId);
    if (error) {
      console.error("[agregado.grupo.delete]", error.message);
      return {
        ok: false,
        message: `${orcamento.codigo}: não foi possível remover os grupos excluídos.`,
      };
    }
  }

  await logAuditEvent({
    acao: "versao_orcamento.editada",
    tenantId,
    entidadeTipo: "versao_orcamento",
    entidadeId: versao.id,
    metadata: {
      orcamento_id: orcamento.id,
      origem: "visao_agregada",
      grupos: alvo.grupos.length,
      itens: ordemItem,
      itens_removidos: itensRemovidos.length,
      grupos_removidos: gruposRemovidos.length,
    },
  });

  revalidatePath(
    `/orcamentos/${projetoId}/${orcamento.id}/versoes/${versao.id}`,
  );
  return { ok: true, editados: 1, criados: 0, ids };
}

/** Compara só os campos que a tela edita — evita UPDATE em linha intocada. */
function mudou(atual: ItemAtual, linha: Record<string, unknown>): boolean {
  if (atual.item !== linha.item) return true;
  if (atual.tipo_custo !== linha.tipo_custo) return true;
  if ((atual.categoria_id ?? null) !== (linha.categoria_id ?? null)) return true;
  if ((atual.planilha_origem ?? null) !== (linha.planilha_origem ?? null))
    return true;
  if (atual.grupo_id !== linha.grupo_id) return true;
  const numericos = [
    "valor_unitario_orcado",
    "quantidade_orcada",
    "dias_meses_orcado",
    "valor_unitario_planejado",
    "quantidade_planejada",
    "dias_meses_planejado",
  ] as const;
  for (const campo of numericos) {
    if (num(atual[campo]) !== num(linha[campo])) return true;
  }
  return false;
}
