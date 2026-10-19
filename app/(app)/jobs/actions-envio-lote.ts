"use server";

/**
 * Envio em lote para faturamento pela lista de Jobs (decisão 188, entrega 1).
 *
 * A produção marca jobs de um mesmo cliente e de uma mesma empresa e monta
 * as notas que o cliente pediu. Cada job continua com o seu envio — o mesmo
 * do envio pela página do job, com a MESMA conferência
 * (`conferirEnvioDoJob`): status, saves, revisão da abertura, errata
 * pronta, mês e o valor relido do banco. O lote acrescenta o rastro entre as
 * notas do cliente e os jobs (`envios_faturamento_lote*`).
 *
 * Duas portas:
 *   - `carregarEnvioEmLote`: ao abrir o pop-up, relê os jobs marcados e diz
 *     o valor de cada um (o do mês, no mensal), os contatos, os portais e o
 *     motivo dos que não podem ir agora;
 *   - `enviarLoteParaFaturamento`: confere tudo de novo, refaz o rateio com
 *     os valores relidos e grava numa transação (`enviar_lote_para_faturamento`).
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { checarPermissao } from "@/lib/permissoes-server";
import { contatosDeCobrancaPorJob } from "@/lib/data/contatos-cobranca";
import { lerFaturamentoPorMesDoJob } from "@/lib/data/faturamento-mensal";
import { nomeDoMes } from "@/lib/calculos/meses-trimestre";
import { hojeEmSaoPauloIso } from "@/lib/calculos/janelas-pagamento";
import {
  MANUAL,
  PROPORCIONAL,
  centavos,
  parcelasDaParte,
  ratearNotas,
} from "@/lib/calculos/envio-em-lote";
import { conferirEnvioDoJob } from "@/lib/faturamento/conferir-envio-do-job";
import { envioEmLoteSchema, type EnvioEmLoteInput } from "@/lib/validations/envio-faturamento-lote";

export interface JobDoLote {
  id: string;
  codigo: string;
  nome: string;
  /** O valor a faturar, relido: o do mês no mensal. */
  valor: number;
  /** O mês do envio (Fee e Always On), com a posição dele no orçamento. */
  mes: { iso: string; nome: string; ordem: number; total: number } | null;
}

export interface DadosDoLote {
  cliente: { id: string; nome: string; cnpj: string | null };
  empresa: { id: string; nome: string };
  /** O mês dos mensais do lote; nulo sem mensal. */
  mes: string | null;
  jobs: JobDoLote[];
  /** Os marcados que não podem ir agora, com o motivo. */
  foraDoLote: Array<{ id: string; codigo: string; motivo: string }>;
  /** Vencimento sugerido: a data prevista de faturamento mais cedo que ainda não passou. */
  vencimentoSugerido: string;
  contatos: Array<{ nome: string; numero: string; email: string; deJobs: string[] }>;
  portais: Array<{ id: string; nome: string; url: string }>;
}

export type CarregarLoteResult = { ok: true; dados: DadosDoLote } | { ok: false; message: string };

interface JobLido {
  id: string;
  codigo: string;
  nome: string;
  status: string;
  empresa_id: string | null;
  data_prevista_faturamento: string | null;
  versao_orcamento_aprovada_id: string;
  projeto: { cliente_id: string; cliente: { nome_fantasia: string | null; razao_social: string | null; cnpj: string | null } | null } | null;
  empresa: { nome_fantasia: string | null; razao_social: string | null } | null;
  orcamento: { categoria: { modelo_planilha: string } | null } | null;
  versao: { percentual_honorarios: number | string; percentual_imposto: number | string } | null;
}

/**
 * O próximo mês a enviar de um job mensal (Fee e Always On): o primeiro mês
 * do orçamento com faturamento e sem envio. `null` quando não há.
 */
