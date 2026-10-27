"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { pode } from "@/lib/permissoes";
import { checarPermissao } from "@/lib/permissoes-server";
import { honorariosDoOrcamento } from "@/lib/data/clientes";
import { modeloPlanilhaDoOrcamento } from "@/lib/data/modelo-planilha";
import {
  copiarMesesEntreVersoes,
  criarMesesDoPeriodo,
  mesesSemItensDaVersao,
} from "@/lib/data/meses-versao";
import { bloqueioAprovacaoVersao, versaoSchema } from "@/lib/validations/versoes";
import { erroDoParDoOrcamento } from "@/lib/data/par-servico-categoria";
import {
  ALIQUOTA_IMPOSTO_PADRAO,
  aliquotaParaValor,
} from "@/lib/impostos";
import {
  itemSchema,
  camposItemEditaveis,
  isCampoItemEditavel,
} from "@/lib/validations/itens";
import { grupoSchema } from "@/lib/validations/grupos";
import type {
  CategoriaModeloPlanilha,
  TipoCusto,
  VersaoOrcamento,
  VersaoOrcamentoGrupo,
  VersaoOrcamentoItem,
} from "@/lib/types";
import { aceitaBV } from "@/lib/calculos/versao-totais";
import { motivosDaVersaoNoComite } from "@/lib/calculos/limites-orcamento";
import { carregarRegrasDoComite } from "@/lib/data/comite";
import {
  gruposNaOrdemDaTela,
  moverNaLista,
  numerarItens,
  ordensAlteradas,
} from "@/lib/calculos/ordem-itens";
import { formatCurrency } from "@/lib/utils";
import {
  FECHAMENTO_PADRAO,
  compraDaCotacao,
  cotacaoValida,
  desviosDoPadrao,
  erroDasTaxas,
  foraDoPadrao,
  vendaDaCotacao,
  type TaxasDoFechamento,
} from "@/lib/calculos/excecao-fechamento";

export type ActionResult =
  | { ok: true; id?: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

// ============================================================
// VERSÕES
// ============================================================

function extractVersaoInput(formData: FormData) {
  // Empty string dos numéricos → Zod aplica default na criação.
  const get = (k: string, fallback: string) => {
    const raw = formData.get(k)?.toString() ?? "";
    return raw.trim().length > 0 ? raw : fallback;
  };
  // `nome` não entra: desde 13/08/2026 o nome da versão é calculado
  // (nome do job + V{n}) e não existe caminho para gravá-lo.
  return {
    moeda: get("moeda", "BRL"),
    taxa_cambio: get("taxa_cambio", "1"),
    percentual_honorarios: get("percentual_honorarios", "0"),
    // Versão nova sem alíquota escolhida nasce na padrão (03/09/2026), não
    // em 0 — zero não casa com nenhuma alíquota da lista e travava a
    // aprovação. O drawer já manda a padrão; este default é a rede.
    percentual_imposto: get(
      "percentual_imposto",
      aliquotaParaValor(ALIQUOTA_IMPOSTO_PADRAO),
    ),
    status: (formData.get("status")?.toString() ?? "rascunho") as any,
  };
}

/** Extrai apenas os campos que o usuário efetivamente preencheu no edit.
 *  Campos vazios preservam o valor atual no banco. */
function extractVersaoPartial(formData: FormData): Record<string, unknown> {
  const partial: Record<string, unknown> = {};

  // `nome` não entra: o nome da versão é calculado, não gravado. Um
  // formulário que mande o campo é ignorado de propósito — a regra tem
  // que valer no servidor, não só no sumiço do input.

  const moeda = formData.get("moeda")?.toString().trim();
  if (moeda && moeda.length > 0) {
    partial.moeda = moeda.toUpperCase().slice(0, 3);
  }

  const taxa = formData.get("taxa_cambio")?.toString().trim();
  if (taxa && taxa.length > 0) {
    const n = Number(taxa);
    if (Number.isFinite(n) && n > 0) partial.taxa_cambio = n;
  }

  const honor = formData.get("percentual_honorarios")?.toString().trim();
  if (honor && honor.length > 0) {
    const n = Number(honor);
    if (Number.isFinite(n) && n >= 0 && n <= 100)
      partial.percentual_honorarios = n;
  }

  const imp = formData.get("percentual_imposto")?.toString().trim();
  if (imp && imp.length > 0) {
    const n = Number(imp);
    if (Number.isFinite(n) && n >= 0 && n <= 100)
      partial.percentual_imposto = n;
  }

  // ---- Parâmetros do orçamento internacional (decisão 072).
  //
  // Só chegam da tela quando a categoria tem `modelo_planilha =
  // 'internacional'`; nas demais o formulário nem renderiza os campos, e
  // aí nada disto entra no update. A validação é a mesma dos de cima:
  // vazio preserva, valor torto é ignorado em silêncio em vez de gravar
  // NaN.

  const moedaExt = formData.get("moeda_estrangeira")?.toString().trim();
  if (moedaExt && moedaExt.length > 0) {
    // 3 a 4 letras maiúsculas — o mesmo que o CHECK do banco aceita. Fora
    // disso, preserva: o insert seria recusado pelo constraint e o
    // usuário veria um erro de banco em vez de nada.
    const sigla = moedaExt.toUpperCase().slice(0, 4);
    if (/^[A-Z]{3,4}$/.test(sigla)) partial.moeda_estrangeira = sigla;
  }

  // As três taxas. `cambio_compra` é a que converte; as outras duas são
  // registro. Zero é recusado em todas — taxa zerada só produziria
  // divisão por zero na coluna da moeda.
  for (const campo of ["cambio_cotacao", "cambio_compra", "cambio_venda"]) {
    const bruto = formData.get(campo)?.toString().trim();
    if (bruto && bruto.length > 0) {
      const n = Number(bruto);
      if (Number.isFinite(n) && n > 0) partial[campo] = n;
    }
  }

  const dataCotacao = formData.get("cambio_data")?.toString().trim();
  if (dataCotacao && /^\d{4}-\d{2}-\d{2}$/.test(dataCotacao)) {
    partial.cambio_data = dataCotacao;
  }

  const intTaxes = formData.get("percentual_int_taxes")?.toString().trim();
  if (intTaxes && intTaxes.length > 0) {
    const n = Number(intTaxes);
    if (Number.isFinite(n) && n >= 0 && n <= 100)
      partial.percentual_int_taxes = n;
  }

  // Custo em BRL, não percentual: o teto é só "não negativo".
  const itc = formData.get("int_transaction_costs")?.toString().trim();
  if (itc && itc.length > 0) {
    const n = Number(itc);
    if (Number.isFinite(n) && n >= 0) partial.int_transaction_costs = n;
  }

  // ---- Parâmetros da Mídia Off (decisão 147). Só chegam da tela da
  // Mídia Off; `atualizarVersao` os descarta nos outros modelos.
  const veiculo = formData.get("percentual_veiculo")?.toString().trim();
  if (veiculo && veiculo.length > 0) {
    const n = Number(veiculo);
    if (Number.isFinite(n) && n >= 0 && n <= 100) partial.percentual_veiculo = n;
  }
  const base = formData.get("base_honorarios")?.toString().trim();
  if (base === "negociado" || base === "liquido") partial.base_honorarios = base;

  // `status` não entra: desde 17/08/2026 o status da versão é 100% do
  // sistema (aprovação, cascata de substituídas, `cancelarVersao`). Um
  // formulário que mande o campo é ignorado de propósito — a regra tem
  // que valer no servidor, não só no sumiço do input.

  return partial;
}

async function proximoNumeroVersao(
  orcamentoId: string,
  tenantId: string,
): Promise<number> {
  const supabase = createClient();
  const { data } = await supabase
    .from("versoes_orcamento")
    .select("numero_versao")
    .eq("orcamento_id", orcamentoId)
    .eq("tenant_id", tenantId)
    .order("numero_versao", { ascending: false })
    .limit(1)
    .maybeSingle<{ numero_versao: number }>();
  return (data?.numero_versao ?? 0) + 1;
}

function mapVersaoDbError(msg: string): string {
  if (msg.includes("uniq_versao_numero_por_orcamento")) {
    return "Já existe uma versão com esse número.";
  }
  if (msg.includes("uniq_versao_aprovada_por_orcamento")) {
    return "Já existe uma versão aprovada neste orçamento.";
  }
  if (msg.includes("percentuais_validos")) {
    return "Percentuais precisam estar entre 0 e 100.";
  }
  if (msg.includes("taxa_positiva")) {
    return "Taxa de câmbio precisa ser maior que zero.";
  }
  return "Não foi possível salvar a versão.";
}

/**
 * Cria a versão e REDIRECIONA para ela.
 *
 * O retorno é `ActionResult | void` porque `redirect()` no servidor não
 * devolve valor nenhum ao cliente: no caminho feliz o `await` do chamador
 * resolve `undefined` e a navegação já aconteceu. Só o erro volta como
 * objeto — por isso todo call site testa `res` antes de ler `res.ok`.
 */
export async function criarVersao(
  orcamentoId: string,
  formData: FormData,
): Promise<ActionResult | void> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "orcamentos.criar");
  if (!gate.ok) return gate;
  const parsed = versaoSchema.safeParse(extractVersaoInput(formData));

  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();

  const { data: orc } = await supabase
    .from("orcamentos")
    .select("id, status, projeto_id, data_inicio_prevista, data_fim_prevista")
    .eq("id", orcamentoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{
      id: string;
      status: string;
      projeto_id: string;
      data_inicio_prevista: string | null;
      data_fim_prevista: string | null;
    }>();

  if (!orc) return { ok: false, message: "Orçamento não encontrado." };
  if (orc.status === "job_criado" || orc.status === "cancelado") {
    return {
      ok: false,
      message: `Não é possível criar versão em orçamento ${orc.status}.`,
    };
  }

  const projetoId = orc.projeto_id;

  // Honorários da versão nova vem do cadastro do cliente, nunca do form: o
  // drawer mostra o campo travado e não envia nada (11/08/2026).
  const honorariosCliente = await honorariosDoOrcamento(
    orcamentoId,
    session.activeTenant.id,
  );
  if (!honorariosCliente) {
    return {
      ok: false,
      message:
        "Não foi possível ler os honorários do cliente. Confira o cadastro do cliente do projeto.",
    };
  }

  const numero = await proximoNumeroVersao(orcamentoId, session.activeTenant.id);

  // Versão de orçamento internacional já nasce com as int. taxes
  // preenchidas e a moeda em USD — o câmbio fica em branco de propósito,
  // porque a cotação é do dia e ninguém aqui sabe qual é (decisão 072).
  const modelo = await modeloPlanilhaDoOrcamento(
    orcamentoId,
    session.activeTenant.id,
  );

  // Versão nova de internacional nasce no fechamento padrão (decisão 206,
  // que substitui a herança da vigente de 14/09/2026): a exceção é da
  // versão em que o administrador a registrou e não passa adiante. O que
  // veio do formulário é ignorado; o gatilho do banco confere de novo.
  const { data, error } = await supabase
    .from("versoes_orcamento")
    .insert({
      ...parsed.data,
      percentual_honorarios: honorariosCliente.percentual,
      ...(modelo === "internacional"
        ? {
            moeda_estrangeira: "USD",
            percentual_int_taxes: FECHAMENTO_PADRAO.intTaxes,
            percentual_imposto: FECHAMENTO_PADRAO.imposto,
            int_transaction_costs: FECHAMENTO_PADRAO.itc,
          }
        : {}),
      tenant_id: session.activeTenant.id,
      orcamento_id: orcamentoId,
      numero_versao: numero,
      created_by: session.profile.id,
    })
    .select("id, numero_versao")
    .single();

  if (error) {
    console.error("[versoes.criar]", error.message);
    return { ok: false, message: mapVersaoDbError(error.message) };
  }

  // Versão nova do modelo mensal (decisão 078) e da Mídia Off (decisão 147)
  // nasce com os meses do período do orçamento, vazios. Se não der, a tela
  // oferece o "Editar meses" — a versão não é desfeita por isso.
  if (modelo === "mensal" || modelo === "midia_off") {
    const meses = await criarMesesDoPeriodo(supabase, {
      tenantId: session.activeTenant.id,
      versaoId: data.id,
      profileId: session.profile.id,
      inicio: orc.data_inicio_prevista,
      fim: orc.data_fim_prevista,
      modelo,
    });
    if (!meses.ok) {
      console.error("[versoes.criar.meses]", meses.message);
    }
  }

  await logAuditEvent({
    acao: "versao_orcamento.criada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "versao_orcamento",
    entidadeId: data.id,
    metadata: { orcamento_id: orcamentoId, numero_versao: data.numero_versao },
  });

  revalidatePath(`/orcamentos/${projetoId}/${orcamentoId}`);
  redirect(`/orcamentos/${projetoId}/${orcamentoId}?v=${data.id}`);
}

