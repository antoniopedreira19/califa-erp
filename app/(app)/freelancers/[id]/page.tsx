import { notFound } from "next/navigation";
import {
  Mail,
  MapPin,
  CreditCard,
  Building2,
  Heart,
} from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Freelancer, FreelancerContrato } from "@/lib/types";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";
import { HeroFreelancer } from "../_components/hero-freelancer";
import { AbasPerfil } from "../_components/abas-perfil";
import { BlocoInfo, Linha } from "../_components/bloco-info";
import { ContratosDoFreelancer } from "../contratos/_components/contratos-do-freelancer";
import { HistoricoContratoTimeline } from "../_components/historico-contrato-timeline";
import { formatCnpj, formatCep, formatTelefone } from "@/lib/utils";

export const dynamic = "force-dynamic";

const PODE_EDITAR = new Set(["administrador", "rh", "financeiro"]);

export default async function FreelancerPerfilPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await requireSession();
  const supabase = createClient();

  const [freelancerRes, contratosRes, historicoRes] = await Promise.all([
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

  const podeEditar = PODE_EDITAR.has(session.activeRole);
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
      <HeroFreelancer freelancer={freelancer} podeEditar={podeEditar} />
      <AbasPerfil
        dados={dadosPessoais}
        contratos={
          <ContratosDoFreelancer
            freelancerId={freelancer.id}
            contratos={contratos}
            podeCriar={podeEditar}
          />
        }
        historico={<HistoricoContratoTimeline historico={historico} />}
      />
    </div>
  );
}
