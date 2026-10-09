"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { checarPermissao } from "@/lib/permissoes-server";
import { pode } from "@/lib/permissoes";
import {
  cadastroFiscalSchema,
  fornecedorSchema,
  fornecedorCompletoSchema,
  fornecedorVeiculoSchema,
} from "@/lib/validations/fornecedores";
import { getBancoByCodigo } from "@/lib/dados/bancos-febraban";
import type { Fornecedor } from "@/lib/types";
import {
  COLUNAS_DE_PAGAMENTO,
  type DadosDePagamento,
} from "@/lib/data/foto-pagamento-da-pp";
import { onlyDigits } from "@/lib/utils";
import { normalizarChavePix } from "@/lib/pix";
import type { PixTipoChave } from "@/lib/types";
import {
  BUCKET_DO_FORNECEDOR,
  caminhoDaDeclaracao,
  cadastroSemRevisao,
  declaracaoDoTenant,
  pendenciasDoCadastroFiscal,
  recusaDoArquivoDaDeclaracao,
} from "@/lib/fiscal/regime-do-fornecedor";

/** O que o combo de fornecedor precisa saber de um cadastro — é o que o
 *  cadastro rápido devolve para a PP selecionar sem esperar o refresh. */
export interface FornecedorResumo {
  id: string;
  nome: string;
  razao_social: string | null;
  status: "ativo" | "inativo";
  /** O documento entrou em 09/09/2026: o campo de fornecedor da PP mostra
   *  e busca por ele, e o recém-criado precisa aparecer igual aos outros. */
  cpf_cnpj?: string | null;
}

export type ActionResult =
  | { ok: true; id?: string; fornecedor?: FornecedorResumo }
  | {
      ok: false;
      message: string;
      fieldErrors?: Record<string, string[]>;
      /** O documento já pertence a este cadastro (04/09/2026). A tela
       *  oferece selecioná-lo em vez de criar outro. */
      duplicado?: FornecedorResumo;
      /** Os dados de pagamento mudaram e este fornecedor tem PP no
       *  financeiro (decisão 067). Não é erro: a tela mostra o "tem
       *  certeza?" e reenvia com `confirmarComPPsNoFinanceiro`. */
      pedeConfirmacaoPagamento?: {
        /** Quantas PPs dele estão no financeiro agora. */
        pps: number;
        /** Os códigos, para o aviso citar (no máximo 5). */
        codigos: string[];
      };
    };

function extractInput(formData: FormData) {
  return {
    // Campos existentes
    tipo_pessoa: formData.get("tipo_pessoa"),
    nome: formData.get("nome"),
    razao_social: formData.get("razao_social"),
    cpf_cnpj: formData.get("cpf_cnpj"),
    email: formData.get("email"),
    telefone: formData.get("telefone"),
    observacoes: formData.get("observacoes"),

    // Endereço
    cep: formData.get("cep"),
    logradouro: formData.get("logradouro"),
    numero: formData.get("numero"),
    complemento: formData.get("complemento"),
    bairro: formData.get("bairro"),
    cidade: formData.get("cidade"),
    uf: formData.get("uf"),

    // Banco
    banco_codigo: formData.get("banco_codigo"),
    agencia: formData.get("agencia"),
    agencia_dv: formData.get("agencia_dv"),
    conta: formData.get("conta"),
    conta_dv: formData.get("conta_dv"),
    tipo_conta: formData.get("tipo_conta"),

    // PIX
    pix_tipo: formData.get("pix_tipo"),
    pix_chave: formData.get("pix_chave"),
    // Decisão 161: "Sem conta nem PIX" (ausente = não mexe).
    sem_dados_pagamento: formData.get("sem_dados_pagamento"),

    // Módulo fiscal (02/10/2026): regime tributário da pessoa jurídica
    regime_tributario: formData.get("regime_tributario"),
    regime_consultado_em: formData.get("regime_consultado_em"),
    declaracao_simples_recebida: formData.get("declaracao_simples_recebida"),
    // Decisão 142: a consulta do CNPJ inteira e o arquivo da declaração
    // (ausente = `null` do FormData = não mexe no arquivo).
    regime_consulta: formData.get("regime_consulta"),
    regime_desde: formData.get("regime_desde"),
    declaracao_simples_path: formData.get("declaracao_simples_path"),
    // Decisão 166: o CNAE da pessoa jurídica.
    cnae: formData.get("cnae"),
  };
}

/** O arquivo da declaração que veio da tela é da pasta do tenant da sessão?
 *  (O bucket já barra o resto pela RLS; aqui é o que vai para a coluna.) */
