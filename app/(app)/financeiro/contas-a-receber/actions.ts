"use server";

import { z } from "zod";
import { valorDaBaixaSchema } from "@/lib/validations/baixa-parcial";
import { rateioSchema } from "@/lib/validations/conta-avulsa";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";
import { PRIMEIRA_COMPETENCIA } from "@/lib/fiscal/apuracao";
import { codigoDoCnae } from "@/lib/fiscal/calculos";
import { guiasDaEmissaoParaConferir, type ApuracaoDaEmissao } from "@/lib/fiscal/faturar";

type Ok<T extends object = object> = { ok: true } & T;
type Err = { ok: false; message: string };
type Result<T extends object = object> = Ok<T> | Err;

async function checarGateFinanceiro(
  entidadeId: string,
  entidadeTipo: string,
  acaoTentada: string,
): Promise<
  | { ok: true; session: Awaited<ReturnType<typeof requireSession>>; supabase: ReturnType<typeof createClient> }
  | Err
> {
  const session = await requireSession();
  const supabase = createClient();
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo,
      entidadeId,
      metadata: { acao_tentada: acaoTentada, motivo: "sem_permissao_financeira" },
    });
    return { ok: false, message: "Apenas admin ou financeiro pode executar esta ação." };
  }
  return { ok: true, session, supabase };
}

// ---------------------------------------------------------------------------
// Upload NF PDF
// ---------------------------------------------------------------------------

export async function uploadNfPdf(formData: FormData): Promise<Result<{ path: string }>> {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    return { ok: false, message: "Apenas admin ou financeiro pode fazer upload." };
  }
  const supabase = createClient();

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { ok: false, message: "Arquivo inválido." };
  }
  if (file.size > 10 * 1024 * 1024) {
    return { ok: false, message: "Arquivo maior que 10 MB." };
  }
  if (file.type !== "application/pdf") {
    return { ok: false, message: "Apenas PDF é aceito." };
  }

  const tempId = crypto.randomUUID();
  const path = `${session.activeTenant.id}/${tempId}/nf.pdf`;

  const { error } = await supabase.storage
    .from("faturamentos-nf")
    .upload(path, file, { contentType: "application/pdf", upsert: false });

  if (error) return { ok: false, message: `Falha no upload: ${error.message}` };

  return { ok: true, path };
}

/** URL assinada para ver o PDF da NF dentro do drawer (modo leitura). */
export async function urlAnexoNf(path: string): Promise<Result<{ url: string }>> {
  const gate = await checarGateFinanceiro(path, "faturamento", "faturamento.anexo_lido");
  if (!gate.ok) return gate;

  const { data, error } = await gate.supabase.storage
    .from("faturamentos-nf")
    .createSignedUrl(path, 60 * 10);

  if (error || !data) {
    return { ok: false, message: "Não foi possível abrir o PDF da nota." };
  }
  return { ok: true, url: data.signedUrl };
}

// ---------------------------------------------------------------------------
// Emitir Faturamento
// ---------------------------------------------------------------------------

