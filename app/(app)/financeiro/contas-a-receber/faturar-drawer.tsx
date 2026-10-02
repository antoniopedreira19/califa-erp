"use client";

/**
 * O formulário de emissão da NF (Tela 3.3), em quatro modos:
 *
 * - `origem` com uma linha  → "Faturar JOB-XXXX"
 * - `origem` com N linhas   → "Faturamento agrupado" (uma NF, vários jobs)
 * - `avulso`                → NF sem vínculo com saldo de job
 * - `leitura`               → nota já emitida, tudo bloqueado
 *
 * O bloco "Jobs nesta NF" tem duas modalidades. Em **Valor integral** cada
 * job entra com o saldo cheio da sua parcela, como texto. Em
 * **Faturamento parcial** o valor vira campo: o que não for faturado agora
 * volta para a aba Faturamento e pode ser faturado depois em outra nota.
 *
 * As parcelas do rodapé são de RECEBIMENTO desta nota — cada uma vira um
 * título em Títulos a Receber, vinculado à MESMA NF. Não existe "NF
 * programada": esse modelo foi avaliado e descartado (notas de
 * implementação §4).
 *
 * Recebimento antes da NF (decisão 130): o que o cliente já pagou pelas
 * notas (ou pelo BV) desta NF vira a parcela 1, travada e já quitada. As
 * outras saem dos vencimentos do envio, com o recebido abatido em ordem, e
 * continuam editáveis.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { format, addDays } from "date-fns";
import {
  AlertCircle,
  CheckCircle2,
  CornerDownLeft,
  Eye,
  FileCheck2,
  FileText,
  Layers,
  Lock,
  Paperclip,
  Plus,
  Trash2,
  X,
  Send,
} from "lucide-react";
import { Dialog, DrawerContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { Combobox, COMBOBOX_COMO_SELECT } from "@/components/ui/combobox";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/ui/money-input";
import { cn, formatCnpj } from "@/lib/utils";
import { formatDataAsHoraBr } from "@/lib/formatar-data-hora";
import {
  repartirEmJobESave,
  rotuloDaQuebra,
} from "@/lib/calculos/save-faturamento";
import {
  BotaoInfo,
  InfoFaturamentoModal,
  type InfoFaturamento,
} from "@/components/financeiro/info-faturamento-modal";
import type { ContatoCobranca } from "@/lib/data/contatos-cobranca";
import type {
  PlanoContaTipo,
  PlanoContaSubtipo,
  RateioLinhaInput,
} from "@/lib/types";
import { RateioRegionalEditor } from "../contas-a-pagar/rateio-regional-editor";
import { emitirFaturamento, uploadNfPdf, urlAnexoNf } from "./actions";
import type { FaturamentoPendenteRow, FaturadoRow } from "./faturamento-list";
import { chaveDoRecebidoAntes, chaveInfoDoEnvio } from "./chave-info";
import { somaDosRecebidos, type RecebidoAntesDaNf } from "./recebimento-antes-nf-dialog";
import type { AnexoDaPo } from "@/components/envio/anexos-da-po";
import { rotuloMes } from "@/lib/calculos/meses-trimestre";
import {
  cnaesVigentes,
  estabelecimentoDoCalculo,
  feriadosDoCalculo,
} from "@/lib/fiscal/cadastro";
import { codigoDoCnae, rotuloDoCnae } from "@/lib/fiscal/calculos";
import {
  cnaesQueBatemComASugestao,
  diaDoPisCofins,
  rotuloDoEstabelecimento,
  sugestaoDoCnpj,
  type FiscalDoFaturar,
} from "@/lib/fiscal/faturar";
import { ImpostosDestaNota, ImpostosDestaNotaVazio } from "./impostos-desta-nota";

export type DrawerState =
  | { modo: "origem"; linhas: FaturamentoPendenteRow[] }
  | { modo: "avulso" }
  | { modo: "leitura"; nota: FaturadoRow };

type Parcela = { valor: number; data_vencimento: string };

interface Props {
  state: DrawerState;
  onClose: () => void;
  onEmitida: (mensagem: string) => void;
  tipos: PlanoContaTipo[];
  subtipos: PlanoContaSubtipo[];
  empresas: Array<{ id: string; nome: string }>;
  clientes: Array<{ id: string; nome: string }>;
  fornecedores: Array<{ id: string; nome: string }>;
  /**
   * Todas as regionais do tenant. O rateio da nota avulsa só oferece as da
   * empresa emissora (decisão 086).
   */
  regionais: Array<{ id: string; nome: string; ativo: boolean; empresa_id: string }>;
  proximoNf: string;
  /**
   * O que o envio para faturamento trouxe de cada job — PO, a instrução do
   * GP sobre a descrição da nota, e a quem cobrar. É o conteúdo do botão
   * `i` de cada linha (31/08/2026).
   *
   * Chave é o `job_id`. Não tem entrada para BV (que não tem envio) nem
   * para job anterior a 31/08/2026, e isso é estado legítimo — o modal
   * sabe mostrar cada vazio.
   */
  infoPorJob: Record<string, InfoJob>;
  /** O recebido antes da NF que espera a nota, pela chave da linha
   *  (`nota:<id>` ou `bv:<id>`) — decisão 130. */
  recebidosAntes: Record<string, RecebidoAntesDaNf[]>;
  /**
   * Módulo fiscal (02/10/2026): o cadastro de impostos (CNPJs emissores,
   * CNAEs de cada um, regimes, feriados) e as sugestões do CNPJ emissor e
   * do Nº NF de cada CNPJ, montadas pela página.
   */
  fiscal: FiscalDoFaturar;
}

/** O recebido antes da NF das notas (ou do BV) destas linhas, do mais
 *  antigo para o mais novo. Cada nota conta uma vez, mesmo com vários
 *  vencimentos na NF. */
function recebidosDasLinhas(
  linhas: FaturamentoPendenteRow[],
  recebidosAntes: Record<string, RecebidoAntesDaNf[]>,
): RecebidoAntesDaNf[] {
  const chaves = new Set(
    linhas
      .map((l) =>
        chaveDoRecebidoAntes(l.envio_nota_id, l.origem_tipo === "bv" ? l.origem_id : null),
      )
      .filter((k): k is string => k !== null),
  );
  return [...chaves]
    .flatMap((k) => recebidosAntes[k] ?? [])
    .sort((a, b) => a.data.localeCompare(b.data));
}

function centavos(n: number): number {
  return Math.round(n * 100) / 100;
}

/** O que o botão `i` mostra sobre um job. */
export interface InfoJob {
  po: string | null;
  descricaoNf: string | null;
  contatos: ContatoCobranca[];
  /** Arquivos da PO anexados no envio (decisão 123). */
  anexos: AnexoDaPo[];
}

