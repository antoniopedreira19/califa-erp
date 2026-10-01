import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import type {
  ColaboradorFeriasLancamento,
  FeriasLancamentoTipo,
} from "@/lib/types";

type Props = {
  tenantId: string;
  mesParam?: string;
};

const MESES = [
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

export async function AbaCalendario({ tenantId, mesParam }: Props) {
  const hoje = new Date();
  const ano = parseMes(mesParam, hoje)[0];
  const mes = parseMes(mesParam, hoje)[1];

  // Primeiro e último dia do mês
  const primeiroDia = new Date(ano, mes - 1, 1);
  const ultimoDia = new Date(ano, mes, 0);
  const inicioISO = primeiroDia.toISOString().slice(0, 10);
  const fimISO = ultimoDia.toISOString().slice(0, 10);

  const supabase = createClient();
  const { data: lancamentosData } = await supabase
    .from("colaboradores_ferias_lancamentos")
    .select(
      "id, tipo, data_inicio, data_fim, dias, colaborador:colaboradores!colaborador_id(id, nome)",
    )
    .eq("tenant_id", tenantId)
    .eq("status", "aprovado")
    .lte("data_inicio", fimISO)
    .gte("data_fim", inicioISO)
    .order("data_inicio", { ascending: true });

  type Lanc = Pick<
    ColaboradorFeriasLancamento,
    "id" | "tipo" | "data_inicio" | "data_fim" | "dias"
  > & { colaborador: { id: string; nome: string } | null };

  const lancamentos = (lancamentosData ?? []) as unknown as Lanc[];

  // Agrupa por colaborador
  type ColabLanc = {
    id: string;
    nome: string;
    lancamentos: Lanc[];
  };
  const porColaborador = new Map<string, ColabLanc>();
  for (const l of lancamentos) {
    if (!l.colaborador) continue;
    const atual = porColaborador.get(l.colaborador.id) ?? {
      id: l.colaborador.id,
      nome: l.colaborador.nome,
      lancamentos: [],
    };
    atual.lancamentos.push(l);
    porColaborador.set(l.colaborador.id, atual);
  }
  const colaboradores = Array.from(porColaborador.values()).sort((a, b) =>
    a.nome.localeCompare(b.nome, "pt-BR"),
  );

  const totalDiasMes = ultimoDia.getDate();

  const prevMes = mes === 1 ? { ano: ano - 1, mes: 12 } : { ano, mes: mes - 1 };
  const nextMes = mes === 12 ? { ano: ano + 1, mes: 1 } : { ano, mes: mes + 1 };

  const hojeIsThisMes =
    hoje.getFullYear() === ano && hoje.getMonth() + 1 === mes;
  const diaHoje = hoje.getDate();

  return (
    <div className="space-y-4">
      {/* Navegação */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Link
            href={`/rh/ferias?tab=calendario&mes=${prevMes.ano}-${String(prevMes.mes).padStart(2, "0")}`}
            prefetch={false}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-white hover:bg-muted transition-colors"
            aria-label="Mês anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <h3 className="text-lg font-semibold">
            {MESES[mes - 1]} {ano}
          </h3>
          <Link
            href={`/rh/ferias?tab=calendario&mes=${nextMes.ano}-${String(nextMes.mes).padStart(2, "0")}`}
            prefetch={false}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-white hover:bg-muted transition-colors"
            aria-label="Próximo mês"
          >
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
        <Link
          href={`/rh/ferias?tab=calendario&mes=${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`}
          prefetch={false}
          className="rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
        >
          Hoje
        </Link>
      </div>

      {/* Grade */}
      {colaboradores.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhuma férias aprovada neste mês.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card shadow-soft overflow-hidden">
          {/* Cabeçalho de dias */}
          <div
            className="grid border-b border-border bg-muted/40 text-xs text-muted-foreground"
            style={{ gridTemplateColumns: `200px repeat(${totalDiasMes}, 1fr)` }}
          >
            <div className="px-3 py-2 font-medium border-r border-border">
              Colaborador
            </div>
            {Array.from({ length: totalDiasMes }, (_, i) => {
              const dia = i + 1;
              const dataAtual = new Date(ano, mes - 1, dia);
              const diaSem = dataAtual.getDay(); // 0=domingo, 6=sábado
              const fimDeSemana = diaSem === 0 || diaSem === 6;
              return (
                <div
                  key={dia}
                  className={`py-2 text-center text-[10px] ${
                    hojeIsThisMes && dia === diaHoje
                      ? "bg-california-red/10 font-semibold text-california-red"
                      : fimDeSemana
                        ? "bg-muted/30 text-muted-foreground/70"
                        : ""
                  }`}
                >
                  {dia}
                </div>
              );
            })}
          </div>

          {/* Linhas por colaborador */}
          <ul className="divide-y divide-border">
            {colaboradores.map((c) => (
              <li
                key={c.id}
                className="grid items-center min-h-[36px]"
                style={{
                  gridTemplateColumns: `200px repeat(${totalDiasMes}, 1fr)`,
                }}
              >
                <div className="px-3 py-2 text-sm font-medium truncate border-r border-border bg-white sticky left-0">
                  {c.nome}
                </div>
                {/* Grade de dias de fundo */}
                {Array.from({ length: totalDiasMes }, (_, i) => {
                  const dia = i + 1;
                  const dataAtual = new Date(ano, mes - 1, dia);
                  const diaSem = dataAtual.getDay();
                  const fimDeSemana = diaSem === 0 || diaSem === 6;
                  return (
                    <div
                      key={dia}
                      className={`h-full ${
                        hojeIsThisMes && dia === diaHoje
                          ? "bg-california-red/5"
                          : fimDeSemana
                            ? "bg-muted/10"
                            : ""
                      } border-l border-border/40`}
                    />
                  );
                })}
                {/* Barras das férias (gridColumn relative à grade da linha) */}
                {c.lancamentos.map((l) => {
                  const inicio = new Date(l.data_inicio + "T00:00:00");
                  const fim = new Date(l.data_fim + "T00:00:00");
                  const inicioMes = new Date(ano, mes - 1, 1);
                  const fimMes = new Date(ano, mes - 1, totalDiasMes);

                  const inicioClamp = inicio < inicioMes ? inicioMes : inicio;
                  const fimClamp = fim > fimMes ? fimMes : fim;

                  const diaIni = inicioClamp.getDate();
                  const diaFim = fimClamp.getDate();
                  const colSpan = diaFim - diaIni + 1;

                  // Posição no grid: coluna 1 é nome, dias começam na coluna 2
                  const gridColStart = diaIni + 1;

                  return (
                    <div
                      key={l.id}
                      className={`h-5 rounded px-1.5 flex items-center text-[10px] font-medium text-white truncate my-auto mx-0.5 ${tipoBarCor(l.tipo)}`}
                      style={{
                        gridColumn: `${gridColStart} / span ${colSpan}`,
                        gridRow: 1,
                      }}
                      title={`${c.nome} · ${l.dias} dias · ${l.data_inicio} a ${l.data_fim}`}
                    >
                      {colSpan >= 3 ? `${l.dias}d` : ""}
                    </div>
                  );
                })}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Legenda */}
      <div className="flex items-center gap-4 flex-wrap text-xs text-muted-foreground">
        <LegendaItem cls="bg-emerald-600" label="Usufruto" />
        <LegendaItem cls="bg-sky-600" label="Abono combinado" />
        <LegendaItem cls="bg-purple-600" label="Abono avulso" />
        <LegendaItem cls="bg-orange-600" label="Abono excepcional" />
      </div>
    </div>
  );
}

function LegendaItem({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2.5 w-5 rounded ${cls}`} />
      {label}
    </span>
  );
}

function tipoBarCor(t: FeriasLancamentoTipo): string {
  switch (t) {
    case "usufruto":
      return "bg-emerald-600";
    case "abono_combinado":
      return "bg-sky-600";
    case "abono_avulso":
      return "bg-purple-600";
    case "abono_excepcional":
      return "bg-orange-600";
  }
}

function parseMes(param: string | undefined, hoje: Date): [number, number] {
  if (param && /^\d{4}-\d{2}$/.test(param)) {
    const [anoStr, mesStr] = param.split("-");
    const a = parseInt(anoStr, 10);
    const m = parseInt(mesStr, 10);
    if (a > 2000 && a < 2100 && m >= 1 && m <= 12) {
      return [a, m];
    }
  }
  return [hoje.getFullYear(), hoje.getMonth() + 1];
}
