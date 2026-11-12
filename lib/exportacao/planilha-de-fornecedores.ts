import ExcelJS from "exceljs";
import type { Fornecedor } from "@/lib/types";
import { descricaoDoCnae } from "@/lib/fiscal/cnaes";
import { ROTULO_DO_REGIME, formatarCnae } from "@/lib/fiscal/regime-do-fornecedor";
import { PIX_TIPOS, chavePixParaExibir } from "@/lib/pix";
import { diaIsoBr } from "@/lib/formatar-data-hora";
import { formatCep, formatDocumento, formatTelefone } from "@/lib/utils";

/**
 * "Exportar Excel" da tela de Fornecedores (pedido do Tiago, 12/11/2026):
 * um fornecedor por linha, com TODOS os campos do cadastro, cada um numa
 * coluna — endereço, conta e PIX separados, para filtrar no Excel.
 *
 * Saem os fornecedores que a tela mostra (busca, "Mostrar inativos" e os
 * filtros dos títulos), na ordem da tela, como no "Exportar Excel" da
 * Visualizar Jobs (16/10/2026). A rota lê o cadastro inteiro do banco: a
 * lista da tela só carrega o que mostra.
 *
 * Só no servidor: a lista do CNAE (lib/fiscal/cnaes) e o ExcelJS pesariam
 * no pacote da página (`docs/PERFORMANCE.md`).
 *
 * Testes: node --import tsx --test lib/exportacao/planilha-de-fornecedores.test.ts
 */

type Valor = string | Date | null;

interface Coluna {
  cabecalho: string;
  largura: number;
  valor: (f: Fornecedor, ehVeiculo: boolean) => Valor;
}

const TIPO_DE_CONTA: Record<NonNullable<Fornecedor["tipo_conta"]>, string> = {
  corrente: "Conta corrente",
  poupanca: "Conta poupança",
  pagamento: "Conta de pagamento",
};

const simOuNao = (b: boolean | null | undefined): string => (b ? "Sim" : "Não");

/** Coluna `date` ou `timestamptz` como data do Excel, pelo dia de
 *  Brasília. UTC: o Excel não tem fuso, e a meia-noite local viraria o dia
 *  anterior em quem abre fora de Brasília. */
function dataDoExcel(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const [ano, mes, dia] = diaIsoBr(iso).split("-").map(Number);
  if (!ano || !mes || !dia) return null;
  return new Date(Date.UTC(ano, mes - 1, dia));
}

const COLUNAS_DE_DATA = new Set(["Optante desde", "Consulta do CNPJ em", "Cadastrado em", "Atualizado em"]);

