import * as React from "react";
import {
  ArrowLeftRight,
  Banknote,
  Check,
  CreditCard,
  FileText,
  HandCoins,
  Info,
  Landmark,
  Paperclip,
  Pencil,
  PiggyBank,
  Plus,
  Repeat,
  Scale,
  Trash2,
  Undo2,
  XCircle,
} from "lucide-react";
import { CARTOES, CENTROS, CONTAS, HOJE, SUBTIPOS, ULTIMA_RETENCAO } from "./data";
import { Botao, Campo, centroTexto, cn, dataBR, Dialogo, Entrada, Escolha, moeda, Nota, Resumo, trimestre } from "./ui";
import { aberto, descricaoDoLancamento, entra, faturaDestino, lancamentoDaBaixa, opcoesDeFatura, ORIGEM_DO_LOTE, r2, comoRecomendada, rotuloCompetencia, totalDosItens } from "./logica";
import { ITEM_TIPO } from "./titulos";

const OP_CONTAS = CONTAS.map((c) => ({ value: c.id, label: `${c.nome} · ${c.banco}` }));
const EMPRESAS = ["Agência California", "Hitlab", "GoCrazy", "Empresa Teste"];

export function SeletorCentro({ valor, onChange, natureza = "saida", travado }) {
  const tipos = Object.keys(CENTROS).filter((k) => (natureza === "entrada" ? ["01", "10"].includes(k) : !["01", "10"].includes(k)));
  return (
    <div className="grid grid-cols-2 gap-2">
      <Escolha
        value={valor?.tipo}
        onChange={(v) => onChange({ tipo: v, sub: SUBTIPOS[v]?.[0] })}
        opcoes={tipos.map((k) => ({ value: k, label: `${k} · ${CENTROS[k]}` }))}
        placeholder="Tipo..."
      />
      <Escolha value={valor?.sub} onChange={(v) => onChange({ ...valor, sub: v })} opcoes={SUBTIPOS[valor?.tipo] ?? []} placeholder={valor?.tipo ? "Subtipo..." : "Escolha o tipo primeiro"} />
      {travado && <p className="col-span-2 text-[11px] text-muted-foreground">Vem do título: a PP nasce com o centro de custo da planilha do job.</p>}
    </div>
  );
}

// ===========================================================================
// A baixa — de um título ou de um lote — com a prévia do Extrato
// ===========================================================================

// As formas do enum forma_pagamento (migration 20260820000001). O cartão só
// vale na baixa de um título sozinho de PP, avulso, recorrência ou
// desembolso, sem baixa parcial antes: folha, fatura, imposto e devolução
// de verba não vão para o cartão, e a baixa em lote também não.
const FORMAS = [
  { value: "pix", label: "PIX" },
  { value: "transferencia", label: "Transferência" },
  { value: "boleto", label: "Boleto" },
];
const FORMA_CARTAO = { value: "cartao", label: "Cartão de Crédito" };
const OP_CARTOES = CARTOES.map((c) => ({ value: c.id, label: `${c.nome} · ${c.bandeira} · ••••${c.final}` }));

// O que vai para o cartão: PP, avulso, recorrência e desembolso sem baixa
// parcial antes. Folha, fatura, imposto e devolução de verba, nunca.
const vaiNoCartao = (t) => ["pp", "avulso", "recorrencia", "desembolso"].includes(t.origem) && !(t.baixado > 0);
// A forma vem sempre PIX, a mais comum (pedido do Tiago, 20/10/2026): nem
// a forma do título nem a da aprovação pré-preenchem. A exceção é a baixa
// aberta por uma linha do banco, em que o histórico diz como o dinheiro
// saiu.
const FORMA_DO_BANCO = { pix: "pix", ted: "transferencia", boleto: "boleto", concessionaria: "boleto" };
const formaInicial = (formaDoBanco) => FORMA_DO_BANCO[formaDoBanco] ?? "pix";
const cartaoInicial = (itens) => {
  const cs = [...new Set(itens.map((t) => t.cartaoPrevisto).filter(Boolean))];
  return cs.length === 1 ? cs[0] : "cc1";
};
/** Por que o lote não oferece o cartão (para a dica embaixo da forma). */
function semCartaoNoLote(itens) {
  const fora = itens.filter((t) => !vaiNoCartao(t));
  if (!fora.length) return null;
  if (fora.some((t) => t.baixado > 0)) return "Título com baixa parcial não vai para o cartão: o restante segue pela conta.";
  return `${ORIGEM_DO_LOTE[fora[0].origem] ?? "Este título"} não se paga com cartão de crédito.`;
}

