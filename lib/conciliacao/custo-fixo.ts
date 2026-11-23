// Como o pagamento de um custo fixo (título de recorrência) é reconhecido no
// extrato. Decisão 272 (23/11/2026). Uma regra só, usada pelo motor da
// Conciliação (passo 3) e pelo status "A conciliar" da aba Recorrências.
//
// O título da recorrência casa com a linha do banco quando:
// - a data do banco está na janela de 12 dias antes a 5 dias depois do
//   vencimento (o lote do dia 9 paga as contas do dia 20; o domingo empurra
//   para segunda);
// - o valor é o do título; na conta que varia, até 20% a mais ou a menos
//   (a diferença vira "Corrigir o valor do título");
// - no débito automático, o histórico começa com o texto da recorrência
//   (pesa a favor, não basta sozinho: o valor ainda tem de caber).
// A linha pode ser de qualquer conta: a conta bancária não pertence a uma
// empresa (decisão 064) e a recorrência não guarda conta de pagamento.
// Nada se concilia sozinho (decisão 244): isto só sugere.

export const JANELA_ANTES = 12;
export const JANELA_DEPOIS = 5;
export const TOLERANCIA_DA_CONTA_QUE_VARIA = 0.2;

/** O que o motor precisa saber da recorrência do título. */
export interface CustoFixoDoTitulo {
  /** REC-00001 */
  codigo: string;
  /** A conta varia todo mês (luz, água, celular). */
  variavel: boolean;
  /** Débito automático: o começo do histórico do banco. */
  textoNoExtrato: string | null;
}

export interface ReconhecimentoDoCustoFixo {
  /** O que soma à pontuação do motor. */
  bonus: number;
  /** A frase da sugestão: "custo fixo REC-00001 · valor exato · 1 dia depois do vencimento (08/11)". */
  motivo: string;
  valorIgual: boolean;
  /** Banco − título, em reais (positivo: o banco tem mais). */
  diferenca: number;
  /** Banco − vencimento, em dias (negativo: pago antes). */
  diasDoVencimento: number;
}

const normalizar = (s: string | null | undefined) =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

const dias = (de: string, ate: string) =>
  Math.round((Date.parse(ate.slice(0, 10) + "T12:00:00Z") - Date.parse(de.slice(0, 10) + "T12:00:00Z")) / 86_400_000);

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const diaMes = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/**
 * A linha do banco paga este título de custo fixo? Devolve nulo quando não.
 * `linha.valor` é o do extrato (saída negativa); `valorTitulo`, o que falta
 * pagar, positivo.
 */
export function reconhecerCustoFixo(
  custo: CustoFixoDoTitulo,
  linha: { data: string; valor: number; historico: string },
  vencimento: string,
  valorTitulo: number,
): ReconhecimentoDoCustoFixo | null {
  if (!(linha.valor < 0) || !(valorTitulo > 0)) return null;
  const d = dias(vencimento, linha.data);
  if (d < -JANELA_ANTES || d > JANELA_DEPOIS) return null;
  const valor = Math.abs(linha.valor);
  const diferenca = Math.round((valor - valorTitulo) * 100) / 100;
  const valorIgual = Math.abs(diferenca) < 0.005;
  const cabe = valorIgual || (custo.variavel && Math.abs(diferenca) <= valorTitulo * TOLERANCIA_DA_CONTA_QUE_VARIA);
  if (!cabe) return null;
  const texto = normalizar(custo.textoNoExtrato);
  const porTexto = texto.length > 0 && normalizar(linha.historico).startsWith(texto);
  const quando =
    d === 0
      ? "no vencimento"
      : d < 0
        ? `${-d} ${d === -1 ? "dia" : "dias"} antes do vencimento (${diaMes(vencimento)})`
        : `${d} ${d === 1 ? "dia" : "dias"} depois do vencimento (${diaMes(vencimento)})`;
  const partes = [
    `custo fixo ${custo.codigo}`,
    porTexto ? "débito automático pelo texto do extrato" : null,
    valorIgual
      ? "valor exato"
      : `conta que varia: ${brl(valorTitulo)} previsto, ${brl(valor)} no banco (${diferenca > 0 ? "+" : ""}${brl(diferenca)})`,
    quando,
  ].filter(Boolean);
  return {
    bonus: (porTexto ? 40 : 0) - (valorIgual ? 0 : 10),
    motivo: partes.join(" · "),
    valorIgual,
    diferenca,
    diasDoVencimento: d,
  };
}