async function proximoMesDoJob(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  j: JobLido,
): Promise<{ iso: string; ordem: number; total: number } | null | "erro"> {
  const [porMes, enviosRes] = await Promise.all([
    lerFaturamentoPorMesDoJob(supabase, {
      tenantId,
      jobId: j.id,
      versaoAprovadaId: j.versao_orcamento_aprovada_id,
      percentualHonorarios: Number(j.versao?.percentual_honorarios ?? 0),
      percentualImposto: Number(j.versao?.percentual_imposto ?? 0),
      contar: [],
    }),
    supabase
      .from("jobs_envio_faturamento")
      .select("mes")
      .eq("job_id", j.id)
      .eq("tenant_id", tenantId)
      .not("mes", "is", null)
      .returns<{ mes: string }[]>(),
  ]);
  if (!porMes || enviosRes.error) return "erro";
  const enviados = new Set((enviosRes.data ?? []).map((e) => e.mes.slice(0, 10)));
  const i = porMes.findIndex((m) => m.faturamento > 0.004 && !enviados.has(m.mes.slice(0, 10)));
  if (i < 0) return null;
  return { iso: porMes[i].mes.slice(0, 10), ordem: i + 1, total: porMes.length };
}

async function lerJobs(supabase: ReturnType<typeof createClient>, tenantId: string, ids: string[]) {
  return supabase
    .from("jobs")
    .select(
      "id, codigo, nome, status, empresa_id, data_prevista_faturamento, versao_orcamento_aprovada_id, " +
        "projeto:projetos(cliente_id, cliente:clientes(nome_fantasia, razao_social, cnpj)), " +
        "empresa:empresas(nome_fantasia, razao_social), " +
        "orcamento:orcamentos(categoria:categorias_dominio!categoria_id(modelo_planilha)), " +
        "versao:versoes_orcamento!versao_orcamento_aprovada_id(percentual_honorarios, percentual_imposto)",
    )
    .in("id", ids)
    .eq("tenant_id", tenantId)
    .returns<JobLido[]>();
}

/** Mesmo cliente e mesma empresa — a regra do lote (Tiago, 19/10/2026). */
function conferirClienteEEmpresa(jobs: JobLido[]): string | null {
  const clientes = new Set(jobs.map((j) => j.projeto?.cliente_id ?? ""));
  const empresas = new Set(jobs.map((j) => j.empresa_id ?? ""));
  if (clientes.size !== 1 || clientes.has("")) return "O envio em lote é de jobs de um mesmo cliente.";
  if (empresas.size !== 1 || empresas.has("")) return "O envio em lote é de jobs de uma mesma empresa.";
  return null;
}

/**
 * Relê os jobs marcados na lista e monta o pop-up do lote. Não grava nada.
 */
