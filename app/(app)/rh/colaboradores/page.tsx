import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Users,
  Plus,
  UserPlus,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  UserCheck,
} from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/empty-state";
import {
  ColaboradoresList,
  type ColaboradorRow,
  type EmpresaOpcao,
  type RegionalOpcao,
} from "./colaboradores-list";
import { CardCustoQuadro } from "./card-custo-quadro";
import { avaliarPendencias } from "@/lib/rh/pendencias";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";

export const dynamic = "force-dynamic";

const NOMES_MES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

function competenciaAnterior(ano: number, mes: number): { ano: number; mes: number } {
  if (mes === 1) return { ano: ano - 1, mes: 12 };
  return { ano, mes: mes - 1 };
}

function janelaDoMes(ano: number, mes: number): { inicio: string; fim: string } {
  const inicio = `${ano}-${String(mes).padStart(2, "0")}-01`;
  const ultimoDia = new Date(ano, mes, 0).getDate();
  const fim = `${ano}-${String(mes).padStart(2, "0")}-${String(ultimoDia).padStart(2, "0")}`;
  return { inicio, fim };
}

export default async function ColaboradoresPage() {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "rh") {
    redirect("/home?reason=sem_permissao_rh");
  }

  const supabase = createClient();

  const agora = new Date();
  const anoAtual = agora.getFullYear();
  const mesAtual = agora.getMonth() + 1;
  const prev = competenciaAnterior(anoAtual, mesAtual);

  const jAtual = janelaDoMes(anoAtual, mesAtual);
  const jPrev = janelaDoMes(prev.ano, prev.mes);

  // Colaboradores + salários vigentes + alocações vigentes + agregados em
  // paralelo — docs/PERFORMANCE.md §B. Salário e alocação vigentes vêm
  // separadamente pra não gerar embed pesado e pra permitir filtrar
  // `data_fim is null` cirurgicamente.
  //
  // Modelo multi-empresa (2026-10-28): a alocação vigente agora é um pacote
  // com N itens em colaboradores_alocacoes_itens. Buscamos:
  //   1) pacotes vigentes (data_fim IS NULL) → ids + colaborador_id
  //   2) itens desses pacotes → empresa_id, percentual, usa_rateio
  //   3) regionais primárias dos itens → regional_id, percentual
  // As 3 queries de alocação rodam sequencialmente (cada uma depende dos
  // IDs anteriores). As demais queries continuam em Promise.all.
  const [
    colaboradoresRes,
    salariosVigentesRes,
    pacotesVigentesRes,
    empresasRes,
    regionaisRes,
    niveisRes,
    ativosCountRes,
    admissoesMesRes,
    admissoesPrevMesRes,
    demissoesMesRes,
    demissoesPrevMesRes,
  ] = await Promise.all([
    supabase
      .from("colaboradores")
      .select(
        "id, nome, tipo_contratacao, funcao, status, data_admissao, data_encerramento, cpf, cnpj, email, telefone, nivel_id, data_nascimento, area, banco_codigo, agencia, conta, conta_dv, tipo_conta, pix_chave, nivel:niveis(id, codigo)",
      )
      .eq("tenant_id", session.activeTenant.id)
      .order("nome", { ascending: true }),
    supabase
      .from("colaboradores_salarios")
      .select("colaborador_id, valor")
      .eq("tenant_id", session.activeTenant.id)
      .is("data_fim", null),
    // Pacotes vigentes: apenas id + colaborador_id para lookup.
    // Itens e regionais são buscados sequencialmente depois (dependem
    // dos pacote IDs).
    supabase
      .from("colaboradores_alocacoes")
      .select("id, colaborador_id")
      .eq("tenant_id", session.activeTenant.id)
      .is("data_fim", null),
    supabase
      .from("empresas")
      .select("id, nome_fantasia")
      .eq("tenant_id", session.activeTenant.id)
      .order("nome_fantasia", { ascending: true }),
    supabase
      .from("regionais")
      .select("id, nome, empresa_id")
      .eq("tenant_id", session.activeTenant.id)
      .order("nome", { ascending: true }),
    supabase
      .from("niveis")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true),
    supabase
      .from("colaboradores")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", session.activeTenant.id)
      .eq("status", "ativo"),
    supabase
      .from("colaboradores")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", session.activeTenant.id)
      .gte("data_admissao", jAtual.inicio)
      .lte("data_admissao", jAtual.fim),
    supabase
      .from("colaboradores")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", session.activeTenant.id)
      .gte("data_admissao", jPrev.inicio)
      .lte("data_admissao", jPrev.fim),
    supabase
      .from("colaboradores")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", session.activeTenant.id)
      .gte("data_encerramento", jAtual.inicio)
      .lte("data_encerramento", jAtual.fim),
    supabase
      .from("colaboradores")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", session.activeTenant.id)
      .gte("data_encerramento", jPrev.inicio)
      .lte("data_encerramento", jPrev.fim),
  ]);

  if (colaboradoresRes.error) {
    console.error("[rh.colaboradores.page]", colaboradoresRes.error.message);
  }
  if (pacotesVigentesRes.error) {
    console.error("[rh.colaboradores.lista.pacotes]", pacotesVigentesRes.error.message);
  }

  // Mapa colaborador → salário vigente (BRL number).
  const salarioPorColaborador = new Map<string, number>();
  for (const s of (salariosVigentesRes.data ?? []) as {
    colaborador_id: string;
    valor: string | number;
  }[]) {
    salarioPorColaborador.set(s.colaborador_id, Number(s.valor));
  }

  // Mapas de lookup pra resolver empresa/regional das alocações.
  const empresaNomePorId = new Map<string, string>();
  for (const e of (empresasRes.data ?? []) as {
    id: string;
    nome_fantasia: string;
  }[]) {
    empresaNomePorId.set(e.id, e.nome_fantasia);
  }
  const regionalNomePorId = new Map<string, string>();
  for (const r of (regionaisRes.data ?? []) as {
    id: string;
    nome: string;
    empresa_id: string;
  }[]) {
    regionalNomePorId.set(r.id, r.nome);
  }

  // Queries sequenciais pra resolver itens e regionais da alocação multi-empresa.
  // Dependem dos pacote IDs obtidos acima.
  const pacoteIds = (pacotesVigentesRes.data ?? []).map((p) => p.id);
  const pacoteColabMap = new Map<string, string>(
    (pacotesVigentesRes.data ?? []).map((p) => [p.id, p.colaborador_id]),
  );

  const [itensAlocRes, regionaisItemRes] = await (async () => {
    if (pacoteIds.length === 0) return [{ data: [] }, { data: [] }];
    const itensRes = await supabase
      .from("colaboradores_alocacoes_itens")
      .select("id, alocacao_id, empresa_id, percentual_empresa, usa_rateio_empresa")
      .in("alocacao_id", pacoteIds)
      .eq("tenant_id", session.activeTenant.id)
      .order("percentual_empresa", { ascending: false });
    const itemIds = (itensRes.data ?? []).map((i) => i.id);
    if (itemIds.length === 0) return [itensRes, { data: [] }];
    const regRes = await supabase
      .from("colaboradores_alocacoes_itens_regionais")
      .select("alocacao_item_id, regional_id, percentual_regional")
      .in("alocacao_item_id", itemIds)
      .eq("tenant_id", session.activeTenant.id)
      .order("percentual_regional", { ascending: false });
    return [itensRes, regRes];
  })();

  // Por item_id: primeira regional (maior %)
  const regionalPorItem = new Map<string, string>();
  for (const r of (regionaisItemRes.data ?? []) as {
    alocacao_item_id: string;
    regional_id: string;
    percentual_regional: number;
  }[]) {
    if (!regionalPorItem.has(r.alocacao_item_id)) {
      regionalPorItem.set(r.alocacao_item_id, r.regional_id);
    }
  }

  // Por alocacao_id: lista de itens ordenados por percentual DESC (já vêm assim)
  const itensPorPacote = new Map<
    string,
    Array<{
      id: string;
      empresa_id: string;
      percentual_empresa: number;
      usa_rateio_empresa: boolean;
    }>
  >();
  for (const item of (itensAlocRes.data ?? []) as {
    id: string;
    alocacao_id: string;
    empresa_id: string;
    percentual_empresa: string | number;
    usa_rateio_empresa: boolean;
  }[]) {
    if (!itensPorPacote.has(item.alocacao_id)) {
      itensPorPacote.set(item.alocacao_id, []);
    }
    itensPorPacote.get(item.alocacao_id)!.push({
      id: item.id,
      empresa_id: item.empresa_id,
      percentual_empresa: Number(item.percentual_empresa),
      usa_rateio_empresa: item.usa_rateio_empresa,
    });
  }

  // Monta alocacaoPorColaborador com badge multi-empresa em empresa_nome.
  // empresa_id / regional_id / usa_rateio_empresa vêm do item primário (maior %).
  // empresa_nome: "{Emp1}" se 1 empresa, "{Emp1} + {Emp2}" se 2, "{Emp1} + N" se 3+.
  const alocacaoPorColaborador = new Map<
    string,
    {
      empresa_id: string;
      empresa_nome: string;
      regional_id: string | null;
      regional_nome: string | null;
      usa_rateio_empresa: boolean;
    }
  >();
  for (const [pacoteId, colaboradorId] of pacoteColabMap) {
    const itens = itensPorPacote.get(pacoteId);
    if (!itens || itens.length === 0) continue;
    const primario = itens[0];
    const empresaNomePrimario = empresaNomePorId.get(primario.empresa_id);
    if (!empresaNomePrimario) continue;

    // Badge de empresa: resumo compacto multi-empresa
    let empresaBadge: string;
    if (itens.length === 1) {
      empresaBadge = empresaNomePrimario;
    } else if (itens.length === 2) {
      const segundoNome = empresaNomePorId.get(itens[1].empresa_id) ?? itens[1].empresa_id;
      empresaBadge = `${empresaNomePrimario} + ${segundoNome}`;
    } else {
      empresaBadge = `${empresaNomePrimario} + ${itens.length - 1}`;
    }

    const regionalId = regionalPorItem.get(primario.id) ?? null;
    alocacaoPorColaborador.set(colaboradorId, {
      empresa_id: primario.empresa_id,
      empresa_nome: empresaBadge,
      regional_id: regionalId,
      regional_nome: regionalId ? regionalNomePorId.get(regionalId) ?? null : null,
      usa_rateio_empresa: primario.usa_rateio_empresa,
    });
  }

  const linhas: ColaboradorRow[] = ((colaboradoresRes.data ?? []) as any[]).map(
    (c) => {
      const aloc = alocacaoPorColaborador.get(c.id);
      const pendencia = avaliarPendencias({
        colaborador: {
          tipo_contratacao: c.tipo_contratacao,
          cpf: c.cpf,
          cnpj: c.cnpj,
          email: c.email,
          telefone: c.telefone,
          nivel_id: c.nivel_id,
          data_nascimento: c.data_nascimento,
          area: c.area,
          banco_codigo: c.banco_codigo,
          agencia: c.agencia,
          conta: c.conta,
          conta_dv: c.conta_dv,
          tipo_conta: c.tipo_conta,
          pix_chave: c.pix_chave,
        },
        temSalarioVigente: salarioPorColaborador.has(c.id),
        temAlocacaoVigente: alocacaoPorColaborador.has(c.id),
      });
      return {
        id: c.id,
        nome: c.nome,
        tipo_contratacao: c.tipo_contratacao,
        funcao: c.funcao,
        status: c.status,
        data_admissao: c.data_admissao,
        data_encerramento: c.data_encerramento,
        nivel_codigo: c.nivel?.codigo ?? null,
        salario_vigente: salarioPorColaborador.get(c.id) ?? null,
        empresa_id: aloc?.empresa_id ?? null,
        empresa_nome: aloc?.empresa_nome ?? null,
        regional_id: aloc?.regional_id ?? null,
        regional_nome: aloc?.regional_nome ?? null,
        usa_rateio_empresa: aloc?.usa_rateio_empresa ?? false,
        pendencia_nivel: pendencia.nivel,
        pendencia_total: pendencia.total,
        pendencia_criticas: pendencia.criticas,
        pendencia_parciais: pendencia.parciais,
      };
    },
  );

  // Opções pros filtros de empresa e regional. Empresas vêm da tabela real
  // pra cobrir também as que não têm ninguém alocado (raro, mas correto).
  const empresasOpcoes: EmpresaOpcao[] = ((empresasRes.data ?? []) as {
    id: string;
    nome_fantasia: string;
  }[]).map((e) => ({ id: e.id, nome: e.nome_fantasia }));

  const regionaisOpcoes: RegionalOpcao[] = ((regionaisRes.data ?? []) as {
    id: string;
    nome: string;
    empresa_id: string;
  }[]).map((r) => ({ id: r.id, nome: r.nome, empresa_id: r.empresa_id }));

  const niveisAtivosCount = niveisRes.count ?? 0;

  const ativosCount = ativosCountRes.count ?? 0;
  const admissoesMes = admissoesMesRes.count ?? 0;
  const admissoesPrev = admissoesPrevMesRes.count ?? 0;
  const demissoesMes = demissoesMesRes.count ?? 0;
  const demissoesPrev = demissoesPrevMesRes.count ?? 0;

  // Custo do quadro = soma dos salários vigentes de colaboradores ATIVOS.
  // Reflete o custo teórico no minuto atual, independente da folha da
  // competência ter sido gerada. Folha efetivamente rodada fica em /rh/folhas.
  const idsAtivos = new Set(
    linhas.filter((l) => l.status === "ativo").map((l) => l.id),
  );
  let custoQuadroAtivos = 0;
  let colaboradoresAtivosComSalario = 0;
  for (const [colaboradorId, salario] of salarioPorColaborador) {
    if (idsAtivos.has(colaboradorId)) {
      custoQuadroAtivos += salario;
      colaboradoresAtivosComSalario += 1;
    }
  }
  const colaboradoresAtivosSemSalario =
    idsAtivos.size - colaboradoresAtivosComSalario;

  const brl = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

  const nomeMesAnterior = `${NOMES_MES[prev.mes - 1].slice(0, 3)}/${prev.ano}`;

  // Ativos no início do mês = ativos_hoje - admissões_no_mês + demissões_no_mês.
  // Não precisa de histórico de mudanças de status — as duas datas dizem tudo.
  const ativosInicioMes = ativosCount - admissoesMes + demissoesMes;
  const deltaAtivos = ativosCount - ativosInicioMes; // = admissoesMes - demissoesMes

  return (
    <div className="space-y-6">
      <BotaoVoltar reserva="/rh" />

      <PageHeader
        title="Colaboradores"
        description="Quadro atual da agência, valor total da folha e alocação por empresa e regional. Clique em um colaborador para ver o detalhe."
        icon={Users}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icone={<UserCheck className="h-4 w-4" />}
          rotulo="Colaboradores ativos"
          valorPrincipal={String(ativosCount)}
          rodape={
            <DeltaAbsoluto
              diff={deltaAtivos}
              legenda="vs início do mês"
              zeroLabel="Sem mudança no mês"
            />
          }
        />
        <CardCustoQuadro
          valor={custoQuadroAtivos}
          colaboradoresComSalario={colaboradoresAtivosComSalario}
          colaboradoresSemSalario={colaboradoresAtivosSemSalario}
        />
        <KpiCard
          icone={<ArrowUpRight className="h-4 w-4" />}
          rotulo="Admissões no mês"
          valorPrincipal={String(admissoesMes)}
          rodape={
            <DeltaAbsoluto
              diff={admissoesMes - admissoesPrev}
              legenda={`vs ${nomeMesAnterior} (${admissoesPrev})`}
              zeroLabel={`Mesma coisa vs ${nomeMesAnterior}`}
            />
          }
          tom={admissoesMes > 0 ? "verde" : undefined}
        />
        <KpiCard
          icone={<ArrowDownRight className="h-4 w-4" />}
          rotulo="Demissões no mês"
          valorPrincipal={String(demissoesMes)}
          rodape={
            <DeltaAbsoluto
              diff={demissoesMes - demissoesPrev}
              legenda={`vs ${nomeMesAnterior} (${demissoesPrev})`}
              zeroLabel={`Mesma coisa vs ${nomeMesAnterior}`}
              // Delta positivo (mais demissões) é ruim aqui — inverte cor.
              inverterCor
            />
          }
          tom={demissoesMes > 0 ? "vermelho" : undefined}
        />
      </div>

      {linhas.length === 0 ? (
        <EmptyState
          icon={UserPlus}
          title="Nenhum colaborador cadastrado ainda"
          description="Cadastre o primeiro colaborador para começar a alimentar o quadro da agência."
          action={
            <Link
              href="/rh/colaboradores/novo"
              prefetch={false}
              className="inline-flex items-center gap-2 rounded-lg bg-california-red px-5 py-2.5 text-sm font-semibold text-white hover:bg-california-red-hover transition-colors"
            >
              <Plus className="h-4 w-4" />
              Cadastrar colaborador
            </Link>
          }
        />
      ) : (
        <ColaboradoresList
          colaboradores={linhas}
          niveisAtivosCount={niveisAtivosCount}
          empresasOpcoes={empresasOpcoes}
          regionaisOpcoes={regionaisOpcoes}
        />
      )}
    </div>
  );
}

