"use server";

/**
 * As ações da aba Banco da conciliação (task 029, fase 3).
 *
 * Entrega 3B — as ações de cada linha (decisão 200): conciliar a baixa
 * feita à mão, baixar e conciliar pelo lote de sempre, corrigir a baixa,
 * lançar pela regra, "saiu e voltou", ignorar e desfazer. Cada uma é a RPC
 * dela (`20261021700004_acoes_da_conciliacao.sql`), que confere o papel, a
 * conta e a soma; aqui só a forma da entrada e as mensagens.
 *
 * Entrega 3A — importar o extrato (decisão 198). O OFX é lido no navegador
 * (`lerOfx`, o mesmo parser dos testes) e chega aqui só com o que importa:
 * o cabeçalho e as linhas. O arquivo cru não sobe nem fica guardado — o
 * limite do corpo da Server Action (1 MB) aceita um mês inteiro de linhas,
 * que o arquivo cru talvez não coubesse. Tudo é conferido de novo aqui,
 * porque o que vem do navegador não é confiável: o formato (zod), o banco
 * do arquivo contra o do cadastro, a conta (agência e número) e a
 * impressão digital, que é calculada aqui e não no navegador. A RPC
 * `importar_extrato` confere a conta outra vez, grava sem repetir e audita.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { arquivoEhDaConta, bancoDoArquivoConfere, contaTemNumero, digitais, rotuloDoBanco } from "@/lib/conciliacao/ofx";
import { formaDaBaixaPeloHistorico } from "@/lib/conciliacao/motor";
import type { EntradaDaBaixaEmLote } from "@/lib/financeiro/baixa-em-lote";
import { darBaixaEmLote } from "../actions-baixa-em-lote";
import { cancelarBaixa, type TipoDeBaixa } from "../actions-baixa-registrada";
import { cancelarBaixaImposto } from "../fiscal/impostos/actions";

const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const ArquivoSchema = z.object({
  nome: z.string().trim().min(1).max(255),
  bancoId: z.string().max(20),
  conta: z.string().max(40),
  inicio: DATA.nullable(),
  fim: DATA.nullable(),
  geradoInstante: z.string().max(40).nullable(),
  saldoBanco: z.number().finite().nullable(),
  saldoEm: DATA.nullable(),
  movimentos: z
    .array(
      z.object({
        ordem: z.number().int().min(0),
        tipo: z.string().max(20),
        data: DATA,
        valor: z.number().finite(),
        fitid: z.string().max(255),
        documento: z.string().max(60),
        historico: z.string().max(500),
      }),
    )
    .max(5000, "O arquivo tem mais de 5.000 movimentos: importe um período menor."),
});

export type ArquivoParaImportar = z.infer<typeof ArquivoSchema>;

export type ResultadoDaImportacao =
  | { ok: true; movimentos: number; novos: number }
  /** O arquivo é de outra conta cadastrada: a conciliação dela. */
  | { ok: false; motivo: "outra_conta"; conta: { id: string; nome: string }; message: string }
  /** De conta nenhuma (ou de conta sem agência e número no cadastro). */
  | { ok: false; motivo: "nenhuma_conta"; message: string }
  | { ok: false; motivo: "erro"; message: string };