function arquivoDaDeclaracaoInvalido(
  path: string | null | undefined,
  tenantId: string,
): ActionResult | null {
  if (!path || declaracaoDoTenant(path, tenantId)) return null;
  return {
    ok: false,
    message: "Arquivo da declaração inválido. Anexe o arquivo de novo.",
    fieldErrors: { declaracao_simples_path: ["Anexe o arquivo de novo."] },
  };
}

/**
 * Tira do bucket os arquivos de declaração que subiram e não foram gravados
 * (formulário fechado sem salvar, arquivo trocado ou tirado antes de
 * salvar). O que algum cadastro aponta nunca sai daqui, nem se a tela pedir
 * — a tela pode achar que não gravou quando gravou. Melhor esforço: a falha
 * só vai ao log.
 */
async function removerDeclaracoesSoltas(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  paths: unknown[],
): Promise<void> {
  const candidatos = Array.from(
    new Set(
      paths.filter(
        (p): p is string => typeof p === "string" && declaracaoDoTenant(p, tenantId),
      ),
    ),
  ).slice(0, 20);
  if (candidatos.length === 0) return;

  const { data, error } = await supabase
    .from("fornecedores")
    .select("declaracao_simples_path")
    .eq("tenant_id", tenantId)
    .in("declaracao_simples_path", candidatos);
  if (error) {
    // Na dúvida, não apaga.
    console.error("[fornecedores.declaracao.conferir]", error.message);
    return;
  }
  const apontados = new Set(
    ((data ?? []) as Array<{ declaracao_simples_path: string | null }>).map(
      (r) => r.declaracao_simples_path,
    ),
  );
  const soltos = candidatos.filter((p) => !apontados.has(p));
  if (soltos.length === 0) return;

  const { error: erroAoRemover } = await supabase.storage
    .from(BUCKET_DO_FORNECEDOR)
    .remove(soltos);
  if (erroAoRemover) {
    console.error("[fornecedores.declaracao.remover]", erroAoRemover.message);
  }
}

function deriveBancoNome(
  banco_codigo: string | null | undefined,
): { ok: true; banco_nome: string | null } | { ok: false; message: string } {
  if (!banco_codigo) return { ok: true, banco_nome: null };
  const banco = getBancoByCodigo(banco_codigo);
  if (!banco) return { ok: false, message: "Banco selecionado é inválido." };
  return { ok: true, banco_nome: banco.nome };
}

function mapDbError(msg: string): string {
  if (msg.includes("uniq_fornecedores_documento_por_tenant")) {
    return "Já existe um fornecedor com este documento neste tenant.";
  }
  if (msg.includes("fornecedores_documento_formato")) {
    return "Documento não confere com o tipo de pessoa selecionado.";
  }
  return "Não foi possível salvar. Tente novamente.";
}

/**
 * O miolo de criar um fornecedor: valida, deriva banco e PIX, insere e
 * audita. Dois callers — a página de cadastro (que redireciona) e o
 * cadastro rápido de dentro da PP (que devolve o registro para a tela
 * selecionar). O que muda entre eles é só o schema e o que fazer depois.
 */
/**
 * Quem cria fornecedor: a tela (`cadastros.fornecedores.editar`, admin e
 * financeiro desde 07/10/2026) ou o cadastro rápido de dentro da PP
 * (`.inline`, admin, GP, produtor e freelancer). Vale também para subir o
 * arquivo da declaração e para marcar um fornecedor como veículo.
 */
async function checarCriarFornecedor(
  session: Awaited<ReturnType<typeof requireSession>>,
): ReturnType<typeof checarPermissao> {
  if (pode(session.activeRole, "cadastros.fornecedores.editar")) return { ok: true };
  return checarPermissao(session, "cadastros.fornecedores.inline");
}

