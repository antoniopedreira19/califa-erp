import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Mail,
  MapPin,
  CreditCard,
  Building2,
  Heart,
  FileText,
  Plus,
} from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type {
  Freelancer,
  FreelancerCargo,
  FreelancerContrato,
  TipoContaBancariaFornecedor,
} from "@/lib/types";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";
import { HeroFreelancer } from "../_components/hero-freelancer";
import { AbasPerfil } from "../_components/abas-perfil";
import { BlocoInfo, Linha } from "../_components/bloco-info";
import { ContratoCard } from "../contratos/_components/contrato-card";
import { HistoricoContratoTimeline } from "../_components/historico-contrato-timeline";
import { NovaSolicitacaoDialog } from "../solicitacoes/_components/nova-solicitacao-dialog";
import type { JobItem } from "../_components/job-picker";
import { formatCnpj, formatCep, formatTelefone } from "@/lib/utils";
import { PIX_TIPOS } from "@/lib/pix";

const JOBS_STATUS_EXCLUIDOS = ["cancelado", "rejeitado_financeiro"];

const TIPO_CONTA_ROTULO: Record<TipoContaBancariaFornecedor, string> = {
  corrente: "Conta corrente",
  poupanca: "Conta poupança",
  pagamento: "Conta de pagamento",
};

export const dynamic = "force-dynamic";

const PODE_EDITAR = new Set(["administrador", "rh", "financeiro"]);

