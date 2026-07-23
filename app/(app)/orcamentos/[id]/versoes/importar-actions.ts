"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { parseOficial, type ParseResultado } from "@/lib/importacao/parser-oficial";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB — planilhas típicas <500 KB
const BUCKET = "orcamento-importacoes";

export type PreviewResult =
  | {
      ok: true;
      preview: {
        aba: string;
        grupos: {
          nome: string;
          ordem: number;
          itens_count: number;
          total_bruto: number;
        }[];
        warnings: ParseResultado["warnings"];
        percentual_honorarios: number | null;
        linhas_lidas: number;
        linhas_importadas: number;
        linhas_ignoradas: number;
        arquivo_nome: string;
        arquivo_tamanho: number;
      };
    }
  | { ok: false; message: string };

export type ConfirmResult =
  | { ok: true; versao_id: string; orcamento_id: string; importacao_id: string }
  | { ok: false; message: string };

async function extractArquivo(
  formData: FormData,
): Promise<
  | { ok: true; buffer: Buffer; nome: string; tamanho: number }
  | { ok: false; message: string }
> {
  const arquivo = formData.get("arquivo");
  if (!(arquivo instanceof File)) {
    return { ok: false, message: "Nenhum arquivo enviado." };
  }
  if (arquivo.size === 0) {
    return { ok: false, message: "Arquivo vazio." };
  }
  if (arquivo.size > MAX_BYTES) {
    return {
      ok: false,
      message: `Arquivo maior que ${MAX_BYTES / 1024 / 1024} MB. Reduza antes de enviar.`,
    };
  }
  const nome = arquivo.name.toLowerCase();
  if (!nome.endsWith(".xlsx") && !nome.endsWith(".xlsm")) {
    return {
      ok: false,
      message: "Apenas arquivos .xlsx são aceitos. Salve como Excel e reenvie.",
    };
  }
  const buffer = Buffer.from(await arquivo.arrayBuffer());
  return { ok: true, buffer, nome: arquivo.name, tamanho: arquivo.size };
}

async function verificarOrcamento(
  orcamentoId: string,
  tenantId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const supabase = createClient();
  const { data: orc, error } = await supabase
    .from("orcamentos")
    .select("id, status")
    .eq("id", orcamentoId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ id: string; status: string }>();

  if (error || !orc) {
    return { ok: false, message: "Orçamento não encontrado." };
  }
  if (orc.status === "job_criado" || orc.status === "cancelado") {
    return {
      ok: false,
      message: `Orçamento em estado ${orc.status} não aceita nova versão.`,
    };
  }
  return { ok: true };
}

/**
 * Faz o parse do arquivo enviado e retorna um resumo. Não persiste nada.
 * A tela usa isso para o admin revisar antes de confirmar.
 */
export async function previewImportacao(
  orcamentoId: string,
  formData: FormData,
): Promise<PreviewResult> {
  const session = await requireSession();

  const check = await verificarOrcamento(orcamentoId, session.activeTenant.id);
  if (!check.ok) return { ok: false, message: check.message };

  const arq = await extractArquivo(formData);
  if (!arq.ok) return { ok: false, message: arq.message };

  let parsed: ParseResultado;
  try {
    parsed = await parseOficial(arq.buffer);
  } catch (err) {
    console.error("[importacao.preview.parse]", err);
    return {
      ok: false,
      message:
        "Não conseguimos ler o arquivo. Verifique se é a planilha padrão salva como .xlsx.",
    };
  }

  if (parsed.grupos.length === 0) {
    return {
      ok: false,
      message:
        parsed.warnings[0]?.motivo ??
        "Nenhum item encontrado na planilha. Confira a aba 'Oficial'.",
    };
  }

  const preview = {
    aba: parsed.aba,
    grupos: parsed.grupos.map((g) => ({
      nome: g.nome,
      ordem: g.ordem,
      itens_count: g.itens.length,
      total_bruto: g.itens.reduce(
        (s, it) =>
          s + it.valor_unitario_orcado * it.quantidade_orcada * it.dias_meses_orcado,
        0,
      ),
    })),
    warnings: parsed.warnings,
    percentual_honorarios: parsed.percentual_honorarios,
    linhas_lidas: parsed.linhas_lidas,
    linhas_importadas: parsed.linhas_importadas,
    linhas_ignoradas: parsed.linhas_ignoradas,
    arquivo_nome: arq.nome,
    arquivo_tamanho: arq.tamanho,
  };

  return { ok: true, preview };
}