async function inserirFornecedor(
  formData: FormData,
  schema:
    | typeof fornecedorSchema
    | typeof fornecedorCompletoSchema
    | typeof fornecedorVeiculoSchema,
  origem: "cadastro" | "pp" | "midia",
): Promise<ActionResult> {
  const session = await requireSession();
  // Cobre os dois callers do miolo: a tela /fornecedores/novo (criarFornecedor)
  // e o cadastro rapido dentro do PP (criarFornecedorRapido, decisao 048).
  // Libera quem tem a tela (admin e financeiro) ou o inline (admin, GP,
  // produtor e freelancer).
  const gate = await checarCriarFornecedor(session);
  if (!gate.ok) return gate;
  const parsed = schema.safeParse(extractInput(formData));

  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const bancoResult = deriveBancoNome(parsed.data.banco_codigo);
  if (!bancoResult.ok) {
    return { ok: false, message: bancoResult.message };
  }

  const arquivoInvalido = arquivoDaDeclaracaoInvalido(
    parsed.data.declaracao_simples_path,
    session.activeTenant.id,
  );
  if (arquivoInvalido) return arquivoInvalido;

  const pix_chave_normalizada = normalizarChavePix(
    parsed.data.pix_tipo,
    parsed.data.pix_chave,
  );

  const supabase = createClient();

  // Documento repetido: a conferência ANTES do insert devolve quem já tem
  // o documento, para a tela oferecer selecioná-lo (04/09/2026). O índice
  // único `uniq_fornecedores_documento_por_tenant` continua sendo a
  // garantia — se dois cadastros correrem ao mesmo tempo, o segundo cai
  // no `mapDbError` abaixo.
  if (parsed.data.cpf_cnpj) {
    const existente = await buscarPorDocumento(
      supabase,
      session.activeTenant.id,
      parsed.data.cpf_cnpj,
    );
    if (existente) {
      return {
        ok: false,
        message: `Já existe um fornecedor com este ${
          parsed.data.tipo_pessoa === "fisica" ? "CPF" : "CNPJ"
        }: ${existente.razao_social ?? existente.nome}.`,
        fieldErrors: { cpf_cnpj: ["Documento já cadastrado."] },
        duplicado: existente,
      };
    }
  }

  const { data, error } = await supabase
    .from("fornecedores")
    .insert({
      ...parsed.data,
      banco_nome: bancoResult.banco_nome,
      pix_chave: pix_chave_normalizada,
      tenant_id: session.activeTenant.id,
      created_by: session.profile.id,
    })
    .select("id, nome, razao_social, status, cpf_cnpj")
    .single();

  if (error) {
    console.error("[fornecedores.criar]", error.message);
    return { ok: false, message: mapDbError(error.message) };
  }

  await logAuditEvent({
    acao: "fornecedor.criado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "fornecedor",
    entidadeId: data.id,
    metadata: {
      nome: parsed.data.nome,
      tipo_pessoa: parsed.data.tipo_pessoa,
      origem,
      // Módulo fiscal: o regime decide a retenção na aprovação da PP.
      regime_tributario: parsed.data.regime_tributario,
      regime_consulta: parsed.data.regime_consulta,
      cnae: parsed.data.cnae,
      declaracao_simples_anexada: Boolean(parsed.data.declaracao_simples_path),
      // Decisão 161: sem conta nem PIX — a PP pede boleto ou chave aleatória.
      sem_dados_pagamento: parsed.data.sem_dados_pagamento === true,
    },
  });

  revalidatePath("/fornecedores");
  return {
    ok: true,
    id: data.id,
    fornecedor: {
      id: data.id,
      nome: data.nome,
      razao_social: data.razao_social ?? null,
      status: data.status as FornecedorResumo["status"],
    },
  };
}

async function buscarPorDocumento(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  documento: string,
  excludeId?: string,
): Promise<FornecedorResumo | null> {
  let query = supabase
    .from("fornecedores")
    .select("id, nome, razao_social, status, cpf_cnpj")
    .eq("tenant_id", tenantId)
    .eq("cpf_cnpj", documento)
    .limit(1);
  if (excludeId) query = query.neq("id", excludeId);
  const { data, error } = await query.maybeSingle();
  if (error || !data) return null;
  return {
    id: data.id,
    nome: data.nome,
    razao_social: data.razao_social ?? null,
    status: data.status as FornecedorResumo["status"],
  };
}

export async function criarFornecedor(
  formData: FormData,
): Promise<ActionResult> {
  const res = await inserirFornecedor(formData, fornecedorSchema, "cadastro");
  if (!res.ok) return res;
  redirect("/fornecedores");
}

/**
 * Cadastro rápido de dentro do formulário de PP (04/09/2026, decisão 048).
 *
 * Exige documento, e-mail, telefone e um meio de pagamento
 * (`fornecedorCompletoSchema`) e devolve o registro criado, sem
 * redirecionar: quem chamou seleciona o fornecedor no combo e segue com
 * a PP.
 */
export async function criarFornecedorRapido(
  formData: FormData,
): Promise<ActionResult> {
  return inserirFornecedor(formData, fornecedorCompletoSchema, "pp");
}

/**
 * Já existe fornecedor com este CPF/CNPJ neste tenant? A tela pergunta
 * ao sair do campo, antes de a pessoa preencher o resto do cadastro.
 * Inativo também conta: o documento é um só, e o caminho é reativar.
 */
