/**
 * O job é de Mídia Off? Com quais condições? (decisão 167)
 *
 * Quem decide a conta é a categoria do ORÇAMENTO de origem (decisão 072),
 * e as condições da mídia — honorários, imposto, base e a parte do veículo
 * — são as da versão aprovada. Quem lê: a abertura do financeiro (custo
 * previsto), o envio do faturamento de cada mês e a PP do repasse (a nota
 * do veículo, entrega 3).
 *
 * Sem `"use server"`: é leitura, chamada de dentro das actions e das
 * páginas.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  desembolsoDaMidia,
  fechamentoDosItens,
  listaDoQueFalta,
  parametrosDaVersao,
  situacaoDoRepasse,
  ultimaVeiculacaoDoMes,
  veiculosNoMes,
  type FechamentoMidia,
  type LinhaDoVeiculoNoMes,
  type ParametrosMidia,
} from "@/lib/calculos/midia-off";
import type { DocumentoDaMidia } from "@/lib/midia/documentos";
import { SELECT_PARAMETROS_DO_JOB, comParametrosDoJob } from "./parametros-do-job";

export type MidiaDoJob =
  | { ok: true; midia: ParametrosMidia | null }
  | { ok: false };

export async function lerMidiaDoJob(
  supabase: SupabaseClient,
  tenantId: string,
  jobId: string,
): Promise<MidiaDoJob> {
  const { data, error } = await supabase
    .from("jobs")
    .select(
      "id, " +
        "versao:versoes_orcamento!versao_orcamento_aprovada_id(percentual_honorarios, percentual_imposto, percentual_veiculo, base_honorarios), " +
        // `!categoria_id`: `orcamentos` tem duas FKs para `categorias_dominio`.
        "orcamento:orcamentos(categoria:categorias_dominio!categoria_id(modelo_planilha)), " +
        // Os parâmetros do job, quando o financeiro os alterou (decisão 224).
        SELECT_PARAMETROS_DO_JOB,
    )
    .eq("id", jobId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{
      id: string;
      parametros: any;
      versao: {
        percentual_honorarios: number | string | null;
        percentual_imposto: number | string | null;
        percentual_veiculo: number | string | null;
        base_honorarios: string | null;
      } | null;
      orcamento: { categoria: { modelo_planilha: string } | null } | null;
    }>();
  if (error || !data) {
    if (error) console.error("[midia-do-job]", error.message);
    return { ok: false };
  }
  if (data.orcamento?.categoria?.modelo_planilha !== "midia_off") {
    return { ok: true, midia: null };
  }
  if (!data.versao) return { ok: false };
  data.versao = comParametrosDoJob(data.versao, data.parametros);
  return {
    ok: true,
    midia: parametrosDaVersao({
      percentual_honorarios: data.versao.percentual_honorarios ?? 0,
      percentual_imposto: data.versao.percentual_imposto ?? 0,
      base_honorarios: data.versao.base_honorarios,
      percentual_veiculo: data.versao.percentual_veiculo,
    }),
  };
}

const AINDA_NAO_DISPONIVEL = {
  errata: "A errata do job de Mídia Off ainda não está disponível: chega com a errata da veiculação.",
  alteracao:
    "O orçado do job de Mídia Off ainda não se edita por aqui: chega com a errata da veiculação.",
} as const;

/**
 * O que o job de Mídia Off ainda não tem (decisão 167): errata e edição do
 * orçado pelo financeiro. A PP do repasse saiu daqui na entrega 3. A tela do
 * job não oferece nenhum dos dois — a planilha da mídia é só leitura —, e
 * esta trava segura a action chamada por fora dela. Devolve a mensagem da
 * recusa, ou `null` para seguir. Leitura que falha recusa: a action não sabe
 * a conta do job.
 */
export async function travaDoJobDeMidia(
  supabase: SupabaseClient,
  tenantId: string,
  jobId: string,
  acao: keyof typeof AINDA_NAO_DISPONIVEL,
): Promise<string | null> {
  const lida = await lerMidiaDoJob(supabase, tenantId, jobId);
  if (!lida.ok) return "Não foi possível conferir o job. Tente de novo.";
  return lida.midia ? AINDA_NAO_DISPONIVEL[acao] : null;
}

/**
 * A última veiculação de um mês do job (`mes` = `YYYY-MM-01`), pelas linhas
 * da CÓPIA: o envio do faturamento do mês só libera no dia seguinte a ela
 * (Tiago, 07 e 13/10/2026). O mês da linha é o do agrupamento da versão
 * (`jobs_itens_orcado.grupo_id`, a âncora — decisão 162). `undefined`
 * quando a leitura falhou; `null` sem data nas linhas.
 */
