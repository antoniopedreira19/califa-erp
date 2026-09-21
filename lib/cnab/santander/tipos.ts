/**
 * Tipos que descrevem os inputs do gerador CNAB 240 Santander.
 *
 * Modelagem: a biblioteca é agnóstica ao banco/Supabase — recebe dados
 * já resolvidos como estruturas puras. Quem tira do banco (server
 * action) é responsável por buscar/juntar/validar os dados.
 */

/** Empresa pagadora (dona do CNPJ que assina o débito). */
export interface EmpresaPagadora {
  /** CNPJ em 14 dígitos, sem máscara. */
  cnpj: string;
  /** Razão social — vai truncar em 30 chars e sanitizar acento. */
  razaoSocial: string;
  /** Endereço fiscal — opcional pelo layout, mas melhor preencher. */
  enderecoLogradouro: string | null;
  enderecoCidade: string | null;
  /** CEP em 8 dígitos (pode ser separado em 5+3 pelo gerador). */
  enderecoCep: string | null;
  enderecoUf: string | null;
}

/** Conta bancária de débito (dona do convênio Santander). */
export interface ContaDebito {
  /** Agência da conta Santander em dígitos, sem DV. */
  agencia: string;
  /** DV da agência (pode ser vazio — o Santander aceita). */
  agenciaDv: string | null;
  /** Número da conta em dígitos, sem DV. */
  conta: string;
  /** DV da conta. */
  contaDv: string;
  /** Código do convênio de 20 posições alfanuméricas. */
  convenio: string;
}

/**
 * Um pagamento individual no arquivo. A biblioteca decide qual segmento
 * gerar a partir do tipo. Boleto e PIX QR não estão no MVP — só CC/TED/PIX
 * por chave/dados bancários (segmentos A + B).
 */
export type Pagamento =
  | PagamentoCreditoContaOuTED
  | PagamentoPixChave
  | PagamentoPixDadosBancarios;

/** Base comum a todos os pagamentos. */
interface PagamentoBase {
  /** ID interno do pagamento — vai no "Nro. do Documento Cliente" (seu número).
   *  Deve caber em 20 chars alfanuméricos. */
  seuNumero: string;
  /** Data em que o pagamento deve efetivar (YYYY-MM-DD). */
  dataPagamento: string;
  /** Valor em BRL (número ou string decimal). */
  valor: number | string;
  /** Nome do favorecido — 30 chars, sanitizado. */
  nomeFavorecido: string;
  /** CPF (11 dígitos) ou CNPJ (14 dígitos) do favorecido. */
  documentoFavorecido: string;
  /** true = CNPJ, false = CPF. */
  favorecidoEhCnpj: boolean;
  /** Endereço do favorecido (opcional na maioria dos casos). */
  favorecidoLogradouro?: string | null;
  favorecidoNumero?: string | null;
  favorecidoBairro?: string | null;
  favorecidoCidade?: string | null;
  favorecidoCep?: string | null;
  favorecidoUf?: string | null;
}

/** Crédito em CC/Poupança OU TED — segmento A com dados bancários preenchidos.
 *  Distinção CC vs TED é o `formaLancamento` do header de lote:
 *    01 = CC Santander, 03 = TED, 05 = Poupança. */
export interface PagamentoCreditoContaOuTED extends PagamentoBase {
  tipo: "credito_conta" | "ted";
  /** Código FEBRABAN do banco favorecido (3 dígitos). */
  bancoFavorecido: string;
  /** Agência favorecida (dígitos, sem DV). */
  agenciaFavorecida: string;
  agenciaFavorecidaDv: string | null;
  /** Conta favorecida. */
  contaFavorecida: string;
  contaFavorecidaDv: string;
  /** corrente | poupanca | pagamento — determina o G013 B do segmento A. */
  tipoContaFavorecida: "corrente" | "poupanca" | "pagamento";
  /** Finalidade da TED (5 dígitos, Nota G013 A). Obrigatório pra TED, ignorado pra CC.
   *  Ex.: "00005" = Pagamento a Fornecedores. */
  finalidadeTED?: string;
}

/** PIX por chave — segmento A + segmento B com forma de iniciação e chave. */
export interface PagamentoPixChave extends PagamentoBase {
  tipo: "pix_chave";
  tipoChave: "cpf" | "cnpj" | "email" | "telefone" | "aleatoria";
  chave: string;
}

/** PIX por dados bancários — segmento A + segmento B com forma de iniciação "05". */
export interface PagamentoPixDadosBancarios extends PagamentoBase {
  tipo: "pix_dados";
  bancoFavorecido: string;
  agenciaFavorecida: string;
  agenciaFavorecidaDv: string | null;
  contaFavorecida: string;
  contaFavorecidaDv: string;
  tipoContaFavorecida: "corrente" | "poupanca" | "pagamento";
}

/** Metadados do arquivo. */
export interface MetadadosArquivo {
  /** Sequencial do arquivo — >= 11 (o banco trata 1-10 como teste). */
  sequencialArquivo: number;
  /** Momento de geração (usado no header e no trailer). */
  dataGeracao: Date;
}
