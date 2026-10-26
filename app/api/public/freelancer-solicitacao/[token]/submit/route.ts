import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { freelancerSchema } from "@/lib/validations/freelancers";
import { logAuditEvent } from "@/lib/auth/audit";
import { isValidCpf, onlyDigits } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TOKEN_RE = /^[0-9a-f]{32}$/i;

/**
 * POST /api/public/freelancer-solicitacao/[token]/submit
 *
 * Rota pública: freelancer preenche dados pessoais e envia. Endpoint cria
 * freelancer (dedup por CPF) + freelancer_contrato (origem=califa_erp)
 * numa transação SQL (função cadastrar_freelancer_via_solicitacao).
 *
 * Service client bypassa RLS porque não há sessão. Validação do token é a
 * única defesa — e é rígida (regex 32 hex + status=aprovada +
 * expira_em > now checadas na função SQL).
 */
export async function POST(
  request: Request,
  { params }: { params: { token: string } },
) {
  if (!TOKEN_RE.test(params.token)) {
    return NextResponse.json({ error: "Token inválido" }, { status: 400 });
  }

  const formData = await request.formData();
  const raw: Record<string, string> = {};
  for (const [k, v] of formData.entries()) {
    if (typeof v === "string") raw[k] = v;
  }

  // CPF é obrigatório no fluxo público (confirmação da identidade do freela)
  const cpfLimpo = onlyDigits(raw.cpf ?? "");
  if (!cpfLimpo || cpfLimpo.length !== 11 || !isValidCpf(cpfLimpo)) {
    return NextResponse.json(
      {
        error: "CPF obrigatório e válido",
        fieldErrors: { cpf: ["CPF obrigatório pra confirmar o cadastro"] },
      },
      { status: 422 },
    );
  }

  const parsed = freelancerSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Dados inválidos",
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
      { status: 422 },
    );
  }

  // Payload pra RPC: só os campos reconhecidos, serializáveis em JSON
  const payload = {
    nome_social: parsed.data.nome_social,
    nome_completo: parsed.data.nome_completo,
    cpf: parsed.data.cpf,
    rg: parsed.data.rg,
    data_nascimento: parsed.data.data_nascimento,
    email: parsed.data.email,
    celular: parsed.data.celular,
    cep: parsed.data.cep,
    rua: parsed.data.rua,
    numero: parsed.data.numero,
    complemento: parsed.data.complemento,
    bairro: parsed.data.bairro,
    cidade: parsed.data.cidade,
    cnpj: parsed.data.cnpj,
    razao_social: parsed.data.razao_social,
    tipo_pagamento: parsed.data.tipo_pagamento,
    banco: parsed.data.banco,
    agencia: parsed.data.agencia,
    conta: parsed.data.conta,
    // Decisão 212: o tipo de conta e o tipo da chave (a chave já no formato
    // do banco, normalizada pelo schema).
    tipo_conta: parsed.data.tipo_conta ?? null,
    pix_chave: parsed.data.pix_chave,
    pix_tipo: parsed.data.pix_tipo ?? null,
  };

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc(
    "cadastrar_freelancer_via_solicitacao",
    {
      p_token: params.token,
      p_freelancer: payload,
    },
  );

  if (error) {
    console.error("[public.submit]", error.message);
    // Mapeia os códigos custom do plpgsql pra mensagens amigáveis
    const msg = error.message ?? "";
    if (msg.includes("Link expirado")) {
      return NextResponse.json({ error: "Link expirado" }, { status: 410 });
    }
    if (msg.includes("não está aprovada")) {
      return NextResponse.json(
        { error: "Solicitação não está mais aprovada" },
        { status: 409 },
      );
    }
    if (msg.includes("Solicitação não encontrada")) {
      return NextResponse.json(
        { error: "Solicitação não encontrada" },
        { status: 404 },
      );
    }
    if (msg.includes("Job vinculado")) {
      return NextResponse.json(
        {
          error:
            "O job vinculado à solicitação não existe mais. Fale com o RH pra criar uma nova.",
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "Falha ao processar: " + msg },
      { status: 500 },
    );
  }

  const first = Array.isArray(data) ? data[0] : data;
  const freelancerId = first?.freelancer_id as string | undefined;
  const contratoId = first?.contrato_id as string | undefined;
  const jaExistia = (first?.freelancer_ja_existia as boolean | undefined) ?? false;

  if (freelancerId) {
    // Precisamos do tenant_id pro audit log, mas não temos session.
    // Vamos buscar da solicitação (service client).
    const { data: solData } = await supabase
      .from("freelancer_solicitacoes")
      .select("id, tenant_id")
      .eq("token", params.token)
      .maybeSingle();
    const sol = solData as { id: string; tenant_id: string } | null;

    if (sol) {
      await logAuditEvent({
        acao: "freelancer.cadastrado_via_solicitacao",
        tenantId: sol.tenant_id,
        entidadeTipo: "freelancer",
        entidadeId: freelancerId,
        metadata: {
          solicitacao_id: sol.id,
          contrato_id: contratoId,
          freelancer_ja_existia: jaExistia,
        },
      });
    }
  }

  return NextResponse.json({
    ok: true,
    freelancer_id: freelancerId,
    contrato_id: contratoId,
    ja_existia: jaExistia,
  });
}