export function BaixaDialog({ aberto: open, itens, contaInicial = "cs", versao, onFechar, onConfirmar, lancamentos, saldoInicial, dataInicial, juros: jurosInicial = 0, retencao: retencaoInicial = null, origemOfx, formaDoBanco = null, valorDoBanco = null, faturas = [], fechadoAte = null, modoFechamento = "trava" }) {
  const um = itens.length === 1 ? itens[0] : null;
  const recebe = itens.length > 0 && itens.every((t) => entra(t, contaInicial));
  const imposto = itens.length > 0 && itens.every((t) => t.lado === "imposto");
  const transf = um?.origem === "transferencia";
  const verba = um?.origem === "verba";
  const faturaDoTitulo = um?.faturaId ? faturas.find((f) => f.id === um.faturaId) : null;
  // Hoje o cartão só vale um título por vez; nas versões novas, também no
  // lote: todos entram na mesma fatura (Tiago, 20/10/2026).
  // A versão escolhida (alternativa) usa o pop-up do sistema, como a atual,
  // com só três acréscimos: juros e multa no título a pagar, a fatura na baixa
  // no cartão e os avisos da conciliação e do fechamento (Tiago, 20/10/2026).
  // A prévia do Extrato fica só na recomendada.
  const popupDoSistema = versao === "atual" || versao === "alternativa";
  const podeCartao = itens.length > 0 && itens.every(vaiNoCartao) && !origemOfx && (!!um || versao !== "atual");
  const motivoSemCartao = itens.length > 1 && versao !== "atual" && !podeCartao ? semCartaoNoLote(itens) : null;
  const [data, setData] = React.useState(dataInicial ?? HOJE);
  const [conta, setConta] = React.useState(um?.contaFixa ?? contaInicial);
  const [forma, setForma] = React.useState(formaInicial(formaDoBanco));
  const [cartaoId, setCartaoId] = React.useState(cartaoInicial(itens));
  // A fatura do item: vem pela data do pagamento e pode ser trocada (pedido
  // do Tiago, 20/10/2026), para a compra que o banco lançou em outra.
  const [faturaEscolhida, setFaturaEscolhida] = React.useState(null);
  // Os impostos retidos na fonte (decisão 125), imposto a imposto. Na PP
  // aprovada com retenção começam nos da aprovação; aberta pela conciliação,
  // nos que a diferença do banco sugere. Tudo editável.
  // Aberta por uma linha do banco que pagou menos que o título: a baixa
  // abre parcial, com o valor do banco (o título já está pelo líquido, com
  // as retenções da aprovação descontadas). O resto continua em aberto.
  // Quando a conciliação já explicou a diferença pela retenção na fonte,
  // não é parcial.
  const retidoSugerido = retencaoInicial ? Object.values(retencaoInicial).reduce((s, x) => s + (x || 0), 0) : 0;
  const parcialDoBanco = !!um && valorDoBanco != null && valorDoBanco < aberto(um) - retidoSugerido - 0.004;
  const valorBR = (v) => v.toFixed(2).replace(".", ",");
  const [retem, setRetem] = React.useState(!parcialDoBanco && !!(retencaoInicial || um?.retencaoAprovacao));
  const [retidos, setRetidos] = React.useState(retencaoInicial ?? um?.retencaoAprovacao ?? {});
  const [parcial, setParcial] = React.useState(parcialDoBanco);
  const [valorParcial, setValorParcial] = React.useState(parcialDoBanco ? valorBR(valorDoBanco) : "");
  const [juros, setJuros] = React.useState(jurosInicial ? String(jurosInicial).replace(".", ",") : "");
  // No título a pagar, juros e multa ficam atrás de uma chave, como a baixa
  // parcial e a retenção (pedido do Tiago, 20/10/2026). Liga sozinha quando o
  // banco pagou mais que o título.
  const [comJuros, setComJuros] = React.useState(jurosInicial > 0);
  const [centro, setCentro] = React.useState(um?.centro ?? (recebe ? { tipo: "01", sub: "Geral" } : { tipo: "02", sub: "Produção" }));
  const [comprovante, setComprovante] = React.useState(origemOfx ? "extrato do banco de 19/10 (OFX)" : null);
  const [erro, setErro] = React.useState(null);

  React.useEffect(() => {
    if (!open) return;
    setData(dataInicial ?? HOJE);
    setConta(itens[0]?.contaFixa ?? contaInicial);
    setForma(formaInicial(formaDoBanco));
    setCartaoId(cartaoInicial(itens));
    setFaturaEscolhida(null);
    const u = itens.length === 1 ? itens[0] : null;
    setRetem(!parcialDoBanco && !!(retencaoInicial || u?.retencaoAprovacao));
    setRetidos(retencaoInicial ?? u?.retencaoAprovacao ?? {});
    setParcial(parcialDoBanco);
    setValorParcial(parcialDoBanco ? valorBR(valorDoBanco) : "");
    setJuros(jurosInicial ? String(jurosInicial).replace(".", ",") : "");
    setComJuros(jurosInicial > 0);
    setCentro(itens[0]?.centro ?? (recebe ? { tipo: "01", sub: "Geral" } : { tipo: "02", sub: "Produção" }));
    setComprovante(origemOfx ? "extrato do banco de 19/10 (OFX)" : null);
    setErro(null);
  }, [open, itens.map((t) => t.id).join("|")]);

  if (!open || itens.length === 0) return null;
  const noCartao = podeCartao && forma === "cartao";
  const cartao = CARTOES.find((c) => c.id === cartaoId);
  const destino = noCartao && cartao && data ? faturaDestino(cartao, data, faturas) : null;
  // Na versão de hoje não há escolha: vale a da data do pagamento.
  const opcoesFatura = noCartao && cartao && versao !== "atual" ? opcoesDeFatura(cartao, faturas, destino) : [];
  const alvo = opcoesFatura.find((o) => o.id === faturaEscolhida) ?? opcoesFatura.find((o) => o.padrao) ?? destino;
  const foraDaData = !!alvo && !!destino && alvo.competencia !== destino.competencia;
  // O fechamento da conciliação: a baixa no banco com data até ele.
  const noPeriodoFechado = !noCartao && conta === "cs" && !!fechadoAte && !!data && data <= fechadoAte && versao !== "atual";
  const semParcial = verba || !!faturaDoTitulo || noCartao;
  // A fatura, na recomendada, fica fora do DRE: quem entra são os itens.
  const centroEfetivo = faturaDoTitulo && !popupDoSistema ? { tipo: "—", sub: "Pagamento de fatura · fora do DRE" } : centro;
  // Juros e multa só onde o atraso é cobrado no próprio pagamento: o boleto
  // (o banco calcula os encargos na hora) e a guia de imposto. No PIX e na
  // TED o valor é o que a agência manda; a fatura do cartão e a conta de
  // consumo cobram o atraso na fatura ou na conta seguinte. A exceção é a
  // baixa aberta pela conciliação em que o banco pagou mais que o título.
  const jurosDisponivel = !imposto && !recebe && !noCartao && (jurosInicial > 0 || (comoRecomendada(versao) && forma === "boleto" && !faturaDoTitulo));
  const atraso = atrasoDoPagamento(data, um?.vencOrig);
  const jurosN = imposto || (comJuros && jurosDisponivel) ?parseFloat((juros || "0").replace(/\./g, "").replace(",", ".")) || 0 : 0;
  // Quem tem retenção: o título de PP, avulso, recorrência, desembolso e o
  // de nota a receber. O valor a dar baixa é o bruto; o líquido é o que
  // entra ou sai da conta.
  const podeReter = !!um && !noCartao && !transf && !verba && !faturaDoTitulo && !imposto && ["pp", "avulso", "recorrencia", "desembolso", "nf", "rec_avulso"].includes(um.origem);
  const brutoAberto = um ? (podeReter && !(um.baixado > 0) ? um.valor : aberto(um)) : 0;
  const valorBruto = um ? (parcial ? parseFloat((valorParcial || "0").replace(/\./g, "").replace(",", ".")) || 0 : brutoAberto) : 0;
  const retido = podeReter && retem ? r2(Object.values(retidos).reduce((s, x) => s + (x || 0), 0)) : 0;
  const valorUm = r2(valorBruto - retido);
  const ultimaRetencao = podeReter ? ULTIMA_RETENCAO[um.contraparte] : null;
  const novos = noCartao
    ? []
    : itens.map((t) => {
        const l = lancamentoDaBaixa(t, { data, contaId: conta, valor: um ? valorUm : aberto(t), juros: um ? jurosN : 0, centro: t.centro ?? centroEfetivo });
        if (um && retido > 0) l.retido = retido;
        return faturaDoTitulo ? { ...l, itensFatura: faturaDoTitulo.itens } : l;
      });
  const total = r2(novos.reduce((s, l) => s + l.valor, 0));
  // Aberta por uma linha do banco, a baixa só concilia quando o total bate
  // com ela.
  const naoBate = !!origemOfx && valorDoBanco != null && !noCartao && Math.abs(Math.abs(total) - valorDoBanco) > 0.004;

  function confirmar() {
    if (noPeriodoFechado && modoFechamento === "trava")
      return setErro(`Período fechado até ${dataBR(fechadoAte)}: use uma data depois, ou reabra a conciliação.`);
    if (noCartao) {
      if (!data || !cartao) return setErro("Informe a data do pagamento e o cartão.");
      return onConfirmar({ itens, data, forma: "cartao", cartaoId, centro, novos: [], fatura: alvo });
    }
    if (!data || !conta) return setErro(recebe ? "Informe a data do recebimento e a conta bancária que recebeu." : "Informe a data e a conta que realizará o pagamento.");
    if (um && parcial && !(valorUm > 0)) return setErro("Informe o valor a dar baixa.");
    if (um && parcial && valorBruto > brutoAberto) return setErro(`O valor a dar baixa passa do que falta (${moeda(brutoAberto)}).`);
    if (retido > valorBruto) return setErro("Os impostos retidos passam do valor a dar baixa.");
    if (imposto && !comprovante) return setErro("Anexe o comprovante de pagamento.");
    if (naoBate) return setErro(`A baixa soma ${moeda(Math.abs(total))} e a linha do banco é de ${moeda(valorDoBanco)}: ajuste o valor ou escolha outro título.`);
    onConfirmar({ itens, data, contaId: conta, valor: um ? valorUm : null, juros: um ? jurosN : 0, centro: centroEfetivo, novos, parcial: um && parcial, quita: podeReter ? !parcial : undefined, retido });
  }

  const titulo = transf
    ? "Registrar a transferência"
    : verba
      ? "Baixar estorno de verba"
      : imposto
      ? itens.length > 1
        ? `Dar baixa em ${itens.length} impostos`
        : "Dar baixa no imposto"
      : itens.length > 1
        ? `Dar baixa em ${itens.length} títulos`
        : recebe
          ? "Dar baixa no recebimento"
          : "Dar baixa no pagamento";
  const contaNome = CONTAS.find((c) => c.id === conta)?.nome;

  return (
    <Dialogo
      aberto={open}
      onFechar={onFechar}
      titulo={titulo}
      icone={transf ? ArrowLeftRight : verba ? Undo2 : recebe ? Banknote : CreditCard}
      corIcone={transf ? "text-sky-700" : verba ? "text-teal-700" : noCartao ? "text-violet-700" : "text-emerald-600"}
      largura={popupDoSistema ? 640 : 900}
      descricao={
        itens.length > 1
          ? noCartao
            ? "Uma data, um cartão e uma fatura para todos; cada título vira um item da fatura, pelo valor em aberto."
            : "Uma data e uma conta para todos; cada título vira uma baixa própria, pelo valor em aberto."
          : undefined
      }
      rodape={
        <>
          {erro && <span className="mr-auto text-xs font-semibold text-california-red">{erro}</span>}
          <Botao variante="contorno" onClick={onFechar}>
            Cancelar
          </Botao>
          <Botao variante="verde" onClick={confirmar}>
            {transf ? "Registrar transferência" : itens.length > 1 ? `Confirmar ${itens.length} baixas` : parcial ? "Confirmar baixa parcial" : origemOfx && !popupDoSistema ? "Baixar e conciliar" : "Confirmar baixa"}
          </Botao>
        </>
      }
    >
      {origemOfx && (
        <Nota tom="verde" icone={Landmark}>
          Aberto pela conciliação com o banco: a data, a conta e o valor vêm do extrato do Santander ({origemOfx}). Confira e confirme.
        </Nota>
      )}
      {parcialDoBanco && (
        <Nota tom="ambar">
          O banco {recebe ? "recebeu" : "pagou"} {moeda(valorDoBanco)} e o título é de {moeda(aberto(um))}: a baixa abre parcial, com o valor do banco. Os {moeda(r2(aberto(um) - valorDoBanco))} restantes continuam {recebe ? "a receber" : "a pagar"}.
        </Nota>
      )}
      {naoBate && (
        <Nota tom="vermelho">
          A baixa soma {moeda(Math.abs(total))} e a linha do banco é de {moeda(valorDoBanco)}. Ela só concilia quando os dois baterem.
        </Nota>
      )}
      {noPeriodoFechado &&
        (modoFechamento === "trava" ? (
          <Nota tom="vermelho">
            A conciliação da California Santander está fechada até {dataBR(fechadoAte)}. Baixa com data até lá só entra reabrindo o período (na faixa do topo da Conciliação).
          </Nota>
        ) : (
          <Nota tom="ambar">
            A conciliação foi conferida até {dataBR(fechadoAte)}. A baixa entra, mas fica marcada como alterada depois do fechamento.
          </Nota>
        ))}
      {origemOfx && dataInicial && data !== dataInicial && (
        <Nota tom="ambar">
          A data é diferente da do banco ({dataBR(dataInicial)}). A baixa vale, mas o Extrato do sistema não bate com o do banco nesse dia: use a data do banco, a não ser que ele esteja errado.
        </Nota>
      )}
      {um && (
        <Resumo
          itens={
            um.lado === "imposto"
              ? [
                  ["Imposto", `${um.titulo} · ${um.ref}`],
                  ["Competência", um.competencia],
                  ["CNPJ", um.pj],
                  ["Vencimento", dataBR(um.vencOrig ?? um.vencimento)],
                ]
              : transf
                ? [
                    ["Transferência", um.ref],
                    ["Contas", "Santander → Investimento"],
                    ["Descrição", um.titulo],
                    ["Valor", moeda(um.valor)],
                  ]
                : verba && um.verba && !popupDoSistema
                  ? [
                      ["Estorno de verba", um.ref.replace("ESTORNO ", "")],
                      ["Verba paga", `${moeda(um.verba.valor)} em ${dataBR(um.verba.pagaEm).slice(0, 5)}`],
                      ["Gasto comprovado", um.verba.semGasto ? "Nenhum" : moeda(um.verba.gasto)],
                      ["Devolve", moeda(um.valor)],
                    ]
                  : faturaDoTitulo && !popupDoSistema
                    ? [
                        ["Fatura", `${faturaDoTitulo.codigo} · ${um.contraparte}`],
                        ["Fechamento", `${dataBR(faturaDoTitulo.fecha)} · ${faturaDoTitulo.itens.length} itens`],
                        ["Vencimento", dataBR(faturaDoTitulo.vence)],
                        ["Cobrado pelo banco", moeda(faturaDoTitulo.valorCobrado ?? totalDosItens(faturaDoTitulo.itens))],
                      ]
                    : [
                    ["Título", um.titulo],
                    ["Origem", um.origem === "pp" ? `Pedido de produção ${um.ref} · ${um.parcela[0]}/${um.parcela[1]}` : um.origem === "nf" ? `Nota fiscal ${um.ref.replace("NF ", "")} · ${um.parcela[0]}/${um.parcela[1]}` : um.ref],
                    ["Vencimento", dataBR(um.vencOrig ?? um.vencimento)],
                    ["Data prevista", dataBR(um.vencimento)],
                  ]
          }
        />
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo label={transf ? "Data da transferência" : verba ? "Data em que o dinheiro voltou" : recebe ? "Data do recebimento" : "Data do pagamento"} obrigatorio>
          <Entrada id="baixa-data" type="date" value={data} onChange={setData} />
        </Campo>
        {!transf && !noCartao && (
          <Campo label={verba ? "Conta que receberá o dinheiro" : recebe ? "Conta bancária que recebeu" : imposto ? "Conta que pagou" : "Conta que realizará o pagamento"} obrigatorio>
            <Escolha id="baixa-conta" value={conta} onChange={setConta} opcoes={OP_CONTAS} placeholder="Selecione a conta..." />
          </Campo>
        )}
        {!recebe && !imposto && !transf && (
          <Campo label="Forma de pagamento" obrigatorio ajuda={motivoSemCartao ?? undefined}>
            <Escolha id="baixa-forma" value={forma} onChange={setForma} opcoes={podeCartao ? [...FORMAS, FORMA_CARTAO] : FORMAS} />
          </Campo>
        )}
        {noCartao && (
          <Campo label="Cartão" obrigatorio>
            <Escolha
              id="baixa-cartao"
              value={cartaoId}
              onChange={(v) => {
                setCartaoId(v);
                setFaturaEscolhida(null);
              }}
              opcoes={OP_CARTOES}
              placeholder="Selecione o cartão"
            />
          </Campo>
        )}
        {opcoesFatura.length > 0 && (
          <Campo label="Fatura" obrigatorio ajuda="Vem pela data do pagamento. Troque se o banco lançou a compra em outra fatura. Fatura fechada não recebe item: reabra-a na aba Cartão.">
            <Escolha
              id="baixa-fatura"
              value={alvo?.id}
              onChange={setFaturaEscolhida}
              opcoes={opcoesFatura.map((o) => ({
                value: o.id,
                label: `${o.existente ? o.existente.codigo : "Nova fatura"} · ${rotuloCompetencia(o.competencia)} · fecha ${dataBR(o.fecha)} · vence ${dataBR(o.vence)}${o.padrao ? " · pela data do pagamento" : ""}`,
              }))}
            />
          </Campo>
        )}
      </div>
      {noCartao && alvo && (
        <Nota tom="violeta" icone={CreditCard}>
          Entra na fatura {alvo.existente?.codigo ?? "nova"} de <strong>{rotuloCompetencia(alvo.competencia)}</strong> — fecha {dataBR(alvo.fecha)}, vence {dataBR(alvo.vence)}. Nada sai da conta bancária agora: o dinheiro sai na baixa da fatura.
          {versao === "atual" && (destino.pulou ? " A competência anterior já fechou: o item cai nesta." : " Se essa competência já tiver fechado, o item cai na seguinte.")}
        </Nota>
      )}
      {foraDaData && (
        <Nota tom="ambar">
          Pela data do pagamento ({dataBR(data)}), o item cairia na fatura de {rotuloCompetencia(destino.competencia)}. Confira na fatura do banco em qual ele veio: é o valor dela que o fechamento vai bater.
        </Nota>
      )}

      {um && !transf && (
        // O bloco de valores da baixa do sistema (valor-da-baixa.tsx,
        // decisão 125): valor a dar baixa, baixa parcial e impostos retidos.
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <div>
              <p className="text-xs font-semibold">
                Valor a dar baixa<span className="text-california-red"> *</span>
              </p>
              <p className="text-[11px] text-muted-foreground">
                {um.baixado > 0 ? `Falta ${recebe ? "receber" : "pagar"} ${moeda(aberto(um))} de ${moeda(um.liquido)}` : `Parcela ${um.parcela[0]}/${um.parcela[1]}`}
              </p>
            </div>
            {parcial ? (
              <Entrada id="baixa-valor" value={valorParcial} onChange={setValorParcial} placeholder="0,00" mono className="w-48 text-right" />
            ) : (
              <span className="font-mono text-lg font-bold">{moeda(brutoAberto)}</span>
            )}
          </div>
          {semParcial ? (
            <p className="border-t border-border px-4 py-2.5 text-[11.5px] text-muted-foreground">
              {noCartao
                ? "No cartão, a baixa é sempre do valor inteiro, sem retenção: o item entra inteiro na fatura."
                : verba
                  ? "Devolução de verba só aceita a baixa do valor inteiro."
                  : "Fatura de cartão só aceita a baixa do valor inteiro."}
            </p>
          ) : (
            !imposto &&
            um.origem !== "rendimento" && (
              <LinhaChave id="baixa-parcial" ligada={parcial} onChange={setParcial} rotulo="Baixa parcial" ajuda={recebe ? "O restante continua em aberto." : "O restante continua a pagar."} />
            )
          )}
          {podeReter && (
            <LinhaChave
              id="baixa-retem"
              ligada={retem}
              onChange={setRetem}
              rotulo={recebe ? "O cliente reteve impostos na fonte" : "Reter impostos na fonte"}
              ajuda={
                retencaoInicial
                  ? "A diferença do banco bate com estas retenções · editáveis"
                  : um.retencaoAprovacao
                    ? `Retenções informadas na aprovação da PP (${dataBR(um.aprovadaEm)}) · editáveis`
                    : undefined
              }
              direita={
                retem && ultimaRetencao ? (
                  <button
                    type="button"
                    onClick={() => setRetidos(valoresPorAliquota(valorBruto, ultimaRetencao.aliquotas))}
                    className="rounded-md border border-border bg-white px-2.5 py-1 text-[11.5px] font-semibold text-muted-foreground hover:border-california-red hover:text-california-red"
                  >
                    Repetir as alíquotas da {ultimaRetencao.referencia} ({dataBR(ultimaRetencao.data).slice(0, 5)})
                  </button>
                ) : null
              }
            />
          )}
          {podeReter && retem && (
            <TabelaDeRetencoes base={valorBruto} retidos={retidos} onChange={setRetidos} recebe={recebe} retido={retido} liquido={valorUm} />
          )}
          {jurosDisponivel && !comJuros && (
            <div className="flex flex-wrap items-baseline gap-x-2.5 border-t border-border px-4 pb-3 pt-4">
              <button
                type="button"
                id="baixa-juros-abrir"
                onClick={() => setComJuros(true)}
                className="inline-flex items-center gap-1 self-center text-[13px] font-semibold text-california-red hover:underline"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
                Juros e multa
              </button>
              {atraso.dias > 0 && (
                <span id="baixa-juros-atraso" className="text-[11.5px] text-muted-foreground">
                  Pago {atraso.dias} {atraso.dias === 1 ? "dia" : "dias"} depois do vencimento
                </span>
              )}
            </div>
          )}
          {((imposto && !recebe) || (comJuros && jurosDisponivel)) && (
            <div className="border-t border-border px-4 py-3">
            <Campo
              label={imposto ? "Multa e juros" : "Valor dos juros e da multa"}
              ajuda={
                atraso.dias > 0 ? (
                  <span className="font-semibold text-california-red">
                    Pago {textoDoAtraso(atraso, um.vencOrig)}: {imposto ? "informe o que veio na guia." : "informe os juros e a multa cobrados, se houver."}
                  </span>
                ) : jurosInicial > 0 ? (
                  "O banco pagou mais que o título: a diferença entra em 11 · Despesa com Juros."
                ) : atraso.fimDeSemana && data > um.vencOrig ? (
                  `O vencimento caiu num ${atraso.fimDeSemana} e passou para ${dataBR(atraso.vencimentoUtil)}: pago em dia, sem atraso.`
                ) : (
                  "Só quando o boleto ou a guia vier com acréscimo. Entra em 11 · Despesa com Juros."
                )
              }
            >
              <div className="flex items-center gap-3">
                <div className="w-40 shrink-0">
                  <Entrada id="baixa-juros" value={juros} onChange={setJuros} placeholder="0,00" mono />
                </div>
                {!imposto && (
                  <button
                    type="button"
                    id="baixa-juros-remover"
                    onClick={() => {
                      setComJuros(false);
                      setJuros("");
                    }}
                    className="text-[12px] font-semibold text-muted-foreground hover:text-california-red hover:underline"
                  >
                    Remover
                  </button>
                )}
              </div>
            </Campo>
            </div>
          )}
        </div>
      )}
      {podeReter && retem && retido > 0 && <NoFiscalDaBaixa t={um} retidos={retidos} recebe={recebe} data={data} />}

      {imposto && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo label="Guia (DARF ou guia municipal)" obrigatorio ajuda="Anexada na aprovação.">
            <span className="flex h-9 items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 text-xs">
              <Paperclip className="h-3.5 w-3.5 text-california-red" />
              {um?.guiaArquivo ?? "guias anexadas"}
            </span>
          </Campo>
          <Campo label="Comprovante de pagamento" obrigatorio>
            <button
              type="button"
              onClick={() => setComprovante("comprovante.pdf")}
              className="flex h-9 w-full items-center gap-2 rounded-lg border border-dashed border-border px-3 text-left text-xs text-muted-foreground hover:border-california-red/50"
            >
              <Paperclip className="h-3.5 w-3.5" />
              {comprovante ?? "Selecionar arquivo · PDF ou imagem, até 10 MB"}
            </button>
          </Campo>
        </div>
      )}

      {!transf && (
        <Campo
          label={recebe && !verba ? "Centro de custo do recebimento" : "Centro de custo do pagamento"}
          obrigatorio
          ajuda={
            verba
              ? "O mesmo da PP: a devolução abate o custo dela no DRE (despesa negativa)."
              : faturaDoTitulo && !popupDoSistema
                ? "O pagamento da fatura é só dinheiro mudando de conta (decisão 084): quem entra no DRE são os itens."
                : recebe
                  ? "Define onde a receita entra no DRE."
                  : "Define onde o custo entra no DRE."
          }
        >
          {faturaDoTitulo && !popupDoSistema ? (
            <div className="flex h-9 items-center rounded-lg border border-border bg-muted/30 px-3 text-sm text-muted-foreground">
              Fora do DRE · os {faturaDoTitulo.itens.length} itens da fatura já têm o centro de custo deles
            </div>
          ) : um?.centro || imposto ? (
            <div className="flex h-9 items-center rounded-lg border border-border bg-muted/30 px-3 text-sm">
              {um?.centro ? `${centroTexto(um.centro).tipo} · ${um.centro.sub}` : "O centro de custo do próprio imposto"}
            </div>
          ) : itens.some((t) => !t.centro) ? (
            <SeletorCentro valor={centro} onChange={setCentro} natureza={recebe ? "entrada" : "saida"} />
          ) : (
            <div className="flex h-9 items-center rounded-lg border border-border bg-muted/30 px-3 text-sm text-muted-foreground">
              Os {itens.length} {recebe ? "recebimentos" : "pagamentos"} usam o centro de custo que já têm.
            </div>
          )}
        </Campo>
      )}

      {popupDoSistema ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
          {noCartao ? (
            <>
              Ao confirmar, o item passa a pertencer à fatura do cartão e aparece no extrato dele, na aba <strong className="text-foreground">Cartão</strong>.
            </>
          ) : (
            <>
              {origemOfx ? (
                <>
                  Ao confirmar, {itens.length > 1 ? "as baixas entram" : "a baixa entra"} no Extrato já {itens.length > 1 ? "conciliadas" : "conciliada"} com a linha do banco, com a data dela.
                </>
              ) : (
                <>
                  Ao confirmar, o {recebe ? "recebimento" : "pagamento"} é registrado e enviado para a <strong className="text-foreground">Conciliação</strong> com a conta e o centro de custo escolhidos.
                </>
              )}
            </>
          )}
        </div>
      ) : noCartao ? (
        <PreviaNaFatura itens={itens} cartao={cartao} destino={alvo} data={data} centro={centro} />
      ) : (
        <PreviaNoExtrato novos={novos} lancamentos={lancamentos} saldoInicial={saldoInicial} conta={conta} contaNome={contaNome} total={total} />
      )}
    </Dialogo>
  );
}

