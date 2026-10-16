import { notFound } from "next/navigation";
import {
  Mail,
  Phone,
  MapPin,
  CreditCard,
  Building2,
  Heart,
} from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Freelancer } from "@/lib/types";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";
import { HeroFreelancer } from "../_components/hero-freelancer";
import { AbasPerfil } from "../_components/abas-perfil";
import { BlocoInfo, Linha } from "../_components/bloco-info";
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

  const { data, error } = await supabase
    .from("freelancers")
    .select("*")
    .eq("id", params.id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();
  const freelancer = data as Freelancer | null;

  if (error) {
    console.error("[freelancer.perfil]", error.message);
  }
  if (!freelancer) {
    notFound();
  }

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
      <AbasPerfil dados={dadosPessoais} />
    </div>
  );
}
