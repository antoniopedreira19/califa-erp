import { z } from "zod";

/** Schema do parâmetro `dataPagamento` de `enviarProFinanceiro`.
 *  Formato ISO curto ("YYYY-MM-DD") compatível com `<input type="date">`. */
export const dataPagamentoSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional();