export async function carregarEnvioEmLote(jobIds: string[]): Promise<CarregarLoteResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "jobs.enviar_faturamento");
  if (!gate.ok) return { ok: false, message: gate.message };

  const ids = [...new Set(jobIds)].slice(0, 60);
  if (ids.length === 0) return { ok: false, message: "Marque os jobs do envio." };

  const tenantId = session.activeTenant.id;
  const supabase = createClient();
  const { data: lidos, error } = await lerJobs(supabase, tenantId, ids);
  if (error || !lidos || lidos.length === 0) {
    if (error) console.error("[jobs.lote.carregar]", error.message);
    return { ok: false, message: "Não foi possível ler os jobs marcados. Tente de novo." };
  }
  const recusa = conferirClienteEEmpresa(lidos);
  if (recusa) return { ok: false, message: recusa };

  const ordem = new Map(ids.map((id, i) => [id, i]));
  const jobs = [...lidos].sort((a, b) => (ordem.get(a.id) ?? 0) - (ordem.get(b.id) ?? 0));
  const foraDoLote: DadosDoLote["foraDoLote"] = [];

  // Mídia Off fica fora: o envio dela tem as travas da veiculação e o
  // encerramento junto do último mês (decisão 167), só pela página do job.
  const modelo = (j: JobLido) => j.orcamento?.categoria?.modelo_planilha ?? null;
  const candidatos = jobs.filter((j) => {
    if (modelo(j) === "midia_off") {
      foraDoLote.push({
        id: j.id,
        codigo: j.codigo,
        motivo: "Mídia Off é enviada mês a mês pela página do job.",
      });
      return false;
    }
    return true;
  });

  // O mês do lote: o próximo mês a enviar dos mensais. Mensal que está em
  // outro mês fica fora — o lote é de um mês só.
  const mensais = candidatos.filter((j) => modelo(j) === "mensal");
  const proximos = await Promise.all(mensais.map((j) => proximoMesDoJob(supabase, tenantId, j)));
  const proximoDe = new Map<string, { iso: string; ordem: number; total: number }>();
  mensais.forEach((j, i) => {
    const p = proximos[i];
    if (p === "erro") {
      foraDoLote.push({ id: j.id, codigo: j.codigo, motivo: "Não foi possível ler os meses do job. Tente de novo." });
    } else if (p === null) {
      foraDoLote.push({ id: j.id, codigo: j.codigo, motivo: "Todos os meses com faturamento já foram enviados." });
    } else {
      proximoDe.set(j.id, p);
    }
  });
  const mesDoLote = [...proximoDe.values()].map((p) => p.iso).sort()[0] ?? null;

  const aConferir = candidatos.filter((j) => {
    if (modelo(j) !== "mensal") return true;
    const p = proximoDe.get(j.id);
    if (!p) return false;
    if (p.iso !== mesDoLote) {
      foraDoLote.push({
        id: j.id,
        codigo: j.codigo,
        motivo: `O mês a enviar dele é ${nomeDoMes(p.iso)}; o lote vai com ${nomeDoMes(mesDoLote!)}.`,
      });
      return false;
    }
    return true;
  });

  // A conferência de cada job, a mesma do envio pela página do job.
  const [conferencias, contatosPorJob, portaisRes] = await Promise.all([
    Promise.all(
      aConferir.map((j) =>
        conferirEnvioDoJob(supabase, {
          tenantId,
          jobId: j.id,
          mes: modelo(j) === "mensal" ? mesDoLote : null,
        }),
      ),
    ),
    contatosDeCobrancaPorJob(
      aConferir.map((j) => j.id),
      tenantId,
    ),
    supabase
      .from("cliente_portais")
      .select("id, nome, url")
      .eq("tenant_id", tenantId)
      .eq("cliente_id", jobs[0].projeto!.cliente_id)
      .eq("ativo", true)
      .order("nome")
      .returns<{ id: string; nome: string; url: string }[]>(),
  ]);

  const doLote: JobDoLote[] = [];
  aConferir.forEach((j, i) => {
    const c = conferencias[i];
    if (!c.ok) {
      foraDoLote.push({ id: j.id, codigo: j.codigo, motivo: c.message });
      return;
    }
    const p = proximoDe.get(j.id);
    doLote.push({
      id: j.id,
      codigo: j.codigo,
      nome: j.nome,
      valor: c.valor,
      mes: c.mes && p ? { iso: c.mes, nome: nomeDoMes(c.mes), ordem: p.ordem, total: p.total } : null,
    });
  });

  // Contatos de cobrança dos jobs, sem repetir e-mail: a lista vale para
  // todos os jobs do lote.
  const porEmail = new Map<string, DadosDoLote["contatos"][number]>();
  for (const j of doLote) {
    for (const c of contatosPorJob.get(j.id) ?? []) {
      const chave = c.email.trim().toLowerCase();
      if (!chave) continue;
      const atual = porEmail.get(chave);
      if (atual) atual.deJobs.push(j.codigo);
      else porEmail.set(chave, { nome: c.nome, numero: c.numero, email: c.email, deJobs: [j.codigo] });
    }
  }

  const hoje = hojeEmSaoPauloIso();
  const vencimentoSugerido =
    jobs
      .filter((j) => doLote.some((d) => d.id === j.id))
      .map((j) => j.data_prevista_faturamento ?? "")
      .filter((d) => d >= hoje)
      .sort()[0] ?? "";

  const cli = jobs[0].projeto!.cliente;
  const emp = jobs[0].empresa;
  return {
    ok: true,
    dados: {
      cliente: {
        id: jobs[0].projeto!.cliente_id,
        nome: cli?.nome_fantasia ?? cli?.razao_social ?? "Cliente",
        cnpj: cli?.cnpj ? cli.cnpj.replace(/\D/g, "") : null,
      },
      empresa: { id: jobs[0].empresa_id!, nome: emp?.nome_fantasia ?? emp?.razao_social ?? "Empresa" },
      mes: doLote.some((j) => j.mes) ? mesDoLote : null,
      jobs: doLote,
      foraDoLote,
      vencimentoSugerido,
      contatos: [...porEmail.values()],
      portais: portaisRes.data ?? [],
    },
  };
}

