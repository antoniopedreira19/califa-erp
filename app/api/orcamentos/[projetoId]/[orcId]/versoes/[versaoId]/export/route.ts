import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { nomeVersao } from "@/lib/nome-versao";
import { adicionarAbaOrcamento } from "@/lib/exportacao/planilha-orcamento";
import {
  adicionarAbaOrcamentoMensal,
  mesesDaVersaoParaAba,
} from "@/lib/exportacao/planilha-orcamento-mensal";
import { mesesDaVersaoQuery } from "@/lib/data/meses-versao";
import {
  adicionarAbaOrcamentoInternacional,
  cambioDaVersao,
} from "@/lib/exportacao/planilha-orcamento-internacional";
import { adicionarAbaInterna } from "@/lib/exportacao/planilha-interna";
import {
  cambioDaInterna,
  secaoInternaDaVersao,
} from "@/lib/exportacao/interna-da-versao";
import { pode } from "@/lib/permissoes";
import { configDaPlanilha } from "@/app/(app)/_planilha/modelo-planilha";
import type {
  CategoriaModeloPlanilha,
  VersaoOrcamento,
  VersaoOrcamentoGrupo,
  VersaoOrcamentoItem,
} from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Exportação de UMA versão — a planilha que vai para o cliente.
 *
 * O desenho da planilha mora em `lib/exportacao/planilha-orcamento.ts`
 * desde 03/09/2026, compartilhado com a exportação consolidada do projeto
 * (`app/api/orcamentos/[projetoId]/export`). Esta rota só busca a versão
 * e monta o workbook com uma seção sem título. Com fórmulas e ids
 * ocultos, como a do projeto (decisão 041).
 *
 * `?modo=interna` troca a planilha do cliente pela **interna** (decisão
 * 088): o mesmo orçado, com o PLANEJADO ao lado e o fechamento que termina
 * no valor do job. Sem o parâmetro, nada muda — é a planilha de sempre,
 * que continua indo para o cliente.
 */
