"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { checarPermissao } from "@/lib/permissoes-server";
import {
  clientePortalSchema,
  envioFaturamentoSchema,
  type ClientePortalInput,
  type EnvioFaturamentoInput,
} from "@/lib/validations/envio-faturamento";
import {
  jobAceitaEnvioParaFaturamento,
  jobStatusLabel,
  type JobStatus,
} from "@/lib/types";
import { lerFaturamentoPorMesDoJob } from "@/lib/data/faturamento-mensal";
import { nomeDoMes } from "@/lib/calculos/meses-trimestre";

/** "outubro" → "Outubro", para abrir frase. */
function comMaiuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

export type ActionResult =
  | { ok: true; id: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

/** O portal como o drawer de envio o lista: id, nome e link. */
export interface PortalCriado {
  id: string;
  nome: string;
  url: string;
}

export type PortalResult =
  | { ok: true; portal: PortalCriado }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

/**
 * Cadastra um portal de fornecedor do cliente DE DENTRO do envio para
 * faturamento (decisão 050, 04/09/2026).
 *
 * O cliente não vem do formulário: é o do job, relido aqui. Quem está
 * enviando o job não precisa (nem deve) dizer para qual cliente o portal
 * vai — é sempre o cliente daquele job. Devolve o registro para o drawer
 * selecioná-lo na hora, sem esperar o refresh da página.
 *
 * O gate é `cadastros.clientes.portal_inline`, que espelha
 * `jobs.enviar_faturamento`: o cadastro do cliente inteiro continua sendo
 * do administrador; o que abre aqui é só o portal, e só para quem envia.
 */
export async function cadastrarPortalDoClienteDoJob(
  jobId: string,
  input: ClientePortalInput,
): Promise<PortalResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "cadastros.clientes.portal_inline");
  if (!gate.ok) return gate;

  const parsed = clientePortalSchema.safeParse(input);
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
    .select("id, projeto:projetos(cliente_id)")
    .eq("id", jobId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ id: string; projeto: { cliente_id: string } | null }>();

  if (!job) return { ok: false, message: "Job não encontrado." };

  const clienteId = job.projeto?.cliente_id ?? null;
  if (!clienteId) {
    return {
      ok: false,
      message: "Este job não tem cliente vinculado — não há onde cadastrar o portal.",
    };
  }

  const { data: novo, error } = await supabase
    .from("cliente_portais")
    .insert({
      tenant_id: session.activeTenant.id,
      cliente_id: clienteId,
      nome: parsed.data.nome,
      url: parsed.data.url,
      created_by: session.profile.id,
    })
    .select("id, nome, url")
    .single<PortalCriado>();

  if (error || !novo) {
    console.error("[cliente_portais.criar.envio]", error?.message);
    // O nome é único por cliente (`uniq_cliente_portal_nome`). O drawer só
    // lista os ativos, então a colisão que a pessoa não vê é com um portal
    // inativo — e o caminho para esse é reativar, não recriar.
    if (error?.message.includes("uniq_cliente_portal_nome")) {
      return {
        ok: false,
        message:
          "Já existe um portal com esse nome para este cliente. Se ele " +
          "estiver inativo, reative em Cadastros › Clientes.",
        fieldErrors: { nome: ["Nome já usado neste cliente."] },
      };
    }
    return { ok: false, message: "Não foi possível cadastrar o portal." };
  }

  await logAuditEvent({
    acao: "cliente_portal.criado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "cliente",
    entidadeId: clienteId,
    metadata: { nome: parsed.data.nome, origem: "envio_faturamento", job_id: jobId },
  });

  // A página do cliente lista os portais; a do job NÃO entra aqui de
  // propósito — o drawer segura o portal novo na lista dele até fechar, e
  // o refresh no meio do preenchimento é o que zerava formulário (048).
  revalidatePath(`/clientes/${clienteId}`);

  return { ok: true, portal: novo };
}