/**
 * O cadastro inteiro de um fornecedor, para o lápis do campo da PP abrir
 * o formulário completo (09/09/2026). A lista que o drawer carrega tem só
 * id, nome, razão social e documento — o suficiente para escolher, não
 * para editar.
 */
export async function carregarFornecedor(
  id: string,
): Promise<{ ok: true; fornecedor: Fornecedor } | { ok: false; message: string }> {
  const session = await requireSession();
  const supabase = createClient();
  const { data, error } = await supabase
    .from("fornecedores")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<Fornecedor>();

  if (error || !data) {
    console.error("[fornecedores.carregar]", error?.message);
    return { ok: false, message: "Fornecedor não encontrado." };
  }
  return { ok: true, fornecedor: data };
}

export async function buscarFornecedorPorDocumento(
  documento: string,
  excludeId?: string,
): Promise<{ existe: true; fornecedor: FornecedorResumo } | { existe: false }> {
  const digits = onlyDigits(documento ?? "");
  if (digits.length !== 11 && digits.length !== 14) return { existe: false };
  const session = await requireSession();
  const supabase = createClient();
  const existente = await buscarPorDocumento(
    supabase,
    session.activeTenant.id,
    digits,
    excludeId,
  );
  return existente ? { existe: true, fornecedor: existente } : { existe: false };
}

/**
 * "Este fornecedor tem PP no financeiro e você mexeu na conta dele" —
 * o aviso da decisão 067.
 *
 * Devolve `null` quando não há o que avisar: ou os nove campos de
 * pagamento continuam iguais, ou nenhuma PP dele está no financeiro.
 *
 * As PPs que contam são as que saíram do job e ainda vivem lá:
 * `em_avaliacao`, `aprovada` e `pago`. `gerada` não conta — ela ainda é
 * do produtor e re-tira a foto quando for editada ou enviada; `cancelada`
 * e `rejeitada` também não, porque ninguém vai pagar por elas.
 */
async function avisarSePagamentoMudouComPPsNoFinanceiro(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  fornecedorId: string,
  novos: DadosDePagamento,
): Promise<ActionResult | null> {
  const { data: atual } = await supabase
    .from("fornecedores")
    .select(COLUNAS_DE_PAGAMENTO)
    .eq("id", fornecedorId)
    .eq("tenant_id", tenantId)
    .maybeSingle<DadosDePagamento>();

  if (!atual) return null;

  const mudou = (Object.keys(novos) as Array<keyof DadosDePagamento>).some(
    (campo) => (novos[campo] ?? null) !== (atual[campo] ?? null),
  );
  if (!mudou) return null;

  const { data: pps } = await supabase
    .from("pedidos_compra")
    .select("codigo")
    .eq("tenant_id", tenantId)
    .eq("fornecedor_id", fornecedorId)
    .in("status", ["em_avaliacao", "aprovada", "pago"])
    .order("codigo");

  const codigos = ((pps ?? []) as Array<{ codigo: string }>).map((p) => p.codigo);
  if (codigos.length === 0) return null;

  return {
    ok: false,
    message:
      codigos.length === 1
        ? `${codigos[0]} já está no financeiro e vai ser paga pelos dados que ela guardou. A conta nova vale para as próximas PPs.`
        : `${codigos.length} PPs deste fornecedor já estão no financeiro e vão ser pagas pelos dados que guardaram. A conta nova vale para as próximas.`,
    pedeConfirmacaoPagamento: { pps: codigos.length, codigos: codigos.slice(0, 5) },
  };
}

/** O arquivo da declaração que o cadastro aponta hoje. */
async function arquivoDaDeclaracaoGravado(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  fornecedorId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("fornecedores")
    .select("declaracao_simples_path")
    .eq("id", fornecedorId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ declaracao_simples_path: string | null }>();
  return data?.declaracao_simples_path ?? null;
}

export async function atualizarFornecedor(
  id: string,
  formData: FormData,
  /** O usuário já viu o aviso das PPs no financeiro e mandou salvar. */
  confirmarComPPsNoFinanceiro = false,
): Promise<ActionResult> {
  return atualizarComSchema(id, formData, confirmarComPPsNoFinanceiro, fornecedorSchema);
}

/** O miolo da edição. O schema é o do fornecedor de sempre ou o do veículo
 *  de mídia (decisão 147), que não exige conta. Não exportada: todo export
 *  async de arquivo "use server" vira Server Action. */
