"use server";

/**
 * O que o menu "Novo lançamento" da aba Títulos da conciliação (decisão
 * 195) precisa para abrir os formulários de criação que já existem —
 * pagamento avulso, recorrência, imposto avulso, recebimento avulso,
 * rendimento e transferência entre contas.
 *
 * Lido só quando o menu abre: a aba Títulos não paga por cadastros que a
 * maior parte das visitas não usa (docs/PERFORMANCE.md). As leituras são as
 * mesmas das páginas de Contas a Pagar, Contas a Receber e Impostos a Pagar,
 * em paralelo. Só leitura; só administrador e financeiro.
 */

import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { BandeiraCartao, ContaBancaria, PlanoContaSubtipo, PlanoContaTipo } from "@/lib/types";
import type { CartaoOption } from "@/components/financeiro/forma-pagamento-field";
import type { RendimentoLancado } from "../contas-a-receber/recebimento-avulso-dialog";
import { carregarImpostos, type DadosDosImpostos } from "../fiscal/impostos/dados";

export interface DadosDoNovoLancamento {
  tenantId: string;
  empresas: Array<{ id: string; nome: string }>;
  tipos: PlanoContaTipo[];
  subtipos: PlanoContaSubtipo[];
  fornecedores: Array<{ id: string; nome: string; cpf_cnpj: string | null }>;
  clientes: Array<{ id: string; nome: string }>;
  regionais: Array<{ id: string; nome: string; ativo: boolean; empresa_id: string }>;
  cartoes: CartaoOption[];
  contas: ContaBancaria[];
  rendimentosLancados: RendimentoLancado[];
  impostos: Pick<DadosDosImpostos, "tenantId" | "estabelecimentos" | "regimePorPJ" | "regionais">;
}

type Resultado = { ok: true; dados: DadosDoNovoLancamento } | { ok: false; message: string };

export async function carregarDadosDoNovoLancamento(): Promise<Resultado> {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    return { ok: false, message: "Apenas admin ou financeiro pode lançar." };
  }
  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  const [empresasRes, tiposRes, subtiposRes, fornecedoresRes, clientesRes, regionaisRes, cartoesRes, contasRes, rendimentosRes, impostos] =
    await Promise.all([
      supabase.from("empresas").select("id, razao_social, nome_fantasia").eq("tenant_id", tenantId).eq("ativo", true),
      supabase.from("plano_contas_tipos").select("*").eq("tenant_id", tenantId).eq("ativo", true).order("codigo").returns<PlanoContaTipo[]>(),
      supabase
        .from("plano_contas_subtipos")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("ativo", true)
        .order("codigo")
        .returns<PlanoContaSubtipo[]>(),
      supabase
        .from("fornecedores")
        .select("id, nome, razao_social, cpf_cnpj")
        .eq("tenant_id", tenantId)
        .eq("status", "ativo")
        .order("nome"),
      supabase
        .from("clientes")
        .select("id, nome_fantasia, razao_social")
        .eq("tenant_id", tenantId)
        .eq("status", "ativo")
        .order("nome_fantasia"),
      supabase.from("regionais").select("id, nome, ativo, empresa_id").eq("tenant_id", tenantId).order("nome"),
      supabase
        .from("cartoes_credito")
        .select("id, nome, banco, bandeira, ultimos_4_digitos, dia_vencimento_fatura, dia_fechamento_fatura")
        .eq("tenant_id", tenantId)
        .eq("ativo", true)
        .order("nome"),
      supabase
        .from("contas_bancarias")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("ativo", true)
        .neq("tipo", "cartao_credito")
        .order("ordem")
        .order("nome")
        .returns<ContaBancaria[]>(),
      // Um rendimento por conta e por mês: o formulário avisa antes de o
      // banco recusar (a mesma leitura de Contas a Receber).
      supabase
        .from("contas_avulsas")
        .select("codigo, valor, conta_bancaria_prevista_id, competencia")
        .eq("tenant_id", tenantId)
        .eq("tipo_entrada", "rendimento"),
      carregarImpostos(supabase, tenantId),
    ]);

  for (const [nome, res] of [
    ["empresas", empresasRes],
    ["tipos", tiposRes],
    ["subtipos", subtiposRes],
    ["fornecedores", fornecedoresRes],
    ["clientes", clientesRes],
    ["regionais", regionaisRes],
    ["cartoes", cartoesRes],
    ["contas", contasRes],
    ["rendimentos", rendimentosRes],
  ] as const) {
    if (res.error) {
      console.error(`[conciliacao.novo_lancamento.${nome}]`, res.error.message);
      return { ok: false, message: "Não foi possível abrir os formulários. Tente de novo." };
    }
  }

  return {
    ok: true,
    dados: {
      tenantId,
      empresas: ((empresasRes.data ?? []) as Array<{ id: string; razao_social: string | null; nome_fantasia: string | null }>).map(
        (e) => ({ id: e.id, nome: e.razao_social ?? e.nome_fantasia ?? "" }),
      ),
      tipos: tiposRes.data ?? [],
      subtipos: subtiposRes.data ?? [],
      fornecedores: ((fornecedoresRes.data ?? []) as Array<{ id: string; nome: string; razao_social: string | null; cpf_cnpj: string | null }>).map(
        (f) => ({ id: f.id, nome: f.razao_social ?? f.nome, cpf_cnpj: f.cpf_cnpj }),
      ),
      clientes: ((clientesRes.data ?? []) as Array<{ id: string; nome_fantasia: string | null; razao_social: string | null }>).map(
        (c) => ({ id: c.id, nome: c.razao_social ?? c.nome_fantasia ?? "" }),
      ),
      regionais: (regionaisRes.data ?? []) as Array<{ id: string; nome: string; ativo: boolean; empresa_id: string }>,
      cartoes: (
        (cartoesRes.data ?? []) as Array<{
          id: string;
          nome: string;
          banco: string;
          bandeira: string;
          ultimos_4_digitos: string;
          dia_vencimento_fatura: number;
          dia_fechamento_fatura: number | null;
        }>
      ).map((c) => ({
        id: c.id,
        nome: c.nome,
        banco: c.banco,
        bandeira: c.bandeira as BandeiraCartao,
        ultimos_4_digitos: c.ultimos_4_digitos,
        dia_vencimento_fatura: c.dia_vencimento_fatura,
        dia_fechamento_fatura: c.dia_fechamento_fatura ?? null,
      })),
      contas: contasRes.data ?? [],
      rendimentosLancados: (
        (rendimentosRes.data ?? []) as Array<{
          codigo: string | null;
          valor: string | number;
          conta_bancaria_prevista_id: string | null;
          competencia: string | null;
        }>
      )
        .filter((a) => a.conta_bancaria_prevista_id && a.competencia)
        .map((a) => ({
          conta_bancaria_id: a.conta_bancaria_prevista_id as string,
          competencia: (a.competencia as string).slice(0, 7),
          valor: Number(a.valor),
          codigo: a.codigo,
        })),
      impostos: {
        tenantId: impostos.tenantId,
        estabelecimentos: impostos.estabelecimentos,
        regimePorPJ: impostos.regimePorPJ,
        regionais: impostos.regionais,
      },
    },
  };
}