export async function lerUltimaVeiculacaoDoMes(
  supabase: SupabaseClient,
  tenantId: string,
  jobId: string,
  versaoAprovadaId: string,
  mes: string,
): Promise<string | null | undefined> {
  const [mesesRes, gruposRes, linhasRes] = await Promise.all([
    supabase
      .from("versoes_orcamento_meses")
      .select("id, mes")
      .eq("versao_orcamento_id", versaoAprovadaId)
      .eq("tenant_id", tenantId)
      .eq("mes", mes)
      .returns<{ id: string; mes: string }[]>(),
    supabase
      .from("versoes_orcamento_grupos")
      .select("id, mes_id")
      .eq("versao_orcamento_id", versaoAprovadaId)
      .eq("tenant_id", tenantId)
      .returns<{ id: string; mes_id: string | null }[]>(),
    supabase
      .from("jobs_itens_orcado")
      .select("grupo_id, insercoes_por_dia, data_fim")
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId)
      .returns<
        { grupo_id: string; insercoes_por_dia: Record<string, number> | null; data_fim: string | null }[]
      >(),
  ]);
  const erro = mesesRes.error ?? gruposRes.error ?? linhasRes.error;
  if (erro) {
    console.error("[midia-do-job.ultima-veiculacao]", erro.message);
    return undefined;
  }
  const mesId = (mesesRes.data ?? [])[0]?.id;
  if (!mesId) return null;
  const gruposDoMes = new Set(
    (gruposRes.data ?? []).filter((g) => g.mes_id === mesId).map((g) => g.id),
  );
  return ultimaVeiculacaoDoMes(
    mes,
    (linhasRes.data ?? []).filter((l) => gruposDoMes.has(l.grupo_id)),
  );
}

const SELECT_DOCUMENTO =
  "id, fornecedor_id, mes, tipo, numero, valor, data_emissao, nome_arquivo, storage_path, created_at, autor:profiles!created_by(nome)";

/** A linha de `jobs_midia_documentos` no formato das telas. */
export function documentoDaLinha(d: any): DocumentoDaMidia {
  const autor = Array.isArray(d.autor) ? d.autor[0] : d.autor;
  return {
    id: d.id,
    fornecedorId: d.fornecedor_id,
    mes: String(d.mes).slice(0, 10),
    tipo: d.tipo,
    numero: d.numero,
    valor: d.valor === null || d.valor === undefined ? null : Number(d.valor),
    dataEmissao: d.data_emissao ?? null,
    nomeArquivo: d.nome_arquivo,
    path: d.storage_path,
    criadoEm: d.created_at,
    criadoPorNome: autor?.nome ?? null,
  };
}

/** AP, PI e NF do veículo de todos os meses do job (decisão 274).
 *  `undefined` quando a leitura falhou. */
export async function lerDocumentosDaMidia(
  supabase: SupabaseClient,
  tenantId: string,
  jobId: string,
): Promise<DocumentoDaMidia[] | undefined> {
  const { data, error } = await supabase
    .from("jobs_midia_documentos")
    .select(SELECT_DOCUMENTO)
    .eq("job_id", jobId)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("[midia-do-job.documentos]", error.message);
    return undefined;
  }
  return (data ?? []).map(documentoDaLinha);
}

/**
 * O que falta, veículo a veículo, para o mês ir ao faturamento (decisão
 * 274), pela CÓPIA das linhas — a mesma conta da tela (`veiculosNoMes`).
 * Devolve "Veículo (AP, PI e NF)" por veículo com falta; `[]` liberado;
 * `undefined` quando a leitura falhou.
 */
