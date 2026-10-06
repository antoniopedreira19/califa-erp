import { requireSession } from "@/lib/auth/session";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import type {
  Colaborador,
  ColaboradorFeriasPeriodo,
  ColaboradorFeriasLancamento,
  Nivel,
  AppRole,
} from "@/lib/types";
import { carregarAcessoColaborador } from "@/lib/auth/acesso-colaborador";
import { resumoBeneficiosDoColaborador } from "@/lib/queries/beneficios";
import { HeroPerfil } from "./hero-perfil";
import { CardDadosPessoais } from "./card-dados-pessoais";
import { CardDadosBancarios } from "./card-dados-bancarios";
import { CardAcessoUsuario } from "./card-acesso-usuario";
import { CardAlocacaoAtual } from "./card-alocacao-atual";
import { CardBeneficios } from "./card-beneficios";
import { CardNotaFiscal } from "./card-nota-fiscal";
import { CardDocumentos } from "./card-documentos";
import { CardMinhasFerias } from "./card-minhas-ferias";

export const dynamic = "force-dynamic";

export default async function PerfilPage() {
  const session = await requireSession();
  const supabase = createClient();

  // Carrega colab vinculado ao usuário logado. Pode ser null pra admin/rh
  // que ainda não tem cadastro de colaborador — mostramos uma versão
  // enxuta do perfil só com o hero + acesso ao sistema.
  const { data: colabData } = await supabase
    .from("colaboradores")
    .select(
      "*, nivel:niveis(id, codigo, descricao), lider:profiles!lider_id(id, nome)",
    )
    .eq("user_id", session.profile.id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  const colab = colabData as unknown as
    | (Colaborador & {
        nivel: Pick<Nivel, "id" | "codigo" | "descricao"> | null;
        lider: { id: string; nome: string } | null;
      })
    | null;

  // Dados de acesso (auth.users) só precisam de service client.
  const acesso = await carregarAcessoColaborador(session.profile.id);

  // Branch: usuário SEM colaborador vinculado — perfil enxuto.
  if (!colab) {
    return (
      <div className="space-y-6 max-w-6xl mx-auto">
        <HeroPerfil
          nome={session.profile.nome}
          email={session.profile.email ?? ""}
          role={session.activeRole as AppRole}
          colaboradorEditavel={null}
        />

        <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
            <h2 className="text-sm font-semibold text-amber-900">
              Seu login ainda não está vinculado a um cadastro de colaborador.
            </h2>
            <p className="mt-2 text-sm text-amber-800">
              Por isso, dados pessoais, bancários, férias e documentos não
              aparecem aqui. Se você acredita que isso é um erro, procure o
              RH para fazer o vínculo.
            </p>
          </div>

          <div className="space-y-5">
            <CardAcessoUsuario
              role={session.activeRole as AppRole}
              statusMembership="ativo"
              lastSignIn={acesso?.last_sign_in_at ?? null}
            />
          </div>
        </div>
      </div>
    );
  }

  // Dados específicos do colaborador — rodam em paralelo quando possível.
  const ehSocio = colab.tipo_contratacao === "socio";
  const service = createServiceClient();

  const hoje = new Date();
  const anoAtual = hoje.getFullYear();
  const mesAtual = hoje.getMonth() + 1;

  const [
    { data: periodosData },
    { data: lancamentosData },
    { data: alocacoesData },
    membershipRes,
    resumoBeneficios,
  ] = await Promise.all([
    ehSocio
      ? Promise.resolve({ data: [] })
      : supabase
          .from("colaboradores_ferias_periodos")
          .select("*")
          .eq("colaborador_id", colab.id)
          .order("numero", { ascending: true }),
    ehSocio
      ? Promise.resolve({ data: [] })
      : supabase
          .from("colaboradores_ferias_lancamentos")
          .select("*")
          .eq("colaborador_id", colab.id)
          .order("data_inicio", { ascending: false }),
    supabase
      .from("colaboradores_alocacoes")
      .select(
        "percentual, empresa:empresas(id, nome_fantasia), regional:regionais!colaboradores_alocacoes_regional_id_fkey(id, nome)",
      )
      .eq("colaborador_id", colab.id)
      .is("data_fim", null),
    service
      .from("tenant_members")
      .select("role, status")
      .eq("tenant_id", session.activeTenant.id)
      .eq("user_id", session.profile.id)
      .maybeSingle(),
    ehSocio
      ? Promise.resolve(null)
      : resumoBeneficiosDoColaborador({
          tenantId: session.activeTenant.id,
          colaboradorId: colab.id,
          ano: anoAtual,
          mes: mesAtual,
        }),
  ]);

  const periodos = (periodosData ?? []) as ColaboradorFeriasPeriodo[];
  const lancamentos = (lancamentosData ?? []) as ColaboradorFeriasLancamento[];
  const alocacoes = (alocacoesData ?? []).map((a) => {
    const emp = a.empresa as unknown as { nome_fantasia: string } | null;
    const reg = a.regional as unknown as { nome: string } | null;
    return {
      empresa_nome: emp?.nome_fantasia ?? "—",
      regional_nome: reg?.nome ?? null,
      percentual: a.percentual ? Number(a.percentual) : null,
    };
  });

  const membership = membershipRes.data as
    | { role: AppRole; status: "ativo" | "inativo" }
    | null;
  const roleReal = membership?.role ?? (session.activeRole as AppRole);
  const statusMembership = membership?.status ?? "ativo";

  const empresaPrincipal =
    alocacoes[0]?.empresa_nome ?? null;

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <HeroPerfil
        nome={colab.nome}
        email={colab.email ?? session.profile.email ?? ""}
        role={roleReal}
        tipoContratacao={colab.tipo_contratacao}
        funcao={colab.funcao}
        dataAdmissao={colab.data_admissao}
        empresaPrincipal={empresaPrincipal}
        colaboradorEditavel={{
          telefone: colab.telefone,
          email_pessoal: colab.email_pessoal,
          cep: colab.cep,
          logradouro: colab.logradouro,
          numero: colab.numero,
          complemento: colab.complemento,
          bairro: colab.bairro,
          cidade: colab.cidade,
          uf: colab.uf,
          banco_codigo: colab.banco_codigo,
          banco_nome: colab.banco_nome,
          agencia: colab.agencia,
          agencia_dv: colab.agencia_dv,
          conta: colab.conta,
          conta_dv: colab.conta_dv,
          tipo_conta: colab.tipo_conta,
          pix_tipo: colab.pix_tipo,
          pix_chave: colab.pix_chave,
        }}
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        {/* Coluna principal (esquerda) */}
        <div className="space-y-5 min-w-0">
          <CardDadosPessoais colaborador={colab} />
          <CardDadosBancarios colaborador={colab} />
          {!ehSocio && (
            <CardMinhasFerias
              periodos={periodos}
              lancamentos={lancamentos}
              tipoContratacao={colab.tipo_contratacao}
            />
          )}
          <CardNotaFiscal tipoContratacao={colab.tipo_contratacao} />
        </div>

        {/* Coluna lateral (direita, 320px fixo em desktop) */}
        <div className="space-y-5">
          <CardAcessoUsuario
            role={roleReal}
            statusMembership={statusMembership}
            lastSignIn={acesso?.last_sign_in_at ?? null}
          />
          <CardAlocacaoAtual
            alocacoes={alocacoes}
            liderNome={colab.lider?.nome ?? null}
            area={colab.area}
            nivel={colab.nivel}
          />
          <CardBeneficios resumo={resumoBeneficios} />
          <CardDocumentos />
        </div>
      </div>
    </div>
  );
}
