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
  type PrevisaoRecebimentoLinhaInput,
} from "@/lib/validations/abertura-financeiro";
import { lerFaturamentoMensalPeloJob } from "@/lib/data/faturamento-mensal";
import { nomeDoMes } from "@/lib/calculos/meses-trimestre";
import { formatCurrency } from "@/lib/utils";
import {
  ordenarCompetencias,
  rateioLabel,
  type JobCompetencia,
  type JobStatus,
  type TipoCusto,
} from "@/lib/types";
import { tipoGeraDesembolso } from "@/lib/calculos/versao-totais";
import { gerarCodigoProjetoFinanceiro } from "@/lib/codigos/projetos-financeiro";
import { consumoDasPrevisoes } from "./consumo";
import { registrarFotoDaAbertura } from "./fotos";
import { ehJanelaDePagamento, emCentavos, somaCurva } from "./curva";
import {
  custoPrevistoDoFinanceiro,
  enfileirarSavesDoJob,
  espelhosDaAprovacao,
  jobJaFoiDevolvido,
} from "./aprovacao-save";
import type { SaveAprovacaoMomento, SaveAprovacaoTipo } from "@/lib/types";
import type { EspelhosDoJob } from "@/lib/data/espelhos-do-job";

export type ActionResult =
  | {
      ok: true;
      id: string;
      /** `true` quando "Salvar" fechou uma revisão de errata — a tela
       *  volta para a fila, como na abertura (decisão 059). */
      revisao?: boolean;
    }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

/**
 * O serviço do job é uma `categorias_dominio` de escopo 'projeto' (Always
 * On, Ativação, Fee, Interno), do mesmo tenant, ativa. Sem esta
 * conferência um id de CATEGORIA passaria pela FK — as duas listas moram
 * na mesma tabela (decisão 037).
 */
async function conferirServico(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  servicoId: string,
): Promise<string | null> {
  const { data: servico } = await supabase
    .from("categorias_dominio")
    .select("id, escopo, ativo")
    .eq("id", servicoId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ id: string; escopo: string; ativo: boolean }>();

  if (!servico || servico.escopo !== "projeto") {
    return "Serviço de job inválido.";
  }
  if (!servico.ativo) {
    return "Este serviço foi inativado. Escolha outro.";
  }
  return null;
}

/**
 * Confere a categoria escolhida para o job na abertura.
 *
 * Além do escopo e do `ativo`, checa o **modelo de planilha**: ele tem que
 * ser o mesmo do orçamento que originou o job (decisão 072, 11/09/2026).
 *
 * Quem calcula o job é a cadeia do ORÇAMENTO — a categoria do job
 * classifica, não recalcula. Deixar o financeiro abrir um job internacional
 * com categoria nacional (ou o contrário) não quebraria número nenhum, mas
 * deixaria a tela dizendo "Categoria: Internacional" sobre um fechamento
 * nacional. A trava evita a contradição na origem.
 */