async function atualizarComSchema(
  id: string,
  formData: FormData,
  confirmarComPPsNoFinanceiro: boolean,
  schema: typeof fornecedorSchema | typeof fornecedorVeiculoSchema,
): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "cadastros.fornecedores.editar");
  if (!gate.ok) return gate;
  const parsed = schema.safeParse(extractInput(formData));

  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const bancoResult = deriveBancoNome(parsed.data.banco_codigo);
  if (!bancoResult.ok) {
    return { ok: false, message: bancoResult.message };
  }

  const tenantId = session.activeTenant.id;
  const arquivoInvalido = arquivoDaDeclaracaoInvalido(
    parsed.data.declaracao_simples_path,
    tenantId,
  );
  if (arquivoInvalido) return arquivoInvalido;

  const pix_chave_normalizada = normalizarChavePix(
    parsed.data.pix_tipo,
    parsed.data.pix_chave,
  );

  const supabase = createClient();

  // O "tem certeza?" dos dados de pagamento (decisão 067).
  //
  // Trocar banco, agência, conta ou PIX de um fornecedor que já tem PP no
  // financeiro NÃO muda aquelas PPs — elas pagam pela foto que tiraram
  // (`lib/data/foto-pagamento-da-pp.ts`). Justamente por isso o aviso
  // existe: quem edita costuma estar tentando corrigir a conta de uma PP
  // que está prestes a ser paga, e precisa saber que o conserto vale só
  // para as próximas.
  //
  // Junto, o arquivo da declaração gravado até aqui (decisão 142), para o
  // audit dizer se ele foi anexado, trocado ou tirado.
  const arquivoDepois = parsed.data.declaracao_simples_path;
  const [aviso, arquivoAntes] = await Promise.all([
    confirmarComPPsNoFinanceiro
      ? Promise.resolve(null)
      : avisarSePagamentoMudouComPPsNoFinanceiro(supabase, tenantId, id, {
          banco_codigo: parsed.data.banco_codigo ?? null,
          banco_nome: bancoResult.banco_nome ?? null,
          agencia: parsed.data.agencia ?? null,
          agencia_dv: parsed.data.agencia_dv ?? null,
          conta: parsed.data.conta ?? null,
          conta_dv: parsed.data.conta_dv ?? null,
          tipo_conta: parsed.data.tipo_conta ?? null,
          pix_tipo: parsed.data.pix_tipo ?? null,
          pix_chave: pix_chave_normalizada ?? null,
        }),
    arquivoDepois === undefined
      ? Promise.resolve(null)
      : arquivoDaDeclaracaoGravado(supabase, tenantId, id),
  ]);
  if (aviso) return aviso;

  const { error } = await supabase
    .from("fornecedores")
    .update({
      ...parsed.data,
      banco_nome: bancoResult.banco_nome,
      pix_chave: pix_chave_normalizada,
    })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[fornecedores.atualizar]", error.message);
    return { ok: false, message: mapDbError(error.message) };
  }

  // O arquivo da declaração trocado ou tirado sai do cadastro e FICA no
  // bucket, como a guia gravada nos impostos: o que foi gravado não se
  // apaga daqui — a declaração é o comprovante da falta de retenção nas
  // PPs pagas enquanto ela valia. O caminho antigo vai para o audit.
  const arquivoMudou = arquivoDepois !== undefined && arquivoDepois !== arquivoAntes;

  await logAuditEvent({
    acao: "fornecedor.editado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "fornecedor",
    entidadeId: id,
    metadata: {
      confirmado_com_pps_no_financeiro: confirmarComPPsNoFinanceiro,
      // Módulo fiscal: o regime decide a retenção na aprovação da PP.
      regime_tributario: parsed.data.regime_tributario,
      regime_consulta: parsed.data.regime_consulta,
      cnae: parsed.data.cnae,
      // Decisão 161 (ausente = a tela não mandou, a marcação não mudou).
      ...(parsed.data.sem_dados_pagamento !== undefined && {
        sem_dados_pagamento: parsed.data.sem_dados_pagamento,
      }),
      ...(arquivoMudou && {
        declaracao_simples_arquivo: !arquivoDepois
          ? "retirado"
          : arquivoAntes
            ? "trocado"
            : "anexado",
        declaracao_simples_path_anterior: arquivoAntes,
      }),
    },
  });

  revalidatePath("/fornecedores");
  revalidatePath(`/fornecedores/${id}`);
  return { ok: true, id };
}

// ---------------------------------------------------------------------------
// Decisão 166: regime e CNAE para gerar PP
// ---------------------------------------------------------------------------

