"use client";
// O pedido de desembolso (decisão 264): pop-up vertical em quatro partes —
// O que é › Quem recebe › Quanto e quando › Comprovante. Serve para o
// pedido novo, para o "Corrigir" do rejeitado e para anexar o comprovante
// do pedido enviado antes da regra. O comprovante é obrigatório.
//
// As peças são as do formulário da PP: a data de pagamento com as janelas
// e a quarta de exceções (decisões 077, 157 e 172), as parcelas, a
// urgência com justificativa, e os anexos com o tipo obrigatório, os campos
// da NF e o reconhecimento da nota no cadastro único (decisão 152); no
// reembolso, os comprovantes com número, data e valor (decisão 187).
import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Building2, Eye, Send, Undo2, UserRound } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import { MoneyInput } from "@/components/ui/money-input";
import { CampoFornecedor } from "@/app/(app)/fornecedores/campo-fornecedor";
import { RateioRegionalEditor } from "@/app/(app)/financeiro/contas-a-pagar/rateio-regional-editor";
import { cn } from "@/lib/utils";
import {
  ehJanelaDePagamento,
  ehQuarta,
  hojeEmSaoPauloIso,
  isoParaBr,
  parcelaForaDaRegra,
  primeiraDataPossivelDoPrazo,
  primeiraJanelaComEnvioAberto,
  tipoDoPrazo,
  vencimentoAceitaEnvio,
  vencimentosNasJanelas,
} from "@/lib/calculos/janelas-pagamento";
import {
  AvisoQuartaSemUrgencia,
  LegendaDaQuarta,
  UrgenciaPPField,
  diaForaDaJanela,
  quartaMarcada,
} from "@/app/(app)/jobs/[jobId]/realizado/prazo-e-urgencia-pp";
import { EnvioAte, useFeriadosNacionais } from "@/app/(app)/jobs/[jobId]/realizado/prazo-de-envio-pp";
import {
  ParcelasDaPPField,
  acomodarParcelas,
  montarParcelas,
  mudarDataDaParcela,
  parcelasDaPPGravada,
  problemaDasParcelas,
  redividirParcelas,
  type ParcelaLocal,
} from "@/app/(app)/jobs/[jobId]/realizado/parcelas-da-pp";
import {
  CnpjDoDocumento,
  ListaDeAnexos,
  NfDoAnexo,
  ResumoDasNfs,
  TEXTOS_DO_DESEMBOLSO,
  TextosDoDocumentoDaNf,
  ZonaDeAnexos,
  anexoEmEdicao,
  itensDaLista,
  notaExistenteDe,
  parteDaNf,
  sobraDaNota,
  useAnexosEmEdicao,
  useNotasExistentes,
  type AnexoEmEdicao,
} from "@/app/(app)/jobs/[jobId]/realizado/anexos-da-pp";
import { CamposDoComprovante, ResumoDosComprovantes } from "@/app/(app)/jobs/[jobId]/realizado/comprovantes-do-reembolso";
import { TIPOS_DE_COMPROVANTE } from "@/lib/calculos/reembolso";
import { documentoTemCnpj } from "@/lib/fiscal/cnpj-da-pp";
import { chaveDoNumeroDaNf } from "@/lib/fiscal/nf-da-pp";
import type { DocumentoTipo, PPAnexoMimetype } from "@/lib/types";
import type { ContextoDoFormulario } from "./dados";
import type { PedidoDeDesembolso } from "./tipos";
import { prefixoAnexosDesembolso, salvarPedidoDeDesembolso } from "./actions";
import { brl, dataBr } from "./comum";
import { VisualizarAnexos } from "./visualizar-anexos";

export type ModoDoForm = "novo" | "corrigir" | "anexar";

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const r2 = (n: number) => Math.round(n * 100) / 100;

function Secao({ n, titulo, children, extra }: { n: number; titulo: string; children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-california-red/10 text-[11px] font-bold text-california-red">{n}</span>
        {titulo}
        {extra}
      </h3>
      {children}
    </section>
  );
}