export async function atualizarVersao(
  versaoId: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "orcamentos.editar");
  if (!gate.ok) return gate;
  const updates = extractVersaoPartial(formData);

  const supabase = createClient();

  const { data: atual } = await supabase
    .from("versoes_orcamento")
    .select(
      "orcamento_id, status, percentual_honorarios, percentual_imposto, percentual_int_taxes, int_transaction_costs, percentual_veiculo, base_honorarios, moeda_estrangeira, cambio_cotacao, cambio_compra, cambio_venda, cambio_data",
    )
    .eq("id", versaoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{
      orcamento_id: string;
      status: string;
      percentual_honorarios: number;
      percentual_imposto: number | string;
      percentual_int_taxes: number | string;
      int_transaction_costs: number | string;
      percentual_veiculo: number | string;
      base_honorarios: string;
      moeda_estrangeira: string | null;
      cambio_cotacao: number | string | null;
      cambio_compra: number | string | null;
      cambio_venda: number | string | null;
      cambio_data: string | null;
    }>();

  if (!atual) return { ok: false, message: "Versão não encontrada." };
  if (atual.status === "aprovada") {
    return {
      ok: false,
      message: "Versão aprovada não pode ser alterada manualmente.",
    };
  }

  // Honorarios e o unico campo desta tela com trava de papel adicional:
  // o padrao vem do cadastro do cliente e so quem tem `orcamentos.editar_impostos`
  // (Admin + Gerente de Producao) pode divergir dele. Nao e gate de tela
  // — quem nao pode nem tem o campo habilitado, e sem esta checagem um
  // POST direto passaria por cima.
  const honorariosNovo = updates.percentual_honorarios;
  const honorariosMudou =
    typeof honorariosNovo === "number" &&
    Number(atual.percentual_honorarios) !== honorariosNovo;

  if (honorariosMudou && !pode(session.activeRole, "orcamentos.editar_impostos")) {
    return {
      ok: false,
      message:
        "Só administrador ou gerente de projeto altera os honorários da versão. O padrão vem do cadastro do cliente.",
    };
  }
  if (!honorariosMudou) delete updates.percentual_honorarios;

  // Internacional (decisão 206, 22/10/2026): int. taxes, impostos BR e
  // custo de transação ficam no padrão e só mudam pela exceção do
  // administrador (`definirExcecaoDoFechamento`) — o "Editar" não os envia,
  // e um POST direto que os mude é recusado aqui e de novo no banco.
  const modeloDaVersao = await modeloPlanilhaDoOrcamento(
    atual.orcamento_id,
    session.activeTenant.id,
  );
  if (modeloDaVersao === "internacional") {
    const mudou = (campo: string, atualValor: number | string) =>
      typeof updates[campo] === "number" &&
      Math.abs(Number(atualValor) - (updates[campo] as number)) > 1e-6;
    if (
      mudou("percentual_imposto", atual.percentual_imposto) ||
      mudou("percentual_int_taxes", atual.percentual_int_taxes) ||
      mudou("int_transaction_costs", atual.int_transaction_costs)
    ) {
      return {
        ok: false,
        message:
          "No orçamento internacional, int. taxes, impostos BR e custo de transação só mudam pela exceção no fechamento, que o administrador registra no botão “Exceção”.",
      };
    }
    delete updates.percentual_imposto;
    delete updates.percentual_int_taxes;
    delete updates.int_transaction_costs;

    // Câmbio (decisão 206): compra e venda saem da cotação (−0,20 e +0,20);
    // o que vier delas no formulário é ignorado.
    delete updates.cambio_compra;
    delete updates.cambio_venda;
    if (typeof updates.cambio_cotacao === "number") {
      const cotacao = updates.cambio_cotacao;
      if (!cotacaoValida(cotacao)) {
        return {
          ok: false,
          message: "A cotação precisa ser maior que 0,20: compra e venda saem dela (−0,20 e +0,20).",
        };
      }
      updates.cambio_compra = compraDaCotacao(cotacao);
      updates.cambio_venda = vendaDaCotacao(cotacao);
    }
  } else {
    delete updates.percentual_int_taxes;
    delete updates.int_transaction_costs;
  }

  // Mídia Off (decisão 147): a base dos honorários e a parte do veículo
  // mudam o valor cobrado do cliente, como os honorários — a mesma trava.
  // Nos outros modelos os dois campos não existem para a tela.
  if (modeloDaVersao === "midia_off") {
    const veiculoMudou =
      typeof updates.percentual_veiculo === "number" &&
      Math.abs(Number(atual.percentual_veiculo) - updates.percentual_veiculo) > 1e-6;
    const baseMudou =
      typeof updates.base_honorarios === "string" &&
      updates.base_honorarios !== atual.base_honorarios;
    if ((veiculoMudou || baseMudou) && !pode(session.activeRole, "orcamentos.editar_impostos")) {
      return {
        ok: false,
        message:
          "Só administrador ou gerente de projeto altera a base dos honorários e a parte do veículo.",
      };
    }
    if (!veiculoMudou) delete updates.percentual_veiculo;
    if (!baseMudou) delete updates.base_honorarios;
  } else {
    delete updates.percentual_veiculo;
    delete updates.base_honorarios;
  }

  const { error } = await supabase
    .from("versoes_orcamento")
    .update(updates)
    .eq("id", versaoId)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[versoes.atualizar]", error.message);
    return { ok: false, message: mapVersaoDbError(error.message) };
  }

  // O antes e o depois de cada parâmetro que mudou (decisão 206). Antes
  // a auditoria só dizia que a versão foi editada: foi assim que o 0% de
  // int. taxes do SOF-P002/26-01 não teve como ser rastreado.
  const anterior = atual as unknown as Record<string, unknown>;
  const alteracoes = Object.fromEntries(
    Object.entries(updates)
      .filter(([campo, para]) => {
        const de = anterior[campo];
        if (typeof para === "number") return de === null || de === undefined || Math.abs(Number(de) - para) > 1e-9;
        return (de ?? null) !== (para ?? null);
      })
      .map(([campo, para]) => {
        const de = anterior[campo];
        return [campo, { de: typeof para === "number" && de !== null && de !== undefined ? Number(de) : de ?? null, para }];
      }),
  );

  await logAuditEvent({
    acao: "versao_orcamento.editada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "versao_orcamento",
    entidadeId: versaoId,
    metadata:
      honorariosMudou || "percentual_veiculo" in updates || "base_honorarios" in updates || Object.keys(alteracoes).length > 0
        ? {
            ...(Object.keys(alteracoes).length > 0 ? { alteracoes } : {}),
            ...(honorariosMudou
              ? {
                  campo: "percentual_honorarios",
                  de: Number(atual.percentual_honorarios),
                  para: honorariosNovo,
                }
              : {}),
            // Mídia Off (decisão 147).
            ...("percentual_veiculo" in updates
              ? { percentual_veiculo: { de: Number(atual.percentual_veiculo), para: updates.percentual_veiculo } }
              : {}),
            ...("base_honorarios" in updates
              ? { base_honorarios: { de: atual.base_honorarios, para: updates.base_honorarios } }
              : {}),
          }
        : undefined,
  });

  const { data: orcAtual } = await supabase
    .from("orcamentos")
    .select("projeto_id")
    .eq("id", atual.orcamento_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ projeto_id: string }>();
  const projetoIdAtual = orcAtual?.projeto_id;

  revalidatePath(`/orcamentos/${projetoIdAtual}/${atual.orcamento_id}`);
  return { ok: true, id: versaoId };
}

// ============================================================
// EXCEÇÃO NO FECHAMENTO DO INTERNACIONAL (decisão 206)
// ============================================================

/** A versão que a exceção lê e grava. */
async function versaoParaExcecao(versaoId: string, tenantId: string) {
  const supabase = createClient();
  const { data } = await supabase
    .from("versoes_orcamento")
    .select(
      "id, orcamento_id, status, percentual_int_taxes, percentual_imposto, int_transaction_costs, excecao_fechamento_motivo",
    )
    .eq("id", versaoId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{
      id: string;
      orcamento_id: string;
      status: string;
      percentual_int_taxes: number | string;
      percentual_imposto: number | string;
      int_transaction_costs: number | string;
      excecao_fechamento_motivo: string | null;
    }>();
  return data;
}

function taxasDaLinha(v: {
  percentual_int_taxes: number | string;
  percentual_imposto: number | string;
  int_transaction_costs: number | string;
}): TaxasDoFechamento {
  return {
    intTaxes: Number(v.percentual_int_taxes ?? 0),
    imposto: Number(v.percentual_imposto ?? 0),
    itc: Number(v.int_transaction_costs ?? 0),
  };
}

/** A recusa do gatilho chega em pt-BR; o resto vira a mensagem genérica. */
function mensagemDaExcecao(erro: { code?: string; message: string }): string {
  return erro.code === "42501" ? erro.message : mapVersaoDbError(erro.message);
}

async function revalidarOrcamento(orcamentoId: string, tenantId: string) {
  const supabase = createClient();
  const { data: orc } = await supabase
    .from("orcamentos")
    .select("projeto_id")
    .eq("id", orcamentoId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ projeto_id: string }>();
  if (orc) revalidatePath(`/orcamentos/${orc.projeto_id}/${orcamentoId}`);
}

/**
 * Registra (ou troca) a exceção no fechamento de UMA versão internacional:
 * int. taxes, impostos BR e custo de transação fora do padrão, com motivo.
 * Só o administrador; o gatilho `versao_fechamento_internacional_no_padrao`
 * confere de novo. A versão nova não herda a exceção.
 */
export async function definirExcecaoDoFechamento(
  versaoId: string,
  input: { intTaxes: number; imposto: number; itc: number; motivo: string },
): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "orcamentos.excecao_fechamento");
  if (!gate.ok) {
    return { ...gate, message: "Só o administrador registra a exceção no fechamento." };
  }

  const versao = await versaoParaExcecao(versaoId, session.activeTenant.id);
  if (!versao) return { ok: false, message: "Versão não encontrada." };
  if (versao.status === "aprovada" || versao.status === "cancelada") {
    return { ok: false, message: "Versão aprovada ou cancelada não pode ser alterada." };
  }
  const modelo = await modeloPlanilhaDoOrcamento(versao.orcamento_id, session.activeTenant.id);
  if (modelo !== "internacional") {
    return { ok: false, message: "A exceção no fechamento só existe no orçamento internacional." };
  }

  const taxas: TaxasDoFechamento = {
    intTaxes: Number(input.intTaxes),
    imposto: Number(input.imposto),
    itc: Math.round(Number(input.itc) * 100) / 100,
  };
  const erroTaxas = erroDasTaxas(taxas);
  if (erroTaxas) return { ok: false, message: erroTaxas };
  if (!foraDoPadrao(taxas)) {
    return {
      ok: false,
      message: "Os três valores estão no padrão: não há exceção a registrar. Para voltar ao padrão, use “Voltar ao padrão”.",
    };
  }
  const motivo = (input.motivo ?? "").trim();
  if (motivo === "") return { ok: false, message: "Escreva o motivo da exceção." };
  if (motivo.length > 500) return { ok: false, message: "O motivo pode ter até 500 caracteres." };

  const antes = taxasDaLinha(versao);
  const supabase = createClient();
  const { error } = await supabase
    .from("versoes_orcamento")
    .update({
      percentual_int_taxes: taxas.intTaxes,
      percentual_imposto: taxas.imposto,
      int_transaction_costs: taxas.itc,
      excecao_fechamento_motivo: motivo,
      excecao_fechamento_por: session.profile.id,
      excecao_fechamento_em: new Date().toISOString(),
    })
    .eq("id", versaoId)
    .eq("tenant_id", session.activeTenant.id);
  if (error) {
    console.error("[versoes.excecao]", error.message);
    return { ok: false, message: mensagemDaExcecao(error) };
  }

  await logAuditEvent({
    acao: "versao_orcamento.excecao_fechamento",
    tenantId: session.activeTenant.id,
    entidadeTipo: "versao_orcamento",
    entidadeId: versaoId,
    metadata: {
      orcamento_id: versao.orcamento_id,
      de: antes,
      para: taxas,
      desvios: desviosDoPadrao(taxas).map((d) => d.linha),
      motivo,
      motivo_anterior: versao.excecao_fechamento_motivo,
    },
  });

  await revalidarOrcamento(versao.orcamento_id, session.activeTenant.id);
  return { ok: true, id: versaoId };
}