// ---------------------------------------------------------------------------
// O bloco de valores: a chave, a tabela das retenções e o "No fiscal"
// ---------------------------------------------------------------------------

/** Uma linha do bloco de valores com a caixa de marcar (no sistema é uma
 *  chave liga/desliga; três chaves juntas ficavam estranhas — pedido do
 *  Tiago, 20/10/2026). */
function LinhaChave({ id, ligada, onChange, rotulo, ajuda, direita }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-2.5">
      <button
        type="button"
        id={id}
        role="checkbox"
        aria-checked={ligada}
        onClick={() => onChange(!ligada)}
        className={cn(
          "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
          ligada ? "border-california-red bg-california-red text-white" : "border-gray-300 bg-white hover:border-california-red/60",
        )}
      >
        {ligada && <Check className="h-3 w-3" strokeWidth={3} />}
      </button>
      <label htmlFor={id} className="flex-1 cursor-pointer text-[13px]">
        <span className="font-semibold">{rotulo}</span>
        {ajuda && <span className="ml-2 text-[11.5px] text-muted-foreground">{ajuda}</span>}
      </label>
      {direita}
    </div>
  );
}

/** O atraso do pagamento em dias corridos, contado a partir do primeiro dia
 *  útil: vencimento no sábado ou no domingo passa para a segunda, e o banco
 *  aceita o pagamento nesse dia sem encargo. Feriados ficam de fora (exigem
 *  um calendário). O vencimento do documento nunca muda. */