/**
 * O que falta no cadastro do fornecedor para gerar PP: o regime (o legado
 * "Lucro Real ou Presumido" conta como falta) e o CNAE, na pessoa jurídica.
 * O formulário da PP pergunta ao escolher o fornecedor e de novo depois de
 * cada edição do cadastro; `gerarPPDaPPAEmitir` confere no servidor.
 */
export async function pendenciasDoCadastroDoFornecedor(
  id: string,
): Promise<{ ok: true; falta: string[] } | { ok: false; message: string }> {
  const session = await requireSession();
  const supabase = createClient();
  const { data, error } = await supabase
    .from("fornecedores")
    .select("tipo_pessoa, regime_tributario, cnae")
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ tipo_pessoa: string; regime_tributario: string | null; cnae: string | null }>();
  if (error || !data) return { ok: false, message: "Fornecedor não encontrado." };
  return { ok: true, falta: pendenciasDoCadastroFiscal(data) };
}

/**
 * O lápis do campo Fornecedor da PP, para quem gera PP e não edita
 * fornecedor (GP, produtor e freelancer): o cadastro inteiro aparece, mas
 * só o regime e o CNAE se gravam — o resto continua com o financeiro. E só
 * enquanto o cadastro estiver pendente (sem CNAE, sem regime ou com o
 * legado): cadastro completo, só quem edita fornecedor altera.
 */
export async function completarCadastroFiscalDoFornecedor(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarCriarFornecedor(session);
  if (!gate.ok) return gate;

  const parsed = cadastroFiscalSchema.safeParse({
    regime_tributario: formData.get("regime_tributario"),
    cnae: formData.get("cnae"),
    regime_consulta: formData.get("regime_consulta"),
    regime_desde: formData.get("regime_desde"),
    regime_consultado_em: formData.get("regime_consultado_em"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const tenantId = session.activeTenant.id;
  const supabase = createClient();
  const { data: antes, error: erroAoLer } = await supabase
    .from("fornecedores")
    .select("tipo_pessoa, regime_tributario, cnae")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ tipo_pessoa: string; regime_tributario: string | null; cnae: string | null }>();
  if (erroAoLer || !antes) return { ok: false, message: "Fornecedor não encontrado." };
  if (antes.tipo_pessoa !== "juridica") {
    return { ok: false, message: "Pessoa física não tem regime tributário nem CNAE." };
  }
  if (!cadastroSemRevisao(antes) && pendenciasDoCadastroFiscal(antes).length === 0) {
    return {
      ok: false,
      message: "O cadastro deste fornecedor já está completo. Para alterá-lo, fale com o financeiro.",
    };
  }

  const { error } = await supabase
    .from("fornecedores")
    .update(parsed.data)
    .eq("id", id)
    .eq("tenant_id", tenantId);
  if (error) {
    console.error("[fornecedores.completar]", error.message);
    return { ok: false, message: "Não foi possível salvar. Tente novamente." };
  }

  await logAuditEvent({
    acao: "fornecedor.editado",
    tenantId,
    entidadeTipo: "fornecedor",
    entidadeId: id,
    metadata: {
      acao: "cadastro_fiscal_completado",
      regime_tributario_antes: antes.regime_tributario,
      regime_tributario: parsed.data.regime_tributario,
      cnae: parsed.data.cnae,
      regime_consulta: parsed.data.regime_consulta,
    },
  });

  revalidatePath("/fornecedores");
  revalidatePath(`/fornecedores/${id}`);
  return { ok: true, id };
}

// ---------------------------------------------------------------------------
// Veículo de mídia (decisões 147 e 150)
//
// O veículo é um fornecedor — é ele que recebe o PI, emite a nota e, no
// A · Repasse, recebe a PP — marcado como veículo em `veiculos_midia`. O
// cadastro é o formulário do fornecedor com o pagamento opcional: a conta só
// vai ser exigida para gerar a PP do repasse. Desde a decisão 150 o cadastro
// não pede meio nem praça: os meios vêm do uso nas planilhas
// (`vw_veiculos_meios_usados`), e a praça fica na linha. As actions abaixo só
// marcam o fornecedor como veículo.
// ---------------------------------------------------------------------------

/** Quem chama: o pop-up da planilha de mídia ou a tela Cadastros › Veículos. */
type OrigemDoVeiculo = "midia" | "cadastro";

function revalidarVeiculos(id?: string) {
  revalidatePath("/cadastros");
  revalidatePath("/cadastros/veiculos");
  if (id) revalidatePath(`/cadastros/veiculos/${id}`);
}

/** Marca o fornecedor como veículo. Quem já é fica como está (a linha de
 *  `veiculos_midia` guarda quem a criou); `criado` diz se a marca é nova. */
async function marcarComoVeiculo(
  tenantId: string,
  profileId: string,
  fornecedorId: string,
): Promise<{ erro: string | null; criado: boolean }> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("veiculos_midia")
    .upsert(
      { tenant_id: tenantId, fornecedor_id: fornecedorId, created_by: profileId },
      { onConflict: "fornecedor_id", ignoreDuplicates: true },
    )
    .select("id");
  if (error) {
    console.error("[fornecedores.veiculo]", error.message);
    return { erro: error.message, criado: false };
  }
  return { erro: null, criado: (data ?? []).length > 0 };
}

/** O "Novo veículo": o fornecedor e a marca de veículo. Pela tela de
 *  Cadastros, volta para a lista, como o "Novo fornecedor". */
export async function criarVeiculoFornecedor(
  formData: FormData,
  origem: OrigemDoVeiculo = "midia",
): Promise<ActionResult> {
  const deOnde: OrigemDoVeiculo = origem === "cadastro" ? "cadastro" : "midia";
  const res = await inserirFornecedor(formData, fornecedorVeiculoSchema, deOnde === "midia" ? "midia" : "cadastro");
  if (!res.ok || !res.id) return res;

  const session = await requireSession();
  const { erro } = await marcarComoVeiculo(session.activeTenant.id, session.profile.id, res.id);
  if (erro) {
    return {
      ok: false,
      message:
        "O fornecedor foi cadastrado, mas não foi marcado como veículo. Busque-o pelo CNPJ no cadastro de veículos para marcar de novo.",
    };
  }
  await logAuditEvent({
    acao: "veiculo_midia.criado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "fornecedor",
    entidadeId: res.id,
    metadata: { origem: deOnde },
  });
  revalidarVeiculos();
  if (deOnde === "cadastro") redirect("/cadastros/veiculos");
  return res;
}

/** A edição do cadastro do veículo (o lápis da planilha ou a tela do
 *  veículo). Só para quem já é veículo — o pagamento opcional não vale para
 *  o fornecedor comum. */
export async function atualizarVeiculoFornecedor(
  id: string,
  formData: FormData,
  confirmarComPPsNoFinanceiro = false,
): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = createClient();
  const { data: atual } = await supabase
    .from("veiculos_midia")
    .select("id")
    .eq("fornecedor_id", id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ id: string }>();
  if (!atual) {
    return { ok: false, message: "Este fornecedor não é um veículo de mídia." };
  }

  const res = await atualizarComSchema(
    id,
    formData,
    confirmarComPPsNoFinanceiro,
    fornecedorVeiculoSchema,
  );
  if (res.ok) revalidarVeiculos(id);
  return res;
}

