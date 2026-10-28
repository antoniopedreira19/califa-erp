// Os casos da caixa do Comitê de Aprovações (decisão 223), como a página os
// monta a partir de `comite_pedidos`. Os números vêm do retrato que o banco
// gravou no envio e na decisão (`snapshot`).

interface BaseDoCaso {
  id: string;
  situacao: "pendente" | "aprovado" | "devolvido";
  motivo: string;
  enviadoPor: string;
  /** O papel de quem enviou (`profiles.role`), para a coluna "Enviado por". */
  enviadoPorPapel: string | null;
  enviadoEm: string;
  decididoPor: string | null;
  decididoEm: string | null;
  comentario: string | null;
  projeto: string;
  cliente: string;
  empresa: string;
  regional: string;
  /** A planilha do caso, no modo do Comitê, para o pop-up. */
  href: string | null;
}

export interface CasoDeVersao extends BaseDoCaso {
  tipo: "versao";
  orcamento: string;
  versao: number;
  valorJob: number;
  resultadoGeral: number | null;
  itensAcima: number;
  /** Decisão 225: a versão tinha exceção no fechamento do internacional. */
  comExcecao: boolean;
}

export interface CasoDePP extends BaseDoCaso {
  tipo: "pp";
  jobCodigo: string;
  jobNome: string;
  item: string;
  servico: string;
  fornecedor: string;
  valorPP: number;
  orcadoItem: number;
  planejadoItem: number;
  realizadoComAPP: number;
  excesso: number;
  linhaVermelha: boolean;
}

export type CasoDoComite = CasoDeVersao | CasoDePP;

export interface MembroDoComite {
  id: string;
  nome: string;
  papel: string | null;
}

export interface UsuarioParaComite {
  id: string;
  nome: string;
}

/** O aviso que a página aberta no pop-up manda à caixa ao decidir. */
export const MENSAGEM_DECIDIDO = "comite:decidido";