function KpiCard({
  icone,
  rotulo,
  valorPrincipal,
  rodape,
  destaque,
  tom,
}: {
  icone: React.ReactNode;
  rotulo: string;
  valorPrincipal: string;
  rodape: React.ReactNode;
  destaque?: boolean;
  tom?: "verde" | "vermelho";
}) {
  const corValor =
    tom === "verde" && valorPrincipal !== "0"
      ? "text-emerald-700"
      : tom === "vermelho" && valorPrincipal !== "0"
        ? "text-california-red"
        : "text-foreground";
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-soft flex flex-col justify-between min-h-[128px]">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-california-red/10 text-california-red">
          {icone}
        </span>
        <span className="text-xs font-semibold uppercase tracking-wide">
          {rotulo}
        </span>
      </div>
      <div className="mt-3">
        <p
          className={`font-bold tabular-nums leading-none ${
            destaque ? "text-3xl" : "text-2xl"
          } ${corValor}`}
        >
          {valorPrincipal}
        </p>
        <div className="mt-2">{rodape}</div>
      </div>
    </div>
  );
}

function DeltaAbsoluto({
  diff,
  legenda,
  zeroLabel,
  inverterCor,
}: {
  diff: number;
  legenda: string;
  zeroLabel: string;
  inverterCor?: boolean;
}) {
  if (diff === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Minus className="h-3 w-3" />
        {zeroLabel}
      </span>
    );
  }
  const positivo = diff > 0;
  const eBom = inverterCor ? !positivo : positivo;
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium ${
        eBom ? "text-emerald-700" : "text-california-red"
      }`}
    >
      {positivo ? (
        <ArrowUpRight className="h-3 w-3" />
      ) : (
        <ArrowDownRight className="h-3 w-3" />
      )}
      {positivo ? "+" : ""}
      {diff} {legenda}
    </span>
  );
}