export const COLUNAS_DA_PLANILHA_DE_FORNECEDORES: readonly Coluna[] = [
  { cabecalho: "Nome", largura: 34, valor: (f) => f.nome },
  { cabecalho: "Razão social", largura: 38, valor: (f) => f.razao_social },
  {
    cabecalho: "Tipo",
    largura: 15,
    valor: (f) => (f.tipo_pessoa === "fisica" ? "Pessoa física" : "Pessoa jurídica"),
  },
  // Na pessoa física o documento é o CPF: o título diz os dois.
  { cabecalho: "CNPJ / CPF", largura: 20, valor: (f) => (f.cpf_cnpj ? formatDocumento(f.cpf_cnpj) : null) },
  { cabecalho: "Status", largura: 9, valor: (f) => (f.status === "ativo" ? "Ativo" : "Inativo") },
  {
    cabecalho: "Regime tributário",
    largura: 22,
    valor: (f) => (f.regime_tributario ? ROTULO_DO_REGIME[f.regime_tributario] : null),
  },
  { cabecalho: "CNAE", largura: 11, valor: (f) => (f.cnae ? formatarCnae(f.cnae) : null) },
  { cabecalho: "Atividade (CNAE)", largura: 50, valor: (f) => descricaoDoCnae(f.cnae) },
  // O que a consulta do CNPJ indicou (decisão 142): diferente do regime
  // acima, ele foi alterado à mão.
  {
    cabecalho: "Regime pela consulta do CNPJ",
    largura: 22,
    valor: (f) => (f.regime_consulta ? ROTULO_DO_REGIME[f.regime_consulta] : null),
  },
  { cabecalho: "Optante desde", largura: 13, valor: (f) => dataDoExcel(f.regime_desde) },
  { cabecalho: "Consulta do CNPJ em", largura: 13, valor: (f) => dataDoExcel(f.regime_consultado_em) },
  {
    cabecalho: "Declaração do Simples recebida",
    largura: 14,
    valor: (f) => (f.tipo_pessoa === "fisica" ? null : simOuNao(f.declaracao_simples_recebida)),
  },
  { cabecalho: "E-mail", largura: 30, valor: (f) => f.email },
  { cabecalho: "Telefone", largura: 17, valor: (f) => (f.telefone ? formatTelefone(f.telefone) : null) },
  { cabecalho: "CEP", largura: 11, valor: (f) => (f.cep ? formatCep(f.cep) : null) },
  { cabecalho: "Logradouro", largura: 32, valor: (f) => f.logradouro },
  { cabecalho: "Número", largura: 9, valor: (f) => f.numero },
  { cabecalho: "Complemento", largura: 18, valor: (f) => f.complemento },
  { cabecalho: "Bairro", largura: 20, valor: (f) => f.bairro },
  { cabecalho: "Cidade", largura: 20, valor: (f) => f.cidade },
  { cabecalho: "UF", largura: 5, valor: (f) => f.uf },
  { cabecalho: "Código do banco", largura: 9, valor: (f) => f.banco_codigo },
  { cabecalho: "Banco", largura: 26, valor: (f) => f.banco_nome },
  { cabecalho: "Agência", largura: 9, valor: (f) => f.agencia },
  { cabecalho: "Dígito da agência", largura: 9, valor: (f) => f.agencia_dv },
  { cabecalho: "Conta", largura: 14, valor: (f) => f.conta },
  { cabecalho: "Dígito da conta", largura: 9, valor: (f) => f.conta_dv },
  { cabecalho: "Tipo de conta", largura: 18, valor: (f) => (f.tipo_conta ? TIPO_DE_CONTA[f.tipo_conta] : null) },
  {
    cabecalho: "Tipo da chave PIX",
    largura: 15,
    valor: (f) => (f.pix_tipo ? (PIX_TIPOS.find((t) => t.valor === f.pix_tipo)?.rotulo ?? f.pix_tipo) : null),
  },
  { cabecalho: "Chave PIX", largura: 34, valor: (f) => chavePixParaExibir(f.pix_tipo, f.pix_chave) || null },
  // Decisão 161: a cada PP o fornecedor manda boleto ou chave aleatória.
  { cabecalho: "Sem conta nem PIX no cadastro", largura: 14, valor: (f) => simOuNao(f.sem_dados_pagamento) },
  { cabecalho: "Veículo de mídia", largura: 10, valor: (_f, ehVeiculo) => simOuNao(ehVeiculo) },
  // Decisão 230: faz mútuo com o grupo sem ter conta no sistema.
  { cabecalho: "Empresa de fora do grupo (mútuo)", largura: 14, valor: (f) => simOuNao(f.empresa_de_fora) },
  { cabecalho: "Observações", largura: 40, valor: (f) => f.observacoes },
  { cabecalho: "Cadastrado em", largura: 13, valor: (f) => dataDoExcel(f.created_at) },
  { cabecalho: "Atualizado em", largura: 13, valor: (f) => dataDoExcel(f.updated_at) },
];

/** O arquivo, com os fornecedores na ordem recebida. */
export function montarPlanilhaDeFornecedores(
  fornecedores: readonly Fornecedor[],
  veiculoIds: ReadonlySet<string>,
): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Califa ERP";
  const ws = wb.addWorksheet("Fornecedores", {
    // Cabeçalho e nome sempre à vista.
    views: [{ state: "frozen", ySplit: 1, xSplit: 1 }],
  });
  const colunas = COLUNAS_DA_PLANILHA_DE_FORNECEDORES;
  ws.columns = colunas.map((c) => ({ width: c.largura }));

  const cabecalho = ws.addRow(colunas.map((c) => c.cabecalho));
  cabecalho.font = { bold: true };
  cabecalho.alignment = { vertical: "middle", wrapText: true };
  cabecalho.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F3F2" } };
  });

  for (const f of fornecedores) {
    const ehVeiculo = veiculoIds.has(f.id);
    const row = ws.addRow(colunas.map((c) => c.valor(f, ehVeiculo) ?? null));
    colunas.forEach((c, i) => {
      if (COLUNAS_DE_DATA.has(c.cabecalho)) row.getCell(i + 1).numFmt = "dd/mm/yyyy";
    });
  }

  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, fornecedores.length + 1), column: colunas.length },
  };
  return wb;
}

/** "Fornecedores - 12-11-2026.xlsx", no dia de Brasília; "(filtrado)" diz a
 *  quem abre depois que não é a lista inteira. */
export function nomeDoArquivoDeFornecedores(filtrado: boolean, agora = new Date()): string {
  const [ano, mes, dia] = diaIsoBr(agora.toISOString()).split("-");
  return `Fornecedores${filtrado ? " (filtrado)" : ""} - ${dia}-${mes}-${ano}.xlsx`;
}