export default async function FreelancerPerfilPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await requireSession();
  const supabase = createClient();

  const [freelancerRes, contratosRes, historicoRes, jobsRes, cargosRes] =
    await Promise.all([
      supabase
        .from("freelancers")
        .select("*")
        .eq("id", params.id)
        .eq("tenant_id", session.activeTenant.id)
        .maybeSingle(),
      supabase
        .from("freelancer_contratos")
        .select("*, job:jobs(codigo, nome)")
        .eq("freelancer_id", params.id)
        .eq("tenant_id", session.activeTenant.id)
        .order("data_inicio", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false }),
      supabase
        .from("freelancer_contrato_historico")
        .select(
          "*, autor:profiles!alterado_por(nome), contrato:freelancer_contratos!contrato_id(nome_job, freelancer_id)",
        )
        .eq("tenant_id", session.activeTenant.id)
        .order("alterado_em", { ascending: false })
        .limit(200),
      supabase
        .from("jobs")
        .select("id, codigo, nome, status")
        .eq("tenant_id", session.activeTenant.id)
        .not("status", "in", `(${JOBS_STATUS_EXCLUIDOS.join(",")})`)
        .order("codigo", { ascending: false })
        .limit(500),
      supabase
        .from("freelancer_cargos")
        .select("*")
        .eq("tenant_id", session.activeTenant.id)
        .eq("ativo", true)
        .order("nome", { ascending: true })
        .returns<FreelancerCargo[]>(),
    ]);

  const freelancer = freelancerRes.data as Freelancer | null;

  if (freelancerRes.error) {
    console.error("[freelancer.perfil]", freelancerRes.error.message);
  }
  if (!freelancer) {
    notFound();
  }

  const contratos = ((contratosRes.data ?? []) as any[]).map((c) => ({
    ...(c as FreelancerContrato),
    job_codigo: c.job?.codigo ?? null,
    job_nome: c.job?.nome ?? null,
  }));

  // Filtra histórico só dos contratos deste freelancer (RLS já restringiu
  // por tenant). Nome do autor e do job vêm no join.
  const idsDosContratos = new Set(contratos.map((c) => c.id));
  const historico = ((historicoRes.data ?? []) as any[])
    .filter((h) => idsDosContratos.has(h.contrato_id))
    .map((h) => ({
      id: h.id as string,
      tenant_id: h.tenant_id as string,
      contrato_id: h.contrato_id as string,
      campo: h.campo as string,
      valor_anterior: h.valor_anterior as string | null,
      valor_novo: h.valor_novo as string | null,
      alterado_por: h.alterado_por as string | null,
      alterado_em: h.alterado_em as string,
      alterado_por_nome: h.autor?.nome ?? null,
      contrato_nome_job: h.contrato?.nome_job ?? null,
    }));

  // Agrupa histórico por contrato pra passar ao card
  const historicoPorContrato = new Map<
    string,
    typeof historico
  >();
  for (const h of historico) {
    const arr = historicoPorContrato.get(h.contrato_id) ?? [];
    arr.push(h);
    historicoPorContrato.set(h.contrato_id, arr);
  }

  // Resolve nomes dos profiles pra mostrar quem solicitou distrato.
  // Pega IDs únicos de responsavel_id + distrato_solicitado_por.
  const profileIds = new Set<string>();
  for (const c of contratos) {
    if (c.responsavel_id) profileIds.add(c.responsavel_id);
    if (c.distrato_solicitado_por) profileIds.add(c.distrato_solicitado_por);
  }
  let gpNomesPorId: Record<string, string> = {};
  if (profileIds.size > 0) {
    const profilesRes = await supabase
      .from("profiles")
      .select("id, nome")
      .in("id", Array.from(profileIds));
    if (profilesRes.data) {
      for (const p of profilesRes.data as Array<{ id: string; nome: string }>) {
        gpNomesPorId[p.id] = p.nome;
      }
    }
  }

  // Define o contrato "atual" (único): o primeiro que está vigente hoje.
  const hojeISO = new Date().toISOString().slice(0, 10);
  const contratoAtualObj = contratos.find(
    (c) =>
      c.status_real &&
      c.data_inicio !== null &&
      c.data_inicio <= hojeISO &&
      (c.data_termino === null || c.data_termino >= hojeISO),
  );
  const idAtual = contratoAtualObj?.id;
  const heroContratoAtual = contratoAtualObj
    ? {
        valor: contratoAtualObj.valor,
        tipo: contratoAtualObj.tipo,
        data_inicio: contratoAtualObj.data_inicio,
        data_termino: contratoAtualObj.data_termino,
        cidade: contratoAtualObj.cidade,
        cargo: contratoAtualObj.cargo,
        responsavel_nome: contratoAtualObj.responsavel_id
          ? (gpNomesPorId[contratoAtualObj.responsavel_id] ?? null)
          : null,
        status_real: contratoAtualObj.status_real,
      }
    : null;

  // Ordenação: atual > agendado (status_real + inicio no futuro) > encerrados
  const prioridade = (c: FreelancerContrato) => {
    if (c.id === idAtual) return 0;
    if (c.status_real && c.data_inicio && c.data_inicio > hojeISO) return 1;
    return 2;
  };
  const contratosOrdenados = [...contratos].sort((a, b) => {
    const pa = prioridade(a);
    const pb = prioridade(b);
    if (pa !== pb) return pa - pb;
    // Dentro da mesma prioridade: por data_inicio desc (nulls last)
    const da = a.data_inicio ?? "";
    const db = b.data_inicio ?? "";
    return db.localeCompare(da);
  });

  const podeEditar = PODE_EDITAR.has(session.activeRole);
  const isRh = podeEditar; // administrador/rh/financeiro

  const jobsNovaSolic: JobItem[] = (jobsRes.data ?? []).map((j: any) => ({
    id: j.id as string,
    codigo: j.codigo as string,
    nome: j.nome as string,
  }));
  const cargosNovaSolic = cargosRes.data ?? [];

  const botaoSolicitarContrato = (
    <NovaSolicitacaoDialog
      jobs={jobsNovaSolic}
      cargos={cargosNovaSolic}
      freelancer={{
        id: freelancer.id,
        nome: freelancer.nome_social,
        cpf: freelancer.cpf,
      }}
      trigger={
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg bg-california-red px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-california-red-hover transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          Solicitar novo contrato
        </button>
      }
    />
  );

  const abaContratos = (() => {
    if (contratosOrdenados.length === 0) {
      return (
        <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-10 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted/50">
            <FileText className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium text-foreground">
            Nenhum contrato ainda
          </p>
          <p className="mt-1 text-xs text-muted-foreground max-w-sm mx-auto">
            Freelancers precisam ter contrato pra registrar valor, cargo e
            período de trabalho em um job.
          </p>
          <div className="mt-4 inline-flex">{botaoSolicitarContrato}</div>
        </div>
      );
    }
    return (
      <div className="space-y-3">
        {contratosOrdenados.map((c) => {
          // GP dono = responsável do contrato é o usuário atual E role é GP.
          const isGpDoContrato =
            c.responsavel_id === session.profile.id &&
            (session.activeRole === "gerente_producao" ||
              session.activeRole === "produtor");
          const canManage = isRh || isGpDoContrato;
          return (
            <ContratoCard
              key={c.id}
              contrato={c}
              isAtual={c.id === idAtual}
              historico={historicoPorContrato.get(c.id) ?? []}
              isRh={isRh}
              canManage={canManage}
              freelancerNome={freelancer.nome_social}
              gpNomesPorId={gpNomesPorId}
            />
          );
        })}
      </div>
    );
  })();
  const temContato = !!(freelancer.email || freelancer.celular);
  const temEndereco = !!(
    freelancer.cep ||
    freelancer.rua ||
    freelancer.numero ||
    freelancer.complemento ||
    freelancer.bairro ||
    freelancer.cidade
  );
  const temPj = !!(freelancer.cnpj && freelancer.razao_social);
  const temPagamento = !!(
    freelancer.tipo_pagamento ||
    freelancer.banco ||
    freelancer.pix_chave
  );
  const temDiversidade = !!(
    freelancer.cor_raca ||
    freelancer.identidade_genero ||
    freelancer.deficiencia ||
    freelancer.saude_obs ||
    freelancer.contato_emergencia
  );

  const dadosPessoais = (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {temContato && (
        <BlocoInfo icon={Mail} titulo="Contato">
          {freelancer.email && <Linha rotulo="Email" valor={freelancer.email} />}
          {freelancer.celular && (
            <Linha rotulo="Celular" valor={formatTelefone(freelancer.celular)} />
          )}
        </BlocoInfo>
      )}

      {temEndereco && (
        <BlocoInfo icon={MapPin} titulo="Endereço">
          {freelancer.cep && <Linha rotulo="CEP" valor={formatCep(freelancer.cep)} />}
          {freelancer.rua && (
            <Linha
              rotulo="Rua"
              valor={
                freelancer.numero
                  ? `${freelancer.rua}, ${freelancer.numero}`
                  : freelancer.rua
              }
            />
          )}
          {freelancer.complemento && (
            <Linha rotulo="Complemento" valor={freelancer.complemento} />
          )}
          {freelancer.bairro && <Linha rotulo="Bairro" valor={freelancer.bairro} />}
          {freelancer.cidade && <Linha rotulo="Cidade" valor={freelancer.cidade} />}
        </BlocoInfo>
      )}

      {temPj && (
        <BlocoInfo icon={Building2} titulo="Pessoa jurídica">
          <Linha rotulo="CNPJ" valor={formatCnpj(freelancer.cnpj!)} />
          <Linha rotulo="Razão social" valor={freelancer.razao_social} />
        </BlocoInfo>
      )}

      {temPagamento && (
        <BlocoInfo icon={CreditCard} titulo="Pagamento">
          {freelancer.tipo_pagamento && (
            <Linha
              rotulo="Tipo"
              valor={
                freelancer.tipo_pagamento === "pix" ? "PIX" : "Conta bancária"
              }
            />
          )}
          {freelancer.banco && <Linha rotulo="Banco" valor={freelancer.banco} />}
          {freelancer.agencia && (
            <Linha rotulo="Agência" valor={freelancer.agencia} />
          )}
          {freelancer.conta && <Linha rotulo="Conta" valor={freelancer.conta} />}
          {/* Decisão 212 */}
          {freelancer.tipo_conta && (
            <Linha rotulo="Tipo de conta" valor={TIPO_CONTA_ROTULO[freelancer.tipo_conta]} />
          )}
          {freelancer.pix_tipo && (
            <Linha
              rotulo="Tipo da chave"
              valor={PIX_TIPOS.find((t) => t.valor === freelancer.pix_tipo)?.rotulo ?? freelancer.pix_tipo}
            />
          )}
          {freelancer.pix_chave && (
            <Linha rotulo="Chave PIX" valor={freelancer.pix_chave} />
          )}
        </BlocoInfo>
      )}

      {temDiversidade && (
        <BlocoInfo icon={Heart} titulo="Diversidade e saúde" className="md:col-span-2">
          {freelancer.cor_raca && (
            <Linha rotulo="Cor/raça" valor={freelancer.cor_raca} />
          )}
          {freelancer.identidade_genero && (
            <Linha rotulo="Gênero" valor={freelancer.identidade_genero} />
          )}
          {freelancer.deficiencia && (
            <Linha rotulo="Deficiência" valor={freelancer.deficiencia} />
          )}
          {freelancer.saude_obs && (
            <Linha rotulo="Observações" valor={freelancer.saude_obs} />
          )}
          {freelancer.contato_emergencia && (
            <Linha rotulo="Emergência" valor={freelancer.contato_emergencia} />
          )}
        </BlocoInfo>
      )}

      {!temContato &&
        !temEndereco &&
        !temPj &&
        !temPagamento &&
        !temDiversidade && (
          <div className="md:col-span-2 rounded-2xl border border-dashed border-border bg-muted/30 p-8 text-center">
            <p className="text-sm text-muted-foreground">
              Nenhum dado adicional cadastrado.
            </p>
            {podeEditar && (
              <p className="text-xs text-muted-foreground/80 mt-1">
                Clique em &quot;Editar&quot; no topo para completar o perfil.
              </p>
            )}
          </div>
        )}
    </div>
  );

  return (
    <div className="space-y-6">
      <BotaoVoltar reserva="/freelancers/lista" />
      <HeroFreelancer
        freelancer={freelancer}
        podeEditar={podeEditar}
        contratoAtual={heroContratoAtual}
        botaoSolicitarContrato={botaoSolicitarContrato}
      />
      <AbasPerfil
        dados={dadosPessoais}
        contratos={abaContratos}
        historico={<HistoricoContratoTimeline historico={historico} />}
      />
    </div>
  );
}