function formatarBRL(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * A produção libera o job para o financeiro faturar.
 *
 * A partir daqui o job entra na fila de faturamento
 * (`vw_faturamento_pendente`), levando junto o que só a produção sabe:
 * número da PO, como a nota deve ser descrita, portal do cliente e o
 * vencimento acordado. O CNAE saiu daqui em 31/08/2026 — é do financeiro,
 * que o informa na emissão da nota.
 *
 * O valor NÃO vem do formulário — é relido de `jobs.faturamento_previsto`
 * aqui dentro. É valor de nota fiscal; o navegador não é fonte confiável
 * para ele. O que o formulário mostra é uma leitura travada do mesmo
 * número.
 *
 * Desde a Tela 3.3 o envio também diz EM QUANTAS NOTAS o job será
 * faturado (`jobs_envio_faturamento_parcelas`). Cada parcela vira uma
 * linha da aba Faturamento, com o seu próprio vencimento. A soma é
 * conferida contra o valor relido: quem diz o total é o banco, o
 * formulário só diz como reparti-lo.
 */
export async function enviarJobParaFaturamento(
  jobId: string,
  input: EnvioFaturamentoInput,
): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "jobs.enviar_faturamento");
  if (!gate.ok) return gate;

  const parsed = envioFaturamentoSchema.safeParse(input);
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
      "id, status, faturamento_previsto, abertura_em_revisao, projeto_id, orcamento_id, versao_orcamento_aprovada_id, projeto:projetos(cliente_id), orcamento:orcamentos(categoria:categorias_dominio!categoria_id(modelo_planilha)), versao:versoes_orcamento!versao_orcamento_aprovada_id(percentual_honorarios, percentual_imposto)",
    )
    .eq("id", jobId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{
      id: string;
      status: JobStatus;
      faturamento_previsto: number | string | null;
      abertura_em_revisao: boolean | null;
      projeto_id: string;
      orcamento_id: string;
      projeto: { cliente_id: string } | null;
      versao_orcamento_aprovada_id: string;
      orcamento: { categoria: { modelo_planilha: string } | null } | null;
      versao: {
        percentual_honorarios: number | string;
        percentual_imposto: number | string;
      } | null;
    }>();

  if (!job) return { ok: false, message: "Job não encontrado." };

  // Modelo mensal (decisão 078): Fee e Always On são enviados para
  // faturamento MÊS A MÊS — cada envio leva o mês. Os outros jobs seguem
  // com o envio único, sem mês. O envio único num job mensal congelaria o
  // trimestre inteiro.
  const mensal = job.orcamento?.categoria?.modelo_planilha === "mensal";
  const mes = parsed.data.mes ?? null;
  if (mensal && !mes) {
    return {
      ok: false,
      message:
        "Jobs de Fee e Always On são enviados para faturamento mês a mês: escolha o mês a enviar.",
    };
  }
  if (!mensal && mes) {
    return {
      ok: false,
      message: "Só jobs de Fee e Always On são enviados para faturamento por mês.",
    };
  }
  const nomeMes = mes ? nomeDoMes(mes) : null;

  // Desde 16/09/2026 (decisão 087) o job encerrado ainda não faturado
  // continua enviando: faturamento e encerramento correm separados.
  if (!jobAceitaEnvioParaFaturamento(job.status)) {
    return {
      ok: false,
      message:
        "Só job aberto ou encerrado pode ser enviado para faturamento. Este está " +
        `${jobStatusLabel(job.status).toLowerCase()}.`,
    };
  }

  // Errata depois da abertura reabre a conferência do financeiro. Enviar
  // agora emitiria a nota sobre uma previsão de recebimento e uma curva de
  // desembolso montadas com números que a errata já mudou. A barra esconde
  // o botão; a regra mora aqui (27/08/2026).
  if (job.abertura_em_revisao === true) {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo: "job",
      entidadeId: jobId,
      metadata: {
        acao_tentada: "job.enviado_faturamento",
        motivo: "abertura_em_revisao",
      },
    });
    return {
      ok: false,
      message:
        "Uma errata mexeu no orçado depois da abertura e o financeiro ainda " +
        "não reconferiu o job. O envio para faturamento volta quando a " +
        "revisão de recebimento e custos for salva na Abertura de Job.",
    };
  }

  // O valor a faturar é relido aqui, nunca o do navegador: o faturamento
  // previsto do job no envio único, ou o faturamento DO MÊS recalculado dos
  // itens da cópia do job (com as erratas) no modelo mensal.
  let valor: number;
  let valorSave: number | null = null;
  if (mes) {
    const porMes = await lerFaturamentoPorMesDoJob(supabase, {
      tenantId: session.activeTenant.id,
      jobId,
      versaoAprovadaId: job.versao_orcamento_aprovada_id,
      percentualHonorarios: Number(job.versao?.percentual_honorarios ?? 0),
      percentualImposto: Number(job.versao?.percentual_imposto ?? 0),
    });
    if (!porMes) {
      return {
        ok: false,
        message: "Não foi possível calcular o faturamento do mês. Tente de novo.",
      };
    }
    const doMes = porMes.find((m) => m.mes === mes);
    if (!doMes) {
      return {
        ok: false,
        message: "Este mês não faz parte do orçamento aprovado do job.",
      };
    }
    valor = doMes.faturamento;
    valorSave = doMes.save;
  } else {
    valor = Number(job.faturamento_previsto ?? 0);
  }
  if (!(valor > 0)) {
    return {
      ok: false,
      message: nomeMes
        ? `${comMaiuscula(nomeMes)} está sem faturamento — não há valor a faturar.`
        : "Este job está sem faturamento previsto — não há valor a faturar.",
    };
  }

  // A soma das parcelas fecha contra o valor RELIDO, não contra o que o
  // navegador mandou. Tolerância de 1 centavo pelo arredondamento da
  // divisão em partes iguais.
  const somaParcelas = parsed.data.parcelas.reduce((s, p) => s + p.valor, 0);
  if (Math.abs(somaParcelas - valor) > 0.01) {
    return {
      ok: false,
      message:
        `A soma das parcelas (${formatarBRL(somaParcelas)}) não fecha com o ` +
        `valor a faturar (${formatarBRL(valor)}).`,
    };
  }

  // Um envio por job — ou por job + mês no modelo mensal (índices únicos
  // parciais). Conferir antes devolve mensagem legível em vez de erro de
  // constraint.
  const consultaEnvio = supabase
    .from("jobs_envio_faturamento")
    .select("id")
    .eq("job_id", jobId);
  const { data: jaEnviado } = await (mes
    ? consultaEnvio.eq("mes", mes)
    : consultaEnvio.is("mes", null)
  ).maybeSingle<{ id: string }>();

  const mensagemJaEnviado = nomeMes
    ? `${comMaiuscula(nomeMes)} deste job já foi enviado para faturamento.`
    : "Este job já foi enviado para faturamento.";
  if (jaEnviado) {
    return { ok: false, message: mensagemJaEnviado };
  }

  // O portal precisa ser do cliente DESTE job — a lista do formulário não
  // é garantia. Guardamos também a URL, porque o cadastro pode mudar
  // depois e o registro do envio precisa continuar dizendo para onde a
  // nota devia ir.
  let portalUrl: string | null = null;
  if (parsed.data.portal_id) {
    const { data: portal } = await supabase
      .from("cliente_portais")
      .select("id, url, cliente_id, ativo")
      .eq("id", parsed.data.portal_id)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle<{
        id: string;
        url: string;
        cliente_id: string;
        ativo: boolean;
      }>();

    if (!portal || portal.cliente_id !== job.projeto?.cliente_id) {
      return { ok: false, message: "Portal inválido para este cliente." };
    }
    portalUrl = portal.url;
  }

  // Envio e parcelas numa transação só (decisão 075, 14/09/2026). Eram dois
  // INSERTs do PostgREST — duas transações —, e o "desfazer" do primeiro
  // era um DELETE que o banco recusa: `jobs_envio_faturamento` não tem
  // DELETE para `authenticated`, porque envio é evento, não rascunho. Se
  // as parcelas falhassem, o envio ficava gravado sem parcela (invisível
  // na fila do financeiro, que lê as parcelas) e o `unique (job_id)`
  // impedia o GP de reenviar. A RPC é SECURITY INVOKER: RLS e GRANT
  // continuam valendo; ela só empacota os dois INSERTs.
  const { data: envioId, error } = await supabase.rpc(
    "enviar_job_para_faturamento",
    {
      payload: {
        tenant_id: session.activeTenant.id,
        job_id: jobId,
        valor_faturado: valor,
        numero_po: parsed.data.numero_po,
        data_faturamento: parsed.data.data_faturamento,
        descricao_nf: parsed.data.descricao_nf,
        portal_id: parsed.data.portal_id,
        portal_url: portalUrl,
        enviado_por: session.profile.id,
        mes,
        valor_save: valorSave,
        parcelas: parsed.data.parcelas.map((p) => ({
          ordem: p.ordem,
          valor: p.valor,
          data_vencimento: p.data_vencimento,
        })),
      },
    },
  );

  if (error || !envioId) {
    console.error("[job.enviarFaturamento]", error?.message);
    // Dois cliques quase juntos passam os dois pela conferência de "já
    // enviado" acima; o segundo esbarra no unique e merece a mesma frase.
    if (error?.message.includes("uniq_envio_faturamento_job")) {
      return { ok: false, message: mensagemJaEnviado };
    }
    return {
      ok: false,
      message:
        "Não foi possível enviar o job para faturamento. Nada foi gravado — " +
        "confira as parcelas e tente de novo.",
    };
  }

  await logAuditEvent({
    acao: "job.enviado_para_faturamento",
    tenantId: session.activeTenant.id,
    entidadeTipo: "job",
    entidadeId: jobId,
    metadata: {
      valor_faturado: valor,
      data_faturamento: parsed.data.data_faturamento,
      tem_descricao_nf: parsed.data.descricao_nf.length > 0,
      tem_po: parsed.data.numero_po !== null,
      tem_portal: parsed.data.portal_id !== null,
      qtd_parcelas: parsed.data.parcelas.length,
      mes,
      valor_save: valorSave,
    },
  });

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
  revalidatePath("/financeiro");
  revalidatePath("/financeiro/abertura-de-job");
  revalidatePath(`/financeiro/jobs/${jobId}`);
  revalidatePath("/financeiro/contas-a-receber");

  return { ok: true, id: envioId as string };
}
