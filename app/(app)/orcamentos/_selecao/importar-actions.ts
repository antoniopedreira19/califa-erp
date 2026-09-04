"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { extrairArquivoXlsx } from "@/lib/importacao/arquivo";
import {
  parsePlanilhaProjeto,
  type LeituraProjeto,
  type SecaoLida,
} from "@/lib/importacao/parser-projeto";
import {
  planejarSecao,
  type GrupoAtual,
  type ItemAtual,
  type PlanoDaSecao,
  type ResumoDoPlano,
} from "@/lib/importacao/diff-projeto";
import { escolherJobDoFunil, estagioFunil } from "@/lib/calculos/funil";
import { escolherVersaoVigente } from "@/lib/calculos/versao-vigente";
import type { ImportacaoWarning, JobStatus, OrcamentoStatus, TipoCusto } from "@/lib/types";
import { cancelarAprovacaoVersao } from "../[projetoId]/[orcId]/versoes/actions";

const BUCKET = "orcamento-importacoes";

/**
 * Importação da planilha do PROJETO — a que a exportação de vários
 * orçamentos gerou, de volta depois de editada (pelo cliente inclusive).
 *
 * Decisão 041, regras do Tiago em 03/09/2026:
 * - **só os orçamentos alterados** ganham versão nova (v+1, em rascunho);
 * - a linha casada pelo id mantém o **planejado**; linha nova nasce com
 *   planejado zerado; linha apagada leva o planejado junto;
 * - **job aberto** (e qualquer orçamento que já virou job) não recebe
 *   versão pela importação;
 * - **orçamento aprovado** com alteração tem a **aprovação desfeita** —
 *   pelo mesmo caminho do "Cancelar aprovação" da tela — e a versão nova
 *   passa a ser a vigente.
 *
 * Duas portas, como a importação da versão: `previewImportacaoProjeto`
 * lê e compara sem gravar; `confirmarImportacaoProjeto` refaz a leitura
 * (não confia no que veio do cliente entre as duas chamadas) e grava.
 */

export type AcaoDoOrcamento = "nova_versao" | "sem_alteracao" | "recusado";

export interface ResumoOrcamentoImportado {
  orcamentoId: string | null;
  codigo: string | null;
  nome: string;
  /** Título da seção na planilha — o que o usuário reconhece. */
  titulo: string;
  acao: AcaoDoOrcamento;
  /** Por que não entra, em `recusado`. */
  motivo: string | null;
  /** Orçamento aprovado com alteração: a aprovação será desfeita. */
  desfazAprovacao: boolean;
  versaoAtual: number | null;
  proximaVersao: number | null;
  /** A planilha foi exportada de uma versão que já não é a vigente. */
  versaoDesatualizada: boolean;
  resumo: ResumoDoPlano | null;
}

export type PreviewProjetoResult =
  | {
      ok: true;
      preview: {
        arquivo_nome: string;
        aba: string;
        orcamentos: ResumoOrcamentoImportado[];
        warnings: ImportacaoWarning[];
        linhas_lidas: number;
        linhas_importadas: number;
        linhas_ignoradas: number;
        novasVersoes: number;
      };
    }
  | { ok: false; message: string };

export type ConfirmProjetoResult =
  | {
      ok: true;
      versoes: {
        orcamentoId: string;
        codigo: string;
        nome: string;
        versaoId: string;
        numeroVersao: number;
        aprovacaoDesfeita: boolean;
      }[];
    }
  | { ok: false; message: string };

interface OrcamentoRow {
  id: string;
  codigo: string;
  nome: string;
  status: OrcamentoStatus;
  versao_aprovada_id: string | null;
}

interface VersaoRow {
  id: string;
  orcamento_id: string;
  numero_versao: number;
  status: string;
  moeda: string;
  taxa_cambio: number | string;
  percentual_honorarios: number | string;
  percentual_imposto: number | string;
  save_por_padrao: boolean;
  created_at: string;
}

