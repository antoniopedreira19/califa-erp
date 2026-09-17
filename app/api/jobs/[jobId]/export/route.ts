import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { pode } from "@/lib/permissoes";
import { configDaPlanilha } from "@/app/(app)/_planilha/modelo-planilha";
import { mesesDaVersaoQuery } from "@/lib/data/meses-versao";
import { nomeDeArquivoSeguro } from "@/lib/exportacao/planilha-orcamento";
import { adicionarAbaInterna, type MesInterno } from "@/lib/exportacao/planilha-interna";
import { cambioDaInterna } from "@/lib/exportacao/interna-da-versao";
import {
  fechamentoInternoDoJob,
  gruposInternosDoJob,
  type BvDaSublinha,
  type GrupoDoJob,
  type ItemDoJob,
  type PPDaSublinha,
} from "@/lib/exportacao/interna-do-job";
import type { CategoriaModeloPlanilha } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Exportação da PLANILHA INTERNA DO JOB (decisão 088, 17/09/2026).
 *
 * `GET /api/jobs/[jobId]/export` — orçado (a cópia do job, com as
 * erratas), PLANEJADO e REALIZADO, com uma sublinha por PP, por devolução
 * de verba e por BV que já conta, e o fechamento que termina no valor do
 * job (mais o valor ajustado, quando há save).
 *
 * Esta planilha **não volta pelo Importar**: a marca `interna:job` na
 * linha 1 da coluna oculta é o que os dois parsers usam para recusá-la —
 * o realizado nasce das PPs, não de um arquivo.
 *
 * As contas não são reescritas aqui. `blocosDoItem` é a mesma função da
 * tela (BV só no realizado, `A` e `D` espelhando o orçado) e
 * `calcularTotaisVersao` é a mesma do card de Totais.
 */