/** Tira a exceção: a versão volta ao fechamento padrão. Só o administrador. */
export async function removerExcecaoDoFechamento(versaoId: string): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "orcamentos.excecao_fechamento");
  if (!gate.ok) {
    return { ...gate, message: "Só o administrador remove a exceção no fechamento." };
  }

  const versao = await versaoParaExcecao(versaoId, session.activeTenant.id);
  if (!versao) return { ok: false, message: "Versão não encontrada." };
  if (versao.status === "aprovada" || versao.status === "cancelada") {
    return { ok: false, message: "Versão aprovada ou cancelada não pode ser alterada." };
  }

  const antes = taxasDaLinha(versao);
  const supabase = createClient();
  const { error } = await supabase
    .from("versoes_orcamento")
    .update({
      percentual_int_taxes: FECHAMENTO_PADRAO.intTaxes,
      percentual_imposto: FECHAMENTO_PADRAO.imposto,
      int_transaction_costs: FECHAMENTO_PADRAO.itc,
      excecao_fechamento_motivo: null,
      excecao_fechamento_por: null,
      excecao_fechamento_em: null,
    })
    .eq("id", versaoId)
    .eq("tenant_id", session.activeTenant.id);
  if (error) {
    console.error("[versoes.excecao.remover]", error.message);
    return { ok: false, message: mensagemDaExcecao(error) };
  }

  await logAuditEvent({
    acao: "versao_orcamento.excecao_fechamento_removida",
    tenantId: session.activeTenant.id,
    entidadeTipo: "versao_orcamento",
    entidadeId: versaoId,
    metadata: {
      orcamento_id: versao.orcamento_id,
      de: antes,
      para: FECHAMENTO_PADRAO,
      motivo_anterior: versao.excecao_fechamento_motivo,
    },
  });

  await revalidarOrcamento(versao.orcamento_id, session.activeTenant.id);
  return { ok: true, id: versaoId };
}

/** Duplica a versão e REDIRECIONA para a cópia. Ver `criarVersao` sobre o
 *  `| void` do retorno. */
export async function duplicarVersao(
  versaoId: string,
): Promise<ActionResult | void> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "orcamentos.duplicar");
  if (!gate.ok) return gate;
  const supabase = createClient();

  const { data: original } = await supabase
    .from("versoes_orcamento")
    .select("*")
    .eq("id", versaoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<VersaoOrcamento>();

  if (!original) return { ok: false, message: "Versão original não encontrada." };

  // Duplicar CRIA uma versão, então vale a mesma trava de `criarVersao`:
  // orçamento com job criado ou cancelado não recebe versão nova. A checagem
  // faltava aqui — o botão "Duplicar" da lista antiga não tinha gate nenhum,
  // e um orçamento fechado aceitava ganhar uma v+1 pelo caminho da cópia.
  // Traz status e projeto_id de uma vez: o status trava a operação aqui, o
  // projeto_id monta o destino lá embaixo.
  const { data: orcDup } = await supabase
    .from("orcamentos")
    .select("status, projeto_id")
    .eq("id", original.orcamento_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ status: string; projeto_id: string }>();

  if (orcDup?.status === "job_criado" || orcDup?.status === "cancelado") {
    return {
      ok: false,
      message: `Não é possível criar versão em orçamento ${orcDup.status}.`,
    };
  }

  const numero = await proximoNumeroVersao(
    original.orcamento_id,
    session.activeTenant.id,
  );

  // A exceção no fechamento é da versão de origem (decisão 206): a cópia
  // nasce no padrão e sem exceção. O gatilho do banco faz o mesmo com uma
  // origem antiga fora do padrão.
  const taxasDaCopia: TaxasDoFechamento = original.excecao_fechamento_motivo
    ? FECHAMENTO_PADRAO
    : {
        intTaxes: Number(original.percentual_int_taxes ?? 0),
        imposto: Number(original.percentual_imposto ?? 0),
        itc: Number(original.int_transaction_costs ?? 0),
      };

  const { data: nova, error } = await supabase
    .from("versoes_orcamento")
    .insert({
      tenant_id: session.activeTenant.id,
      orcamento_id: original.orcamento_id,
      numero_versao: numero,
      nome: original.nome ? `${original.nome} (cópia)` : null,
      status: "rascunho",
      moeda: original.moeda,
      taxa_cambio: original.taxa_cambio,
      percentual_honorarios: original.percentual_honorarios,
      percentual_imposto: taxasDaCopia.imposto,
      // Os parâmetros internacionais seguem a mesma regra dos demais na
      // duplicação: a cópia herda tudo da origem (decisão 072). Deixá-los
      // de fora faria a cópia de uma versão internacional nascer com a
      // cadeia zerada e um total diferente do que se está copiando.
      moeda_estrangeira: original.moeda_estrangeira,
      cambio_cotacao: original.cambio_cotacao,
      cambio_compra: original.cambio_compra,
      cambio_venda: original.cambio_venda,
      cambio_data: original.cambio_data,
      percentual_int_taxes: taxasDaCopia.intTaxes,
      int_transaction_costs: taxasDaCopia.itc,
      // Mídia Off (decisão 147): as condições de mídia vão junto, pela mesma
      // razão das internacionais.
      percentual_veiculo: original.percentual_veiculo,
      base_honorarios: original.base_honorarios,
      created_by: session.profile.id,
    })
    .select("id")
    .single();

  if (error || !nova) {
    console.error("[versoes.duplicar]", error?.message);
    return { ok: false, message: mapVersaoDbError(error?.message ?? "") };
  }

  // Os meses vão antes dos grupos: no modelo mensal cada grupo aponta para
  // o mês da própria versão (decisão 078). Nos demais modelos não há mês e
  // o mapa sai vazio.
  const mesMap = await copiarMesesEntreVersoes(supabase, {
    tenantId: session.activeTenant.id,
    origemId: versaoId,
    destinoId: nova.id,
    profileId: session.profile.id,
  });

  // Duplica grupos e mapeia old_id → new_id pra reatribuir os itens.
  const { data: gruposOriginais } = await supabase
    .from("versoes_orcamento_grupos")
    .select("id, nome, ordem, mes_id, meio, forma_compra, formato")
    .eq("versao_orcamento_id", versaoId)
    .eq("tenant_id", session.activeTenant.id)
    .order("ordem");

  const grupoMap = new Map<string, string>();
  if (gruposOriginais && gruposOriginais.length > 0) {
    const gruposRows = gruposOriginais.map((g: any) => ({
      tenant_id: session.activeTenant.id,
      versao_orcamento_id: nova.id,
      nome: g.nome,
      ordem: g.ordem,
      mes_id: g.mes_id ? (mesMap.get(g.mes_id) ?? null) : null,
      // Mídia Off (decisão 147): o meio do grupo.
      meio: g.meio ?? null,
      forma_compra: g.forma_compra ?? null,
      formato: g.formato ?? null,
    }));
    const { data: novosGrupos, error: gErr } = await supabase
      .from("versoes_orcamento_grupos")
      .insert(gruposRows)
      .select("id, nome, ordem");
    if (gErr) {
      console.error("[versoes.duplicar.grupos]", gErr.message);
    } else if (novosGrupos) {
      // Associação por (nome, ordem) — combinação única na versão nova.
      for (const orig of gruposOriginais as any[]) {
        const novo = novosGrupos.find(
          (g: any) => g.nome === orig.nome && g.ordem === orig.ordem,
        );
        if (novo) grupoMap.set(orig.id, novo.id);
      }
    }
  }

  const { data: itens } = await supabase
    .from("versoes_orcamento_itens")
    .select(
      "ordem, grupo_id, categoria_id, planilha_origem, item, tipo_custo, " +
      "valor_unitario_orcado, quantidade_orcada, dias_meses_orcado, " +
      "valor_unitario_planejado, quantidade_planejada, dias_meses_planejado, " +
      // O planejado que o save zerou atravessa junto (decisão 099): a
      // linha que nasce em save na cópia guarda o dela para devolvê-lo
      // quando o save sair. ⚠️ A duplicação NÃO copia `em_save` (nunca
      // copiou), então hoje a cópia nasce sem save e o trigger descarta
      // esta coluna — ela só vale se a versão nova nascer em save
      // (`save_por_padrao`) ou se um dia a marca passar a ser copiada.
      "planejado_antes_save, " +
      "fornecedor_id, observacoes, " +
      // Mídia Off (decisão 147): a linha de mídia inteira.
      "praca, peca, formato, insercoes_por_dia, data_inicio, data_fim, unidade_periodo, " +
      "valor_unitario_tabela, percentual_desconto, detalhe",
    )
    .eq("versao_orcamento_id", versaoId)
    .eq("tenant_id", session.activeTenant.id);

  if (itens && itens.length > 0) {
    const rows = itens
      .map((i: any) => {
        const novoGrupoId = grupoMap.get(i.grupo_id);
        if (!novoGrupoId) return null;
        return {
          ...i,
          tenant_id: session.activeTenant.id,
          versao_orcamento_id: nova.id,
          grupo_id: novoGrupoId,
          categoria_id: i.categoria_id,
        };
      })
      .filter((r): r is any => r !== null);

    if (rows.length > 0) {
      const { error: itensErr } = await supabase
        .from("versoes_orcamento_itens")
        .insert(rows);
      if (itensErr) {
        console.error("[versoes.duplicar.itens]", itensErr.message);
      }
    }
  }

  await logAuditEvent({
    acao: "versao_orcamento.criada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "versao_orcamento",
    entidadeId: nova.id,
    metadata: {
      orcamento_id: original.orcamento_id,
      numero_versao: numero,
      duplicada_de: versaoId,
    },
  });

  const projetoIdDup = orcDup?.projeto_id;

  revalidatePath(`/orcamentos/${projetoIdDup}/${original.orcamento_id}`);
  redirect(`/orcamentos/${projetoIdDup}/${original.orcamento_id}?v=${nova.id}`);
}