function formatMoney(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function FaturarDrawer({
  state,
  onClose,
  onEmitida,
  tipos,
  subtipos,
  empresas,
  clientes,
  fornecedores,
  regionais,
  proximoNf,
  infoPorJob,
  recebidosAntes,
  fiscal,
}: Props) {
  const router = useRouter();
  const cad = fiscal.cadastro;

  const leitura = state.modo === "leitura";
  const avulso = state.modo === "avulso";
  const linhas = state.modo === "origem" ? state.linhas : [];
  const nota = state.modo === "leitura" ? state.nota : null;
  const comVinculo = state.modo === "origem" || leitura;

  const primeira = linhas[0] ?? null;
  const origemTipo: "job" | "bv" | "avulso" = primeira?.origem_tipo ?? "avulso";
  const ehBv = origemTipo === "bv";

  // Decisão 123: as linhas são PARCELAS (vencimentos); a nota do envio junta
  // as dela. Uma nota só = o Faturar de uma nota do envio; mais de uma = a
  // nota agrupada.
  const chaveNota = (l: FaturamentoPendenteRow) =>
    l.envio_nota_id ?? l.envio_parcela_id ?? l.origem_id;
  const umaNotaSo = new Set(linhas.map(chaveNota)).size === 1;
  // Quem mandou cada job ou BV desta nota (decisão 136): o envio para
  // faturamento é de qualquer GP, e o financeiro precisa saber com quem
  // falar. Uma entrada por job (as parcelas de um envio têm o mesmo autor).
  const autores = [
    ...new Map(
      linhas
        .filter((l) => l.autor_nome)
        .map((l) => [
          `${l.origem_tipo}:${l.codigo ?? l.origem_id}`,
          {
            codigo: l.codigo,
            nome: l.autor_nome as string,
            em: l.autor_em,
            bv: l.origem_tipo === "bv",
          },
        ]),
    ).values(),
  ];
  const autorDoDescritivo = linhas.find((l) => l.origem_tipo === "job" && l.autor_nome)?.autor_nome ?? null;
  const cnaeSugerido = (() => {
    const sugestoes = new Set(
      linhas.map((l) => l.cnae_sugerido?.trim()).filter((c): c is string => Boolean(c)),
    );
    return sugestoes.size === 1 ? [...sugestoes][0] : null;
  })();
  const cnpjDaNota =
    nota?.cnpj_tomador ?? (primeira?.origem_tipo === "job" ? primeira?.cnpj_tomador : null) ?? null;

  const [pending, startTransition] = React.useTransition();
  const [uploading, setUploading] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  // O `i` de cada job da nota. Fica aqui, e não na tabela, porque a
  // instrução do GP precisa poder ser lida NA HORA de escrever a
  // descrição da nota — inclusive na agrupada, job a job (31/08/2026).
  const [info, setInfo] = React.useState<InfoFaturamento | null>(null);

  /**
   * Monta o conteúdo do modal `i` para um job desta nota.
   *
   * Job sem entrada no mapa é estado legítimo — BV não tem envio para
   * faturamento, e job anterior a 31/08/2026 foi enviado antes de o campo
   * de descrição existir. O modal mostra cada vazio com a frase certa, em
   * vez de esconder o bloco.
   */
  function montarInfo(
    jobId: string | null,
    referencia: string,
    opcoes: {
      quebra?: { job: number; save: number } | null;
      codigoJob?: string | null;
      ehBv?: boolean;
      /** O descritivo da nota do envio (decisão 123), antes do do envio. */
      descritivoNota?: string | null;
      cnpj?: string | null;
      cnaeSugerido?: string | null;
    } = {},
  ): InfoFaturamento {
    const dados = jobId ? infoPorJob[jobId] : undefined;
    // No BV nada disso é dele: PO, instrução do GP e contato de cobrança são
    // do job, e o BV é cobrado do fornecedor. O modal explica cada vazio
    // (decisão do Tiago, 31/08/2026).
    if (opcoes.ehBv) {
      return {
        referencia,
        pos: [],
        descricaoNf: null,
        contatos: [],
        quebra: opcoes.quebra ?? null,
        ehBv: true,
      };
    }
    return {
      referencia,
      pos: [{ job: opcoes.codigoJob ?? "", po: dados?.po ?? null }],
      descricaoNf: opcoes.descritivoNota ?? dados?.descricaoNf ?? null,
      anexosPo: dados?.anexos ?? [],
      cnpj: opcoes.cnpj ?? null,
      cnaeSugerido: opcoes.cnaeSugerido ?? null,
      contatos: dados?.contatos ?? [],
      quebra: opcoes.quebra ?? null,
    };
  }

  // Jobs desta NF: o usuário pode tirar um do grupo antes de emitir.
  const [removidos, setRemovidos] = React.useState<Set<string>>(new Set());
  const itensAtivos = linhas.filter(
    (l) => !removidos.has(l.envio_parcela_id ?? l.origem_id),
  );

  const [modoValor, setModoValor] = React.useState<"total" | "parcial">("total");
  const [valores, setValores] = React.useState<Record<string, number>>(() =>
    Object.fromEntries(
      linhas.map((l) => [l.envio_parcela_id ?? l.origem_id, l.saldo]),
    ),
  );

  const [empresaId, setEmpresaId] = React.useState(
    nota?.empresa_id ?? primeira?.empresa_id ?? "",
  );
  // Módulo fiscal (02/10/2026): o CNPJ que emite a nota (matriz ou filial),
  // obrigatório. Vem escolhido pela regra aprovada — job da Hitlab vem com a
  // Hitlab; senão, o último usado para o mesmo CNPJ de cliente — e a frase
  // de ajuda diz por quê. Na nota já emitida, o CNPJ gravado nela.
  const [sugestaoCnpj] = React.useState(() => sugestaoDoCnpj(fiscal, primeira));
  const [estabId, setEstabId] = React.useState(
    nota ? (nota.estabelecimento_id ?? "") : (sugestaoCnpj.estabelecimentoId ?? ""),
  );
  // O Nº NF sugerido é o da numeração do CNPJ emissor (o maior emitido por
  // ele + 1; sem nota anterior, vazio para digitar). Sem CNPJ escolhido,
  // fica a sugestão de antes, até a escolha.
  const [numeroNf, setNumeroNf] = React.useState(
    nota?.numero_nf ??
      (sugestaoCnpj.estabelecimentoId
        ? (fiscal.proximaNfPorEstab[sugestaoCnpj.estabelecimentoId] ?? "")
        : proximoNf),
  );
  const [dataEmissao, setDataEmissao] = React.useState(
    nota?.data_emissao ?? format(new Date(), "yyyy-MM-dd"),
  );
  // Classificação fiscal da nota. Saiu do envio para faturamento em
  // 31/08/2026 — lá era pedida ao GP, que não tem como saber. Quem emite a
  // nota é quem responde por ela.
  // Módulo fiscal: deixa de ser texto livre — é o id de um CNAE da lista do
  // CNPJ emissor (`fiscal_cnaes`); o texto `cnae` da nota sai dele.
  const [cnaeId, setCnaeId] = React.useState(nota?.fiscal_cnae_id ?? "");

  // As listas do CNPJ escolhido. Data de emissão apagada no meio do
  // preenchimento não some com a lista: vale a de hoje até a nova data.
  const dataDasListas = dataEmissao || format(new Date(), "yyyy-MM-dd");
  const estabsAtivos = cad.estabelecimentos.filter((e) => e.ativo);
  const estabEscolhido = leitura ? null : (estabsAtivos.find((e) => e.id === estabId) ?? null);
  const estabDoCalculo = estabEscolhido
    ? estabelecimentoDoCalculo(cad, estabEscolhido, dataDasListas)
    : null;
  const cnaesDoEstab = estabEscolhido ? cnaesVigentes(cad, estabEscolhido.id, dataDasListas) : [];
  const cnaeEscolhido = cnaesDoEstab.find((c) => c.id === cnaeId) ?? null;

  // Trocar o CNPJ refaz a sugestão do Nº NF e procura no CNPJ novo o mesmo
  // CNAE (código e subitem); se ele não tiver, o CNAE volta a ser escolhido.
  function trocarCnpj(novo: string) {
    setEstabId(novo);
    setNumeroNf(fiscal.proximaNfPorEstab[novo] ?? "");
    const codigoAtual = cnaeEscolhido ? codigoDoCnae(cnaeEscolhido) : null;
    const mesmo = codigoAtual
      ? cnaesVigentes(cad, novo, dataDasListas).find((c) => codigoDoCnae(c) === codigoAtual)
      : undefined;
    setCnaeId(mesmo?.id ?? "");
    setErro(null);
  }

  // A lista de CNAEs do CNPJ emissor. O 82.30-0-01 aparece duas vezes
  // (subitens 12.08 e 17.10); o sugerido pelo GP vem marcado, sem vir
  // escolhido (D3, decisão 123: quem emite confere o CNAE certo).
  const sugeridos = cnaesQueBatemComASugestao(cnaesDoEstab, cnaeSugerido);
  const itensCnae = cnaesDoEstab.map((c) => {
    const marcas = [
      c.cumulativo && estabDoCalculo?.regime === "lucro_real" ? "alíquota reduzida, sem crédito" : null,
      sugeridos.has(c.id) ? "sugerido pelo GP" : null,
    ].filter((m): m is string => m !== null);
    return {
      value: c.id,
      label: rotuloDoCnae(c),
      descricao: marcas.length > 0 ? marcas.join(" · ") : undefined,
    };
  });
  const sugeridoForaDoCnpj = Boolean(estabEscolhido && cnaeSugerido && sugeridos.size === 0);

  // Na nota já emitida: o CNPJ e o CNAE gravados nas colunas novas; nas
  // notas de antes do módulo fiscal, o texto do CNAE que houver.
  const estabDaNota = nota?.estabelecimento_id
    ? (cad.estabelecimentos.find((e) => e.id === nota.estabelecimento_id) ?? null)
    : null;
  const cnaeDaNota = nota?.fiscal_cnae_id
    ? (cad.cnaes.find((c) => c.id === nota.fiscal_cnae_id) ?? null)
    : null;

  // A nota saiu, mas o registro do CNPJ emissor e do CNAE falhou: o
  // formulário fica aberto com o aviso, e só fecha — emitir de novo
  // duplicaria a nota.
  const [emitidaComAviso, setEmitidaComAviso] = React.useState<{
    aviso: string;
    mensagem: string;
  } | null>(null);
  function fechar() {
    if (emitidaComAviso) onEmitida(emitidaComAviso.mensagem);
    else onClose();
  }

  const [descricao, setDescricao] = React.useState(() => {
    if (nota) return nota.descricao;
    // NF agrupada nasce em BRANCO de propósito (decisão do Tiago,
    // 31/08/2026): cada job tem a sua instrução do GP, e emendar as três
    // produziria um texto que nenhum dos clientes pediu. Quem emite lê uma
    // a uma pelo botão `i` da linha do job e escreve a descrição da nota.
    // Desde a decisão 123 as parcelas de UMA nota do envio chegam juntas, e
    // isso não é agrupada: a nota nasce com o descritivo dela.
    if (!umaNotaSo) return "";
    if (primeira?.descritivo_nota?.trim()) return primeira.descritivo_nota.trim();
    // Job único: nasce com o que o GP mandou. Sem instrução — envio
    // anterior a 31/08/2026 ou BV, que não tem envio — cai no nome do job,
    // que é o que a tela sugeria antes.
    // Job mensal (decisão 078): a instrução é a do MÊS da linha.
    const info = primeira
      ? (infoPorJob[chaveInfoDoEnvio(primeira.origem_id, primeira.mes_referencia)] ??
        infoPorJob[primeira.origem_id])
      : undefined;
    return info?.descricaoNf?.trim() || primeira?.descricao || "";
  });
  const [anexoPath, setAnexoPath] = React.useState<string | null>(
    nota?.anexo_nf_path ?? null,
  );
  const [anexoNome, setAnexoNome] = React.useState<string | null>(
    nota ? `NF-${nota.numero_nf}.pdf` : null,
  );
  const [pdfUrl, setPdfUrl] = React.useState<string | null>(null);

  // Campos do avulso
  const [avClienteId, setAvClienteId] = React.useState("");
  const [avValor, setAvValor] = React.useState(0);
  const [avTipoId, setAvTipoId] = React.useState("");
  const [avSubtipoId, setAvSubtipoId] = React.useState("");
  // Rateio de regional da nota avulsa (decisão 086). Nasce com uma linha em
  // branco, como a despesa sem job: não há de onde sugerir.
  const [avRateio, setAvRateio] = React.useState<RateioLinhaInput[]>([
    { regional_id: "", percentual: 100 },
  ]);
  const regionaisDaEmpresa = React.useMemo(
    () => regionais.filter((r) => r.empresa_id === empresaId),
    [regionais, empresaId],
  );
  // Trocar a empresa emissora limpa as regionais que não são dela: o banco
  // recusaria, e a linha mostraria um nome que a lista não oferece.
  React.useEffect(() => {
    if (!avulso) return;
    setAvRateio((atual) =>
      atual.map((l) =>
        l.regional_id && !regionaisDaEmpresa.some((r) => r.id === l.regional_id)
          ? { ...l, regional_id: "" }
          : l,
      ),
    );
  }, [avulso, regionaisDaEmpresa]);

  const totalNf = avulso
    ? avValor
    : leitura
      ? (nota?.valor_total ?? 0)
      : itensAtivos.reduce(
          (s, l) => s + (valores[l.envio_parcela_id ?? l.origem_id] ?? 0),
          0,
        );

  // Recebido antes da NF (decisão 130): vira a parcela 1, travada. Conta
  // pelas notas que continuam na NF — tirar o job da nota tira o recebido
  // dele junto, como faz `emitir_faturamento`.
  const recebidosDaNf = state.modo === "origem" ? recebidosDasLinhas(itensAtivos, recebidosAntes) : [];
  const antesTotal = somaDosRecebidos(recebidosDaNf);
  const temAntes = antesTotal > 0;
  const antesData = recebidosDaNf[0]?.data ?? "";
  const restoNf = centavos(totalNf - antesTotal);

  // As parcelas que o usuário edita. Com recebido antes da NF, a parcela 1
  // não está aqui: ela é o recebido, travada, e entra na frente na emissão.
  const [parcelas, setParcelas] = React.useState<Parcela[]>(() => {
    if (nota) {
      // As parcelas REAIS da nota, na ordem em que foram geradas. A
      // versão anterior montava uma parcela sintética com o total, e uma
      // NF emitida em 2× reabria dizendo 1× (corrigido em 18/08/2026).
      // O fallback só existe para nota antiga sem título vinculado.
      if (nota.parcelas.length > 0) {
        return nota.parcelas.map((p) => ({
          valor: p.valor,
          data_vencimento: p.data_vencimento,
        }));
      }
      return [
        {
          valor: nota.valor_total,
          data_vencimento: nota.primeiro_vencimento ?? nota.data_emissao,
        },
      ];
    }
    const antesInicial = somaDosRecebidos(recebidosDasLinhas(linhas, recebidosAntes));
    // Uma nota do envio com vários vencimentos (decisão 123): cada
    // vencimento vira uma parcela do recebimento, com o saldo dele. O
    // recebido antes da NF sai dos vencimentos em ordem (decisão 130, E3):
    // o que ele cobre inteiro some, o seguinte fica com o que sobra.
    if (umaNotaSo && linhas.length > 1) {
      let resta = antesInicial;
      return linhas
        .map((l) => {
          const usa = Math.min(l.saldo, resta);
          resta = centavos(resta - usa);
          return {
            valor: centavos(l.saldo - usa),
            data_vencimento:
              l.data_prevista ?? format(addDays(new Date(), 30), "yyyy-MM-dd"),
          };
        })
        .filter((p) => p.valor > 0.004);
    }
    const resto = centavos((primeira?.saldo ?? 0) - antesInicial);
    if (antesInicial > 0 && resto <= 0.004) return [];
    return [
      {
        valor: resto,
        data_vencimento:
          primeira?.data_prevista ?? format(addDays(new Date(), 30), "yyyy-MM-dd"),
      },
    ];
  });

  // Enquanto houver UMA parcela, ela espelha o total — o usuário não
  // precisa redigitar o valor a cada ajuste. Com duas ou mais, ele mandou
  // repartir e o espelho pararia por cima do que ele escreveu. Com recebido
  // antes da NF, espelha o que falta depois dele.
  React.useEffect(() => {
    if (leitura) return;
    setParcelas((atuais) =>
      atuais.length === 1 ? [{ ...atuais[0], valor: Math.max(restoNf, 0) }] : atuais,
    );
  }, [restoNf, leitura]);

  const somaParcelas = antesTotal + parcelas.reduce((s, p) => s + p.valor, 0);
  const somaOk = Math.abs(somaParcelas - totalNf) < 0.01;

  const saldoTotal = itensAtivos.reduce((s, l) => s + l.saldo, 0);
  const volta = Math.max(saldoTotal - totalNf, 0);
  const diverge = state.modo === "origem" && volta > 0.01;

  const subtiposDoTipo = avTipoId
    ? subtipos.filter((s) => s.tipo_id === avTipoId && s.ativo)
    : [];
  const tiposAtivos = tipos.filter((t) => t.ativo);

  const clienteLabel = avulso
    ? (clientes.find((c) => c.id === avClienteId)?.nome ?? "Definido no bloco acima")
    : leitura
      ? (nota?.contraparte_nome ?? "—")
      : (primeira?.contraparte_nome ?? "—");

  const notasAtivas = new Set(itensAtivos.map(chaveNota)).size;
  const jobsAtivos = new Set(itensAtivos.map((l) => l.origem_id)).size;
  const titulo = leitura
    ? `NF ${nota?.numero_nf} emitida`
    : avulso
      ? "Faturamento avulso"
      : notasAtivas > 1
        ? "Faturamento agrupado"
        : `Faturar ${primeira?.codigo ?? primeira?.descricao ?? ""}`;

  const cnpjTexto = cnpjDaNota ? ` · CNPJ ${formatCnpj(cnpjDaNota)}` : "";
  const subtitulo = leitura
    ? `Somente leitura · emitida em ${formatarData(nota?.data_emissao ?? "")} para ${nota?.contraparte_nome}${cnpjTexto}.`
    : avulso
      ? "Nota fiscal sem vínculo com saldo de job — informe cliente, valor e centro de custo."
      : `Cliente ${primeira?.contraparte_nome ?? "—"}${cnpjTexto} · uma única nota fiscal; o valor por job pode ser total ou parcial.`;

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErro(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await uploadNfPdf(fd);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      setAnexoPath(res.path);
      setAnexoNome(file.name);
    } finally {
      setUploading(false);
    }
  }

  async function alternarPdf() {
    if (pdfUrl) {
      setPdfUrl(null);
      return;
    }
    if (!anexoPath) return;
    const res = await urlAnexoNf(anexoPath);
    if (!res.ok) {
      setErro(res.message);
      return;
    }
    setPdfUrl(res.url);
  }

  function trocarModo(modo: "total" | "parcial") {
    setModoValor(modo);
    setErro(null);
    if (modo === "total") {
      setValores(
        Object.fromEntries(linhas.map((l) => [l.envio_parcela_id ?? l.origem_id, l.saldo])),
      );
    }
  }

  function aplicarParcelamento(n: number) {
    // Com recebido antes da NF, reparte só o que falta depois da parcela 1.
    const cents = Math.round(restoNf * 100);
    if (cents <= 0) return;
    const base = Math.floor(cents / n);
    const sobra = cents - base * n;
    setParcelas(
      Array.from({ length: n }, (_, i) => ({
        valor: (i === n - 1 ? base + sobra : base) / 100,
        data_vencimento: format(addDays(new Date(), 30 * (i + 1)), "yyyy-MM-dd"),
      })),
    );
    setErro(null);
  }

  function handleEmitir() {
    setErro(null);

    if (emitidaComAviso) return;
    if (!empresaId || !estabEscolhido || !numeroNf.trim() || !dataEmissao) {
      setErro("Informe a empresa (gerencial), o CNPJ emissor, o número da NF e a data de emissão.");
      return;
    }
    if (avulso && (!avClienteId || !avTipoId || !avSubtipoId)) {
      setErro("No faturamento avulso, informe o cliente e o centro de custo.");
      return;
    }
    if (avulso) {
      if (avRateio.length === 0 || avRateio.some((l) => !l.regional_id)) {
        setErro("No faturamento avulso, escolha a regional de cada linha do rateio.");
        return;
      }
      const somaRateio = avRateio.reduce((s, l) => s + l.percentual, 0);
      if (Math.abs(somaRateio - 100) >= 0.01) {
        setErro("O rateio de regional da nota precisa somar 100%.");
        return;
      }
    }
    if (!avulso) {
      const excedidos = itensAtivos.filter(
        (l) => (valores[l.envio_parcela_id ?? l.origem_id] ?? 0) > l.saldo + 0.01,
      );
      if (excedidos.length > 0) {
        setErro(
          `${excedidos.map((l) => l.codigo ?? l.descricao).join(", ")}: o valor a ` +
            "faturar não pode ser maior que o saldo a faturar do job.",
        );
        return;
      }
    }
    if (temAntes && antesTotal > totalNf + 0.004) {
      setErro(
        `O recebido antes da NF (${formatMoney(antesTotal)}) passa do valor desta ` +
          `nota (${formatMoney(totalNf)}). Fature ao menos o que já foi recebido.`,
      );
      return;
    }
    if (descricao.trim().length < 3) {
      setErro("Escreva a descrição que vai na nota fiscal.");
      return;
    }
    if (!cnaeEscolhido) {
      setErro("Escolha o CNAE a ser utilizado na nota.");
      return;
    }
    if (!anexoPath) {
      setErro("Anexe o PDF da nota fiscal antes de emitir.");
      return;
    }
    if (totalNf <= 0) {
      setErro("O valor total da NF precisa ser maior que zero.");
      return;
    }
    if (parcelas.some((p) => p.valor <= 0)) {
      setErro("Toda parcela precisa ter valor maior que zero — remova a que ficou zerada.");
      return;
    }
    if (!somaOk) {
      setErro(
        `A soma das parcelas (${formatMoney(somaParcelas)}) não fecha com o total ` +
          `da NF (${formatMoney(totalNf)}).`,
      );
      return;
    }

    const itens = avulso
      ? [
          {
            origem_tipo: "avulso" as const,
            origem_id: null,
            envio_parcela_id: null,
            valor: totalNf,
          },
        ]
      : itensAtivos.flatMap((l) => {
          const valor = valores[l.envio_parcela_id ?? l.origem_id] ?? 0;
          // A parcela do envio vale o faturamento previsto inteiro, save
          // incluído — e na nota isso sai em DOIS itens, porque cada um
          // tem destino diferente no fluxo de caixa. Job primeiro: o save
          // só começa depois que a parte do job está coberta, então
          // faturar parcial não toca no save.
          const parte = repartirEmJobESave(valor, l.saldo_proprio);
          const itensDaLinha: Array<{
            origem_tipo: "job" | "bv" | "save";
            origem_id: string | null;
            envio_parcela_id: string | null;
            valor: number;
          }> = [];
          if (parte.job > 0.004) {
            itensDaLinha.push({
              origem_tipo: l.origem_tipo,
              origem_id: l.origem_id,
              envio_parcela_id: l.envio_parcela_id,
              valor: parte.job,
            });
          }
          if (parte.save > 0.004) {
            itensDaLinha.push({
              // O save sai na nota do job que o GEROU, e é ele que o
              // `origem_id` aponta — o que separa os dois itens é o tipo.
              origem_tipo: "save",
              origem_id: l.origem_id,
              envio_parcela_id: l.envio_parcela_id,
              valor: parte.save,
            });
          }
          return itensDaLinha;
        });

    startTransition(async () => {
      const res = await emitirFaturamento({
        empresa_id: empresaId,
        origem_tipo: avulso ? "avulso" : origemTipo,
        origem_id: avulso ? null : (itensAtivos[0]?.origem_id ?? null),
        cliente_id: avulso ? avClienteId : ehBv ? null : (primeira?.cliente_id ?? null),
        fornecedor_id: ehBv ? (primeira?.fornecedor_id ?? null) : null,
        numero_nf: numeroNf.trim(),
        data_emissao: dataEmissao,
        valor_total: totalNf,
        descricao: descricao.trim(),
        // O texto da nota continua gravado ("82.30-0-01 · 12.08"), agora
        // tirado do CNAE da lista; o CNPJ emissor e o id do CNAE são
        // registrados logo depois da emissão (`registrar_fiscal_da_nota`).
        cnae: codigoDoCnae(cnaeEscolhido),
        estabelecimento_id: estabEscolhido.id,
        fiscal_cnae_id: cnaeEscolhido.id,
        anexo_nf_path: anexoPath,
        plano_conta_tipo_id: avulso ? avTipoId : null,
        plano_conta_subtipo_id: avulso ? avSubtipoId : null,
        rateio: avulso ? avRateio : [],
        itens,
        // A parcela 1 é o recebido antes da NF, quando houver: o banco
        // confere o valor e a transforma nas baixas desses recebimentos.
        parcelas: [
          ...(temAntes ? [{ valor: antesTotal, data_vencimento: antesData }] : []),
          ...parcelas,
        ].map((p, i) => ({
          numero: i + 1,
          valor: p.valor,
          data_vencimento: p.data_vencimento,
        })),
      });

      if (!res.ok) {
        setErro(res.message);
        return;
      }

      const parciais = itensAtivos.filter(
        (l) => (valores[l.envio_parcela_id ?? l.origem_id] ?? 0) < l.saldo - 0.01,
      );
      const detalhe = avulso
        ? ` · avulso para ${clientes.find((c) => c.id === avClienteId)?.nome ?? ""}`
        : jobsAtivos > 1
          ? ` cobrindo ${jobsAtivos} jobs de ${primeira?.contraparte_nome}`
          : ` · ${primeira?.codigo ?? ""}`;
      const sobra =
        parciais.length > 0
          ? ` · ${parciais.length} saldo(s) remanescente(s) de volta em Faturamento`
          : "";

      const mensagem = `NF ${numeroNf.trim()} emitida · ${formatMoney(totalNf)}${detalhe}${sobra}`;
      router.refresh();
      if (res.avisoFiscal) {
        setEmitidaComAviso({ aviso: res.avisoFiscal, mensagem });
        return;
      }
      onEmitida(mensagem);
    });
  }

  const obrigatorio = leitura ? null : <span className="text-california-red">*</span>;

  return (
    <>
      <Dialog
      open
      onOpenChange={(o) => {
        if (!o) fechar();
      }}
    >
      <DrawerContent className="sm:max-w-[620px]">
        <DialogHeader className="border-b border-border px-6 pb-4 pt-6">
          <DialogTitle className="flex flex-wrap items-center gap-2.5">
            <FileText className="h-4.5 w-4.5 shrink-0 text-california-red" />
            {titulo}
            {jobsAtivos > 1 && (
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-700">
                <Layers className="h-3 w-3" />
                Uma NF · {jobsAtivos} jobs
              </span>
            )}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">{subtitulo}</p>
          {autores.length > 0 && (
            <div className="mt-2 flex items-start gap-2.5 rounded-xl border border-california-red/15 bg-california-red/5 px-3.5 py-2.5 text-[12.5px] leading-relaxed">
              <Send className="mt-0.5 h-4 w-4 shrink-0 text-california-red" />
              <div className="min-w-0">
                {autores.map((a) => (
                  <div key={`${a.bv}:${a.codigo}:${a.nome}`}>
                    {autores.length > 1 && a.codigo && (
                      <span className="font-mono text-[11.5px] text-muted-foreground">{a.codigo} · </span>
                    )}
                    <span className="text-muted-foreground">
                      {a.bv ? "BV confirmado por" : "Enviado para faturamento por"}
                    </span>{" "}
                    <strong className="font-semibold text-foreground">{a.nome}</strong>
                    {a.em && (
                      <span className="text-muted-foreground"> em {formatDataAsHoraBr(a.em)}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          {/* Jobs nesta NF */}
          {comVinculo && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Jobs nesta NF
                </span>
                {!leitura && (
                  <div className="ml-auto flex items-center rounded-lg border border-border bg-muted p-0.5">
                    <BotaoModo
                      ativo={modoValor === "total"}
                      onClick={() => trocarModo("total")}
                      label="Valor integral"
                    />
                    <BotaoModo
                      ativo={modoValor === "parcial"}
                      onClick={() => trocarModo("parcial")}
                      label="Faturamento parcial"
                    />
                  </div>
                )}
              </div>

              <div className="overflow-hidden rounded-xl border border-border">
                {leitura
                  ? nota!.itens.map((i, idx) => (
                      <div
                        key={idx}
                        className={cn(
                          "flex items-center gap-3 px-3.5 py-3",
                          idx > 0 && "border-t border-border",
                        )}
                      >
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="truncate text-[13px] font-semibold">
                            {i.descricao}
                          </span>
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {i.codigo}
                          </span>
                        </div>
                        <span className="whitespace-nowrap font-mono text-sm font-bold">
                          {formatMoney(i.valor)}
                        </span>
                        {/* O item de save aponta para o MESMO job do item
                            próprio: dois botões abririam o mesmo modal. */}
                        {i.origem_tipo !== "save" && i.origem_id && (
                          <BotaoInfo
                            className="shrink-0"
                            onClick={() =>
                              setInfo(
                                montarInfo(
                                  i.origem_id,
                                  `${i.codigo} · ${i.descricao}`,
                                  { codigoJob: i.codigo },
                                ),
                              )
                            }
                          />
                        )}
                      </div>
                    ))
                  : itensAtivos.map((l, idx) => {
                      const k = l.envio_parcela_id ?? l.origem_id;
                      const valor = valores[k] ?? 0;
                      const excede = valor > l.saldo + 0.01;
                      const parcial = !excede && valor > 0 && valor < l.saldo - 0.01;
                      // A parcela pode carregar saldo em save, e aí a nota
                      // sai com dois itens. Quem emite precisa ver isso
                      // antes de assinar (docs/decisions/028).
                      const quebra = repartirEmJobESave(valor, l.saldo_proprio);
                      const rotuloQuebra = rotuloDaQuebra(quebra);
                      return (
                        <div
                          key={k}
                          className={cn(
                            "flex items-center gap-3 px-3.5 py-3",
                            idx > 0 && "border-t border-border",
                          )}
                        >
                          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="truncate text-[13px] font-semibold">
                                {l.descricao}
                              </span>
                              {parcial && (
                                <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-amber-800">
                                  Parcial
                                </span>
                              )}
                              {rotuloQuebra && (
                                <span className="shrink-0 rounded-full border border-[#c9c6bf] bg-[#f3f2ee] px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-[#5f5d57]">
                                  Save
                                </span>
                              )}
                            </div>
                            {rotuloQuebra && (
                              <span className="text-[11px] text-[#5f5d57]">
                                {quebra.job > 0.004 ? (
                                  <>
                                    {formatMoney(quebra.job)} do job ·{" "}
                                    <strong>{formatMoney(quebra.save)}</strong>{" "}
                                    em saldo de save
                                  </>
                                ) : (
                                  <>
                                    <strong>{formatMoney(quebra.save)}</strong>{" "}
                                    inteiros em saldo de save
                                  </>
                                )}
                              </span>
                            )}
                            <span className="font-mono text-[11px] text-muted-foreground">
                              {l.codigo}
                              {l.nota_ordem && l.nota_total
                                ? ` · NF ${l.nota_ordem}/${l.nota_total}`
                                : ""}
                              {l.data_prevista ? ` · vence ${formatarData(l.data_prevista)}` : ""} ·
                              valor {formatMoney(l.saldo)}
                            </span>
                            {parcial && (
                              <span className="inline-flex items-center gap-1.5 self-start text-[11px] font-semibold text-blue-700">
                                <CornerDownLeft className="h-3 w-3" />
                                {formatMoney(l.saldo - valor)} volta para a aba
                                Faturamento
                              </span>
                            )}
                          </div>

                          <div className="flex shrink-0 flex-col items-end gap-1.5">
                            {modoValor === "parcial" ? (
                              <>
                                <span className="text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground">
                                  Faturar agora
                                </span>
                                <div className="w-[148px]">
                                  <MoneyInput
                                    value={valor}
                                    onValueChange={(v) => {
                                      setValores((a) => ({ ...a, [k]: v }));
                                      setErro(null);
                                    }}
                                  />
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setValores((a) => ({
                                      ...a,
                                      [k]: Math.round(l.saldo * 50) / 100,
                                    }));
                                    setErro(null);
                                  }}
                                  className="rounded-md border border-border bg-white px-2 py-1 text-[10.5px] font-semibold text-muted-foreground transition-colors hover:border-california-red/40 hover:text-foreground"
                                >
                                  50% do valor
                                </button>
                              </>
                            ) : (
                              <span className="whitespace-nowrap font-mono text-sm font-bold">
                                {formatMoney(l.saldo)}
                              </span>
                            )}
                          </div>

                          <BotaoInfo
                            className="shrink-0"
                            onClick={() =>
                              setInfo(
                                montarInfo(
                                  // Job mensal (decisão 078): a PO e a
                                  // instrução são as do mês da linha.
                                  l.job_id
                                    ? chaveInfoDoEnvio(l.job_id, l.mes_referencia)
                                    : null,
                                  `${l.codigo ?? l.descricao}${
                                    l.mes_referencia ? ` · ${rotuloMes(l.mes_referencia)}` : ""
                                  }${l.nota_ordem && l.nota_total ? ` · NF ${l.nota_ordem}/${l.nota_total}` : ""}`,
                                  {
                                    quebra: quebra.save > 0.004 ? quebra : null,
                                    codigoJob: l.codigo,
                                    ehBv: l.origem_tipo === "bv",
                                    descritivoNota: l.descritivo_nota,
                                    cnpj: l.cnpj_tomador,
                                    cnaeSugerido: l.cnae_sugerido,
                                  },
                                ),
                              )
                            }
                          />

                          <button
                            type="button"
                            title="Remover job desta NF"
                            disabled={itensAtivos.length === 1}
                            onClick={() =>
                              setRemovidos((s) => new Set(s).add(k))
                            }
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-white text-muted-foreground transition-colors hover:text-california-red disabled:opacity-30 disabled:hover:text-muted-foreground"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      );
                    })}

                <div className="flex items-center gap-3 border-t border-border bg-muted/50 px-3.5 py-3">
                  <span className="text-xs font-semibold text-muted-foreground">
                    Valor total da NF
                  </span>
                  <span className="ml-auto font-mono text-[17px] font-bold tabular-nums">
                    {formatMoney(totalNf)}
                  </span>
                </div>
              </div>

              {diverge && (
                <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-xs text-blue-700">
                  <CornerDownLeft className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    Faturando {formatMoney(totalNf)} de {formatMoney(saldoTotal)} — o
                    saldo remanescente de{" "}
                    <strong className="font-bold">{formatMoney(volta)}</strong> volta
                    para a aba <strong className="font-bold">Faturamento</strong> e pode
                    ser faturado depois em outra NF.
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Bloco do avulso */}
          {avulso && (
            <div className="space-y-3.5">
              <div className="grid grid-cols-2 gap-3.5">
                <div className="space-y-1.5">
                  <Label>Cliente {obrigatorio}</Label>
                  <Combobox
                    items={clientes.map((c) => ({ value: c.id, label: c.nome }))}
                    value={avClienteId || null}
                    onChange={(v) => setAvClienteId(v ?? "")}
                    placeholder="Selecione o cliente"
                    buscaPlaceholder="Escreva o nome do cliente"
                    className={COMBOBOX_COMO_SELECT}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="av-valor">Valor total da NF {obrigatorio}</Label>
                  <MoneyInput
                    id="av-valor"
                    value={avValor}
                    onValueChange={(v) => {
                      setAvValor(v);
                      setErro(null);
                    }}
                  />
                </div>
              </div>
              <div>
                <div className="space-y-1.5">
                  <Label>Centro de custo {obrigatorio}</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <Combobox
                      items={tiposAtivos.map((t) => ({
                        value: t.id,
                        label: `${t.codigo} · ${t.nome}`,
                      }))}
                      value={avTipoId || null}
                      onChange={(v) => {
                        const novo = v ?? "";
                        setAvTipoId(novo);
                        setAvSubtipoId((atual) =>
                          subtipos.find((s) => s.id === atual)?.tipo_id === novo
                            ? atual
                            : "",
                        );
                      }}
                      placeholder="Tipo..."
                      buscaPlaceholder="Escreva o código ou o nome"
                      className={COMBOBOX_COMO_SELECT}
                    />
                    <Combobox
                      items={subtiposDoTipo.map((s) => ({
                        value: s.id,
                        label: s.nome,
                      }))}
                      value={avSubtipoId || null}
                      onChange={(v) => setAvSubtipoId(v ?? "")}
                      disabled={!avTipoId}
                      placeholder={avTipoId ? "Subtipo..." : "Escolha o tipo"}
                      buscaPlaceholder="Escreva o nome do subtipo"
                      className={COMBOBOX_COMO_SELECT}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Empresa e contraparte */}
          <div className="grid grid-cols-2 gap-3.5">
            <div className="space-y-1.5">
              {/* Módulo fiscal (02/10/2026): era "Empresa emissora". É a
                  classificação gerencial do job; quem emite é o CNPJ, logo
                  abaixo. */}
              <Label>Empresa (gerencial) {obrigatorio}</Label>
              <Select value={empresaId} onValueChange={setEmpresaId} disabled={leitura}>
                <SelectTrigger>
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
              {!leitura && (
                <p className="text-[11.5px] text-muted-foreground text-pretty">
                  Classificação gerencial do job. O CNPJ que emite a nota vem no campo abaixo.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>{ehBv ? "Fornecedor" : "Cliente"}</Label>
              {ehBv && !leitura ? (
                <Select
                  value={primeira?.fornecedor_id ?? ""}
                  onValueChange={() => undefined}
                  disabled
                >
                  <SelectTrigger>
                    <SelectValue placeholder={clienteLabel} />
                  </SelectTrigger>
                  <SelectContent>
                    {fornecedores.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="flex h-9 items-center gap-2 rounded-lg border border-dashed border-border bg-muted/50 px-3 text-[13px] text-muted-foreground">
                  <span className="truncate">{clienteLabel}</span>
                </div>
              )}
            </div>
          </div>

          {/* Módulo fiscal (02/10/2026): o CNPJ que emite a nota (matriz ou
              filial). A nota guarda o CNPJ; a numeração, a lista de CNAEs e
              os impostos saem dele. Linha inteira para o CNPJ caber. */}
          <div className="space-y-1.5">
            <Label>CNPJ emissor {obrigatorio}</Label>
            {leitura ? (
              <div className="flex h-9 items-center rounded-lg border border-border px-3 text-[13px]">
                {estabDaNota ? (
                  <span className="truncate">{rotuloDoEstabelecimento(estabDaNota)}</span>
                ) : (
                  <span className="truncate text-muted-foreground">Não registrado nesta nota.</span>
                )}
              </div>
            ) : (
              <Select
                value={estabEscolhido?.id ?? ""}
                // O Radix devolve "" quando o valor e a opção se desencontram:
                // não é escolha, e apagaria o Nº NF sugerido.
                onValueChange={(v) => {
                  if (v) trocarCnpj(v);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o CNPJ que emite a nota" />
                </SelectTrigger>
                <SelectContent>
                  {estabsAtivos.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {rotuloDoEstabelecimento(e)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {!leitura && sugestaoCnpj.ajuda && (
              <p className="text-[11.5px] text-muted-foreground text-pretty">{sugestaoCnpj.ajuda}</p>
            )}
          </div>

          {/* Rateio de regional da nota avulsa (decisão 086). Fica depois da
              empresa emissora porque depende dela: só as regionais da empresa
              entram. A nota de job não tem — a receita fica na regional do
              job. */}
          {avulso && (
            <div className="space-y-1.5">
              {empresaId ? (
                <RateioRegionalEditor
                  linhas={avRateio}
                  onChange={setAvRateio}
                  regionais={regionaisDaEmpresa}
                  disabled={pending}
                />
              ) : (
                <>
                  <Label>Rateio de regional {obrigatorio}</Label>
                  <p className="rounded-lg border border-dashed border-border bg-muted/50 px-3 py-2.5 text-[12.5px] text-muted-foreground">
                    Escolha a empresa (gerencial) para ver as regionais dela.
                  </p>
                </>
              )}
            </div>
          )}

          {leitura && nota?.origem_tipo === "avulso" && (
            <div className="space-y-1.5">
              <Label>Rateio de regional</Label>
              {nota.rateio.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {nota.rateio.map((r) => (
                    <span
                      key={r.regional_nome}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/50 px-3 py-1.5 text-[12.5px]"
                    >
                      {r.regional_nome}
                      <span className="font-mono font-semibold">
                        {r.percentual.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%
                      </span>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-[12.5px] text-muted-foreground">
                  Nota emitida antes do rateio de regional existir — sem divisão registrada.
                </p>
              )}
            </div>
          )}

          {/* NF e emissão */}
          <div className="grid grid-cols-2 gap-3.5">
            <div className="space-y-1.5">
              <Label htmlFor="numero-nf">Nº NF {obrigatorio}</Label>
              <Input
                id="numero-nf"
                type="text"
                value={numeroNf}
                readOnly={leitura}
                onChange={(e) => setNumeroNf(e.target.value)}
                placeholder="Ex: 12345"
                className="font-mono"
              />
              {/* Módulo fiscal: a sugestão vem da numeração do CNPJ emissor. */}
              {!leitura && (
                <p className="text-[11.5px] text-muted-foreground">
                  Numeração própria de cada CNPJ.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Emissão {obrigatorio}</Label>
              {leitura ? (
                <div className="flex h-9 items-center rounded-lg border border-border px-3 font-mono text-[13px]">
                  {formatarData(dataEmissao)}
                </div>
              ) : (
                <DatePicker
                  name="data_emissao"
                  defaultValue={dataEmissao}
                  onDateChange={(d) =>
                    setDataEmissao(d ? format(d, "yyyy-MM-dd") : "")
                  }
                />
              )}
            </div>
          </div>

          {/* CNAE — entre o número da nota e a descrição, a pedido do
              Tiago (31/08/2026). Antes era pedido à produção no envio; é
              classificação fiscal da nota, então é de quem a emite. */}
          {/* Módulo fiscal (02/10/2026): o texto livre vira lista (com busca)
              dos CNAEs vigentes do CNPJ emissor, com o subitem da LC 116. */}
          <div className="space-y-1.5">
            <Label htmlFor="cnae-nf">CNAE a ser utilizado {obrigatorio}</Label>
            {leitura ? (
              // Na nota emitida, o CNAE da lista por extenso; na nota de
              // antes do módulo fiscal, o texto que foi gravado.
              <Input
                id="cnae-nf"
                type="text"
                value={cnaeDaNota ? rotuloDoCnae(cnaeDaNota) : (nota?.cnae ?? "")}
                readOnly
              />
            ) : (
              <Combobox
                id="cnae-nf"
                items={itensCnae}
                value={cnaeEscolhido?.id ?? null}
                onChange={(v) => {
                  setCnaeId(v ?? "");
                  setErro(null);
                }}
                disabled={!estabEscolhido}
                // D3 (decisão 123): a sugestão do GP vem de FUNDO, sem
                // preencher — quem emite escolhe e confere o CNAE certo.
                placeholder={
                  !estabEscolhido
                    ? "Escolha o CNPJ emissor primeiro"
                    : cnaeSugerido
                      ? `Sugerido pelo GP: ${cnaeSugerido}`
                      : "Selecione o CNAE"
                }
                buscaPlaceholder="Escreva o código ou a atividade"
                className={COMBOBOX_COMO_SELECT}
              />
            )}
            {!leitura && sugeridoForaDoCnpj && (
              <p className="text-[11.5px] font-medium text-amber-800">
                O CNAE sugerido não está cadastrado neste CNPJ.
              </p>
            )}
          </div>

          {/* Descrição */}
          <div className="space-y-1.5">
            <Label htmlFor="descricao-nf">Descrição da NF {obrigatorio}</Label>
            <textarea
              id="descricao-nf"
              rows={2}
              value={descricao}
              readOnly={leitura}
              onChange={(e) => setDescricao(e.target.value)}
              maxLength={2000}
              placeholder="Ex: Serviços prestados em agosto/2026"
              className="w-full resize-none rounded-lg border border-border px-3 py-2.5 text-[13px] focus:border-california-red/40 focus:outline-none"
            />
            <p className="text-[11.5px] text-muted-foreground text-pretty">
              {!umaNotaSo
                ? "Cada job traz a instrução do seu gerente de projetos — leia uma a uma no botão de informações da linha e escreva aqui o texto da nota."
                : `Texto que vai na nota fiscal. Vem sugerido pelo descritivo que ${autorDoDescritivo ?? "o gerente de projetos"} mandou no envio.`}
            </p>
          </div>

          {/* Módulo fiscal (02/10/2026): os impostos que esta nota gera, só
              leitura. Aparece com CNPJ, CNAE, valor e data preenchidos;
              antes disso, a caixa que diz onde ele vai aparecer. */}
          {!leitura &&
            (estabEscolhido && estabDoCalculo && cnaeEscolhido && totalNf > 0 && dataEmissao ? (
              <ImpostosDestaNota
                estab={estabDoCalculo}
                nomeDaPJ={fiscal.nomeDaPJ[estabEscolhido.empresa_contabil_id] || estabEscolhido.nome}
                cnae={cnaeEscolhido}
                valor={centavos(totalNf)}
                emissao={dataEmissao}
                feriados={feriadosDoCalculo(cad)}
                diaPisCofins={diaDoPisCofins(cad)}
              />
            ) : (
              <ImpostosDestaNotaVazio />
            ))}

          {/* Anexo */}
          <div className="space-y-1.5">
            <Label>Anexo da NF (PDF) {obrigatorio}</Label>

            {anexoNome ? (
              <div className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/50 px-3 py-2.5 text-[12.5px]">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                <span className="min-w-0 flex-1 truncate">{anexoNome}</span>
                {leitura ? (
                  <button
                    type="button"
                    onClick={alternarPdf}
                    className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-white px-2.5 py-1.5 text-[11.5px] font-semibold transition-colors hover:border-california-red hover:text-california-red"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    {pdfUrl ? "Ocultar NF" : "Visualizar NF"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setAnexoPath(null);
                      setAnexoNome(null);
                    }}
                    aria-label="Remover anexo"
                    className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-california-red"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ) : (
              <div>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-[12.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                  <Paperclip className="h-3.5 w-3.5" />
                  {uploading ? "Enviando..." : "Anexar PDF"}
                  <input
                    type="file"
                    accept="application/pdf"
                    className="sr-only"
                    onChange={handleFile}
                    disabled={uploading}
                  />
                </label>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Apenas PDF · máx. 10 MB
                </p>
              </div>
            )}

            {pdfUrl && (
              <iframe
                src={pdfUrl}
                title="PDF da nota fiscal"
                className="h-[260px] w-full rounded-xl border border-border"
              />
            )}
          </div>

          {/* Parcelas do recebimento */}
          <div className="space-y-3 rounded-xl border border-border bg-muted/30 px-4 py-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Parcelas do recebimento desta NF
              </span>
              {!leitura && restoNf > 0.004 && (
                <div className="ml-auto flex gap-1.5">
                  {[2, 3, 6].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => aplicarParcelamento(n)}
                      className="rounded-md border border-border bg-white px-2 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:border-california-red hover:text-california-red"
                    >
                      {n}×
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-[22px_1fr_1fr_30px] gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              <span />
              <span className="text-right">Valor</span>
              <span>Vencimento</span>
              <span />
            </div>

            <div className="space-y-2">
              {temAntes && !leitura && (
                <div>
                  <div className="grid grid-cols-[22px_1fr_1fr_30px] items-center gap-2">
                    <span className="text-center font-mono text-[11.5px] text-muted-foreground">
                      1
                    </span>
                    <div className="flex h-9 items-center justify-end rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 font-mono text-[12.5px] font-semibold text-emerald-800">
                      {formatMoney(antesTotal)}
                    </div>
                    <div className="flex h-9 items-center rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 font-mono text-[12.5px] text-emerald-800">
                      {formatarData(antesData)}
                    </div>
                    <span
                      className="flex items-center justify-center text-emerald-700"
                      title="Já recebida"
                    >
                      <Lock className="h-3.5 w-3.5" />
                    </span>
                  </div>
                  <p className="ml-[30px] mt-1 text-[11px] text-emerald-800 text-pretty">
                    {recebidosDaNf.length === 1
                      ? `Recebida antes da NF, em ${formatarData(antesData)} (${recebidosDaNf[0].contaNome}). Nasce quitada.`
                      : `Recebida antes da NF em ${recebidosDaNf.length} recebimentos, ${
                          antesData === recebidosDaNf[recebidosDaNf.length - 1].data
                            ? `todos em ${formatarData(antesData)}`
                            : `de ${formatarData(antesData)} a ${formatarData(recebidosDaNf[recebidosDaNf.length - 1].data)}`
                        }. Nasce quitada, com uma baixa para cada.`}
                  </p>
                </div>
              )}
              {parcelas.map((p, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[22px_1fr_1fr_30px] items-center gap-2"
                >
                  <span className="text-center font-mono text-[11.5px] text-muted-foreground">
                    {i + 1 + (temAntes && !leitura ? 1 : 0)}
                  </span>
                  {leitura ? (
                    <div className="flex h-9 items-center justify-end rounded-lg border border-border bg-white px-2.5 font-mono text-[12.5px] font-semibold">
                      {formatMoney(p.valor)}
                    </div>
                  ) : (
                    <MoneyInput
                      value={p.valor}
                      onValueChange={(v) => {
                        setParcelas((a) =>
                          a.map((x, j) => (j === i ? { ...x, valor: v } : x)),
                        );
                        setErro(null);
                      }}
                    />
                  )}
                  {leitura ? (
                    <div className="flex h-9 items-center rounded-lg border border-border bg-white px-2.5 font-mono text-[12.5px]">
                      {formatarData(p.data_vencimento)}
                    </div>
                  ) : (
                    <DatePicker
                      // O DatePicker guarda a data dele: sem a chave, o
                      // "2×"/"3×" trocava o vencimento da parcela e a tela
                      // continuava mostrando o antigo.
                      key={p.data_vencimento}
                      name={`venc-${i}`}
                      defaultValue={p.data_vencimento}
                      onDateChange={(d) =>
                        setParcelas((a) =>
                          a.map((x, j) =>
                            j === i
                              ? { ...x, data_vencimento: d ? format(d, "yyyy-MM-dd") : "" }
                              : x,
                          ),
                        )
                      }
                    />
                  )}
                  {!leitura && (
                    <button
                      type="button"
                      // Com a parcela 1 travada, a última editável pode sair
                      // (o recebido cobre a nota inteira).
                      disabled={parcelas.length === 1 && !temAntes}
                      onClick={() =>
                        setParcelas((a) => a.filter((_, j) => j !== i))
                      }
                      aria-label="Remover parcela"
                      className="flex items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:text-california-red disabled:opacity-30 disabled:hover:text-muted-foreground"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2.5 border-t border-border pt-3">
              {!leitura && (
                <button
                  type="button"
                  onClick={() =>
                    setParcelas((a) => [
                      ...a,
                      {
                        valor: 0,
                        data_vencimento: format(
                          addDays(new Date(), 30 * (a.length + 1)),
                          "yyyy-MM-dd",
                        ),
                      },
                    ])
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border bg-white px-2.5 py-1.5 text-[11.5px] font-semibold text-muted-foreground transition-colors hover:border-california-red hover:text-california-red"
                >
                  <Plus className="h-3 w-3" /> Nova parcela
                </button>
              )}
              <span
                className={cn(
                  "ml-auto text-[11.5px] font-semibold",
                  somaOk ? "text-emerald-700" : "text-california-red",
                )}
              >
                Soma {formatMoney(somaParcelas)} / NF {formatMoney(totalNf)}
              </span>
            </div>
          </div>

          {erro && (
            <div className="flex items-start gap-2 rounded-lg border border-california-red/35 bg-california-red/[0.06] px-3 py-2.5 text-[12.5px] text-california-red">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{erro}</span>
            </div>
          )}

          {emitidaComAviso && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-california-red/35 bg-california-red/[0.06] px-3 py-2.5 text-[12.5px] text-california-red"
            >
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{emitidaComAviso.aviso}</span>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2.5 border-t border-border px-6 py-3.5">
          <p className="text-[11.5px] text-muted-foreground text-pretty">
            {leitura
              ? "NF já emitida — os jobs receberam a baixa do valor faturado e as parcelas estão em Títulos a Receber."
              : avulso
                ? "Ao emitir, as parcelas desta NF entram em Títulos a Receber como faturamento avulso, sem consumir saldo de nenhum job."
                : `Ao emitir, cada job recebe a baixa do valor faturado — o que sobrar do saldo permanece aguardando faturamento — e as parcelas entram em Títulos a Receber vinculadas à mesma nota.${
                    temAntes
                      ? recebidosDaNf.length === 1
                        ? ` A parcela 1 já entra recebida, com a data de ${formatarData(antesData)}; nada entra de novo na conta.`
                        : " A parcela 1 já entra recebida, com uma baixa para cada recebimento; nada entra de novo na conta."
                      : ""
                  }`}
          </p>
          <div className="flex items-center justify-end gap-2.5">
            {leitura || emitidaComAviso ? (
              <button
                type="button"
                onClick={fechar}
                className="rounded-lg border border-border bg-white px-3.5 py-2 text-sm font-semibold transition-colors hover:bg-muted"
              >
                Fechar
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={fechar}
                  className="rounded-lg px-3 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleEmitir}
                  disabled={pending || uploading}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-800 disabled:opacity-50"
                >
                  <FileCheck2 className="h-4 w-4" />
                  {pending ? "Emitindo..." : "Emitir NF"}
                </button>
              </>
            )}
          </div>
        </div>
      </DrawerContent>
      </Dialog>

      {/* Fora do <Dialog> do drawer, como o ConfirmDialog de Contas a Pagar:
          Radix aninha mal quando o segundo Root fica dentro do primeiro. O
          modal abre POR CIMA do drawer sem fechá-lo — quem está escrevendo a
          descrição não pode perder o formulário para consultar a instrução
          do GP. */}
      <InfoFaturamentoModal
        info={info}
        onOpenChange={(aberto) => {
          if (!aberto) setInfo(null);
        }}
      />
    </>
  );
}

function BotaoModo({
  ativo,
  onClick,
  label,
}: {
  ativo: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
        ativo ? "bg-white text-california-red shadow-sm" : "text-muted-foreground",
      )}
    >
      {label}
    </button>
  );
}

function formatarData(iso: string): string {
  if (!iso) return "—";
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${ano}`;
}