export async function GET(
  req: Request,
  { params }: { params: { projetoId: string; orcId: string; versaoId: string } },
) {
  const session = await requireSession();
  const supabase = createClient();

  // A interna mostra margem: só quem exporta orçamento a baixa (decisão
  // 088, P13). A planilha do cliente segue como sempre foi.
  const interna = new URL(req.url).searchParams.get("modo") === "interna";
  if (interna && !pode(session.activeRole, "orcamentos.exportar")) {
    return NextResponse.json(
      { error: "Você não tem permissão para exportar a planilha interna." },
      { status: 403 },
    );
  }

  // ---------- fetch dados ----------
  const [versaoRes, orcRes, gruposRes, itensRes] = await Promise.all([
    supabase
      .from("versoes_orcamento")
      .select("*")
      .eq("id", params.versaoId)
      .eq("orcamento_id", params.orcId)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle<VersaoOrcamento>(),
    supabase
      .from("orcamentos")
      // `!categoria_id`: `orcamentos` tem duas FKs para `categorias_dominio`.
      .select(
        "id, codigo, nome, projeto:projetos(cliente:clientes(nome_fantasia)), categoria:categorias_dominio!categoria_id(modelo_planilha)",
      )
      .eq("id", params.orcId)
      .eq("projeto_id", params.projetoId)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle<{
        id: string;
        codigo: string;
        nome: string;
        projeto: { cliente: { nome_fantasia: string } | null } | null;
        categoria: { modelo_planilha: CategoriaModeloPlanilha } | null;
      }>(),
    supabase
      .from("versoes_orcamento_grupos")
      .select("*")
      .eq("versao_orcamento_id", params.versaoId)
      .eq("tenant_id", session.activeTenant.id)
      .order("ordem", { ascending: true })
      .returns<VersaoOrcamentoGrupo[]>(),
    supabase
      .from("versoes_orcamento_itens")
      .select("*")
      .eq("versao_orcamento_id", params.versaoId)
      .eq("tenant_id", session.activeTenant.id)
      .order("ordem", { ascending: true })
      .returns<VersaoOrcamentoItem[]>(),
  ]);

  if (versaoRes.error || !versaoRes.data) {
    return NextResponse.json({ error: "Versão não encontrada" }, { status: 404 });
  }
  if (!orcRes.data) {
    return NextResponse.json({ error: "Orçamento não encontrado" }, { status: 404 });
  }

  const versao = versaoRes.data;
  const orcamento = orcRes.data;
  const grupos = gruposRes.data ?? [];
  const itens = (itensRes.data ?? []).map((it: any) => ({
    ...it,
    valor_unitario_orcado: Number(it.valor_unitario_orcado ?? 0),
    quantidade_orcada: Number(it.quantidade_orcada ?? 1),
    dias_meses_orcado: Number(it.dias_meses_orcado ?? 1),
    total_orcado: Number(it.total_orcado ?? 0),
    // O planejado só a interna usa; na planilha do cliente ele é ignorado.
    valor_unitario_planejado: Number(it.valor_unitario_planejado ?? 0),
    quantidade_planejada: Number(it.quantidade_planejada ?? 0),
    dias_meses_planejado: Number(it.dias_meses_planejado ?? 0),
    total_planejado: Number(it.total_planejado ?? 0),
  })) as VersaoOrcamentoItem[];

  // Nome do cliente via embed projeto → cliente
  const clienteNome = orcamento.projeto?.cliente?.nome_fantasia ?? "—";

  // ---------- monta workbook ----------
  const wb = new ExcelJS.Workbook();
  wb.creator = "California ERP";
  wb.created = new Date();

  const gruposDaSecao = grupos.map((grupo) => ({
    id: grupo.id,
    nome: grupo.nome,
    itens: itens.filter((i) => i.grupo_id === grupo.id),
  }));

  // O modelo vem da categoria do ORÇAMENTO (decisão 072). Internacional
  // sai no layout da planilha que a California já usa; nacional, como
  // sempre foi.
  const config = configDaPlanilha(orcamento.categoria?.modelo_planilha, versao);
  const mensal = orcamento.categoria?.modelo_planilha === "mensal";
  const mesesDaVersao = mensal
    ? ((
        await mesesDaVersaoQuery(supabase, session.activeTenant.id, versao.id)
      ).data ?? [])
    : [];
  const gruposComMes = grupos.map((grupo) => ({
    id: grupo.id,
    nome: grupo.nome,
    mesId: grupo.mes_id ?? null,
    itens: itens.filter((i) => i.grupo_id === grupo.id),
  }));

  if (interna) {
    adicionarAbaInterna(wb, "Interna", {
      identificacao: `${orcamento.codigo} · ${orcamento.nome}`,
      clienteNome,
      titulo: `${nomeVersao(orcamento.nome, versao.numero_versao)} · planilha interna`,
      marca: "interna:orcamento",
      modelo: mensal ? "mensal" : config.internacional ? "internacional" : "nacional",
      ...(config.internacional ? cambioDaInterna(cambioDaVersao(versao)) : {}),
      comRealizado: false,
      secoes: [
        secaoInternaDaVersao({
          orcamentoId: orcamento.id,
          versaoId: versao.id,
          percentualHonorarios: Number(versao.percentual_honorarios ?? 0),
          percentualImposto: Number(versao.percentual_imposto ?? 0),
          internacional: config.internacional,
          ...(mensal
            ? { meses: mesesDaVersaoParaAba(mesesDaVersao, gruposComMes) }
            : { grupos: gruposDaSecao }),
        }),
      ],
    });
  } else if (mensal) {
    // Fee e Always On (decisão 078, 15/09/2026): cada mês com o seu
    // fechamento e o resumo do trimestre no fim.
    adicionarAbaOrcamentoMensal(
      wb,
      "Orçamento",
      {
        identificacao: `${orcamento.codigo} · ${orcamento.nome}`,
        clienteNome,
        titulo: nomeVersao(orcamento.nome, versao.numero_versao),
        secoes: [
          {
            orcamentoId: orcamento.id,
            versaoId: versao.id,
            percentualHonorarios: Number(versao.percentual_honorarios ?? 0),
            percentualImposto: Number(versao.percentual_imposto ?? 0),
            meses: mesesDaVersaoParaAba(mesesDaVersao, gruposComMes),
          },
        ],
      },
      { formulas: true },
    );
  } else if (config.internacional) {
    adicionarAbaOrcamentoInternacional(
      wb,
      "Orçamento",
      {
        nome: `${orcamento.codigo} · ${nomeVersao(orcamento.nome, versao.numero_versao)}`,
        cambio: cambioDaVersao(versao),
        secoes: [
          {
            orcamentoId: orcamento.id,
            versaoId: versao.id,
            percentualHonorarios: Number(versao.percentual_honorarios ?? 0),
            percentualImposto: Number(versao.percentual_imposto ?? 0),
            internacional: config.internacional,
            grupos: gruposDaSecao,
          },
        ],
      },
      { formulas: true },
    );
  } else {
    adicionarAbaOrcamento(
      wb,
      "Orçamento",
      {
        identificacao: `${orcamento.codigo} · ${orcamento.nome}`,
        clienteNome,
        titulo: nomeVersao(orcamento.nome, versao.numero_versao),
        secoes: [
          {
            orcamentoId: orcamento.id,
            versaoId: versao.id,
            percentualHonorarios: Number(versao.percentual_honorarios ?? 0),
            percentualImposto: Number(versao.percentual_imposto ?? 0),
            grupos: gruposDaSecao,
          },
        ],
      },
      { formulas: true },
    );
  }

  // ---------- resposta ----------
  const buffer = await wb.xlsx.writeBuffer();

  const nomeArquivo = `${interna ? "interna" : "orcamento"}-${orcamento.codigo}-v${versao.numero_versao}.xlsx`;

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
