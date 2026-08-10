"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { extrairArquivoXlsx } from "@/lib/importacao/arquivo";
import {
  parseOficial,
  type ParseResultado,
} from "@/lib/importacao/parser-oficial";
import { orcamentoSchema } from "@/lib/validations/orcamentos";
import { grupoSchema } from "@/lib/validations/grupos";
import { itemSchema } from "@/lib/validations/itens";
import { bvSchema } from "@/lib/validations/bv";
import type { GrupoPayload, OrcamentoProjetoPayload } from "../../_rascunho/tipos";

const BUCKET = "orcamento-importacoes";
/** Tipos em que o cliente paga o fornecedor direto — os únicos com BV. */
const TIPOS_COM_BV = ["A", "D"];

// ============================================================
// Salvamento em lote
// ============================================================

export type SalvarResult =
  | { ok: true; criados: number }
  | { ok: false; message: string };

interface Criado {
  orcamentoId: string;
  /** `null` quando o orçamento entrou mas a versão v1 não chegou a nascer. */
  versaoId: string | null;
  codigo: string;
  nome: string;
}

/** Desfaz o que já entrou quando um job do meio da lista falha. Sem isso
 *  o projeto ficaria com metade dos orçamentos gravados e o usuário sem
 *  saber quais. Apaga na ordem inversa das dependências — os itens antes
 *  dos grupos, por causa do `on delete restrict` entre os dois. */
async function desfazer(criados: Criado[]): Promise<void> {
  if (criados.length === 0) return;
  const service = createServiceClient();
  const versaoIds = criados
    .map((c) => c.versaoId)
    .filter((id): id is string => id !== null);
  const orcamentoIds = criados.map((c) => c.orcamentoId);

  if (versaoIds.length > 0) {
    await service
      .from("versoes_orcamento_itens")
      .delete()
      .in("versao_orcamento_id", versaoIds);
    await service
      .from("versoes_orcamento_grupos")
      .delete()
      .in("versao_orcamento_id", versaoIds);
    await service.from("versoes_orcamento").delete().in("id", versaoIds);
  }
  await service.from("orcamentos").delete().in("id", orcamentoIds);
}

function mapDbError(msg: string): string {
  if (msg.includes("uniq_orcamentos_codigo_por_tenant")) {
    return "Outro orçamento com o mesmo código foi criado enquanto você montava este. Tente salvar de novo.";
  }
  if (msg.includes("orcamentos_datas_ordem")) {
    return "Data fim precisa ser igual ou posterior à data início.";
  }
  if (msg.includes("uniq_grupo_nome_por_versao")) {
    return "Há dois grupos com o mesmo nome dentro de um mesmo orçamento.";
  }
  return "Não foi possível salvar. Tente novamente.";
}

