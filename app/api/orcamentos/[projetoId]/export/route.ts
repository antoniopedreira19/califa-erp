import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { nomeVersao } from "@/lib/nome-versao";
import { escolherJobDoFunil, estagioFunil } from "@/lib/calculos/funil";
import {
  adicionarAbaOrcamento,
  nomeDeAbaSeguro,
  nomeDeArquivoSeguro,
} from "@/lib/exportacao/planilha-orcamento";
import type { JobStatus, OrcamentoStatus, TipoCusto } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Exportação de VÁRIOS orçamentos do projeto num arquivo só.
 *
 * `GET /api/orcamentos/[projetoId]/export?orcamentos=id1,id2,…`
 *
 * Uma aba por orçamento, cada uma idêntica à exportação de orçamento
 * único (`lib/exportacao/planilha-orcamento.ts`): a versão que sai é a
 * aprovada e, sem aprovada, a mais recente — a mesma regra do "Valor do
 * Job" da página do projeto e da versão vigente da visão agregada.
 *
 * As travas do seletor valem aqui também, porque a regra não pode morar
 * só na tela: orçamento que já é job aberto não sai no arquivo, e
 * orçamento sem versão não tem o que exportar.
 */
export async function GET(
  req: Request,
  { params }: { params: { projetoId: string } },
) {
  const session = await requireSession();
  const tenantId = session.activeTenant.id;
  const supabase = createClient();

  const pedido = new URL(req.url).searchParams.get("orcamentos") ?? "";
  const ids = Array.from(
    new Set(
      pedido
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    ),
  );
  if (ids.length === 0) {
    return NextResponse.json(
      { error: "Nenhum orçamento selecionado para exportar." },
      { status: 400 },
    );
  }

  const [projRes, orcsRes, jobsRes, versoesRes] = await Promise.all([
    supabase
      .from("projetos")
      .select("id, codigo, nome, cliente:clientes(nome_fantasia)")
      .eq("id", params.projetoId)
      .eq("tenant_id", tenantId)
      .maybeSingle<{
        id: string;
        codigo: string;
        nome: string;
        cliente: { nome_fantasia: string } | null;
      }>(),
    supabase
      .from("orcamentos")
      .select("id, codigo, nome, status, versao_aprovada_id")
      .eq("projeto_id", params.projetoId)
      .eq("tenant_id", tenantId)
      .in("id", ids)
      .order("codigo", { ascending: true }),
    supabase
      .from("jobs")
      .select("orcamento_id, status, created_at")
      .eq("tenant_id", tenantId)
      .in("orcamento_id", ids),
    supabase
      .from("versoes_orcamento")
      .select("id, orcamento_id, numero_versao, status, percentual_honorarios, percentual_imposto, created_at")
      .eq("tenant_id", tenantId)
      .in("orcamento_id", ids)
      .neq("status", "cancelada"),
  ]);

  if (!projRes.data) {
    return NextResponse.json({ error: "Projeto não encontrado" }, { status: 404 });
  }
  const projeto = projRes.data;
  const clienteNome = projeto.cliente?.nome_fantasia ?? "—";

  const orcamentos = (orcsRes.data ?? []) as Array<{
    id: string;
    codigo: string;
    nome: string;
    status: OrcamentoStatus;
    versao_aprovada_id: string | null;
  }>;
  if (orcamentos.length !== ids.length) {
    return NextResponse.json(
      { error: "Um dos orçamentos não pertence a este projeto." },
      { status: 404 },
    );
  }

  // ---------- travas ----------
  const jobsPorOrcamento = new Map<string, { status: JobStatus; created_at: string }[]>();
  for (const j of ((jobsRes.data ?? []) as any[])) {
    const atuais = jobsPorOrcamento.get(j.orcamento_id) ?? [];
    atuais.push({ status: j.status as JobStatus, created_at: j.created_at });
    jobsPorOrcamento.set(j.orcamento_id, atuais);
  }
  const abertos = orcamentos.filter(
    (o) =>
      estagioFunil(o.status, escolherJobDoFunil(jobsPorOrcamento.get(o.id) ?? [])) ===
      "aberto",
  );
  if (abertos.length > 0) {
    return NextResponse.json(
      {
        error: `${abertos.map((o) => o.nome).join(", ")} já ${
          abertos.length === 1 ? "é um job aberto" : "são jobs abertos"
        } e não ${abertos.length === 1 ? "pode" : "podem"} ser exportado.`,
      },
      { status: 400 },
    );
  }

  // ---------- versão que sai de cada orçamento ----------
  type VersaoLeve = {
    id: string;
    orcamento_id: string;
    numero_versao: number;
    status: string;
    percentual_honorarios: number | string;
    percentual_imposto: number | string;
    created_at: string;
  };
  const versoesPorOrcamento = new Map<string, VersaoLeve[]>();
  for (const v of ((versoesRes.data ?? []) as VersaoLeve[])) {
    const atuais = versoesPorOrcamento.get(v.orcamento_id) ?? [];
    atuais.push(v);
    versoesPorOrcamento.set(v.orcamento_id, atuais);
  }

  const versaoAlvo = new Map<string, VersaoLeve>();
  const semVersao: string[] = [];
  for (const o of orcamentos) {
    const versoes = versoesPorOrcamento.get(o.id) ?? [];
    const aprovada = o.versao_aprovada_id
      ? versoes.find((v) => v.id === o.versao_aprovada_id)
      : undefined;
    const alvo =
      aprovada ??
      [...versoes].sort(
        (a, b) =>
          b.numero_versao - a.numero_versao ||
          b.created_at.localeCompare(a.created_at),
      )[0];
    if (alvo) versaoAlvo.set(o.id, alvo);
    else semVersao.push(o.nome);
  }
  if (semVersao.length > 0) {
    return NextResponse.json(
      {
        error: `${semVersao.join(", ")} ainda não tem versão — nada a exportar.`,
      },
      { status: 400 },
    );
  }

  const versaoIds = [...versaoAlvo.values()].map((v) => v.id);
  const [gruposRes, itensRes] = await Promise.all([
    supabase
      .from("versoes_orcamento_grupos")
      .select("id, versao_orcamento_id, nome, ordem")
      .eq("tenant_id", tenantId)
      .in("versao_orcamento_id", versaoIds)
      .order("ordem", { ascending: true }),
    supabase
      .from("versoes_orcamento_itens")
      .select(
        "id, versao_orcamento_id, grupo_id, ordem, item, tipo_custo, " +
          "valor_unitario_orcado, quantidade_orcada, dias_meses_orcado, total_orcado, " +
          "em_save, save_consumido",
      )
      .eq("tenant_id", tenantId)
      .in("versao_orcamento_id", versaoIds)
      .order("ordem", { ascending: true }),
  ]);

  const gruposPorVersao = new Map<string, { id: string; nome: string }[]>();
  for (const g of ((gruposRes.data ?? []) as any[])) {
    const atuais = gruposPorVersao.get(g.versao_orcamento_id) ?? [];
    atuais.push({ id: g.id, nome: g.nome });
    gruposPorVersao.set(g.versao_orcamento_id, atuais);
  }
  const itensPorGrupo = new Map<string, any[]>();
  for (const it of ((itensRes.data ?? []) as any[])) {
    const atuais = itensPorGrupo.get(it.grupo_id) ?? [];
    atuais.push({
      item: it.item as string,
      tipo_custo: it.tipo_custo as TipoCusto,
      valor_unitario_orcado: Number(it.valor_unitario_orcado ?? 0),
      quantidade_orcada: Number(it.quantidade_orcada ?? 1),
      dias_meses_orcado: Number(it.dias_meses_orcado ?? 1),
      total_orcado: Number(it.total_orcado ?? 0),
      em_save: it.em_save === true,
      save_consumido: Number(it.save_consumido ?? 0),
    });
    itensPorGrupo.set(it.grupo_id, atuais);
  }

  // ---------- monta workbook ----------
  const wb = new ExcelJS.Workbook();
  wb.creator = "California ERP";
  wb.created = new Date();

  // Nome de aba precisa ser único no arquivo; dois jobs com o mesmo nome
  // ganham sufixo numérico em vez de derrubar a exportação inteira.
  const nomesUsados = new Set<string>();
  const nomeUnico = (base: string): string => {
    let nome = nomeDeAbaSeguro(base);
    let n = 2;
    while (nomesUsados.has(nome.toLowerCase())) {
      const sufixo = ` (${n})`;
      nome = nomeDeAbaSeguro(base.slice(0, 31 - sufixo.length)) + sufixo;
      n += 1;
    }
    nomesUsados.add(nome.toLowerCase());
    return nome;
  };

  for (const o of orcamentos) {
    const versao = versaoAlvo.get(o.id)!;
    const grupos = gruposPorVersao.get(versao.id) ?? [];
    adicionarAbaOrcamento(
      wb,
      nomeUnico(o.nome),
      {
        codigo: o.codigo,
        nome: o.nome,
        clienteNome,
        tituloVersao: nomeVersao(o.nome, versao.numero_versao),
        percentualHonorarios: Number(versao.percentual_honorarios ?? 0),
        percentualImposto: Number(versao.percentual_imposto ?? 0),
        grupos: grupos.map((g) => ({
          nome: g.nome,
          itens: itensPorGrupo.get(g.id) ?? [],
        })),
      },
      { formulas: true },
    );
  }

  // ---------- resposta ----------
  const buffer = await wb.xlsx.writeBuffer();
  const nomeArquivo = nomeDeArquivoSeguro(`orcamentos-${projeto.codigo}.xlsx`);

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