export function FormularioDoPedido({
  aberto,
  onAberto,
  modo,
  pedido,
  contexto,
  onSalvo,
}: {
  aberto: boolean;
  onAberto: (x: boolean) => void;
  modo: ModoDoForm;
  pedido: PedidoDeDesembolso | null;
  contexto: ContextoDoFormulario;
  onSalvo: (mensagem: string) => void;
}) {
  return (
    <Dialog open={aberto} onOpenChange={onAberto}>
      {/* overflow-clip, e não hidden: o foco que volta do seletor (Radix) rolava
          o cartão por dentro e deixava um vão em branco embaixo do rodapé. */}
      <DialogContent className="flex max-h-[92vh] max-w-[720px] flex-col gap-0 overflow-clip p-0">
        {aberto && (
          <TextosDoDocumentoDaNf.Provider value={TEXTOS_DO_DESEMBOLSO}>
            <Corpo modo={modo} pedido={pedido} contexto={contexto} fechar={() => onAberto(false)} onSalvo={onSalvo} />
          </TextosDoDocumentoDaNf.Provider>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Corpo({
  modo,
  pedido,
  contexto,
  fechar,
  onSalvo,
}: {
  modo: ModoDoForm;
  pedido: PedidoDeDesembolso | null;
  contexto: ContextoDoFormulario;
  fechar: () => void;
  onSalvo: (mensagem: string) => void;
}) {
  const router = useRouter();
  const { empresas, regionais, fornecedores, tomadores, tomadorPadrao: regrasDoTomador, alocacao } = contexto;

  const [descricao, setDescricao] = React.useState(pedido?.descricao ?? "");
  // A empresa e a regional vêm da alocação de quem pede no RH; trocar é exceção.
  const rateioDaAlocacao = React.useMemo(
    () => (alocacao?.regionalId ? [{ regional_id: alocacao.regionalId, percentual: 100 }] : []),
    [alocacao],
  );
  const [empresaId, setEmpresaId] = React.useState(pedido?.empresa.id ?? alocacao?.empresaId ?? "");
  const [rateio, setRateio] = React.useState<Array<{ regional_id: string; percentual: number }>>(
    pedido?.regionais.map((r) => ({ regional_id: r.id, percentual: r.pct })) ?? rateioDaAlocacao,
  );
  const doCadastro = (e: string, r: Array<{ regional_id: string; percentual: number }>) =>
    Boolean(alocacao?.regionalId) && e === alocacao!.empresaId && r.length === 1 && r[0].regional_id === alocacao!.regionalId;
  const [trocar, setTrocar] = React.useState(() => !doCadastro(empresaId, rateio));
  const [reembolso, setReembolso] = React.useState<boolean>(pedido ? pedido.reembolso : false);
  const [fornecedorId, setFornecedorId] = React.useState<string | null>(pedido?.fornecedor?.id ?? null);
  const [valor, setValor] = React.useState<number | null>(pedido?.valor ?? null);

  // A data de pagamento segue a regra da PP (decisões 077, 157 e 172).
  const hojeSp = hojeEmSaoPauloIso();
  const feriados = useFeriadosNacionais();
  const prazoOriginal = pedido?.parcelas[0]?.vencimento ?? null;
  const [urgente, setUrgente] = React.useState(Boolean(pedido?.urgente));
  const [justificativa, setJustificativa] = React.useState(pedido?.justificativaUrgente ?? "");
  const [faltaJustificativa, setFaltaJustificativa] = React.useState(false);
  const [prevista, setPrevista] = React.useState(prazoOriginal ?? primeiraJanelaComEnvioAberto(hojeSp, []));
  const [prazoVez, setPrazoVez] = React.useState(0);
  const [avisoQuarta, setAvisoQuarta] = React.useState<{ de: string; para: string } | null>(null);
  const [parcelas, setParcelas] = React.useState<ParcelaLocal[]>(
    pedido && pedido.parcelas.length > 1
      ? parcelasDaPPGravada(
          pedido.parcelas.map((p) => ({ data_vencimento: p.vencimento, valor: p.valor })),
          pedido.valor,
        )
      : [],
  );
  const [maisDeSeis, setMaisDeSeis] = React.useState((pedido?.parcelas.length ?? 1) > 6);
  const [parcelasTexto, setParcelasTexto] = React.useState(String(Math.max(7, pedido?.parcelas.length ?? 7)));

  // O CNPJ tomador que a NF já traz (decisão 156): o da regional do pedido;
  // senão, o da empresa; senão, o da principal.
  const tomadorDe = React.useCallback(
    (empresa: string, regionalId: string | null) =>
      (regionalId ? regrasDoTomador.porRegional[regionalId] : undefined) ??
      regrasDoTomador.porEmpresa[empresa] ??
      regrasDoTomador.geral ??
      null,
    [regrasDoTomador],
  );
  const tomadorPadrao = tomadorDe(empresaId, rateio[0]?.regional_id ?? null);

  // Os anexos com as peças do formulário da PP, no bucket da PP.
  const [prefixo, setPrefixo] = React.useState<string | null>(null);
  React.useEffect(() => {
    let vivo = true;
    prefixoAnexosDesembolso().then((r) => vivo && r.ok && setPrefixo(r.prefixo));
    return () => {
      vivo = false;
    };
  }, []);
  const {
    anexos,
    setAnexos,
    subir,
    remover,
    mudar,
    mudarNf,
    aviso: avisoDosAnexos,
  } = useAnexosEmEdicao(prefixo, tomadorPadrao, reembolso ? undefined : tomadores);
  React.useEffect(() => {
    if (!pedido) return;
    setAnexos(
      pedido.anexos.map((c) =>
        anexoEmEdicao(
          {
            id: c.id,
            arquivo_path: c.path,
            arquivo_nome_original: c.nome,
            arquivo_tamanho_bytes: c.tamanho,
            arquivo_mimetype: c.mime,
            documento_tipo: c.tipo,
            documento_numero: c.numero,
            nf_data_emissao: c.emissao,
            nf_valor: c.valorDoDoc,
            nf_tomador_estabelecimento_id: c.tomadorId,
            nf_valor_na_pp: c.parte,
            created_at: c.criadoEm,
          },
          tomadorPadrao,
        ),
      ),
    );
    // Só ao abrir: depois, a lista é de quem edita.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A nota do cadastro único (decisão 152): reconhecida pelo número, com as
  // PPs e os desembolsos que já a usam e o que sobra dela.
  const numerosDasNfs = React.useMemo(
    () => anexos.filter((x) => x.tipo === "nota_fiscal").map((x) => x.nf.numero),
    [anexos],
  );
  const existentes = useNotasExistentes(reembolso ? null : fornecedorId, numerosDasNfs, pedido?.id ?? null);
  const subindo = anexos.some((x) => x.status === "uploading" || x.status === "selecionado");
  const prontos = anexos.filter((x) => x.status === "ok");

  const [faltouTipo, setFaltouTipo] = React.useState(false);
  const [vendo, setVendo] = React.useState<string | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [enviando, setEnviando] = React.useState(false);

  const n = parcelas.length > 1 ? parcelas.length : 1;
  const numeroDe = (t: string) => Number(String(t).replace(/\./g, "").replace(",", ".")) || 0;
  const listaDeParcelas =
    n === 1
      ? [{ numero: 1, data_vencimento: prevista, valor: valor ?? 0 }]
      : parcelas.map((p, i) => ({ numero: i + 1, data_vencimento: p.data_vencimento, valor: numeroDe(p.valor) }));

  function mudarNumeroDeParcelas(bruto: number) {
    const qtd = Math.max(1, Math.min(36, Math.floor(bruto) || 1));
    if (qtd === 1) {
      setParcelas([]);
      return;
    }
    if (qtd === parcelas.length) return;
    const novas = montarParcelas(vencimentosNasJanelas(prevista, qtd), valor ?? 0).map((p, i) =>
      parcelas[i]?.ajustada ? { ...p, data_vencimento: parcelas[i].data_vencimento, ajustada: true } : p,
    );
    setParcelas(acomodarParcelas(prevista, novas));
  }
  function mudarPrazo(isoDia: string) {
    setPrevista(isoDia);
    setAvisoQuarta(null);
    if (parcelas.length > 0) setParcelas((prev) => acomodarParcelas(isoDia, prev));
  }
  /** Como na PP: ligar a urgência limpa a data (as quartas acendem no
   *  calendário); desligar com uma quarta escolhida volta para a 1ª janela. */
  function mudarUrgencia(ligado: boolean) {
    setUrgente(ligado);
    if (!ligado) setFaltaJustificativa(false);
    if (ligado) {
      setAvisoQuarta(null);
      mudarPrazo("");
      setPrazoVez((v) => v + 1);
      return;
    }
    const para = primeiraJanelaComEnvioAberto(hojeSp, feriados);
    if (!prevista) {
      mudarPrazo(para);
      setPrazoVez((v) => v + 1);
      return;
    }
    if (ehQuarta(prevista) && !ehJanelaDePagamento(prevista)) {
      const de = prevista;
      mudarPrazo(para);
      setAvisoQuarta({ de, para });
      setPrazoVez((v) => v + 1);
    }
  }

  function trocarEmpresa(v: string, novoRateio: Array<{ regional_id: string; percentual: number }>) {
    setEmpresaId(v);
    setRateio(novoRateio);
    const t = tomadorDe(v, novoRateio[0]?.regional_id ?? null);
    if (t) setAnexos((a) => a.map((x) => (documentoTemCnpj(x.tipo) ? { ...x, nf: { ...x.nf, tomador: t } } : x)));
  }
  function mudarTipo(id: string, t: DocumentoTipo) {
    const x = anexos.find((y) => y.id === id);
    const passaADizer = !!x && documentoTemCnpj(t) && !documentoTemCnpj(x.tipo);
    mudar(id, passaADizer && x ? { tipo: t, nf: { ...x.nf, tomador: tomadorPadrao ?? x.nf.tomador } } : { tipo: t });
  }
  const nomeDoTomador = tomadores.find((t) => t.id === tomadorPadrao)?.nome ?? "a empresa do pedido";
  function camposDaNf(id: string) {
    const x = anexos.find((y) => y.id === id);
    if (!x) return null;
    return (
      <NfDoAnexo
        nf={x.nf}
        onMudar={(parte) => mudarNf(id, parte)}
        faltas={[]}
        idBase={`des-nf-${id}`}
        tomadores={tomadores}
        tomadorEsperado={tomadorPadrao}
        empresaNome={nomeDoTomador}
        existente={reembolso ? null : notaExistenteDe(existentes, x.nf.numero)}
        valorPP={valor ?? 0}
        leitura={x.leitura}
      />
    );
  }
  function cnpjDoDocumento(id: string) {
    const x = anexos.find((y) => y.id === id);
    if (!x) return null;
    return (
      <CnpjDoDocumento
        valor={x.nf.tomador}
        onChange={(v) => mudarNf(id, { tomador: v })}
        tomadores={tomadores}
        tomadorEsperado={tomadorPadrao}
        empresaNome={nomeDoTomador}
        idBase={`des-doc-${id}`}
        lidoPelaIA={x.leitura?.estado === "lido" && x.leitura.campos.includes("tomador")}
      />
    );
  }
  function camposDoComprovante(id: string) {
    const x = anexos.find((y) => y.id === id);
    if (!x) return null;
    return (
      <CamposDoComprovante
        anexo={x}
        onNumero={(numero) => (x.tipo === "nota_fiscal" ? mudarNf(id, { numero }) : mudar(id, { numero }))}
        onData={(isoDia) => mudarNf(id, { emissao: isoDia })}
        onValor={(v) => mudarNf(id, { valor: v })}
        hoje={hojeSp}
        destacarFaltas={faltouTipo}
      />
    );
  }

  /** O que falta nos comprovantes para enviar (o servidor confere de novo). */
  function faltaNosComprovantes(): string | null {
    if (subindo) return "Aguarde os arquivos terminarem de subir.";
    if (prontos.length === 0) return "Anexe o comprovante: sem ele o financeiro não aprova.";
    const semTipo = prontos.find((a) => !a.tipo);
    if (semTipo) return `Escolha o tipo de “${semTipo.nome}”.`;
    if (reembolso) {
      // Como a PP de reembolso (decisão 187): número, data e valor de cada um, e a soma bate.
      const falta = prontos.find(
        (a) => !(a.tipo === "nota_fiscal" ? a.nf.numero : a.numero ?? "").trim() || !a.nf.emissao || !(a.nf.valor > 0),
      );
      if (falta) return `Complete o comprovante “${falta.nome}”: número, data e valor.`;
      const soma = r2(prontos.reduce((t, a) => t + (a.nf.valor || 0), 0));
      if (Math.abs(soma - (valor ?? 0)) > 0.004) return `Os comprovantes somam ${brl(soma)}; o pedido é de ${brl(valor ?? 0)}.`;
      return null;
    }
    const semNumero = prontos.find((a) => a.tipo !== "nota_fiscal" && !(a.numero ?? "").trim() && a.tipo !== "outro");
    if (semNumero) return `Preencha o número do documento de “${semNumero.nome}”.`;
    const semCnpj = prontos.find((a) => a.tipo !== "nota_fiscal" && documentoTemCnpj(a.tipo) && !a.nf.tomador);
    if (semCnpj) return `Escolha contra qual CNPJ foi emitido “${semCnpj.nome}”.`;
    const nfs = prontos.filter((a) => a.tipo === "nota_fiscal");
    const incompleta = nfs.find((a) => !a.nf.numero.trim() || !a.nf.emissao || !(a.nf.valor > 0) || !a.nf.tomador);
    if (incompleta) return `Complete a NF de “${incompleta.nome}”: número, emissão, valor e CNPJ tomador.`;
    const chaves = nfs.map((a) => chaveDoNumeroDaNf(a.nf.numero));
    if (chaves.some((c, i) => c !== null && chaves.indexOf(c) !== i)) return "A mesma NF aparece duas vezes neste pedido.";
    const soma = r2(nfs.reduce((t, a) => t + parteDaNf(a.nf), 0));
    if ((valor ?? 0) > 0 && soma > (valor ?? 0) + 0.004) {
      return `As NFs somam ${brl(soma)} neste pedido, mais que o valor do pedido (${brl(valor ?? 0)}).`;
    }
    for (const a of nfs) {
      const ex = notaExistenteDe(existentes, a.nf.numero);
      if (!ex || ex.pps.length === 0) continue;
      const sobra = sobraDaNota(ex, a.nf.valor > 0 ? a.nf.valor : ex.valor);
      const usos = ex.pps.map((o) => o.codigo).join(", ");
      if (sobra <= 0.004) return `A NF ${ex.numero} já está inteira em ${usos}. Não dá para usá-la de novo.`;
      if (parteDaNf(a.nf) > sobra + 0.004) {
        return `Da NF ${ex.numero} sobram ${brl(sobra)} (o resto está em ${usos}). Ajuste o valor neste pedido.`;
      }
    }
    return null;
  }

  async function enviar() {
    setErro(null);
    if (descricao.trim().length < 3) return setErro("Escreva a descrição do pedido.");
    if (!empresaId) return setErro("Escolha a empresa.");
    const somaRateio = rateio.reduce((s, r) => s + r.percentual, 0);
    if (rateio.length === 0 || Math.abs(somaRateio - 100) > 0.01) return setErro("Escolha a regional do pedido (o rateio soma 100%).");
    if (!reembolso && !fornecedorId) return setErro("Escolha o fornecedor que recebe, ou marque reembolso.");
    if (!(valor && valor > 0)) return setErro("Informe o valor.");
    if (!prevista) {
      return setErro(urgente ? "Escolha a data de pagamento: as quartas de exceções estão liberadas." : "Escolha a data de pagamento.");
    }
    if (urgente && justificativa.trim().length < 10) {
      setFaltaJustificativa(true);
      return setErro("Escreva a justificativa do pagamento urgente (mín. 10 caracteres).");
    }
    if (prevista !== prazoOriginal && tipoDoPrazo(prevista, hojeSp, feriados, urgente) === null) {
      return setErro(
        ehQuarta(prevista) && !ehJanelaDePagamento(prevista) && !urgente
          ? `A quarta de exceções só vale para pagamento urgente. A primeira data possível hoje é ${isoParaBr(primeiraJanelaComEnvioAberto(hojeSp, feriados))}.`
          : `O financeiro recebe o pedido até 15 dias antes da janela (a quarta, até a sexta anterior). A primeira data possível hoje é ${isoParaBr(primeiraDataPossivelDoPrazo(hojeSp, feriados, urgente))}.`,
      );
    }
    const problema = problemaDasParcelas(parcelas, valor ?? 0);
    if (problema) return setErro(problema);
    const fora = parcelas.length > 1 ? parcelaForaDaRegra(parcelas.map((x) => x.data_vencimento)) : null;
    if (fora) return setErro(`A ${fora}ª parcela está fora das janelas de pagamento.`);
    if (prontos.some((x) => !x.tipo)) setFaltouTipo(true);
    const falta = faltaNosComprovantes();
    if (falta) return setErro(falta);

    setEnviando(true);
    const r = await salvarPedidoDeDesembolso({
      id: pedido?.id ?? null,
      empresa_id: empresaId,
      descricao: descricao.trim(),
      favorecido_tipo: reembolso ? "reembolso" : "fornecedor",
      fornecedor_id: reembolso ? null : fornecedorId,
      valor,
      urgente,
      urgente_justificativa: urgente ? justificativa.trim() : null,
      rateio,
      parcelas: listaDeParcelas,
      anexos: prontos.map((a) => paraEnvio(a, reembolso)),
    });
    setEnviando(false);
    if (!r.ok) return setErro(r.message);
    onSalvo(modo === "novo" ? `${r.codigo} enviado ao financeiro.` : `${r.codigo} reenviado ao financeiro.`);
    fechar();
    router.refresh();
  }

  const titulo =
    modo === "novo"
      ? "Novo pedido de desembolso"
      : modo === "anexar"
        ? `Anexar o comprovante de ${pedido!.codigo}`
        : `Corrigir e reenviar ${pedido!.codigo}`;
  const descricaoDoTopo =
    modo === "novo"
      ? "O pedido vai ao financeiro com o comprovante. Depois de aprovado, vira título a pagar."
      : "O pedido volta para o financeiro com o mesmo código. O histórico guarda a rejeição.";
  const empresaNome = empresas.find((e) => e.id === empresaId)?.nome ?? "—";
  const regionalNome = regionais.find((r) => r.id === rateio[0]?.regional_id)?.nome ?? "—";

  return (
    <>
      <DialogHeader className="border-b border-border px-6 py-5">
        <DialogTitle>{titulo}</DialogTitle>
        <DialogDescription>{descricaoDoTopo}</DialogDescription>
      </DialogHeader>
      {pedido?.rejeitado && pedido.status === "rejeitada" && modo === "corrigir" && (
        <div className="mx-6 mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[12.5px]">
          <p className="text-[10px] font-bold uppercase tracking-wider text-red-700">
            Rejeitado{pedido.rejeitado.por ? ` por ${pedido.rejeitado.por}` : ""} em {dataBr(pedido.rejeitado.em)}
          </p>
          <p className="mt-1">“{pedido.rejeitado.motivo}”</p>
        </div>
      )}
      {modo === "anexar" && (
        <div className="mx-6 mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] text-amber-900">
          Este pedido foi enviado antes da regra do comprovante. O financeiro só aprova depois que ele for anexado.
        </div>
      )}
      <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-6 py-5">
        <Secao n={1} titulo="O que é">
          <div className="space-y-1.5">
            <Label htmlFor="des-descricao">Descrição *</Label>
            <Textarea
              id="des-descricao"
              rows={2}
              maxLength={500}
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Ex.: Almoço com o cliente depois da visita técnica"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Empresa e regional *</Label>
            {!trocar ? (
              <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                <Building2 className="h-4 w-4 flex-none text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{empresaNome}</p>
                  <p className="text-xs text-muted-foreground">{regionalNome} 100% · da sua alocação no RH</p>
                </div>
                <button
                  type="button"
                  onClick={() => setTrocar(true)}
                  className="flex-none text-xs font-semibold text-california-red underline-offset-2 hover:underline"
                >
                  Trocar
                </button>
              </div>
            ) : (
              <div className="space-y-3 rounded-lg border border-border p-3">
                {!alocacao?.regionalId && (
                  <p className="text-xs text-amber-800">
                    {alocacao ? "Sua alocação no RH não tem regional: escolha a regional do pedido." : "Não achamos a sua alocação no RH: escolha a empresa e a regional do pedido."}
                  </p>
                )}
                <Select value={empresaId || undefined} onValueChange={(v) => trocarEmpresa(v, [])}>
                  <SelectTrigger aria-label="Empresa">
                    <SelectValue placeholder="Selecione a empresa" />
                  </SelectTrigger>
                  <SelectContent>
                    {empresas.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <RateioRegionalEditor
                  linhas={rateio}
                  onChange={(linhas) => {
                    setRateio(linhas);
                    const t = tomadorDe(empresaId, linhas[0]?.regional_id ?? null);
                    if (t) setAnexos((a) => a.map((x) => (documentoTemCnpj(x.tipo) ? { ...x, nf: { ...x.nf, tomador: t } } : x)));
                  }}
                  regionais={regionais.filter((r) => r.empresa_id === empresaId)}
                />
                {alocacao?.regionalId && (
                  <button
                    type="button"
                    onClick={() => {
                      trocarEmpresa(alocacao.empresaId, rateioDaAlocacao);
                      setTrocar(false);
                    }}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-california-red underline-offset-2 hover:underline"
                  >
                    <Undo2 className="h-3.5 w-3.5" />
                    Voltar para a da alocação no RH
                  </button>
                )}
              </div>
            )}
          </div>
        </Secao>

        <Secao n={2} titulo="Quem recebe">
          <div className="grid grid-cols-2 gap-2">
            <Opcao ativo={!reembolso} onClick={() => setReembolso(false)} icone={Building2} titulo="Um fornecedor" sub="O financeiro paga direto ao fornecedor." />
            <Opcao ativo={reembolso} onClick={() => setReembolso(true)} icone={UserRound} titulo="Eu (reembolso)" sub="Você já pagou e recebe de volta." />
          </div>
          {reembolso ? (
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs">
              <p className="font-semibold">Pago na sua conta</p>
              <p className="mt-0.5 text-muted-foreground">A do seu cadastro no RH.</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>Fornecedor *</Label>
              <CampoFornecedor
                value={fornecedorId}
                onChange={setFornecedorId}
                fornecedores={fornecedores}
                contexto="desembolso"
                placeholder="Busque pelo nome ou CNPJ"
              />
            </div>
          )}
        </Secao>

        <Secao n={3} titulo="Quanto e quando">
          <div className="space-y-1.5">
            <Label htmlFor="des-valor">Valor *</Label>
            <MoneyInput
              id="des-valor"
              value={valor}
              onValueChange={(v) => {
                if (parcelas.length > 1) setParcelas((prev) => redividirParcelas(prev, valor ?? 0, v));
                setValor(v);
              }}
              className="max-w-[240px]"
            />
          </div>
          <div className="grid grid-cols-[200px_1fr] gap-3">
            <div className="space-y-1.5">
              <Label>Data de pagamento *</Label>
              <DatePicker
                key={`prazo-${prazoVez}`}
                name="des_data_pagamento"
                defaultValue={prevista || undefined}
                onDateChange={(d) => mudarPrazo(d ? iso(d) : "")}
                dateDisabled={diaForaDaJanela(hojeSp, prazoOriginal, feriados, urgente)}
                diasMarcados={quartaMarcada(hojeSp, feriados, urgente)}
                legenda={urgente ? <LegendaDaQuarta /> : undefined}
              />
              <EnvioAte vencimento={prevista} feriados={feriados} />
              {urgente && !prevista && (
                <p className="text-[11px] leading-snug text-california-red">Escolha a data de novo: as quartas de exceções estão liberadas.</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Parcelas</Label>
              <div role="radiogroup" aria-label="Parcelas" className="flex h-11 items-center gap-1.5">
                {[1, 2, 3, 4, 5, 6].map((k) => {
                  const ativo = !maisDeSeis && n === k;
                  return (
                    <button
                      key={k}
                      type="button"
                      role="radio"
                      aria-checked={ativo}
                      onClick={() => {
                        setMaisDeSeis(false);
                        mudarNumeroDeParcelas(k);
                      }}
                      className={cn(
                        "h-9 w-9 flex-none rounded-lg border font-mono text-[13px] font-semibold transition-colors",
                        ativo ? "border-foreground bg-foreground text-white" : "border-border bg-white hover:bg-muted/60",
                      )}
                    >
                      {k}
                    </button>
                  );
                })}
                <button
                  type="button"
                  role="radio"
                  aria-checked={maisDeSeis}
                  onClick={() => {
                    setMaisDeSeis(true);
                    if (n < 7) {
                      setParcelasTexto("7");
                      mudarNumeroDeParcelas(7);
                    }
                  }}
                  className={cn(
                    "h-9 flex-none rounded-lg border px-2.5 text-[12.5px] font-semibold transition-colors",
                    maisDeSeis ? "border-foreground bg-foreground text-white" : "border-border bg-white hover:bg-muted/60",
                  )}
                >
                  Mais de 6…
                </button>
                {maisDeSeis && (
                  <Input
                    aria-label="Número de parcelas (7 a 36)"
                    value={parcelasTexto}
                    onChange={(e) => {
                      const t = e.target.value.replace(/\D/g, "").slice(0, 2);
                      setParcelasTexto(t);
                      const k = Number(t);
                      if (k >= 7 && k <= 36) mudarNumeroDeParcelas(k);
                    }}
                    className="no-spinner h-9 w-14 text-center font-mono"
                    inputMode="numeric"
                  />
                )}
              </div>
            </div>
          </div>
          {prevista && prevista !== prazoOriginal && !vencimentoAceitaEnvio(prevista, hojeSp, feriados) && (
            <p className="text-[11px] leading-snug text-amber-800">
              O envio desta data ao financeiro já fechou. A primeira data possível hoje é{" "}
              {isoParaBr(primeiraDataPossivelDoPrazo(hojeSp, feriados, urgente))}.
            </p>
          )}
          {avisoQuarta && <AvisoQuartaSemUrgencia de={avisoQuarta.de} para={avisoQuarta.para} />}
          {parcelas.length > 1 && (
            <ParcelasDaPPField
              parcelas={parcelas}
              setParcelas={setParcelas}
              valorPP={valor ?? 0}
              onMudarData={(i, isoDia) => setParcelas((prev) => mudarDataDaParcela(prevista, prev, i, isoDia))}
            />
          )}
          <UrgenciaPPField
            urgente={urgente}
            justificativa={justificativa}
            onUrgenteChange={mudarUrgencia}
            onJustificativaChange={setJustificativa}
            destacarFalta={faltaJustificativa}
          />
        </Secao>

        <Secao n={4} titulo="Comprovante" extra={<span className="normal-case tracking-normal text-california-red">· obrigatório para enviar</span>}>
          <p className="text-[11.5px] leading-relaxed text-muted-foreground">
            {reembolso
              ? "O cupom, a nota ou o recibo de cada gasto, com número, data e valor."
              : "A NF, o recibo ou a fatura do que foi pago. Com NF, número, emissão, valor e CNPJ tomador."}
          </p>
          {prontos.length > 0 && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setVendo(itensDaLista(anexos).find((x) => x.status === "ok")?.id ?? null)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-california-red/40 hover:text-california-red"
              >
                <Eye className="h-3.5 w-3.5" />
                Visualizar anexos ({prontos.length})
              </button>
            </div>
          )}
          <ZonaDeAnexos id="des-arquivos" pronto={prefixo !== null} onArquivos={subir} />
          {avisoDosAnexos && <p className="text-[11.5px] font-semibold text-california-red">{avisoDosAnexos}</p>}
          <ListaDeAnexos
            itens={itensDaLista(anexos)}
            onTipo={mudarTipo}
            onNumero={(id, numero) => mudar(id, { numero })}
            onRemover={remover}
            onVer={(id) => setVendo(id)}
            tipoInvalido={(id) => faltouTipo && !anexos.find((x) => x.id === id)?.tipo}
            tipos={reembolso ? TIPOS_DE_COMPROVANTE : undefined}
            renderComprovante={reembolso ? camposDoComprovante : undefined}
            renderNf={camposDaNf}
            renderCnpj={reembolso ? undefined : cnpjDoDocumento}
          />
          {reembolso ? (
            <ResumoDosComprovantes anexos={anexos} valorPP={valor ?? 0} />
          ) : (
            <ResumoDasNfs valores={prontos.filter((x) => x.tipo === "nota_fiscal").map((x) => parteDaNf(x.nf))} valorPP={valor ?? 0} />
          )}
        </Secao>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-border bg-card px-6 py-4">
        <div className="min-w-0 text-sm">
          {erro && (
            <span className="flex items-center gap-2 text-california-red">
              <AlertCircle className="h-4 w-4 shrink-0" /> {erro}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <button
            type="button"
            onClick={fechar}
            className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={enviar}
            disabled={enviando}
            title={prontos.length > 0 ? undefined : "Anexe o comprovante para enviar"}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-california-red/90 disabled:opacity-60",
              prontos.length === 0 && "opacity-60",
            )}
          >
            <Send className="h-4 w-4" />
            {enviando ? "Enviando..." : modo === "novo" ? "Enviar ao financeiro" : "Reenviar ao financeiro"}
          </button>
        </div>
      </div>
      <VisualizarAnexos
        itens={itensDaLista(anexos)
          .filter((x) => x.status === "ok")
          .map((x) => {
            const a = anexos.find((y) => y.id === x.id)!;
            return { id: x.id, nome: x.nome, imagem: x.mime.startsWith("image/"), file: a.salvo ? undefined : a.file, salvo: a.salvo };
          })
          .reverse()}
        foco={vendo}
        onFechar={() => setVendo(null)}
      />
    </>
  );
}

function Opcao({
  ativo,
  onClick,
  icone: Icone,
  titulo,
  sub,
}: {
  ativo: boolean;
  onClick: () => void;
  icone: React.ComponentType<{ className?: string }>;
  titulo: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={cn(
        "flex items-start gap-3 rounded-xl border p-3 text-left transition-colors",
        ativo ? "border-california-red bg-california-red/5" : "border-border bg-white hover:border-california-red/40",
      )}
    >
      <Icone className={cn("mt-0.5 h-4 w-4 flex-none", ativo ? "text-california-red" : "text-muted-foreground")} />
      <span>
        <span className="block text-sm font-semibold">{titulo}</span>
        <span className="block text-xs text-muted-foreground">{sub}</span>
      </span>
    </button>
  );
}

/** O anexo no formato da Server Action: na NF, os quatro dados e a parte deste
 *  pedido; no reembolso, a data e o valor do comprovante (decisão 187). */
function paraEnvio(a: AnexoEmEdicao, reembolso: boolean) {
  const ehNf = a.tipo === "nota_fiscal";
  const numero = (ehNf ? a.nf.numero : a.numero ?? "").trim() || null;
  return {
    id: a.salvo ? a.id : null,
    path: a.path,
    nome: a.nome,
    tamanho: a.tamanhoBytes,
    mimetype: a.mime as PPAnexoMimetype,
    documento_tipo: a.tipo,
    documento_numero: a.tipo ? numero : null,
    nf_data_emissao: reembolso ? a.nf.emissao || null : ehNf ? a.nf.emissao || null : null,
    nf_valor: reembolso ? (a.nf.valor > 0 ? a.nf.valor : null) : ehNf && a.nf.valor > 0 ? a.nf.valor : null,
    nf_tomador_estabelecimento_id: reembolso ? null : documentoTemCnpj(a.tipo) ? a.nf.tomador || null : null,
    nf_valor_no_pedido: !reembolso && ehNf && a.nf.cobreOutra && a.nf.valorNaPP > 0 ? a.nf.valorNaPP : null,
  };
}
