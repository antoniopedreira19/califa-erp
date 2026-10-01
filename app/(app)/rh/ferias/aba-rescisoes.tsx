import Link from "next/link";
import { Calculator, UserX } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import type { Colaborador, TipoContratacao } from "@/lib/types";
import { tipoContratacaoLabel } from "@/lib/types";

type Props = {
  tenantId: string;
  colaboradorSelecionadoId?: string;
};

type ColabRow = Pick<
  Colaborador,
  "id" | "nome" | "tipo_contratacao" | "data_admissao" | "data_encerramento"
>;

export async function AbaRescisoes({ tenantId, colaboradorSelecionadoId }: Props) {
  const supabase = createClient();

  // Lista colaboradores encerrados nos últimos 90 dias + os ainda com saldo
  const noventaDiasAtras = new Date();
  noventaDiasAtras.setDate(noventaDiasAtras.getDate() - 90);
  const corteISO = noventaDiasAtras.toISOString().slice(0, 10);

  const { data: desligadosData } = await supabase
    .from("colaboradores")
    .select("id, nome, tipo_contratacao, data_admissao, data_encerramento")
    .eq("tenant_id", tenantId)
    .eq("status", "inativo")
    .not("data_encerramento", "is", null)
    .gte("data_encerramento", corteISO)
    .order("data_encerramento", { ascending: false })
    .limit(50);

  const desligados = (desligadosData ?? []) as ColabRow[];

  // Se tem colaborador selecionado, calcula a rescisão dele
  let calculo: CalculoRescisao | null = null;
  let selecionado: ColabRow | null = null;
  if (colaboradorSelecionadoId) {
    selecionado =
      desligados.find((c) => c.id === colaboradorSelecionadoId) ?? null;
    if (!selecionado) {
      // Pode ser um colaborador ativo (RH testando pré-rescisão)
      const { data } = await supabase
        .from("colaboradores")
        .select("id, nome, tipo_contratacao, data_admissao, data_encerramento")
        .eq("id", colaboradorSelecionadoId)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (data) selecionado = data as ColabRow;
    }

    if (selecionado) {
      calculo = await calcularRescisao(
        supabase,
        selecionado.id,
        selecionado.data_encerramento ??
          new Date().toISOString().slice(0, 10),
      );
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.5fr]">
      {/* Lista de desligados recentes */}
      <section className="rounded-2xl border border-border bg-card shadow-soft overflow-hidden self-start">
        <header className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <div className="rounded-lg bg-california-red/10 p-2">
            <UserX className="h-4 w-4 text-california-red" />
          </div>
          <h3 className="text-base font-semibold">Desligados recentes</h3>
        </header>
        {desligados.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-10">
            Nenhum desligamento nos últimos 90 dias.
          </p>
        ) : (
          <ul className="divide-y divide-border max-h-[500px] overflow-y-auto">
            {desligados.map((c) => {
              const ativo = c.id === colaboradorSelecionadoId;
              return (
                <li key={c.id}>
                  <Link
                    href={`/rh/ferias?tab=rescisoes&colab=${c.id}`}
                    prefetch={false}
                    className={`block px-5 py-3 transition-colors ${
                      ativo
                        ? "bg-california-red/5 border-l-2 border-california-red"
                        : "hover:bg-muted/40"
                    }`}
                  >
                    <p className="text-sm font-medium truncate">{c.nome}</p>
                    <p className="text-xs text-muted-foreground">
                      Desligado em{" "}
                      {c.data_encerramento
                        ? new Date(
                            c.data_encerramento + "T00:00:00",
                          ).toLocaleDateString("pt-BR")
                        : "—"}{" "}
                      · {tipoContratacaoLabel(c.tipo_contratacao)}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Cálculo */}
      <section className="rounded-2xl border border-border bg-card shadow-soft p-6">
        {!selecionado || !calculo ? (
          <div className="text-center py-16">
            <Calculator className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              Escolha um desligado na lista pra ver o cálculo da rescisão.
            </p>
          </div>
        ) : (
          <RescisaoCalculo colab={selecionado} calculo={calculo} />
        )}
      </section>
    </div>
  );
}

type CalculoRescisao = {
  salarioVigente: number;
  dataDemissao: string;
  saldoSalarioDias: number;
  saldoSalarioValor: number;
  avosFerias: number;
  valorFerias: number;
  valorUmTercoFerias: number;
  avosDecimo: number;
  valorDecimoTerceiro: number;
  totalDevido: number;
};

async function calcularRescisao(
  supabase: ReturnType<typeof createClient>,
  colaboradorId: string,
  dataDemissao: string,
): Promise<CalculoRescisao | null> {
  // Salário vigente
  const { data: salarios } = await supabase
    .from("colaboradores_salarios")
    .select("valor")
    .eq("colaborador_id", colaboradorId)
    .lte("data_inicio", dataDemissao)
    .or(`data_fim.is.null,data_fim.gte.${dataDemissao}`)
    .order("data_inicio", { ascending: false })
    .limit(1);

  if (!salarios || salarios.length === 0) return null;
  const salario = Number(salarios[0].valor);

  // Avos de férias via RPC
  const { data: avosFeriasData } = await supabase.rpc(
    "fn_calcular_meses_rescisao",
    {
      p_colaborador_id: colaboradorId,
      p_data_demissao: dataDemissao,
    },
  );
  const avosFerias = Number(avosFeriasData ?? 0);

  // Saldo de salário: dias trabalhados do mês da demissão
  const dem = new Date(dataDemissao + "T00:00:00");
  const saldoDias = dem.getDate();

  // 13º: meses trabalhados no ano
  const avosDecimo = dem.getMonth() + 1;

  const saldoValor = round2((salario / 30) * saldoDias);
  const valorFerias = round2((salario / 12) * avosFerias);
  const valorUmTerco = round2(valorFerias / 3);
  const valorDecimo = round2((salario / 12) * avosDecimo);
  const total = round2(saldoValor + valorFerias + valorUmTerco + valorDecimo);

  return {
    salarioVigente: salario,
    dataDemissao,
    saldoSalarioDias: saldoDias,
    saldoSalarioValor: saldoValor,
    avosFerias,
    valorFerias,
    valorUmTercoFerias: valorUmTerco,
    avosDecimo,
    valorDecimoTerceiro: valorDecimo,
    totalDevido: total,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function RescisaoCalculo({
  colab,
  calculo,
}: {
  colab: ColabRow;
  calculo: CalculoRescisao;
}) {
  return (
    <div className="space-y-5">
      <header>
        <h3 className="text-lg font-semibold">{colab.nome}</h3>
        <p className="text-xs text-muted-foreground">
          {tipoContratacaoLabel(colab.tipo_contratacao)} · Admissão{" "}
          {new Date(colab.data_admissao + "T00:00:00").toLocaleDateString(
            "pt-BR",
          )}{" "}
          · Desligamento{" "}
          {new Date(calculo.dataDemissao + "T00:00:00").toLocaleDateString(
            "pt-BR",
          )}
        </p>
      </header>

      <div className="rounded-xl bg-muted/40 p-4">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Salário vigente
        </p>
        <p className="mt-1 text-xl font-semibold">
          {fmtBRL(calculo.salarioVigente)}
        </p>
      </div>

      <div className="rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-2">Verba</th>
              <th className="text-center px-4 py-2">Quantidade</th>
              <th className="text-right px-4 py-2">Valor</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            <LinhaVerba
              rotulo="Saldo de salário"
              qtd={`${calculo.saldoSalarioDias} dias`}
              valor={calculo.saldoSalarioValor}
            />
            <LinhaVerba
              rotulo="Férias"
              qtd={`${calculo.avosFerias} avós`}
              valor={calculo.valorFerias}
              dica="Regra dos avós (F12): 12 por período + proporcional do atual (≥ 15 dias)."
            />
            <LinhaVerba
              rotulo="1/3 férias"
              qtd=""
              valor={calculo.valorUmTercoFerias}
            />
            <LinhaVerba
              rotulo="13º proporcional"
              qtd={`${calculo.avosDecimo} meses`}
              valor={calculo.valorDecimoTerceiro}
            />
          </tbody>
          <tfoot>
            <tr className="bg-california-red/5 font-semibold">
              <td className="px-4 py-3" colSpan={2}>
                TOTAL DEVIDO
              </td>
              <td className="px-4 py-3 text-right text-lg">
                {fmtBRL(calculo.totalDevido)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <p className="text-xs font-medium text-amber-900 mb-2">
          Descontos (planos, TotalPass etc.)
        </p>
        <p className="text-sm text-amber-800">
          Benefícios recorrentes ficam zerados por padrão no MVP (F9) — viram
          tema do subsistema de Benefícios. Até lá, o RH deduz manualmente ao
          lançar em Contas a Pagar.
        </p>
      </div>

      <div className="rounded-lg border border-sky-200 bg-sky-50 p-4">
        <p className="text-xs font-medium text-sky-900 mb-2">
          Como gerar o pagamento
        </p>
        <p className="text-sm text-sky-800">
          Com o valor acima, o RH cria uma avulsa em{" "}
          <Link
            href="/financeiro/contas-a-pagar"
            prefetch={false}
            className="font-medium underline underline-offset-2"
          >
            Contas a Pagar
          </Link>{" "}
          com descrição &ldquo;Rescisão – {colab.nome}&rdquo;, selecionando a
          empresa de alocação. O lançamento automático direto daqui vai entrar
          no próximo ciclo.
        </p>
      </div>
    </div>
  );
}

function LinhaVerba({
  rotulo,
  qtd,
  valor,
  dica,
}: {
  rotulo: string;
  qtd: string;
  valor: number;
  dica?: string;
}) {
  return (
    <tr>
      <td className="px-4 py-3">
        <p>{rotulo}</p>
        {dica && <p className="text-xs text-muted-foreground mt-0.5">{dica}</p>}
      </td>
      <td className="px-4 py-3 text-center text-muted-foreground">{qtd}</td>
      <td className="px-4 py-3 text-right font-medium">{fmtBRL(valor)}</td>
    </tr>
  );
}

function fmtBRL(n: number): string {
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}
