"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import {
  aberturaFinanceiraSchema,
  criarProjetoFinanceiroSchema,
  edicaoRegistroAberturaSchema,
  TOLERANCIA_CURVA,
  type AberturaFinanceiraInput,
  type CriarProjetoFinanceiroInput,
  type EdicaoRegistroAberturaInput,
} from "@/lib/validations/abertura-financeiro";
import type { JobStatus, TipoCusto } from "@/lib/types";
import { tipoGeraDesembolso } from "@/lib/calculos/versao-totais";
import { gerarCodigoProjetoFinanceiro } from "@/lib/codigos/projetos-financeiro";
import { edicaoRespeitaConsumido } from "@/lib/calculos/previsao-congelada";
import { consumoDasPrevisoes } from "./consumo";
import { ehJanelaDePagamento, emCentavos, somaCurva } from "./curva";

export type ActionResult =
  | { ok: true; id: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

/**
 * Abre o job no financeiro: grava o registro contábil (nome financeiro,
 * categoria, competência, custo previsto, curva de desembolso e previsão
 * de recebimento) e só então muda o status para `aberto`.
 *
 * Nenhum dos dois totais vem do formulário — são dinheiro, e o navegador
 * não é fonte confiável para dinheiro:
 *
 *   * o CUSTO previsto é relido de `jobs_itens_orcado` aqui dentro, e
 *     soma SÓ os itens de calha PP (AR, B, C, F, FI): são os únicos em
 *     que a California paga o fornecedor. Itens A e D são pagos direto
 *     pelo cliente e nunca viram previsão de desembolso
 *     (docs/decisions/004). Job 100% A/D abre com custo zero e curva
 *     vazia — é legítimo, não é erro;
 *   * o FATURAMENTO previsto é relido de `jobs.faturamento_previsto`, e
 *     é contra ele que as parcelas de recebimento fecham. Não é o
 *     `valor_total`, que inclui o que o cliente paga direto ao
 *     fornecedor e nunca passa pelo caixa da California.
 */
export async function abrirJobNoFinanceiro(
  jobId: string,
  input: AberturaFinanceiraInput,
): Promise<ActionResult> {
  const session = await requireSession();

  if (
    session.activeRole !== "administrador" &&
    session.activeRole !== "financeiro"
  ) {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo: "job",
      entidadeId: jobId,
      metadata: { action: "job.abrirNoFinanceiro", role: session.activeRole },
    });
    return {
      ok: false,
      message: "Só administrador ou financeiro pode abrir jobs.",
    };
  }

  const parsed = aberturaFinanceiraSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();

  const { data: job } = await supabase
    .from("jobs")
    .select(
      "id, status, projeto_id, orcamento_id, faturamento_previsto, projeto:projetos(cliente_id)",
    )
    .eq("id", jobId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{
      id: string;
      status: JobStatus;
      projeto_id: string;
      orcamento_id: string;
      faturamento_previsto: number | string | null;
      projeto: { cliente_id: string } | null;
    }>();

  if (!job) return { ok: false, message: "Job não encontrado." };
  if (job.status !== "aguardando_abertura") {
    return {
      ok: false,
      message:
        "Este job não está mais aguardando abertura — alguém pode ter aberto ou reprovado enquanto você preenchia.",
    };
  }

  // A categoria do job é a do orçamento (escopo 'orcamento'), e do mesmo
  // tenant. Sem esta conferência, um id de categoria de projeto passaria
  // pela FK.
  const { data: categoria } = await supabase
    .from("categorias_dominio")
    .select("id, escopo, ativo")
    .eq("id", parsed.data.categoria_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ id: string; escopo: string; ativo: boolean }>();

  if (!categoria || categoria.escopo !== "orcamento") {
    return { ok: false, message: "Categoria de job inválida." };
  }
  if (!categoria.ativo) {
    return {
      ok: false,
      message: "Esta categoria foi inativada. Escolha outra para abrir o job.",
    };
  }

  const refsErro = await conferirProjetoEContas(
    supabase,
    session.activeTenant.id,
    job.projeto?.cliente_id ?? null,
    parsed.data,
  );
  if (refsErro) return { ok: false, message: refsErro };

  // ---------- Custo previsto: relido do banco, não do formulário ----------
  const { data: itens, error: itensErro } = await supabase
    .from("jobs_itens_orcado")
    .select("tipo_custo, total_planejado")
    .eq("job_id", jobId)
    .eq("tenant_id", session.activeTenant.id);

  if (itensErro) {
    console.error("[abertura-job.planejado]", itensErro.message);
    return { ok: false, message: "Não foi possível ler a planilha do job." };
  }

  const custoPrevisto = emCentavos(
    (itens ?? []).reduce(
      (
        s,
        i: { tipo_custo: TipoCusto; total_planejado: number | string | null },
      ) =>
        tipoGeraDesembolso(i.tipo_custo)
          ? s + Number(i.total_planejado ?? 0)
          : s,
      0,
    ),
  );

  const semDesembolso = custoPrevisto <= 0;

  if (semDesembolso && parsed.data.curva.length > 0) {
    return {
      ok: false,
      message:
        "Este job não tem desembolso previsto pela California — a curva precisa ficar vazia.",
    };
  }

  if (!semDesembolso) {
    if (parsed.data.curva.length === 0) {
      return {
        ok: false,
        message: "O cronograma de desembolsos precisa de pelo menos uma data.",
      };
    }

    const soma = somaCurva(parsed.data.curva);
    if (Math.abs(soma - custoPrevisto) >= TOLERANCIA_CURVA) {
      return {
        ok: false,
        message: `O cronograma de desembolsos soma ${soma.toFixed(2)} e o custo previsto é ${custoPrevisto.toFixed(2)}. Ajuste as datas antes de abrir.`,
      };
    }

    // Pagamento só acontece nas janelas (dia 08 e 20, ajustadas para o
    // dia útil seguinte). Regra crítica não depende só do formulário.
    const foraDeJanela = parsed.data.curva.find(
      (l) => !ehJanelaDePagamento(l.data_prevista),
    );
    if (foraDeJanela) {
      return {
        ok: false,
        message: `A data ${foraDeJanela.data_prevista} não é uma janela de pagamento (dias 08 e 20, ou o dia útil seguinte).`,
      };
    }
  }

  // ---------- Faturamento previsto: relido do banco, como o custo ----------
  // As parcelas de recebimento NÃO seguem as janelas de pagamento: elas
  // são entrada de dinheiro, e quem manda na data é o cliente.
  const faturamentoPrevisto = emCentavos(
    Number(job.faturamento_previsto ?? 0),
  );
  const semRecebimento = faturamentoPrevisto <= 0;

  if (semRecebimento && parsed.data.recebimento.length > 0) {
    return {
      ok: false,
      message:
        "Este job não tem faturamento previsto pela California — a previsão de recebimento precisa ficar vazia.",
    };
  }

  if (!semRecebimento) {
    if (parsed.data.recebimento.length === 0) {
      return {
        ok: false,
        message: "A previsão de recebimento precisa de pelo menos uma parcela.",
      };
    }

    const somaReceb = somaCurva(parsed.data.recebimento);
    if (Math.abs(somaReceb - faturamentoPrevisto) >= TOLERANCIA_CURVA) {
      return {
        ok: false,
        message: `As parcelas de recebimento somam ${somaReceb.toFixed(2)} e o faturamento previsto é ${faturamentoPrevisto.toFixed(2)}. Ajuste os valores antes de abrir.`,
      };
    }
  }

  const agora = new Date().toISOString();

  const { error: updateErro } = await supabase
    .from("jobs")
    .update({
      status: "aberto",
      motivo_rejeicao: null,
      nome_financeiro: parsed.data.nome_financeiro,
      // Só a arrumação do financeiro. `projeto_id` (produção) fica como
      // está — quem manda nele é o orçamento.
      projeto_financeiro_id: parsed.data.projeto_financeiro_id,
      conta_recebimento_id: parsed.data.conta_recebimento_id,
      conta_pagamento_id: parsed.data.conta_pagamento_id,
      categoria_id: parsed.data.categoria_id,
      competencia_trimestre: parsed.data.competencia_trimestre,
      competencia_ano: parsed.data.competencia_ano,
      custo_previsto_total: custoPrevisto,
      data_abertura_financeiro: agora,
      aberto_por: session.profile.id,
    })
    .eq("id", jobId)
    .eq("tenant_id", session.activeTenant.id)
    // Trava de corrida: se outra aba abriu o job entre a leitura acima e
    // este update, o filtro não casa e nada é gravado duas vezes.
    .eq("status", "aguardando_abertura");

  if (updateErro) {
    console.error("[abertura-job.update]", updateErro.message);
    return { ok: false, message: "Não foi possível abrir o job." };
  }

  // As duas previsões são regravadas inteiras: apaga o que houver e
  // insere de novo. Na abertura não há nada para apagar, mas a edição
  // futura usa o mesmo caminho.
  const [deleteCurva, deleteReceb] = await Promise.all([
    supabase
      .from("jobs_previsao_custo")
      .delete()
      .eq("job_id", jobId)
      .eq("tenant_id", session.activeTenant.id),
    supabase
      .from("jobs_previsao_recebimento")
      .delete()
      .eq("job_id", jobId)
      .eq("tenant_id", session.activeTenant.id),
  ]);

  if (deleteCurva.error) {
    console.error("[abertura-job.curva-delete]", deleteCurva.error.message);
  }
  if (deleteReceb.error) {
    console.error(
      "[abertura-job.recebimento-delete]",
      deleteReceb.error.message,
    );
  }

  const linhaPrevisao = (
    linha: { data_prevista: string; valor: number },
    i: number,
  ) => ({
    tenant_id: session.activeTenant.id,
    job_id: jobId,
    ordem: i + 1,
    data_prevista: linha.data_prevista,
    valor: linha.valor,
    created_by: session.profile.id,
  });

  const [curvaRes, recebRes] = await Promise.all([
    semDesembolso
      ? Promise.resolve({ error: null })
      : supabase
          .from("jobs_previsao_custo")
          .insert(parsed.data.curva.map(linhaPrevisao)),
    semRecebimento
      ? Promise.resolve({ error: null })
      : supabase
          .from("jobs_previsao_recebimento")
          .insert(parsed.data.recebimento.map(linhaPrevisao)),
  ]);

  const curvaErro = curvaRes.error;
  const recebErro = recebRes.error;

  if (curvaErro || recebErro) {
    // O job já está aberto e o registro contábil gravado. Voltar o status
    // aqui seria pior: o financeiro veria o job sumir da fila e reaparecer.
    // Melhor abrir sem a previsão e deixar o alerta explícito.
    if (curvaErro) {
      console.error("[abertura-job.curva-insert]", curvaErro.message);
    }
    if (recebErro) {
      console.error("[abertura-job.recebimento-insert]", recebErro.message);
    }
    await logAuditEvent({
      acao: "job.aberto_no_financeiro",
      tenantId: session.activeTenant.id,
      entidadeTipo: "job",
      entidadeId: jobId,
      metadata: {
        curva_falhou: Boolean(curvaErro),
        recebimento_falhou: Boolean(recebErro),
        erro: (curvaErro ?? recebErro)?.message,
      },
    });
    const oQueFalhou =
      curvaErro && recebErro
        ? "o cronograma de desembolsos e a previsão de recebimento não foram gravados"
        : curvaErro
          ? "o cronograma de desembolsos não foi gravado"
          : "a previsão de recebimento não foi gravada";
    return {
      ok: false,
      message: `O job foi aberto, mas ${oQueFalhou}. Registre as datas na página do job.`,
    };
  }

  await logAuditEvent({
    acao: "job.aberto_no_financeiro",
    tenantId: session.activeTenant.id,
    entidadeTipo: "job",
    entidadeId: jobId,
    metadata: {
      nome_financeiro: parsed.data.nome_financeiro,
      projeto_financeiro_id: parsed.data.projeto_financeiro_id,
      conta_recebimento_id: parsed.data.conta_recebimento_id,
      conta_pagamento_id: parsed.data.conta_pagamento_id,
      categoria_id: parsed.data.categoria_id,
      competencia: `${parsed.data.competencia_trimestre}T/${parsed.data.competencia_ano}`,
      custo_previsto_total: custoPrevisto,
      datas_na_curva: parsed.data.curva.length,
      sem_desembolso: semDesembolso,
      faturamento_previsto: faturamentoPrevisto,
      parcelas_de_recebimento: parsed.data.recebimento.length,
      sem_recebimento: semRecebimento,
    },
  });

  revalidatePath("/financeiro");
  revalidatePath("/financeiro/abertura-de-job");
  revalidatePath(`/financeiro/abertura-de-job/${jobId}`);
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
  revalidatePath(`/orcamentos/${job.projeto_id}/${job.orcamento_id}`);

  return { ok: true, id: jobId };
}

