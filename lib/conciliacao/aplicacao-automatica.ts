/**
 * O extrato completo da conta com aplicação automática (decisão 249).
 *
 * O banco aplica sozinho, no fim de cada dia, o que sobra na corrente
 * (ContaMax, Rende Fácil) e resgata quando falta. O extrato completo traz
 * essas aplicações e esses resgates como linhas; o formato novo do Santander
 * não traz, e com ele a corrente do sistema não bate com a do banco (o
 * extrato de 31/10/2026 da California Santander). Por isso a importação
 * recusa o arquivo de conta com aplicação que tem movimento num dia já
 * fechado e nenhuma linha de aplicação ou resgate.
 *
 * As linhas se reconhecem pelas regras de transferência da conta para a
 * aplicação ("APLICACAO CONTAMAX", "RESGATE CONTAMAX AUTOMATICO", "BB RENDE
 * FACIL"), do mesmo jeito que o motor casa a regra: o histórico normalizado
 * começa pelo padrão. O dia em que o arquivo foi gerado fica de fora: a
 * aplicação só acontece no fim do dia.
 */
import { normalizar } from "./ofx";

export function faltamAsAplicacoes(
  movimentos: ReadonlyArray<{ data: string; historico: string }>,
  padroes: ReadonlyArray<string>,
  geradoEm: string | null,
): boolean {
  const prefixos = padroes.map(normalizar).filter(Boolean);
  // Sem regra, não há como reconhecer a linha: a importação segue.
  if (prefixos.length === 0) return false;
  const temDiaFechado = movimentos.some((m) => m.data && (!geradoEm || m.data < geradoEm));
  if (!temDiaFechado) return false;
  return !movimentos.some((m) => {
    const h = normalizar(m.historico);
    return prefixos.some((p) => h.startsWith(p));
  });
}