/**
 * Apaga a versão de verdade — grupos, itens e os BVs deles vão junto.
 *
 * Substituiu `cancelarVersao` em 21/08/2026. Cancelar marcava a versão como
 * `cancelada` e a deixava no banco, ainda visível e selecionável nas abas;
 * o Tiago apontou que isso não resolve nada, porque uma versão que continua
 * existindo e navegável já está resolvida por simplesmente NÃO ser aprovada
 * (decisão 023).
 *
 * Três coisas travam a exclusão, e as três respondem com texto em vez de
 * erro de FK:
 *
 * 1. **Versão aprovada** — apagá-la esvaziaria `orcamentos.versao_aprovada_id`
 *    em silêncio (a FK é ON DELETE SET NULL), desfazendo a aprovação sem
 *    passar pelo fluxo dela. Quem quer mesmo usa "Cancelar aprovação" antes.
 * 2. **Versão que virou job** — `jobs.versao_orcamento_aprovada_id` é ON
 *    DELETE RESTRICT, então o banco já barraria; aqui a recusa é legível.
 * 3. **Última versão do orçamento** — o orçamento nasce com a v1 e nunca
 *    ficou sem nenhuma. Deletar a última criaria um estado que só existe no
 *    código.
 *
 * O delete em si é UMA chamada à RPC `deletar_versao_orcamento`, e não três
 * deletes seguidos pelo PostgREST. Três chamadas são três transações: se a
 * última falhar, a versão fica no banco sem os itens e sem os grupos, em
 * silêncio. Aconteceu na conferência desta entrega, quando o GRANT de DELETE
 * ainda faltava. A RPC também fixa a ordem item → grupo → versão, que importa
 * porque `versoes_orcamento_itens.grupo_id` é ON DELETE RESTRICT (ver a
 * migration 20260821000005).
 */
export async function deletarVersao(versaoId: string): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "orcamentos.editar");
  if (!gate.ok) return gate;
  const supabase = createClient();

  const { data: atual } = await supabase
    .from("versoes_orcamento")
    .select("orcamento_id, numero_versao, status")
    .eq("id", versaoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{
      orcamento_id: string;
      numero_versao: number;
      status: string;
    }>();

  if (!atual) return { ok: false, message: "Versão não encontrada." };

  if (atual.status === "aprovada") {
    return {
      ok: false,
      message:
        'Versão aprovada não pode ser deletada. Use "Cancelar aprovação" antes.',
    };
  }

  const { count: jobsVinculados } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("versao_orcamento_aprovada_id", versaoId)
    .eq("tenant_id", session.activeTenant.id);

  if ((jobsVinculados ?? 0) > 0) {
    return {
      ok: false,
      message: "Esta versão gerou um job e não pode ser deletada.",
    };
  }

  const { count: totalVersoes } = await supabase
    .from("versoes_orcamento")
    .select("id", { count: "exact", head: true })
    .eq("orcamento_id", atual.orcamento_id)
    .eq("tenant_id", session.activeTenant.id);

  if ((totalVersoes ?? 0) <= 1) {
    return {
      ok: false,
      message:
        "O orçamento precisa de ao menos uma versão. Crie outra antes de deletar esta.",
    };
  }

  // O que a linha era, para a auditoria — depois do delete não há de onde ler.
  const { count: qtdItens } = await supabase
    .from("versoes_orcamento_itens")
    .select("id", { count: "exact", head: true })
    .eq("versao_orcamento_id", versaoId)
    .eq("tenant_id", session.activeTenant.id);

  const { error } = await supabase.rpc("deletar_versao_orcamento", {
    p_versao_id: versaoId,
  });

  if (error) {
    console.error("[versoes.deletar]", error.message);
    // Sobrou alguma FK que as checagens acima não previram — a planilha
    // interna de um job (`jobs_itens_orcado`) é a candidata. Dizer isso é
    // mais útil que repetir "não foi possível".
    const emUso = /foreign key|violates|referenced/i.test(error.message);
    return {
      ok: false,
      message: emUso
        ? "Não foi possível deletar: há dados de job apontando para os itens desta versão."
        : "Não foi possível deletar a versão.",
    };
  }

  await logAuditEvent({
    acao: "versao_orcamento.deletada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "versao_orcamento",
    entidadeId: versaoId,
    metadata: {
      orcamento_id: atual.orcamento_id,
      numero_versao: atual.numero_versao,
      status_anterior: atual.status,
      itens_apagados: qtdItens ?? 0,
    },
  });

  const { data: orcDel } = await supabase
    .from("orcamentos")
    .select("projeto_id")
    .eq("id", atual.orcamento_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ projeto_id: string }>();

  revalidatePath(`/orcamentos/${orcDel?.projeto_id}/${atual.orcamento_id}`);
  return { ok: true, id: versaoId };
}

// ============================================================
// GRUPOS
// ============================================================

async function loadVersaoParaGrupo(
  versaoId: string,
  tenantId: string,
): Promise<{ orcamento_id: string; projeto_id: string; status: string } | null> {
  const supabase = createClient();
  const { data: versao } = await supabase
    .from("versoes_orcamento")
    .select("orcamento_id, status")
    .eq("id", versaoId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ orcamento_id: string; status: string }>();
  if (!versao) return null;
  const { data: orc } = await supabase
    .from("orcamentos")
    .select("projeto_id")
    .eq("id", versao.orcamento_id)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ projeto_id: string }>();
  return { ...versao, projeto_id: orc?.projeto_id ?? "" };
}

async function proximaOrdemGrupo(
  versaoId: string,
  tenantId: string,
): Promise<number> {
  const supabase = createClient();
  const { data } = await supabase
    .from("versoes_orcamento_grupos")
    .select("ordem")
    .eq("versao_orcamento_id", versaoId)
    .eq("tenant_id", tenantId)
    .order("ordem", { ascending: false })
    .limit(1)
    .maybeSingle<{ ordem: number }>();
  return (data?.ordem ?? 0) + 1;
}

function mapGrupoDbError(msg: string): string {
  if (msg.includes("uniq_grupo_nome_por_versao")) {
    return "Já existe um grupo com esse nome nesta versão.";
  }
  // Modelo mensal: o nome é único dentro do MÊS (decisão 078).
  if (msg.includes("uniq_grupo_nome_por_mes")) {
    return "Já existe um grupo com esse nome neste mês.";
  }
  if (msg.includes("grupos_nome_nao_vazio")) {
    return "Nome do grupo não pode ficar vazio.";
  }
  return "Não foi possível salvar o grupo.";
}