async function conferirCategoriaDoJob(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  categoriaId: string,
  orcamentoId: string,
): Promise<string | null> {
  const { data: categoria } = await supabase
    .from("categorias_dominio")
    .select("id, nome, escopo, ativo, modelo_planilha")
    .eq("id", categoriaId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{
      id: string;
      nome: string;
      escopo: string;
      ativo: boolean;
      modelo_planilha: string;
    }>();

  if (!categoria || categoria.escopo !== "orcamento") {
    return "Categoria de job inválida.";
  }
  if (!categoria.ativo) {
    return "Esta categoria foi inativada. Escolha outra para abrir o job.";
  }

  // `!categoria_id` é obrigatório: `orcamentos` tem duas FKs para
  // `categorias_dominio`, e o embed ambíguo derruba a query em silêncio.
  const { data: orc } = await supabase
    .from("orcamentos")
    .select("categoria:categorias_dominio!categoria_id(nome, modelo_planilha)")
    .eq("id", orcamentoId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{
      categoria: { nome: string; modelo_planilha: string } | null;
    }>();

  const modeloDoOrcamento = orc?.categoria?.modelo_planilha ?? "nacional";
  if (categoria.modelo_planilha !== modeloDoOrcamento) {
    return `A categoria "${categoria.nome}" usa um modelo de planilha diferente do orçamento, que é "${orc?.categoria?.nome ?? "sem categoria"}". O job fecha pela cadeia do orçamento, então a categoria dele precisa usar o mesmo modelo.`;
  }
  return null;
}

/**
 * Regrava o rateio de competência do job inteiro (`jobs_competencias`,
 * decisão 055): apaga e reinsere, como as previsões. Devolve a mensagem
 * de erro, ou null.
 */
async function gravarRateio(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  jobId: string,
  linhas: JobCompetencia[],
  userId: string,
): Promise<string | null> {
  const { error: deleteErro } = await supabase
    .from("jobs_competencias")
    .delete()
    .eq("job_id", jobId)
    .eq("tenant_id", tenantId);
  if (deleteErro) {
    console.error("[abertura-job.rateio-delete]", deleteErro.message);
    return deleteErro.message;
  }

  const { error: insertErro } = await supabase.from("jobs_competencias").insert(
    ordenarCompetencias(linhas).map((c) => ({
      tenant_id: tenantId,
      job_id: jobId,
      trimestre: c.trimestre,
      ano: c.ano,
      percentual: Math.round(c.percentual * 100) / 100,
      created_by: userId,
    })),
  );
  if (insertErro) {
    console.error("[abertura-job.rateio-insert]", insertErro.message);
    return insertErro.message;
  }
  return null;
}

interface LinhaDeRecebimento {
  data_prevista: string;
  valor: number;
  mes: string | null;
  valor_save: number | null;
}

/**
 * A previsão de recebimento conferida contra o modelo do job.
 *
 * Job mensal — Fee e Always On (decisão 078, entrega 3): uma linha por mês
 * que tem faturamento, no valor do mês pela planilha, relido do banco. O
 * financeiro informa o dia e revisa a data; o valor não é dele (Tiago,
 * 14/09/2026). A parte de save do mês vai junto, para o fluxo de caixa
 * separar a receita própria.
 *
 * Os outros jobs seguem como sempre, e não aceitam linha com mês.
 */
async function conferirRecebimentoPorMes(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  jobId: string,
  linhas: PrevisaoRecebimentoLinhaInput[],
  /** Pedidos de save que contam como aprovados: o que a revisão aprova. */
  contarPedidos: string[],
): Promise<{ erro: string } | { mensal: boolean; linhas: LinhaDeRecebimento[] }> {
  const leitura = await lerFaturamentoMensalPeloJob(
    supabase,
    tenantId,
    jobId,
    contarPedidos,
  );
  if (!leitura) {
    return { erro: "Não foi possível ler o modelo de planilha do job." };
  }
  if (!leitura.mensal) {
    if (linhas.some((l) => l.mes)) {
      return {
        erro: "Só job de Fee ou Always On tem previsão de recebimento por mês.",
      };
    }
    return {
      mensal: false,
      linhas: linhas.map((l) => ({
        data_prevista: l.data_prevista,
        valor: l.valor,
        mes: null,
        valor_save: null,
      })),
    };
  }
  if (!leitura.meses) {
    return { erro: "Não foi possível ler o faturamento dos meses do job." };
  }

  const comFaturamento = leitura.meses.filter((m) => m.faturamento > 0);
  const porMes = new Map(linhas.map((l) => [l.mes ?? "", l]));
  const casam =
    porMes.size === linhas.length &&
    linhas.length === comFaturamento.length &&
    comFaturamento.every((m) => porMes.has(m.mes));
  if (!casam) {
    return {
      erro: "A previsão de recebimento deste job é uma linha por mês. Recarregue a página e confira os meses.",
    };
  }
  for (const m of comFaturamento) {
    const linha = porMes.get(m.mes)!;
    if (Math.abs(linha.valor - m.faturamento) >= TOLERANCIA_CURVA) {
      return {
        erro: `O recebimento de ${nomeDoMes(m.mes)} precisa ser o faturamento do mês, ${formatCurrency(m.faturamento)}. Recarregue a página: a planilha pode ter mudado.`,
      };
    }
  }
  return {
    mensal: true,
    linhas: comFaturamento.map((m) => ({
      data_prevista: porMes.get(m.mes)!.data_prevista,
      valor: m.faturamento,
      mes: m.mes,
      valor_save: Math.min(m.save, m.faturamento),
    })),
  };
}

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
      "id, status, projeto_id, orcamento_id, faturamento_previsto, valor_total, projeto:projetos(cliente_id)",
    )
    .eq("id", jobId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{
      id: string;
      status: JobStatus;
      projeto_id: string;
      orcamento_id: string;
      faturamento_previsto: number | string | null;
      valor_total: number | string | null;
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

  // Escopo, `ativo` e — desde a decisão 072 — o modelo de planilha, que
  // tem que ser o mesmo do orçamento.
  const categoriaErro = await conferirCategoriaDoJob(
    supabase,
    session.activeTenant.id,
    parsed.data.categoria_id,
    job.orcamento_id,
  );
  if (categoriaErro) return { ok: false, message: categoriaErro };

  const servicoErro = await conferirServico(
    supabase,
    session.activeTenant.id,
    parsed.data.servico_id,
  );
  if (servicoErro) return { ok: false, message: servicoErro };

  // A primeira competência do rateio é a que `jobs` guarda (decisão 055).
  const rateio = ordenarCompetencias(parsed.data.competencias);
  const primeiraCompetencia = rateio[0];

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

  const recebimentoConferido = await conferirRecebimentoPorMes(
    supabase,
    session.activeTenant.id,
    jobId,
    parsed.data.recebimento,
    [],
  );
  if ("erro" in recebimentoConferido) {
    return { ok: false, message: recebimentoConferido.erro };
  }

  if (!semRecebimento) {
    if (parsed.data.recebimento.length === 0) {
      return {
        ok: false,
        message: "A previsão de recebimento precisa de pelo menos uma parcela.",
      };
    }

    const somaReceb = somaCurva(parsed.data.recebimento);
    if (
      !recebimentoConferido.mensal &&
      Math.abs(somaReceb - faturamentoPrevisto) >= TOLERANCIA_CURVA
    ) {
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
      servico_id: parsed.data.servico_id,
      competencia_trimestre: primeiraCompetencia.trimestre,
      competencia_ano: primeiraCompetencia.ano,
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

  // Os saves e consumos que vieram do orçamento entram na faixa Saves
  // agora (decisão 099): o financeiro acabou de conferir estes números, e
  // a linha já conta para ele. A RPC só aceita job `aberto` — por isso
  // roda depois do update acima, e antes do resto, que pode sair mais
  // cedo com erro. Falha aqui não desfaz a abertura: fica guardada e vira
  // a mensagem do fim, se nada mais falhar.
  const momentoDosSaves = (await jobJaFoiDevolvido(
    supabase,
    session.activeTenant.id,
    jobId,
  ))
    ? "reenvio"
    : "abertura";
  const saves = await enfileirarSavesDoJob(
    supabase,
    session.activeTenant.id,
    jobId,
    momentoDosSaves,
  );
  if (saves.ok && saves.quantidade > 0) {
    await logAuditEvent({
      acao: "save.pedido.enviado",
      tenantId: session.activeTenant.id,
      entidadeTipo: "job",
      entidadeId: jobId,
      metadata: { momento: momentoDosSaves, quantidade: saves.quantidade },
    });
  }

  // O rateio de competência, logo depois do registro — o job já está
  // aberto quando isto roda; falha aqui é reportada, não desfaz a
  // abertura (mesmo contrato das previsões, abaixo).
  const rateioErro = await gravarRateio(
    supabase,
    session.activeTenant.id,
    jobId,
    rateio,
    session.profile.id,
  );
  if (rateioErro) {
    await logAuditEvent({
      acao: "job.aberto_no_financeiro",
      tenantId: session.activeTenant.id,
      entidadeTipo: "job",
      entidadeId: jobId,
      metadata: { rateio_falhou: true, erro: rateioErro },
    });
    return {
      ok: false,
      message:
        "O job foi aberto, mas o rateio de competência não foi gravado. Edite o registro na aba Abertura do Job.",
    };
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
          .insert(
            recebimentoConferido.linhas.map((l, i) => ({
              ...linhaPrevisao(l, i),
              mes: l.mes,
              valor_save: l.valor_save,
            })),
          ),
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
      servico_id: parsed.data.servico_id,
      competencia: rateioLabel(rateio),
      competencias: rateio,
      custo_previsto_total: custoPrevisto,
      datas_na_curva: parsed.data.curva.length,
      sem_desembolso: semDesembolso,
      faturamento_previsto: faturamentoPrevisto,
      parcelas_de_recebimento: parsed.data.recebimento.length,
      sem_recebimento: semRecebimento,
    },
  });

  // A foto nº 1 (decisão 059). O job já está aberto: se a foto falhar, a
  // abertura fica de pé e o erro vai para o log — a aba do job mostra o
  // histórico vazio, e não um job fechado por causa do histórico.
  await registrarFotoDaAbertura(supabase, {
    tenantId: session.activeTenant.id,
    jobId,
    tipo: "abertura",
    errataId: null,
    profileId: session.profile.id,
    registro: {
      nome_financeiro: parsed.data.nome_financeiro,
      projeto_financeiro_id: parsed.data.projeto_financeiro_id,
      conta_recebimento_id: parsed.data.conta_recebimento_id,
      conta_pagamento_id: parsed.data.conta_pagamento_id,
      categoria_id: parsed.data.categoria_id,
      servico_id: parsed.data.servico_id,
      competencias: rateio,
      curva: parsed.data.curva,
      recebimento: parsed.data.recebimento,
      valorJob: job.valor_total === null ? null : Number(job.valor_total),
      faturamentoPrevisto,
      custoPrevisto,
    },
  });

  revalidatePath("/financeiro");
  revalidatePath("/financeiro/abertura-de-job");
  revalidatePath(`/financeiro/abertura-de-job/${jobId}`);
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
  revalidatePath(`/orcamentos/${job.projeto_id}/${job.orcamento_id}`);

  if (!saves.ok) {
    await logAuditEvent({
      acao: "job.aberto_no_financeiro",
      tenantId: session.activeTenant.id,
      entidadeTipo: "job",
      entidadeId: jobId,
      metadata: { saves_falharam: true, momento: momentoDosSaves, erro: saves.message },
    });
    return {
      ok: false,
      message: `O job foi aberto, mas os saves dele não entraram na faixa Saves (${saves.message}). A produção pode enviá-los pelo botão “Enviar saves para aprovação”, acima da planilha do job.`,
    };
  }

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
  // Sem `Set` aqui a conferência quebra no caso mais comum da casa:
  // a California tem UMA conta bancária real, então recebimento e
  // pagamento apontam para o mesmo id. A lista vinha com 2 entradas
  // iguais, o `.in()` devolvia 1 linha, e o `length !==` reprovava a
  // abertura com "Conta bancária inválida." mesmo com a conta escolhida
  // e ativa (31/08/2026).
  const contasPedidas = Array.from(
    new Set(
      [input.conta_recebimento_id, input.conta_pagamento_id].filter(
        (c): c is string => Boolean(c),
      ),
    ),
  );

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
 * categoria, serviço, rateio de competência e as duas previsões.
 *
 * O que NUNCA muda: `data_abertura_financeiro`, `aberto_por` e `status`.
 * A abertura aconteceu uma vez — reescrever quem conferiu apagaria a
 * única prova de quem conferiu.
 *
 * ---------------------------------------------------------------------
 * As previsões se redistribuem inteiras (Tiago, 08/09/2026 — decisão 061)
 * ---------------------------------------------------------------------
 *
 * Até aqui valia a trava de 20/08/2026: o que PP ou nota emitida já
 * tinha consumido ficava congelado, e só o saldo era editável
 * (`edicaoRespeitaConsumido`). Ela caiu inteira, dos dois lados.
 *
 * O motivo veio de um beco real (JOB-0029): uma PP de R$ 10.000 num
 * item planejado em R$ 8.000 consumia MAIS que a curva inteira, então
 * todas as linhas congelavam — e a comparação da fatia congelada
 * recusava qualquer edição, inclusive acrescentar a data que a errata
 * exigia. Não havia saída pela tela.
 *
 * E a trava já protegia pouco: desde a decisão 052 o abatimento da curva
 * é calculado POR ITEM (planejado menos as PPs que viraram título), não
 * pela ordem cronológica das parcelas — mudar as datas não muda o quanto
 * o fluxo abate. O "antes" também deixou de depender dela: desde a
 * decisão 059 cada registro confirmado deixa uma foto imutável.
 *
 * O total continua fechando com o custo previsto e com o faturamento
 * previsto, exatamente como na abertura: o que a edição libera é a
 * distribuição, não o dinheiro.
 */
export async function editarRegistroDaAbertura(
  jobId: string,
  input: EdicaoRegistroAberturaInput,
  /**
   * Aprovação de save (decisão 099): o pedido que este registro aprova.
   * Aprovar É registrar a revisão da abertura — o formulário mostra e
   * valida os números de depois da aprovação, e só este registro aprova.
   * `null` na edição e na revisão de sempre.
   */
  aprovarSaveId: string | null,
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
      "id, status, projeto_id, orcamento_id, faturamento_previsto, valor_total, " +
        "nome_financeiro, projeto_financeiro_id, conta_recebimento_id, " +
        "conta_pagamento_id, categoria_id, servico_id, competencia_trimestre, " +
        "competencia_ano, abertura_em_revisao, abertura_revisao_errata_id, " +
        "projeto:projetos(cliente_id)",
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

  // ---- Aprovação de save (decisão 099) ----
  // O pedido precisa ser deste job e ainda aguardar. Os espelhos de
  // depois da aprovação são calculados agora, antes de qualquer gravação:
  // a previsão de recebimento é validada contra eles, e só com tudo
  // conferido a RPC aprova.
  let aprovacao: {
    id: string;
    tipo: SaveAprovacaoTipo;
    momento: SaveAprovacaoMomento;
    errataId: string | null;
    itemDescricao: string;
    grupoNome: string | null;
    valor: number;
    /** Os espelhos que a RPC grava. `null` fora do `job_aberto`: o
     *  financeiro já contava a linha, e não há o que regravar. */
    totais: EspelhosDoJob | null;
  } | null = null;
  if (aprovarSaveId) {
    const { data: pedido, error: pedidoErr } = await supabase
      .from("saves_aprovacoes")
      .select("id, job_id, situacao, tipo, momento, errata_id, item_descricao, grupo_nome, valor")
      .eq("id", aprovarSaveId)
      .eq("tenant_id", session.activeTenant.id)
      .eq("job_id", jobId)
      .maybeSingle<{
        id: string;
        job_id: string;
        situacao: string;
        tipo: SaveAprovacaoTipo;
        momento: SaveAprovacaoMomento;
        errata_id: string | null;
        item_descricao: string;
        grupo_nome: string | null;
        valor: number | string;
      }>();
    if (pedidoErr) console.error("[abertura-job.aprovar-save.pedido]", pedidoErr.message);
    if (!pedido) {
      return { ok: false, message: "Pedido de save não encontrado neste job." };
    }
    if (pedido.situacao !== "aguardando") {
      return {
        ok: false,
        message:
          "Este pedido de save já foi decidido — outra pessoa pode ter aprovado ou recusado enquanto você revisava.",
      };
    }
    const totais = await espelhosDaAprovacao(
      supabase,
      session.activeTenant.id,
      jobId,
      pedido.id,
      pedido.momento,
    );
    if (!totais.ok) return { ok: false, message: totais.message };
    aprovacao = {
      id: pedido.id,
      tipo: pedido.tipo,
      momento: pedido.momento,
      errataId: pedido.errata_id ?? null,
      itemDescricao: pedido.item_descricao,
      grupoNome: pedido.grupo_nome ?? null,
      valor: Number(pedido.valor ?? 0),
      totais: totais.totais,
    };
  }

  // Lido ANTES do update, que apaga a marca: é o que distingue "Registrar
  // revisão de abertura" de "Editar registro" na foto e na auditoria. A
  // aprovação de save é sempre revisão, com o job em revisão ou não (o
  // pedido que veio da abertura não pôs o job em revisão, e a aprovação
  // passa pelo mesmo formulário).
  const eraRevisao = job.abertura_em_revisao === true || aprovacao !== null;
  const errataDaRevisao = eraRevisao
    ? (aprovacao?.errataId ??
      (job.abertura_revisao_errata_id as string | null) ??
      null)
    : null;

  // Todas as erratas que esta revisão trata (decisão do Tiago, 14/09/2026):
  // as registradas depois da última foto da abertura. `errataDaRevisao`
  // segue sendo a última, que é a que a foto guarda; a lista inteira vai
  // para a auditoria. Lida ANTES de gravar a foto nova, que fecha a janela.
  let erratasDaRevisao: string[] = [];
  if (eraRevisao) {
    const { data: fotoAnterior } = await supabase
      .from("jobs_aberturas")
      .select("registrado_em")
      .eq("tenant_id", session.activeTenant.id)
      .eq("job_id", jobId)
      .order("registrado_em", { ascending: false })
      .limit(1)
      .maybeSingle<{ registrado_em: string }>();
    let pendentes = supabase
      .from("jobs_erratas")
      .select("id")
      .eq("tenant_id", session.activeTenant.id)
      .eq("job_id", jobId)
      .order("created_at", { ascending: true });
    if (fotoAnterior?.registrado_em) {
      pendentes = pendentes.gt("created_at", fotoAnterior.registrado_em);
    }
    const { data: ids } = await pendentes;
    erratasDaRevisao = ((ids ?? []) as Array<{ id: string }>).map((e) => e.id);
  }

  // Escopo, `ativo` e — desde a decisão 072 — o modelo de planilha, que
  // tem que ser o mesmo do orçamento.
  const categoriaErro = await conferirCategoriaDoJob(
    supabase,
    session.activeTenant.id,
    parsed.data.categoria_id,
    job.orcamento_id,
  );
  if (categoriaErro) return { ok: false, message: categoriaErro };

  const servicoErro = await conferirServico(
    supabase,
    session.activeTenant.id,
    parsed.data.servico_id,
  );
  if (servicoErro) return { ok: false, message: servicoErro };

  const rateio = ordenarCompetencias(parsed.data.competencias);
  const primeiraCompetencia = rateio[0];

  const refsErro = await conferirProjetoEContas(
    supabase,
    session.activeTenant.id,
    job.projeto?.cliente_id ?? null,
    parsed.data,
  );
  if (refsErro) return { ok: false, message: refsErro };

  // Os dois totais são relidos do banco, como na abertura: o navegador
  // não é fonte confiável para dinheiro.
  //
  // O custo sai da conta do FINANCEIRO (decisão 099): a linha com pedido
  // de save que ele ainda não conta entra com o planejado de antes do
  // save. Até 22/09/2026 vinha do `total_planejado` cru, e um save
  // aguardando sumia do custo gravado — se depois fosse recusado, a curva
  // de desembolso ficava menor que o custo real, sem aviso.
  const custoLido = await custoPrevistoDoFinanceiro(
    supabase,
    session.activeTenant.id,
    jobId,
    aprovacao?.id ?? null,
  );
  if (!custoLido.ok) return { ok: false, message: custoLido.message };
  const custoPrevisto = emCentavos(custoLido.custo);
  // Na aprovação de um pedido `job_aberto` o faturamento previsto que vale
  // é o de DEPOIS da aprovação — é ele que a RPC grava logo abaixo.
  const faturamentoPrevisto = emCentavos(
    aprovacao?.totais
      ? aprovacao.totais.faturamento_previsto
      : Number(job.faturamento_previsto ?? 0),
  );
  const valorJobDaFoto = aprovacao?.totais
    ? aprovacao.totais.valor_total
    : job.valor_total === null
      ? null
      : Number(job.valor_total);

  const [consumo, curvaAtualRes, recebAtualRes, rateioAtualRes] = await Promise.all([
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
    // O rateio como estava — só para o de/para da auditoria.
    supabase
      .from("jobs_competencias")
      .select("trimestre, ano, percentual")
      .eq("job_id", jobId)
      .eq("tenant_id", session.activeTenant.id),
  ]);

  const rateioGuardado: JobCompetencia[] = (
    (rateioAtualRes.data ?? []) as any[]
  ).map((c) => ({
    trimestre: Number(c.trimestre),
    ano: Number(c.ano),
    percentual: Number(c.percentual ?? 0),
  }));

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

  const recebimentoConferido = await conferirRecebimentoPorMes(
    supabase,
    session.activeTenant.id,
    jobId,
    parsed.data.recebimento,
    aprovarSaveId ? [aprovarSaveId] : [],
  );
  if ("erro" in recebimentoConferido) {
    return { ok: false, message: recebimentoConferido.erro };
  }

  if (!semRecebimento) {
    if (parsed.data.recebimento.length === 0) {
      return {
        ok: false,
        message: "A previsão de recebimento precisa de pelo menos uma parcela.",
      };
    }

    const somaReceb = somaCurva(parsed.data.recebimento);
    if (
      !recebimentoConferido.mensal &&
      Math.abs(somaReceb - faturamentoPrevisto) >= TOLERANCIA_CURVA
    ) {
      return {
        ok: false,
        message: `As parcelas de recebimento somam ${somaReceb.toFixed(2)} e o faturamento previsto é ${faturamentoPrevisto.toFixed(2)}. Ajuste os valores antes de salvar.`,
      };
    }
  }

  // Tudo conferido: agora a aprovação. A RPC confere de novo que a linha
  // continua como o pedido descreve, grava os espelhos (pedido
  // `job_aberto`) e muda a situação — numa transação só. Se ela recusar,
  // nada deste registro foi gravado ainda.
  if (aprovacao) {
    const { error: rpcErr } = await supabase.rpc("decidir_pedido_save", {
      p_id: aprovacao.id,
      p_decisao: "aprovar",
      p_justificativa: null,
      p_totais: aprovacao.totais,
      // O registro logo abaixo é que encerra a revisão.
      p_revisao: "manter",
    });
    if (rpcErr) {
      console.error("[abertura-job.aprovar-save.rpc]", rpcErr.message);
      return { ok: false, message: rpcErr.message };
    }
    await logAuditEvent({
      acao: "save.pedido.aprovado",
      tenantId: session.activeTenant.id,
      entidadeTipo: "job",
      entidadeId: jobId,
      metadata: {
        pedido_id: aprovacao.id,
        tipo: aprovacao.tipo,
        momento: aprovacao.momento,
        item: aprovacao.itemDescricao,
        grupo: aprovacao.grupoNome,
        valor: aprovacao.valor,
        errata_id: aprovacao.errataId,
        totais: aprovacao.totais,
      },
    });
  }
  // A partir daqui, se algo falhar com a aprovação feita, a mensagem diz.
  // Duas frases, e não um "mas" atrás do outro: o que deu certo vem
  // junto ("o save foi aprovado E o registro foi salvo"), e o "mas" fica
  // só para o que faltou (achado da revisão de 22/09/2026).
  const aprovado = aprovacao
    ? `${aprovacao.tipo === "gera" ? "O save" : "O consumo"} foi aprovado`
    : "";
  /** "O save foi aprovado e os dados do registro foram salvos, mas …" —
   *  sem a aprovação, só a segunda metade. */
  const salvoMas = (oQueFaltou: string) =>
    aprovacao
      ? `${aprovado} e os dados do registro foram salvos, mas ${oQueFaltou}`
      : `Os dados do registro foram salvos, mas ${oQueFaltou}`;

  const { error: updateErro } = await supabase
    .from("jobs")
    .update({
      nome_financeiro: parsed.data.nome_financeiro,
      projeto_financeiro_id: parsed.data.projeto_financeiro_id,
      conta_recebimento_id: parsed.data.conta_recebimento_id,
      conta_pagamento_id: parsed.data.conta_pagamento_id,
      categoria_id: parsed.data.categoria_id,
      servico_id: parsed.data.servico_id,
      competencia_trimestre: primeiraCompetencia.trimestre,
      competencia_ano: primeiraCompetencia.ano,
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
    return {
      ok: false,
      message: aprovacao
        ? `${aprovado}, mas a revisão da abertura não foi registrada. Registre a revisão de novo na aba Abertura do Job.`
        : "Não foi possível salvar as alterações.",
    };
  }

  const rateioErro = await gravarRateio(
    supabase,
    session.activeTenant.id,
    jobId,
    rateio,
    session.profile.id,
  );
  if (rateioErro) {
    await logAuditEvent({
      acao: "job.registro_abertura_editado",
      tenantId: session.activeTenant.id,
      entidadeTipo: "job",
      entidadeId: jobId,
      metadata: { rateio_falhou: true, erro: rateioErro },
    });
    return {
      ok: false,
      message: salvoMas(
        "o rateio de competência não foi regravado. Confira a competência na aba Abertura do Job.",
      ),
    };
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
          .insert(
            recebimentoConferido.linhas.map((l, i) => ({
              ...linhaPrevisao(l, i),
              mes: l.mes,
              valor_save: l.valor_save,
            })),
          ),
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
      message: salvoMas(
        "a previsão não foi regravada. Confira as datas na aba Abertura do Job.",
      ),
    };
  }

  // De/para de tudo que mudou: é o registro de quem alterou o quê,
  // decidido em 20/08/2026 para viver só na auditoria (sem bloco de
  // histórico na tela).
  await logAuditEvent({
    acao: eraRevisao ? "job.abertura_revisada" : "job.registro_abertura_editado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "job",
    entidadeId: jobId,
    metadata: {
      errata_id: errataDaRevisao,
      erratas_ids: erratasDaRevisao,
      aprovou_save: aprovacao?.id ?? null,
      de: {
        nome_financeiro: job.nome_financeiro,
        projeto_financeiro_id: job.projeto_financeiro_id,
        conta_recebimento_id: job.conta_recebimento_id,
        conta_pagamento_id: job.conta_pagamento_id,
        categoria_id: job.categoria_id,
        servico_id: job.servico_id,
        competencia: rateioLabel(rateioGuardado),
        competencias: ordenarCompetencias(rateioGuardado),
        curva: curvaGuardada,
        recebimento: recebGuardado,
      },
      para: {
        nome_financeiro: parsed.data.nome_financeiro,
        projeto_financeiro_id: parsed.data.projeto_financeiro_id,
        conta_recebimento_id: parsed.data.conta_recebimento_id,
        conta_pagamento_id: parsed.data.conta_pagamento_id,
        categoria_id: parsed.data.categoria_id,
        servico_id: parsed.data.servico_id,
        competencia: rateioLabel(rateio),
        competencias: rateio,
        curva: parsed.data.curva,
        recebimento: parsed.data.recebimento,
      },
      consumido_na_edicao: consumo,
    },
  });

  // A foto desta confirmação (decisão 059): revisão de errata ou edição
  // livre, com a errata pendurada quando é o caso.
  await registrarFotoDaAbertura(supabase, {
    tenantId: session.activeTenant.id,
    jobId,
    tipo: eraRevisao ? "revisao_errata" : "edicao",
    errataId: errataDaRevisao,
    profileId: session.profile.id,
    registro: {
      nome_financeiro: parsed.data.nome_financeiro,
      projeto_financeiro_id: parsed.data.projeto_financeiro_id,
      conta_recebimento_id: parsed.data.conta_recebimento_id,
      conta_pagamento_id: parsed.data.conta_pagamento_id,
      categoria_id: parsed.data.categoria_id,
      servico_id: parsed.data.servico_id,
      competencias: rateio,
      curva: parsed.data.curva,
      recebimento: parsed.data.recebimento,
      valorJob: valorJobDaFoto,
      faturamentoPrevisto,
      custoPrevisto,
    },
  });

  revalidatePath("/financeiro");
  revalidatePath("/financeiro/abertura-de-job");
  revalidatePath(`/financeiro/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}`);
  if (aprovacao) revalidatePath("/jobs");

  return { ok: true, id: jobId, revisao: eraRevisao };
}
