/**
 * As regras puras das NFs presas ao job da planilha (decisão 276): o nome
 * comparado e o mês que a NF do job mensal fatura.
 */

/** O nome comparado como o banco compara (`_nome_de_job_comparavel`): sem
 *  acento, sem caixa e com os espaços de um em um. */
export function nomeComparavel(nome: string | null | undefined): string {
  return (nome ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/** O mês anterior ao da emissão ("2026-11-03" → "2026-10-01"). */
export function mesDaNotaMensal(emissao: string): string {
  const [ano, mes] = emissao.slice(0, 7).split("-").map(Number);
  const a = mes === 1 ? ano - 1 : ano;
  const m = mes === 1 ? 12 : mes - 1;
  return `${a}-${String(m).padStart(2, "0")}-01`;
}

/**
 * O mês que a NF do job mensal fatura (Tiago, 23/11/2026): o anterior ao da
 * emissão (a 6397, emitida em 03/11, fatura outubro); se esse mês não é do
 * job, o mês da emissão (o job do 4T faturado no próprio mês: emitida em
 * 09/10, fatura outubro). Nulo: nenhum dos dois é do job.
 */
export function mesDaNotaNoJob(emissao: string, mesesDoJob: readonly string[]): string | null {
  const anterior = mesDaNotaMensal(emissao);
  if (mesesDoJob.includes(anterior)) return anterior;
  const daEmissao = `${emissao.slice(0, 7)}-01`;
  return mesesDoJob.includes(daEmissao) ? daEmissao : null;
}

/** Os jobs da planilha que casam com o que se digita no nome (a sugestão da
 *  abertura): todas as palavras digitadas aparecem no nome, sem acento e sem
 *  caixa. O nome igual vem primeiro. */
export function sugestoesDoNome<T extends { nome: string }>(jobs: readonly T[], digitado: string, limite = 8): T[] {
  const alvo = nomeComparavel(digitado);
  if (alvo.length < 2) return [];
  const palavras = alvo.split(" ");
  return jobs
    .filter((j) => {
      const n = nomeComparavel(j.nome);
      return palavras.every((p) => n.includes(p));
    })
    .sort((a, b) => Number(nomeComparavel(b.nome) === alvo) - Number(nomeComparavel(a.nome) === alvo) || a.nome.localeCompare(b.nome, "pt-BR"))
    .slice(0, limite);
}