export async function criarGrupo(
  versaoId: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "orcamentos.editar");
  if (!gate.ok) return gate;
  const parsed = grupoSchema.safeParse({
    nome: formData.get("nome")?.toString() ?? "",
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Nome inválido.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const versao = await loadVersaoParaGrupo(versaoId, session.activeTenant.id);
  if (!versao) return { ok: false, message: "Versão não encontrada." };
  if (versao.status === "aprovada") {
    return {
      ok: false,
      message: "Versão aprovada não aceita novos grupos.",
    };
  }

  const supabase = createClient();

  // No modelo mensal o grupo nasce DENTRO de um mês da versão (decisão
  // 078): sem mês ele ficaria fora de todas as abas da régua, invisível.
  // Nos demais modelos o campo é ignorado.
  const modelo = await modeloPlanilhaDoOrcamento(
    versao.orcamento_id,
    session.activeTenant.id,
  );
  let mesId: string | null = null;
  if (modelo === "mensal") {
    const pedido = formData.get("mes_id")?.toString() ?? "";
    const { data: mes } = pedido
      ? await supabase
          .from("versoes_orcamento_meses")
          .select("id")
          .eq("id", pedido)
          .eq("versao_orcamento_id", versaoId)
          .eq("tenant_id", session.activeTenant.id)
          .maybeSingle<{ id: string }>()
      : { data: null };
    if (!mes) {
      return {
        ok: false,
        message: "Escolha o mês do grupo antes de criá-lo.",
      };
    }
    mesId = mes.id;
  }

  const ordem = await proximaOrdemGrupo(versaoId, session.activeTenant.id);

  const { data, error } = await supabase
    .from("versoes_orcamento_grupos")
    .insert({
      tenant_id: session.activeTenant.id,
      versao_orcamento_id: versaoId,
      nome: parsed.data.nome,
      ordem,
      mes_id: mesId,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[grupos.criar]", error.message);
    return { ok: false, message: mapGrupoDbError(error.message) };
  }

  revalidatePath(`/orcamentos/${versao.projeto_id}/${versao.orcamento_id}`);
  return { ok: true, id: data.id };
}

export async function renomearGrupo(
  grupoId: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "orcamentos.editar");
  if (!gate.ok) return gate;
  const parsed = grupoSchema.safeParse({
    nome: formData.get("nome")?.toString() ?? "",
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Nome inválido.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();
  const { data: grupo } = await supabase
    .from("versoes_orcamento_grupos")
    .select("versao_orcamento_id")
    .eq("id", grupoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<Pick<VersaoOrcamentoGrupo, "versao_orcamento_id">>();

  if (!grupo) return { ok: false, message: "Grupo não encontrado." };

  const versao = await loadVersaoParaGrupo(
    grupo.versao_orcamento_id,
    session.activeTenant.id,
  );
  if (!versao) return { ok: false, message: "Versão não encontrada." };
  if (versao.status === "aprovada") {
    return { ok: false, message: "Versão aprovada não permite renomear grupo." };
  }

  const { error } = await supabase
    .from("versoes_orcamento_grupos")
    .update({ nome: parsed.data.nome })
    .eq("id", grupoId)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[grupos.renomear]", error.message);
    return { ok: false, message: mapGrupoDbError(error.message) };
  }

  revalidatePath(`/orcamentos/${versao.projeto_id}/${versao.orcamento_id}`);
  return { ok: true, id: grupoId };
}

/** Remove o grupo E os itens dele.
 *
 *  Até 04/09/2026 esta action recusava grupo com item dentro ("Remova os N
 *  itens do grupo antes de excluí-lo"). Numa planilha importada, com dezenas
 *  de linhas por grupo, isso virava trabalho manual que o sistema podia
 *  fazer — decisão do Tiago (04/09/2026): a lixeira do grupo leva os itens
 *  junto, e quem avisa é a confirmação da tela, que diz quantos são.
 *
 *  O delete vai por RPC (`deletar_grupo_orcamento`, migration
 *  20260904100001) porque itens e grupo precisam sair na MESMA transação:
 *  em duas chamadas separadas, se a segunda falhasse, os itens sumiriam e
 *  sobraria um grupo vazio que ninguém pediu. */
export async function removerGrupo(grupoId: string): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "orcamentos.editar");
  if (!gate.ok) return gate;
  const supabase = createClient();

  const { data: grupo } = await supabase
    .from("versoes_orcamento_grupos")
    .select("versao_orcamento_id, nome")
    .eq("id", grupoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<Pick<VersaoOrcamentoGrupo, "versao_orcamento_id" | "nome">>();

  if (!grupo) return { ok: false, message: "Grupo não encontrado." };

  const versao = await loadVersaoParaGrupo(
    grupo.versao_orcamento_id,
    session.activeTenant.id,
  );
  if (!versao) return { ok: false, message: "Versão não encontrada." };
  if (versao.status === "aprovada") {
    return { ok: false, message: "Versão aprovada não permite remover grupo." };
  }

  // Quantos itens saem junto — para a auditoria. Depois do delete não há de
  // onde ler.
  const { count } = await supabase
    .from("versoes_orcamento_itens")
    .select("id", { count: "exact", head: true })
    .eq("grupo_id", grupoId)
    .eq("tenant_id", session.activeTenant.id);

  const { error } = await supabase.rpc("deletar_grupo_orcamento", {
    p_grupo_id: grupoId,
  });

  if (error) {
    console.error("[grupos.remover]", error.message);
    // A versão não está aprovada, então job não deveria haver — mas
    // `jobs_itens_orcado` aponta para os itens com NO ACTION, e se sobrou
    // algum, dizer isso é mais útil que repetir "não foi possível".
    const emUso = /foreign key|violates|referenced/i.test(error.message);
    return {
      ok: false,
      message: emUso
        ? "Não foi possível remover: há dados de job apontando para os itens deste grupo."
        : "Não foi possível remover o grupo.",
    };
  }

  await logAuditEvent({
    acao: "grupo_orcamento.removido",
    tenantId: session.activeTenant.id,
    entidadeTipo: "grupo_orcamento",
    entidadeId: grupoId,
    metadata: {
      versao_orcamento_id: grupo.versao_orcamento_id,
      nome: grupo.nome,
      itens_apagados: count ?? 0,
    },
  });

  revalidatePath(`/orcamentos/${versao.projeto_id}/${versao.orcamento_id}`);
  return { ok: true, id: grupoId };
}

// ============================================================
// ITENS (agora sempre dentro de um grupo)
// ============================================================

/** O save do orçamento inteiro (decisão 154) recusa no banco a linha que
 *  passaria do saldo e a marca de save que contraria o modo da versão. As
 *  frases já vêm escritas para a tela ("Passa do saldo do TES-1003/26:
 *  restam…"); o resto continua virando a mensagem padrão da ação. */
function mensagemDoSaveDoOrcamento(msg: string, padrao: string): string {
  if (msg.startsWith("Passa do saldo") || msg.startsWith("Este orçamento inteiro")) {
    return msg;
  }
  return padrao;
}

function extractItemInput(formData: FormData) {
  return {
    item: formData.get("item")?.toString() ?? "",
    tipo_custo: (formData.get("tipo_custo")?.toString() ?? "A") as any,
    valor_unitario_orcado:
      formData.get("valor_unitario_orcado")?.toString() ?? "0",
    quantidade_orcada: formData.get("quantidade_orcada")?.toString() ?? "1",
    dias_meses_orcado: formData.get("dias_meses_orcado")?.toString() ?? "1",
    categoria_id: (formData.get("categoria_id")?.toString() || "") || null,
    valor_unitario_planejado:
      formData.get("valor_unitario_planejado")?.toString() ?? "0",
    quantidade_planejada:
      formData.get("quantidade_planejada")?.toString() ?? "0",
    dias_meses_planejado:
      formData.get("dias_meses_planejado")?.toString() ?? "0",
  };
}

async function proximaOrdemItem(
  versaoId: string,
  tenantId: string,
): Promise<number> {
  const supabase = createClient();
  const { data } = await supabase
    .from("versoes_orcamento_itens")
    .select("ordem")
    .eq("versao_orcamento_id", versaoId)
    .eq("tenant_id", tenantId)
    .order("ordem", { ascending: false })
    .limit(1)
    .maybeSingle<{ ordem: number }>();
  return (data?.ordem ?? 0) + 1;
}

async function assertVersaoEditavel(
  versaoId: string,
  tenantId: string,
): Promise<{ orcamento_id: string; projeto_id: string } | { error: string }> {
  const supabase = createClient();
  const { data } = await supabase
    .from("versoes_orcamento")
    .select("orcamento_id, status")
    .eq("id", versaoId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ orcamento_id: string; status: string }>();

  if (!data) return { error: "Versão não encontrada." };
  if (data.status === "aprovada") {
    return { error: "Versão aprovada não permite alterar itens." };
  }
  const { data: orc } = await supabase
    .from("orcamentos")
    .select("projeto_id")
    .eq("id", data.orcamento_id)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ projeto_id: string }>();
  return { orcamento_id: data.orcamento_id, projeto_id: orc?.projeto_id ?? "" };
}

export async function adicionarItem(
  grupoId: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "orcamentos.editar");
  if (!gate.ok) return gate;
  const parsed = itemSchema.safeParse(extractItemInput(formData));

  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();
  const { data: grupo } = await supabase
    .from("versoes_orcamento_grupos")
    .select("id, versao_orcamento_id")
    .eq("id", grupoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ id: string; versao_orcamento_id: string }>();

  if (!grupo) return { ok: false, message: "Grupo não encontrado." };

  const check = await assertVersaoEditavel(
    grupo.versao_orcamento_id,
    session.activeTenant.id,
  );
  if ("error" in check) return { ok: false, message: check.error };

  const ordem = await proximaOrdemItem(
    grupo.versao_orcamento_id,
    session.activeTenant.id,
  );

  const { data, error } = await supabase
    .from("versoes_orcamento_itens")
    .insert({
      ...parsed.data,
      tenant_id: session.activeTenant.id,
      versao_orcamento_id: grupo.versao_orcamento_id,
      grupo_id: grupo.id,
      ordem,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[itens.adicionar]", error.message);
    return {
      ok: false,
      message: mensagemDoSaveDoOrcamento(error.message, "Não foi possível adicionar o item."),
    };
  }

  revalidatePath(`/orcamentos/${check.projeto_id}/${check.orcamento_id}`);
  return { ok: true, id: data.id };
}

export async function atualizarItem(
  itemId: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "orcamentos.editar");
  if (!gate.ok) return gate;
  const parsed = itemSchema.safeParse(extractItemInput(formData));

  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();
  const { data: item } = await supabase
    .from("versoes_orcamento_itens")
    .select("versao_orcamento_id")
    .eq("id", itemId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<Pick<VersaoOrcamentoItem, "versao_orcamento_id">>();

  if (!item) return { ok: false, message: "Item não encontrado." };

  const check = await assertVersaoEditavel(
    item.versao_orcamento_id,
    session.activeTenant.id,
  );
  if ("error" in check) return { ok: false, message: check.error };

  const { error } = await supabase
    .from("versoes_orcamento_itens")
    .update(parsed.data)
    .eq("id", itemId)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[itens.atualizar]", error.message);
    return {
      ok: false,
      message: mensagemDoSaveDoOrcamento(error.message, "Não foi possível atualizar o item."),
    };
  }

  revalidatePath(`/orcamentos/${check.projeto_id}/${check.orcamento_id}`);
  return { ok: true, id: itemId };
}

/**
 * Grava UM campo de UM item — usada pela edição inline da planilha.
 * `campo` chega do cliente, então passa pela allowlist antes de virar
 * UPDATE. Os totais são colunas GENERATED: o banco recalcula sozinho.
 */
/** Tipos em que o cliente paga o fornecedor direto — os únicos com BV. */

/**
 * Chamado quando um item deixa de ser tipo A, AR ou D. O BV só faz sentido
 * nesses dois (é neles que o cliente paga o fornecedor direto e sobra
 * comissão), então a troca de tipo tem que decidir o destino do BV que
 * estava lá.
 *
 * - `a_negociar` → cancela junto, mesmo mecanismo do botão "Remover BV".
 * - `confirmado` / `recebido` → BLOQUEIA a troca de tipo. O BV já foi ao
 *   financeiro; cancelá-lo por um efeito colateral de outra célula seria
 *   apagar dinheiro sem que ninguém pedisse.
 *
 * Retorna a mensagem de bloqueio, ou null quando a troca pode seguir.
 */
async function resolverBvAoSairDoTipoComBv(
  itemId: string,
  tenantId: string,
  itemNome: string,
): Promise<string | null> {
  const supabase = createClient();

  const { data: bv } = await supabase
    .from("itens_bv")
    .select("id, valor, situacao")
    .eq("item_versao_id", itemId)
    .eq("tenant_id", tenantId)
    .neq("situacao", "cancelado")
    .maybeSingle<{ id: string; valor: number; situacao: string }>();

  if (!bv) return null;

  if (bv.situacao !== "a_negociar") {
    return bv.situacao === "recebido"
      ? "Este item tem BV já recebido. Não é possível mudar o tipo de custo."
      : "Este item tem BV já confirmado e enviado ao financeiro. Não é possível mudar o tipo de custo.";
  }

  const { error } = await supabase
    .from("itens_bv")
    .update({ situacao: "cancelado" })
    .eq("id", bv.id)
    .eq("tenant_id", tenantId);

  if (error) {
    console.error("[itens.tipoCusto.cancelaBv]", error.message);
    return "Não foi possível cancelar o BV deste item. Tipo de custo não alterado.";
  }

  await logAuditEvent({
    acao: "item_bv.cancelado",
    tenantId,
    entidadeTipo: "item_bv",
    entidadeId: bv.id,
    metadata: {
      item_versao_id: itemId,
      item: itemNome,
      valor: bv.valor,
      motivo: "tipo_custo_perdeu_bv",
    },
  });

  return null;
}

/** As três colunas do bloco PLANEJADO — as que `A` e `D` não digitam. */
const CAMPOS_PLANEJADO_DO_ITEM: readonly string[] = [
  "valor_unitario_planejado",
  "quantidade_planejada",
  "dias_meses_planejado",
];

