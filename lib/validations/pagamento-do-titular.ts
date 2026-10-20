import { z } from "zod";
import { normalizarChavePix, problemaDaChavePix } from "@/lib/pix";
import { getBancoByCodigo } from "@/lib/dados/bancos-febraban";
import type { PagamentoDoTitular } from "@/lib/types";

/**
 * O PIX ou a conta do titular da verba que não paga pelo cadastro (decisão
 * 193, 19/10/2026): o freela sem PIX completo no cadastro de freelas e o
 * colaborador sem conta nem PIX na ficha do RH. Quem gera a PP digita UM
 * meio; o outro vai nulo.
 *
 * A régua é a do cadastro de fornecedor (decisões 090 e 101): a chave é
 * conferida e normalizada por `lib/pix`, e a conta segue os mesmos formatos.
 * O dado vai para as colunas da foto de pagamento da PP, as mesmas que o
 * gatilho preenche para quem paga pelo cadastro, e o PDF o imprime no bloco
 * "Dados bancários do titular".
 */

const opcional = z
  .string()
  .nullable()
  .optional()
  .transform((v) => (v ?? "").trim());

export const pagamentoDoTitularSchema = z
  .object({
    meio: z.enum(["pix", "conta"], {
      errorMap: () => ({ message: "Escolha PIX ou conta bancária para o titular." }),
    }),
    pix_tipo: z.enum(["cpf", "cnpj", "email", "telefone", "aleatoria"]).nullable().optional(),
    pix_chave: opcional,
    banco_codigo: opcional,
    agencia: opcional,
    agencia_dv: opcional,
    conta: opcional,
    conta_dv: opcional,
    tipo_conta: z.enum(["corrente", "poupanca", "pagamento"]).nullable().optional(),
  })
  .superRefine((d, ctx) => {
    const falha = (message: string) => ctx.addIssue({ code: "custom", message });
    if (d.meio === "pix") {
      if (!d.pix_tipo) return falha("Escolha o tipo da chave PIX do titular.");
      if (!d.pix_chave) return falha("Escreva a chave PIX do titular.");
      const problema = problemaDaChavePix(d.pix_tipo, d.pix_chave);
      if (problema) falha(problema);
      return;
    }
    if (!d.banco_codigo || !getBancoByCodigo(d.banco_codigo)) return falha("Escolha o banco da conta do titular.");
    if (!/^[0-9]{3,5}$/.test(d.agencia)) return falha("A agência do titular tem de 3 a 5 números.");
    if (d.agencia_dv && !/^[0-9X]$/.test(d.agencia_dv.toUpperCase())) return falha("O dígito da agência do titular é inválido.");
    if (!/^[0-9]{4,12}$/.test(d.conta)) return falha("A conta do titular tem de 4 a 12 números.");
    if (!/^[0-9X]$/.test(d.conta_dv.toUpperCase())) return falha("Falta o dígito da conta do titular.");
    if (!d.tipo_conta) falha("Escolha o tipo da conta do titular.");
  })
  .transform((d): PagamentoDoTitular => {
    if (d.meio === "pix") {
      return {
        meio: "pix",
        pix_tipo: d.pix_tipo ?? null,
        pix_chave: normalizarChavePix(d.pix_tipo, d.pix_chave) ?? null,
        banco_codigo: null,
        banco_nome: null,
        agencia: null,
        agencia_dv: null,
        conta: null,
        conta_dv: null,
        tipo_conta: null,
      };
    }
    return {
      meio: "conta",
      pix_tipo: null,
      pix_chave: null,
      banco_codigo: d.banco_codigo,
      banco_nome: getBancoByCodigo(d.banco_codigo)?.nome ?? null,
      agencia: d.agencia,
      agencia_dv: d.agencia_dv ? d.agencia_dv.toUpperCase() : null,
      conta: d.conta,
      conta_dv: d.conta_dv.toUpperCase(),
      tipo_conta: d.tipo_conta ?? null,
    };
  });

export type PagamentoDoTitularInput = z.input<typeof pagamentoDoTitularSchema>;
