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
import { contatosDeCobrancaDoJob } from "@/lib/data/contatos-cobranca";
import {
  comMaiuscula,
  conferirEnvioDoJob,
  mensagemJaEnviado,
} from "@/lib/faturamento/conferir-envio-do-job";
import { diaSeguinte, limitesDoMes, mesEmVeiculacao } from "@/lib/calculos/midia-off";
import { hojeEmSaoPauloIso } from "@/lib/calculos/janelas-pagamento";
import { lerUltimaVeiculacaoDoMes } from "@/lib/data/midia-do-job";
import { impedimentosDosJobs } from "@/lib/data/impedimentos-encerramento";
import { encerrarJob } from "./actions-encerramento";

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
    .select("id, cliente_id")
    .eq("id", jobId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ id: string; cliente_id: string }>();

  if (!job) return { ok: false, message: "Job não encontrado." };

  const clienteId = job.cliente_id ?? null;
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

/** "2026-12-31" → "31/12/2026". */
function dataBr(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

/**
 * As duas travas do envio de um mês da Mídia Off (decisão 167):
 *
 * 1. o mês só vai ao faturamento no dia seguinte à última veiculação dele
 *    — a maior data com inserção na grade, ou o fim do período, que pode
 *    cair no mês seguinte;
 * 2. o envio do ÚLTIMO mês que falta encerra o job junto, e por isso só
 *    passa sem pendência de encerramento — a mesma régua do botão
 *    "Enviar para encerramento".
 *
 * Devolve a recusa (texto da tela + motivo da auditoria) ou se o envio
 * encerra o job.
 */
async function conferirEnvioDoMesDaMidia(
  supabase: ReturnType<typeof createClient>,
  p: {
    tenantId: string;
    jobId: string;
    versaoAprovadaId: string;
    mes: string;
    nomeMes: string;
    mesesComFaturamento: string[];
  },
): Promise<{ recusa: string; motivo: string } | { encerra: boolean }> {
  const [ultima, enviosRes] = await Promise.all([
    lerUltimaVeiculacaoDoMes(supabase, p.tenantId, p.jobId, p.versaoAprovadaId, p.mes),
    supabase
      .from("jobs_envio_faturamento")
      .select("mes")
      .eq("job_id", p.jobId)
      .eq("tenant_id", p.tenantId)
      .returns<{ mes: string | null }[]>(),
  ]);
  if (ultima === undefined || enviosRes.error) {
    if (enviosRes.error) console.error("[job.enviarFaturamento.midia]", enviosRes.error.message);
    return {
      recusa: "Não foi possível conferir a veiculação do mês. Tente de novo.",
      motivo: "leitura_da_veiculacao",
    };
  }

  if (mesEmVeiculacao(p.mes, ultima, hojeEmSaoPauloIso())) {
    const fim = ultima ?? limitesDoMes(p.mes).fim;
    return {
      recusa: `A veiculação de ${p.nomeMes} vai até ${dataBr(fim)}: o envio para faturamento libera em ${dataBr(diaSeguinte(fim))}.`,
      motivo: "mes_em_veiculacao",
    };
  }

  const enviados = new Set(
    (enviosRes.data ?? []).map((e) => (e.mes ?? "").slice(0, 10)).filter(Boolean),
  );
  const encerra = p.mesesComFaturamento.every(
    (m) => m.slice(0, 10) === p.mes.slice(0, 10) || enviados.has(m.slice(0, 10)),
  );
  if (!encerra) return { encerra: false };

  const imp = (await impedimentosDosJobs(supabase, p.tenantId, [p.jobId])).get(p.jobId);
  if (!imp) {
    return {
      recusa: "Não foi possível conferir as pendências do job. Tente de novo.",
      motivo: "leitura_dos_impedimentos",
    };
  }
  const partes: string[] = [];
  const conta = (n: number, um: string, varios: string) => (n === 1 ? `1 ${um}` : `${n} ${varios}`);
  if (imp.ppsEmAberto.length > 0) {
    partes.push(
      `${conta(imp.ppsEmAberto.length, "PP em aberto", "PPs em aberto")} (${imp.ppsEmAberto.map((x) => x.codigo).join(", ")})`,
    );
  }
  if (imp.ppsAEmitir.length > 0) {
    partes.push(conta(imp.ppsAEmitir.length, "PP a emitir", "PPs a emitir"));
  }
  if (imp.verbasEmAberto.length > 0) {
    partes.push(conta(imp.verbasEmAberto.length, "verba não concluída", "verbas não concluídas"));
  }
  if (imp.bvsEmAberto.length > 0) {
    partes.push(conta(imp.bvsEmAberto.length, "BV não recebido", "BVs não recebidos"));
  }
  if (imp.itensSemMarcacao.length > 0) {
    partes.push(
      conta(
        imp.itensSemMarcacao.length,
        "linha A · Repasse sem a PP do repasse",
        "linhas A · Repasse sem a PP do repasse",
      ),
    );
  }
  if (imp.savesAguardando.length > 0) {
    partes.push(conta(imp.savesAguardando.length, "save aguardando aprovação", "saves aguardando aprovação"));
  }
  if (imp.consumosAguardando.length > 0) {
    partes.push(
      conta(imp.consumosAguardando.length, "consumo de save aguardando aprovação", "consumos de save aguardando aprovação"),
    );
  }
  if (imp.savesNaoEnviados.length > 0) {
    partes.push(conta(imp.savesNaoEnviados.length, "save ainda não enviado", "saves ainda não enviados"));
  }
  if (imp.revisaoDaAberturaPendente) partes.push("revisão da abertura pendente no financeiro");

  if (partes.length > 0) {
    return {
      recusa: `${comMaiuscula(p.nomeMes)} é o último mês: o envio encerra o job, que ainda tem pendência: ${partes.join("; ")}.`,
      motivo: "encerramento_com_pendencia",
    };
  }
  return { encerra: true };
}

/**
 * A produção libera o job para o financeiro faturar.
 *
 * A partir daqui o job entra na fila de faturamento
 * (`vw_faturamento_pendente`), levando junto o que só a produção sabe:
 * número da PO, como a nota deve ser descrita, portal do cliente e o
 * vencimento acordado. O CNAE saiu daqui em 31/08/2026 — é do financeiro,
 * que o informa na emissão da nota — e voltou como SUGESTÃO na decisão 123.
 *
 * O valor NÃO vem do formulário — é relido de `jobs.faturamento_previsto`
 * aqui dentro. É valor de nota fiscal; o navegador não é fonte confiável
 * para ele. O que o formulário mostra é uma leitura travada do mesmo
 * número.
 *
 * Desde a decisão 123 (29/09/2026) o envio se divide em NOTAS FISCAIS,
 * cada uma com o próprio CNPJ do cliente, CNAE sugerido, descritivo e
 * vencimentos ("uma nota, vários vencimentos"); leva os anexos da PO; e
 * traz a lista revista dos contatos de cobrança, que passa a ser a do job
 * (D1). A soma das notas é conferida contra o valor relido: quem diz o
 * total é o banco, o formulário só diz como reparti-lo.
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

  // A conferência do envio — o mês, o status, os consumos de save, a
  // revisão da abertura, a errata pronta, o VALOR relido do banco e o "já
  // enviado" — é a mesma do envio em lote pela lista de Jobs (decisão 188)
  // e mora em `lib/faturamento/conferir-envio-do-job.ts`. Os contatos de
  // cobrança de antes (para a auditoria da troca, D1) vêm em paralelo.
  const [conf, contatosAntes] = await Promise.all([
    conferirEnvioDoJob(supabase, {
      tenantId: session.activeTenant.id,
      jobId,
      mes: parsed.data.mes ?? null,
    }),
    contatosDeCobrancaDoJob(jobId, session.activeTenant.id),
  ]);
  if (!conf.ok) {
    if (conf.auditoria) {
      await logAuditEvent({
        acao: "acao_negada",
        tenantId: session.activeTenant.id,
        entidadeTipo: "job",
        entidadeId: jobId,
        metadata: {
          acao_tentada: "job.enviado_faturamento",
          motivo: conf.auditoria.motivo,
          ...(conf.auditoria.detalhes ?? {}),
        },
      });
    }
    return { ok: false, message: conf.message };
  }
  const { job, mes, nomeMes, valor, valorSave } = conf;

  // Mídia Off (decisão 167): a veiculação do mês, e o envio que deixa todos
  // os meses enviados ENCERRA o job junto (Tiago, 13/10/2026).
  let encerraOJob = false;
  if (conf.paramsMidia && mes && conf.porMes) {
    const recusa = await conferirEnvioDoMesDaMidia(supabase, {
      tenantId: session.activeTenant.id,
      jobId,
      versaoAprovadaId: job.versao_orcamento_aprovada_id,
      mes,
      nomeMes: nomeMes ?? mes,
      mesesComFaturamento: conf.porMes.filter((m) => m.faturamento > 0.004).map((m) => m.mes),
    });
    if ("recusa" in recusa) {
      await logAuditEvent({
        acao: "acao_negada",
        tenantId: session.activeTenant.id,
        entidadeTipo: "job",
        entidadeId: jobId,
        metadata: { acao_tentada: "job.enviado_faturamento", motivo: recusa.motivo, mes },
      });
      return { ok: false, message: recusa.recusa };
    }
    encerraOJob = recusa.encerra;
  }

  // A soma das notas fecha contra o valor RELIDO, não contra o que o
  // navegador mandou. Tolerância de 1 centavo pelo arredondamento da
  // divisão em partes iguais. O valor de cada nota é a soma das parcelas
  // dela (decisão 123), então é a mesma conta.
  const somaNotas = parsed.data.notas.reduce(
    (s, n) => s + n.parcelas.reduce((t, p) => t + p.valor, 0),
    0,
  );
  if (Math.abs(somaNotas - valor) > 0.01) {
    return {
      ok: false,
      message:
        `A soma das notas fiscais (${formatarBRL(somaNotas)}) não fecha com o ` +
        `valor a faturar (${formatarBRL(valor)}).`,
    };
  }

  // Os anexos da PO subiram direto do navegador ao Storage, na pasta do
  // job. O banco confere de novo (`envio_anexo_guarda_escrita_direta`).
  const pastaDoJob = `${session.activeTenant.id}/${jobId}/`;
  if (parsed.data.anexos_po.some((a) => !a.path.startsWith(pastaDoJob))) {
    return { ok: false, message: "Um dos anexos da PO não está na pasta deste job. Remova e anexe de novo." };
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

    if (!portal || portal.cliente_id !== job.cliente_id) {
      return { ok: false, message: "Portal inválido para este cliente." };
    }
    portalUrl = portal.url;
  }

  // Envio, notas, parcelas, anexos e contatos numa transação só (decisões
  // 075 e 123). Até a 075 eram dois
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
        portal_id: parsed.data.portal_id,
        portal_url: portalUrl,
        enviado_por: session.profile.id,
        mes,
        valor_save: valorSave,
        notas: parsed.data.notas.map((n) => ({
          cnpj: n.cnpj,
          tomador_exterior: n.tomador_exterior,
          cnae_sugerido: n.cnae_sugerido,
          descritivo: n.descritivo,
          parcelas: n.parcelas.map((p) => ({
            valor: p.valor,
            data_vencimento: p.data_vencimento,
          })),
        })),
        anexos: parsed.data.anexos_po,
        contatos: parsed.data.contatos,
      },
    },
  );

  if (error || !envioId) {
    console.error("[job.enviarFaturamento]", error?.message);
    // Dois cliques quase juntos passam os dois pela conferência de "já
    // enviado" acima; o segundo esbarra no unique e merece a mesma frase.
    if (error?.message.includes("uniq_envio_faturamento_job")) {
      return { ok: false, message: mensagemJaEnviado(nomeMes) };
    }
    return {
      ok: false,
      message:
        "Não foi possível enviar o job para faturamento. Nada foi gravado — " +
        "confira as notas e tente de novo.",
    };
  }

  const primeiroVencimento =
    parsed.data.notas
      .flatMap((n) => n.parcelas.map((p) => p.data_vencimento))
      .sort()[0] ?? null;
  const chaveContato = (c: { nome: string; numero: string | null; email: string }) =>
    `${c.nome.trim()}|${(c.numero ?? "").trim()}|${c.email.trim().toLowerCase()}`;
  const contatosMudaram =
    contatosAntes.map(chaveContato).join("\n") !==
    parsed.data.contatos.map(chaveContato).join("\n");

  await logAuditEvent({
    acao: "job.enviado_para_faturamento",
    tenantId: session.activeTenant.id,
    entidadeTipo: "job",
    entidadeId: jobId,
    metadata: {
      valor_faturado: valor,
      data_faturamento: primeiroVencimento,
      qtd_notas: parsed.data.notas.length,
      qtd_parcelas: parsed.data.notas.reduce((s, n) => s + n.parcelas.length, 0),
      qtd_cnpjs: new Set(parsed.data.notas.map((n) => n.cnpj)).size,
      notas_com_descritivo: parsed.data.notas.filter((n) => n.descritivo).length,
      notas_com_cnae: parsed.data.notas.filter((n) => n.cnae_sugerido).length,
      tem_po: parsed.data.numero_po !== null,
      qtd_anexos_po: parsed.data.anexos_po.length,
      tem_portal: parsed.data.portal_id !== null,
      contatos_alterados: contatosMudaram,
      mes,
      valor_save: valorSave,
    },
  });

  // Os contatos de cobrança são do job (D1): trocar a lista no envio é
  // alteração do job, e fica registrada com o antes e o depois.
  if (contatosMudaram) {
    await logAuditEvent({
      acao: "job.contatos_cobranca_alterados",
      tenantId: session.activeTenant.id,
      entidadeTipo: "job",
      entidadeId: jobId,
      metadata: {
        origem: "envio_faturamento",
        antes: contatosAntes,
        depois: parsed.data.contatos,
      },
    });
  }

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
  revalidatePath("/financeiro");
  revalidatePath("/financeiro/abertura-de-job");
  revalidatePath(`/financeiro/jobs/${jobId}`);
  revalidatePath("/financeiro/contas-a-receber");

  // Mídia Off: o envio do último mês encerra o job junto (decisão 167). As
  // pendências já foram conferidas acima; o `encerrarJob` refaz a conta e,
  // com todo o faturamento enviado, o banco grava `finalizado`. Se ele
  // recusar (alguém emitiu uma PP entre as duas leituras), o envio fica e a
  // trilha "Encerramento" volta a mostrar o botão — todos os meses enviados.
  if (encerraOJob) {
    const r = await encerrarJob(jobId);
    if (!r.ok) console.error("[job.enviarFaturamento.encerrar]", r.message);
  }

  return { ok: true, id: envioId as string };
}
