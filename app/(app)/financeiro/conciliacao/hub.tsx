/**
 * Página inicial da Conciliação (decisão 091).
 *
 * É o que `/financeiro/conciliacao` mostra quando NÃO há conta escolhida.
 * Com `?conta=`, a mesma rota segue no extrato de sempre — assim os
 * `revalidatePath("/financeiro/conciliacao")` das ações de baixa e os links
 * com `&highlight=` continuam valendo sem nenhuma mudança.
 */
import Link from "next/link";
import { ArrowLeft, BookOpen } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PageHeader } from "@/components/ui/page-header";
import { formatCurrency } from "@/lib/utils";
import { carregarHub } from "./hub-dados";
import { dataCurta, PERIODOS, type PeriodoChave } from "./hub-periodo";
import { HubTabela } from "./hub-tabela";
import {
  BlocoQuebra,
  fatiarPorEmpresa,
  fatiarPorTipo,
} from "./hub-resumo";

export async function HubConciliacao({
  supabase,
  tenantId,
  periodo,
}: {
  supabase: SupabaseClient;
  tenantId: string;
  periodo: PeriodoChave;
}) {
  const { contas, totais, inativas, periodo: faixa } = await carregarHub(
    supabase,
    tenantId,
    periodo,
  );

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/financeiro"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          Voltar para central financeira
        </Link>
      </div>

      <PageHeader
        eyebrow="FINANCEIRO"
        title="Conciliação Bancária"
        description="As contas de cada empresa e o saldo de hoje. Clique na linha para abrir o extrato e bater com o extrato do banco."
        icon={BookOpen}
      />

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card px-5 py-4">
        <div className="flex flex-wrap items-center gap-x-10 gap-y-3">
          <Numero
            label="Saldo consolidado"
            valor={formatCurrency(totais.saldo)}
            forte
          />
          <Numero
            label="Entradas no período"
            valor={formatCurrency(totais.creditos)}
            cor="text-emerald-700"
          />
          <Numero
            label="Saídas no período"
            valor={formatCurrency(totais.debitos)}
            cor="text-california-red"
          />
          <Numero
            label="Resultado"
            valor={formatCurrency(totais.creditos - totais.debitos)}
          />
          <Numero
            label="Lançamentos"
            valor={`${totais.lancamentos} · ${dataCurta(faixa.de)} a ${dataCurta(faixa.ate)}`}
          />
          {inativas.contas > 0 && (
            <Numero
              label="Fora do total"
              valor={`${inativas.contas} ${inativas.contas === 1 ? "conta inativa" : "contas inativas"} · ${formatCurrency(inativas.saldo)}`}
              cor="text-muted-foreground"
            />
          )}
        </div>
        <SeletorPeriodo atual={periodo} />
      </div>

      {contas.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhuma conta bancária cadastrada. Vá em{" "}
            <Link
              href="/financeiro/cadastros/contas-bancarias"
              prefetch={false}
              className="text-california-red hover:underline"
            >
              cadastros
            </Link>{" "}
            pra criar a primeira.
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <BlocoQuebra
              titulo="Saldo por tipo de conta"
              fatias={fatiarPorTipo(contas)}
              deitado
              percentual
            />
            <BlocoQuebra
              titulo="Saldo por empresa"
              fatias={fatiarPorEmpresa(contas)}
              deitado
              percentual
            />
          </div>

          <HubTabela
            contas={contas}
            de={faixa.de}
            ate={faixa.ate}
            totais={totais}
          />
        </>
      )}
    </div>
  );
}

/** Pílulas de período. Links puros: trocar o período é uma navegação. */
function SeletorPeriodo({ atual }: { atual: PeriodoChave }) {
  return (
    <div className="inline-flex items-center rounded-lg border border-border bg-card p-0.5">
      {PERIODOS.map((p) => (
        <Link
          key={p.chave}
          href={`/financeiro/conciliacao?periodo=${p.chave}`}
          prefetch={false}
          className={
            p.chave === atual
              ? "rounded-md bg-california-red px-3 py-1.5 text-xs font-semibold text-white"
              : "rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          }
        >
          {p.label}
        </Link>
      ))}
    </div>
  );
}

function Numero({
  label,
  valor,
  cor,
  forte,
}: {
  label: string;
  valor: string;
  cor?: string;
  forte?: boolean;
}) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p
        className={`font-mono ${forte ? "text-xl font-semibold" : "text-sm font-medium"} ${
          cor ?? "text-foreground"
        }`}
      >
        {valor}
      </p>
    </div>
  );
}