const FIM_DE_SEMANA = { 6: ["sábado", 2], 0: ["domingo", 1] };
function atrasoDoPagamento(data, vencimento) {
  if (!data || !vencimento) return { dias: 0, vencimentoUtil: vencimento, fimDeSemana: null };
  const venc = Date.parse(vencimento);
  const [fimDeSemana, empurra] = FIM_DE_SEMANA[new Date(venc).getUTCDay()] ?? [null, 0];
  const util = venc + empurra * 86400000;
  return {
    dias: Math.max(0, Math.round((Date.parse(data) - util) / 86400000)),
    vencimentoUtil: new Date(util).toISOString().slice(0, 10),
    fimDeSemana,
  };
}
function textoDoAtraso(atraso, vencimento) {
  const dias = `${atraso.dias} ${atraso.dias === 1 ? "dia" : "dias"}`;
  return atraso.fimDeSemana
    ? `${dias} depois do vencimento (${dataBR(vencimento)}, ${atraso.fimDeSemana}, conta a partir de ${dataBR(atraso.vencimentoUtil)})`
    : `${dias} depois do vencimento (${dataBR(vencimento)})`;
}

const IMPOSTOS_RETIDOS = [
  ["ISS", null],
  ["PIS", null],
  ["COFINS", null],
  ["CSLL", null],
  ["IRRF", "IR retido (antecipa o IRPJ)"],
];
const numeroBR = (s) => parseFloat(String(s ?? "").replace(/\./g, "").replace(",", ".").replace("%", "")) || 0;
const textoBR = (n, casas = 2) => (n ? n.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas }) : "");

/** Os valores retidos pelas alíquotas, sobre a base. */
function valoresPorAliquota(base, aliquotas) {
  return Object.fromEntries(Object.entries(aliquotas).map(([k, a]) => [k, r2((base * a) / 100)]));
}

/** Cada imposto por alíquota OU por valor (um calcula o outro), sobre o
 *  valor a dar baixa; termina em total − retidos = líquido. */
function TabelaDeRetencoes({ base, retidos, onChange, recebe, retido, liquido }) {
  const set = (k, v) => onChange({ ...retidos, [k]: v > 0 ? r2(v) : 0 });
  const campo = "h-9 w-full rounded-lg border border-border bg-white px-2.5 text-right font-mono text-sm focus:border-california-red focus:outline-none";
  return (
    <div className="space-y-2 border-t border-border px-4 py-3">
      <div className="grid grid-cols-[1fr_110px_170px] gap-3 border-b border-border pb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        <span>Imposto</span>
        <span className="text-right">Alíquota</span>
        <span className="text-right">Valor retido</span>
      </div>
      {IMPOSTOS_RETIDOS.map(([k, nota]) => {
        const v = retidos[k] || 0;
        const aliq = base > 0 && v ? Math.round((v / base) * 10000) / 100 : 0;
        return (
          <div key={k} className="grid grid-cols-[1fr_110px_170px] items-center gap-3">
            <span className="text-[13px]">
              <b className="font-semibold">{k}</b>
              {nota && <span className="text-[11px] text-muted-foreground"> · {nota}</span>}
            </span>
            <span className="relative">
              <input
                key={`a-${k}-${v}-${base}`}
                aria-label={`Alíquota de ${k}`}
                defaultValue={textoBR(aliq)}
                placeholder="0,00"
                onBlur={(e) => set(k, (base * numeroBR(e.target.value)) / 100)}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                className={cn(campo, "pr-7")}
              />
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
            </span>
            <input
              key={`v-${k}-${v}`}
              aria-label={`Valor retido de ${k}`}
              defaultValue={textoBR(v)}
              placeholder="0,00"
              onBlur={(e) => set(k, numeroBR(e.target.value))}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              className={campo}
            />
          </div>
        );
      })}
      <div className="grid grid-cols-[1fr_auto] gap-y-1 border-t border-border pt-2.5 text-[13px]">
        <span className="text-muted-foreground">Valor total</span>
        <span className="text-right font-mono">{moeda(base)}</span>
        <span className="text-muted-foreground">
          (−) Impostos retidos <span className="text-[11px]">({base > 0 ? `${(Math.round((retido / base) * 10000) / 100).toLocaleString("pt-BR")}%` : "0%"})</span>
        </span>
        <span className="text-right font-mono text-california-red">− {moeda(retido)}</span>
        <span className="font-semibold">{recebe ? "(=) Valor líquido recebido" : "(=) Valor líquido pago ao fornecedor"}</span>
        <span className="text-right font-mono text-[15px] font-bold">{moeda(liquido)}</span>
      </div>
    </div>
  );
}

/** O "No fiscal" (no-fiscal.tsx): o efeito da baixa na Apuração. No
 *  recebimento, o que o cliente reteve abate os impostos da agência; no
 *  pagamento, a retenção vira guia a recolher. */