export async function atualizarCampoItem(
  itemId: string,
  campo: string,
  valor: string | null,
): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "orcamentos.editar");
  if (!gate.ok) return gate;

  if (!isCampoItemEditavel(campo)) {
    return { ok: false, message: "Campo não editável." };
  }

  const parsed = camposItemEditaveis[campo].safeParse(valor ?? undefined);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.errors[0]?.message ?? "Valor inválido.",
    };
  }

  const supabase = createClient();

  // Um único round-trip: item + versão (embed to-one, payload mínimo).
  // Esta é a escrita de maior frequência do app — cada Enter numa célula
  // chega aqui, então não dá para encadear consultas como no atualizarItem.
  const { data: item, error: loadError } = await supabase
    .from("versoes_orcamento_itens")
    .select(
      "item, tipo_custo, versao_orcamento_id, " +
        "versao:versoes_orcamento!inner(orcamento_id, status)",
    )
    .eq("id", itemId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{
      item: string;
      tipo_custo: TipoCusto;
      versao_orcamento_id: string;
      versao: { orcamento_id: string; status: string };
    }>();

  if (loadError) {
    console.error("[itens.atualizarCampo.load]", loadError.message);
    return { ok: false, message: "Não foi possível carregar o item." };
  }
  if (!item?.versao) return { ok: false, message: "Item não encontrado." };
  if (item.versao.status === "aprovada") {
    // Com o job devolvido pelo financeiro, o planejado da versão aprovada
    // se corrige sem cancelar a aprovação (decisão 128). A RPC confere o
    // job devolvido, o save e o Interno, e grava a versão e a cópia do job
    // numa transação só. Qualquer outro campo continua travado.
    if (CAMPOS_PLANEJADO_DO_ITEM.includes(campo)) {
      return corrigirPlanejadoDoJobDevolvido(
        session,
        itemId,
        campo,
        Number(parsed.data),
        item.versao.orcamento_id,
      );
    }
    return { ok: false, message: "Versão aprovada não permite alterar itens." };
  }

  // BV só existe em item tipo A, AR ou D. Sair desses tipos tem que resolver
  // o BV que estava lá, senão ele fica órfão no banco e invisível na
  // tela. A consulta extra só roda nesse caso: o caminho quente (cada
  // Enter numa célula numérica) continua com um round-trip só.
  if (campo === "tipo_custo" && !aceitaBV(String(parsed.data))) {
    const bloqueio = await resolverBvAoSairDoTipoComBv(
      itemId,
      session.activeTenant.id,
      item.item,
    );
    if (bloqueio) return { ok: false, message: bloqueio };
  }

  // ⚠️ Aqui ficava a recusa de gravar planejado em item `A`/`D`, que
  // espelhava o orçado. Ela saiu em 08/09/2026 (decisão 062): os dois
  // tipos voltaram a ter planejado digitado, como o `AR` sempre teve.
  //
  // O que continua valendo é o zeramento da linha em SAVE, e ele mora no
  // trigger `trg_planejado_espelha_orcado` — são seis caminhos de escrita
  // chegando nesta tabela, e replicar a regra em cada um é como ela se
  // perde.
  const { error } = await supabase
    .from("versoes_orcamento_itens")
    .update({ [campo]: parsed.data })
    .eq("id", itemId)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[itens.atualizarCampo]", campo, error.message);
    return {
      ok: false,
      message: mensagemDoSaveDoOrcamento(error.message, "Não foi possível salvar a alteração."),
    };
  }

  const { data: orcCampo } = await supabase
    .from("orcamentos")
    .select("projeto_id")
    .eq("id", item.versao.orcamento_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ projeto_id: string }>();
  const projetoIdCampo = orcCampo?.projeto_id;

  revalidatePath(`/orcamentos/${projetoIdCampo}/${item.versao.orcamento_id}`);
  return { ok: true, id: itemId };
}

/**
 * Planejado da versão aprovada com o job devolvido (decisão 128). Não
 * exportada: todo export async de arquivo "use server" vira Server Action.
 */
async function corrigirPlanejadoDoJobDevolvido(
  session: Awaited<ReturnType<typeof requireSession>>,
  itemId: string,
  campo: string,
  valor: number,
  orcamentoId: string,
): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.rpc("editar_planejado_do_job_devolvido", {
    p_item_id: itemId,
    p_campo: campo,
    p_valor: valor,
  });

  if (error) {
    console.error("[itens.planejado_devolvido]", campo, error.message);
    // As recusas da RPC já vêm escritas para a tela; o resto é técnico.
    const daRegra = ["42501", "23514", "P0002"].includes(error.code ?? "") &&
      !/row-level security/i.test(error.message);
    return {
      ok: false,
      message: daRegra ? error.message : "Não foi possível salvar a alteração.",
    };
  }

  await logAuditEvent({
    acao: "item_versao.planejado_corrigido_na_devolucao",
    tenantId: session.activeTenant.id,
    entidadeTipo: "item_versao",
    entidadeId: itemId,
    metadata: { campo, valor, orcamento_id: orcamentoId, decisao: "128" },
  });

  const { data: orc } = await supabase
    .from("orcamentos")
    .select("projeto_id")
    .eq("id", orcamentoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ projeto_id: string }>();
  revalidatePath(`/orcamentos/${orc?.projeto_id}/${orcamentoId}`);
  return { ok: true, id: itemId };
}

export async function removerItem(itemId: string): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "orcamentos.editar");
  if (!gate.ok) return gate;
  const supabase = createClient();

  const { data: item } = await supabase
    .from("versoes_orcamento_itens")
    .select("versao_orcamento_id")
    .eq("id", itemId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<Pick<VersaoOrcamentoItem, "versao_orcamento_id">>();

  if (!item) return { ok: false, message: "Item não encontrado." };

  const check = await assertVersaoEditavel(
    item.versao_orcamento_id,
    session.activeTenant.id,
  );
  if ("error" in check) return { ok: false, message: check.error };

  const { error } = await supabase
    .from("versoes_orcamento_itens")
    .delete()
    .eq("id", itemId)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[itens.remover]", error.message);
    return { ok: false, message: "Não foi possível remover o item." };
  }

  revalidatePath(`/orcamentos/${check.projeto_id}/${check.orcamento_id}`);
  return { ok: true, id: itemId };
}

/**
 * Muda o item de lugar na planilha — decisão 104. Vem da alça de arrastar
 * e do Alt + ↑ ↓ da tela da versão.
 *
 * `indice` é a posição entre os itens do grupo de destino SEM o item que
 * se move, como a linha de inserção da tela a mede. A regra do movimento
 * e a renumeração moram em `lib/calculos/ordem-itens.ts`; aqui se lê a
 * ordem ATUAL do banco (não a da tela, que pode estar atrasada), aplica o
 * movimento e grava só o que mudou, numa transação (RPC
 * `aplicar_ordem_itens_versao`).
 *
 * Trava igual à da edição de célula (resposta do Tiago, 24/09/2026):
 * permissão `orcamentos.editar` e versão que não está aprovada nem
 * cancelada. O item pode trocar de agrupamento, mas só dentro da versão.
 */
export async function moverItem(
  itemId: string,
  grupoDestinoId: string,
  indice: number,
): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "orcamentos.editar");
  if (!gate.ok) return gate;
  if (!Number.isInteger(indice) || indice < 0) {
    return { ok: false, message: "Posição inválida." };
  }

  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  const { data: item, error: loadError } = await supabase
    .from("versoes_orcamento_itens")
    .select(
      "versao_orcamento_id, versao:versoes_orcamento!inner(orcamento_id, status)",
    )
    .eq("id", itemId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{
      versao_orcamento_id: string;
      versao: { orcamento_id: string; status: string };
    }>();

  if (loadError) {
    console.error("[itens.mover.load]", loadError.message);
    return { ok: false, message: "Não foi possível carregar o item." };
  }
  if (!item?.versao) return { ok: false, message: "Item não encontrado." };
  if (item.versao.status === "aprovada" || item.versao.status === "cancelada") {
    return {
      ok: false,
      message: `Versão ${item.versao.status} não permite mudar a ordem dos itens.`,
    };
  }

  const versaoId = item.versao_orcamento_id;
  const [gruposRes, itensRes, orcRes] = await Promise.all([
    supabase
      .from("versoes_orcamento_grupos")
      .select("id, ordem")
      .eq("versao_orcamento_id", versaoId)
      .eq("tenant_id", tenantId),
    supabase
      .from("versoes_orcamento_itens")
      .select("id, grupo_id, ordem")
      .eq("versao_orcamento_id", versaoId)
      .eq("tenant_id", tenantId),
    supabase
      .from("orcamentos")
      .select("projeto_id")
      .eq("id", item.versao.orcamento_id)
      .eq("tenant_id", tenantId)
      .maybeSingle<{ projeto_id: string }>(),
  ]);

  if (gruposRes.error || itensRes.error) {
    console.error(
      "[itens.mover.ordem]",
      gruposRes.error?.message ?? itensRes.error?.message,
    );
    return { ok: false, message: "Não foi possível ler a ordem da planilha." };
  }

  const grupos = (gruposRes.data ?? []) as { id: string; ordem: number }[];
  const itens = (itensRes.data ?? []) as {
    id: string;
    grupo_id: string;
    ordem: number;
  }[];
  if (!grupos.some((g) => g.id === grupoDestinoId)) {
    return { ok: false, message: "O agrupamento de destino não é desta versão." };
  }

  const movido = moverNaLista(
    gruposNaOrdemDaTela(grupos, itens),
    itemId,
    grupoDestinoId,
    indice,
  );
  // Nada mudou (mesmo lugar): não é erro, a tela já está certa.
  if (!movido) return { ok: true, id: itemId };

  const alteradas = ordensAlteradas(itens, numerarItens(movido));
  if (alteradas.length > 0) {
    const { error } = await supabase.rpc("aplicar_ordem_itens_versao", {
      p_versao_id: versaoId,
      p_itens: alteradas,
    });
    if (error) {
      console.error("[itens.mover]", error.message);
      return { ok: false, message: "Não foi possível mudar o item de lugar." };
    }
  }

  revalidatePath(`/orcamentos/${orcRes.data?.projeto_id}/${item.versao.orcamento_id}`);
  return { ok: true, id: itemId };
}

// ============================================================
// APROVAÇÃO
// ============================================================

/**
 * O consumo de save da versão cabe no saldo APROVADO de cada origem?
 * (decisão 099, 22/09/2026). Devolve a recusa, ou `null`.
 *
 * Só para a aprovação: o consumo da versão em rascunho ainda não segura
 * saldo, então o que cabe é o `disponivel` de `vw_saves_por_job` inteiro
 * (a view já desconta o que outros jobs usam e o que está reservado por
 * pedido aguardando). Origem fora da view não tem save aprovado nenhum.
 *
 * Não exportada: todo export async de arquivo "use server" vira Server
 * Action.
 */
async function barrarConsumoSemSaldoAprovado(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  consumos: { job_origem_id: string; valor: number | string }[],
): Promise<string | null> {
  const porOrigem = new Map<string, number>();
  for (const c of consumos) {
    porOrigem.set(c.job_origem_id, (porOrigem.get(c.job_origem_id) ?? 0) + Number(c.valor ?? 0));
  }
  const origens = [...porOrigem.keys()];
  if (origens.length === 0) return null;

  const [saldosRes, jobsRes] = await Promise.all([
    supabase
      .from("vw_saves_por_job")
      .select("job_id, disponivel")
      .eq("tenant_id", tenantId)
      .in("job_id", origens),
    supabase.from("jobs").select("id, codigo").eq("tenant_id", tenantId).in("id", origens),
  ]);
  if (saldosRes.error) {
    console.error("[versao.aprovar.saldo_save]", saldosRes.error.message);
    return "Não foi possível conferir o saldo de save aprovado. Tente de novo.";
  }
  const disponivel = new Map<string, number>(
    ((saldosRes.data ?? []) as { job_id: string; disponivel: number | string | null }[]).map(
      (r) => [r.job_id, Number(r.disponivel ?? 0)],
    ),
  );
  const codigo = new Map<string, string>(
    ((jobsRes.data ?? []) as { id: string; codigo: string }[]).map((j) => [j.id, j.codigo]),
  );

  for (const [origem, consome] of porOrigem) {
    const disp = Math.max(0, disponivel.get(origem) ?? 0);
    if (consome <= disp + 0.005) continue;
    const cod = codigo.get(origem) ?? "job de origem";
    return (
      `A versão consome ${formatCurrency(consome)} do saldo de save do ${cod}, ` +
      `e o saldo aprovado disponível dele é de ${formatCurrency(disp)}. ` +
      `Ajuste o consumo nesta versão, ou espere o financeiro aprovar o save do ${cod}.`
    );
  }
  return null;
}

