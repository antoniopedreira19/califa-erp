import { requireSession } from "@/lib/auth/session";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import type {
  Colaborador,
  ColaboradorDocumento,
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
import { CardBeneficios } from "./card-beneficios";
import { QuadroNf } from "./_components/quadro-nf";
import { CardDocumentos } from "./card-documentos";
import { CardMinhasFerias } from "./card-minhas-ferias";
import { CardMinhaEquipe } from "./card-minha-equipe";
import { BotaoEditarPerfilCompleto } from "./botao-editar-perfil-completo";
import { temLiderados } from "@/lib/equipe/tem-liderados";
import type { NfPendenteQuadro } from "@/lib/types";

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

  // "Minha equipe" (ex-página /equipe): só aparece pra quem é líder de ao
  // menos 1 colaborador. Checagem roda pros dois branches (colab + enxuto)
  // porque admin/rh sem colab próprio ainda pode ser líder de alguém.
  const souLider = await temLiderados(
    supabase,
    session.profile.id,
    session.activeTenant.id,
  );

  // Branch: usuário SEM colaborador vinculado — perfil enxuto.
  if (!colab) {
    // Se é líder, mesmo sem colab próprio, mostramos o card no lado direito.
    // Contagem de pedidos aguardando: só consultamos se é líder.
    const aguardandoVoce = souLider
      ? (
          await supabase
            .from("colaboradores_ferias_lancamentos")
            .select("id", { count: "exact", head: true })
            .eq("status", "aguardando_gestor")
        ).count ?? 0
      : 0;
    const liderados = souLider
      ? (
          await supabase
            .from("vw_equipe_do_lider")
            .select("colaborador_id", { count: "exact", head: true })
        ).count ?? 0
      : 0;

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
            {souLider && (
              <CardMinhaEquipe
                liderados={liderados}
                aguardandoVoce={aguardandoVoce}
              />
            )}
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
    membershipRes,
    resumoBeneficios,
    { data: linhasNfData },
    { data: documentosData },
    equipeCountRes,
    aguardandoCountRes,
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
    // Quadro de NFs: todas as linhas da view filtradas por colaborador.
    supabase
      .from("vw_nf_pendentes_colaborador")
      .select("*")
      .eq("tenant_id", session.activeTenant.id)
      .eq("colaborador_id", colab.id)
      .order("competencia_ano", { ascending: false })
      .order("competencia_mes", { ascending: false }),
    // Documentos pessoais (wizard de boas-vindas + edição posterior).
    supabase
      .from("colaboradores_documentos")
      .select("*")
      .eq("tenant_id", session.activeTenant.id)
      .eq("colaborador_id", colab.id)
      .order("uploaded_at", { ascending: false }),
    // Cards "Minha equipe" (só renderiza quando `souLider`). RLS em
    // `vw_equipe_do_lider` e `*_lider_select` já filtra por `auth.uid()`.
    souLider
      ? supabase
          .from("vw_equipe_do_lider")
          .select("colaborador_id", { count: "exact", head: true })
      : Promise.resolve({ count: 0 }),
    souLider
      ? supabase
          .from("colaboradores_ferias_lancamentos")
          .select("id", { count: "exact", head: true })
          .eq("status", "aguardando_gestor")
      : Promise.resolve({ count: 0 }),
  ]);

  const linhasQuadro = (linhasNfData ?? []) as NfPendenteQuadro[];

  const periodos = (periodosData ?? []) as ColaboradorFeriasPeriodo[];
  const lancamentos = (lancamentosData ?? []) as ColaboradorFeriasLancamento[];

  const membership = membershipRes.data as
    | { role: AppRole; status: "ativo" | "inativo" }
    | null;
  const roleReal = membership?.role ?? (session.activeRole as AppRole);
  const statusMembership = membership?.status ?? "ativo";

  const nLiderados = equipeCountRes.count ?? 0;
  const nAguardando = aguardandoCountRes.count ?? 0;

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <HeroPerfil
        nome={colab.nome}
        email={colab.email ?? session.profile.email ?? ""}
        role={roleReal}
        tipoContratacao={colab.tipo_contratacao}
        funcao={colab.funcao}
        dataAdmissao={colab.data_admissao}
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
          <QuadroNf
            colaboradorId={colab.id}
            tipoContratacao={colab.tipo_contratacao}
            linhas={linhasQuadro}
            alocacaoResumo={null}
          />
          {!ehSocio && (
            <CardMinhasFerias
              periodos={periodos}
              lancamentos={lancamentos}
              tipoContratacao={colab.tipo_contratacao}
            />
          )}
        </div>

        {/* Coluna lateral (direita, 320px fixo em desktop) */}
        <div className="space-y-5">
          <CardAcessoUsuario
            role={roleReal}
            statusMembership={statusMembership}
            lastSignIn={acesso?.last_sign_in_at ?? null}
          />
          {souLider && (
            <CardMinhaEquipe
              liderados={nLiderados}
              aguardandoVoce={nAguardando}
            />
          )}
          <CardBeneficios resumo={resumoBeneficios} />
          {colab.tipo_contratacao !== "socio" && (
            <CardDocumentos
              colaboradorId={colab.id}
              tenantId={session.activeTenant.id}
              tipoContratacao={colab.tipo_contratacao}
              documentos={(documentosData ?? []) as ColaboradorDocumento[]}
            />
          )}
          {colab.tipo_contratacao !== "socio" && (
            <div className="rounded-2xl border border-border bg-white p-5 shadow-soft">
              <h3 className="text-xs font-bold uppercase tracking-[0.08em] text-foreground mb-3">
                Perfil completo
              </h3>
              <p className="text-[11px] text-muted-foreground mb-3">
                {colab.perfil_completado_em
                  ? "Seus dados pessoais, documentos e preferências."
                  : "Você ainda não completou seu perfil — abra pra terminar."}
              </p>
              <BotaoEditarPerfilCompleto />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