export type EnviarLoteResult = { ok: true; loteId: string; qtdJobs: number; qtdNotas: number } | { ok: false; message: string };

/**
 * Envia o lote. Confere de novo cada job (o estado pode ter mudado desde
 * que o pop-up abriu), refaz o rateio com os valores relidos e grava tudo
 * numa transação: ou vão todos os jobs, ou nenhum.
 */
export async function enviarLoteParaFaturamento(input: EnvioEmLoteInput): Promise<EnviarLoteResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "jobs.enviar_faturamento");
  if (!gate.ok) return { ok: false, message: gate.message };

  const parsed = envioEmLoteSchema.safeParse(input);
  if (!parsed.success) {
    const primeira = parsed.error.issues[0];
    return { ok: false, message: primeira?.message ?? "Confira os campos do envio." };
  }
  const dados = parsed.data;
  const tenantId = session.activeTenant.id;
  const supabase = createClient();

  const ids = [...new Set(dados.jobs.map((j) => j.job_id))];
  const { data: lidos, error } = await lerJobs(supabase, tenantId, ids);
  if (error || !lidos || lidos.length !== ids.length) {
    if (error) console.error("[jobs.lote.enviar.ler]", error.message);
    return { ok: false, message: "Não foi possível ler os jobs do envio. Tente de novo." };
  }
  const recusa = conferirClienteEEmpresa(lidos);
  if (recusa) return { ok: false, message: recusa };
  const modelo = (j: JobLido) => j.orcamento?.categoria?.modelo_planilha ?? null;
  const midia = lidos.find((j) => modelo(j) === "midia_off");
  if (midia) return { ok: false, message: `${midia.codigo}: Mídia Off é enviada mês a mês pela página do job.` };
  const temMensal = lidos.some((j) => modelo(j) === "mensal");
  if (temMensal && !dados.mes) return { ok: false, message: "Informe o mês dos jobs mensais." };

  // A mesma conferência do envio de um job, para cada job.
  const [conferencias, contatosAntes] = await Promise.all([
    Promise.all(
      lidos.map((j) =>
        conferirEnvioDoJob(supabase, { tenantId, jobId: j.id, mes: modelo(j) === "mensal" ? dados.mes : null }),
      ),
    ),
    contatosDeCobrancaPorJob(ids, tenantId),
  ]);
  for (let i = 0; i < lidos.length; i++) {
    const c = conferencias[i];
    if (c.ok) continue;
    if (c.auditoria) {
      await logAuditEvent({
        acao: "acao_negada",
        tenantId,
        entidadeTipo: "job",
        entidadeId: lidos[i].id,
        metadata: {
          acao_tentada: "job.enviado_faturamento",
          origem: "envio_em_lote",
          motivo: c.auditoria.motivo,
          ...(c.auditoria.detalhes ?? {}),
        },
      });
    }
    return { ok: false, message: `${lidos[i].codigo}: ${c.message}` };
  }
  const valorDe = new Map<string, { valor: number; valorSave: number | null; mes: string | null }>();
  lidos.forEach((j, i) => {
    const c = conferencias[i];
    if (c.ok) valorDe.set(j.id, { valor: c.valor, valorSave: c.valorSave, mes: c.mes });
  });

  // O rateio, refeito com os valores relidos. "Só o job" e a divisão à mão
  // só valem para jobs do lote.
  const notas = dados.notas.map((n, i) => ({ ...n, id: `n${i + 1}` }));
  for (const [i, n] of notas.entries()) {
    if (n.rateio !== PROPORCIONAL && n.rateio !== MANUAL && !valorDe.has(n.rateio)) {
      return { ok: false, message: `A nota ${i + 1} aponta para um job que não está no lote.` };
    }
    if (n.rateio === MANUAL) {
      const soma = Object.entries(n.manual ?? {}).reduce(
        (s, [jid, v]) => s + (valorDe.has(jid) ? centavos(v) : 0),
        0,
      );
      if (soma !== centavos(n.valor)) {
        return { ok: false, message: `A divisão à mão da nota ${i + 1} não fecha com o valor dela.` };
      }
    }
  }
  const jobsParaRatear = lidos.map((j) => ({ id: j.id, valor: valorDe.get(j.id)!.valor }));
  const partes = ratearNotas(
    notas.map((n) => ({ id: n.id, valor: n.valor, modo: n.rateio, manual: n.manual })),
    jobsParaRatear,
  );
  for (const [i, n] of notas.entries()) {
    const soma = Object.values(partes[n.id]).reduce((s, x) => s + x, 0);
    if (soma !== centavos(n.valor)) {
      return { ok: false, message: `A nota ${i + 1} não fecha com as partes dos jobs. Confira o rateio.` };
    }
  }
  for (const j of lidos) {
    const noJob = notas.reduce((s, n) => s + (partes[n.id][j.id] ?? 0), 0);
    const devido = centavos(valorDe.get(j.id)!.valor);
    if (noJob !== devido) {
      const d = (Math.abs(devido - noJob) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
      return {
        ok: false,
        message: noJob < devido ? `Faltam ${d} do ${j.codigo} nas notas.` : `Sobram ${d} no ${j.codigo}.`,
      };
    }
  }

  // O portal precisa ser do cliente do lote; a URL fica guardada, como no
  // envio de um job.
  const clienteId = lidos[0].projeto!.cliente_id;
  let portalUrl: string | null = null;
  if (dados.portal_id) {
    const { data: portal } = await supabase
      .from("cliente_portais")
      .select("id, url, cliente_id")
      .eq("id", dados.portal_id)
      .eq("tenant_id", tenantId)
      .maybeSingle<{ id: string; url: string; cliente_id: string }>();
    if (!portal || portal.cliente_id !== clienteId) {
      return { ok: false, message: "Portal inválido para este cliente." };
    }
    portalUrl = portal.url;
  }

  const poDe = new Map(dados.jobs.map((j) => [j.job_id, j.numero_po]));
  const payload = {
    tenant_id: tenantId,
    cliente_id: clienteId,
    empresa_id: lidos[0].empresa_id,
    mes: temMensal ? dados.mes : null,
    observacao: dados.observacao,
    portal_id: dados.portal_id,
    portal_url: portalUrl,
    enviado_por: session.profile.id,
    notas: notas.map((n) => ({
      tomador_nome: n.tomador_nome,
      cnpj: n.cnpj,
      tomador_exterior: n.tomador_exterior,
      valor: n.valor,
      cnae_sugerido: dados.cnae_sugerido,
      descritivo: n.descritivo,
      rateio: n.rateio === PROPORCIONAL ? "proporcional" : n.rateio === MANUAL ? "manual" : "job",
    })),
    jobs: lidos.map((j) => {
      const v = valorDe.get(j.id)!;
      return {
        job_id: j.id,
        valor_faturado: v.valor,
        valor_save: v.valorSave,
        mes: v.mes,
        numero_po: poDe.get(j.id) ?? null,
        portal_id: dados.portal_id,
        portal_url: portalUrl,
        enviado_por: session.profile.id,
        contatos: dados.contatos,
        notas: notas
          .map((n, i) => ({ n, i }))
          .filter(({ n }) => (partes[n.id][j.id] ?? 0) > 0)
          .map(({ n, i }) => ({
            lote_nota_ordem: i + 1,
            cnpj: n.cnpj,
            tomador_exterior: n.tomador_exterior,
            cnae_sugerido: dados.cnae_sugerido,
            descritivo: n.descritivo,
            parcelas: parcelasDaParte(partes[n.id][j.id], dados.parcelas, dados.vencimento),
          })),
      };
    }),
  };

  const { data: loteId, error: rpcErr } = await supabase.rpc("enviar_lote_para_faturamento", { payload });
  if (rpcErr || !loteId) {
    console.error("[jobs.lote.enviar]", rpcErr?.message);
    if (rpcErr?.message.includes("uniq_envio_faturamento_job")) {
      return { ok: false, message: "Um dos jobs já foi enviado para faturamento enquanto o pop-up estava aberto." };
    }
    const legivel = rpcErr?.message && /^[A-ZÀ-Ú]/.test(rpcErr.message) ? rpcErr.message : null;
    return {
      ok: false,
      message: legivel ?? "Não foi possível enviar o lote para faturamento. Nada foi gravado — tente de novo.",
    };
  }

  // Auditoria: o envio de cada job (a trilha do job segue completa) e o
  // lote, com o que só ele sabe.
  const chave = (c: { nome: string; numero: string | null; email: string }) =>
    `${c.nome.trim()}|${(c.numero ?? "").trim()}|${c.email.trim().toLowerCase()}`;
  const depois = dados.contatos.map(chave).join("\n");
  await Promise.all([
    logAuditEvent({
      acao: "jobs.enviados_em_lote",
      tenantId,
      entidadeTipo: "envio_faturamento_lote",
      entidadeId: loteId as string,
      metadata: {
        jobs: lidos.map((j) => j.codigo),
        qtd_notas: notas.length,
        valor_total: lidos.reduce((s, j) => s + valorDe.get(j.id)!.valor, 0),
        mes: temMensal ? dados.mes : null,
        parcelas: dados.parcelas,
        rateio: {
          proporcional: notas.filter((n) => n.rateio === PROPORCIONAL).length,
          manual: notas.filter((n) => n.rateio === MANUAL).length,
          de_um_job: notas.filter((n) => n.rateio !== PROPORCIONAL && n.rateio !== MANUAL).length,
        },
        tem_observacao: dados.observacao !== null,
        tem_portal: dados.portal_id !== null,
      },
    }),
    // A lista de contatos é do job (D1): trocá-la no envio fica registrada
    // com o antes e o depois, como no envio de um job só.
    ...lidos
      .filter((j) => (contatosAntes.get(j.id) ?? []).map(chave).join("\n") !== depois)
      .map((j) =>
        logAuditEvent({
          acao: "job.contatos_cobranca_alterados",
          tenantId,
          entidadeTipo: "job",
          entidadeId: j.id,
          metadata: {
            origem: "envio_em_lote",
            lote_id: loteId,
            antes: contatosAntes.get(j.id) ?? [],
            depois: dados.contatos,
          },
        }),
      ),
    ...lidos.map((j) => {
      const v = valorDe.get(j.id)!;
      const antes = contatosAntes.get(j.id) ?? [];
      return logAuditEvent({
        acao: "job.enviado_para_faturamento",
        tenantId,
        entidadeTipo: "job",
        entidadeId: j.id,
        metadata: {
          origem: "envio_em_lote",
          lote_id: loteId,
          valor_faturado: v.valor,
          data_faturamento: dados.vencimento,
          qtd_notas: notas.filter((n) => (partes[n.id][j.id] ?? 0) > 0).length,
          tem_po: (poDe.get(j.id) ?? null) !== null,
          tem_portal: dados.portal_id !== null,
          contatos_alterados: antes.map(chave).join("\n") !== depois,
          mes: v.mes,
          valor_save: v.valorSave,
        },
      });
    }),
  ]);

  for (const j of lidos) {
    revalidatePath(`/jobs/${j.id}`);
    revalidatePath(`/financeiro/jobs/${j.id}`);
  }
  revalidatePath("/jobs");
  revalidatePath("/financeiro");
  revalidatePath("/financeiro/abertura-de-job");
  revalidatePath("/financeiro/contas-a-receber");

  return { ok: true, loteId: loteId as string, qtdJobs: lidos.length, qtdNotas: notas.length };
}