export async function aprovarVersao(versaoId: string): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "orcamentos.aprovar");
  // O produtor vê o "Aprovar versão" na barra do rodapé (Tiago, 19/10/2026:
  // o botão fica). A recusa diz quem aprova, no lugar do "Você não tem
  // permissão para essa ação." genérico.
  if (!gate.ok) {
    return {
      ...gate,
      message: "Só o GP pode aprovar a versão. Peça a aprovação ao GP responsável pelo orçamento.",
    };
  }
  return aprovarVersaoInterna(session, versaoId, "tela");
}

/**
 * A aprovação do Comitê de Aprovações (decisão 223): basta um membro (ou o
 * administrador). Confere tudo o que o "Aprovar versão" confere — menos a
 * regra do Comitê, que é o que ele decide —, marca o pedido como aprovado
 * e aprova a versão em nome de quem decidiu. O banco aceita porque o pedido
 * aprovado cobre a versão (`comite_situacao_da_versao`).
 */
export async function aprovarVersaoPeloComite(
  pedidoId: string,
  comentario: string | null = null,
): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = createClient();
  const tenantId = session.activeTenant.id;
  const { data: podeDecidir } = await supabase.rpc("pode_decidir_no_comite", { p_tenant_id: tenantId });
  if (podeDecidir !== true) {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId,
      entidadeTipo: "comite_pedido",
      entidadeId: pedidoId,
      metadata: { acao_tentada: "comite.aprovar", motivo: "fora_do_comite" },
    });
    return { ok: false, message: "Só um membro do Comitê de Aprovações decide este pedido." };
  }
  const { data: pedido } = await supabase
    .from("comite_pedidos")
    .select("id, tipo, status, versao_orcamento_id")
    .eq("id", pedidoId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ id: string; tipo: string; status: string; versao_orcamento_id: string | null }>();
  if (!pedido || pedido.tipo !== "versao" || !pedido.versao_orcamento_id) {
    return { ok: false, message: "Pedido não encontrado." };
  }
  if (pedido.status !== "pendente") {
    return { ok: false, message: "Este pedido já foi decidido ou cancelado. Recarregue a página." };
  }

  // Tudo o que barraria a aprovação, antes de marcar o pedido: depois de
  // aprovado, ele não volta a pendente.
  const conferencia = await aprovarVersaoInterna(session, pedido.versao_orcamento_id, "conferir");
  if (!conferencia.ok) return conferencia;

  const { error: errPedido } = await supabase
    .from("comite_pedidos")
    .update({ status: "aprovado", comentario: comentario?.trim().slice(0, 2000) || null })
    .eq("id", pedidoId)
    .eq("tenant_id", tenantId)
    .eq("status", "pendente");
  if (errPedido) {
    console.error("[comite.aprovar.versao]", errPedido.message);
    return { ok: false, message: "Não foi possível registrar a aprovação." };
  }
  await logAuditEvent({
    acao: "comite.pedido_aprovado",
    tenantId,
    entidadeTipo: "comite_pedido",
    entidadeId: pedidoId,
    metadata: { tipo: "versao", versao_orcamento_id: pedido.versao_orcamento_id },
  });

  const res = await aprovarVersaoInterna(session, pedido.versao_orcamento_id, "comite");
  if (!res.ok) {
    return {
      ok: false,
      message: `O pedido foi aprovado, mas a versão não: ${res.message} Quando resolver, o GP aprova a versão direto na tela.`,
    };
  }
  revalidatePath("/comite");
  return res;
}

/**
 * "Solicitar aprovação" (decisão 223): a versão esbarra numa regra ligada do
 * Comitê. Confere o resto da aprovação antes (não faz sentido o Comitê
 * aprovar uma versão que não pode ser aprovada) e grava o pedido com o
 * motivo. Enquanto o Comitê decide, a versão fica travada (o banco trava).
 */
export async function solicitarAprovacaoDaVersao(
  versaoId: string,
  motivo: string,
): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "orcamentos.aprovar");
  if (!gate.ok) {
    return {
      ...gate,
      message: "Só o GP pode solicitar a aprovação da versão.",
    };
  }
  const texto = motivo.trim();
  if (!texto) return { ok: false, message: "Escreva o motivo para enviar." };
  if (texto.length > 2000) return { ok: false, message: "O motivo passou de 2.000 caracteres." };
  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  const { data: situacao } = await supabase.rpc("comite_situacao_da_versao", { p_versao_id: versaoId });
  const s = situacao as { regra?: boolean; direto?: boolean; coberta?: boolean } | null;
  if (!s?.regra || s.direto || s.coberta) {
    return { ok: false, message: "Esta versão não precisa do Comitê. Recarregue a página e aprove direto." };
  }

  const conferencia = await aprovarVersaoInterna(session, versaoId, "conferir");
  if (!conferencia.ok) return conferencia;

  const { data: pedido, error } = await supabase
    .from("comite_pedidos")
    .insert({
      tenant_id: tenantId,
      tipo: "versao",
      // O orçamento, o retrato e quem enviou, o banco preenche
      // (`comite_pedido_guarda`).
      versao_orcamento_id: versaoId,
      motivo: texto,
      enviado_por: session.profile.id,
    })
    .select("id, orcamento_id")
    .single<{ id: string; orcamento_id: string }>();
  if (error || !pedido) {
    console.error("[comite.solicitar.versao]", error?.message);
    return {
      ok: false,
      message: error?.code === "23505"
        ? "Já há uma versão deste orçamento aguardando o Comitê."
        : "Não foi possível solicitar a aprovação.",
    };
  }
  await logAuditEvent({
    acao: "comite.pedido_enviado",
    tenantId,
    entidadeTipo: "comite_pedido",
    entidadeId: pedido.id,
    metadata: { tipo: "versao", versao_orcamento_id: versaoId, orcamento_id: pedido.orcamento_id },
  });
  const { data: orc } = await supabase
    .from("orcamentos")
    .select("projeto_id")
    .eq("id", pedido.orcamento_id)
    .maybeSingle<{ projeto_id: string }>();
  if (orc) revalidatePath(`/orcamentos/${orc.projeto_id}/${pedido.orcamento_id}`);
  revalidatePath("/comite");
  return { ok: true, id: pedido.id };
}

/**
 * - `tela`: o "Aprovar versão" de quem tem `orcamentos.aprovar`; a regra do
 *   Comitê barra (decisão 223).
 * - `conferir`: só as conferências, sem gravar (antes de o Comitê aprovar).
 * - `comite`: a gravação da aprovação do Comitê.
 */
