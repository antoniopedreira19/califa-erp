/**
 * O que o diálogo "Exportar remessa Santander" recebe: as contas Santander
 * com convênio CNAB e os títulos a pagar que podem ir ao arquivo, com o
 * destinatário, a chave e a conta (decisão 137), a PP fora do cadastro
 * (decisão 127) e a retenção da aprovação descontada (decisão 145).
 *
 * Saiu de `page.tsx` em 21/10/2026 (decisão 195): a aba Títulos da
 * conciliação abre o mesmo diálogo, e a montagem tem de ser uma só.
 * Módulo puro — quem chama faz as leituras.
 */

import type { ContaBancaria, PagamentoForaDoCadastroDaPP, PixTipoChave, TipoContaBancariaFornecedor } from "@/lib/types";
import { temConta, temPix, type ColaboradorPagamento } from "@/lib/financeiro/colaboradores-pagamento";
import { montarRetencaoDaAprovacao } from "@/lib/fiscal/retencao-da-aprovacao";
import { aliquotasDaParcela, retencoesPelaAprovacao } from "@/lib/financeiro/baixa-em-lote";
import type { ContaSantanderElegivel, TituloElegivelParaRemessa } from "./remessa-cnab-dialog";
import type { PPRow } from "./pedidos-compra-list";

export interface EntradaDaRemessa {
  /** As contas ativas (o filtro Santander + convênio é daqui). */
  contas: ContaBancaria[];
  /** `fornecedores` com os campos de pagamento (`COLUNAS_DE_PAGAMENTO`). */
  fornecedores: unknown[] | null;
  colaboradores: Map<string, ColaboradorPagamento>;
  /** As PPs (`mapearPPsDoFinanceiro`): a fora do cadastro e a verba. */
  pps: ReadonlyArray<Pick<PPRow, "id" | "pagamento_fora_do_cadastro" | "verba_producao" | "parcelas">>;
  /** `pedidos_compra_retencoes` (pedido_compra_id, imposto, aliquota). */
  retencoesDaAprovacao: unknown[] | null;
  /** `vw_a_pagar` de saída. */
  aPagar: unknown[] | null;
}

