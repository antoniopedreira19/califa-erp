"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { checarPermissao } from "@/lib/permissoes-server";
import { jobEstaCongelado, type JobStatus } from "@/lib/types";

/**
 * O "Salvar" do pop-up "Equipe" (decisão 174), do job e da visão agregada.
 *
 * Grava duas coisas, cada uma com o seu papel:
 *  - quem está na Equipe do projeto (os acréscimos manuais, papel
 *    `equipe`): GPs e produtores (`projetos.editar_equipe`);
 *  - a chave do envio de PP pelo Produtor Responsável de cada job: só GP e
 *    administrador (`jobs.liberar_envio_pp_produtor`), e o banco confere de
 *    novo (`definir_envio_de_pp_do_produtor`).
 *
 * Só o que mudou passa pelo portão: um produtor que salva sem mexer na
 * chave não é barrado por ela.
 */

const entradaSchema = z.object({
  projetoId: z.string().uuid(),
  acrescimos: z.array(z.string().uuid()).max(200),
  chaves: z
    .array(z.object({ jobId: z.string().uuid(), liga: z.boolean() }))
    .max(200),
});

export type EntradaDaEquipe = z.infer<typeof entradaSchema>;
export type ResultadoDaEquipe = { ok: true } | { ok: false; message: string };

