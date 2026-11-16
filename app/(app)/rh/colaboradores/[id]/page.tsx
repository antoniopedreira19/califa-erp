import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { buscarAlocacaoVigente } from "@/lib/alocacao/montar-snapshot";
import type {
  Colaborador,
  ColaboradorAlocacao,
  ColaboradorFeriasPeriodo,
  ColaboradorSalario,
  Empresa,
  FeriasPeriodoStatus,
  Nivel,
} from "@/lib/types";
import { CardDados } from "./card-dados";
import { CardAlocacoes } from "./card-alocacoes";
import { CardSalarios } from "./card-salarios";
import {
  CardDecimoTerceiro,
  type HistoricoDecimoTerceiro,
} from "./card-decimo-terceiro";
import { CardDadosBancarios } from "./card-dados-bancarios";
import { CardNfColaborador } from "./_components/card-nf-colaborador";
import { CardAcesso } from "./card-acesso";
import { BannerPendencias } from "./banner-pendencias";
import { HeroColaborador } from "./_components/hero-colaborador";
import { AbasPerfil } from "./_components/abas-perfil";
import {
  CardFerias,
  type FeriasPeriodoResumo,
} from "./_components/card-ferias";
import { CardFolha, type FolhaRecente } from "./_components/card-folha";
import { CardRescisao } from "./_components/card-rescisao";
import { CardDocumentos } from "./_components/card-documentos";
import { carregarAcessoColaborador } from "@/lib/auth/acesso-colaborador";
import { createServiceClient } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/types";
import {
  avaliarPendencias,
  separarPendenciasPorCard,
} from "@/lib/rh/pendencias";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";

export const dynamic = "force-dynamic";

