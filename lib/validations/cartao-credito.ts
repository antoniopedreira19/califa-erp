import { z } from "zod";

const bandeiraEnum = z.enum([
  "visa",
  "master",
  "elo",
  "amex",
  "hipercard",
  "outra",
]);

export const criarCartaoSchema = z.object({
  nome: z
    .string()
    .trim()
    .min(2, "Nome muito curto.")
    .max(80, "Nome muito longo."),
  banco: z.string().trim().min(2, "Informe o banco.").max(80),
  bandeira: bandeiraEnum,
  ultimos_4_digitos: z
    .string()
    .regex(/^\d{4}$/, "Digite exatamente 4 números."),
  dono: z.string().trim().min(2, "Informe o dono do cartão.").max(80),
  dia_vencimento_fatura: z
    .number({ invalid_type_error: "Informe o dia do vencimento." })
    .int("Deve ser um número inteiro.")
    .min(1, "Dia entre 1 e 31.")
    .max(31, "Dia entre 1 e 31."),
  // FECHAMENTO decide em qual fatura a compra cai; VENCIMENTO decide
  // quando ela é paga. Obrigatório desde 28/08/2026: sem ele a conta usa
  // o vencimento como fronteira e joga compra para a fatura errada em
  // todo cartão que fecha e vence em dias distantes (28/08/2026).
  dia_fechamento_fatura: z
    .number({ invalid_type_error: "Informe o dia do fechamento." })
    .int("Deve ser um número inteiro.")
    .min(1, "Dia entre 1 e 31.")
    .max(31, "Dia entre 1 e 31."),
});

export const atualizarCartaoSchema = criarCartaoSchema.extend({
  id: z.string().uuid(),
});

export type CriarCartaoInput = z.infer<typeof criarCartaoSchema>;
export type AtualizarCartaoInput = z.infer<typeof atualizarCartaoSchema>;