function NoFiscalDaBaixa({ t, retidos, recebe, data }) {
  const v = (k) => retidos[k] || 0;
  const mes = (d) => ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"][Number(d.slice(5, 7)) - 1];
  const competencia = `${mes(data)}/${data.slice(0, 4)}`;
  const tri = `${Math.ceil(Number(data.slice(5, 7)) / 3)}º trimestre`;
  const proximo = (() => {
    const m = Number(data.slice(5, 7));
    const a = Number(data.slice(0, 4)) + (m === 12 ? 1 : 0);
    return `20/${String((m % 12) + 1).padStart(2, "0")}/${a}`;
  })();
  const pcc = r2(v("PIS") + v("COFINS") + v("CSLL"));
  const linhas = recebe
    ? [
        v("ISS") && [`ISS retido`, v("ISS"), `abate o ISS de ${competencia}`],
        (v("PIS") || v("COFINS")) && [`PIS e COFINS retidos`, r2(v("PIS") + v("COFINS")), `abatem a apuração de ${competencia}`],
        v("CSLL") && [`CSLL retida`, v("CSLL"), `abate a CSLL do ${tri}`],
        v("IRRF") && [`IRRF retido`, v("IRRF"), `antecipa o IRPJ do ${tri}`],
      ]
    : [
        v("IRRF") && [`IRRF`, v("IRRF"), `DARF 1708, vence ${proximo}`],
        pcc && [`PIS/COFINS/CSLL`, pcc, `DARF 5952, vence ${proximo}`],
        v("ISS") && [`ISS retido`, v("ISS"), `guia municipal, vence ${proximo}`],
      ];
  return (
    <div className="rounded-xl border border-border bg-muted/20 px-4 py-3 text-xs">
      <p className="mb-1.5 flex items-center gap-1.5 font-semibold">
        <Scale className="h-3.5 w-3.5 text-muted-foreground" />
        No fiscal
        <span className="font-normal text-muted-foreground">· {recebe ? `o que ${t.contraparte} reteve abate os impostos da ${t.empresa}` : "esta baixa gera as guias de retenção, em Impostos a Pagar"}</span>
      </p>
      <div className="grid grid-cols-[1fr_auto_1.4fr] gap-x-4 gap-y-0.5">
        {linhas.filter(Boolean).map(([k, val, efeito]) => (
          <React.Fragment key={k}>
            <span>{k}</span>
            <span className="text-right font-mono">{moeda(val)}</span>
            <span className="text-muted-foreground">{efeito}</span>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

/** "Na conciliação, fica assim": as linhas que a baixa vai gravar, no
 *  meio do extrato da conta, com o saldo recalculado. */
export function PreviaNoExtrato({ novos, lancamentos, saldoInicial, conta, contaNome, total }) {
  const daConta = conta === "cs";
  const antes = daConta ? [...lancamentos].sort((a, b) => a.data.localeCompare(b.data)) : [];
  const todas = [...antes.map((l) => ({ ...l, ja: true })), ...novos].sort((a, b) => a.data.localeCompare(b.data) || (a.ja ? -1 : 1));
  let s = saldoInicial;
  const comSaldo = todas.map((l) => ({ ...l, saldo: (s = r2(s + l.valor)) }));
  const idxPrimeiro = comSaldo.findIndex((l) => !l.ja);
  const mostrar = comSaldo.slice(Math.max(0, idxPrimeiro - 2)).filter((l, i, arr) => !l.ja || i < 2 || arr.slice(i).some((x) => !x.ja));
  const visiveis = mostrar.slice(0, 12);
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Na conciliação: {novos.length === 1 ? "a linha nova" : `${novos.length} linhas novas`} no extrato da {contaNome}
        {novos.length > 1 && <> · {total < 0 ? "saem" : "entram"} {moeda(Math.abs(total))}</>}
      </p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[760px] text-xs">
          <thead className="bg-muted/40 text-[10px] uppercase text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 text-left">Data</th>
              <th className="px-2 py-1.5 text-right">Crédito</th>
              <th className="px-2 py-1.5 text-right">Débito</th>
              <th className="px-2 py-1.5 text-right">Saldo</th>
              <th className="px-2 py-1.5 text-left">Descrição</th>
              <th className="px-2 py-1.5 text-left">Job</th>
              <th className="px-2 py-1.5 text-left">Centro de Custo</th>
              <th className="px-2 py-1.5 text-center">Trim.</th>
            </tr>
          </thead>
          <tbody>
            {visiveis.map((l) => (
              <React.Fragment key={l.id}>
              <tr className={cn("border-t border-border", l.ja ? "text-muted-foreground" : "bg-yellow-50 font-medium")}>
                <td className="whitespace-nowrap px-2 py-1.5 font-mono">{dataBR(l.data)}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono text-emerald-700">{l.valor > 0 ? moeda(l.valor) : ""}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono text-california-red">{l.valor < 0 ? moeda(-l.valor) : ""}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono font-semibold">{daConta ? moeda(l.saldo) : "—"}</td>
                <td className="px-2 py-1.5">
                  {!l.ja && <span className="mr-1 rounded bg-yellow-200 px-1 text-[9px] font-bold uppercase text-yellow-900">nova</span>}
                  {l.descricao}
                  {l.itensFatura && <span className="text-[10px] text-muted-foreground"> · paga os {l.itensFatura.length} itens abaixo</span>}
                  {l.retido > 0 && <span className="text-[10px] text-muted-foreground"> · líquido, com {moeda(l.retido)} retidos na fonte</span>}
                  {l.juros > 0 && <span className="text-muted-foreground"> · inclui {moeda(l.juros)} de juros</span>}
                </td>
                <td className="whitespace-nowrap px-2 py-1.5 font-mono">{l.job ?? "—"}</td>
                <td className="px-2 py-1.5">{l.centro?.tipo === "—" ? l.centro.sub : l.centro ? `${centroTexto(l.centro).tipo} · ${l.centro.sub}` : "—"}</td>
                <td className="px-2 py-1.5 text-center font-mono">{trimestre(l.data)}</td>
              </tr>
              {/* O pagamento da fatura paga os itens dela: eles aparecem
                  embaixo, cada um com o seu job e centro de custo. */}
              {l.itensFatura &&
                [...l.itensFatura]
                  .sort((a, b) => a.data.localeCompare(b.data))
                  .map((i) => (
                    <tr key={i.id} className="border-t border-dashed border-border/70 bg-slate-50 text-[11px] text-muted-foreground">
                      <td className="whitespace-nowrap py-1 pl-4 pr-2 font-mono">↳ {dataBR(i.data).slice(0, 5)}</td>
                      <td className="whitespace-nowrap px-2 py-1 text-right font-mono">{i.valor < 0 ? moeda(-i.valor) : ""}</td>
                      <td className="whitespace-nowrap px-2 py-1 text-right font-mono">{i.valor > 0 ? moeda(i.valor) : ""}</td>
                      <td />
                      <td className="px-2 py-1">
                        {i.descricao} <span className="font-mono text-[10px]">{i.codigo}</span>
                      </td>
                      <td className="whitespace-nowrap px-2 py-1 font-mono">{i.job?.codigo ?? "—"}</td>
                      <td className="px-2 py-1">
                        {centroTexto(i.centro).tipo} · {i.centro.sub}
                      </td>
                      <td className="px-2 py-1 text-center font-mono">{trimestre(i.data)}</td>
                    </tr>
                  ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {mostrar.length > visiveis.length && <p className="text-[11px] text-muted-foreground">e mais {mostrar.length - visiveis.length} linhas.</p>}
      {!daConta && <p className="text-[11px] text-amber-700">A conta escolhida não é a desta tela: a linha vai para o extrato dela.</p>}
    </div>
  );
}

/** "Na fatura do cartão, fica assim": a linha que a baixa no cartão vai pôr
 *  no extrato do cartão, no meio dos itens da fatura, com o acumulado. */
function PreviaNaFatura({ itens, cartao, destino, data, centro }) {
  if (!itens?.length || !cartao || !destino) return null;
  const f = destino.existente;
  const novos = itens.map((t) => ({
    id: `novo-${t.id}`,
    data,
    tipo: t.origem,
    codigo: t.origem === "pp" ? `${t.ref} ${t.parcela[0]}/${t.parcela[1]}` : t.ref,
    descricao: t.titulo,
    fornecedor: t.contraparte,
    valor: aberto(t),
    centro: t.centro ?? centro,
    job: t.job,
    novo: true,
  }));
  const todos = [...(f?.itens ?? []), ...novos].sort((a, b) => a.data.localeCompare(b.data) || (a.novo ? 1 : 0) - (b.novo ? 1 : 0));
  let acc = 0;
  const comAcc = todos.map((i) => ({ ...i, acc: (acc = r2(acc + i.valor)) }));
  const idx = comAcc.findIndex((i) => i.novo);
  const visiveis = comAcc.slice(Math.max(0, idx - 3), idx + novos.length + 2).slice(0, 12);
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Na fatura {f?.codigo ?? "nova"} do {cartao.nome} ({rotuloCompetencia(destino.competencia)}): {novos.length === 1 ? "a linha nova" : `${novos.length} linhas novas, ${moeda(r2(novos.reduce((s, i) => s + i.valor, 0)))}`} · nada no extrato do banco
      </p>
      <div className="overflow-x-auto rounded-lg border border-violet-200">
        <table className="w-full min-w-[760px] text-xs">
          <thead className="bg-violet-50/70 text-[10px] uppercase text-violet-900/70">
            <tr>
              <th className="px-2 py-1.5 text-left">Data</th>
              <th className="px-2 py-1.5 text-right">Crédito</th>
              <th className="px-2 py-1.5 text-right">Débito</th>
              <th className="px-2 py-1.5 text-right">Acumulado</th>
              <th className="px-2 py-1.5 text-left">Descrição</th>
              <th className="px-2 py-1.5 text-left">Job</th>
              <th className="px-2 py-1.5 text-left">Centro de Custo</th>
              <th className="px-2 py-1.5 text-center">Trim.</th>
            </tr>
          </thead>
          <tbody>
            {visiveis.map((i) => (
              <tr key={i.id} className={cn("border-t border-border", i.novo ? "bg-yellow-50 font-medium" : "text-muted-foreground")}>
                <td className="whitespace-nowrap px-2 py-1.5 font-mono">{dataBR(i.data)}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono text-emerald-700">{i.valor < 0 ? moeda(-i.valor) : ""}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono text-california-red">{i.valor > 0 ? moeda(i.valor) : ""}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono font-semibold">{moeda(i.acc)}</td>
                <td className="px-2 py-1.5">
                  {i.novo && <span className="mr-1 rounded bg-yellow-200 px-1 text-[9px] font-bold uppercase text-yellow-900">nova</span>}
                  {i.descricao}{" "}
                  <span className={cn("ml-1 inline-block rounded border px-1 py-px text-[9px] font-bold uppercase", ITEM_TIPO[i.tipo]?.[1])}>{ITEM_TIPO[i.tipo]?.[0]}</span>
                </td>
                <td className="whitespace-nowrap px-2 py-1.5 font-mono">{i.job?.codigo ?? "—"}</td>
                <td className="px-2 py-1.5">{i.centro ? `${centroTexto(i.centro).tipo} · ${i.centro.sub}` : "—"}</td>
                <td className="px-2 py-1.5 text-center font-mono">{trimestre(i.data)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {novos.length === 1 ? "O título sai" : "Os títulos saem"} de Títulos a Pagar como {novos.length === 1 ? "pago" : "pagos"} no cartão. A fatura fecha em {dataBR(destino.fecha)}, vira um título só e é paga em {dataBR(destino.vence)}: é aí que o dinheiro sai do banco.
      </p>
    </div>
  );
}

// ===========================================================================
// Os lançamentos novos — os mesmos formulários das telas de cada módulo
// ===========================================================================

function Rateio({ empresa }) {
  return (
    <Campo label="Rateio de regional" obrigatorio>
      {empresa ? (
        <div className="flex items-center gap-2 text-sm">
          <span className="flex h-9 flex-1 items-center rounded-lg border border-border bg-white px-3">
            {{ "Agência California": "NE", Hitlab: "Hitlab", "Empresa Teste": "Teste" }[empresa] ?? "Selecione a regional"}
          </span>
          <span className="flex h-9 w-20 items-center justify-end rounded-lg border border-border bg-white px-3 font-mono">100%</span>
          <span className="text-xs font-semibold text-emerald-700">Total: 100% ✓</span>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Escolha a empresa para ver as regionais dela.</p>
      )}
    </Campo>
  );
}

export function PagamentoAvulsoDialog({ aberto: open, onFechar, onCriar, inicial = {} }) {
  const [f, setF] = React.useState({});
  React.useEffect(() => {
    if (open) setF({ empresa: "Agência California", forma: "pix", data: HOJE, centro: { tipo: "07", sub: "Outros" }, ...inicial });
  }, [open]);
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const ok = f.descricao && f.valor && f.empresa;
  const criar = (baixar) =>
    onCriar(
      {
        id: `novo-${Date.now()}`,
        lado: "pagar",
        origem: "avulso",
        ref: "AV-00240",
        titulo: f.descricao,
        contraparte: f.fornecedor || "—",
        empresa: f.empresa,
        job: null,
        vencimento: f.data,
        vencOrig: f.data,
        valor: parseFloat(String(f.valor).replace(/\./g, "").replace(",", ".")),
        liquido: parseFloat(String(f.valor).replace(/\./g, "").replace(",", ".")),
        retencao: 0,
        baixado: 0,
        parcela: [1, 1],
        centro: f.centro,
        forma: f.forma,
      },
      baixar,
      f.lembrar,
    );
  return (
    <Dialogo
      aberto={open}
      onFechar={onFechar}
      titulo="Nova conta avulsa"
      icone={Plus}
      descricao="Registre uma conta a pagar sem vínculo com pedido de produção."
      largura={620}
      rodape={
        <>
          <Botao variante="contorno" onClick={onFechar}>
            Cancelar
          </Botao>
          <Botao variante="contorno" disabled={!ok} onClick={() => criar(false)}>
            Criar
          </Botao>
          <Botao variante="verde" disabled={!ok} onClick={() => criar(true)}>
            {inicial.doBanco ? "Criar e conciliar" : "Criar e dar baixa"}
          </Botao>
        </>
      }
    >
      {inicial.doBanco && (
        <Nota tom="azul" icone={Landmark}>
          Vem de uma linha do extrato do banco sem correspondência: <span className="font-mono">{inicial.doBanco}</span>. Data, valor e descrição já vêm dela.
        </Nota>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo label="Empresa" obrigatorio>
          <Escolha value={f.empresa} onChange={set("empresa")} opcoes={EMPRESAS} placeholder="Selecione a empresa" />
        </Campo>
        <Campo label="Forma de pagamento" obrigatorio>
          <Escolha
            value={f.forma}
            onChange={set("forma")}
            opcoes={[
              { value: "pix", label: "PIX" },
              { value: "transferencia", label: "Transferência" },
              { value: "boleto", label: "Boleto" },
              { value: "debito", label: "Débito em conta" },
            ]}
          />
        </Campo>
      </div>
      <Campo label="Descrição" obrigatorio>
        <Entrada value={f.descricao} onChange={set("descricao")} placeholder="Descreva a conta avulsa..." />
      </Campo>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo label="Valor (R$)" obrigatorio>
          <Entrada value={f.valor} onChange={set("valor")} placeholder="0,00" mono />
        </Campo>
        <Campo label="Data prevista de pagamento">
          <Entrada type="date" value={f.data} onChange={set("data")} />
        </Campo>
      </div>
      <Campo label="Fornecedor">
        <Entrada value={f.fornecedor} onChange={set("fornecedor")} placeholder="Nenhum (opcional)" />
      </Campo>
      <Rateio empresa={f.empresa} />
      <Campo label="Centro de custo" obrigatorio>
        <SeletorCentro valor={f.centro} onChange={set("centro")} />
      </Campo>
      {inicial.doBanco && (
        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2.5 text-xs text-violet-900">
          <input type="checkbox" checked={!!f.lembrar} onChange={(e) => set("lembrar")(e.target.checked)} className="mt-0.5 accent-[#7c3aed]" />
          <span>
            <strong>Lembrar como regra:</strong> da próxima vez, todo histórico que começa com “{inicial.padrao}” já vem com este centro de custo e esta empresa.
          </span>
        </label>
      )}
    </Dialogo>
  );
}

export function RecebimentoAvulsoDialog({ aberto: open, onFechar, onCriar, tipoInicial = "avulso", inicial = {} }) {
  const [tipo, setTipo] = React.useState(tipoInicial);
  const [f, setF] = React.useState({});
  React.useEffect(() => {
    if (open) {
      setTipo(tipoInicial);
      setF({ data: HOJE, empresa: "Agência California", origem: "cs", destino: "ci", centro: { tipo: "01", sub: "Geral" }, ...inicial });
    }
  }, [open, tipoInicial]);
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const num = parseFloat(String(f.valor ?? "").replace(/\./g, "").replace(",", ".")) || 0;
  const tipos = [
    ["avulso", "Recebimento avulso", "Entrou dinheiro sem nota fiscal", Banknote],
    ["transferencia", "Transferência entre contas", "Dinheiro que só muda de conta", ArrowLeftRight],
    ["rendimento", "Rendimento de aplicação", "Rendimento líquido do mês", PiggyBank],
  ];
  const criar = (baixar) => {
    const base = { id: `novo-${Date.now()}`, job: null, retencao: 0, baixado: 0, parcela: [1, 1], valor: num, liquido: num };
    if (tipo === "transferencia")
      onCriar(
        {
          ...base,
          lado: "transf",
          origem: "transferencia",
          ref: "TR-00005",
          titulo: f.descricao || "Transferência entre contas",
          contraparte: `${CONTAS.find((c) => c.id === f.origem).nome} → ${CONTAS.find((c) => c.id === f.destino).nome}`,
          empresa: "—",
          vencimento: f.data,
          vencOrig: f.data,
          centro: null,
          origemConta: f.origem,
          destinoConta: f.destino,
        },
        baixar,
      );
    else
      onCriar(
        {
          ...base,
          lado: "receber",
          origem: tipo === "rendimento" ? "rendimento" : "rec_avulso",
          ref: "AV-00241",
          titulo: tipo === "rendimento" ? "Rendimento de outubro · California Investimento" : f.descricao || "Recebimento avulso",
          contraparte: tipo === "rendimento" ? "California Investimento · Santander" : f.recebidoDe || "—",
          empresa: f.empresa,
          vencimento: f.data,
          vencOrig: f.data,
          centro: tipo === "rendimento" ? { tipo: "10", sub: "Rendimento de aplicação" } : f.centro,
          entra: true,
          contaFixa: tipo === "rendimento" ? "ci" : undefined,
        },
        baixar,
      );
  };
  const contaO = CONTAS.find((c) => c.id === f.origem);
  const contaD = CONTAS.find((c) => c.id === f.destino);
  return (
    <Dialogo
      aberto={open}
      onFechar={onFechar}
      titulo="Recebimento avulso"
      icone={Plus}
      corIcone="text-emerald-600"
      largura={660}
      rodape={
        <>
          <span className="mr-auto max-w-[300px] text-[11px] leading-snug text-muted-foreground">
            <strong>Criar</strong> lança o título em aberto. <strong>{inicial.doBanco ? "Criar e conciliar" : "Criar e dar baixa"}</strong> registra agora e envia para a conciliação.
          </span>
          <Botao variante="contorno" onClick={onFechar}>
            Cancelar
          </Botao>
          <Botao variante="contorno" disabled={!num} onClick={() => criar(false)}>
            Criar
          </Botao>
          <Botao variante="verde" disabled={!num} onClick={() => criar(true)}>
            {inicial.doBanco ? "Criar e conciliar" : "Criar e dar baixa"}
          </Botao>
        </>
      }
    >
      <div className="grid gap-2 sm:grid-cols-3">
        {tipos.map(([k, l, d, I]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTipo(k)}
            className={cn("rounded-xl border p-3 text-left transition-colors", tipo === k ? "border-california-red bg-california-red/5" : "border-border hover:border-california-red/40")}
          >
            <I className={cn("mb-1.5 h-4 w-4", tipo === k ? "text-california-red" : "text-muted-foreground")} />
            <span className="block text-sm font-semibold">{l}</span>
            <span className="block text-[11px] text-muted-foreground">{d}</span>
          </button>
        ))}
      </div>
      {tipo === "avulso" && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo label="Data prevista do recebimento" obrigatorio>
              <Entrada type="date" value={f.data} onChange={set("data")} />
            </Campo>
            <Campo label="Valor" obrigatorio>
              <Entrada value={f.valor} onChange={set("valor")} placeholder="0,00" mono />
            </Campo>
          </div>
          <Campo label="Empresa" obrigatorio>
            <Escolha value={f.empresa} onChange={set("empresa")} opcoes={EMPRESAS} placeholder="Selecione a empresa..." />
          </Campo>
          <Campo label="Descrição" obrigatorio>
            <Entrada value={f.descricao} onChange={set("descricao")} placeholder="Ex.: reembolso das passagens do evento" />
          </Campo>
          <Campo label="Recebido de (opcional)">
            <Entrada value={f.recebidoDe} onChange={set("recebidoDe")} placeholder="Cliente ou fornecedor..." />
          </Campo>
          <Rateio empresa={f.empresa} />
          <Campo label="Centro de custo" obrigatorio>
            <SeletorCentro valor={f.centro} onChange={set("centro")} natureza="entrada" />
          </Campo>
          <Nota>Reembolso, devolução de fornecedor, juros… Entra no DRE pelo centro de custo escolhido.</Nota>
        </>
      )}
      {tipo === "transferencia" && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo label="Conta de origem" obrigatorio>
              <Escolha value={f.origem} onChange={set("origem")} opcoes={OP_CONTAS} />
            </Campo>
            <Campo label="Conta de destino" obrigatorio>
              <Escolha value={f.destino} onChange={set("destino")} opcoes={OP_CONTAS.filter((o) => o.value !== f.origem)} />
            </Campo>
            <Campo label="Data" obrigatorio ajuda="Em Criar e dar baixa, é a data em que as duas linhas entram no extrato.">
              <Entrada type="date" value={f.data} onChange={set("data")} />
            </Campo>
            <Campo label="Valor" obrigatorio>
              <Entrada value={f.valor} onChange={set("valor")} placeholder="0,00" mono />
            </Campo>
          </div>
          <Campo label="Descrição (opcional)">
            <Entrada value={f.descricao} onChange={set("descricao")} placeholder="Ex.: aplicação do caixa do mês" />
          </Campo>
          {num > 0 && (
            <div className="overflow-hidden rounded-lg border border-border text-xs">
              <div className="flex justify-between border-b border-border px-3 py-2">
                <span>
                  Sai de <strong>{contaO?.nome}</strong>
                </span>
                <span className="font-mono text-california-red">− {moeda(num)}</span>
              </div>
              <div className="flex justify-between px-3 py-2">
                <span>
                  Entra em <strong>{contaD?.nome}</strong>
                </span>
                <span className="font-mono text-emerald-700">+ {moeda(num)}</span>
              </div>
            </div>
          )}
          {contaO && contaD && contaO.empresa !== contaD.empresa && (
            <Nota tom="ambar">As contas são de CNPJs diferentes: isso é empréstimo entre empresas, não transferência. Ainda não dá para registrar aqui.</Nota>
          )}
          <Nota>Não é receita nem despesa: fica fora do DRE e do fluxo de caixa consolidado. Cada conta ganha a sua linha no extrato.</Nota>
        </>
      )}
      {tipo === "rendimento" && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo label="Conta de aplicação" obrigatorio>
              <Escolha value="ci" opcoes={[{ value: "ci", label: "California Investimento · Santander" }]} />
            </Campo>
            <Campo label="Mês do rendimento" obrigatorio>
              <Escolha value="2026-10" opcoes={[{ value: "2026-10", label: "outubro de 2026" }, { value: "2026-09", label: "setembro de 2026" }]} />
            </Campo>
            <Campo label="Data do lançamento" obrigatorio ajuda="Vem no último dia do mês.">
              <Entrada type="date" value="2026-10-31" />
            </Campo>
            <Campo label="Rendimento líquido do mês" obrigatorio ajuda="Depois do IR e do IOF: o que entrou na aplicação.">
              <Entrada value={f.valor} onChange={set("valor")} placeholder="0,00" mono />
            </Campo>
          </div>
          <p className="text-xs text-muted-foreground">Centro de custo: 10 · Receita Financeira · Rendimento de aplicação</p>
        </>
      )}
    </Dialogo>
  );
}

export function ImpostoAvulsoDialog({ aberto: open, onFechar, onCriar }) {
  const [f, setF] = React.useState({});
  React.useEffect(() => {
    if (open) setF({ tributo: "PIS", competencia: "setembro/2026", venc: "2026-10-25" });
  }, [open]);
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const num = parseFloat(String(f.valor ?? "").replace(/\./g, "").replace(",", ".")) || 0;
  const criar = (baixar) =>
    onCriar(
      {
        id: `novo-${Date.now()}`,
        lado: "imposto",
        origem: "imposto",
        ref: f.guia ? `DARF ${f.guia}` : "DARF 8109",
        titulo: f.tributo,
        contraparte: "Receita Federal",
        empresa: "Agência California",
        pj: "Agência California Ltda",
        job: null,
        vencimento: f.venc,
        vencOrig: f.venc,
        valor: num,
        liquido: num,
        retencao: 0,
        baixado: 0,
        parcela: [1, 1],
        competencia: f.competencia,
        origemImposto: "AVULSO",
        guiaArquivo: "guia-avulsa.pdf",
        centro: { tipo: "03", sub: f.tributo.split(" ")[0] },
        forma: "guia",
      },
      baixar,
    );
  return (
    <Dialogo
      aberto={open}
      onFechar={onFechar}
      titulo="Novo imposto avulso"
      icone={Scale}
      descricao="Para o que não passou pela apuração: uma guia que a contabilidade mandou e o sistema não calculou."
      largura={600}
      rodape={
        <>
          <Botao variante="contorno" onClick={onFechar}>
            Cancelar
          </Botao>
          <Botao variante="contorno" disabled={!num || !f.descricao} onClick={() => criar(false)}>
            Criar
          </Botao>
          <Botao disabled={!num || !f.descricao} onClick={() => criar(true)}>
            Criar e dar baixa
          </Botao>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo label="Imposto" obrigatorio>
          <Escolha
            value={f.tributo}
            onChange={set("tributo")}
            opcoes={["ISS próprio", "PIS", "COFINS", "IRPJ", "CSLL", "ISS retido de fornecedores", "PIS/COFINS/CSLL retidos de fornecedores", "IRRF retido de fornecedores", "Outro"]}
          />
        </Campo>
        <Campo label="CNPJ" obrigatorio>
          <Escolha value="1" opcoes={[{ value: "1", label: "Agência California Ltda · 00.000.000/0001-00" }]} />
        </Campo>
        <Campo label="Competência" obrigatorio>
          <Escolha value={f.competencia} onChange={set("competencia")} opcoes={["outubro/2026", "setembro/2026", "agosto/2026", "3º trimestre/2026"]} />
        </Campo>
        <Campo label="Vencimento" obrigatorio>
          <Entrada type="date" value={f.venc} onChange={set("venc")} />
        </Campo>
        <Campo label="Valor" obrigatorio>
          <Entrada value={f.valor} onChange={set("valor")} placeholder="0,00" mono />
        </Campo>
        <Campo label="Código da guia">
          <Entrada value={f.guia} onChange={set("guia")} placeholder="Ex.: 2089" mono />
        </Campo>
      </div>
      <Campo label="Descrição" obrigatorio>
        <Entrada value={f.descricao} onChange={set("descricao")} placeholder="Ex.: diferença de IRPJ apontada pela contabilidade" />
      </Campo>
      <Rateio empresa="Agência California" />
    </Dialogo>
  );
}

export function RecorrenciaDialog({ aberto: open, onFechar, onCriar }) {
  const [freq, setFreq] = React.useState("Mensal");
  return (
    <Dialogo
      aberto={open}
      onFechar={onFechar}
      titulo="Nova recorrência"
      icone={Repeat}
      largura={600}
      rodape={
        <>
          <Botao variante="contorno" onClick={onFechar}>
            Cancelar
          </Botao>
          <Botao onClick={onCriar}>Criar recorrência</Botao>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo label="Empresa" obrigatorio>
          <Escolha value="Agência California" opcoes={EMPRESAS} />
        </Campo>
        <Campo label="Valor (R$)" obrigatorio>
          <Entrada placeholder="0,00" mono />
        </Campo>
      </div>
      <Campo label="Descrição" obrigatorio>
        <Entrada placeholder="Ex.: aluguel do escritório" />
      </Campo>
      <Campo label="Frequência" obrigatorio>
        <div className="inline-flex rounded-lg border border-border p-0.5">
          {["Mensal", "Quinzenal", "Anual"].map((x) => (
            <button key={x} type="button" onClick={() => setFreq(x)} className={cn("rounded-md px-3 py-1 text-xs font-semibold", freq === x ? "bg-california-red text-white" : "text-muted-foreground")}>
              {x}
            </button>
          ))}
        </div>
      </Campo>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo label="Dia do vencimento" obrigatorio>
          <Entrada value="5" />
        </Campo>
        <Campo label="Data de fim (opcional)">
          <Entrada placeholder="Sem data de encerramento" />
        </Campo>
      </div>
      <Nota>
        <strong>Como funciona:</strong> cada mês vira um título a pagar 30 dias antes do vencimento, e ele aparece aqui na aba Títulos.
      </Nota>
    </Dialogo>
  );
}

export function AntesDaNfDialog({ aberto: open, onFechar, onConfirmar }) {
  return (
    <Dialogo
      aberto={open}
      onFechar={onFechar}
      titulo="Recebimento antes da NF"
      icone={HandCoins}
      corIcone="text-emerald-600"
      largura={600}
      rodape={
        <>
          <Botao variante="contorno" onClick={onFechar}>
            Cancelar
          </Botao>
          <Botao variante="verde" onClick={onConfirmar}>
            Registrar recebimento
          </Botao>
        </>
      }
    >
      <Campo label="Job ou BV que o cliente pagou" obrigatorio ajuda="Os jobs da fila de faturamento com saldo a faturar.">
        <Escolha value="1" opcoes={[{ value: "1", label: "CAL-1009/26 · Fee Marca de Bebidas · saldo a faturar R$ 42.500,00" }]} />
      </Campo>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo label="Data do recebimento" obrigatorio>
          <Entrada type="date" value={HOJE} />
        </Campo>
        <Campo label="Conta que recebeu" obrigatorio>
          <Escolha value="cs" opcoes={OP_CONTAS} />
        </Campo>
        <Campo label="Valor recebido" obrigatorio ajuda="Até R$ 42.500,00, o que falta faturar da nota.">
          <Entrada value="42.500,00" mono />
        </Campo>
        <Campo label="Centro de custo do recebimento" obrigatorio>
          <Escolha value="1" opcoes={[{ value: "1", label: "01 · Receita · Fee mensal" }]} />
        </Campo>
      </div>
      <Nota>O dinheiro entra no extrato agora. Quando a NF for emitida, este valor entra como a parcela 1, já recebida.</Nota>
    </Dialogo>
  );
}

export function RemessaDialog({ aberto: open, onFechar, titulos, onGerar }) {
  const pix = titulos.filter((t) => !t.pagoEm && t.lado === "pagar" && ["pp", "avulso", "recorrencia", "folha"].includes(t.origem)).slice(0, 8);
  return (
    <Dialogo
      aberto={open}
      onFechar={onFechar}
      titulo="Exportar remessa Santander"
      icone={Landmark}
      largura={720}
      rodape={
        <>
          <Botao variante="contorno" onClick={onFechar}>
            Cancelar
          </Botao>
          <Botao onClick={onGerar}>Gerar e baixar</Botao>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo label="Conta de débito" obrigatorio>
          <Escolha value="cs" opcoes={OP_CONTAS} />
        </Campo>
        <Campo label="Data de pagamento" obrigatorio>
          <Entrada type="date" value={HOJE} />
        </Campo>
      </div>
      <div className="overflow-hidden rounded-lg border border-border text-xs">
        <div className="bg-muted/40 px-3 py-2 font-semibold">Títulos disponíveis ({pix.length}) · como hoje, em Contas a Pagar</div>
        {pix.map((t) => (
          <div key={t.id} className="flex items-center justify-between gap-3 border-t border-border px-3 py-1.5">
            <span className="truncate">
              {t.contraparte} · {t.titulo}
            </span>
            <span className="font-mono">{moeda(aberto(t))}</span>
          </div>
        ))}
      </div>
      <Nota>A remessa não registra a baixa: quem baixa é a conciliação, quando o débito aparecer no extrato do banco.</Nota>
    </Dialogo>
  );
}

// ===========================================================================
// As ações da linha (⋯)
// ===========================================================================

export function AcaoDialog({ acao, titulo: t, onFechar, onAplicar }) {
  const [v, setV] = React.useState("");
  const [motivo, setMotivo] = React.useState("");
  React.useEffect(() => {
    setV(acao === "editar_data" || acao === "editar_previsao" || acao === "editar_prevista" ? t?.vencimento : "");
    setMotivo("");
  }, [acao, t?.id]);
  if (!acao || !t) return null;
  const fechar = onFechar;
  const so = (titulo, icone, conteudo, botao, aplicar, extra = {}) => (
    <Dialogo
      aberto
      onFechar={fechar}
      titulo={titulo}
      icone={icone}
      largura={extra.largura ?? 480}
      descricao={extra.descricao}
      rodape={
        <>
          <Botao variante="contorno" onClick={fechar}>
            {extra.voltar ?? "Cancelar"}
          </Botao>
          {botao && (
            <Botao variante={extra.perigo ? "primario" : "primario"} disabled={extra.desligado} onClick={aplicar}>
              {botao}
            </Botao>
          )}
        </>
      }
    >
      {conteudo}
    </Dialogo>
  );
  switch (acao) {
    case "editar_data":
      return so(
        "Editar data de pagamento",
        Pencil,
        <>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="font-semibold uppercase text-amber-800">Vencimento original</p>
              <p className="font-mono text-base font-semibold">{dataBR(t.vencOrig)}</p>
            </div>
            <div className="rounded-lg border border-sky-200 bg-sky-50 p-3">
              <p className="font-semibold uppercase text-sky-800">1ª data de pagamento</p>
              <p className="font-mono text-base font-semibold">{dataBR(t.vencOrig)}</p>
            </div>
          </div>
          <Campo label="Nova data de pagamento" obrigatorio>
            <Entrada type="date" value={v} onChange={setV} />
          </Campo>
        </>,
        "Salvar data",
        () => onAplicar({ ...t, vencimento: v }, `Data de pagamento atualizada para ${dataBR(v)}.`),
      );
    case "editar_prevista": {
      // Os termos padronizados: o VENCIMENTO vem do documento e não muda; a
      // DATA PREVISTA (de pagamento ou de recebimento) é o plano do
      // financeiro, para o caixa, o saldo previsto e a aba Títulos.
      const recebe = entra(t);
      const doc = { imposto: "da guia", fatura: "da fatura, o dia do cartão", nf: "da nota", pp: "da parcela da PP", desembolso: "do desembolso" }[t.origem] ?? "do lançamento";
      const venc = t.vencOrig ?? t.vencimento;
      const depois = v && v > venc;
      const dias = depois ? Math.round((Date.parse(v) - Date.parse(venc)) / 86400000) : 0;
      const efeito = recebe
        ? "O cliente fica em atraso: a nota aparece como inadimplente até o recebimento."
        : t.origem === "imposto"
          ? "A guia vai ter multa de mora e juros: a baixa pede o valor que vier na guia nova."
          : "Se o fornecedor ou o banco cobrar juros e multa, a baixa pede o valor.";
      return so(
        recebe ? "Editar data prevista de recebimento" : "Editar data prevista de pagamento",
        Pencil,
        <>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="font-semibold uppercase text-amber-800">Vencimento</p>
              <p className="font-mono text-base font-semibold">{dataBR(venc)}</p>
              <p className="mt-0.5 text-[10.5px] text-amber-800">O {doc}. Não muda.</p>
            </div>
            <div className="rounded-lg border border-sky-200 bg-sky-50 p-3">
              <p className="font-semibold uppercase text-sky-800">Data prevista hoje</p>
              <p className="font-mono text-base font-semibold">{dataBR(t.vencimento)}</p>
              <p className="mt-0.5 text-[10.5px] text-sky-800">{t.vencimento === venc ? "Igual ao vencimento." : "Já foi alterada."}</p>
            </div>
          </div>
          <Campo
            label={recebe ? "Nova data prevista de recebimento" : "Nova data prevista de pagamento"}
            obrigatorio
            ajuda="Usada na aba Títulos, no saldo previsto e no fluxo de caixa. O vencimento continua o mesmo."
          >
            <Entrada type="date" value={v} onChange={setV} />
          </Campo>
          {depois && (
            <Nota tom="vermelho">
              {dias} {dias === 1 ? "dia" : "dias"} depois do vencimento. {efeito}
            </Nota>
          )}
        </>,
        "Salvar data prevista",
        () => onAplicar({ ...t, vencimento: v, previsao: recebe ? v : t.previsao }, `Data prevista de ${recebe ? "recebimento" : "pagamento"}: ${dataBR(v)}. O vencimento continua ${dataBR(venc)}.`),
      );
    }
    case "editar_previsao":
      return so(
        "Editar previsão de recebimento",
        Pencil,
        <>
          <p className="text-sm font-semibold">
            {t.titulo} <span className="block text-xs font-normal text-muted-foreground">{t.contraparte}</span>
          </p>
          <Nota tom="ambar">O vencimento da nota nunca muda — a edição altera apenas a previsão de recebimento usada no fluxo de caixa.</Nota>
          <Campo label="Nova previsão de recebimento" obrigatorio ajuda="Hoje é 20/10/2026 — destacado no calendário.">
            <Entrada type="date" value={v} onChange={setV} />
          </Campo>
        </>,
        "Salvar previsão",
        () => onAplicar({ ...t, previsao: v, vencimento: v }, `Previsão de recebimento atualizada para ${dataBR(v)}.`),
        { largura: 470 },
      );
    case "corrigir_imposto":
      return so(
        "Corrigir valor",
        Pencil,
        <>
          <Campo label="Valor atual">
            <div className="flex h-9 items-center rounded-lg border border-border bg-muted/30 px-3 font-mono text-sm">{moeda(t.valor)}</div>
          </Campo>
          <Campo label="Valor novo" obrigatorio>
            <Entrada value={v} onChange={setV} placeholder="0,00" mono />
          </Campo>
          <Campo label="Motivo" obrigatorio>
            <Entrada value={motivo} onChange={setMotivo} placeholder="Ex.: a contabilidade reemitiu a guia com o crédito de energia." />
          </Campo>
        </>,
        "Salvar correção",
        () => {
          const n = parseFloat(v.replace(/\./g, "").replace(",", "."));
          onAplicar({ ...t, valor: n, liquido: n }, `Valor corrigido para ${moeda(n)}. O calculado e o aprovado ficam no histórico.`);
        },
        { descricao: "Quando a contabilidade manda a guia com outro valor depois da aprovação.", desligado: !v || motivo.length < 10 },
      );
    case "cancelar_imposto":
      return so(
        "Cancelar imposto",
        XCircle,
        <>
          <Campo label="Motivo" obrigatorio>
            <Entrada value={motivo} onChange={setMotivo} placeholder="Ex.: as notas da guia foram canceladas" />
          </Campo>
          <Nota>Imposto já pago não se cancela: o que foi pago fica a recuperar, com a contabilidade.</Nota>
        </>,
        "Cancelar o imposto",
        () => onAplicar(null, "Imposto cancelado. O motivo fica registrado."),
        {
          descricao: "Para o imposto que deixou de ser devido. O título sai de Impostos a Pagar e do fluxo de caixa, e o motivo fica registrado.",
          voltar: "Voltar",
          desligado: motivo.length < 10,
        },
      );
    case "excluir":
      return so(
        t.origem === "transferencia" ? `Excluir a transferência ${t.ref}?` : `Excluir o título ${t.ref}?`,
        Trash2,
        <p className="text-sm text-muted-foreground">
          {t.titulo} · {moeda(t.valor)}. O título sai da lista. Como ainda está em aberto, nada sai do extrato. Fica no log de auditoria quem excluiu e quando.
        </p>,
        "Excluir",
        () => onAplicar(null, "Título excluído."),
      );
    case "devolver_folha":
      return so(
        "Devolver para a aprovação",
        Undo2,
        <Campo label="Motivo">
          <Entrada value={motivo} onChange={setMotivo} placeholder="Ex.: valor digitado errado" />
        </Campo>,
        "Devolver",
        () => onAplicar(null, "Folha devolvida para a aba Folhas de Pagamento."),
      );
    case "info_nf":
      return so(
        "Informações de faturamento e cobrança",
        Info,
        <Resumo
          itens={[
            ["PO", "PO-4500123"],
            ["Descrição da NF", t.descricaoNf],
            ["Contato de cobrança", "financeiro_001@exemplo.com"],
            ["Telefone", "00000000000"],
          ]}
        />,
        null,
        null,
        { voltar: "Fechar", largura: 620 },
      );
    default:
      return so(
        "Abre a tela de hoje",
        FileText,
        <p className="text-sm text-muted-foreground">
          No sistema, este item abre a mesma tela que já existe ({t.ref}). O protótipo não a reproduz.
        </p>,
        null,
        null,
        { voltar: "Fechar" },
      );
  }
}