const parcelaSchema = z.object({
  numero: z.number().int().min(1),
  valor: z.number().positive(),
  data_vencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * Um item da nota: o job (ou BV) coberto, e por quanto.
 *
 * `envio_parcela_id` é o que amarra o item à parcela do envio — é ele que
 * faz o saldo baixar na linha certa da aba Faturamento.
 */
const itemSchema = z.object({
  // `save` só existe no ITEM, nunca no cabeçalho: a nota continua sendo
  // do job, e o que separa o faturamento próprio do saldo em save são os
  // itens (docs/decisions/028-save-entre-jobs.md).
  origem_tipo: z.enum(["job", "bv", "avulso", "save"]),
  origem_id: z.string().uuid().nullable(),
  envio_parcela_id: z.string().uuid().nullable(),
  valor: z.number().positive(),
});

const emitirSchema = z.object({
  empresa_id: z.string().uuid("Selecione a empresa (gerencial)."),
  // Módulo fiscal (02/10/2026): o CNPJ que emite a nota e o CNAE da lista
  // dele. Os dois se gravam pela `registrar_fiscal_da_nota`, logo depois da
  // emissão; o texto `cnae` continua indo junto, tirado do CNAE da lista.
  estabelecimento_id: z.string().uuid("Escolha o CNPJ emissor."),
  fiscal_cnae_id: z.string().uuid("Escolha o CNAE a ser utilizado na nota."),
  origem_tipo: z.enum(["job", "bv", "avulso"]),
  origem_id: z.string().uuid().nullable(),
  cliente_id: z.string().uuid().nullable(),
  fornecedor_id: z.string().uuid().nullable(),
  numero_nf: z.string().trim().min(1, "Informe o número da NF."),
  data_emissao: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data de emissão inválida."),
  valor_total: z.number().positive("O valor total da NF precisa ser maior que zero."),
  descricao: z.string().trim().min(3, "Escreva a descrição que vai na nota fiscal."),
  // Classificação fiscal da nota. Até 31/08/2026 era pedida à produção no
  // envio para faturamento; virou responsabilidade de quem emite a nota.
  // Desde o módulo fiscal (02/10/2026) vem da lista do CNPJ emissor: o
  // texto gravado é o código do CNAE da lista (`fiscal_cnae_id`), relido
  // abaixo — este campo só confirma que o formulário mandou algum.
  cnae: z
    .string()
    .trim()
    .min(1, "Informe o CNAE a ser utilizado na nota.")
    .max(120, "Máximo 120 caracteres."),
  anexo_nf_path: z.string().min(1, "Anexe o PDF da nota fiscal antes de emitir."),
  // Só o avulso informa (é o campo "Centro de custo" do formulário). Em
  // job/BV a classificação que vale é a da baixa do título.
  plano_conta_tipo_id: z.string().uuid().nullable(),
  plano_conta_subtipo_id: z.string().uuid().nullable(),
  itens: z.array(itemSchema).min(1, "A nota precisa cobrir ao menos um item."),
  parcelas: z.array(parcelaSchema).min(1, "A nota precisa de ao menos uma parcela."),
  // Rateio de regional da nota avulsa (decisão 086). A nota de job ou de BV
  // não leva: a receita fica na regional do job. A forma completa (regional
  // escolhida, soma 100, sem repetir) é conferida abaixo só para o avulso.
  rateio: z
    .array(z.object({ regional_id: z.string(), percentual: z.number() }))
    .default([]),
});

/** Hoje no fuso da casa (o servidor roda em UTC): o mesmo dia da aba Apuração. */
const hojeEmSaoPaulo = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

export async function emitirFaturamento(
  input: unknown,
): Promise<
  Result<{
    faturamento_id: string;
    /** A nota saiu, mas o CNPJ emissor e o CNAE não se registraram nela:
     *  o formulário mostra isto e não deixa emitir de novo. */
    avisoFiscal: string | null;
    /** O que o aviso depois de emitir precisa para dizer em que Apuração os
     *  impostos da nota entraram (`avisoDaApuracao`). Nulo sem o registro
     *  fiscal: a nota não entra na Apuração. */
    apuracao: ApuracaoDaEmissao | null;
  }>
> {
  const parsed = emitirSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };
  }
  const gate = await checarGateFinanceiro(
    parsed.data.origem_id ?? "",
    "faturamento",
    "faturamento.emitido",
  );
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  const d = parsed.data;

  // Coerência contraparte × origem (defensivo — a RPC e o CHECK também
  // validam, e é aqui que a mensagem sai legível).
  if (d.origem_tipo === "bv" && (!d.fornecedor_id || d.cliente_id)) {
    return { ok: false, message: "BV precisa de fornecedor (e não cliente)." };
  }
  if (
    (d.origem_tipo === "job" || d.origem_tipo === "avulso") &&
    (!d.cliente_id || d.fornecedor_id)
  ) {
    return { ok: false, message: "Job e avulso precisam de cliente (e não fornecedor)." };
  }
  if (d.origem_tipo === "avulso" && (!d.plano_conta_tipo_id || !d.plano_conta_subtipo_id)) {
    return { ok: false, message: "No faturamento avulso, informe o centro de custo." };
  }
  // A nota sem job não tem de onde tirar regional: o rateio vem com ela,
  // como na despesa sem job (082). A RPC confere de novo, com a empresa.
  if (d.origem_tipo === "avulso") {
    const rateio = rateioSchema.safeParse(d.rateio);
    if (!rateio.success) {
      return {
        ok: false,
        message: `Rateio de regional: ${rateio.error.issues[0]?.message ?? "a soma dos percentuais deve ser 100,00."}`,
      };
    }
  } else if (d.rateio.length > 0) {
    return {
      ok: false,
      message:
        "Só a nota avulsa leva rateio de regional: a nota de job ou de BV fica na regional do job.",
    };
  }

  // BV nunca entra em NF agrupada: a contraparte dele é o fornecedor.
  const bvs = d.itens.filter((i) => i.origem_tipo === "bv");
  if (bvs.length > 0 && d.itens.length > 1) {
    return {
      ok: false,
      message:
        "BV tem o fornecedor como contraparte e precisa ser faturado individualmente.",
    };
  }

  const somaItens = d.itens.reduce((s, i) => s + i.valor, 0);
  if (Math.abs(somaItens - d.valor_total) > 0.01) {
    return {
      ok: false,
      message: `A soma dos jobs desta NF (${brl(somaItens)}) não fecha com o total (${brl(d.valor_total)}).`,
    };
  }
  const somaParcelas = d.parcelas.reduce((s, p) => s + p.valor, 0);
  if (Math.abs(somaParcelas - d.valor_total) > 0.01) {
    return {
      ok: false,
      message: `A soma das parcelas (${brl(somaParcelas)}) não fecha com o total da NF (${brl(d.valor_total)}).`,
    };
  }

  // Módulo fiscal: o CNPJ emissor ativo, e o CNAE dele, ativo e vigente na
  // data de emissão — conferidos ANTES de emitir, porque o registro fiscal
  // é uma segunda chamada e a nota emitida não volta atrás se ela recusar.
  // O texto `cnae` da nota sai do cadastro, e não do que o navegador mandou.
  const [estabRes, cnaeRes] = await Promise.all([
    supabase
      .from("fiscal_estabelecimentos")
      .select("id, ativo, empresa_contabil_id")
      .eq("id", d.estabelecimento_id)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle<{ id: string; ativo: boolean; empresa_contabil_id: string }>(),
    supabase
      .from("fiscal_cnaes")
      .select("id, estabelecimento_id, codigo, subitem, ativo, vigencia_inicio, vigencia_fim")
      .eq("id", d.fiscal_cnae_id)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle<{
        id: string;
        estabelecimento_id: string;
        codigo: string;
        subitem: string | null;
        ativo: boolean;
        vigencia_inicio: string;
        vigencia_fim: string | null;
      }>(),
  ]);
  if (estabRes.error || cnaeRes.error) {
    return {
      ok: false,
      message: `Falha ao conferir o CNPJ emissor e o CNAE: ${(estabRes.error ?? cnaeRes.error)?.message}`,
    };
  }
  if (!estabRes.data?.ativo) {
    return { ok: false, message: "Escolha um CNPJ emissor ativo do cadastro de impostos." };
  }
  const empresaContabilId = estabRes.data.empresa_contabil_id;
  const cnaeDaLista = cnaeRes.data;
  if (!cnaeDaLista || !cnaeDaLista.ativo || cnaeDaLista.estabelecimento_id !== d.estabelecimento_id) {
    return { ok: false, message: "O CNAE escolhido não é do CNPJ emissor." };
  }
  if (
    cnaeDaLista.vigencia_inicio > d.data_emissao ||
    (cnaeDaLista.vigencia_fim !== null && cnaeDaLista.vigencia_fim < d.data_emissao)
  ) {
    return { ok: false, message: "O CNAE escolhido não está vigente na data de emissão." };
  }
  const cnaeTexto = codigoDoCnae(cnaeDaLista);

  const { data: fatId, error } = await supabase.rpc("emitir_faturamento", {
    payload: {
      tenant_id: session.activeTenant.id,
      empresa_id: d.empresa_id,
      origem_tipo: d.origem_tipo,
      // NF agrupada não tem origem única — a verdade vai nos itens.
      origem_id: d.itens.length > 1 ? null : d.origem_id,
      cliente_id: d.cliente_id,
      fornecedor_id: d.fornecedor_id,
      numero_nf: d.numero_nf,
      serie: "1",
      data_emissao: d.data_emissao,
      valor_total: d.valor_total,
      descricao: d.descricao,
      cnae: cnaeTexto,
      anexo_nf_path: d.anexo_nf_path,
      plano_conta_tipo_id: d.plano_conta_tipo_id,
      plano_conta_subtipo_id: d.plano_conta_subtipo_id,
      emitido_por: session.profile.id,
      itens: d.itens,
      parcelas: d.parcelas,
      rateio: d.origem_tipo === "avulso" ? d.rateio : [],
    },
  });

  if (error) return { ok: false, message: `Falha ao emitir: ${error.message}` };

  // O CNPJ emissor e o CNAE da lista, na nota que acabou de sair. Se esta
  // chamada falhar a nota JÁ está emitida: a tela avisa e não deixa emitir
  // de novo (duplicaria a nota).
  const { error: erroFiscal } = await supabase.rpc("registrar_fiscal_da_nota", {
    p_faturamento_id: fatId as string,
    p_estabelecimento_id: d.estabelecimento_id,
    p_fiscal_cnae_id: d.fiscal_cnae_id,
  });
  if (erroFiscal) {
    console.error("[faturamento.registrar_fiscal_da_nota]", fatId, erroFiscal.message);
  }

  // O aviso depois de emitir diz em que Apuração os impostos da nota
  // entraram (`avisoDaApuracao`, protótipo aprovado do módulo fiscal) ou
  // que a guia já aprovada da competência passa a mostrar a diferença. A
  // guia só pode estar aprovada em mês encerrado dentro da Apuração: só aí
  // há a consulta, uma só, e junto com o audit — a emissão não fica mais
  // lenta. Sem o registro fiscal a nota não entra na Apuração: sem aviso.
  const hoje = hojeEmSaoPaulo();
  const guias = erroFiscal
    ? null
    : guiasDaEmissaoParaConferir({
        estabelecimentoId: d.estabelecimento_id,
        empresaContabilId,
        emissao: d.data_emissao,
        hoje,
        primeiraCompetencia: PRIMEIRA_COMPETENCIA,
      });

  const [aprovacoesRes] = await Promise.all([
    guias
      ? supabase
          .from("fiscal_aprovacoes")
          .select("chave")
          .eq("tenant_id", session.activeTenant.id)
          .in("chave", [guias.iss, ...guias.pisCofins])
      : Promise.resolve(null),
    logAuditEvent({
      acao: "faturamento.emitido",
      tenantId: session.activeTenant.id,
      entidadeTipo: "faturamento",
      entidadeId: fatId as string,
      metadata: {
        origem_tipo: d.origem_tipo,
        numero_nf: d.numero_nf,
        valor_total: d.valor_total,
        qtd_itens: d.itens.length,
        qtd_parcelas: d.parcelas.length,
        agrupada: d.itens.length > 1,
        regionais_no_rateio: d.rateio.length,
        estabelecimento_id: d.estabelecimento_id,
        fiscal_cnae_id: d.fiscal_cnae_id,
        cnae: cnaeTexto,
        fiscal_registrado: !erroFiscal,
        ...(erroFiscal ? { erro_fiscal: erroFiscal.message } : {}),
      },
    }),
  ]);

  // Sem consulta (mês em curso, futuro ou antes da Apuração), nenhuma guia
  // pode estar aprovada. Leitura que falhou não impede nada: o aviso só
  // deixa de dizer se a guia está aprovada.
  let aprovadas: ApuracaoDaEmissao["aprovadas"] = { iss: false, pis_cofins: false };
  if (guias && aprovacoesRes) {
    if (aprovacoesRes.error) {
      console.error("[faturamento.aprovacoes_da_competencia]", fatId, aprovacoesRes.error.message);
      aprovadas = null;
    } else {
      const chaves = new Set(((aprovacoesRes.data ?? []) as Array<{ chave: string }>).map((a) => a.chave));
      aprovadas = {
        iss: chaves.has(guias.iss),
        pis_cofins: guias.pisCofins.some((c) => chaves.has(c)),
      };
    }
  }

  revalidatePath("/financeiro/contas-a-receber");
  revalidatePath("/financeiro/fluxo-caixa");
  revalidatePath("/financeiro");
  return {
    ok: true,
    faturamento_id: fatId as string,
    avisoFiscal: erroFiscal
      ? `A NF ${d.numero_nf} foi emitida, mas o CNPJ emissor e o CNAE não foram registrados nela (${erroFiscal.message}). Não emita a nota de novo: avise o administrador do sistema para completar o registro.`
      : null,
    apuracao: erroFiscal ? null : { hoje, primeira_competencia: PRIMEIRA_COMPETENCIA, aprovadas },
  };
}