export async function importarExtrato(contaId: string, arquivo: ArquivoParaImportar): Promise<ResultadoDaImportacao> {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    return { ok: false, motivo: "erro", message: "Só admin ou financeiro concilia o extrato do banco." };
  }
  if (!z.string().uuid().safeParse(contaId).success) {
    return { ok: false, motivo: "erro", message: "Conta inválida." };
  }
  const lido = ArquivoSchema.safeParse(arquivo);
  if (!lido.success) {
    const primeiro = lido.error.issues[0];
    return {
      ok: false,
      motivo: "erro",
      message: primeiro?.message?.startsWith("O arquivo") ? primeiro.message : "O arquivo não parece um extrato OFX válido.",
    };
  }
  const a = lido.data;
  if (a.movimentos.length === 0) return { ok: false, motivo: "erro", message: "O arquivo não tem movimentos." };

  const supabase = createClient();
  const tenantId = session.activeTenant.id;
  const { data: contas, error } = await supabase
    .from("contas_bancarias")
    .select("id, nome, banco, agencia, numero_conta, numero_conta_dv, tipo, ativo")
    .eq("tenant_id", tenantId)
    .neq("tipo", "cartao_credito");
  if (error) {
    console.error("[conciliacao.importar.contas]", error.message);
    return { ok: false, motivo: "erro", message: "Não foi possível ler as contas. Tente de novo." };
  }
  const todas = (contas ?? []) as Array<{
    id: string;
    nome: string;
    banco: string;
    agencia: string | null;
    numero_conta: string | null;
    numero_conta_dv: string | null;
  }>;
  const conta = todas.find((c) => c.id === contaId);
  if (!conta) return { ok: false, motivo: "erro", message: "Conta bancária não encontrada." };

  const final4 = a.conta.replace(/\D/g, "").slice(-4);
  if (!arquivoEhDaConta(a.conta, conta)) {
    const outra = todas.find((c) => c.id !== contaId && arquivoEhDaConta(a.conta, c));
    if (outra) {
      return {
        ok: false,
        motivo: "outra_conta",
        conta: { id: outra.id, nome: outra.nome },
        message: `${a.nome} é da conta ${outra.nome}, não da ${conta.nome}.`,
      };
    }
    return {
      ok: false,
      motivo: "nenhuma_conta",
      message: contaTemNumero(conta)
        ? `${a.nome} não é de nenhuma conta cadastrada (banco ${a.bancoId || "—"}, conta ••••${final4 || "—"}).`
        : `Cadastre a agência e o número da conta ${conta.nome} para importar o extrato dela.`,
    };
  }
  if (!bancoDoArquivoConfere(a.bancoId, conta.banco)) {
    return {
      ok: false,
      motivo: "erro",
      message: `O arquivo é do banco ${rotuloDoBanco(a.bancoId)}, e a conta ${conta.nome} está cadastrada no ${conta.banco}.`,
    };
  }

  // A impressão digital é calculada aqui, com a conta do servidor.
  const marcas = digitais(a.movimentos, conta.id);
  const { data, error: rpcErr } = await supabase.rpc("importar_extrato", {
    p_conta_bancaria_id: conta.id,
    p_arquivo: {
      nome: a.nome,
      banco_id: a.bancoId,
      conta: a.conta,
      inicio: a.inicio,
      fim: a.fim,
      gerado_em: a.geradoInstante,
      saldo: a.saldoBanco,
      saldo_em: a.saldoEm,
      linhas: a.movimentos.map((m, i) => ({
        digital: marcas[i],
        data: m.data,
        valor: m.valor,
        tipo: m.tipo,
        historico: m.historico,
        documento: m.documento,
        fitid: m.fitid,
        ordem: m.ordem,
      })),
    },
  });
  if (rpcErr) {
    console.error("[conciliacao.importar]", rpcErr.message);
    return { ok: false, motivo: "erro", message: rpcErr.message };
  }
  const r = data as { movimentos: number; novos: number };
  revalidatePath("/financeiro/conciliacao");
  return { ok: true, movimentos: r.movimentos, novos: r.novos };
}

// ---------------------------------------------------------------------------
// As ações de cada linha (entrega 3B, decisão 200)
// ---------------------------------------------------------------------------

type Resultado = { ok: true; mensagem?: string } | { ok: false; message: string };

const UUID = z.string().uuid();

/** As funções do banco levantam exceção com o texto pronto para a tela; o
 *  que não for assim (erro técnico) vira a mensagem genérica. */
