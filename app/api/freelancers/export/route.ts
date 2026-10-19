import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { pode } from "@/lib/permissoes";
import type { FreelancerComStatus } from "@/lib/types";
import { formatCpf, formatCnpj, formatCep, formatTelefone } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ACOES_VALIDAS = new Set([
  "contratar",
  "renovar",
  "manter",
  "substituir",
  "encerrar",
  "sem_decisao",
]);

const STATUS_VALIDOS = new Set([
  "regular",
  "vencendo",
  "irregular",
  "sem_minuta",
  "sem_assinado",
  "agendado",
  "pendente",
  "encerrado",
  "limbo",
]);

/**
 * GET /api/freelancers/export?q=&acao=&status=&inicio_apos=&responsavel=
 *
 * Exporta a mesma lista que a UI mostra (respeita filtros via query
 * string). Retorna XLSX como download.
 */
export async function GET(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }
  if (!pode(session.activeRole, "sidebar.freelancers")) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const supabase = createClient();
  const { searchParams } = new URL(request.url);

  let query = supabase
    .from("freelancers_com_status")
    .select("*")
    .eq("tenant_id", session.activeTenant.id)
    .order("nome_social", { ascending: true });

  const termo = searchParams.get("q")?.trim();
  if (termo) {
    const soDigitos = termo.replace(/\D+/g, "");
    const likeNome = `%${termo}%`;
    const cond = [
      `nome_social.ilike.${likeNome}`,
      `nome_completo.ilike.${likeNome}`,
    ];
    if (soDigitos.length >= 3) {
      cond.push(`cpf.ilike.%${soDigitos}%`);
    }
    query = query.or(cond.join(","));
  }

  const acoesFiltro = (searchParams.get("acao") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => ACOES_VALIDAS.has(s));
  if (acoesFiltro.length > 0) {
    const temSemDecisao = acoesFiltro.includes("sem_decisao");
    const concretas = acoesFiltro.filter((a) => a !== "sem_decisao");
    if (temSemDecisao && concretas.length > 0) {
      query = query.or(
        `acao_prevista.is.null,acao_prevista.in.(${concretas.join(",")})`,
      );
    } else if (temSemDecisao) {
      query = query.is("acao_prevista", null);
    } else {
      query = query.in("acao_prevista", concretas);
    }
  }

  const statusFiltro = (searchParams.get("status") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => STATUS_VALIDOS.has(s));
  if (statusFiltro.length > 0) {
    query = query.in("status_calculado", statusFiltro);
  }

  const inicioApos = searchParams.get("inicio_apos")?.trim();
  if (inicioApos && /^\d{4}-\d{2}-\d{2}$/.test(inicioApos)) {
    query = query.gte("data_inicio", inicioApos);
  }

  const responsavelId = searchParams.get("responsavel")?.trim();
  if (responsavelId && /^[0-9a-f-]{36}$/i.test(responsavelId)) {
    query = query.eq("responsavel_id", responsavelId);
  }

  const { data: freelancers, error } = await query.returns<FreelancerComStatus[]>();
  if (error) {
    console.error("[freelancers.export]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Monta XLSX
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Agência California";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Freelancers");

  sheet.columns = [
    { header: "Nome social", key: "nome_social", width: 28 },
    { header: "Nome completo", key: "nome_completo", width: 32 },
    { header: "CPF", key: "cpf", width: 16 },
    { header: "RG", key: "rg", width: 14 },
    { header: "Email", key: "email", width: 30 },
    { header: "Celular", key: "celular", width: 18 },
    { header: "Cidade", key: "cidade", width: 20 },
    { header: "CEP", key: "cep", width: 12 },
    { header: "Endereço", key: "endereco", width: 40 },
    { header: "CNPJ", key: "cnpj", width: 20 },
    { header: "Razão social", key: "razao_social", width: 32 },
    { header: "Pagamento", key: "tipo_pagamento", width: 16 },
    { header: "Banco", key: "banco", width: 20 },
    { header: "Agência", key: "agencia", width: 10 },
    { header: "Conta", key: "conta", width: 14 },
    { header: "Chave PIX", key: "pix_chave", width: 32 },
    { header: "Ação prevista", key: "acao_prevista", width: 14 },
    { header: "Status", key: "status_calculado", width: 14 },
    { header: "Job (contrato ativo)", key: "nome_job", width: 32 },
    { header: "Código job", key: "job_codigo", width: 14 },
    { header: "Cargo", key: "cargo_contrato", width: 24 },
    { header: "Valor", key: "valor", width: 14 },
    { header: "Tipo contrato", key: "tipo", width: 12 },
    { header: "Data início", key: "data_inicio", width: 12 },
    { header: "Data término", key: "data_termino", width: 12 },
    { header: "Responsável", key: "responsavel_nome", width: 24 },
    { header: "Cadastrado em", key: "created_at", width: 16 },
  ];

  // Negrito no cabeçalho
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).alignment = { vertical: "middle" };

  for (const f of freelancers ?? []) {
    sheet.addRow({
      nome_social: f.nome_social,
      nome_completo: f.nome_completo,
      cpf: f.cpf ? formatCpf(f.cpf) : "",
      rg: f.rg,
      email: f.email,
      celular: f.celular ? formatTelefone(f.celular) : "",
      cidade: f.cidade,
      cep: f.cep ? formatCep(f.cep) : "",
      endereco: [f.rua, f.numero, f.complemento, f.bairro]
        .filter(Boolean)
        .join(", "),
      cnpj: f.cnpj ? formatCnpj(f.cnpj) : "",
      razao_social: f.razao_social,
      tipo_pagamento:
        f.tipo_pagamento === "pix"
          ? "PIX"
          : f.tipo_pagamento === "conta_bancaria"
            ? "Conta bancária"
            : "",
      banco: f.banco,
      agencia: f.agencia,
      conta: f.conta,
      pix_chave: f.pix_chave,
      acao_prevista: f.acao_prevista ?? "Sem decisão",
      status_calculado: f.status_calculado,
      nome_job: f.nome_job,
      job_codigo: f.job_codigo,
      cargo_contrato: f.cargo_contrato,
      valor: f.valor !== null ? Number(f.valor) : null,
      tipo: f.tipo,
      data_inicio: f.data_inicio,
      data_termino: f.data_termino,
      responsavel_nome: f.responsavel_nome,
      created_at: new Date(f.created_at).toLocaleDateString("pt-BR"),
    });
  }

  // Formata coluna de valor
  sheet.getColumn("valor").numFmt = "#,##0.00";

  const buffer = await workbook.xlsx.writeBuffer();
  const nomeArquivo = `freelancers-${new Date().toISOString().slice(0, 10)}.xlsx`;

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nomeArquivo}"`,
    },
  });
}