interface Analise {
  secao: SecaoLida;
  orcamento: OrcamentoRow | null;
  vigente: VersaoRow | null;
  /** Maior número de versão do orçamento, cancelada inclusive. */
  ultimoNumero: number;
  plano: PlanoDaSecao | null;
  resumo: ResumoOrcamentoImportado;
}

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Lê o arquivo, carrega o estado atual de cada orçamento citado e monta o
 * plano de cada um. Não escreve nada — é o coração das duas portas.
 */
async function analisar(
  projetoId: string,
  formData: FormData,
): Promise<
  | {
      ok: true;
      arquivo: { buffer: Buffer; nome: string; tamanho: number };
      leitura: LeituraProjeto;
      analises: Analise[];
    }
  | { ok: false; message: string }
> {
  const session = await requireSession();
  const tenantId = session.activeTenant.id;
  const supabase = createClient();

  const { data: projeto } = await supabase
    .from("projetos")
    .select("id")
    .eq("id", projetoId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ id: string }>();
  if (!projeto) return { ok: false, message: "Projeto não encontrado." };

  const arq = await extrairArquivoXlsx(formData);
  if (!arq.ok) return { ok: false, message: arq.message };

  let leitura: LeituraProjeto;
  try {
    leitura = await parsePlanilhaProjeto(arq.buffer);
  } catch (err) {
    console.error("[importacao.projeto.parse]", err);
    return {
      ok: false,
      message:
        "Não conseguimos ler o arquivo. Confira se é a planilha exportada do projeto, salva como .xlsx.",
    };
  }

  if (leitura.secoes.length === 0) {
    return {
      ok: false,
      message:
        leitura.warnings[0]?.motivo ??
        "Nenhum orçamento encontrado na planilha. Confira se é a planilha exportada do projeto.",
    };
  }

  const ids = Array.from(
    new Set(
      leitura.secoes
        .map((s) => s.orcamentoId)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  const [orcsRes, jobsRes, versoesRes] = await Promise.all([
    ids.length > 0
      ? supabase
          .from("orcamentos")
          .select("id, codigo, nome, status, versao_aprovada_id")
          .eq("projeto_id", projetoId)
          .eq("tenant_id", tenantId)
          .in("id", ids)
      : Promise.resolve({ data: [] as any[] }),
    ids.length > 0
      ? supabase
          .from("jobs")
          .select("orcamento_id, status, created_at")
          .eq("tenant_id", tenantId)
          .in("orcamento_id", ids)
      : Promise.resolve({ data: [] as any[] }),
    ids.length > 0
      ? supabase
          .from("versoes_orcamento")
          .select(
            "id, orcamento_id, numero_versao, status, moeda, taxa_cambio, " +
              "percentual_honorarios, percentual_imposto, save_por_padrao, created_at",
          )
          .eq("tenant_id", tenantId)
          .in("orcamento_id", ids)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const orcamentos = new Map(
    ((orcsRes.data ?? []) as OrcamentoRow[]).map((o) => [o.id, o]),
  );
  const jobsPorOrcamento = new Map<string, { status: JobStatus; created_at: string }[]>();
  for (const j of ((jobsRes.data ?? []) as any[])) {
    const atuais = jobsPorOrcamento.get(j.orcamento_id) ?? [];
    atuais.push({ status: j.status as JobStatus, created_at: j.created_at });
    jobsPorOrcamento.set(j.orcamento_id, atuais);
  }
  const versoesPorOrcamento = new Map<string, VersaoRow[]>();
  for (const v of ((versoesRes.data ?? []) as VersaoRow[])) {
    const atuais = versoesPorOrcamento.get(v.orcamento_id) ?? [];
    atuais.push(v);
    versoesPorOrcamento.set(v.orcamento_id, atuais);
  }

  // Versão vigente de cada orçamento citado — a mesma regra da exportação.
  const vigentes = new Map<string, VersaoRow>();
  for (const [id, orc] of orcamentos) {
    const vivas = (versoesPorOrcamento.get(id) ?? []).filter(
      (v) => v.status !== "cancelada",
    );
    const vigente = escolherVersaoVigente(vivas, orc.versao_aprovada_id);
    if (vigente) vigentes.set(id, vigente);
  }

  const versaoIds = [...vigentes.values()].map((v) => v.id);
  const [gruposRes, itensRes] = await Promise.all([
    versaoIds.length > 0
      ? supabase
          .from("versoes_orcamento_grupos")
          .select("id, versao_orcamento_id, nome, ordem")
          .eq("tenant_id", tenantId)
          .in("versao_orcamento_id", versaoIds)
          .order("ordem", { ascending: true })
      : Promise.resolve({ data: [] as any[] }),
    versaoIds.length > 0
      ? supabase
          .from("versoes_orcamento_itens")
          .select(
            "id, versao_orcamento_id, grupo_id, ordem, item, tipo_custo, categoria_id, planilha_origem, " +
              "valor_unitario_orcado, quantidade_orcada, dias_meses_orcado, " +
              "valor_unitario_planejado, quantidade_planejada, dias_meses_planejado, em_save",
          )
          .eq("tenant_id", tenantId)
          .in("versao_orcamento_id", versaoIds)
          .order("ordem", { ascending: true })
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const gruposPorVersao = new Map<string, GrupoAtual[]>();
  for (const g of ((gruposRes.data ?? []) as any[])) {
    const atuais = gruposPorVersao.get(g.versao_orcamento_id) ?? [];
    atuais.push({ id: g.id, nome: g.nome, ordem: num(g.ordem) });
    gruposPorVersao.set(g.versao_orcamento_id, atuais);
  }
  const itensPorVersao = new Map<string, ItemAtual[]>();
  for (const it of ((itensRes.data ?? []) as any[])) {
    const atuais = itensPorVersao.get(it.versao_orcamento_id) ?? [];
    atuais.push({
      id: it.id,
      grupo_id: it.grupo_id,
      ordem: num(it.ordem),
      item: it.item,
      tipo_custo: it.tipo_custo as TipoCusto,
      valor_unitario_orcado: num(it.valor_unitario_orcado),
      quantidade_orcada: num(it.quantidade_orcada),
      dias_meses_orcado: num(it.dias_meses_orcado),
      valor_unitario_planejado: num(it.valor_unitario_planejado),
      quantidade_planejada: num(it.quantidade_planejada),
      dias_meses_planejado: num(it.dias_meses_planejado),
      categoria_id: it.categoria_id ?? null,
      planilha_origem: it.planilha_origem ?? null,
      em_save: it.em_save === true,
    });
    itensPorVersao.set(it.versao_orcamento_id, atuais);
  }

  // Um orçamento citado duas vezes no arquivo é erro de arquivo, não de
  // dado: a segunda seção é recusada.
  const jaVistos = new Set<string>();

  const analises: Analise[] = leitura.secoes.map((secao) => {
    const base: ResumoOrcamentoImportado = {
      orcamentoId: secao.orcamentoId,
      codigo: null,
      nome: secao.titulo || "Orçamento sem título",
      titulo: secao.titulo || "Orçamento sem título",
      acao: "recusado",
      motivo: null,
      desfazAprovacao: false,
      versaoAtual: null,
      proximaVersao: null,
      versaoDesatualizada: false,
      resumo: null,
    };
    const recusar = (motivo: string): Analise => ({
      secao,
      orcamento: null,
      vigente: null,
      ultimoNumero: 0,
      plano: null,
      resumo: { ...base, motivo },
    });

    if (!secao.orcamentoId) {
      return recusar(
        "Sem identificação de orçamento — a planilha não é a exportação deste projeto, ou a coluna oculta foi apagada.",
      );
    }
    const orcamento = orcamentos.get(secao.orcamentoId);
    if (!orcamento) {
      return recusar("Este orçamento não pertence ao projeto.");
    }
    base.codigo = orcamento.codigo;
    base.nome = orcamento.nome;

    if (jaVistos.has(orcamento.id)) {
      return recusar("Orçamento repetido na planilha — só a primeira seção conta.");
    }
    jaVistos.add(orcamento.id);

    const estagio = estagioFunil(
      orcamento.status,
      escolherJobDoFunil(jobsPorOrcamento.get(orcamento.id) ?? []),
    );
    if (orcamento.status === "cancelado") {
      return recusar("Orçamento cancelado não recebe versão nova.");
    }
    if (orcamento.status === "job_criado") {
      return recusar(
        estagio === "aberto"
          ? "Já é um job aberto e não recebe versão nova."
          : "Já virou job e foi enviado ao financeiro — não recebe versão nova.",
      );
    }

    const vigente = vigentes.get(orcamento.id) ?? null;
    if (!vigente) {
      return recusar("Sem versão para comparar. Crie a primeira na tela do orçamento.");
    }
    const ultimoNumero = (versoesPorOrcamento.get(orcamento.id) ?? []).reduce(
      (m, v) => Math.max(m, num(v.numero_versao)),
      0,
    );

    const plano = planejarSecao(
      secao,
      gruposPorVersao.get(vigente.id) ?? [],
      itensPorVersao.get(vigente.id) ?? [],
    );

    const resumo: ResumoOrcamentoImportado = {
      ...base,
      acao: plano.alterado ? "nova_versao" : "sem_alteracao",
      motivo: null,
      desfazAprovacao: plano.alterado && orcamento.status === "aprovado",
      versaoAtual: vigente.numero_versao,
      proximaVersao: plano.alterado ? ultimoNumero + 1 : null,
      versaoDesatualizada:
        secao.versaoId !== null && secao.versaoId !== vigente.id,
      resumo: plano.resumo,
    };

    return { secao, orcamento, vigente, ultimoNumero, plano, resumo };
  });

  return { ok: true, arquivo: arq, leitura, analises };
}

/** Lê e compara, sem gravar. */
export async function previewImportacaoProjeto(
  projetoId: string,
  formData: FormData,
): Promise<PreviewProjetoResult> {
  const res = await analisar(projetoId, formData);
  if (!res.ok) return res;

  const orcamentos = res.analises.map((a) => a.resumo);
  return {
    ok: true,
    preview: {
      arquivo_nome: res.arquivo.nome,
      aba: res.leitura.aba,
      orcamentos,
      warnings: res.leitura.warnings,
      linhas_lidas: res.leitura.linhas_lidas,
      linhas_importadas: res.leitura.linhas_importadas,
      linhas_ignoradas: res.leitura.linhas_ignoradas,
      novasVersoes: orcamentos.filter((o) => o.acao === "nova_versao").length,
    },
  };
}

/**
 * Grava: uma versão nova por orçamento alterado, na ordem da planilha.
 *
 * Cada orçamento é uma unidade: se um falhar no meio, a versão dele é
 * apagada e a importação para ali, dizendo o que já entrou. Não há
 * transação entre orçamentos — o que ficou gravado é versão íntegra.
 */
export async function confirmarImportacaoProjeto(
  projetoId: string,
  formData: FormData,
): Promise<ConfirmProjetoResult> {
  const session = await requireSession();
  const tenantId = session.activeTenant.id;

  const res = await analisar(projetoId, formData);
  if (!res.ok) return res;

  const alvos = res.analises.filter(
    (a): a is Analise & { orcamento: OrcamentoRow; vigente: VersaoRow; plano: PlanoDaSecao } =>
      a.resumo.acao === "nova_versao" &&
      a.orcamento !== null &&
      a.vigente !== null &&
      a.plano !== null,
  );
  if (alvos.length === 0) {
    return {
      ok: false,
      message: "Nenhum orçamento alterado na planilha — nada a importar.",
    };
  }

  const supabase = createClient();
  const service = createServiceClient();

  // O arquivo sobe uma vez; cada versão criada aponta para ele.
  const importacaoId = crypto.randomUUID();
  const arquivoNomeSlug = res.arquivo.nome.replace(/[^\w.\-]/g, "_");
  const arquivoPath = `${tenantId}/projeto-${projetoId}/${importacaoId}-${arquivoNomeSlug}`;
  const { error: uploadErr } = await service.storage
    .from(BUCKET)
    .upload(arquivoPath, res.arquivo.buffer, {
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      upsert: false,
    });
  if (uploadErr) {
    console.error("[importacao.projeto.upload]", uploadErr.message);
    // Não bloqueia: a versão vale mais que o arquivo guardado.
  }

  const criadas: Extract<ConfirmProjetoResult, { ok: true }>["versoes"] = [];

  const falhar = (mensagem: string): ConfirmProjetoResult => ({
    ok: false,
    message:
      criadas.length > 0
        ? `${mensagem} Já tinham entrado: ${criadas
            .map((c) => `${c.nome} (v${c.numeroVersao})`)
            .join(", ")}.`
        : mensagem,
  });

  for (const alvo of alvos) {
    const { orcamento, vigente, plano, ultimoNumero } = alvo;
    const numero = ultimoNumero + 1;

    // 1) A versão, com os parâmetros da vigente. Honorários e imposto
    //    não vêm da planilha: são da versão, e a planilha do cliente nem
    //    os tem por orçamento.
    //
    //    O imposto é a exceção: versão IMPORTADA nasce zerada, ou seja,
    //    com o seletor em branco, para forçar a escolha manual da
    //    alíquota antes de aprovar (decisão 044, 03/09/2026). Herdar a
    //    da vigente carregaria uma alíquota que ninguém conferiu para
    //    dentro de uma planilha que veio de fora.
    const { data: nova, error: versaoErr } = await supabase
      .from("versoes_orcamento")
      .insert({
        tenant_id: tenantId,
        orcamento_id: orcamento.id,
        numero_versao: numero,
        status: "rascunho",
        moeda: vigente.moeda,
        taxa_cambio: num(vigente.taxa_cambio) || 1,
        percentual_honorarios: num(vigente.percentual_honorarios),
        percentual_imposto: 0,
        save_por_padrao: vigente.save_por_padrao === true,
        created_by: session.profile.id,
      })
      .select("id")
      .single();
    if (versaoErr || !nova) {
      console.error("[importacao.projeto.versao]", versaoErr?.message);
      return falhar(`${orcamento.codigo}: não foi possível criar a versão.`);
    }
    const versaoId = nova.id as string;

    const desfazer = async () => {
      await service.from("versoes_orcamento").delete().eq("id", versaoId);
    };

    // 2) Grupos, na ordem da planilha.
    const gruposParaInserir = plano.grupos.map((g, i) => ({
      tenant_id: tenantId,
      versao_orcamento_id: versaoId,
      nome: g.nome,
      ordem: i + 1,
    }));
    const { data: gruposCriados, error: gruposErr } =
      gruposParaInserir.length > 0
        ? await supabase
            .from("versoes_orcamento_grupos")
            .insert(gruposParaInserir)
            .select("id, ordem")
        : { data: [] as { id: string; ordem: number }[], error: null };
    if (gruposErr || !gruposCriados) {
      console.error("[importacao.projeto.grupos]", gruposErr?.message);
      await desfazer();
      return falhar(`${orcamento.codigo}: não foi possível criar os grupos.`);
    }
    const grupoIdPorOrdem = new Map(
      (gruposCriados as { id: string; ordem: number }[]).map((g) => [g.ordem, g.id]),
    );

    // 3) Itens: casado mantém planejado, categoria, rastro e a marca de
    //    save; novo nasce com planejado zerado (decisão do Tiago) e com a
    //    marca de save que a versão dá a linha nova.
    const itensParaInserir: any[] = [];
    let ordemGlobal = 0;
    plano.grupos.forEach((g, i) => {
      const grupoId = grupoIdPorOrdem.get(i + 1);
      if (!grupoId) return;
      for (const it of g.itens) {
        ordemGlobal += 1;
        const origem = it.origem;
        itensParaInserir.push({
          tenant_id: tenantId,
          versao_orcamento_id: versaoId,
          grupo_id: grupoId,
          ordem: ordemGlobal,
          item: it.item,
          tipo_custo: it.tipo_custo,
          valor_unitario_orcado: it.valor_unitario_orcado,
          quantidade_orcada: it.quantidade_orcada,
          dias_meses_orcado: it.dias_meses_orcado,
          valor_unitario_planejado: origem ? origem.valor_unitario_planejado : 0,
          quantidade_planejada: origem ? origem.quantidade_planejada : 0,
          dias_meses_planejado: origem ? origem.dias_meses_planejado : 0,
          categoria_id: origem ? origem.categoria_id : null,
          planilha_origem: origem
            ? origem.planilha_origem
            : `linha ${it.linha_xlsx}`,
          em_save: origem ? origem.em_save : vigente.save_por_padrao === true,
        });
      }
    });
    if (itensParaInserir.length > 0) {
      const { error: itensErr } = await supabase
        .from("versoes_orcamento_itens")
        .insert(itensParaInserir);
      if (itensErr) {
        console.error("[importacao.projeto.itens]", itensErr.message);
        await desfazer();
        return falhar(`${orcamento.codigo}: não foi possível gravar os itens.`);
      }
    }

    // 4) Orçamento aprovado: a aprovação é desfeita pelo mesmo caminho
    //    do "Cancelar aprovação" da tela. Depois da versão, e não antes:
    //    se falhar aqui, sobra um rascunho a mais num orçamento ainda
    //    aprovado, que é inofensivo — o contrário deixaria o orçamento
    //    desaprovado sem a versão que justificava.
    let aprovacaoDesfeita = false;
    if (orcamento.status === "aprovado") {
      const r = await cancelarAprovacaoVersao(vigente.id);
      if (!r.ok) {
        await desfazer();
        return falhar(
          `${orcamento.codigo}: a versão nova não pôde ficar vigente porque a aprovação não foi desfeita (${r.message}).`,
        );
      }
      aprovacaoDesfeita = true;
    }

    // 5) Registro da importação e auditoria.
    const { error: impErr } = await service.from("orcamento_importacoes").insert({
      tenant_id: tenantId,
      orcamento_id: orcamento.id,
      versao_orcamento_id: versaoId,
      arquivo_path: uploadErr ? "" : arquivoPath,
      arquivo_nome_original: res.arquivo.nome,
      arquivo_tamanho_bytes: res.arquivo.tamanho,
      aba_origem: res.leitura.aba,
      linhas_lidas: res.leitura.linhas_lidas,
      linhas_importadas: itensParaInserir.length,
      linhas_ignoradas: plano.resumo.apagados,
      warnings: res.leitura.warnings as any,
      created_by: session.profile.id,
    });
    if (impErr) console.error("[importacao.projeto.registro]", impErr.message);

    await logAuditEvent({
      acao: "versao_orcamento.importada",
      tenantId,
      entidadeTipo: "versao_orcamento",
      entidadeId: versaoId,
      metadata: {
        orcamento_id: orcamento.id,
        origem: "planilha_do_projeto",
        projeto_id: projetoId,
        importacao_id: importacaoId,
        arquivo_nome: res.arquivo.nome,
        versao_base_id: vigente.id,
        numero_versao: numero,
        aprovacao_desfeita: aprovacaoDesfeita,
        ...plano.resumo,
      },
    });

    criadas.push({
      orcamentoId: orcamento.id,
      codigo: orcamento.codigo,
      nome: orcamento.nome,
      versaoId,
      numeroVersao: numero,
      aprovacaoDesfeita,
    });
    revalidatePath(`/orcamentos/${projetoId}/${orcamento.id}`);
  }

  revalidatePath(`/orcamentos/${projetoId}`);
  revalidatePath(`/orcamentos/${projetoId}/agregado`);
  return { ok: true, versoes: criadas };
}