function mensagemDoBanco(msg: string, generica: string): string {
  const limpa = msg.replace(/^.*?(?:ERROR|erro):\s*/i, "").trim();
  if (limpa && !/["]|\b[a-z]+_[a-z_]+\b/.test(limpa)) return limpa;
  return generica;
}

async function gate() {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    return { ok: false as const, message: "Só admin ou financeiro concilia o extrato do banco." };
  }
  return { ok: true as const, session, supabase: createClient() };
}

function revalidar() {
  revalidatePath("/financeiro/conciliacao");
  revalidatePath("/financeiro/contas-a-pagar");
  revalidatePath("/financeiro/contas-a-receber");
  revalidatePath("/financeiro/fluxo-caixa");
}

async function chamar(rpc: string, args: Record<string, unknown>, generica: string): Promise<Resultado & { dados?: unknown }> {
  const g = await gate();
  if (!g.ok) return g;
  const { data, error } = await g.supabase.rpc(rpc, args);
  if (error) {
    console.error(`[conciliacao.${rpc}]`, error.message);
    return { ok: false, message: mensagemDoBanco(error.message, generica) };
  }
  revalidar();
  return { ok: true, dados: data };
}

/** A baixa feita à mão que bate com o banco: só liga, com a data do banco.
 *  `sozinha`: a automação da importação ligou (decisão 201). */
export async function conciliarLinha(linhaId: string, lancamentoIds: string[], sozinha: "manual" | null = null): Promise<Resultado> {
  if (!UUID.safeParse(linhaId).success || !z.array(UUID).min(1).max(500).safeParse(lancamentoIds).success) {
    return { ok: false, message: "Entrada inválida." };
  }
  if (sozinha !== null && sozinha !== "manual") return { ok: false, message: "Entrada inválida." };
  return chamar(
    "conciliar_linha",
    { p_linha_id: linhaId, p_lancamento_ids: lancamentoIds, p_como: "ligacao", p_sozinha: sozinha },
    "Não foi possível conciliar esta linha. Tente de novo.",
  );
}

/**
 * A avaliação única da importação (decisão 201): reserva as linhas que
 * ainda não passaram por ela e devolve as que reservou. Só essas se
 * resolvem sozinhas — duas abas abertas não baixam a mesma linha duas vezes.
 */
export async function marcarLinhasAvaliadas(linhaIds: string[]): Promise<{ ok: true; ids: string[] } | { ok: false; message: string }> {
  if (!z.array(UUID).min(1).max(5000).safeParse(linhaIds).success) return { ok: false, message: "Entrada inválida." };
  const g = await gate();
  if (!g.ok) return g;
  const { data, error } = await g.supabase.rpc("marcar_linhas_avaliadas", { p_linha_ids: linhaIds });
  if (error) {
    console.error("[conciliacao.marcar_linhas_avaliadas]", error.message);
    return { ok: false, message: mensagemDoBanco(error.message, "Não foi possível avaliar as linhas novas.") };
  }
  return { ok: true, ids: ((data as string[] | null) ?? []).filter((id) => UUID.safeParse(id).success) };
}

/** O documento baixado, como a RPC o procura na conta da linha. */
const documentoSchema = z.object({
  tipo: z.enum(["pp", "avulsa", "titulo_receber", "desembolso", "devolucao_verba", "fatura", "imposto", "transferencia"]),
  id: UUID,
});
export type DocumentoDaBaixa = z.infer<typeof documentoSchema>;

/** Concilia a baixa que acabou de ser dada pelo popup (o "Conferir"). Se a
 *  ligação falhar, a baixa fica valendo e aparece como baixa feita à mão na
 *  próxima leitura. */
export async function conciliarPelosDocumentos(
  linhaId: string,
  documentos: DocumentoDaBaixa[],
  grupo: string | null = null,
  /** `avulso`: o título nasceu na conciliação ("Lançar avulso"). */
  como: "baixa" | "avulso" = "baixa",
  /** A automação da importação baixou e conciliou (decisão 201). */
  sozinha: "titulo" | "remessa" | null = null,
): Promise<Resultado> {
  if (!UUID.safeParse(linhaId).success || !z.array(documentoSchema).min(1).max(500).safeParse(documentos).success) {
    return { ok: false, message: "Entrada inválida." };
  }
  if (grupo !== null && !UUID.safeParse(grupo).success) return { ok: false, message: "Entrada inválida." };
  if (como !== "baixa" && como !== "avulso") return { ok: false, message: "Entrada inválida." };
  if (sozinha !== null && sozinha !== "titulo" && sozinha !== "remessa") return { ok: false, message: "Entrada inválida." };
  return chamar(
    "conciliar_linha_pelos_documentos",
    { p_linha_id: linhaId, p_documentos: documentos, p_como: como, p_grupo: grupo, p_sozinha: sozinha },
    "A baixa foi feita, mas não foi possível ligar a linha do banco: ela aparece como baixa feita à mão na próxima leitura.",
  );
}

/** O documento de cada item do lote. */
function documentoDoItem(alvo: EntradaDaBaixaEmLote["itens"][number]["alvo"]): DocumentoDaBaixa {
  if (alvo.modulo === "imposto") return { tipo: "imposto", id: alvo.id };
  if (alvo.modulo === "receber") return { tipo: alvo.origem === "nf" ? "titulo_receber" : "avulsa", id: alvo.id };
  return { tipo: alvo.origem === "pp" ? "pp" : "avulsa", id: alvo.id };
}

type ItensDaBaixa = EntradaDaBaixaEmLote["itens"];

/**
 * A baixa dos títulos pela baixa em lote de sempre (`darBaixaEmLote`, com as
 * travas e a retenção da aprovação relida lá), com os dados do banco — a
 * data e a conta da linha, a forma pelo histórico. Só a baixa: a remessa
 * grande (a da folha) vai em partes, e a linha se liga no fim
 * (`ligarItensALinha`), para nenhuma chamada passar do tempo da função.
 */
export async function baixarPelaLinha(entrada: { linhaId: string; itens: ItensDaBaixa }): Promise<Resultado> {
  const g = await gate();
  if (!g.ok) return g;
  if (!UUID.safeParse(entrada.linhaId).success || !Array.isArray(entrada.itens) || entrada.itens.length === 0) {
    return { ok: false, message: "Entrada inválida." };
  }
  const { data: linha, error } = await g.supabase
    .from("vw_extrato_linhas")
    .select("id, conta_bancaria_id, data, valor, historico, conciliada, ignorada_em")
    .eq("tenant_id", g.session.activeTenant.id)
    .eq("id", entrada.linhaId)
    .maybeSingle();
  if (error || !linha) return { ok: false, message: "Linha do extrato não encontrada." };
  const l = linha as { id: string; conta_bancaria_id: string; data: string; valor: number | string; historico: string; conciliada: boolean; ignorada_em: string | null };
  if (l.conciliada || l.ignorada_em) return { ok: false, message: "Esta linha do banco já foi resolvida." };

  const pagar = entrada.itens.some((i) => i.alvo.modulo === "pagar");
  const lote: EntradaDaBaixaEmLote = {
    pago_em: l.data,
    conta_bancaria_id: l.conta_bancaria_id,
    forma_pagamento: pagar ? (formaDaBaixaPeloHistorico(l.historico) ?? "pix") : null,
    cartao_credito_id: null,
    fatura_competencia: null,
    centro_pagar: null,
    centro_receber: null,
    itens: entrada.itens,
  };
  const baixa = await darBaixaEmLote(lote);
  if (!baixa.ok) {
    const feitas = baixa.feitas.length;
    return {
      ok: false,
      message: feitas
        ? `${baixa.falha.mensagem} ${feitas === 1 ? "1 título foi baixado" : `${feitas} títulos foram baixados`} e a linha do banco ficou sem conciliar.`
        : baixa.falha.mensagem,
    };
  }
  return { ok: true };
}

/** Liga a linha às baixas dos itens (depois de `baixarPelaLinha`). */
export async function ligarItensALinha(entrada: {
  linhaId: string;
  itens: ItensDaBaixa;
  grupo?: string | null;
  sozinha?: "titulo" | "remessa" | null;
}): Promise<Resultado> {
  if (!Array.isArray(entrada.itens) || entrada.itens.length === 0) return { ok: false, message: "Entrada inválida." };
  return conciliarPelosDocumentos(
    entrada.linhaId,
    entrada.itens.map((i) => documentoDoItem(i.alvo)),
    entrada.grupo ?? null,
    "baixa",
    entrada.sozinha ?? null,
  );
}

/**
 * "Baixar e conciliar": a baixa com os dados do banco e a ligação da linha
 * a ela. Vale para um título, para a soma de títulos da mesma contraparte,
 * para a remessa pequena e para a linha de um grupo de iguais.
 */
export async function baixarEConciliar(entrada: {
  linhaId: string;
  itens: ItensDaBaixa;
  grupo?: string | null;
  sozinha?: "titulo" | "remessa" | null;
}): Promise<Resultado> {
  const baixa = await baixarPelaLinha(entrada);
  if (!baixa.ok) return baixa;
  const liga = await ligarItensALinha(entrada);
  if (!liga.ok) return liga;
  return {
    ok: true,
    mensagem:
      entrada.itens.length === 1
        ? "Baixa feita com os dados do banco e conciliada."
        : `${entrada.itens.length} baixas feitas com os dados do banco e conciliadas numa linha só.`,
  };
}

/** A baixa feita à mão que não bate: passa ao valor e à data do banco. */
export async function corrigirBaixa(lancamentoId: string, linhaId: string, motivo: string): Promise<Resultado> {
  if (!UUID.safeParse(lancamentoId).success || !UUID.safeParse(linhaId).success) {
    return { ok: false, message: "Entrada inválida." };
  }
  if (motivo.trim().length < 10) return { ok: false, message: "Registre o motivo da correção (pelo menos 10 caracteres)." };
  const r = await chamar(
    "corrigir_baixa_pela_conciliacao",
    { p_lancamento_id: lancamentoId, p_linha_id: linhaId, p_motivo: motivo.trim().slice(0, 500) },
    "Não foi possível corrigir a baixa. Tente de novo.",
  );
  if (!r.ok) return r;
  const para = (r.dados as { para?: { total?: number } } | null)?.para?.total;
  return {
    ok: true,
    mensagem: `Baixa corrigida${typeof para === "number" ? ` para ${para.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}` : ""} e conciliada. A correção, com o motivo, fica no histórico da baixa.`,
  };
}

/** A tarifa e o IOF pela regra do histórico (uma linha ou várias).
 *  `sozinha`: a automação da importação lançou (decisão 201). */
export async function lancarPelaRegra(itens: Array<{ linhaId: string; regraId: string }>, sozinha = false): Promise<Resultado> {
  if (!z.array(z.object({ linhaId: UUID, regraId: UUID })).min(1).max(200).safeParse(itens).success) {
    return { ok: false, message: "Entrada inválida." };
  }
  const g = await gate();
  if (!g.ok) return g;
  let feitas = 0;
  for (const i of itens) {
    const { error } = await g.supabase.rpc("lancar_pela_regra", { p_linha_id: i.linhaId, p_regra_id: i.regraId, p_sozinha: sozinha === true });
    if (error) {
      console.error("[conciliacao.lancar_pela_regra]", error.message);
      if (feitas) revalidar();
      const msg = mensagemDoBanco(error.message, "Não foi possível lançar pela regra.");
      return { ok: false, message: feitas ? `${msg} ${feitas === 1 ? "1 linha foi lançada" : `${feitas} linhas foram lançadas`}.` : msg };
    }
    feitas++;
  }
  revalidar();
  return { ok: true, mensagem: feitas === 1 ? "Lançado pela regra e conciliado." : `${feitas} linhas lançadas pela regra e conciliadas.` };
}

/** O pagamento que o banco devolveu no mesmo dia: as duas pernas no extrato. */
export async function registrarSaiuEVoltou(
  saidaId: string,
  voltaId: string,
  referencia: string | null,
  fornecedorId: string | null,
): Promise<Resultado> {
  if (!UUID.safeParse(saidaId).success || !UUID.safeParse(voltaId).success) return { ok: false, message: "Entrada inválida." };
  if (fornecedorId !== null && !UUID.safeParse(fornecedorId).success) return { ok: false, message: "Entrada inválida." };
  const r = await chamar(
    "registrar_saiu_e_voltou",
    { p_saida_id: saidaId, p_volta_id: voltaId, p_referencia: referencia?.slice(0, 160) ?? null, p_fornecedor_id: fornecedorId },
    "Não foi possível registrar as duas linhas. Tente de novo.",
  );
  if (!r.ok) return r;
  return { ok: true, mensagem: "Saída e devolução registradas no extrato, fora do DRE. O título continua a pagar." };
}

export async function ignorarLinha(linhaId: string, motivo: string | null): Promise<Resultado> {
  if (!UUID.safeParse(linhaId).success) return { ok: false, message: "Entrada inválida." };
  const r = await chamar(
    "ignorar_linha",
    { p_linha_id: linhaId, p_motivo: motivo?.slice(0, 500) ?? null },
    "Não foi possível ignorar a linha. Tente de novo.",
  );
  if (!r.ok) return r;
  return { ok: true, mensagem: "Linha ignorada: não entra no extrato do sistema. Dá para desfazer em Conciliados." };
}

/** O que o desfazer ainda tem de cancelar: o tipo e o id que
 *  `cancelarBaixa` recebe (o imposto vai por `cancelarBaixaImposto`). */
export type BaixaADesfazer = { tipo: string; id: string };

/** Quantas baixas uma chamada cancela: a remessa da folha desfeita tem
 *  dezenas, e o resto segue em outras chamadas (`cancelarBaixasDesfeitas`). */
const CANCELAR_POR_CHAMADA = 20;

const MOTIVO_DO_DESFAZER = "Conciliação com o banco desfeita";

async function cancelarAsBaixas(lista: BaixaADesfazer[]): Promise<{ ok: true; canceladas: number } | { ok: false; canceladas: number; message: string }> {
  let canceladas = 0;
  for (const c of lista) {
    const res =
      c.tipo === "imposto"
        ? await cancelarBaixaImposto({ imposto_id: c.id, motivo: MOTIVO_DO_DESFAZER })
        : await cancelarBaixa({ tipo: c.tipo as TipoDeBaixa, id: c.id, motivo: MOTIVO_DO_DESFAZER });
    if (!res.ok) return { ok: false, canceladas, message: res.message };
    canceladas++;
  }
  return { ok: true, canceladas };
}

const baixasADesfazerSchema = z.array(z.object({ tipo: z.string().min(1).max(40), id: UUID })).max(1000);

/**
 * Desfaz a conciliação da linha (e das do mesmo grupo). As baixas que
 * nasceram na conciliação voltam canceladas pelas actions de sempre — o
 * título volta a aberto —, com o motivo registrado. Até 20 aqui; as outras
 * voltam em `restantes`, e a tela as cancela em partes.
 */
export async function desfazerConciliacao(linhaId: string): Promise<(Resultado & { restantes?: BaixaADesfazer[] })> {
  if (!UUID.safeParse(linhaId).success) return { ok: false, message: "Entrada inválida." };
  const r = await chamar("desfazer_conciliacao", { p_linha_id: linhaId }, "Não foi possível desfazer. Tente de novo.");
  if (!r.ok) return r;
  const lido = baixasADesfazerSchema.safeParse((r.dados as { cancelar?: unknown } | null)?.cancelar ?? []);
  const cancelar = lido.success ? lido.data : [];
  const agora = cancelar.slice(0, CANCELAR_POR_CHAMADA);
  const res = await cancelarAsBaixas(agora);
  revalidar();
  if (!res.ok) {
    return {
      ok: false,
      message: `A linha foi desfeita, mas uma das baixas não foi cancelada: ${res.message} Cancele-a pela baixa registrada.`,
    };
  }
  const restantes = cancelar.slice(CANCELAR_POR_CHAMADA);
  if (restantes.length) return { ok: true, restantes };
  return {
    ok: true,
    mensagem: cancelar.length
      ? `Desfeito: ${cancelar.length === 1 ? "a baixa foi cancelada e o título voltou" : `as ${cancelar.length} baixas foram canceladas e os títulos voltaram`} a aberto.`
      : "Desfeito: a linha voltou a pendente.",
  };
}

/** O resto das baixas de um desfazer grande, em partes de 20. */
export async function cancelarBaixasDesfeitas(lista: BaixaADesfazer[]): Promise<Resultado> {
  const lido = baixasADesfazerSchema.max(CANCELAR_POR_CHAMADA).safeParse(lista);
  if (!lido.success) return { ok: false, message: "Entrada inválida." };
  const g = await gate();
  if (!g.ok) return g;
  const res = await cancelarAsBaixas(lido.data);
  revalidar();
  if (!res.ok) {
    return {
      ok: false,
      message: `A linha foi desfeita, mas uma das baixas não foi cancelada: ${res.message} Cancele-a pela baixa registrada.`,
    };
  }
  return { ok: true };
}

/** "Lembrar como regra" (decisão 200). */
export async function criarRegraDoExtrato(entrada: {
  contaId: string;
  padrao: string;
  tipoId: string;
  subtipoId: string;
  empresaId: string;
  todasAsContas: boolean;
}): Promise<Resultado> {
  const ok = z
    .object({
      contaId: UUID,
      padrao: z.string().trim().min(3).max(80),
      tipoId: UUID,
      subtipoId: UUID,
      empresaId: UUID,
      todasAsContas: z.boolean(),
    })
    .safeParse(entrada);
  if (!ok.success) return { ok: false, message: "Preencha o começo do histórico, o centro de custo e a empresa da regra." };
  const r = await chamar(
    "criar_regra_do_extrato",
    {
      p_conta_bancaria_id: entrada.contaId,
      p_padrao: entrada.padrao,
      p_tipo_id: entrada.tipoId,
      p_subtipo_id: entrada.subtipoId,
      p_empresa_id: entrada.empresaId,
      p_todas_as_contas: entrada.todasAsContas,
    },
    "Não foi possível criar a regra. Tente de novo.",
  );
  if (!r.ok) return r;
  return { ok: true, mensagem: "Regra criada: as próximas linhas com esse histórico vão para as regras." };
}

/**
 * A linha do banco a que a baixa está conciliada, para o aviso do cancelar
 * (M3.8, decisão 200): cancelar desfaz a conciliação, e a linha volta para
 * a Conciliação automática. `null`: não está conciliada (ou quem pergunta
 * não vê o extrato do banco).
 */
export async function conciliacaoDaBaixa(
  lancamentoId: string,
): Promise<{ data: string; valor: number } | null> {
  if (!UUID.safeParse(lancamentoId).success) return null;
  const g = await gate();
  if (!g.ok) return null;
  const { data: l } = await g.supabase
    .from("lancamentos_financeiros")
    .select("extrato_linha_id")
    .eq("tenant_id", g.session.activeTenant.id)
    .eq("id", lancamentoId)
    .maybeSingle<{ extrato_linha_id: string | null }>();
  if (!l?.extrato_linha_id) return null;
  const { data: linha } = await g.supabase
    .from("extrato_linhas")
    .select("data, valor")
    .eq("tenant_id", g.session.activeTenant.id)
    .eq("id", l.extrato_linha_id)
    .maybeSingle<{ data: string; valor: number | string }>();
  return linha ? { data: linha.data, valor: Math.abs(Number(linha.valor)) } : null;
}