export async function salvarEquipeDoProjeto(
  entrada: EntradaDaEquipe,
): Promise<ResultadoDaEquipe> {
  const parsed = entradaSchema.safeParse(entrada);
  if (!parsed.success)
    return {
      ok: false,
      message: "Dados da equipe inválidos. Recarregue a página.",
    };
  const { projetoId, chaves } = parsed.data;
  const acrescimos = Array.from(new Set(parsed.data.acrescimos));

  const session = await requireSession();
  const tenantId = session.activeTenant.id;
  const supabase = createClient();

  const [projetoRes, vinculosRes, jobsRes, membrosRes] = await Promise.all([
    supabase
      .from("projetos")
      .select("id, codigo")
      .eq("id", projetoId)
      .eq("tenant_id", tenantId)
      .maybeSingle<{ id: string; codigo: string }>(),
    supabase
      .from("projeto_responsaveis")
      .select("profile_id, papel")
      .eq("projeto_id", projetoId)
      .eq("tenant_id", tenantId),
    supabase
      .from("jobs")
      .select(
        "id, codigo, status, produtor_id, produtor_envia_pp, profiles:profiles!produtor_id(nome)",
      )
      .eq("projeto_id", projetoId)
      .eq("tenant_id", tenantId)
      .neq("status", "cancelado"),
    supabase.rpc("membros_ativos_com_papel", { p_tenant_id: tenantId }),
  ]);
  const projeto = projetoRes.data;
  if (!projeto) return { ok: false, message: "Projeto não encontrado." };

  const vinculos = (vinculosRes.data ?? []) as Array<{
    profile_id: string;
    papel: "gp" | "equipe";
  }>;
  const gps = new Set(
    vinculos.filter((v) => v.papel === "gp").map((v) => v.profile_id),
  );
  const atuais = new Set(
    vinculos.filter((v) => v.papel === "equipe").map((v) => v.profile_id),
  );
  const nomes = new Map(
    ((membrosRes.data ?? []) as Array<{ id: string; nome: string }>).map(
      (m) => [m.id, m.nome],
    ),
  );

  // Quem já é GP do projeto não vira linha de equipe: a chave da tabela é
  // (projeto, pessoa), e ele já está nela.
  const queridos = new Set(acrescimos.filter((id) => !gps.has(id)));
  const entram = [...queridos].filter((id) => !atuais.has(id));
  const saem = [...atuais].filter((id) => !queridos.has(id));

  const jobs = (jobsRes.data ?? []) as unknown as Array<{
    id: string;
    codigo: string;
    produtor_id: string | null;
    produtor_envia_pp: boolean;
    status: JobStatus;
    profiles: { nome: string } | null;
  }>;
  const jobPorId = new Map(jobs.map((j) => [j.id, j]));
  const mudancasDeChave = chaves.filter((c) => {
    const j = jobPorId.get(c.jobId);
    return j && j.produtor_envia_pp !== c.liga;
  });
  if (chaves.some((c) => !jobPorId.has(c.jobId))) {
    return {
      ok: false,
      message: "Um dos jobs não é deste projeto. Recarregue a página.",
    };
  }
  // Encerrado ou finalizado não envia mais PP: a chave fica como está.
  const parado = mudancasDeChave.find((c) =>
    jobEstaCongelado(jobPorId.get(c.jobId)!.status),
  );
  if (parado) {
    return {
      ok: false,
      message: `O ${jobPorId.get(parado.jobId)!.codigo} já foi encerrado: a chave não muda mais.`,
    };
  }

  if (entram.length + saem.length > 0) {
    const gate = await checarPermissao(session, "projetos.editar_equipe", {
      projeto_id: projetoId,
    });
    if (!gate.ok)
      return { ok: false, message: "Só GPs e produtores mudam a equipe." };
    const semCadastro = entram.find((id) => !nomes.has(id));
    if (semCadastro) {
      return {
        ok: false,
        message: "Só entra na equipe quem é membro ativo. Recarregue a página.",
      };
    }
  }
  if (mudancasDeChave.length > 0) {
    const gate = await checarPermissao(
      session,
      "jobs.liberar_envio_pp_produtor",
      { projeto_id: projetoId },
    );
    if (!gate.ok)
      return {
        ok: false,
        message: "Só o GP ou o administrador mexe na chave do envio de PP.",
      };
  }

  if (saem.length > 0) {
    const { error } = await supabase
      .from("projeto_responsaveis")
      .delete()
      .eq("projeto_id", projetoId)
      .eq("tenant_id", tenantId)
      .eq("papel", "equipe")
      .in("profile_id", saem);
    if (error) {
      console.error("[equipe.sair]", error.message);
      return {
        ok: false,
        message: "Não foi possível tirar da equipe. Tente de novo.",
      };
    }
  }
  if (entram.length > 0) {
    const { error } = await supabase.from("projeto_responsaveis").insert(
      entram.map((profile_id) => ({
        projeto_id: projetoId,
        profile_id,
        tenant_id: tenantId,
        papel: "equipe" as const,
      })),
    );
    if (error) {
      console.error("[equipe.entrar]", error.message);
      return {
        ok: false,
        message: "Não foi possível pôr na equipe. Tente de novo.",
      };
    }
  }
  if (entram.length + saem.length > 0) {
    await logAuditEvent({
      acao: "projeto.equipe_alterada",
      tenantId,
      entidadeTipo: "projeto",
      entidadeId: projetoId,
      metadata: {
        decisao: "174",
        projeto_codigo: projeto.codigo,
        entraram: entram.map((id) => ({ id, nome: nomes.get(id) ?? null })),
        sairam: saem.map((id) => ({ id, nome: nomes.get(id) ?? null })),
      },
    });
  }

  for (const c of mudancasDeChave) {
    const job = jobPorId.get(c.jobId)!;
    const { error } = await supabase.rpc("definir_envio_de_pp_do_produtor", {
      p_job_id: c.jobId,
      p_liga: c.liga,
    });
    if (error) {
      console.error("[equipe.chave]", error.message);
      const limpa = error.message.replace(/^.*?(?:ERROR|erro):\s*/i, "").trim();
      return {
        ok: false,
        message:
          limpa && !/[_"]/.test(limpa)
            ? limpa
            : `Não foi possível mudar a chave do ${job.codigo}.`,
      };
    }
    await logAuditEvent({
      acao: c.liga
        ? "job.envio_de_pp_do_produtor_ligado"
        : "job.envio_de_pp_do_produtor_desligado",
      tenantId,
      entidadeTipo: "job",
      entidadeId: c.jobId,
      metadata: {
        decisao: "174",
        job_codigo: job.codigo,
        produtor_id: job.produtor_id,
        produtor_nome: job.profiles?.nome ?? null,
      },
    });
  }

  revalidatePath(`/jobs/projeto/${projetoId}`);
  for (const j of jobs) revalidatePath(`/jobs/${j.id}`);
  return { ok: true };
}
