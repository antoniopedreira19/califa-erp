/**
 * Nome de exibição de uma versão do orçamento.
 *
 * Desde 13/08/2026 o nome da versão **não é mais digitado**: ele é sempre
 * o nome do job seguido do número da versão. Antes era texto livre e
 * opcional em `versoes_orcamento.nome`, editável no título da tela e no
 * drawer — e o resultado eram versões com nomes que não diziam de qual
 * job eram ("V Teste", "Proposta inicial") convivendo com versões sem
 * nome nenhum, que caíam em "Versão 2".
 *
 * **É calculado na leitura, nunca gravado** (decisão do time). Renomear o
 * job renomeia todas as versões dele junto, e não existe caminho pelo
 * qual o nome divirja da sua origem. A coluna `nome` continua no banco
 * com o conteúdo antigo, mas nenhuma tela lê e nenhuma action escreve:
 * preservar o dado custa nada e apagar seria destrutivo à toa.
 *
 * O "nome do job" é sempre `orcamentos.nome` — o campo que o formulário
 * de novo orçamento chama de "Nome do Job". Não é `jobs.nome`: a versão
 * existe desde muito antes de haver job, e as telas que listam versões
 * não carregam job nenhum. Se alguém renomear o job depois da abertura, o
 * nome da versão segue o do orçamento (decisão do time, 13/08/2026).
 */
export function nomeVersao(nomeJob: string, numeroVersao: number): string {
  return `${nomeJob} - V${numeroVersao}`;
}