/**
 * Confere as referências que o formulário manda por id: o projeto do
 * financeiro e as duas contas bancárias.
 *
 * Id vindo do navegador é palpite até o servidor confirmar — sem esta
 * checagem, um id de projeto de outro tenant passaria pela FK (a FK só
 * garante que a linha existe, não que ela é sua) e uma conta inativada
 * voltaria a receber job.
 *
 * Devolve a mensagem do problema, ou null quando está tudo certo.
 */
async function conferirProjetoEContas(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  clienteDoJob: string | null,
  input: {
    projeto_financeiro_id: string;
    conta_recebimento_id: string | null;
    conta_pagamento_id: string | null;
  },
): Promise<string | null> {
  const contasPedidas = [
    input.conta_recebimento_id,
    input.conta_pagamento_id,
  ].filter((c): c is string => Boolean(c));

  const [projetoRes, contasRes] = await Promise.all([
    supabase
      .from("projetos_financeiro")
      .select("id, ativo, cliente_id")
      .eq("id", input.projeto_financeiro_id)
      .eq("tenant_id", tenantId)
      .maybeSingle<{ id: string; ativo: boolean; cliente_id: string }>(),
    contasPedidas.length > 0
      ? supabase
          .from("contas_bancarias")
          .select("id, ativo")
          .eq("tenant_id", tenantId)
          .in("id", contasPedidas)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const projeto = projetoRes.data;
  if (!projeto) return "Projeto do financeiro inválido.";
  if (!projeto.ativo) {
    return "Este projeto foi inativado. Escolha outro para o job.";
  }
  // Agrupar jobs de clientes diferentes sob o mesmo projeto não é
  // arrumação, é engano — e o total do projeto sairia somando dinheiro
  // de dois clientes.
  if (clienteDoJob && projeto.cliente_id !== clienteDoJob) {
    return "O projeto escolhido é de outro cliente.";
  }

  if (contasRes.error) {
    console.error("[abertura-job.contas]", contasRes.error.message);
    return "Não foi possível conferir as contas bancárias.";
  }

  const encontradas = (contasRes.data ?? []) as { id: string; ativo: boolean }[];
  if (encontradas.length !== contasPedidas.length) {
    return "Conta bancária inválida.";
  }
  if (encontradas.some((c) => !c.ativo)) {
    return "Conta bancária inativada. Escolha outra.";
  }

  return null;
}

/**
 * Cria um projeto do financeiro e já devolve o id para o formulário
 * vincular ("Criar projeto para este job", do protótipo).
 *
 * O que vem da tela é só o nome. O código é gerado pelo sistema e o
 * cliente vem do projeto de produção do job — não é escolha de quem
 * preenche, e deixar escolher abriria a porta para projeto do financeiro
 * misturando clientes.
 *
 * Não grava nada no job: quem vincula é a abertura (ou a edição do
 * registro), no submit. Assim, desistir da abertura não deixa o job
 * apontando para um projeto que ninguém quis.
 */
export async function criarProjetoFinanceiro(
  jobId: string,
  input: CriarProjetoFinanceiroInput,
): Promise<
  | { ok: true; id: string; codigo: string; nome: string }
  | { ok: false; message: string }
> {
  const session = await requireSession();

  if (
    session.activeRole !== "administrador" &&
    session.activeRole !== "financeiro"
  ) {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo: "job",
      entidadeId: jobId,
      metadata: {
        action: "projeto_financeiro.criar",
        role: session.activeRole,
      },
    });
    return {
      ok: false,
      message: "Só administrador ou financeiro pode criar projeto no financeiro.",
    };
  }

  const parsed = criarProjetoFinanceiroSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message:
        parsed.error.flatten().fieldErrors.nome?.[0] ??
        "Verifique o nome do projeto.",
    };
  }

  const supabase = createClient();

  const { data: job } = await supabase
    .from("jobs")
    .select("id, data_inicio_prevista, projeto:projetos(cliente_id)")
    .eq("id", jobId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{
      id: string;
      data_inicio_prevista: string | null;
      projeto: { cliente_id: string } | null;
    }>();

  if (!job) return { ok: false, message: "Job não encontrado." };

  const clienteId = job.projeto?.cliente_id;
  if (!clienteId) {
    return {
      ok: false,
      message: "O job não tem cliente no projeto de origem.",
    };
  }

  // O ano do código sai do início do job, e não de hoje: job que começa
  // em janeiro e é aberto em dezembro pertence ao ano de execução.
  const dataBase =
    job.data_inicio_prevista ?? new Date().toISOString().slice(0, 10);

  let codigo: string;
  try {
    codigo = await gerarCodigoProjetoFinanceiro(
      supabase,
      session.activeTenant.id,
      clienteId,
      dataBase,
    );
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Não foi possível gerar o código.",
    };
  }

  const { data: criado, error } = await supabase
    .from("projetos_financeiro")
    .insert({
      tenant_id: session.activeTenant.id,
      codigo,
      nome: parsed.data.nome,
      cliente_id: clienteId,
      created_by: session.profile.id,
    })
    .select("id, codigo, nome")
    .maybeSingle<{ id: string; codigo: string; nome: string }>();

  if (error || !criado) {
    console.error("[projeto-financeiro.criar]", error?.message);
    // O índice único (tenant_id, codigo) é a rede da race condition do
    // gerador: dois cliques simultâneos disputam o mesmo sequencial.
    return {
      ok: false,
      message:
        error?.code === "23505"
          ? "Outro projeto acabou de tomar este código. Tente de novo."
          : "Não foi possível criar o projeto.",
    };
  }

  await logAuditEvent({
    acao: "projeto_financeiro.criado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "projeto_financeiro",
    entidadeId: criado.id,
    metadata: { codigo: criado.codigo, nome: criado.nome, job_id: jobId },
  });

  revalidatePath(`/financeiro/abertura-de-job/${jobId}`);
  revalidatePath("/financeiro/abertura-de-job");

  return { ok: true, id: criado.id, codigo: criado.codigo, nome: criado.nome };
}