async function aprovarVersaoInterna(
  session: Awaited<ReturnType<typeof requireSession>>,
  versaoId: string,
  modo: "tela" | "conferir" | "comite",
): Promise<ActionResult> {
  const supabase = createClient();

  // 1. Fetch versão + orçamento (com projeto_id pra revalidatePath)
  const { data: versao, error: errVer } = await supabase
    .from("versoes_orcamento")
    .select(
      "id, status, orcamento_id, tenant_id, percentual_imposto, percentual_honorarios, percentual_int_taxes, int_transaction_costs, base_honorarios, percentual_veiculo, moeda_estrangeira, cambio_compra, cambio_cotacao, cambio_venda, cambio_data, excecao_fechamento_motivo",
    )
    .eq("id", versaoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{
      id: string;
      status: string;
      orcamento_id: string;
      tenant_id: string;
      excecao_fechamento_motivo: string | null;
      percentual_imposto: number;
      percentual_honorarios: number;
      percentual_int_taxes: number | null;
      int_transaction_costs: number | null;
      base_honorarios: string | null;
      percentual_veiculo: number | null;
      moeda_estrangeira: string | null;
      cambio_compra: number | string | null;
      cambio_cotacao: number | string | null;
      cambio_venda: number | string | null;
      cambio_data: string | null;
    }>();

  if (errVer || !versao) {
    return { ok: false, message: "Versão não encontrada." };
  }

  if (!["rascunho", "em_revisao", "enviada_cliente"].includes(versao.status)) {
    return {
      ok: false,
      message: `Versão em status ${versao.status} não pode ser aprovada.`,
    };
  }


  // 2. Fetch orçamento pra validar status + projeto_id
  const { data: orc } = await supabase
    .from("orcamentos")
    // `!categoria_id`: `orcamentos` tem duas FKs para `categorias_dominio`.
    // `servico_id` e `categoria_id`: o par serviço × categoria aprova só
    // quando combina (revisão da decisão 149, 07/10/2026).
    // `servico` traz a marca do Interno, que fica fora da decisão 204.
    .select("status, projeto_id, servico_id, categoria_id, categoria:categorias_dominio!categoria_id(modelo_planilha), servico:categorias_dominio!servico_id(investimento_interno)")
    .eq("id", versao.orcamento_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{
      status: string;
      projeto_id: string;
      servico_id: string | null;
      categoria_id: string | null;
      categoria: { modelo_planilha: CategoriaModeloPlanilha } | null;
      servico: { investimento_interno: boolean } | null;
    }>();

  if (!orc) {
    return { ok: false, message: "Orçamento não encontrado." };
  }

  if (["job_criado", "aprovado", "cancelado"].includes(orc.status)) {
    return {
      ok: false,
      message: `Orçamento em status ${orc.status} não aceita nova aprovação.`,
    };
  }

  // 3. Verificar que a versão tem item E que ao menos um deles tem valor.
  //    Linha criada e não preenchida tem total_orcado 0 (coluna gerada:
  //    unitário × quantidade × dias). Aprovar assim travaria a versão e
  //    abriria job com orçado zerado.
  const [
    consumosRes,
    itensLimitesRes,
  ] =
    await Promise.all([
      // Item com orçado zerado NÃO bloqueia desde 01/10/2026 (revisão da
      // decisão 011): é o item da casa, mostrado ao cliente sem cobrança.
      // O consumo de save da versão (decisão 099): a aprovação passa a
      // segurar saldo, e só save APROVADO conta. O `!inner` é filtro, não
      // embed: uma FK só entre as duas tabelas.
      supabase
        .from("saves_consumos")
        .select("job_origem_id, valor, item:versoes_orcamento_itens!inner(versao_orcamento_id)")
        .eq("tenant_id", session.activeTenant.id)
        .eq("item.versao_orcamento_id", versaoId)
        .is("substituido_em", null),
      supabase
        .from("versoes_orcamento_itens")
        .select("tipo_custo, total_orcado, total_planejado, em_save, save_consumido")
        .eq("versao_orcamento_id", versaoId)
        .eq("tenant_id", session.activeTenant.id),
    ]);

  // Modelo mensal (decisão 078) e Mídia Off (decisão 147): todo mês da
  // versão precisa ter item. Lido do banco aqui, e não da tela: a regra
  // não pode depender do cliente.
  const modeloDaVersao = orc.categoria?.modelo_planilha ?? "nacional";
  const porMes = modeloDaVersao === "mensal" || modeloDaVersao === "midia_off";
  const [mesesVazios, semVeiculo, par] = await Promise.all([
    porMes
      ? mesesSemItensDaVersao(supabase, session.activeTenant.id, versaoId)
      : Promise.resolve(null),
    // Mídia Off (resposta b do Tiago, 04/10/2026): toda linha com veículo.
    modeloDaVersao === "midia_off"
      ? supabase
          .from("versoes_orcamento_itens")
          .select("id", { count: "exact", head: true })
          .eq("versao_orcamento_id", versaoId)
          .eq("tenant_id", session.activeTenant.id)
          .is("fornecedor_id", null)
      : Promise.resolve(null),
    erroDoParDoOrcamento(
      supabase,
      session.activeTenant.id,
      orc.servico_id,
      orc.categoria_id,
    ),
  ]);
  if (!par.ok) return { ok: false, message: par.message };
  if (porMes && mesesVazios === null) {
    return {
      ok: false,
      message: "Não foi possível conferir os meses da versão. Tente de novo.",
    };
  }
  if (semVeiculo?.error) {
    console.error("[versao.aprovar.veiculo]", semVeiculo.error.message);
    return { ok: false, message: "Não foi possível conferir os veículos das linhas." };
  }

  if (itensLimitesRes.error) {
    return { ok: false, message: "Não foi possível conferir os limites da versão. Tente novamente." };
  }

  // Alíquota escolhida + item com valor. Mesma função do botão "Aprovar
  // versão", para a tela e o servidor nunca discordarem do motivo.
  const bloqueio = bloqueioAprovacaoVersao({
    parServicoCategoria: par.erro,
    percentualImposto: Number(versao.percentual_imposto),
    // Internacional exige o câmbio inteiro (decisão 072, 14/09/2026).
    cambioInternacional:
      orc.categoria?.modelo_planilha === "internacional"
        ? {
            moeda: versao.moeda_estrangeira,
            compra: versao.cambio_compra,
            cotacao: versao.cambio_cotacao,
            venda: versao.cambio_venda,
            data: versao.cambio_data,
          }
        : null,
    // Fora do padrão, só com exceção do administrador (decisão 206).
    fechamentoInternacional:
      orc.categoria?.modelo_planilha === "internacional"
        ? {
            taxas: {
              intTaxes: Number(versao.percentual_int_taxes ?? 0),
              imposto: Number(versao.percentual_imposto ?? 0),
              itc: Number(versao.int_transaction_costs ?? 0),
            },
            comExcecao: versao.excecao_fechamento_motivo !== null,
          }
        : null,
    qtdItens: itensLimitesRes.data?.length ?? 0,
    qtdItensComValor: itensLimitesRes.data?.filter((i) => Number(i.total_orcado) > 0).length ?? 0,
    mesesSemItens: mesesVazios,
    linhasSemVeiculo: semVeiculo ? (semVeiculo.count ?? 0) : null,
  });

  if (bloqueio) {
    return { ok: false, message: bloqueio };
  }

  // A regra do Comitê de Aprovações (decisão 223, no lugar do "só o
  // administrador" da 204). A conta é a do banco, a mesma do gatilho
  // `versao_confere_limites_na_aprovacao`: a tela nunca discorda do motivo.
  if (modo === "tela") {
    const [situacaoRes, pendenteRes] = await Promise.all([
      supabase.rpc("comite_situacao_da_versao", { p_versao_id: versaoId }),
      supabase
        .from("comite_pedidos")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", session.activeTenant.id)
        .eq("tipo", "versao")
        .eq("orcamento_id", versao.orcamento_id)
        .eq("status", "pendente"),
    ]);
    if ((pendenteRes.count ?? 0) > 0) {
      return {
        ok: false,
        message: "Há uma versão deste orçamento aguardando aprovação do Comitê. Cancele o envio para aprovar outra.",
      };
    }
    const s = situacaoRes.data as {
      regra?: boolean;
      direto?: boolean;
      coberta?: boolean;
      itens_acima?: number;
      resultado_geral?: number | null;
    } | null;
    if (s?.regra && !s.direto && !s.coberta) {
      const regras = await carregarRegrasDoComite(supabase, session.activeTenant.id);
      const motivos = motivosDaVersaoNoComite(
        regras,
        { itensAcima: Number(s.itens_acima ?? 0), resultadoGeral: s.resultado_geral ?? null },
        orc.servico?.investimento_interno === true,
      );
      await logAuditEvent({
        acao: "acao_negada",
        tenantId: session.activeTenant.id,
        entidadeTipo: "versao_orcamento",
        entidadeId: versaoId,
        metadata: { acao_tentada: "orcamentos.aprovar", motivo: "comite_de_aprovacoes", resultado_geral: s.resultado_geral ?? null },
      });
      return {
        ok: false,
        message: `Esta versão precisa da aprovação do Comitê de Aprovações: ${motivos.join(" e ")}. Solicite a aprovação.`,
      };
    }
  }

  // 3a. O consumo de save da versão cabe no saldo APROVADO de cada origem
  //     (decisão 099, 22/09/2026)? No rascunho ele só avisa (decisão 028);
  //     a aprovação o firma, e o banco revalida no UPDATE abaixo
  //     (`save_valida_versao_aprovada`) — mas com a mensagem crua do
  //     trigger. Aqui a recusa chega antes, com o job de origem e o
  //     disponível. O consumo desta versão ainda não está no `usado` da
  //     view (rascunho não segura saldo), então a conta é direta.
  if (consumosRes.error) {
    console.error("[versao.aprovar.consumos]", consumosRes.error.message);
    return { ok: false, message: "Não foi possível conferir o consumo de save da versão." };
  }
  const semSaldo = await barrarConsumoSemSaldoAprovado(
    supabase,
    session.activeTenant.id,
    (consumosRes.data ?? []) as { job_origem_id: string; valor: number | string }[],
  );
  if (semSaldo) return { ok: false, message: semSaldo };

  const agora = new Date().toISOString();

  // 3b. ⚠️ O CONGELAMENTO DO BV NO PLANEJADO SAIU EM 08/09/2026.
  //
  // Entre 21/08 e 08/09/2026 a aprovação gravava
  // `versoes_orcamento_itens.bv_liquido_planejado`, para que editar o BV
  // depois — já na planilha do job — não reescrevesse retroativamente o
  // custo planejado da versão aprovada (decisão 022 §3).
  //
  // A decisão 062 tirou o BV do planejado: ele desconta só o REALIZADO.
  // Sem dedução no planejado não há o que congelar, e insistir no
  // congelamento seria pior que inútil — desde a 062 um item pode ter
  // VÁRIOS BVs, cada um com alíquota própria, e o valor único desta
  // coluna não representaria nenhum deles.
  //
  // A coluna continua no banco com o que já foi congelado antes da
  // mudança. É histórico, e ninguém mais a lê.

  if (modo === "conferir") return { ok: true, id: versaoId };

  // 4. Update versão (dispara trigger cascata pras outras versões)
  const { error: errUpdVer } = await supabase
    .from("versoes_orcamento")
    .update({
      status: "aprovada",
      aprovado_em: agora,
      aprovado_por: session.profile.id,
    })
    .eq("id", versaoId)
    .eq("tenant_id", session.activeTenant.id);

  if (errUpdVer) {
    console.error("[versao.aprovar]", errUpdVer.message);
    // A revalidação do saldo de save no banco (decisão 099) recusa com uma
    // frase em pt-BR que nomeia o job e os valores — melhor do que a
    // genérica. É o caso de outro job ter consumido o saldo entre a
    // conferência acima e este UPDATE.
    return {
      ok: false,
      message: /save|Comitê de Aprovações/i.test(errUpdVer.message)
        ? errUpdVer.message
        : "Não foi possível aprovar a versão.",
    };
  }

  // 5. Update orçamento
  const { error: errUpdOrc } = await supabase
    .from("orcamentos")
    .update({
      status: "aprovado",
      versao_aprovada_id: versaoId,
      aprovado_em: agora,
      aprovado_por: session.profile.id,
    })
    .eq("id", versao.orcamento_id)
    .eq("tenant_id", session.activeTenant.id);

  if (errUpdOrc) {
    console.error("[orcamento.aprovar]", errUpdOrc.message);
    return {
      ok: false,
      message: "Versão aprovada mas orçamento não atualizado. Verifique manualmente.",
    };
  }

  await logAuditEvent({
    acao: "versao_orcamento.aprovada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "versao_orcamento",
    entidadeId: versaoId,
    metadata: { orcamento_id: versao.orcamento_id, pelo_comite: modo === "comite" },
  });

  revalidatePath(`/orcamentos/${orc.projeto_id}`);
  revalidatePath(`/orcamentos/${orc.projeto_id}/${versao.orcamento_id}`);
  return { ok: true, id: versaoId };
}

export async function cancelarAprovacaoVersao(
  versaoId: string,
): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "orcamentos.aprovar");
  if (!gate.ok) return gate;
  const supabase = createClient();

  // 1. Fetch versão
  const { data: versao } = await supabase
    .from("versoes_orcamento")
    .select("id, status, orcamento_id")
    .eq("id", versaoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ id: string; status: string; orcamento_id: string }>();

  if (!versao) {
    return { ok: false, message: "Versão não encontrada." };
  }

  if (versao.status !== "aprovada") {
    return { ok: false, message: "Só versões aprovadas podem ter aprovação cancelada." };
  }

  // 2. Fetch orçamento (deve estar 'aprovado', não 'job_criado')
  const { data: orc } = await supabase
    .from("orcamentos")
    .select("status, projeto_id")
    .eq("id", versao.orcamento_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ status: string; projeto_id: string }>();

  if (!orc) {
    return { ok: false, message: "Orçamento não encontrado." };
  }

  if (orc.status !== "aprovado") {
    return {
      ok: false,
      message: `Orçamento está em status ${orc.status} — desaprovação não permitida.`,
    };
  }

  // 3. Verifica que não existe job ativo (não-cancelado) pra este orçamento
  const { count: jobsAtivos } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("orcamento_id", versao.orcamento_id)
    .eq("tenant_id", session.activeTenant.id)
    .neq("status", "cancelado");

  if ((jobsAtivos ?? 0) > 0) {
    return {
      ok: false,
      message: "Cancele o job antes de desaprovar a versão.",
    };
  }

  // 4. Update versão: volta pra 'em_revisao', limpa aprovado_em/por
  const { error: errUpdVer } = await supabase
    .from("versoes_orcamento")
    .update({
      status: "em_revisao",
      aprovado_em: null,
      aprovado_por: null,
    })
    .eq("id", versaoId)
    .eq("tenant_id", session.activeTenant.id);

  if (errUpdVer) {
    console.error("[versao.cancelarAprovacao]", errUpdVer.message);
    return { ok: false, message: "Não foi possível cancelar a aprovação." };
  }

  // 5. Reverter cascata: outras versões 'substituida' do orçamento voltam pra 'em_revisao'
  const { error: errRev } = await supabase
    .from("versoes_orcamento")
    .update({ status: "em_revisao" })
    .eq("orcamento_id", versao.orcamento_id)
    .eq("tenant_id", session.activeTenant.id)
    .eq("status", "substituida");

  if (errRev) {
    console.error("[versao.reverter_cascata]", errRev.message);
    // não bloqueia; log e segue
  }

  // 6. Update orçamento
  const { error: errUpdOrc } = await supabase
    .from("orcamentos")
    .update({
      status: "em_revisao",
      versao_aprovada_id: null,
      aprovado_em: null,
      aprovado_por: null,
    })
    .eq("id", versao.orcamento_id)
    .eq("tenant_id", session.activeTenant.id);

  if (errUpdOrc) {
    console.error("[orcamento.cancelarAprovacao]", errUpdOrc.message);
    return {
      ok: false,
      message: "Versão desaprovada mas orçamento não atualizado. Verifique manualmente.",
    };
  }

  await logAuditEvent({
    acao: "versao_orcamento.aprovacao_cancelada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "versao_orcamento",
    entidadeId: versaoId,
    metadata: { orcamento_id: versao.orcamento_id },
  });

  revalidatePath(`/orcamentos/${orc.projeto_id}`);
  revalidatePath(`/orcamentos/${orc.projeto_id}/${versao.orcamento_id}`);
  return { ok: true, id: versaoId };
}