/** O documento digitado já era de um fornecedor: escolhê-lo como veículo
 *  só o marca, sem mexer no cadastro. */
export async function marcarFornecedorComoVeiculo(fornecedorId: string): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarCriarFornecedor(session);
  if (!gate.ok) return gate;

  const supabase = createClient();
  const { data: fornecedor } = await supabase
    .from("fornecedores")
    .select("id, status")
    .eq("id", fornecedorId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ id: string; status: string }>();
  if (!fornecedor) return { ok: false, message: "Fornecedor não encontrado." };
  if (fornecedor.status !== "ativo") {
    return { ok: false, message: "Este fornecedor está inativo. Reative o cadastro antes." };
  }

  const { erro, criado } = await marcarComoVeiculo(session.activeTenant.id, session.profile.id, fornecedorId);
  if (erro) return { ok: false, message: "Não foi possível marcar o fornecedor como veículo." };
  if (criado) {
    await logAuditEvent({
      acao: "veiculo_midia.criado",
      tenantId: session.activeTenant.id,
      entidadeTipo: "fornecedor",
      entidadeId: fornecedorId,
      metadata: { origem: "existente" },
    });
  }
  revalidarVeiculos(fornecedorId);
  return { ok: true, id: fornecedorId };
}

export async function verificarPixDuplicado(
  chave: string,
  pixTipo: PixTipoChave | null,
  excludeId?: string,
): Promise<{ existe: true; id: string; nome: string } | { existe: false }> {
  const chaveLimpa =
    pixTipo && chave
      ? normalizarChavePix(pixTipo, chave) ?? chave.trim()
      : chave.trim();
  if (!chaveLimpa) return { existe: false };

  const supabase = createClient();

  let query = supabase
    .from("fornecedores")
    .select("id, nome")
    .eq("pix_chave", chaveLimpa)
    .eq("status", "ativo")
    .limit(1);

  if (excludeId) {
    query = query.neq("id", excludeId);
  }

  const { data, error } = await query.maybeSingle();
  if (error || !data) return { existe: false };
  return { existe: true, id: data.id, nome: data.nome };
}

