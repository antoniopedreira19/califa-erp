"use server";

/**
 * As ações da aba Banco da conciliação (task 029, fase 3).
 *
 * Entrega 3A — importar o extrato (decisão 198). O OFX é lido no navegador
 * (`lerOfx`, o mesmo parser dos testes) e chega aqui só com o que importa:
 * o cabeçalho e as linhas. O arquivo cru não sobe nem fica guardado — o
 * limite do corpo da Server Action (1 MB) aceita um mês inteiro de linhas,
 * que o arquivo cru talvez não coubesse. Tudo é conferido de novo aqui,
 * porque o que vem do navegador não é confiável: o formato (zod), o banco
 * do arquivo contra o do cadastro, a conta (agência e número) e a
 * impressão digital, que é calculada aqui e não no navegador. A RPC
 * `importar_extrato` confere a conta outra vez, grava sem repetir e audita.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { arquivoEhDaConta, bancoDoArquivoConfere, contaTemNumero, digitais, rotuloDoBanco } from "@/lib/conciliacao/ofx";

const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const ArquivoSchema = z.object({
  nome: z.string().trim().min(1).max(255),
  bancoId: z.string().max(20),
  conta: z.string().max(40),
  inicio: DATA.nullable(),
  fim: DATA.nullable(),
  geradoInstante: z.string().max(40).nullable(),
  saldoBanco: z.number().finite().nullable(),
  saldoEm: DATA.nullable(),
  movimentos: z
    .array(
      z.object({
        ordem: z.number().int().min(0),
        tipo: z.string().max(20),
        data: DATA,
        valor: z.number().finite(),
        fitid: z.string().max(255),
        documento: z.string().max(60),
        historico: z.string().max(500),
      }),
    )
    .max(5000, "O arquivo tem mais de 5.000 movimentos: importe um período menor."),
});

export type ArquivoParaImportar = z.infer<typeof ArquivoSchema>;

export type ResultadoDaImportacao =
  | { ok: true; movimentos: number; novos: number }
  /** O arquivo é de outra conta cadastrada: a conciliação dela. */
  | { ok: false; motivo: "outra_conta"; conta: { id: string; nome: string }; message: string }
  /** De conta nenhuma (ou de conta sem agência e número no cadastro). */
  | { ok: false; motivo: "nenhuma_conta"; message: string }
  | { ok: false; motivo: "erro"; message: string };

export async function importarExtrato(contaId: string, arquivo: ArquivoParaImportar): Promise<ResultadoDaImportacao> {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    return { ok: false, motivo: "erro", message: "Só admin ou financeiro concilia o extrato do banco." };
  }
  if (!z.string().uuid().safeParse(contaId).success) {
    return { ok: false, motivo: "erro", message: "Conta inválida." };
  }
  const lido = ArquivoSchema.safeParse(arquivo);
  if (!lido.success) {
    const primeiro = lido.error.issues[0];
    return {
      ok: false,
      motivo: "erro",
      message: primeiro?.message?.startsWith("O arquivo") ? primeiro.message : "O arquivo não parece um extrato OFX válido.",
    };
  }
  const a = lido.data;
  if (a.movimentos.length === 0) return { ok: false, motivo: "erro", message: "O arquivo não tem movimentos." };

  const supabase = createClient();
  const tenantId = session.activeTenant.id;
  const { data: contas, error } = await supabase
    .from("contas_bancarias")
    .select("id, nome, banco, agencia, numero_conta, numero_conta_dv, tipo, ativo")
    .eq("tenant_id", tenantId)
    .neq("tipo", "cartao_credito");
  if (error) {
    console.error("[conciliacao.importar.contas]", error.message);
    return { ok: false, motivo: "erro", message: "Não foi possível ler as contas. Tente de novo." };
  }
  const todas = (contas ?? []) as Array<{
    id: string;
    nome: string;
    banco: string;
    agencia: string | null;
    numero_conta: string | null;
    numero_conta_dv: string | null;
  }>;
  const conta = todas.find((c) => c.id === contaId);
  if (!conta) return { ok: false, motivo: "erro", message: "Conta bancária não encontrada." };

  const final4 = a.conta.replace(/\D/g, "").slice(-4);
  if (!arquivoEhDaConta(a.conta, conta)) {
    const outra = todas.find((c) => c.id !== contaId && arquivoEhDaConta(a.conta, c));
    if (outra) {
      return {
        ok: false,
        motivo: "outra_conta",
        conta: { id: outra.id, nome: outra.nome },
        message: `${a.nome} é da conta ${outra.nome}, não da ${conta.nome}.`,
      };
    }
    return {
      ok: false,
      motivo: "nenhuma_conta",
      message: contaTemNumero(conta)
        ? `${a.nome} não é de nenhuma conta cadastrada (banco ${a.bancoId || "—"}, conta ••••${final4 || "—"}).`
        : `Cadastre a agência e o número da conta ${conta.nome} para importar o extrato dela.`,
    };
  }
  if (!bancoDoArquivoConfere(a.bancoId, conta.banco)) {
    return {
      ok: false,
      motivo: "erro",
      message: `O arquivo é do banco ${rotuloDoBanco(a.bancoId)}, e a conta ${conta.nome} está cadastrada no ${conta.banco}.`,
    };
  }

  // A impressão digital é calculada aqui, com a conta do servidor.
  const marcas = digitais(a.movimentos, conta.id);
  const { data, error: rpcErr } = await supabase.rpc("importar_extrato", {
    p_conta_bancaria_id: conta.id,
    p_arquivo: {
      nome: a.nome,
      banco_id: a.bancoId,
      conta: a.conta,
      inicio: a.inicio,
      fim: a.fim,
      gerado_em: a.geradoInstante,
      saldo: a.saldoBanco,
      saldo_em: a.saldoEm,
      linhas: a.movimentos.map((m, i) => ({
        digital: marcas[i],
        data: m.data,
        valor: m.valor,
        tipo: m.tipo,
        historico: m.historico,
        documento: m.documento,
        fitid: m.fitid,
        ordem: m.ordem,
      })),
    },
  });
  if (rpcErr) {
    console.error("[conciliacao.importar]", rpcErr.message);
    return { ok: false, motivo: "erro", message: rpcErr.message };
  }
  const r = data as { movimentos: number; novos: number };
  revalidatePath("/financeiro/conciliacao");
  return { ok: true, movimentos: r.movimentos, novos: r.novos };
}