// ---------------------------------------------------------------------------
// Baixa do recebimento
// ---------------------------------------------------------------------------

/**
 * Os três obrigatórios do protótipo. `pago_em` é o mais importante:
 * título recebido SEMPRE tem data de recebimento — invariante garantida
 * aqui, no schema, e de novo dentro da RPC.
 */
const baixaSchema = z.object({
  titulo_id: z.string().uuid(),
  pago_em: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data do recebimento."),
  conta_bancaria_id: z.string().uuid("Selecione a conta bancária que recebeu."),
  plano_conta_tipo_id: z.string().uuid("Selecione o centro de custo do recebimento."),
  plano_conta_subtipo_id: z
    .string()
    .uuid("Selecione o centro de custo do recebimento."),
  // Baixa parcial e impostos retidos pelo cliente (decisão 125).
  ...valorDaBaixaSchema,
});

export async function darBaixaTitulo(input: unknown): Promise<Result> {
  const parsed = baixaSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };
  }
  const gate = await checarGateFinanceiro(
    parsed.data.titulo_id,
    "titulo_receber",
    "titulo.baixado",
  );
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  // O banco confere o que falta e os retidos (decisão 125); sem valor,
  // baixa tudo o que falta.
  const { data: lancId, error } = await supabase.rpc("baixar_titulo_receber", {
    p_titulo_id: parsed.data.titulo_id,
    p_pago_em: parsed.data.pago_em,
    p_conta_bancaria_id: parsed.data.conta_bancaria_id,
    p_tipo_id: parsed.data.plano_conta_tipo_id,
    p_subtipo_id: parsed.data.plano_conta_subtipo_id,
    p_valor_baixa: parsed.data.valor_baixa ?? null,
    p_retencoes: parsed.data.retencoes,
  });

  if (error) return { ok: false, message: `Falha ao dar baixa: ${error.message}` };

  await logAuditEvent({
    acao: "titulo.baixado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "titulo_receber",
    entidadeId: parsed.data.titulo_id,
    metadata: {
      pago_em: parsed.data.pago_em,
      conta_bancaria_id: parsed.data.conta_bancaria_id,
      plano_conta_tipo_id: parsed.data.plano_conta_tipo_id,
      plano_conta_subtipo_id: parsed.data.plano_conta_subtipo_id,
      valor_baixa: parsed.data.valor_baixa ?? null,
      retencoes: parsed.data.retencoes,
      lancamento_id: lancId,
    },
  });

  revalidatePath("/financeiro/contas-a-receber");
  revalidatePath("/financeiro/conciliacao");
  revalidatePath("/financeiro/fluxo-caixa");
  revalidatePath("/financeiro");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Repactuar a previsão de recebimento
