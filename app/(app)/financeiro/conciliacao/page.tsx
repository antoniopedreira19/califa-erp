import Link from "next/link";
import { ArrowLeft, Receipt } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import type { ContaBancaria, DocumentoTipo } from "@/lib/types";
import {
  DOCUMENTO_TIPOS_FISCAIS,
  documentoTipoLabel,
} from "@/lib/types";
import {
  calcularSaldoAnterior,
  derivarSaldo,
} from "@/lib/calculos/saldo-conta";
import { FiltrosConta } from "./filtros-conta";
import { ConciliacaoList } from "./conciliacao-list";

export const dynamic = "force-dynamic";

export default async function ConciliacaoPage({
  searchParams,
}: {
  searchParams: {
    conta?: string;
    de?: string;
    ate?: string;
    highlight?: string;
  };
}) {
  const session = await requireSession();
  if (
    session.activeRole !== "administrador" &&
    session.activeRole !== "financeiro"
  ) {
    redirect("/home?reason=sem_permissao_financeira");
  }

  const supabase = createClient();

  const { data: contas } = await supabase
    .from("contas_bancarias")
    .select("*")
    .eq("tenant_id", session.activeTenant.id)
    .eq("ativo", true)
    .order("ordem")
    .order("nome")
    .returns<ContaBancaria[]>();

  const listaContas = contas ?? [];
  const contaId = searchParams.conta ?? listaContas[0]?.id ?? null;

  // Default: mês corrente
  const hoje = new Date();
  const dataDe =
    searchParams.de ??
    new Date(hoje.getFullYear(), hoje.getMonth(), 1)
      .toISOString()
      .slice(0, 10);
  const dataAte =
    searchParams.ate ??
    new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0)
      .toISOString()
      .slice(0, 10);

  let saldoAnterior = 0;
  let linhas: ReturnType<typeof derivarSaldo> = [];
  let creditos = 0;
  let debitos = 0;

  if (contaId) {
    const s = await calcularSaldoAnterior(supabase, {
      tenantId: session.activeTenant.id,
      contaId,
      dataDe,
    });
    saldoAnterior = s.saldoAnterior;

    // ⚠️ O erro é LIDO. Ele era descartado, e o efeito de qualquer engano
    // na query — um embed ambíguo, por exemplo — era a tela dizer
    // "nenhum lançamento nesse período", que é indistinguível de um
    // período vazio de verdade. Foi assim que a coluna Origem entrou
    // quebrada em 28/08/2026: `titulos_receber` tem FK nas DUAS direções
    // e o PostgREST não escolhe sozinho.
    const { data, error: lancamentosErr } = await supabase
      .from("lancamentos_financeiros")
      .select(
        `id, data_movimento, descricao, natureza, valor, origem, created_at,
         fornecedores(nome, razao_social),
         jobs(codigo, regional:regionais(nome)),
         empresas(regional:regionais(nome)),
         plano_contas_tipos!inner(codigo, nome),
         plano_contas_subtipos!inner(codigo, nome),
         forma_pagamento,
         pedido_compra:pedidos_compra(
           codigo,
           anexos:pedidos_compra_anexos(arquivo_path, documento_tipo, documento_numero)
         ),
         desembolso:desembolsos(
           codigo,
           anexos:desembolsos_anexos(arquivo_path, documento_tipo, documento_numero)
         ),
         cartao:cartoes_credito(nome, ultimos_4_digitos),
         fatura:faturas_cartao(codigo),
         titulo:titulos_receber!lancamentos_financeiros_titulo_receber_id_fkey(
           faturamento:faturamentos(numero_nf, serie, anexo_nf_path)
         ),
         conta_avulsa:contas_avulsas!conta_avulsa_id(
           codigo,
           recorrente_id,
           anexos:contas_avulsas_anexos(arquivo_path, documento_tipo, documento_numero),
           rateio:contas_avulsas_regionais(
             percentual,
             regional:regionais(nome)
           )
         )`,
      )
      .eq("tenant_id", session.activeTenant.id)
      .eq("conta_bancaria_id", contaId)
      .gte("data_movimento", dataDe)
      .lte("data_movimento", dataAte)
      .order("data_movimento", { ascending: true })
      .order("created_at", { ascending: true });

    if (lancamentosErr) {
      console.error("[conciliacao.lancamentos]", lancamentosErr.message);
    }

    type RawRow = {
      id: string;
      data_movimento: string;
      descricao: string;
      natureza: "entrada" | "saida";
      valor: string | number;
      origem: string;
      fornecedores: { nome: string | null; razao_social: string | null } | null;
      jobs: { codigo: string; regional: { nome: string } | null } | null;
      empresas: { regional: { nome: string } | null } | null;
      plano_contas_tipos: { codigo: string; nome: string };
      plano_contas_subtipos: { codigo: string; nome: string };
      forma_pagamento: string | null;
      fatura: { codigo: string } | null;
      pedido_compra: { codigo: string; anexos: AnexoRaw[] } | null;
      desembolso: { codigo: string; anexos: AnexoRaw[] } | null;
      cartao: { nome: string; ultimos_4_digitos: string } | null;
      titulo: {
        faturamento: {
          numero_nf: string | null;
          serie: string | null;
          anexo_nf_path: string | null;
        } | null;
      } | null;
      conta_avulsa: {
        codigo: string | null;
        recorrente_id: string | null;
        anexos: AnexoRaw[];
        rateio: Array<{
          percentual: number;
          regional: { nome: string } | null;
        }>;
      } | null;
    };

    type AnexoRaw = {
      arquivo_path: string;
      documento_tipo: DocumentoTipo | null;
      documento_numero: string | null;
    };

    /**
     * O comprovante FISCAL de uma origem: o primeiro anexo tipado como
     * nota ou recibo. Contrato e boleto acompanham a compra, mas não são
     * o documento que a contabilidade procura — por isso ficam de fora.
     */
    const documentoFiscal = (
      anexos: AnexoRaw[] | undefined,
    ): { label: string; path: string } | null => {
      const alvo = (anexos ?? []).find(
        (a) =>
          a.documento_tipo !== null &&
          DOCUMENTO_TIPOS_FISCAIS.includes(a.documento_tipo),
      );
      if (!alvo?.documento_tipo) return null;
      const rotulo = documentoTipoLabel(alvo.documento_tipo);
      return {
        label: alvo.documento_numero
          ? `${rotulo} ${alvo.documento_numero}`
          : rotulo,
        path: alvo.arquivo_path,
      };
    };

    /** "NF 900123/1" — a nota como ela é lida, com a série quando existe. */
    const numeroDaNota = (
      f: { numero_nf: string | null; serie: string | null } | null,
    ): string | null => {
      if (!f?.numero_nf) return null;
      return f.serie ? `NF ${f.numero_nf}/${f.serie}` : `NF ${f.numero_nf}`;
    };

    const raw = ((data ?? []) as unknown as RawRow[]).map((r) => {
      const rateio = (r.conta_avulsa?.rateio ?? []).map((rr: { percentual: number; regional: { nome: string } | null }) => ({
        percentual: Number(rr.percentual),
        regional_nome: rr.regional?.nome ?? "—",
      }));
      return {
        id: r.id,
        data_movimento: r.data_movimento,
        descricao: r.descricao,
        natureza: r.natureza,
        valor: Number(r.valor),
        fornecedor_nome:
          r.fornecedores?.razao_social ?? r.fornecedores?.nome ?? null,
        job_codigo: r.jobs?.codigo ?? null,
        // Mesma regra do `vw_fluxo_caixa`: a avulsa rateada manda, e o
        // rateio de uma regional só resolve aqui mesmo; sem rateio, a
        // regional do job; sem job, a da empresa. Com mais de uma regional
        // isto fica nulo — a coluna diz "Rateada" e o detalhe abre a
        // divisão, que é onde os percentuais cabem.
        regional_nome:
          rateio.length === 1
            ? rateio[0].regional_nome
            : rateio.length > 1
              ? null
              : (r.jobs?.regional?.nome ??
                 r.empresas?.regional?.nome ??
                 null),
        // A ordem é a das origens que têm identificador próprio. O
        // recebimento fica por último porque ali a origem É a nota — o
        // faturamento não tem código interno, e inventar um só faria a
        // coluna Documento repetir esta.
        origem_codigo:
          r.pedido_compra?.codigo ??
          r.desembolso?.codigo ??
          r.conta_avulsa?.codigo ??
          numeroDaNota(r.titulo?.faturamento ?? null) ??
          // Fecha a lista: o pagamento da fatura e o ajuste de IOF não
          // vêm de documento nenhum, mas vêm de uma fatura — e sem isso
          // eles apareciam com travessão, sem dizer de onde saíram
          // (28/08/2026).
          r.fatura?.codigo ??
          null,
        origem_recorrente: r.conta_avulsa?.recorrente_id != null,
        cartao_label:
          r.forma_pagamento === "cartao_credito" && r.cartao
            ? `${r.cartao.nome} ·${r.cartao.ultimos_4_digitos}`
            : null,
        // Mesma ordem da Origem. No recebimento a NOTA é o documento: ela
        // já vem estruturada em `faturamentos`, e não depende de ninguém
        // ter identificado anexo nenhum.
        documento_label:
          documentoFiscal(r.pedido_compra?.anexos)?.label ??
          documentoFiscal(r.desembolso?.anexos)?.label ??
          documentoFiscal(r.conta_avulsa?.anexos)?.label ??
          numeroDaNota(r.titulo?.faturamento ?? null),
        documento_path:
          documentoFiscal(r.pedido_compra?.anexos)?.path ??
          documentoFiscal(r.desembolso?.anexos)?.path ??
          documentoFiscal(r.conta_avulsa?.anexos)?.path ??
          r.titulo?.faturamento?.anexo_nf_path ??
          null,
        tipo_codigo: r.plano_contas_tipos.codigo,
        tipo_nome: r.plano_contas_tipos.nome,
        subtipo_codigo: r.plano_contas_subtipos.codigo,
        subtipo_nome: r.plano_contas_subtipos.nome,
        origem: r.origem,
        rateio,
      };
    });

    // De onde vem o dinheiro de cada baixa: os jobs cobertos pela nota e
    // o saldo em save. Só existe em lançamento de título; nos demais a
    // consulta volta vazia e a linha fica sem expansão
    // (docs/decisions/028-save-entre-jobs.md).
    const ids = raw.map((r) => r.id);
    const origensPorLancamento = new Map<
      string,
      Array<{ tipo: "job" | "save"; codigo: string | null; nome: string | null; valor: number }>
    >();
    if (ids.length > 0) {
      // Sem embed: `vw_lancamento_origens` é VIEW, e o PostgREST não tem
      // chave estrangeira para inferir o join com `jobs` a partir dela —
      // pedir `job:jobs!job_id(...)` volta erro, e o erro silencioso
      // deixava a linha sem expansão nenhuma. O nome do job vem numa
      // segunda leitura, pelos ids que a view devolveu.
      const { data: origens, error: origensErro } = await supabase
        .from("vw_lancamento_origens")
        .select("lancamento_id, tipo, valor, job_id, save_job_id")
        .eq("tenant_id", session.activeTenant.id)
        .in("lancamento_id", ids);

      if (origensErro) {
        console.error("[conciliacao.origens]", origensErro.message);
      }

      const jobIds = [
        ...new Set(
          ((origens ?? []) as any[])
            .map((o) => o.job_id ?? o.save_job_id)
            .filter((id: string | null): id is string => !!id),
        ),
      ];
      const { data: jobsDasOrigens } = jobIds.length
        ? await supabase
            .from("jobs")
            .select("id, codigo, nome")
            .eq("tenant_id", session.activeTenant.id)
            .in("id", jobIds)
        : { data: [] as any[] };
      const jobPorId = new Map(
        ((jobsDasOrigens ?? []) as any[]).map((j) => [j.id, j]),
      );

      for (const o of (origens ?? []) as any[]) {
        const lista = origensPorLancamento.get(o.lancamento_id) ?? [];
        const alvo = jobPorId.get(o.tipo === "save" ? o.save_job_id : o.job_id);
        lista.push({
          tipo: o.tipo,
          codigo: alvo?.codigo ?? null,
          nome: alvo?.nome ?? null,
          valor: Number(o.valor ?? 0),
        });
        origensPorLancamento.set(o.lancamento_id, lista);
      }
    }

    linhas = derivarSaldo(
      raw.map((r) => ({ ...r, origens: origensPorLancamento.get(r.id) ?? [] })),
      saldoAnterior,
    );
    creditos = linhas.reduce((acc, l) => acc + l.credito, 0);
    debitos = linhas.reduce((acc, l) => acc + l.debito, 0);
  }

  const saldoFinal = saldoAnterior + creditos - debitos;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/financeiro"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Voltar para central financeira
        </Link>
      </div>
      <header className="space-y-1">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <Receipt className="h-5 w-5 text-california-red" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Conciliação</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Extrato por conta bancária — base pra bater com o extrato do banco e
          alimentar o DRE.
        </p>
      </header>

      <FiltrosConta
        contas={listaContas}
        contaAtual={contaId ?? undefined}
        dataDe={dataDe}
        dataAte={dataAte}
      />

      {contaId && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <SaldoCard label="Saldo anterior" valor={saldoAnterior} muted />
            <SaldoCard
              label="Créditos no período"
              valor={creditos}
              tone="entrada"
            />
            <SaldoCard
              label="Débitos no período"
              valor={debitos}
              tone="saida"
            />
            <SaldoCard label="Saldo final" valor={saldoFinal} destaque />
          </div>

          <ConciliacaoList linhas={linhas} highlight={searchParams.highlight} />
        </>
      )}

      {!contaId && (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhuma conta bancária cadastrada. Vá em{" "}
            <Link
              href="/cadastros/contas-bancarias"
              prefetch={false}
              className="text-california-red hover:underline"
            >
              cadastros
            </Link>{" "}
            pra criar a primeira.
          </p>
        </div>
      )}
    </div>
  );
}

function SaldoCard({
  label,
  valor,
  muted,
  destaque,
  tone,
}: {
  label: string;
  valor: number;
  muted?: boolean;
  destaque?: boolean;
  tone?: "entrada" | "saida";
}) {
  const cor = destaque
    ? valor >= 0
      ? "text-emerald-700"
      : "text-california-red"
    : tone === "entrada"
      ? "text-emerald-700"
      : tone === "saida"
        ? "text-california-red"
        : muted
          ? "text-muted-foreground"
          : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className={`mt-1 font-mono text-lg font-semibold ${cor}`}>
        {valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
      </p>
    </div>
  );
}