export function montarDadosDaRemessa(e: EntradaDaRemessa): {
  contasSantander: ContaSantanderElegivel[];
  titulosCnab: TituloElegivelParaRemessa[];
} {
  const contasSantander: ContaSantanderElegivel[] = e.contas
    .filter(
      (c) =>
        c.ativo &&
        c.banco.toLowerCase().includes("santander") &&
        c.convenio_cnab_santander !== null &&
        c.agencia !== null &&
        c.numero_conta !== null &&
        c.numero_conta_dv !== null,
    )
    .map((c) => ({
      id: c.id,
      nome: c.nome,
      agencia: c.agencia!,
      numero_conta: c.numero_conta!,
      numero_conta_dv: c.numero_conta_dv!,
    }));

  // Decisão 137: chave e conta vão ao diálogo, para a coluna "Dados de
  // pagamento". `temPix`/`temBanco` seguem as mesmas regras do gerador.
  type DestinoNaRemessa = {
    nome: string;
    temPix: boolean;
    temBanco: boolean;
    pix: TituloElegivelParaRemessa["pix"];
    conta: TituloElegivelParaRemessa["conta"];
  };
  const pixDe = (tipo: string | null, chave: string | null): DestinoNaRemessa["pix"] =>
    tipo && chave ? { tipo: tipo as PixTipoChave, chave } : null;
  const contaDe = (d: {
    banco_codigo: string | null;
    banco_nome: string | null;
    agencia: string | null;
    agencia_dv: string | null;
    conta: string | null;
    conta_dv: string | null;
    tipo_conta: string | null;
  }): DestinoNaRemessa["conta"] =>
    d.banco_codigo && d.agencia && d.conta && d.conta_dv
      ? {
          banco_codigo: d.banco_codigo,
          banco_nome: d.banco_nome,
          agencia: d.agencia,
          agencia_dv: d.agencia_dv,
          conta: d.conta,
          conta_dv: d.conta_dv,
          tipo_conta: (d.tipo_conta as TipoContaBancariaFornecedor | null) ?? null,
        }
      : null;
  const fornecedorBancoMap = new Map<string, DestinoNaRemessa>();
  for (const f of (e.fornecedores ?? []) as Array<{
    id: string;
    nome: string;
    banco_codigo: string | null;
    banco_nome: string | null;
    agencia: string | null;
    agencia_dv: string | null;
    conta: string | null;
    conta_dv: string | null;
    tipo_conta: string | null;
    pix_tipo: string | null;
    pix_chave: string | null;
  }>) {
    const pix = pixDe(f.pix_tipo, f.pix_chave);
    const conta = contaDe(f);
    fornecedorBancoMap.set(f.id, { nome: f.nome, temPix: !!pix, temBanco: !!conta, pix, conta });
  }
  const colaboradorBancoMap = new Map<string, DestinoNaRemessa>();
  for (const c of e.colaboradores.values()) {
    colaboradorBancoMap.set(c.id, {
      nome: c.nome,
      temPix: temPix(c),
      temBanco: temConta(c),
      pix: temPix(c) ? pixDe(c.pix_tipo, c.pix_chave) : null,
      conta: temConta(c) ? contaDe(c) : null,
    });
  }
  // A PP fora do cadastro paga pela chave ou conta dela (decisão 137): o
  // título da remessa é a parcela, então o mapa vai da parcela à PP.
  const foraPorParcela = new Map<string, PagamentoForaDoCadastroDaPP>();
  for (const pp of e.pps) {
    if (!pp.pagamento_fora_do_cadastro) continue;
    for (const par of pp.parcelas) foraPorParcela.set(par.id, pp.pagamento_fora_do_cadastro);
  }
  // Decisão 145: a remessa paga a parcela de PP pelo líquido — o que falta
  // menos a retenção da aprovação, pela mesma conta da geração do arquivo.
  const linhasDaAprovacao = new Map<string, Array<{ imposto: string; aliquota: number | string | null }>>();
  for (const r of (e.retencoesDaAprovacao ?? []) as Array<{
    pedido_compra_id: string;
    imposto: string;
    aliquota: number | string | null;
  }>) {
    const lista = linhasDaAprovacao.get(r.pedido_compra_id) ?? [];
    lista.push(r);
    linhasDaAprovacao.set(r.pedido_compra_id, lista);
  }
  const aliquotasPorParcela = new Map<string, ReturnType<typeof aliquotasDaParcela>>();
  for (const pp of e.pps) {
    const aliquotas = aliquotasDaParcela({
      verba: pp.verba_producao,
      remessa: null,
      aliquotas: montarRetencaoDaAprovacao(linhasDaAprovacao.get(pp.id) ?? [], null)?.aliquotas ?? null,
    });
    if (!aliquotas) continue;
    for (const par of pp.parcelas) aliquotasPorParcela.set(par.id, aliquotas);
  }

  const titulosCnab: TituloElegivelParaRemessa[] = ((e.aPagar ?? []) as Array<{
    origem_tipo: string;
    origem_id: string;
    descricao: string;
    valor: string | number;
    fornecedor_id: string | null;
    colaborador_id: string | null;
  }>)
    .map((row) => {
      let destinatario: DestinoNaRemessa | null = null;
      let destinatarioTipo: "fornecedor" | "colaborador" | null = null;
      if (row.colaborador_id) {
        destinatario = colaboradorBancoMap.get(row.colaborador_id) ?? null;
        destinatarioTipo = "colaborador";
      } else if (row.fornecedor_id) {
        destinatario = fornecedorBancoMap.get(row.fornecedor_id) ?? null;
        destinatarioTipo = "fornecedor";
      }
      if (!destinatario || !destinatarioTipo) return null;
      // A view expõe "pp"/"avulsa"/"folha"/"recorrente"/"desembolso" — todos válidos.
      const origemTipo = row.origem_tipo as
        | "pp"
        | "avulsa"
        | "folha"
        | "recorrente"
        | "desembolso";
      const fora = origemTipo === "pp" ? (foraPorParcela.get(row.origem_id) ?? null) : null;
      // Decisão 161: PP paga por boleto não entra na remessa (o gerador não
      // tem o segmento J) — paga-se pelo boleto anexado.
      if (fora?.meio === "boleto") return null;
      const pixFora = fora?.meio === "pix" ? pixDe(fora.pix_tipo, fora.pix_chave) : null;
      const contaFora = fora?.meio === "conta" ? contaDe(fora) : null;
      const bruto = Number(row.valor);
      const { retido, liquido } =
        origemTipo === "pp"
          ? retencoesPelaAprovacao(bruto, aliquotasPorParcela.get(row.origem_id) ?? null)
          : { retido: 0, liquido: bruto };
      const linha: TituloElegivelParaRemessa = {
        origemTipo,
        origemId: row.origem_id,
        descricao: row.descricao,
        valor: liquido,
        bruto,
        retido,
        destinatarioNome: destinatario.nome,
        destinatarioTipo,
        // Fora do cadastro, só o meio da PP vale: a forma fica fixa.
        temPix: fora ? !!pixFora : destinatario.temPix,
        temBanco: fora ? !!contaFora : destinatario.temBanco,
        pix: fora ? pixFora : destinatario.pix,
        conta: fora ? contaFora : destinatario.conta,
        foraDoCadastro: fora,
      };
      return linha;
    })
    .filter((t): t is TituloElegivelParaRemessa => t !== null)
    .sort((a, b) =>
      a.destinatarioNome.localeCompare(b.destinatarioNome, "pt-BR"),
    );


  return { contasSantander, titulosCnab };
}