export async function salvarOrcamentosDoProjeto(
  projetoId: string,
  formData: FormData,
): Promise<SalvarResult> {
  const session = await requireSession();
  const tenantId = session.activeTenant.id;

  const bruto = formData.get("payload")?.toString();
  if (!bruto) return { ok: false, message: "Nada para salvar." };

  let payload: OrcamentoProjetoPayload;
  try {
    payload = JSON.parse(bruto) as OrcamentoProjetoPayload;
  } catch {
    return { ok: false, message: "Rascunho inválido. Recarregue a tela." };
  }

  if (!Array.isArray(payload.jobs) || payload.jobs.length === 0) {
    return { ok: false, message: "Crie ao menos um orçamento de job." };
  }

  const supabase = createClient();

  // Projeto do tenant + vínculos que restringem regional e GP. Uma
  // consulta de cada, não uma por job: a lista é a mesma para todos.
  const [projRes, regRes, respRes, orcCountRes] = await Promise.all([
    supabase
      .from("projetos")
      .select("id, codigo")
      .eq("id", projetoId)
      .eq("tenant_id", tenantId)
      .maybeSingle<{ id: string; codigo: string }>(),
    supabase
      .from("projeto_regionais")
      .select("regional_id")
      .eq("projeto_id", projetoId)
      .eq("tenant_id", tenantId),
    supabase
      .from("projeto_responsaveis")
      .select("profile_id")
      .eq("projeto_id", projetoId)
      .eq("tenant_id", tenantId),
    supabase
      .from("orcamentos")
      .select("id", { count: "exact", head: true })
      .eq("projeto_id", projetoId)
      .eq("tenant_id", tenantId),
  ]);

  if (!projRes.data) return { ok: false, message: "Projeto não encontrado." };

  const regionaisDoProjeto = new Set(
    ((regRes.data ?? []) as { regional_id: string }[]).map((r) => r.regional_id),
  );
  const responsaveisDoProjeto = new Set(
    ((respRes.data ?? []) as { profile_id: string }[]).map((r) => r.profile_id),
  );

  // ---------- Validação de tudo ANTES de gravar qualquer coisa ----------
  // Um job inválido no fim da lista não pode deixar os anteriores no banco.
  const validados: {
    orcamento: Record<string, unknown>;
    grupos: GrupoPayload[];
    arquivoCampo: string | null;
    nome: string;
  }[] = [];

  for (const [i, job] of payload.jobs.entries()) {
    const rotulo = job.nome?.trim() || `Orçamento ${i + 1}`;

    const parsed = orcamentoSchema.safeParse({
      codigo: "",
      nome: job.nome ?? "",
      status: "rascunho",
      categoria_id: job.categoria_id ?? "",
      regional_id: job.regional_id ?? "",
      cidade_id: job.cidade_id ?? "",
      gp_responsavel_id: job.gp_responsavel_id ?? "",
      produtor_id: job.produtor_id ?? "",
      data_inicio_prevista: job.data_inicio_prevista ?? "",
      data_fim_prevista: job.data_fim_prevista ?? "",
    });
    if (!parsed.success) {
      const primeiro =
        parsed.error.errors[0]?.message ?? "Campos obrigatórios em falta.";
      return { ok: false, message: `${rotulo}: ${primeiro}` };
    }
    if (!regionaisDoProjeto.has(parsed.data.regional_id)) {
      return {
        ok: false,
        message: `${rotulo}: escolha uma das regionais do projeto.`,
      };
    }
    if (!responsaveisDoProjeto.has(parsed.data.gp_responsavel_id)) {
      return {
        ok: false,
        message: `${rotulo}: escolha um dos responsáveis do projeto.`,
      };
    }

    const grupos = Array.isArray(job.grupos) ? job.grupos : [];
    if (grupos.length === 0) {
      return {
        ok: false,
        message: `${rotulo}: importe uma planilha ou crie ao menos um grupo.`,
      };
    }

    for (const grupo of grupos) {
      const nomeOk = grupoSchema.safeParse({ nome: grupo.nome ?? "" });
      if (!nomeOk.success) {
        return {
          ok: false,
          message: `${rotulo}: ${nomeOk.error.errors[0]?.message ?? "grupo sem nome."}`,
        };
      }
      for (const item of grupo.itens ?? []) {
        const itemOk = itemSchema.safeParse(item);
        if (!itemOk.success) {
          return {
            ok: false,
            message: `${rotulo} · ${grupo.nome}: ${
              itemOk.error.errors[0]?.message ?? "item inválido."
            }`,
          };
        }
        if (item.bv) {
          if (!TIPOS_COM_BV.includes(itemOk.data.tipo_custo)) {
            return {
              ok: false,
              message: `${rotulo} · ${item.item}: BV só existe em item de custo tipo A ou D.`,
            };
          }
          const bvOk = bvSchema.safeParse(item.bv);
          if (!bvOk.success) {
            return {
              ok: false,
              message: `${rotulo} · ${item.item}: ${
                bvOk.error.errors[0]?.message ?? "BV inválido."
              }`,
            };
          }
        }
      }
    }

    const { codigo: _semCodigo, ...dados } = parsed.data;
    validados.push({
      orcamento: dados,
      grupos,
      arquivoCampo: job.arquivoCampo ?? null,
      nome: parsed.data.nome,
    });
  }

  // ---------- Gravação ----------
  const moeda = (payload.moeda || "BRL").toUpperCase().slice(0, 3);
  const taxaCambio =
    Number.isFinite(payload.taxa_cambio) && payload.taxa_cambio > 0
      ? payload.taxa_cambio
      : 1;
  const honorariosPadrao = faixaPercentual(payload.percentual_honorarios);
  const imposto = faixaPercentual(payload.percentual_imposto);

  let sequencial = orcCountRes.count ?? 0;
  const criados: Criado[] = [];

  for (const [i, alvo] of validados.entries()) {
    // O arquivo é reparseado no servidor: as contagens e os avisos que vão
    // para `orcamento_importacoes` não podem vir do cliente. Os itens, ao
    // contrário, vêm do rascunho — o usuário pode tê-los editado depois
    // de importar, e é o que está na tela que ele mandou salvar.
    let importacao: {
      buffer: Buffer;
      nome: string;
      tamanho: number;
      parsed: ParseResultado;
    } | null = null;

    if (alvo.arquivoCampo) {
      const arq = await extrairArquivoXlsx(formData, alvo.arquivoCampo);
      if (arq.ok) {
        try {
          importacao = {
            buffer: arq.buffer,
            nome: arq.nome,
            tamanho: arq.tamanho,
            parsed: await parseOficial(arq.buffer),
          };
        } catch (err) {
          // Arquivo ilegível agora não invalida o orçamento: os itens já
          // estão no payload. Perde-se só o arquivamento do original.
          console.error("[multi.salvar.reparse]", err);
        }
      }
    }

    sequencial += 1;
    const codigo = `${projRes.data.codigo}-${String(sequencial).padStart(2, "0")}`;

    const { data: orcamento, error: orcErr } = await supabase
      .from("orcamentos")
      .insert({
        ...alvo.orcamento,
        codigo,
        projeto_id: projetoId,
        tenant_id: tenantId,
        created_by: session.profile.id,
      })
      .select("id")
      .single();

    if (orcErr || !orcamento) {
      console.error("[multi.salvar.orcamento]", orcErr?.message);
      await desfazer(criados);
      return { ok: false, message: mapDbError(orcErr?.message ?? "") };
    }

    const { data: versao, error: versaoErr } = await supabase
      .from("versoes_orcamento")
      .insert({
        tenant_id: tenantId,
        orcamento_id: orcamento.id,
        numero_versao: 1,
        nome: importacao ? `Importada de ${importacao.nome}` : null,
        status: "rascunho",
        moeda,
        taxa_cambio: taxaCambio,
        // Planilha importada traz o % negociado nela; ele vale mais que o
        // padrão do cabeçalho, que é só o ponto de partida do editor.
        percentual_honorarios:
          importacao?.parsed.percentual_honorarios ?? honorariosPadrao,
        percentual_imposto: imposto,
        created_by: session.profile.id,
      })
      .select("id")
      .single();

    if (versaoErr || !versao) {
      console.error("[multi.salvar.versao]", versaoErr?.message);
      await desfazer([
        ...criados,
        { orcamentoId: orcamento.id, versaoId: null, codigo, nome: alvo.nome },
      ]);
      return { ok: false, message: "Não foi possível criar a versão v1." };
    }

    const parcial: Criado = {
      orcamentoId: orcamento.id,
      versaoId: versao.id,
      codigo,
      nome: alvo.nome,
    };

    const { data: gruposCriados, error: gruposErr } = await supabase
      .from("versoes_orcamento_grupos")
      .insert(
        alvo.grupos.map((g, ordem) => ({
          tenant_id: tenantId,
          versao_orcamento_id: versao.id,
          nome: g.nome.trim(),
          ordem: ordem + 1,
        })),
      )
      .select("id, ordem");

    if (gruposErr || !gruposCriados) {
      console.error("[multi.salvar.grupos]", gruposErr?.message);
      await desfazer([...criados, parcial]);
      return { ok: false, message: mapDbError(gruposErr?.message ?? "") };
    }

    const grupoPorOrdem = new Map<number, string>(
      (gruposCriados as { id: string; ordem: number }[]).map((g) => [
        g.ordem,
        g.id,
      ]),
    );

    const linhas: Record<string, unknown>[] = [];
    // Guarda de onde sai o BV de cada linha, para casar item ↔ BV depois
    // do insert (a ordem é única dentro da versão).
    const bvsPorOrdem = new Map<number, GrupoPayload["itens"][number]["bv"]>();
    let ordemItem = 0;

    for (const [ordemGrupo, grupo] of alvo.grupos.entries()) {
      const grupoId = grupoPorOrdem.get(ordemGrupo + 1);
      if (!grupoId) continue;
      for (const item of grupo.itens ?? []) {
        ordemItem += 1;
        const dados = itemSchema.parse(item);
        linhas.push({
          tenant_id: tenantId,
          versao_orcamento_id: versao.id,
          grupo_id: grupoId,
          ordem: ordemItem,
          planilha_origem: item.planilha_origem ?? null,
          ...dados,
        });
        if (item.bv) bvsPorOrdem.set(ordemItem, item.bv);
      }
    }

    if (linhas.length > 0) {
      const { data: itensCriados, error: itensErr } = await supabase
        .from("versoes_orcamento_itens")
        .insert(linhas)
        .select("id, ordem");

      if (itensErr || !itensCriados) {
        console.error("[multi.salvar.itens]", itensErr?.message);
        await desfazer([...criados, parcial]);
        return { ok: false, message: "Não foi possível gravar os itens." };
      }

      if (bvsPorOrdem.size > 0) {
        const bvs = (itensCriados as { id: string; ordem: number }[])
          .filter((it) => bvsPorOrdem.has(it.ordem))
          .map((it) => {
            const bv = bvsPorOrdem.get(it.ordem)!;
            return {
              tenant_id: tenantId,
              item_versao_id: it.id,
              fornecedor_id: bv.fornecedor_id,
              valor: bv.valor,
              prazo_repasse: bv.prazo_repasse,
              // Todo BV nasce a negociar: confirmar é ato do financeiro,
              // na tela da versão, depois que o orçamento existe.
              situacao: "a_negociar" as const,
              created_by: session.profile.id,
            };
          });

        const { error: bvErr } = await supabase.from("itens_bv").insert(bvs);
        if (bvErr) {
          console.error("[multi.salvar.bv]", bvErr.message);
          await desfazer([...criados, parcial]);
          return {
            ok: false,
            message: "Não foi possível gravar os BVs lançados.",
          };
        }
      }
    }

    criados.push(parcial);

    // Arquivamento do XLSX original. Falha aqui não desfaz o orçamento —
    // ele já está completo; o que se perde é a cópia do arquivo.
    if (importacao) {
      await arquivarImportacao({
        tenantId,
        orcamentoId: orcamento.id,
        versaoId: versao.id,
        arquivo: importacao,
        createdBy: session.profile.id,
      });
    }

    await logAuditEvent({
      acao: "orcamento.criado",
      tenantId,
      entidadeTipo: "orcamento",
      entidadeId: orcamento.id,
      metadata: {
        codigo,
        nome: alvo.nome,
        projeto_id: projetoId,
        origem: "orcamento_do_projeto",
        posicao: i + 1,
        total_no_lote: validados.length,
      },
    });
    await logAuditEvent({
      acao: importacao
        ? "versao_orcamento.importada"
        : "versao_orcamento.criada",
      tenantId,
      entidadeTipo: "versao_orcamento",
      entidadeId: versao.id,
      metadata: {
        orcamento_id: orcamento.id,
        numero_versao: 1,
        origem: "orcamento_do_projeto",
        ...(importacao ? { arquivo_nome: importacao.nome } : {}),
      },
    });
  }

  revalidatePath(`/orcamentos/${projetoId}`);
  return { ok: true, criados: criados.length };
}