export async function GET(
  _req: Request,
  { params }: { params: { jobId: string } },
) {
  const session = await requireSession();
  const tenantId = session.activeTenant.id;
  const supabase = createClient();

  // Quem vê a planilha interna do job a exporta; o freelancer, que só tem
  // a visão restrita, fica de fora (P13).
  if (!pode(session.activeRole, "jobs.ver")) {
    return NextResponse.json(
      { error: "Você não tem permissão para exportar a planilha interna." },
      { status: 403 },
    );
  }

  const { data: raw } = await supabase
    .from("jobs")
    .select(
      "id, codigo, nome, status, versao_orcamento_aprovada_id, " +
        "orcamento:orcamentos(id, codigo, nome, categoria:categorias_dominio!categoria_id(modelo_planilha)), " +
        "versao:versoes_orcamento!versao_orcamento_aprovada_id(id, numero_versao, percentual_honorarios, percentual_imposto, " +
        "percentual_int_taxes, int_transaction_costs, moeda_estrangeira, cambio_compra, cambio_cotacao, cambio_venda, cambio_data), " +
        "projeto:projetos(cliente:clientes(nome_fantasia))",
    )
    .eq("id", params.jobId)
    .eq("tenant_id", tenantId)
    .maybeSingle<any>();

  if (!raw) {
    return NextResponse.json({ error: "Job não encontrado" }, { status: 404 });
  }
  if (!raw.versao) {
    return NextResponse.json(
      { error: "Este job não tem versão aprovada — nada a exportar." },
      { status: 400 },
    );
  }

  const versaoId = raw.versao_orcamento_aprovada_id as string;
  const [gruposRes, itensRes, realizadosRes, ppsRes, bvsRes, mesesRes] =
    await Promise.all([
      supabase
        .from("versoes_orcamento_grupos")
        .select("id, nome, ordem, mes_id")
        .eq("versao_orcamento_id", versaoId)
        .eq("tenant_id", tenantId)
        .order("ordem", { ascending: true }),
      // O orçado do job é a CÓPIA (com as erratas), não a versão aprovada.
      supabase
        .from("jobs_itens_orcado")
        .select(
          "id, grupo_id, ordem, item, tipo_custo, linha_vermelha, " +
            "valor_unitario_orcado, quantidade_orcada, dias_meses_orcado, total_orcado, " +
            "valor_unitario_planejado, quantidade_planejada, dias_meses_planejado, total_planejado, " +
            "em_save, save_consumido",
        )
        .eq("job_id", params.jobId)
        .eq("tenant_id", tenantId)
        .order("ordem", { ascending: true }),
      supabase
        .from("jobs_itens_realizado")
        .select(
          "id, job_item_orcado_id, valor_unitario_realizado, quantidade_realizada, " +
            "dias_meses_realizado, total_realizado",
        )
        .eq("job_id", params.jobId)
        .eq("tenant_id", tenantId),
      // Todas as PPs do job; a cancelada não entra na planilha.
      supabase
        .from("pedidos_compra")
        .select(
          "id, codigo, status, item_realizado_id, valor, valor_unitario, quantidade, dias_meses, " +
            "verba_producao, fornecedor:fornecedores(nome), responsavel:profiles!responsavel_verba_id(nome), " +
            "prestacao:pp_verba_prestacoes!pp_verba_prestacoes_pedido_compra_id_fkey(valor_devolvido)",
        )
        .eq("job_id", params.jobId)
        .eq("tenant_id", tenantId)
        .neq("status", "cancelada")
        .order("created_at", { ascending: true }),
      supabase
        .from("itens_bv")
        .select(
          "id, job_item_orcado_id, valor, situacao, fornecedor:fornecedores(nome), " +
            "copia:jobs_itens_orcado!inner(job_id)",
        )
        .eq("copia.job_id", params.jobId)
        .eq("tenant_id", tenantId)
        .neq("situacao", "cancelado"),
      mesesDaVersaoQuery(supabase, tenantId, versaoId),
    ]);

  const primeiro = <T,>(v: T | T[] | null | undefined): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

  // ---------- realizado, PPs e BVs por linha da planilha ----------
  const realizadoPorItem = new Map<string, any>();
  const itemDaLinhaDeRealizado = new Map<string, string>();
  for (const r of (realizadosRes.data ?? []) as any[]) {
    if (!r.job_item_orcado_id) continue;
    realizadoPorItem.set(r.job_item_orcado_id, r);
    itemDaLinhaDeRealizado.set(r.id, r.job_item_orcado_id);
  }

  const ppsPorItem = new Map<string, PPDaSublinha[]>();
  for (const pp of (ppsRes.data ?? []) as any[]) {
    const itemId = itemDaLinhaDeRealizado.get(pp.item_realizado_id);
    if (!itemId) continue;
    const fornecedor = primeiro<any>(pp.fornecedor)?.nome ?? null;
    const responsavel = primeiro<any>(pp.responsavel)?.nome ?? null;
    const doItem = ppsPorItem.get(itemId) ?? [];
    doItem.push({
      id: pp.id,
      codigo: pp.codigo,
      status: pp.status,
      valor: Number(pp.valor ?? 0),
      valor_unitario: Number(pp.valor_unitario ?? 0),
      quantidade: Number(pp.quantidade ?? 0),
      dias_meses: Number(pp.dias_meses ?? 0),
      pagoA: pp.verba_producao ? (responsavel ?? "Verba de produção") : fornecedor,
      valorDevolvido: Number(primeiro<any>(pp.prestacao)?.valor_devolvido ?? 0),
    });
    ppsPorItem.set(itemId, doItem);
  }

  const bvsPorItem = new Map<string, BvDaSublinha[]>();
  for (const bv of (bvsRes.data ?? []) as any[]) {
    if (!bv.job_item_orcado_id) continue;
    const doItem = bvsPorItem.get(bv.job_item_orcado_id) ?? [];
    doItem.push({
      id: bv.id,
      valor: Number(bv.valor ?? 0),
      situacao: bv.situacao,
      fornecedorNome: primeiro<any>(bv.fornecedor)?.nome ?? null,
    });
    bvsPorItem.set(bv.job_item_orcado_id, doItem);
  }

  const itens: ItemDoJob[] = ((itensRes.data ?? []) as any[]).map((it) => {
    const realizado = realizadoPorItem.get(it.id);
    return {
      id: it.id,
      orcado_id: it.id,
      item_versao_id: null,
      linha_vermelha: it.linha_vermelha === true,
      grupo_id: it.grupo_id,
      ordem: Number(it.ordem ?? 0),
      item: it.item,
      tipo_custo: it.tipo_custo,
      categoria_id: null,
      valor_unitario_orcado: Number(it.valor_unitario_orcado ?? 0),
      quantidade_orcada: Number(it.quantidade_orcada ?? 1),
      dias_meses_orcado: Number(it.dias_meses_orcado ?? 1),
      total_orcado: Number(it.total_orcado ?? 0),
      valor_unitario_planejado: Number(it.valor_unitario_planejado ?? 0),
      quantidade_planejada: Number(it.quantidade_planejada ?? 0),
      dias_meses_planejado: Number(it.dias_meses_planejado ?? 0),
      total_planejado: Number(it.total_planejado ?? 0),
      bv_liquido_planejado: null,
      em_save: it.em_save === true,
      save_consumido: Number(it.save_consumido ?? 0),
      somaDasPPs: Number(realizado?.total_realizado ?? 0),
      pps: ppsPorItem.get(it.id) ?? [],
      bvs: bvsPorItem.get(it.id) ?? [],
      quebraDoRealizado: {
        valorUnitario: Number(realizado?.valor_unitario_realizado ?? 0),
        quantidade: Number(realizado?.quantidade_realizada ?? 0),
        diasMeses: Number(realizado?.dias_meses_realizado ?? 0),
      },
    };
  });

  // "Já aberto" e não "aceita ações": job encerrado continua mostrando o
  // realizado. O que zera o bloco é a pré-abertura — a mesma regra da tela.
  const jobAberto =
    raw.status !== "aguardando_abertura" && raw.status !== "rejeitado_financeiro";

  const grupos: GrupoDoJob[] = ((gruposRes.data ?? []) as any[]).map((g) => ({
    id: g.id,
    nome: g.nome,
    mesId: g.mes_id ?? null,
    itens: itens.filter((i) => i.grupo_id === g.id),
  }));

  // ---------- modelo e fechamento ----------
  const versao = primeiro<any>(raw.versao)!;
  const orcamento = primeiro<any>(raw.orcamento);
  const modelo: CategoriaModeloPlanilha =
    primeiro<any>(orcamento?.categoria)?.modelo_planilha ?? "nacional";
  const config = configDaPlanilha(modelo, versao);
  const percentualHonorarios = Number(versao.percentual_honorarios ?? 0);
  const percentualImposto = Number(versao.percentual_imposto ?? 0);
  const fechar = (doConjunto: ItemDoJob[]) =>
    fechamentoInternoDoJob(doConjunto, percentualHonorarios, percentualImposto, {
      internacional: config.internacional,
      jobAberto,
    });

  const meses = (mesesRes.data ?? []) as { id: string; mes: string }[];
  const mesesDaAba: MesInterno[] | undefined =
    modelo === "mensal"
      ? [...meses]
          .sort((a, b) => a.mes.localeCompare(b.mes))
          .map((m) => ({
            mes: m.mes,
            grupos: gruposInternosDoJob(
              grupos.filter((g) => g.mesId === m.id),
              jobAberto,
            ),
          }))
      : undefined;
  const itensDoMes = (mesId: string) =>
    grupos.filter((g) => g.mesId === mesId).flatMap((g) => g.itens);

  const wb = new ExcelJS.Workbook();
  wb.creator = "California ERP";
  wb.created = new Date();

  adicionarAbaInterna(wb, "Interna", {
    identificacao: `${raw.codigo} · ${raw.nome}`,
    clienteNome: primeiro<any>(primeiro<any>(raw.projeto)?.cliente)?.nome_fantasia ?? "—",
    titulo: "Planilha interna do job",
    marca: "interna:job",
    modelo: modelo === "mensal" ? "mensal" : config.internacional ? "internacional" : "nacional",
    ...(config.internacional
      ? cambioDaInterna({
          moeda: (versao.moeda_estrangeira ?? "USD").trim().toUpperCase() || "USD",
          compra: versao.cambio_compra === null ? null : Number(versao.cambio_compra),
          cotacao: versao.cambio_cotacao === null ? null : Number(versao.cambio_cotacao),
          venda: versao.cambio_venda === null ? null : Number(versao.cambio_venda),
          data: versao.cambio_data ?? null,
        })
      : {}),
    comRealizado: true,
    secoes: [
      {
        ...(mesesDaAba
          ? {
              meses: mesesDaAba,
              fechamentoDoMes: [...meses]
                .sort((a, b) => a.mes.localeCompare(b.mes))
                .map((m) => fechar(itensDoMes(m.id))),
            }
          : { grupos: gruposInternosDoJob(grupos, jobAberto) }),
        fechamento: fechar(itens),
      },
    ],
  });

  const buffer = await wb.xlsx.writeBuffer();
  const nomeArquivo = nomeDeArquivoSeguro(`interna-${raw.codigo}.xlsx`);

  return new NextResponse(buffer as ArrayBuffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nomeArquivo}"`,
      "Cache-Control": "no-store",
    },
  });
}