export default async function ColaboradorDetalhePage({
  params,
}: {
  params: { id: string };
}) {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "rh") {
    redirect("/home?reason=sem_permissao_rh");
  }

  const supabase = createClient();

  const anoRateio = new Date().getFullYear();
  const hojeNf = new Date();
  const anoNfVigente = hojeNf.getFullYear();
  const mesNfVigente = hojeNf.getMonth() + 1;
  const [
    colabRes,
    alocacoesRes,
    salariosRes,
    empresasRes,
    regionaisRes,
    niveisRes,
    rateiosRes,
    lideresRes,
    nfVigenteRes,
    folhasAbertasPjRes,
    nfsExistentesRes,
    historico13Res,
    periodosFeriasRes,
    folhasRecentesRes,
  ] = await Promise.all([
    supabase
      .from("colaboradores")
      .select("*, nivel:niveis(id, codigo, descricao), lider:profiles!lider_id(id, nome)")
      .eq("id", params.id)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle(),
    supabase
      .from("colaboradores_alocacoes")
      .select(
        "*, empresa:empresas(id, nome_fantasia), regional:regionais!colaboradores_alocacoes_regional_id_fkey(id, nome)",
      )
      .eq("colaborador_id", params.id)
      .eq("tenant_id", session.activeTenant.id)
      .order("data_inicio", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("colaboradores_salarios")
      .select("*")
      .eq("colaborador_id", params.id)
      .eq("tenant_id", session.activeTenant.id)
      .order("data_inicio", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("empresas")
      .select("id, nome_fantasia")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("nome_fantasia"),
    supabase
      .from("regionais")
      .select("id, nome, empresa_id")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("nome"),
    supabase
      .from("niveis")
      .select("id, codigo, descricao")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true),
    supabase
      .from("empresas_rateios_regionais")
      .select("empresa_id, percentual, regional:regionais(id, nome)")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ano_vigencia", anoRateio),
    supabase
      .from("tenant_members")
      .select("user_id")
      .eq("tenant_id", session.activeTenant.id)
      .eq("status", "ativo"),
    supabase
      .from("colaboradores_nf_anexos")
      .select("id, arquivo_nome, uploaded_at")
      .eq("tenant_id", session.activeTenant.id)
      .eq("colaborador_id", params.id)
      .eq("competencia_ano", anoNfVigente)
      .eq("competencia_mes", mesNfVigente)
      .maybeSingle(),
    supabase
      .from("folhas_pagamento")
      .select("competencia_ano, competencia_mes")
      .eq("tenant_id", session.activeTenant.id)
      .eq("colaborador_id", params.id)
      .eq("origem", "california")
      .in("status", ["rascunho", "enviada", "aprovada", "pendente_correcao"]),
    supabase
      .from("colaboradores_nf_anexos")
      .select("competencia_ano, competencia_mes")
      .eq("tenant_id", session.activeTenant.id)
      .eq("colaborador_id", params.id),
    supabase
      .from("decimo_terceiro_linhas")
      .select(
        `avos, total_bruto, total_adiantado, total_liquido,
         folha:decimo_terceiro_folhas!decimo_terceiro_linhas_folha_id_fkey(ano, status)`,
      )
      .eq("tenant_id", session.activeTenant.id)
      .eq("colaborador_id", params.id),
    // Períodos aquisitivos de férias — base pro CardFerias.
    supabase
      .from("colaboradores_ferias_periodos")
      .select(
        "id, numero, aquisitivo_inicio, aquisitivo_fim, concessivo_fim, dias_direito, status",
      )
      .eq("colaborador_id", params.id)
      .eq("tenant_id", session.activeTenant.id)
      .order("numero", { ascending: true }),
    // Últimas folhas de pagamento do colaborador (todas as origens). Limite
    // mais largo que o display pra permitir pareamento CLT+RECIBO abaixo.
    supabase
      .from("folhas_pagamento")
      .select(
        "id, competencia_ano, competencia_mes, tipo, status, salario_base, origem",
      )
      .eq("tenant_id", session.activeTenant.id)
      .eq("colaborador_id", params.id)
      .order("competencia_ano", { ascending: false })
      .order("competencia_mes", { ascending: false })
      .limit(16),
  ]);

  if (!colabRes.data) {
    notFound();
  }

  const colab = colabRes.data as unknown as Colaborador & {
    nivel: Pick<Nivel, "id" | "codigo" | "descricao"> | null;
    lider: { id: string; nome: string } | null;
  };

  const alocacoes = (alocacoesRes.data ?? []) as (ColaboradorAlocacao & {
    empresa: Pick<Empresa, "id" | "nome_fantasia">;
    regional: { id: string; nome: string } | null;
  })[];

  const snapshotAlocacaoVigente = await buscarAlocacaoVigente(
    supabase,
    colab.id,
    session.activeTenant.id,
  );

  const nfsExistentesChaves = new Set(
    (nfsExistentesRes.data ?? []).map(
      (n) => `${n.competencia_ano}-${n.competencia_mes}`,
    ),
  );
  const backlogNfPendente = (folhasAbertasPjRes.data ?? [])
    .filter((f) => {
      const chave = `${f.competencia_ano}-${f.competencia_mes}`;
      const anteriorAoVigente =
        f.competencia_ano < anoNfVigente ||
        (f.competencia_ano === anoNfVigente && f.competencia_mes < mesNfVigente);
      return anteriorAoVigente && !nfsExistentesChaves.has(chave);
    })
    .map((f) => ({ ano: f.competencia_ano, mes: f.competencia_mes }));

  const rateiosDoAno = (() => {
    const mapa = new Map<
      string,
      { regional_id: string; regional_nome: string; percentual: number }[]
    >();
    for (const r of ((rateiosRes.data ?? []) as any[])) {
      if (!r.regional) continue;
      const lista = mapa.get(r.empresa_id) ?? [];
      lista.push({
        regional_id: r.regional.id,
        regional_nome: r.regional.nome,
        percentual: Number(r.percentual),
      });
      mapa.set(r.empresa_id, lista);
    }
    return Array.from(mapa.entries()).map(([empresa_id, regionais]) => ({
      empresa_id,
      regionais: regionais.sort((a, b) =>
        a.regional_nome.localeCompare(b.regional_nome, "pt-BR"),
      ),
    }));
  })();

  const salarios = (salariosRes.data ?? []) as ColaboradorSalario[];

  type Historico13Raw = {
    avos: number;
    total_bruto: string;
    total_adiantado: string;
    total_liquido: string;
    folha:
      | { ano: number; status: string }
      | { ano: number; status: string }[]
      | null;
  };
  const historicoDecimoTerceiro: HistoricoDecimoTerceiro[] = (
    (historico13Res.data ?? []) as Historico13Raw[]
  )
    .map((r) => {
      const f = Array.isArray(r.folha) ? r.folha[0] : r.folha;
      return f
        ? {
            ano: f.ano,
            avos: r.avos,
            total_bruto: Number(r.total_bruto),
            total_adiantado: Number(r.total_adiantado),
            total_liquido: Number(r.total_liquido),
            status_folha: f.status,
          }
        : null;
    })
    .filter((x): x is HistoricoDecimoTerceiro => x !== null)
    .sort((a, b) => b.ano - a.ano);

  // Períodos de férias → resumo com dias restantes até concessivo_fim.
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  type PeriodoRaw = Pick<
    ColaboradorFeriasPeriodo,
    | "id"
    | "numero"
    | "aquisitivo_inicio"
    | "aquisitivo_fim"
    | "concessivo_fim"
    | "dias_direito"
    | "status"
  >;
  const periodosFerias: FeriasPeriodoResumo[] = (
    (periodosFeriasRes.data ?? []) as PeriodoRaw[]
  ).map((p) => {
    const fim = new Date(p.concessivo_fim + "T00:00:00");
    const diasRestantes = Math.max(
      0,
      Math.floor((fim.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24)),
    );
    return {
      id: p.id,
      numero: p.numero,
      aquisitivo_inicio: p.aquisitivo_inicio,
      aquisitivo_fim: p.aquisitivo_fim,
      concessivo_fim: p.concessivo_fim,
      status: p.status,
      dias_restantes: diasRestantes,
    };
  });

  // Saldo = dias_direito dos períodos "apto" ou "em_alerta" (simplificado;
  // o módulo de férias usa o cálculo completo com lançamentos. Aqui é só uma
  // sinalização rápida pra visão do colaborador).
  const STATUS_SALDO: FeriasPeriodoStatus[] = ["apto", "em_alerta"];
  const diasDisponiveis = (
    (periodosFeriasRes.data ?? []) as PeriodoRaw[]
  )
    .filter((p) => STATUS_SALDO.includes(p.status))
    .reduce((acc, p) => acc + (p.dias_direito ?? 0), 0);

  const folhasRaw = (
    (folhasRecentesRes.data ?? []) as {
      id: string;
      competencia_ano: number;
      competencia_mes: number;
      tipo: string;
      status: string;
      salario_base: string | number;
      origem: "california" | "contabilidade";
    }[]
  ).map((f) => ({
    id: f.id,
    competencia_ano: f.competencia_ano,
    competencia_mes: f.competencia_mes,
    tipo: f.tipo,
    status: f.status,
    salario_base: Number(f.salario_base),
    origem: f.origem,
  }));

  // Pra CLT+RECIBO, toda competência deveria ter 2 folhas: uma california
  // (Recibo) e uma contabilidade (CLT importada do PDF). Quando só existe
  // a california, sintetiza uma linha fantasma "Aguardando contabilidade"
  // pra deixar visível que o fechamento daquela competência ainda está
  // pela metade. Só vale pra tipo='salario' — férias e 13º têm fluxo próprio.
  const folhasRecentes: FolhaRecente[] = (() => {
    const isCltRecibo = colab.tipo_contratacao === "clt_recibo";
    if (!isCltRecibo) return folhasRaw.slice(0, 8);

    const chaveCompetencia = (ano: number, mes: number) =>
      `${ano}-${String(mes).padStart(2, "0")}`;
    const temContabilidadeSalario = new Set(
      folhasRaw
        .filter((f) => f.tipo === "salario" && f.origem === "contabilidade")
        .map((f) => chaveCompetencia(f.competencia_ano, f.competencia_mes)),
    );

    const resultado: FolhaRecente[] = [];
    for (const f of folhasRaw) {
      resultado.push(f);
      const precisaGhost =
        f.tipo === "salario" &&
        f.origem === "california" &&
        !temContabilidadeSalario.has(
          chaveCompetencia(f.competencia_ano, f.competencia_mes),
        );
      if (precisaGhost) {
        resultado.push({
          id: `ghost-${f.id}`,
          competencia_ano: f.competencia_ano,
          competencia_mes: f.competencia_mes,
          tipo: "salario",
          status: "aguardando",
          salario_base: 0,
          origem: "contabilidade",
          aguardando: true,
        });
      }
    }
    return resultado.slice(0, 8);
  })();

  const empresas = (empresasRes.data ?? []) as Pick<
    Empresa,
    "id" | "nome_fantasia"
  >[];
  const regionais = (regionaisRes.data ?? []) as {
    id: string;
    nome: string;
    empresa_id: string;
  }[];
  const niveis = ((niveisRes.data ?? []) as Pick<
    Nivel,
    "id" | "codigo" | "descricao"
  >[])
    .slice()
    .sort((a, b) => a.codigo.localeCompare(b.codigo, "pt-BR"));

  const memberIds = ((lideresRes.data ?? []) as { user_id: string }[]).map(
    (m) => m.user_id,
  );
  const lideresRawRes =
    memberIds.length > 0
      ? await supabase
          .from("profiles")
          .select("id, nome")
          .in("id", memberIds)
      : { data: [] as { id: string; nome: string }[] };
  const lideres = ((lideresRawRes.data ?? []) as { id: string; nome: string }[])
    .slice()
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  const isAdmin = session.activeRole === "administrador";

  const pendencias = avaliarPendencias({
    colaborador: {
      tipo_contratacao: colab.tipo_contratacao,
      cpf: colab.cpf,
      cnpj: colab.cnpj,
      email: colab.email,
      telefone: colab.telefone,
      nivel_id: colab.nivel_id,
      data_nascimento: colab.data_nascimento,
      area: colab.area,
      banco_codigo: colab.banco_codigo,
      agencia: colab.agencia,
      conta: colab.conta,
      conta_dv: colab.conta_dv,
      tipo_conta: colab.tipo_conta,
      pix_chave: colab.pix_chave,
    },
    temSalarioVigente: salarios.some((s) => s.data_fim === null),
    temAlocacaoVigente: alocacoes.some((a) => a.data_fim === null),
  });
  const pendenciasPorCard = separarPendenciasPorCard(pendencias);

  let acesso = null;
  let roleAtual: AppRole | null = null;
  let profileNome: string | null = null;
  if (colab.user_id) {
    const service = createServiceClient();
    const [acessoRes, membershipRes, profileRes] = await Promise.all([
      carregarAcessoColaborador(colab.user_id),
      service
        .from("tenant_members")
        .select("role")
        .eq("tenant_id", session.activeTenant.id)
        .eq("user_id", colab.user_id)
        .maybeSingle(),
      service
        .from("profiles")
        .select("nome")
        .eq("id", colab.user_id)
        .maybeSingle(),
    ]);
    acesso = acessoRes;
    roleAtual =
      (membershipRes.data?.role as AppRole | undefined) ?? null;
    profileNome = (profileRes.data?.nome as string | null | undefined) ?? null;
  }

  // Empresa/regional vigentes pro Hero (primeira alocação sem data_fim).
  const alocacaoVigente = alocacoes.find((a) => a.data_fim === null) ?? null;
  const empresaPrincipal = alocacaoVigente?.empresa?.nome_fantasia ?? null;
  const regionalPrincipal = alocacaoVigente?.regional?.nome ?? null;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <BotaoVoltar reserva="/rh/colaboradores" />

      <HeroColaborador
        colaborador={colab}
        empresaPrincipal={empresaPrincipal}
        regionalPrincipal={regionalPrincipal}
      />

      <BannerPendencias pendencias={pendencias} />

      <AbasPerfil
        dados={
          <div className="grid gap-4">
            <CardDados
              colaborador={colab}
              empresas={empresas}
              regionais={regionais}
              niveis={niveis}
              lideres={lideres}
              pendencia={pendenciasPorCard.dados}
            />
            <CardDadosBancarios
              colaborador={colab}
              pendencia={pendenciasPorCard.bancario}
            />
            <CardAlocacoes
              colaboradorId={colab.id}
              alocacoes={alocacoes}
              empresas={empresas}
              regionais={regionais}
              rateiosDoAno={rateiosDoAno}
              anoRateio={anoRateio}
              pendencia={pendenciasPorCard.alocacao}
              snapshotVigente={snapshotAlocacaoVigente}
            />
          </div>
        }
        acesso={
          <CardAcesso
            colaborador={{
              id: colab.id,
              nome: colab.nome,
              email: colab.email,
              user_id: colab.user_id,
            }}
            acesso={acesso}
            roleAtual={roleAtual}
            profileNome={profileNome}
          />
        }
        documentos={<CardDocumentos tipoContratacao={colab.tipo_contratacao} />}
        financeiro={
          <div className="grid gap-4">
            <CardSalarios
              colaboradorId={colab.id}
              tipoContratacao={colab.tipo_contratacao}
              salarios={salarios}
              isAdmin={isAdmin}
              pendencia={pendenciasPorCard.salario}
            />
            <div className="grid gap-4 lg:grid-cols-2">
              <CardFerias
                colaboradorId={colab.id}
                periodos={periodosFerias}
                diasDisponiveis={diasDisponiveis}
              />
              <CardFolha folhas={folhasRecentes} />
            </div>
            <CardDecimoTerceiro historico={historicoDecimoTerceiro} />
            <CardNfColaborador
              colaboradorId={colab.id}
              tipoContratacao={colab.tipo_contratacao}
              nfVigente={nfVigenteRes.data ?? null}
              backlog={backlogNfPendente}
              anoVigente={anoNfVigente}
              mesVigente={mesNfVigente}
            />
            <CardRescisao dataEncerramento={colab.data_encerramento} />
          </div>
        }
      />
    </div>
  );
}