/**
 * Persiste a importação: cria versão em rascunho, grupos, itens e a linha
 * em orcamento_importacoes, com o XLSX original salvo no bucket.
 * Reparseia o arquivo (não confiamos no que veio do client entre requests).
 */
export async function confirmarImportacao(
  orcamentoId: string,
  formData: FormData,
): Promise<ConfirmResult> {
  const session = await requireSession();

  const check = await verificarOrcamento(orcamentoId, session.activeTenant.id);
  if (!check.ok) return { ok: false, message: check.message };

  const arq = await extractArquivo(formData);
  if (!arq.ok) return { ok: false, message: arq.message };

  let parsed: ParseResultado;
  try {
    parsed = await parseOficial(arq.buffer);
  } catch (err) {
    console.error("[importacao.confirmar.parse]", err);
    return {
      ok: false,
      message: "Falha ao processar o arquivo.",
    };
  }

  if (parsed.grupos.length === 0) {
    return {
      ok: false,
      message:
        "Nenhum item encontrado na planilha. Cancele e revise antes de reenviar.",
    };
  }

  const tenantId = session.activeTenant.id;
  const service = createServiceClient();

  // 1) Descobrir próximo número de versão dentro do orçamento.
  const { data: ultimaVersao } = await service
    .from("versoes_orcamento")
    .select("numero_versao")
    .eq("orcamento_id", orcamentoId)
    .eq("tenant_id", tenantId)
    .order("numero_versao", { ascending: false })
    .limit(1)
    .maybeSingle<{ numero_versao: number }>();

  const numero = (ultimaVersao?.numero_versao ?? 0) + 1;

  // 2) Criar a versão em rascunho. Usa o % de honorários detectado, se houver.
  const { data: novaVersao, error: versaoErr } = await service
    .from("versoes_orcamento")
    .insert({
      tenant_id: tenantId,
      orcamento_id: orcamentoId,
      numero_versao: numero,
      nome: `Importada de ${arq.nome}`,
      status: "rascunho",
      moeda: "BRL",
      taxa_cambio: 1,
      percentual_honorarios: parsed.percentual_honorarios ?? 0,
      percentual_imposto: 0,
      created_by: session.profile.id,
    })
    .select("id")
    .single();

  if (versaoErr || !novaVersao) {
    console.error("[importacao.confirmar.versao]", versaoErr?.message);
    return {
      ok: false,
      message: "Não foi possível criar a versão. Tente novamente.",
    };
  }

  const versaoId = novaVersao.id as string;

  // 3) Criar grupos.
  const gruposParaInserir = parsed.grupos.map((g) => ({
    tenant_id: tenantId,
    versao_orcamento_id: versaoId,
    nome: g.nome,
    ordem: g.ordem,
  }));

  const { data: gruposCriados, error: gruposErr } = await service
    .from("versoes_orcamento_grupos")
    .insert(gruposParaInserir)
    .select("id, nome, ordem");

  if (gruposErr || !gruposCriados) {
    console.error("[importacao.confirmar.grupos]", gruposErr?.message);
    // Rollback manual da versão criada.
    await service.from("versoes_orcamento").delete().eq("id", versaoId);
    return {
      ok: false,
      message: "Não foi possível criar os grupos.",
    };
  }

  // 4) Mapear grupo importado → grupo criado (por nome + ordem, únicos aqui).
  const grupoIdPorNome = new Map<string, string>();
  for (const g of gruposCriados as { id: string; nome: string; ordem: number }[]) {
    grupoIdPorNome.set(`${g.nome}#${g.ordem}`, g.id);
  }

  // 4b) Criar categorias únicas (case-insensitive) a partir dos itens do parse.
  const categoriaNomes = new Set<string>();
  for (const grupo of parsed.grupos) {
    for (const it of grupo.itens) {
      if (it.categoria && it.categoria.trim().length > 0) {
        categoriaNomes.add(it.categoria.trim());
      }
    }
  }

  const categoriaIdPorNomeLower = new Map<string, string>();

  if (categoriaNomes.size > 0) {
    const categoriasParaInserir = Array.from(categoriaNomes).map((nome) => ({
      tenant_id: tenantId,
      versao_orcamento_id: versaoId,
      nome,
    }));

    const { data: categoriasCriadas, error: catErr } = await service
      .from("versoes_orcamento_categorias")
      .insert(categoriasParaInserir)
      .select("id, nome");

    if (catErr || !categoriasCriadas) {
      console.error(
        "[importacao.confirmar.categorias]",
        catErr?.message ?? "sem retorno",
      );
      // Não faz rollback — categorias faltando são recuperáveis; itens
      // simplesmente ficarão sem categoria vinculada.
    } else {
      for (const c of categoriasCriadas as { id: string; nome: string }[]) {
        categoriaIdPorNomeLower.set(c.nome.toLowerCase(), c.id);
      }
    }
  }

  // 5) Criar itens em bulk.
  const itensParaInserir: any[] = [];
  let ordemGlobal = 0;
  for (const grupo of parsed.grupos) {
    const grupoId = grupoIdPorNome.get(`${grupo.nome}#${grupo.ordem}`);
    if (!grupoId) continue;
    for (const it of grupo.itens) {
      ordemGlobal++;

      const categoriaId = it.categoria
        ? categoriaIdPorNomeLower.get(it.categoria.trim().toLowerCase()) ?? null
        : null;

      itensParaInserir.push({
        tenant_id: tenantId,
        versao_orcamento_id: versaoId,
        grupo_id: grupoId,
        categoria_id: categoriaId,
        ordem: ordemGlobal,
        planilha_origem: `linha ${it.linha_xlsx}`,
        item: it.item,
        tipo_custo: it.tipo_custo,
        valor_unitario_orcado: it.valor_unitario_orcado,
        quantidade_orcada: it.quantidade_orcada,
        dias_meses_orcado: it.dias_meses_orcado,
        valor_unitario_planejado: it.valor_unitario_planejado,
        quantidade_planejada: it.quantidade_planejada,
        dias_meses_planejado: it.dias_meses_planejado,
      });
    }
  }

  const { error: itensErr } = await service
    .from("versoes_orcamento_itens")
    .insert(itensParaInserir);

  if (itensErr) {
    console.error("[importacao.confirmar.itens]", itensErr.message);
    // Rollback manual: apaga versão em cascata leva grupos+itens+importacoes.
    await service.from("versoes_orcamento").delete().eq("id", versaoId);
    return {
      ok: false,
      message: "Não foi possível gravar os itens.",
    };
  }

  // 6) Upload do arquivo original no bucket.
  const importacaoId = crypto.randomUUID();
  const arquivoNomeSlug = arq.nome.replace(/[^\w.\-]/g, "_");
  const arquivoPath = `${tenantId}/${orcamentoId}/${importacaoId}-${arquivoNomeSlug}`;

  const { error: uploadErr } = await service.storage
    .from(BUCKET)
    .upload(arquivoPath, arq.buffer, {
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      upsert: false,
    });

  if (uploadErr) {
    console.error("[importacao.confirmar.upload]", uploadErr.message);
    // Não bloqueia — a versão já está criada. Loga mas segue.
  }

  // 7) Registrar em orcamento_importacoes.
  const { error: impErr } = await service.from("orcamento_importacoes").insert({
    id: importacaoId,
    tenant_id: tenantId,
    orcamento_id: orcamentoId,
    versao_orcamento_id: versaoId,
    arquivo_path: uploadErr ? "" : arquivoPath,
    arquivo_nome_original: arq.nome,
    arquivo_tamanho_bytes: arq.tamanho,
    aba_origem: parsed.aba,
    linhas_lidas: parsed.linhas_lidas,
    linhas_importadas: parsed.linhas_importadas,
    linhas_ignoradas: parsed.linhas_ignoradas,
    warnings: parsed.warnings as any,
    created_by: session.profile.id,
  });

  if (impErr) {
    console.error("[importacao.confirmar.registro]", impErr.message);
    // Só o registro de auditoria falhou; a versão já existe. Segue.
  }

  await logAuditEvent({
    acao: "versao_orcamento.importada",
    tenantId,
    entidadeTipo: "versao_orcamento",
    entidadeId: versaoId,
    metadata: {
      orcamento_id: orcamentoId,
      importacao_id: importacaoId,
      arquivo_nome: arq.nome,
      linhas_importadas: parsed.linhas_importadas,
      warnings_count: parsed.warnings.length,
    },
  });

  revalidatePath(`/orcamentos/${orcamentoId}`);
  return {
    ok: true,
    versao_id: versaoId,
    orcamento_id: orcamentoId,
    importacao_id: importacaoId,
  };
}