// ---------------------------------------------------------------------------

const previsaoSchema = z.object({
  titulo_id: z.string().uuid(),
  data_previsao_recebimento: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a nova previsão de recebimento."),
});

/**
 * O lápis da coluna Vencimento.
 *
 * Só a PREVISÃO muda. O vencimento da NF e a 1ª previsão registrada não
 * dependem desta action para ficarem intactos: o trigger
 * `congela_previsao_recebimento_primeira` reverte qualquer tentativa,
 * venha ela daqui ou de fora.
 */
export async function repactuarPrevisaoRecebimento(input: unknown): Promise<Result> {
  const parsed = previsaoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };
  }
  const gate = await checarGateFinanceiro(
    parsed.data.titulo_id,
    "titulo_receber",
    "titulo.previsao_repactuada",
  );
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  const { data: titulo } = await supabase
    .from("titulos_receber")
    .select("id, status, data_previsao_recebimento")
    .eq("id", parsed.data.titulo_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ id: string; status: string; data_previsao_recebimento: string | null }>();

  if (!titulo) return { ok: false, message: "Título não encontrado." };
  if (titulo.status !== "em_aberto") {
    return {
      ok: false,
      message: "Só título em aberto tem previsão de recebimento a repactuar.",
    };
  }

  const { error } = await supabase
    .from("titulos_receber")
    .update({ data_previsao_recebimento: parsed.data.data_previsao_recebimento })
    .eq("id", parsed.data.titulo_id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) return { ok: false, message: `Falha ao salvar a previsão: ${error.message}` };

  await logAuditEvent({
    acao: "titulo.previsao_repactuada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "titulo_receber",
    entidadeId: parsed.data.titulo_id,
    metadata: {
      de: titulo.data_previsao_recebimento,
      para: parsed.data.data_previsao_recebimento,
    },
  });

  revalidatePath("/financeiro/contas-a-receber");
  revalidatePath("/financeiro/fluxo-caixa");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Cancelamento de NF — sem porta na UI desde a Tela 3.3