export async function lerFaltaDosVeiculosNoMes(
  supabase: SupabaseClient,
  tenantId: string,
  jobId: string,
  versaoAprovadaId: string,
  mes: string,
  params: ParametrosMidia,
): Promise<string[] | undefined> {
  const [mesesRes, gruposRes, linhasRes, docsRes, realizadosRes, ppsRes] = await Promise.all([
    supabase
      .from("versoes_orcamento_meses")
      .select("id, mes")
      .eq("versao_orcamento_id", versaoAprovadaId)
      .eq("tenant_id", tenantId)
      .eq("mes", mes.slice(0, 10))
      .returns<{ id: string; mes: string }[]>(),
    supabase
      .from("versoes_orcamento_grupos")
      .select("id, mes_id, meio")
      .eq("versao_orcamento_id", versaoAprovadaId)
      .eq("tenant_id", tenantId)
      .returns<{ id: string; mes_id: string | null; meio: string | null }[]>(),
    supabase
      .from("jobs_itens_orcado")
      .select("id, grupo_id, fornecedor_id, tipo_custo, total_orcado, ordem, midia_extensao_id, created_at")
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId)
      .is("cancelada_em", null)
      .order("ordem", { ascending: true })
      .returns<
        {
          id: string;
          grupo_id: string;
          fornecedor_id: string | null;
          tipo_custo: string;
          total_orcado: number | string | null;
          midia_extensao_id: string | null;
          created_at: string;
        }[]
      >(),
    supabase
      .from("jobs_midia_documentos")
      .select(SELECT_DOCUMENTO)
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId)
      .eq("mes", mes.slice(0, 10)),
    supabase
      .from("jobs_itens_realizado")
      .select("id, job_item_orcado_id, pps_concluidas_em")
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId)
      .returns<{ id: string; job_item_orcado_id: string; pps_concluidas_em: string | null }[]>(),
    supabase
      .from("pedidos_compra")
      .select("item_realizado_id, status")
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId)
      .returns<{ item_realizado_id: string | null; status: string }[]>(),
  ]);
  const erro =
    mesesRes.error ?? gruposRes.error ?? linhasRes.error ?? docsRes.error ?? realizadosRes.error ?? ppsRes.error;
  if (erro) {
    console.error("[midia-do-job.falta-dos-veiculos]", erro.message);
    return undefined;
  }
  const mesId = (mesesRes.data ?? [])[0]?.id;
  if (!mesId) return [];
  const grupoDoMes = new Map(
    (gruposRes.data ?? []).filter((g) => g.mes_id === mesId).map((g) => [g.id, g.meio]),
  );
  const realizadoDaLinha = new Map((realizadosRes.data ?? []).map((r) => [r.job_item_orcado_id, r]));
  const linhas: LinhaDoVeiculoNoMes[] = (linhasRes.data ?? [])
    .filter((l) => grupoDoMes.has(l.grupo_id))
    .map((l) => {
      const r = realizadoDaLinha.get(l.id);
      return {
        id: l.id,
        fornecedorId: l.fornecedor_id,
        tipo: l.tipo_custo,
        negociado: Number(l.total_orcado ?? 0),
        meio: grupoDoMes.get(l.grupo_id) ?? null,
        extensaoEm: l.midia_extensao_id ? l.created_at : null,
        repasse:
          l.tipo_custo === "AR"
            ? situacaoDoRepasse(
                (ppsRes.data ?? []).filter((p) => r && p.item_realizado_id === r.id),
                r?.pps_concluidas_em != null,
              )
            : null,
      };
    });
  const veiculos = veiculosNoMes(mes, linhas, (docsRes.data ?? []).map(documentoDaLinha), params).filter(
    (v) => v.falta.length > 0,
  );
  if (veiculos.length === 0) return [];
  const { data: nomes } = await supabase
    .from("fornecedores")
    .select("id, nome")
    .eq("tenant_id", tenantId)
    .in(
      "id",
      veiculos.map((v) => v.veiculoId),
    )
    .returns<{ id: string; nome: string }[]>();
  const nomeDe = new Map((nomes ?? []).map((f) => [f.id, f.nome]));
  return veiculos.map((v) => `${nomeDe.get(v.veiculoId) ?? "Veículo"} (${listaDoQueFalta(v.falta)})`);
}

/** O fechamento da mídia do job inteiro, pela cópia das linhas: o que as
 *  telas do financeiro mostram no lugar dos totais nacionais — o custo
 *  previsto (`desembolso`, a nota dos veículos em A · Repasse) e o custo
 *  planejado (as notas de todos os veículos). `null` fora da Mídia Off;
 *  `undefined` quando a leitura falhou. */
export async function lerFechamentoMidiaDoJob(
  supabase: SupabaseClient,
  tenantId: string,
  jobId: string,
): Promise<
  { midia: ParametrosMidia; f: FechamentoMidia; desembolso: number } | null | undefined
> {
  const [lida, itensRes] = await Promise.all([
    lerMidiaDoJob(supabase, tenantId, jobId),
    supabase
      .from("jobs_itens_orcado")
      .select("tipo_custo, total_orcado")
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId)
      .returns<{ tipo_custo: string; total_orcado: number | string | null }[]>(),
  ]);
  if (!lida.ok || itensRes.error) {
    if (itensRes.error) console.error("[midia-do-job.fechamento]", itensRes.error.message);
    return undefined;
  }
  if (!lida.midia) return null;
  const itens = itensRes.data ?? [];
  return {
    midia: lida.midia,
    f: fechamentoDosItens(itens, lida.midia),
    desembolso: desembolsoDaMidia(itens, lida.midia),
  };
}