/**
 * Reescreve o registro da abertura de um job JÁ ABERTO ("Editar
 * registro", do protótipo).
 *
 * O que muda: nome no financeiro, projeto do financeiro, contas,
 * categoria, competência e as duas previsões.
 *
 * O que NUNCA muda: `data_abertura_financeiro`, `aberto_por` e `status`.
 * A abertura aconteceu uma vez — reescrever quem conferiu apagaria a
 * única prova de quem conferiu.
 *
 * ---------------------------------------------------------------------
 * A trava das previsões (Tiago, 20/08/2026)
 * ---------------------------------------------------------------------
 *
 * "Só será congelado o que for consumido, e só será consumido o saldo da
 * parcela mais próxima." O consumo anda em ordem de data; o que ele já
 * cobriu não pode mudar de data nem de valor, e o saldo restante segue
 * livre para ser reagendado e redividido. A regra mora em
 * `lib/calculos/previsao-congelada.ts` e é a MESMA que a tela usa para
 * desenhar as linhas travadas — duas implementações divergiriam no
 * primeiro centavo.
 *
 * O total continua fechando com o custo previsto e com o faturamento
 * previsto, exatamente como na abertura: o que a edição libera é a
 * distribuição, não o dinheiro.
 */
export async function editarRegistroDaAbertura(
  jobId: string,
  input: EdicaoRegistroAberturaInput,
): Promise<ActionResult> {
  const session = await requireSession();

  if (
    session.activeRole !== "administrador" &&
    session.activeRole !== "financeiro"
  ) {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo: "job",
      entidadeId: jobId,
      metadata: {
        action: "job.editarRegistroDaAbertura",
        role: session.activeRole,
      },
    });
    return {
      ok: false,
      message: "Só administrador ou financeiro pode editar o registro.",
    };
  }

  const parsed = edicaoRegistroAberturaSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();

  const { data: job } = await supabase
    .from("jobs")
    .select(
      "id, status, projeto_id, orcamento_id, faturamento_previsto, " +
        "nome_financeiro, projeto_financeiro_id, conta_recebimento_id, " +
        "conta_pagamento_id, categoria_id, competencia_trimestre, " +
        "competencia_ano, projeto:projetos(cliente_id)",
    )
    .eq("id", jobId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<any>();

  if (!job) return { ok: false, message: "Job não encontrado." };
  if (job.status !== "aberto") {
    return {
      ok: false,
      message:
        "Só job aberto tem registro de abertura para editar. Este job está em outro estado.",
    };
  }

  const { data: categoria } = await supabase
    .from("categorias_dominio")
    .select("id, escopo, ativo")
    .eq("id", parsed.data.categoria_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ id: string; escopo: string; ativo: boolean }>();

  if (!categoria || categoria.escopo !== "orcamento") {
    return { ok: false, message: "Categoria de job inválida." };
  }
  if (!categoria.ativo) {
    return {
      ok: false,
      message: "Esta categoria foi inativada. Escolha outra.",
    };
  }

  const refsErro = await conferirProjetoEContas(
    supabase,
    session.activeTenant.id,
    job.projeto?.cliente_id ?? null,
    parsed.data,
  );
  if (refsErro) return { ok: false, message: refsErro };

  // Os dois totais são relidos do banco, como na abertura: o navegador
  // não é fonte confiável para dinheiro.
  const { data: itens, error: itensErro } = await supabase
    .from("jobs_itens_orcado")
    .select("tipo_custo, total_planejado")
    .eq("job_id", jobId)
    .eq("tenant_id", session.activeTenant.id);

  if (itensErro) {
    console.error("[abertura-job.editar-planejado]", itensErro.message);
    return { ok: false, message: "Não foi possível ler a planilha do job." };
  }

  const custoPrevisto = emCentavos(
    (itens ?? []).reduce(
      (
        s,
        i: { tipo_custo: TipoCusto; total_planejado: number | string | null },
      ) =>
        tipoGeraDesembolso(i.tipo_custo)
          ? s + Number(i.total_planejado ?? 0)
          : s,
      0,
    ),
  );
  const faturamentoPrevisto = emCentavos(Number(job.faturamento_previsto ?? 0));

  const [consumo, curvaAtualRes, recebAtualRes] = await Promise.all([
    consumoDasPrevisoes(supabase, session.activeTenant.id, jobId),
    supabase
      .from("jobs_previsao_custo")
      .select("data_prevista, valor")
      .eq("job_id", jobId)
      .eq("tenant_id", session.activeTenant.id)
      .order("data_prevista", { ascending: true }),
    supabase
      .from("jobs_previsao_recebimento")
      .select("data_prevista, valor")
      .eq("job_id", jobId)
      .eq("tenant_id", session.activeTenant.id)
      .order("data_prevista", { ascending: true }),
  ]);

  const curvaGuardada = ((curvaAtualRes.data ?? []) as any[]).map((l) => ({
    data_prevista: l.data_prevista as string,
    valor: Number(l.valor ?? 0),
  }));
  const recebGuardado = ((recebAtualRes.data ?? []) as any[]).map((l) => ({
    data_prevista: l.data_prevista as string,
    valor: Number(l.valor ?? 0),
  }));

  // ---------- Curva de custo ----------
  const semDesembolso = custoPrevisto <= 0;

  if (semDesembolso && parsed.data.curva.length > 0) {
    return {
      ok: false,
      message:
        "Este job não tem desembolso previsto pela California — a curva precisa ficar vazia.",
    };
  }

  if (!semDesembolso) {
    if (parsed.data.curva.length === 0) {
      return {
        ok: false,
        message: "O cronograma de desembolsos precisa de pelo menos uma data.",
      };
    }

    const soma = somaCurva(parsed.data.curva);
    if (Math.abs(soma - custoPrevisto) >= TOLERANCIA_CURVA) {
      return {
        ok: false,
        message: `O cronograma de desembolsos soma ${soma.toFixed(2)} e o custo previsto é ${custoPrevisto.toFixed(2)}. Ajuste as datas antes de salvar.`,
      };
    }

    const foraDeJanela = parsed.data.curva.find(
      (l) => !ehJanelaDePagamento(l.data_prevista),
    );
    if (foraDeJanela) {
      return {
        ok: false,
        message: `A data ${foraDeJanela.data_prevista} não é uma janela de pagamento (dias 08 e 20, ou o dia útil seguinte).`,
      };
    }

    if (
      !edicaoRespeitaConsumido(
        curvaGuardada,
        parsed.data.curva,
        consumo.custo,
      )
    ) {
      return {
        ok: false,
        message: `As PPs já emitidas consomem ${consumo.custo.toFixed(2)} da curva. Essa parte não pode mudar de data nem de valor — só o saldo restante é editável.`,
      };
    }
  }

  // ---------- Previsão de recebimento ----------
  const semRecebimento = faturamentoPrevisto <= 0;

  if (semRecebimento && parsed.data.recebimento.length > 0) {
    return {
      ok: false,
      message:
        "Este job não tem faturamento previsto pela California — a previsão de recebimento precisa ficar vazia.",
    };
  }

  if (!semRecebimento) {
    if (parsed.data.recebimento.length === 0) {
      return {
        ok: false,
        message: "A previsão de recebimento precisa de pelo menos uma parcela.",
      };
    }

    const somaReceb = somaCurva(parsed.data.recebimento);
    if (Math.abs(somaReceb - faturamentoPrevisto) >= TOLERANCIA_CURVA) {
      return {
        ok: false,
        message: `As parcelas de recebimento somam ${somaReceb.toFixed(2)} e o faturamento previsto é ${faturamentoPrevisto.toFixed(2)}. Ajuste os valores antes de salvar.`,
      };
    }

    if (
      !edicaoRespeitaConsumido(
        recebGuardado,
        parsed.data.recebimento,
        consumo.recebimento,
      )
    ) {
      return {
        ok: false,
        message: `As notas já emitidas consomem ${consumo.recebimento.toFixed(2)} da previsão de recebimento. Essa parte não pode mudar de data nem de valor — só o saldo restante é editável.`,
      };
    }
  }

  const { error: updateErro } = await supabase
    .from("jobs")
    .update({
      nome_financeiro: parsed.data.nome_financeiro,
      projeto_financeiro_id: parsed.data.projeto_financeiro_id,
      conta_recebimento_id: parsed.data.conta_recebimento_id,
      conta_pagamento_id: parsed.data.conta_pagamento_id,
      categoria_id: parsed.data.categoria_id,
      competencia_trimestre: parsed.data.competencia_trimestre,
      competencia_ano: parsed.data.competencia_ano,
      custo_previsto_total: custoPrevisto,
      // Salvar a abertura É a revisão da errata. O financeiro acabou de
      // reconferir previsão de recebimento, curva de desembolso e
      // competência sobre os números novos — que é exatamente o que a
      // errata pediu ao devolver o job para cá. Some a marca, e o envio
      // para faturamento volta (27/08/2026).
      abertura_em_revisao: false,
      abertura_revisao_desde: null,
      abertura_revisao_errata_id: null,
    })
    .eq("id", jobId)
    .eq("tenant_id", session.activeTenant.id)
    // Trava de corrida: job encerrado em outra aba enquanto esta editava.
    .eq("status", "aberto");

  if (updateErro) {
    console.error("[abertura-job.editar-update]", updateErro.message);
    return { ok: false, message: "Não foi possível salvar as alterações." };
  }

  // As previsões são regravadas inteiras — mesmo caminho da abertura.
  const [deleteCurva, deleteReceb] = await Promise.all([
    supabase
      .from("jobs_previsao_custo")
      .delete()
      .eq("job_id", jobId)
      .eq("tenant_id", session.activeTenant.id),
    supabase
      .from("jobs_previsao_recebimento")
      .delete()
      .eq("job_id", jobId)
      .eq("tenant_id", session.activeTenant.id),
  ]);

  if (deleteCurva.error) {
    console.error("[abertura-job.editar-curva-delete]", deleteCurva.error.message);
  }
  if (deleteReceb.error) {
    console.error(
      "[abertura-job.editar-receb-delete]",
      deleteReceb.error.message,
    );
  }

  const linhaPrevisao = (
    linha: { data_prevista: string; valor: number },
    i: number,
  ) => ({
    tenant_id: session.activeTenant.id,
    job_id: jobId,
    ordem: i + 1,
    data_prevista: linha.data_prevista,
    valor: linha.valor,
    created_by: session.profile.id,
  });

  const [curvaRes, recebRes] = await Promise.all([
    semDesembolso
      ? Promise.resolve({ error: null })
      : supabase
          .from("jobs_previsao_custo")
          .insert(parsed.data.curva.map(linhaPrevisao)),
    semRecebimento
      ? Promise.resolve({ error: null })
      : supabase
          .from("jobs_previsao_recebimento")
          .insert(parsed.data.recebimento.map(linhaPrevisao)),
  ]);

  if (curvaRes.error || recebRes.error) {
    if (curvaRes.error) {
      console.error("[abertura-job.editar-curva-insert]", curvaRes.error.message);
    }
    if (recebRes.error) {
      console.error("[abertura-job.editar-receb-insert]", recebRes.error.message);
    }
    await logAuditEvent({
      acao: "job.registro_abertura_editado",
      tenantId: session.activeTenant.id,
      entidadeTipo: "job",
      entidadeId: jobId,
      metadata: {
        curva_falhou: Boolean(curvaRes.error),
        recebimento_falhou: Boolean(recebRes.error),
        erro: (curvaRes.error ?? recebRes.error)?.message,
      },
    });
    return {
      ok: false,
      message:
        "Os dados do registro foram salvos, mas a previsão não foi regravada. Confira as datas na aba Abertura do Job.",
    };
  }

  // De/para de tudo que mudou: é o registro de quem alterou o quê,
  // decidido em 20/08/2026 para viver só na auditoria (sem bloco de
  // histórico na tela).
  await logAuditEvent({
    acao: "job.registro_abertura_editado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "job",
    entidadeId: jobId,
    metadata: {
      de: {
        nome_financeiro: job.nome_financeiro,
        projeto_financeiro_id: job.projeto_financeiro_id,
        conta_recebimento_id: job.conta_recebimento_id,
        conta_pagamento_id: job.conta_pagamento_id,
        categoria_id: job.categoria_id,
        competencia: `${job.competencia_trimestre}T/${job.competencia_ano}`,
        curva: curvaGuardada,
        recebimento: recebGuardado,
      },
      para: {
        nome_financeiro: parsed.data.nome_financeiro,
        projeto_financeiro_id: parsed.data.projeto_financeiro_id,
        conta_recebimento_id: parsed.data.conta_recebimento_id,
        conta_pagamento_id: parsed.data.conta_pagamento_id,
        categoria_id: parsed.data.categoria_id,
        competencia: `${parsed.data.competencia_trimestre}T/${parsed.data.competencia_ano}`,
        curva: parsed.data.curva,
        recebimento: parsed.data.recebimento,
      },
      consumido_na_edicao: consumo,
    },
  });

  revalidatePath("/financeiro");
  revalidatePath("/financeiro/abertura-de-job");
  revalidatePath(`/financeiro/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}`);

  return { ok: true, id: jobId };
}