// ---------------------------------------------------------------------------
//
// O protótipo não tem cancelamento de NF em lugar nenhum. A action continua
// aqui, funcionando, para o dia em que a tela voltar a precisar dela.
//
// O estorno da baixa (`estornarBaixaTitulo`) saiu em 29/09/2026: cancelar e
// estornar a baixa de um título agora são `cancelarBaixa` e
// `estornarValorDaBaixa`, em `../actions-baixa-registrada.ts` (decisão 120).

const cancelarSchema = z.object({
  faturamento_id: z.string().uuid(),
  motivo: z.string().trim().min(10, "Motivo precisa ter ao menos 10 caracteres."),
});

export async function cancelarFaturamento(input: unknown): Promise<Result> {
  const parsed = cancelarSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };
  }
  const gate = await checarGateFinanceiro(
    parsed.data.faturamento_id,
    "faturamento",
    "faturamento.cancelado",
  );
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  const { error } = await supabase.rpc("cancelar_faturamento", {
    p_faturamento_id: parsed.data.faturamento_id,
    p_motivo: parsed.data.motivo,
    p_cancelado_por: session.profile.id,
  });

  if (error) return { ok: false, message: `Falha ao cancelar: ${error.message}` };

  await logAuditEvent({
    acao: "faturamento.cancelado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "faturamento",
    entidadeId: parsed.data.faturamento_id,
    metadata: { motivo: parsed.data.motivo },
  });

  revalidatePath("/financeiro/contas-a-receber");
  revalidatePath("/financeiro/fluxo-caixa");
  revalidatePath("/financeiro");
  return { ok: true };
}

function brl(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