function faixaPercentual(valor: unknown): number {
  const n = Number(valor);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

async function arquivarImportacao({
  tenantId,
  orcamentoId,
  versaoId,
  arquivo,
  createdBy,
}: {
  tenantId: string;
  orcamentoId: string;
  versaoId: string;
  arquivo: { buffer: Buffer; nome: string; tamanho: number; parsed: ParseResultado };
  createdBy: string;
}): Promise<void> {
  const service = createServiceClient();
  const importacaoId = crypto.randomUUID();
  const slug = arquivo.nome.replace(/[^\w.\-]/g, "_");
  const caminho = `${tenantId}/${orcamentoId}/${importacaoId}-${slug}`;

  const { error: uploadErr } = await service.storage
    .from(BUCKET)
    .upload(caminho, arquivo.buffer, {
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      upsert: false,
    });

  if (uploadErr) console.error("[multi.salvar.upload]", uploadErr.message);

  const { error: registroErr } = await service
    .from("orcamento_importacoes")
    .insert({
      id: importacaoId,
      tenant_id: tenantId,
      orcamento_id: orcamentoId,
      versao_orcamento_id: versaoId,
      arquivo_path: uploadErr ? "" : caminho,
      arquivo_nome_original: arquivo.nome,
      arquivo_tamanho_bytes: arquivo.tamanho,
      aba_origem: arquivo.parsed.aba,
      linhas_lidas: arquivo.parsed.linhas_lidas,
      linhas_importadas: arquivo.parsed.linhas_importadas,
      linhas_ignoradas: arquivo.parsed.linhas_ignoradas,
      warnings: arquivo.parsed.warnings as any,
      created_by: createdBy,
    });

  if (registroErr) console.error("[multi.salvar.registro]", registroErr.message);
}
