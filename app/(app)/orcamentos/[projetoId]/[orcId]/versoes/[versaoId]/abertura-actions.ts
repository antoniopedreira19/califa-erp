"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { checarPermissao } from "@/lib/permissoes-server";
import { aberturaJobSchema } from "@/lib/validations/abertura-job";
import { calcularTotaisVersao } from "@/lib/calculos/versao-totais";
import { configDaPlanilha } from "@/app/(app)/_planilha/modelo-planilha";
import type { CategoriaModeloPlanilha } from "@/lib/types";
import { gerarCodigoJob } from "@/lib/codigos/jobs";
import type { VersaoOrcamentoItem } from "@/lib/types";

export type AberturaResult =
  | { ok: true; jobId: string; codigo: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

/**
 * Os contatos de cobrança chegam como JSON num campo único do FormData —
 * é o único campo composto do formulário. Payload ilegível vira array
 * vazio de propósito: o schema devolve "Informe ao menos um contato de
 * cobrança.", que é a mensagem certa para quem está na tela.
 */
function parseContatos(raw: string): unknown {
  if (!raw) return [];
  try {
    const valor = JSON.parse(raw);
    return Array.isArray(valor) ? valor : [];
  } catch {
    return [];
  }
}

function extractInput(formData: FormData) {
  return {
    nome: formData.get("nome")?.toString() ?? "",
    cidade_id: formData.get("cidade_id")?.toString() ?? "",
    regional_id: formData.get("regional_id")?.toString() ?? "",
    data_inicio_prevista: formData.get("data_inicio_prevista")?.toString() ?? "",
    data_fim_prevista: formData.get("data_fim_prevista")?.toString() ?? "",
    data_evento: formData.get("data_evento")?.toString() ?? "",
    data_prevista_faturamento:
      formData.get("data_prevista_faturamento")?.toString() ?? "",
    observacoes: formData.get("observacoes")?.toString() ?? "",
    contatos_cobranca: parseContatos(
      formData.get("contatos_cobranca")?.toString() ?? "",
    ),
  };
}

function mapDbError(msg: string): string {
  if (msg.includes("uniq_jobs_codigo_por_tenant")) {
    return "Já existe um job com este código — tente novamente.";
  }
  if (msg.includes("uniq_jobs_por_orcamento_ativo")) {
    return "Este orçamento já tem um job ativo.";
  }
  if (msg.includes("uniq_jobs_principal_por_projeto")) {
    return "Já existe um job principal neste projeto.";
  }
  if (msg.includes("jobs_datas_ordem")) {
    return "A data de fim não pode ser anterior à data de início.";
  }
  if (msg.includes("orcamentos_datas_ordem")) {
    return "As datas não podem ser gravadas no orçamento: fim anterior ao início.";
  }
  return "Não foi possível enviar o job para abertura.";
}

/**
 * Envia o job para abertura a partir da versão aprovada.
 *
 * Diferenças em relação ao antigo `criarJob`:
 * - não há mais conceito de principal/sub-job: cada orçamento aprovado
 *   vira um job independente dentro do projeto — nenhuma hierarquia é
 *   decidida aqui nem em outro lugar;
 * - `valor_total` é recalculado a partir dos itens da versão, nunca vem
 *   do formulário;
 * - nome, datas, cidade e regional informados no modal são gravados
 *   TAMBÉM no orçamento.
 */
export async function enviarJobParaAbertura(
  versaoId: string,
  formData: FormData,
): Promise<AberturaResult> {
  const session = await requireSession();
  const parsed = aberturaJobSchema.safeParse(extractInput(formData));

  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();

  // 1. Versão precisa estar aprovada e ser a versão aprovada do orçamento.
  const { data: versao } = await supabase
    .from("versoes_orcamento")
    .select(
      // Os quatro últimos são da cadeia internacional (decisão 072). Sem
      // eles o job nasceria com o fechamento NACIONAL — e `valor_total`,
      // `faturamento_previsto` e os dois `_abertura` são GRAVADOS aqui,
      // com os `_abertura` congelados para sempre. Erro de leitura vira
      // erro permanente no banco.
      "id, status, orcamento_id, percentual_honorarios, percentual_imposto, percentual_int_taxes, int_transaction_costs, moeda_estrangeira, cambio_compra",
    )
    .eq("id", versaoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{
      id: string;
      status: string;
      orcamento_id: string;
      percentual_honorarios: number;
      // Obrigatórios, nunca opcionais: linha estreita montada à mão com
      // campo opcional é como campo novo some em silêncio (CLAUDE.md).
      percentual_int_taxes: number;
      int_transaction_costs: number;
      moeda_estrangeira: string | null;
      cambio_compra: number | null;
      percentual_imposto: number;
    }>();

  if (!versao) return { ok: false, message: "Versão não encontrada." };
  if (versao.status !== "aprovada") {
    return { ok: false, message: "Só a versão aprovada abre job." };
  }

  const { data: orc } = await supabase
    .from("orcamentos")
    .select(
      // `!categoria_id` é obrigatório: `orcamentos` tem duas FKs para
      // `categorias_dominio` (categoria e serviço), e o embed ambíguo
      // derruba a query inteira em silêncio.
      "id, status, versao_aprovada_id, projeto_id, gp_responsavel_id, produtor_id, categoria:categorias_dominio!categoria_id(modelo_planilha)",
    )
    .eq("id", versao.orcamento_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{
      id: string;
      status: string;
      versao_aprovada_id: string | null;
      projeto_id: string;
      gp_responsavel_id: string | null;
      produtor_id: string | null;
      categoria: { modelo_planilha: CategoriaModeloPlanilha } | null;
    }>();

  if (!orc) return { ok: false, message: "Orçamento não encontrado." };
  if (orc.versao_aprovada_id !== versaoId) {
    return {
      ok: false,
      message: "O orçamento não está aprovado nesta versão.",
    };
  }

  // 2. Um job vivo por orçamento (o unique index também barra; aqui é
  //    só pra devolver mensagem boa antes de gastar o resto).
  //
  //    Exceção, desde 08/09/2026 (decisão 057): o job que o financeiro
  //    DEVOLVEU. Reenviar é refazer o formulário sobre o MESMO job — ele
  //    guarda a cópia da planilha, o consumo de save, os BVs e as PPs já
  //    geradas na pré-abertura, e o código não muda para o cliente. Nesse caso o orçamento está em `job_criado`, não
  //    em `aprovado`; fora dele continua valendo `aprovado`.
  const { data: jobVivo } = await supabase
    .from("jobs")
    .select("id, codigo, status")
    .eq("orcamento_id", orc.id)
    .eq("tenant_id", session.activeTenant.id)
    .neq("status", "cancelado")
    .maybeSingle<{ id: string; codigo: string; status: string }>();

  const jobDevolvido =
    jobVivo && jobVivo.status === "rejeitado_financeiro" ? jobVivo : null;

  if (jobVivo && !jobDevolvido) {
    return { ok: false, message: "Este orçamento já tem um job ativo." };
  }
  if (jobDevolvido) {
    if (orc.status !== "job_criado") {
      return {
        ok: false,
        message: "O orçamento e o job devolvido estão em estados diferentes. Avise o suporte.",
      };
    }
  } else if (orc.status !== "aprovado") {
    return {
      ok: false,
      message: "O orçamento não está aprovado nesta versão.",
    };
  }

  // 3. Produto vem do projeto; GP e produtor vêm do orçamento. O
  //    formulário só exibe esses três — reler do banco é o que garante
  //    que o job grave o que está cadastrado, e não o que chegou no
  //    payload. Cidade e regional, ao contrário, o modal deixa trocar:
  //    vêm do formulário e são conferidas logo abaixo.
  const { data: projeto } = await supabase
    .from("projetos")
    .select("id, cliente_id, produto_id")
    .eq("id", orc.projeto_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ id: string; cliente_id: string; produto_id: string | null }>();

  if (!projeto) return { ok: false, message: "Projeto não encontrado." };

  const faltando: string[] = [];
  if (!projeto.produto_id) faltando.push("Marca (no projeto)");
  if (!orc.gp_responsavel_id) faltando.push("GP responsável (no orçamento)");
  if (!orc.produtor_id) faltando.push("Produtor responsável (no orçamento)");

  if (faltando.length > 0) {
    return {
      ok: false,
      message: `Complete o cadastro antes de abrir o job: ${faltando.join(", ")}.`,
    };
  }

  // A regional escolhida precisa estar entre as do projeto — a mesma
  // regra do formulário do orçamento. A lista do modal já filtra, mas
  // quem manda o payload não é obrigado a respeitá-la.
  const [produtoRes, cidadeRes, regionalDoProjetoRes] = await Promise.all([
    supabase
      .from("cliente_produtos")
      .select("id, nome")
      .eq("id", projeto.produto_id!)
      .eq("cliente_id", projeto.cliente_id)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle<{ id: string; nome: string }>(),
    supabase
      .from("cidades")
      .select("id, nome")
      .eq("id", parsed.data.cidade_id)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle<{ id: string; nome: string }>(),
    supabase
      .from("projeto_regionais")
      .select("regional_id")
      .eq("projeto_id", orc.projeto_id)
      .eq("regional_id", parsed.data.regional_id)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle<{ regional_id: string }>(),
  ]);

  if (!produtoRes.data) {
    return {
      ok: false,
      message: "O produto cadastrado no projeto não pertence mais a este cliente. Edite o projeto.",
    };
  }
  if (!cidadeRes.data) {
    return {
      ok: false,
      message: "A cidade escolhida não existe mais no cadastro. Selecione outra.",
      fieldErrors: { cidade_id: ["Cidade não encontrada no cadastro."] },
    };
  }
  if (!regionalDoProjetoRes.data) {
    return {
      ok: false,
      message: "A regional escolhida não está cadastrada neste projeto. Selecione outra.",
      fieldErrors: { regional_id: ["Regional não cadastrada no projeto."] },
    };
  }

  // 4. Valor total = VALOR DO JOB, recalculado dos itens. É o compromisso
  //    total do cliente — inclui o que ele paga direto ao fornecedor. O
  //    faturamento previsto (só o que a California emite nota) aparece na
  //    tela, mas não é o que dimensiona o job no financeiro.
  const { data: itensBrutos, error: itensErr } = await supabase
    .from("versoes_orcamento_itens")
    .select("tipo_custo, total_orcado, em_save, save_consumido")
    .eq("versao_orcamento_id", versaoId)
    .eq("tenant_id", session.activeTenant.id);

  if (itensErr) {
    console.error("[abertura.itens]", itensErr.message);
    return { ok: false, message: "Não foi possível calcular o valor do job." };
  }

  // Quem decide a cadeia é a categoria do ORÇAMENTO, não a do job
  // (decisão 072, definida em 11/09/2026). O financeiro escolhe uma
  // categoria para o job na abertura, e ela classifica — não recalcula.
  // Fosse a do job, trocá-la moveria o fechamento vivo por baixo de um
  // `valor_job_abertura` que está congelado, e a tela do financeiro
  // mostraria uma errata que ninguém fez.
  const totais = calcularTotaisVersao(
    (itensBrutos ?? []) as unknown as VersaoOrcamentoItem[],
    Number(versao.percentual_honorarios ?? 0),
    Number(versao.percentual_imposto ?? 0),
    configDaPlanilha(orc.categoria?.modelo_planilha, versao).internacional,
  );

  let codigo: string;
  try {
    codigo = await gerarCodigoJob(supabase, session.activeTenant.id);
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }

  // 5. Nome, datas, cidade e regional voltam para o orçamento, como
  //    avisa o modal — orçamento e job nunca divergem nesses campos.
  const { error: errOrcDados } = await supabase
    .from("orcamentos")
    .update({
      nome: parsed.data.nome,
      cidade_id: parsed.data.cidade_id,
      regional_id: parsed.data.regional_id,
      data_inicio_prevista: parsed.data.data_inicio_prevista,
      data_fim_prevista: parsed.data.data_fim_prevista,
    })
    .eq("id", orc.id)
    .eq("tenant_id", session.activeTenant.id);

  if (errOrcDados) {
    console.error("[abertura.orcamento_dados]", errOrcDados.message);
    return { ok: false, message: mapDbError(errOrcDados.message) };
  }

  // 5b. Reenvio do job devolvido (decisão 057): atualiza o que o
  //     formulário decide e devolve o job à fila. Valor, cópia da
  //     planilha, saves, BVs, PPs e realizado ficam como estão — a versão
  //     aprovada não mudou (errata só existe depois da abertura), e o que
  //     a produção já registrou na pré-abertura é dela.
  if (jobDevolvido) {
    // Contatos de cobrança PRIMEIRO: o formulário é a fonte inteira —
    // apaga os do envio anterior e grava o que está na tela. Se isso
    // falhar, o job continua devolvido e o usuário refaz; a ordem inversa
    // deixaria um job na fila sem contato (foi o que aconteceu no
    // primeiro teste, quando `jobs_contatos` ainda não aceitava DELETE).
    const { error: errApagaContatos } = await supabase
      .from("jobs_contatos")
      .delete()
      .eq("job_id", jobDevolvido.id)
      .eq("tenant_id", session.activeTenant.id)
      .eq("tipo", "cobranca");

    if (errApagaContatos) {
      console.error("[abertura.reenvio_contatos_delete]", errApagaContatos.message);
      return {
        ok: false,
        message: "Não foi possível atualizar os contatos de cobrança. Avise o suporte.",
      };
    }

    const { error: errNovosContatos } = await supabase.from("jobs_contatos").insert(
      parsed.data.contatos_cobranca.map((c, i) => ({
        tenant_id: session.activeTenant.id,
        job_id: jobDevolvido.id,
        tipo: "cobranca",
        nome: c.nome,
        numero: c.numero,
        email: c.email,
        ordem: i + 1,
        created_by: session.profile.id,
      })),
    );

    if (errNovosContatos) {
      console.error("[abertura.reenvio_contatos_insert]", errNovosContatos.message);
      return {
        ok: false,
        message: "Não foi possível gravar os contatos de cobrança. Avise o suporte.",
      };
    }

    const { error: errReenvio } = await supabase
      .from("jobs")
      .update({
        nome: parsed.data.nome,
        produto: produtoRes.data.nome,
        regional_id: parsed.data.regional_id,
        cidade: cidadeRes.data.nome,
        data_inicio_prevista: parsed.data.data_inicio_prevista,
        data_fim_prevista: parsed.data.data_fim_prevista,
        data_evento: parsed.data.data_evento,
        data_prevista_faturamento: parsed.data.data_prevista_faturamento,
        observacoes: parsed.data.observacoes,
        responsavel_id: orc.gp_responsavel_id,
        produtor_id: orc.produtor_id,
        status: "aguardando_abertura",
        motivo_rejeicao: null,
      })
      .eq("id", jobDevolvido.id)
      .eq("tenant_id", session.activeTenant.id)
      .eq("status", "rejeitado_financeiro");

    if (errReenvio) {
      console.error("[abertura.reenvio]", errReenvio.message);
      return { ok: false, message: mapDbError(errReenvio.message) };
    }

    await logAuditEvent({
      acao: "job.reenviado_para_aprovacao",
      tenantId: session.activeTenant.id,
      entidadeTipo: "job",
      entidadeId: jobDevolvido.id,
      metadata: {
        codigo: jobDevolvido.codigo,
        orcamento_id: orc.id,
        versao_id: versaoId,
        cidade_id: parsed.data.cidade_id,
        regional_id: parsed.data.regional_id,
        data_evento: parsed.data.data_evento,
        data_prevista_faturamento: parsed.data.data_prevista_faturamento,
        qtd_contatos_cobranca: parsed.data.contatos_cobranca.length,
      },
    });

    revalidatePath(`/orcamentos/${orc.projeto_id}/${orc.id}/versoes/${versaoId}`);
    revalidatePath(`/orcamentos/${orc.projeto_id}/${orc.id}`);
    revalidatePath(`/orcamentos/${orc.projeto_id}`);
    revalidatePath(`/jobs/${jobDevolvido.id}`);
    revalidatePath("/jobs");
    revalidatePath("/financeiro");
    revalidatePath("/financeiro/abertura-de-job");

    return { ok: true, jobId: jobDevolvido.id, codigo: jobDevolvido.codigo };
  }

  // 6. Cria o job. `cidade` é texto no schema de jobs — gravamos o nome
  //    escolhido no cadastro, que já vem no formato "Salvador-BA".
  const { data: novo, error: errIns } = await supabase
    .from("jobs")
    .insert({
      tenant_id: session.activeTenant.id,
      codigo,
      projeto_id: orc.projeto_id,
      orcamento_id: orc.id,
      versao_orcamento_aprovada_id: versaoId,
      nome: parsed.data.nome,
      produto: produtoRes.data.nome,
      regional_id: parsed.data.regional_id,
      cidade: cidadeRes.data.nome,
      data_inicio_prevista: parsed.data.data_inicio_prevista,
      data_fim_prevista: parsed.data.data_fim_prevista,
      // Só no job: `orcamentos` não tem data de evento (27/08/2026).
      data_evento: parsed.data.data_evento,
      data_prevista_faturamento: parsed.data.data_prevista_faturamento,
      // Na tela chama "Descritivo do Job" desde 17/08/2026; a coluna
      // segue `observacoes`. O financeiro lê no diálogo de conferência da
      // fila de abertura e no detalhe do job.
      observacoes: parsed.data.observacoes,
      // Os dois responsáveis vêm do orçamento desde 06/08/2026 — antes o
      // job herdava `projetos.responsavel_id`.
      responsavel_id: orc.gp_responsavel_id,
      produtor_id: orc.produtor_id,
      valor_total: Number(totais.valorJob.toFixed(2)),
      // A coluna VIVA do faturamento previsto — sem ela o job nasceria
      // nulo e a listagem do financeiro leria "—" até a primeira errata.
      faturamento_previsto: Number(totais.faturamentoPrevisto.toFixed(2)),
      // Quanto desse faturamento é saldo em save. Anda colado ao de cima:
      // é a `vw_fluxo_caixa` que precisa dele para dividir a previsão de
      // recebimento entre job e save (decisão 028).
      faturamento_save_previsto: Number(totais.save.receita.toFixed(2)),
      // Congelado aqui e nunca mais alterado: é a base de comparação do
      // card de Erratas ("faturamento na abertura" x "atual").
      valor_job_abertura: Number(totais.valorJob.toFixed(2)),
      faturamento_previsto_abertura: Number(
        totais.faturamentoPrevisto.toFixed(2),
      ),
      // status default do banco = 'aguardando_abertura' — não sobrescreva
      created_by: session.profile.id,
    })
    .select("id")
    .single();

  if (errIns) {
    console.error("[abertura.job_insert]", errIns.message);
    return { ok: false, message: mapDbError(errIns.message) };
  }

  // 6b. Cópia do orçado que pertence ao job. A partir daqui a Planilha
  //     Interna lê daqui, e é isso que a errata altera — a versão
  //     aprovada continua sendo o registro do que o cliente aprovou.
  const { data: itensDaVersao, error: errItensCopia } = await supabase
    .from("versoes_orcamento_itens")
    .select(
      "id, grupo_id, ordem, item, tipo_custo, categoria_id, valor_unitario_orcado, quantidade_orcada, dias_meses_orcado, valor_unitario_planejado, quantidade_planejada, dias_meses_planejado, bv_liquido_planejado, em_save, save_consumido",
    )
    .eq("versao_orcamento_id", versaoId)
    .eq("tenant_id", session.activeTenant.id);

  if (errItensCopia) {
    console.error("[abertura.copia_itens_select]", errItensCopia.message);
    return {
      ok: false,
      message: "Job criado, mas a planilha interna não foi montada. Avise o suporte.",
    };
  }

  if ((itensDaVersao ?? []).length > 0) {
    const { data: copiaCriada, error: errCopia } = await supabase.from("jobs_itens_orcado").insert(
      (itensDaVersao ?? []).map((i: any) => ({
        tenant_id: session.activeTenant.id,
        job_id: novo.id,
        item_versao_id: i.id,
        grupo_id: i.grupo_id,
        ordem: i.ordem,
        item: i.item,
        tipo_custo: i.tipo_custo,
        categoria_id: i.categoria_id,
        valor_unitario_orcado: i.valor_unitario_orcado,
        quantidade_orcada: i.quantidade_orcada,
        dias_meses_orcado: i.dias_meses_orcado,
        valor_unitario_planejado: i.valor_unitario_planejado,
        quantidade_planejada: i.quantidade_planejada,
        dias_meses_planejado: i.dias_meses_planejado,
        // O BV que o planejado deduz vem CONGELADO da aprovação. Editar o
        // BV depois, na planilha do job, não mexe aqui — o compromisso do
        // planejado fecha neste ponto (docs/decisions/022).
        bv_liquido_planejado: i.bv_liquido_planejado,
        // A marca de save atravessa junto. Sem ela a cópia do job nasceria
        // "normal": o crédito não existiria, o planejado do tipo `A`
        // voltaria a espelhar o orçado pelo trigger, e a Planilha Interna
        // discordaria da versão aprovada logo na abertura (decisão 028).
        em_save: i.em_save === true,
        save_consumido: Number(i.save_consumido ?? 0),
      })),
    ).select("id, item_versao_id");

    if (errCopia) {
      console.error("[abertura.copia_itens_insert]", errCopia.message);
      return {
        ok: false,
        message: "Job criado, mas a planilha interna não foi montada. Avise o suporte.",
      };
    }

    // 6b-bis. O consumo de save MUDA DE PONTA: sai da linha da versão e
    //         passa a apontar para a cópia do job.
    //
    // `saves_consumos` nasce na versão (`item_versao_id`) enquanto o
    // orçamento é rascunho, e ali ele é RESERVA: aparece na planilha e não
    // move dinheiro no fluxo de ninguém. É aqui que ele vira consumo de um
    // job de verdade — e é `job_item_orcado_id` que a `vw_fluxo_caixa` usa
    // para migrar o dinheiro em save para quem o gastou, na data em que ele
    // entrou (decisão 028, nota de 26/08/2026).
    //
    // As duas pontas nunca convivem (`chk_save_consumo_uma_ponta`), e é de
    // propósito: a errata do job apaga e recria os consumos por
    // `job_item_orcado_id`, e uma linha órfã do lado da versão seria
    // contada duas vezes no saldo do job de origem. O `save_consumido` da
    // versão aprovada não some junto — o trigger congela nela desde
    // 27/08/2026.
    const copiaPorItemVersao = new Map<string, string>(
      ((copiaCriada ?? []) as any[]).map((c) => [c.item_versao_id, c.id]),
    );
    const idsDaVersao = (itensDaVersao ?? []).map((i: any) => i.id);
    if (idsDaVersao.length > 0 && copiaPorItemVersao.size > 0) {
      const { data: consumos, error: errConsumosLer } = await supabase
        .from("saves_consumos")
        .select("id, item_versao_id")
        .eq("tenant_id", session.activeTenant.id)
        .in("item_versao_id", idsDaVersao)
        .is("job_item_orcado_id", null);

      if (errConsumosLer) {
        console.error("[abertura.saves_consumos_select]", errConsumosLer.message);
      }

      for (const c of (consumos ?? []) as any[]) {
        const copiaId = copiaPorItemVersao.get(c.item_versao_id);
        if (!copiaId) continue;
        const { error: errConsumo } = await supabase
          .from("saves_consumos")
          .update({ job_item_orcado_id: copiaId, item_versao_id: null })
          .eq("id", c.id)
          .eq("tenant_id", session.activeTenant.id);
        if (errConsumo) {
          console.error("[abertura.saves_consumos_update]", errConsumo.message);
          return {
            ok: false,
            message:
              "Job criado, mas o consumo de save não foi transferido para a planilha do job. Avise o suporte.",
          };
        }
      }
    }

    // 6c. Âncora do realizado, uma linha por item, zerada.
    //
    // A PP referencia `jobs_itens_realizado.id`. Até 21/08/2026 a linha
    // nascia no primeiro lançamento manual do realizado; sem lançamento
    // manual ela precisa existir desde já, senão a calha não teria em que
    // pendurar o "Gerar PP" e o item ficaria sem como pedir nada.
    //
    // Zerada de propósito: o realizado começa em zero e sobe a cada PP.
    // Item `A` e `D` também ganha a linha — ela não é usada (eles leem o
    // orçado), mas uma exceção aqui só criaria um caso a mais para quem
    // for ler isto depois.
    //
    // Desde 27/08/2026 a âncora nasce apontando para a CÓPIA
    // (`job_item_orcado_id`), que é a chave que a planilha do job usa —
    // `item_id` continua preenchido como rede. A linha criada por errata
    // só tem a chave nova, e é por isso que ela virou a principal.
    const { error: errAncora } = await supabase
      .from("jobs_itens_realizado")
      .upsert(
        (itensDaVersao ?? [])
          .map((i: any) => ({
            tenant_id: session.activeTenant.id,
            job_id: novo.id,
            item_id: i.id,
            job_item_orcado_id: copiaPorItemVersao.get(i.id) ?? null,
            valor_unitario_realizado: 0,
            quantidade_realizada: 0,
            dias_meses_realizado: 0,
            created_by: session.profile.id,
          }))
          .filter((a: any) => a.job_item_orcado_id !== null),
        { onConflict: "job_id,item_id", ignoreDuplicates: true },
      );

    if (errAncora) {
      console.error("[abertura.ancora_realizado]", errAncora.message);
      return {
        ok: false,
        message:
          "Job criado, mas a planilha interna não foi montada. Avise o suporte.",
      };
    }

    // 6d. O BV lançado ainda no orçamento aponta para a linha da VERSÃO.
    //     A planilha do job lê BV pela cópia desde 27/08/2026 — sem esta
    //     ligação o BV existiria no banco e sumiria da tela do job.
    //
    //     Não é falha fatal: o BV continua íntegro do lado do orçamento e
    //     a próxima gravação dele reencontra a cópia. Loga e segue, para
    //     não derrubar uma abertura que já criou o job.
    //
    //     Uma leitura primeiro, e só então os updates: o normal é a versão
    //     ter dezenas de itens e nenhum ou dois BVs. Sem este filtro
    //     seriam dezenas de updates a cada abertura, para nada
    //     (docs/PERFORMANCE.md, anti-padrão I).
    const { data: bvsDaVersao } = await supabase
      .from("itens_bv")
      .select("id, item_versao_id")
      .eq("tenant_id", session.activeTenant.id)
      .in("item_versao_id", idsDaVersao)
      .is("job_item_orcado_id", null);

    for (const bv of (bvsDaVersao ?? []) as any[]) {
      const copiaId = copiaPorItemVersao.get(bv.item_versao_id);
      if (!copiaId) continue;

      const { error: errBvCopia } = await supabase
        .from("itens_bv")
        .update({ job_item_orcado_id: copiaId })
        .eq("id", bv.id)
        .eq("tenant_id", session.activeTenant.id);

      if (errBvCopia) {
        console.error("[abertura.bv_copia]", bv.id, errBvCopia.message);
      }
    }
  }

  // 6c. Contatos de cobrança — quem o financeiro procura para cobrar. O
  //     schema garante ao menos um, então o insert nunca vem vazio; em
  //     bulk, não um por vez (docs/PERFORMANCE.md, anti-padrão I).
  const { error: errContatos } = await supabase.from("jobs_contatos").insert(
    parsed.data.contatos_cobranca.map((c, i) => ({
      tenant_id: session.activeTenant.id,
      job_id: novo.id,
      tipo: "cobranca",
      nome: c.nome,
      numero: c.numero,
      email: c.email,
      // Posição no formulário: o primeiro é o contato principal na prática.
      ordem: i + 1,
      created_by: session.profile.id,
    })),
  );

  if (errContatos) {
    console.error("[abertura.contatos_insert]", errContatos.message);
    return {
      ok: false,
      message:
        "Job criado, mas os contatos não foram gravados. Avise o suporte.",
    };
  }

  // 7. Orçamento passa a 'job_criado'.
  const { error: errOrcStatus } = await supabase
    .from("orcamentos")
    .update({ status: "job_criado" })
    .eq("id", orc.id)
    .eq("tenant_id", session.activeTenant.id);

  if (errOrcStatus) {
    console.error("[abertura.orcamento_status]", errOrcStatus.message);
    return {
      ok: false,
      message:
        "Job criado, mas o status do orçamento não atualizou. Verifique manualmente.",
    };
  }

  await logAuditEvent({
    acao: "job.enviado_para_abertura",
    tenantId: session.activeTenant.id,
    entidadeTipo: "job",
    entidadeId: novo.id,
    metadata: {
      codigo,
      orcamento_id: orc.id,
      versao_id: versaoId,
      // Editáveis no modal desde 12/08/2026 — registrar o que foi escolhido.
      cidade_id: parsed.data.cidade_id,
      regional_id: parsed.data.regional_id,
      valor_total: Number(totais.valorJob.toFixed(2)),
      faturamento_previsto: Number(totais.faturamentoPrevisto.toFixed(2)),
      data_evento: parsed.data.data_evento,
      data_prevista_faturamento: parsed.data.data_prevista_faturamento,
      // Quantos contatos de cobrança foram gravados (obrigatório ≥ 1
      // desde 17/08/2026). Sem e-mail nem nome no audit: dado pessoal do
      // cliente não precisa ser duplicado no log.
      qtd_contatos_cobranca: parsed.data.contatos_cobranca.length,
    },
  });

  revalidatePath(`/orcamentos/${orc.projeto_id}/${orc.id}/versoes/${versaoId}`);
  revalidatePath(`/orcamentos/${orc.projeto_id}/${orc.id}`);
  revalidatePath(`/orcamentos/${orc.projeto_id}`);
  revalidatePath("/jobs");
  revalidatePath("/financeiro/abertura-de-job");

  return { ok: true, jobId: novo.id, codigo };
}

export type CancelarEnvioResult =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Cancela o envio à abertura, enquanto o financeiro ainda não abriu o job
 * (decisão 057). É o inverso exato de `enviarJobParaAbertura`:
 *
 * - o job vai a `cancelado` — a linha fica, com auditoria, e o código
 *   JOB-NNNN fica queimado como em qualquer job cancelado;
 * - o consumo de save e os BVs voltam a apontar para a VERSÃO, de onde o
 *   envio os tinha movido para a cópia do job;
 * - o orçamento volta a `aprovado`, e a barra volta a oferecer o envio.
 *
 * Vale nos dois status de pré-abertura. O job devolvido pelo financeiro
 * também precisa de uma saída além do reenvio — e o "Cancelar job" da
 * página do job saiu de cena junto com esta action.
 *
 * Bloqueia, sem cascata, se a produção já registrou coisa no job: PP fora
 * de `cancelada` (a gerada é contratação fechada com fornecedor) ou
 * realizado lançado à mão. Quem desfaz isso é o próprio usuário, na aba
 * de PPs e na planilha, uma por uma — cancelar o envio nunca apaga PP.
 */
export async function cancelarEnvioParaAbertura(
  jobId: string,
): Promise<CancelarEnvioResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "jobs.editar_metadata");
  if (!gate.ok) return { ok: false, message: gate.message };

  const supabase = createClient();

  const { data: job } = await supabase
    .from("jobs")
    .select("id, codigo, status, projeto_id, orcamento_id, versao_orcamento_aprovada_id")
    .eq("id", jobId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{
      id: string;
      codigo: string;
      status: string;
      projeto_id: string;
      orcamento_id: string;
      versao_orcamento_aprovada_id: string;
    }>();

  if (!job) return { ok: false, message: "Job não encontrado." };
  if (
    job.status !== "aguardando_abertura" &&
    job.status !== "rejeitado_financeiro"
  ) {
    return {
      ok: false,
      message:
        "O financeiro já abriu este job. O cancelamento depois da abertura é ação do financeiro.",
    };
  }

  // 1. O que a produção já registrou no job barra o cancelamento.
  //
  //    A conta é só de PP, e é suficiente: o realizado NÃO é digitado
  //    desde 21/08/2026 (`jobs/[jobId]/actions-realizado.ts` guarda o
  //    aviso) — ele é derivado das PPs pelo trigger
  //    `recalcular_realizado_do_item`, que soma as não canceladas. Somar
  //    o realizado aqui seria contar a mesma PP duas vezes e, pior,
  //    mandar o usuário "zerar o realizado" numa tela onde ele não é
  //    editável. Em job de pré-abertura o realizado é sempre zero: a PP
  //    só pode estar `gerada`, e o trigger ignora essa.
  const [ppsRes, copiasRes] = await Promise.all([
    supabase
      .from("pedidos_compra")
      .select("id", { count: "exact", head: true })
      .eq("job_id", job.id)
      .eq("tenant_id", session.activeTenant.id)
      .neq("status", "cancelada"),
    supabase
      .from("jobs_itens_orcado")
      .select("id, item_versao_id")
      .eq("job_id", job.id)
      .eq("tenant_id", session.activeTenant.id),
  ]);

  const qtdPps = ppsRes.count ?? 0;
  if (qtdPps > 0) {
    return {
      ok: false,
      message:
        qtdPps === 1
          ? "Antes de cancelar o envio, cancele a PP gerada na aba de Pedidos de Produção do job."
          : `Antes de cancelar o envio, cancele as ${qtdPps} PPs geradas na aba de Pedidos de Produção do job.`,
    };
  }

  if (copiasRes.error) {
    console.error("[cancelar_envio.copias]", copiasRes.error.message);
    return { ok: false, message: "Não foi possível ler a planilha do job." };
  }

  const copias = (copiasRes.data ?? []) as { id: string; item_versao_id: string | null }[];
  const idsCopias = copias.map((c) => c.id);
  let savesDevolvidos = 0;

  // 2. O consumo de save volta para a linha da versão. As duas pontas
  //    nunca convivem (`chk_save_consumo_uma_ponta`), então o update troca
  //    uma pela outra numa tacada. Poucas linhas: o normal é nenhuma.
  if (idsCopias.length > 0) {
    const { data: consumos, error: errConsumosLer } = await supabase
      .from("saves_consumos")
      .select("id, job_item_orcado_id")
      .eq("tenant_id", session.activeTenant.id)
      .in("job_item_orcado_id", idsCopias);

    if (errConsumosLer) {
      console.error("[cancelar_envio.saves_select]", errConsumosLer.message);
      return { ok: false, message: "Não foi possível ler o consumo de save do job." };
    }

    const versaoPorCopia = new Map(copias.map((c) => [c.id, c.item_versao_id]));
    savesDevolvidos = (consumos ?? []).length;
    for (const c of (consumos ?? []) as { id: string; job_item_orcado_id: string }[]) {
      const itemVersaoId = versaoPorCopia.get(c.job_item_orcado_id) ?? null;
      if (!itemVersaoId) {
        console.error("[cancelar_envio.saves_sem_versao]", c.id);
        return {
          ok: false,
          message:
            "Um consumo de save do job não tem linha correspondente na versão. Avise o suporte.",
        };
      }
      const { error: errConsumo } = await supabase
        .from("saves_consumos")
        .update({ item_versao_id: itemVersaoId, job_item_orcado_id: null })
        .eq("id", c.id)
        .eq("tenant_id", session.activeTenant.id);
      if (errConsumo) {
        console.error("[cancelar_envio.saves_update]", errConsumo.message);
        return {
          ok: false,
          message: "Não foi possível devolver o consumo de save à versão. Avise o suporte.",
        };
      }
    }

    // 3. Os BVs continuam com `item_versao_id` — o envio só acrescentou a
    //    ponta da cópia. Basta soltá-la.
    const { error: errBv } = await supabase
      .from("itens_bv")
      .update({ job_item_orcado_id: null })
      .eq("tenant_id", session.activeTenant.id)
      .in("job_item_orcado_id", idsCopias)
      .not("item_versao_id", "is", null);

    if (errBv) {
      console.error("[cancelar_envio.bv]", errBv.message);
      return { ok: false, message: "Não foi possível devolver os BVs à versão. Avise o suporte." };
    }
  }

  // 4. Job cancelado. O motivo da rejeição, se houver, fica — é histórico.
  const { error: errJob } = await supabase
    .from("jobs")
    .update({ status: "cancelado" })
    .eq("id", job.id)
    .eq("tenant_id", session.activeTenant.id)
    .in("status", ["aguardando_abertura", "rejeitado_financeiro"]);

  if (errJob) {
    console.error("[cancelar_envio.job]", errJob.message);
    return { ok: false, message: "Não foi possível cancelar o envio." };
  }

  // 5. Orçamento volta a `aprovado`. Só de `job_criado`: se alguém já
  //    mexeu no status por outro caminho, não sobrescreve.
  const { error: errOrc } = await supabase
    .from("orcamentos")
    .update({ status: "aprovado" })
    .eq("id", job.orcamento_id)
    .eq("tenant_id", session.activeTenant.id)
    .eq("status", "job_criado");

  if (errOrc) {
    console.error("[cancelar_envio.orcamento]", errOrc.message);
    return {
      ok: false,
      message:
        "Envio cancelado, mas o orçamento não voltou a aprovado. Verifique manualmente.",
    };
  }

  await logAuditEvent({
    acao: "job.envio_abertura_cancelado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "job",
    entidadeId: job.id,
    metadata: {
      codigo: job.codigo,
      status_anterior: job.status,
      orcamento_id: job.orcamento_id,
      versao_id: job.versao_orcamento_aprovada_id,
      qtd_saves_devolvidos: savesDevolvidos,
    },
  });

  revalidatePath(
    `/orcamentos/${job.projeto_id}/${job.orcamento_id}/versoes/${job.versao_orcamento_aprovada_id}`,
  );
  revalidatePath(`/orcamentos/${job.projeto_id}/${job.orcamento_id}`);
  revalidatePath(`/orcamentos/${job.projeto_id}`);
  revalidatePath(`/jobs/${job.id}`);
  revalidatePath("/jobs");
  revalidatePath("/financeiro");
  revalidatePath("/financeiro/abertura-de-job");

  return { ok: true };
}