export async function inativarFornecedor(id: string): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "cadastros.fornecedores.editar");
  if (!gate.ok) return gate;
  const supabase = createClient();

  const { error } = await supabase
    .from("fornecedores")
    .update({ status: "inativo" })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[fornecedores.inativar]", error.message);
    return { ok: false, message: "Não foi possível inativar." };
  }

  await logAuditEvent({
    acao: "fornecedor.inativado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "fornecedor",
    entidadeId: id,
  });

  revalidatePath("/fornecedores");
  // O veículo é o mesmo cadastro: a lista de Veículos inativa por aqui.
  revalidarVeiculos(id);
  return { ok: true, id };
}

export async function reativarFornecedor(id: string): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "cadastros.fornecedores.editar");
  if (!gate.ok) return gate;
  const supabase = createClient();

  const { error } = await supabase
    .from("fornecedores")
    .update({ status: "ativo" })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[fornecedores.reativar]", error.message);
    return { ok: false, message: "Não foi possível reativar." };
  }

  await logAuditEvent({
    acao: "fornecedor.editado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "fornecedor",
    entidadeId: id,
    metadata: { acao: "reativado" },
  });

  revalidatePath("/fornecedores");
  revalidarVeiculos(id);
  return { ok: true, id };
}

// ---------------------------------------------------------------------------
// O arquivo da declaração de optante do Simples (decisão 142)
// ---------------------------------------------------------------------------
//
// O arquivo sobe do navegador direto para o bucket privado `fornecedores`
// (10 MB; PDF, PNG ou JPEG), no padrão da planilha importada (decisão 110):
// o caminho nasce aqui, com o tenant da sessão — é a pasta que a policy de
// INSERT libera —, e o arquivo não passa pelo corpo da Server Action (o
// Next corta em 1 MB). Quem grava o caminho no cadastro é `criar…`/
// `atualizarFornecedor`, que conferem de novo que ele é da pasta do tenant.

/** Reserva o caminho `<tenant>/declaracoes/<uuid>-<nome>` para o navegador
 *  subir o arquivo. O gate é o mais amplo do cadastro: quem cria (o "+" da
 *  PP) ou edita fornecedor (a tela, com o financeiro desde 07/10/2026). */
export async function reservarArquivoDaDeclaracao(input: {
  nome: string;
  tamanho: number;
  tipo: string;
}): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  const session = await requireSession();
  const gate = await checarCriarFornecedor(session);
  if (!gate.ok) return gate;
  const nome = String(input?.nome ?? "");
  const recusa = recusaDoArquivoDaDeclaracao(
    nome,
    Number(input?.tamanho ?? 0),
    String(input?.tipo ?? ""),
  );
  if (recusa) return { ok: false, message: recusa };
  return {
    ok: true,
    path: caminhoDaDeclaracao(session.activeTenant.id, crypto.randomUUID(), nome),
  };
}

/** URL assinada (10 minutos) para abrir o arquivo da declaração. Lê com a
 *  sessão de quem pede: a policy do bucket é a de `fornecedores` (qualquer
 *  membro do tenant). */
export async function urlDaDeclaracaoSimples(
  path: string,
): Promise<{ ok: true; url: string } | { ok: false; message: string }> {
  const session = await requireSession();
  if (typeof path !== "string" || !declaracaoDoTenant(path, session.activeTenant.id)) {
    return { ok: false, message: "Arquivo não encontrado." };
  }
  const { data, error } = await createClient()
    .storage.from(BUCKET_DO_FORNECEDOR)
    .createSignedUrl(path, 60 * 10);
  if (error || !data) {
    console.error("[fornecedores.declaracao.url]", error?.message);
    return { ok: false, message: "Não foi possível abrir o arquivo." };
  }
  return { ok: true, url: data.signedUrl };
}

/** O formulário fechou sem salvar, ou trocou/tirou um arquivo que subiu e
 *  ainda não foi gravado: ele sai do bucket. Só sai o que nenhum cadastro
 *  aponta (`removerDeclaracoesSoltas`). */
export async function descartarArquivosDaDeclaracao(paths: string[]): Promise<void> {
  const session = await requireSession();
  await removerDeclaracoesSoltas(
    createClient(),
    session.activeTenant.id,
    Array.isArray(paths) ? paths : [],
  );
}
