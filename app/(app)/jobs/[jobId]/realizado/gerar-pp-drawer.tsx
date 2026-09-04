"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  X,
  Upload,
  FileText,
  Image as ImageIcon,
  Trash2,
  AlertTriangle,
  Plus,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Dialog, DrawerContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { format } from "date-fns";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { cn, formatCurrency } from "@/lib/utils";
import {
  PP_ANEXO_MIMETYPES_ACEITOS,
  PP_ANEXO_TAMANHO_MAX_BYTES,
  PP_ANEXOS_TAMANHO_TOTAL_MAX_BYTES,
  type PPAnexoMimetype,
  type DocumentoDoAnexo,
  type PedidoCompraNaLista,
} from "@/lib/types";
import {
  valorDaPPPorUnidade,
  dividirEmParcelas,
  parcelasFecham,
  passaDoPlanejado,
  proximoVencimento,
} from "@/lib/calculos/pps-item";
import {
  reservarPedidoCompra,
  finalizarPedidoCompra,
  prefixoAnexosPedidoCompra,
  editarPedidoCompraGerada,
} from "./actions-pp";
import { NovoFornecedorDialog } from "@/app/(app)/fornecedores/novo-fornecedor-dialog";
import type { FornecedorResumo } from "@/app/(app)/fornecedores/actions";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemRealizadoId: string | null;
  jobId: string;
  fornecedores: Array<{ id: string; nome: string; razao_social: string | null }>;
  empresas: Array<{ id: string; razao_social: string; principal: boolean }>;
  /** Membros ativos do tenant — exibidos quando switch Verba de Produção está ON. */
  responsaveis: Array<{ id: string; nome: string }>;
  defaultEmpresaId: string;
  itemDescricao: string;
  /** PLANEJADO do item — a referência da PP desde 02/09/2026 (era o
   *  orçado). É contra ele que "Em PPs emitidas" acende em vermelho. */
  valorPlanejado: number;
  /** Decomposição do planejado — R$ Unit. × QT × D/M, para o cartão
   *  mostrar de onde os três campos vêm. São referência apenas: os
   *  campos da PP nascem vazios (decisão do Tiago, 01/09/2026). */
  unitarioPlanejado: number;
  quantidadePlanejada: number;
  dmPlanejado: number;
  /** O que o item já tem em PPs que CHEGARAM ao financeiro. A prévia do
   *  cartão soma esta PP por cima. Sem teto: passar do planejado não
   *  impede gerar — muda quem pode enviar. */
  emPPsEmitidas: number;
  /** PP gerada sendo editada. Null = gerar uma nova (02/09/2026). */
  ppEditando: PedidoCompraNaLista | null;
  onSuccess?: (codigo: string, modo: "gerada" | "editada") => void;
}

/** Uma linha do parcelamento no formulário. */
interface ParcelaLocal {
  data_vencimento: string;
  /** Texto cru: o usuário pode estar no meio da digitação. */
  valor: string;
}

interface AnexoLocal {
  anexo_id: string;
  file: File;
  path: string;
  status: "selecionado" | "uploading" | "ok" | "erro" | "rejeitado";
  mensagem?: string;
  /** Que documento este arquivo é. Vai junto no insert do anexo e
   *  alimenta a coluna Documento da Conciliação (28/08/2026). */
  documento: DocumentoDoAnexo;
}

import { DocumentoDoAnexoField } from "@/components/financeiro/documento-do-anexo-field";

const BUCKET = "pedidos-compra";

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
}

function iconePorMime(mime: string): typeof FileText {
  if (mime.startsWith("image/")) return ImageIcon;
  return FileText;
}

function defaultPrazoPagamento(): string {
  const d = new Date();
  d.setDate(d.getDate() + 15);
  return format(d, "yyyy-MM-dd");
}

function dateToIso(date: Date | null): string {
  return date ? format(date, "yyyy-MM-dd") : "";
}

/** Fator (QT, D/M) sem zeros à direita: "2", não "2,000". */
function formatFator(n: number): string {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
}

/** Dinheiro sem o "R$" — a moeda já está no rótulo da coluna. */
function formatUnitario(n: number): string {
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Aceita "1.234,56" e "1234.56", como o resto das grades do sistema. */
function parseNumeroLocal(bruto: string): number {
  const s = bruto.trim();
  if (s === "") return 0;
  const normalizado = s.includes(",")
    ? s.replace(/\./g, "").replace(",", ".")
    : s;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : 0;
}

export function GerarPPDrawer({
  open,
  onOpenChange,
  itemRealizadoId,
  jobId,
  fornecedores,
  empresas,
  responsaveis,
  defaultEmpresaId,
  itemDescricao,
  valorPlanejado,
  unitarioPlanejado,
  quantidadePlanejada,
  dmPlanejado,
  emPPsEmitidas,
  ppEditando,
  onSuccess,
}: Props) {
  const editando = ppEditando !== null;
  const router = useRouter();
  const supabase = React.useMemo(() => createClient(), []);
  const [pending, startTransition] = React.useTransition();

  const [ppId, setPpId] = React.useState<string | null>(null);
  const [uploadPrefix, setUploadPrefix] = React.useState<string | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);

  // Switch Verba de Produção: OFF (default) → fornecedor obrigatório;
  // ON → responsável interno obrigatório, fornecedor escondido.
  const [verbaProducao, setVerbaProducao] = React.useState(false);
  const [fornecedorId, setFornecedorId] = React.useState<string>("");
  // Cadastro rápido de fornecedor (04/09/2026, decisão 048). O combo vem
  // do server component, então o fornecedor que acabou de nascer só
  // chegaria nele depois do `router.refresh()`; enquanto isso ele mora
  // aqui, mesclado à lista — igual ao projeto novo da abertura.
  const [novoFornecedorOpen, setNovoFornecedorOpen] = React.useState(false);
  const [fornecedorNovo, setFornecedorNovo] =
    React.useState<FornecedorResumo | null>(null);
  const fornecedoresVisiveis = React.useMemo(() => {
    if (!fornecedorNovo || fornecedores.some((f) => f.id === fornecedorNovo.id)) {
      return fornecedores;
    }
    return [...fornecedores, fornecedorNovo].sort((a, b) =>
      (a.razao_social ?? a.nome).localeCompare(b.razao_social ?? b.nome),
    );
  }, [fornecedores, fornecedorNovo]);

  // A seleção entra em dois tempos, de propósito. O Select do Radix
  // espelha o valor num <select> nativo escondido, e se o valor e a
  // <option> nova chegam na mesma renderização o nativo ainda não tem a
  // opção: ele volta pra "" e dispara `onValueChange("")`, apagando a
  // escolha (visto em 04/09/2026). Então primeiro o fornecedor entra na
  // lista, e só quando ele já está lá o efeito abaixo seleciona.
  const [fornecedorPendenteId, setFornecedorPendenteId] =
    React.useState<string | null>(null);
  React.useEffect(() => {
    if (!fornecedorPendenteId) return;
    if (fornecedoresVisiveis.some((f) => f.id === fornecedorPendenteId)) {
      setFornecedorId(fornecedorPendenteId);
      setFornecedorPendenteId(null);
    }
  }, [fornecedorPendenteId, fornecedoresVisiveis]);

  /** Selecionar um fornecedor que pode não estar na lista do server
   *  ainda (o recém-criado, ou o existente achado pelo documento). */
  function adotarFornecedor(f: FornecedorResumo) {
    if (!fornecedores.some((x) => x.id === f.id)) setFornecedorNovo(f);
    setFornecedorPendenteId(f.id);
    // Sem `router.refresh()` aqui, de propósito: o refresh no meio do
    // preenchimento re-renderiza a página inteira e zerava o formulário
    // (visto em 04/09/2026). A lista mesclada segura o fornecedor novo
    // até o drawer fechar — e o fechamento já dispara o refresh.
  }
  const [responsavelId, setResponsavelId] = React.useState<string>("");
  const [empresaId, setEmpresaId] = React.useState<string>(defaultEmpresaId);
  const [prazoPagamento, setPrazoPagamento] = React.useState<string>(defaultPrazoPagamento());
  // Descrição e quantidade abrem VAZIAS desde 17/08/2026: com PPs
  // parciais, herdar o nome e a quantidade do item induzia a pedir o item
  // inteiro para um fornecedor só, que é o oposto do que a tela faz.
  const [servico, setServico] = React.useState<string>("");
  const [especificacoes, setEspecificacoes] = React.useState<string>("");
  // O trio que define o valor da PP, espelhando as colunas do item na
  // planilha (01/09/2026). Nascem VAZIOS de propósito: preenchidos com o
  // orçado, induziriam a pedir o item inteiro a um fornecedor só, que é o
  // oposto do que a tela de PPs parciais faz. A decomposição do orçado
  // fica no cartão de cima, como referência do que digitar.
  const [unitario, setUnitario] = React.useState<string>("");
  const [quantidade, setQuantidade] = React.useState<string>("");
  const [dm, setDm] = React.useState<string>("");
  // Parcelas: sempre ao menos uma, e a primeira acompanha o "Prazo de
  // pagamento" — ela É o prazo, não uma linha extra.
  const [parcelas, setParcelas] = React.useState<ParcelaLocal[]>([]);

  const [anexos, setAnexos] = React.useState<AnexoLocal[]>([]);
  /** Anexos já gravados da PP em edição que o GP marcou para remover.
   *  Só somem de fato no salvar. */
  const [removidos, setRemovidos] = React.useState<Set<string>>(new Set());
  const abortedRef = React.useRef(false);
  // Lock sincrono contra double-submit: `pending` do useTransition ativa
  // 1 render depois, então dois cliques rápidos passam pelo disabled=pending.
  // Ref é setado ANTES do await → segundo click no mesmo tick é bloqueado.
  const submittingRef = React.useRef(false);

  // Chave para forcar remontagem do DatePicker ao reabrir o drawer
  const [drawerKey, setDrawerKey] = React.useState(0);

  // Reset ao abrir — e SÓ ao abrir. A chave diz qual sessão do
  // formulário está de pé (item + gerar/editar); enquanto ela não muda,
  // nenhum re-render do pai mexe no que a pessoa digitou. Antes o
  // efeito dependia de props que trocam de identidade num
  // `router.refresh()`, e o formulário zerava no meio do caminho
  // (04/09/2026).
  const chaveSessao = open
    ? `${itemRealizadoId ?? ""}|${ppEditando?.id ?? "nova"}`
    : null;
  const sessaoRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!open || !itemRealizadoId) {
      sessaoRef.current = null;
      return;
    }
    if (sessaoRef.current === chaveSessao) return;
    sessaoRef.current = chaveSessao;
    abortedRef.current = false;
    setErro(null);
    setPpId(null);
    setFornecedorPendenteId(null);
    setUploadPrefix(null);
    setAnexos([]);
    setRemovidos(new Set());
    setDrawerKey((k) => k + 1);

    if (ppEditando) {
      // Edição abre COM o que a PP já tem — o GP está consertando um
      // rascunho que existe, não montando uma fatia nova (mesma exceção
      // da correção de rejeitada, decisão 035 §4).
      setVerbaProducao(ppEditando.verba_producao);
      setFornecedorId(ppEditando.fornecedor_id ?? "");
      setResponsavelId(ppEditando.responsavel_verba_id ?? "");
      setEmpresaId(ppEditando.empresa_id);
      setPrazoPagamento(ppEditando.prazo_pagamento.slice(0, 10));
      setServico(ppEditando.servico);
      setUnitario(formatUnitario(ppEditando.valor_unitario));
      setQuantidade(formatFator(ppEditando.quantidade));
      setDm(formatFator(ppEditando.dias_meses));
      setEspecificacoes(ppEditando.especificacoes ?? "");
      const parcelasDaPP = ppEditando.parcelas ?? [];
      setParcelas(
        parcelasDaPP.length > 1
          ? parcelasDaPP.map((p) => ({
              data_vencimento: p.data_vencimento.slice(0, 10),
              valor: Number(p.valor).toFixed(2).replace(".", ","),
            }))
          : [],
      );
      setPpId(ppEditando.id);
      (async () => {
        const res = await prefixoAnexosPedidoCompra(ppEditando.id);
        if (!res.ok) {
          setErro(res.message);
          return;
        }
        setUploadPrefix(res.upload_prefix);
      })();
      return;
    }

    setVerbaProducao(false);
    setFornecedorId("");
    setResponsavelId("");
    setEmpresaId(defaultEmpresaId);
    setPrazoPagamento(defaultPrazoPagamento());
    setServico("");
    setUnitario("");
    setQuantidade("");
    setDm("");
    setEspecificacoes("");
    setParcelas([]);

    // Reserva pp_id + upload_prefix
    (async () => {
      const res = await reservarPedidoCompra(itemRealizadoId);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      setPpId(res.pp_id);
      setUploadPrefix(res.upload_prefix);
    })();
    // A chave resume as deps que importam; as demais (defaultEmpresaId,
    // ppEditando inteiro) só seriam relidas numa sessão nova.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, itemRealizadoId, chaveSessao]);

  // DESABILITADO — o cleanup automatico estava disparando entre upload e
  // finalizar (quando ppId mudava por qualquer re-render), apagando os
  // anexos que o user acabou de subir. Arquivos orfaos ficam no bucket ate
  // cancelamento explicito. Aceitavel no MVP; job de limpeza noturno futuro.
  //
  // React.useEffect(() => {
  //   return () => {
  //     if (!ppId || abortedRef.current) return;
  //     abortarReserva(ppId, jobId).catch(() => {});
  //   };
  // }, [ppId, jobId]);

  async function onFileSelect(files: FileList | null) {
    if (!files || files.length === 0) return;

    if (!uploadPrefix) {
      setErro(
        "Aguarde: a preparação da PP ainda não terminou. Tente novamente em 2 segundos.",
      );
      return;
    }

    const somaAtual =
      anexos.reduce((s, a) => s + a.file.size, 0) +
      anexosMantidos.reduce((s, a) => s + a.arquivo_tamanho_bytes, 0);
    let somaAcumulada = somaAtual;
    // Cada arquivo vira uma linha imediatamente — mesmo rejeitados.
    // User sempre vê feedback do que aconteceu com cada arquivo escolhido.
    const novos: AnexoLocal[] = [];

    for (const file of Array.from(files)) {
      const anexo_id = crypto.randomUUID();
      const base = {
        anexo_id,
        file,
        path: "",
        documento: { tipo: null, numero: null } as DocumentoDoAnexo,
      };

      if (!PP_ANEXO_MIMETYPES_ACEITOS.includes(file.type as PPAnexoMimetype)) {
        novos.push({
          ...base,
          status: "rejeitado",
          mensagem: `Tipo não aceito (${file.type || "sem mimetype"}).`,
        });
        continue;
      }
      if (file.size > PP_ANEXO_TAMANHO_MAX_BYTES) {
        novos.push({
          ...base,
          status: "rejeitado",
          mensagem: `Excede 8 MB (${(file.size / 1024 / 1024).toFixed(1)} MB).`,
        });
        continue;
      }
      if (somaAcumulada + file.size > PP_ANEXOS_TAMANHO_TOTAL_MAX_BYTES) {
        novos.push({
          ...base,
          status: "rejeitado",
          mensagem: "Total de anexos excederia 25 MB.",
        });
        continue;
      }
      somaAcumulada += file.size;
      const path = `${uploadPrefix}${anexo_id}-${sanitizeName(file.name)}`;
      novos.push({ ...base, path, status: "selecionado" });
    }

    // Mostra TODOS (aceitos + rejeitados) na lista imediatamente
    setAnexos((prev) => [...prev, ...novos]);

    const aceitos = novos.filter((n) => n.status === "selecionado");
    if (aceitos.length === 0) return;

    // Marca aceitos como "uploading" e sobe
    setAnexos((prev) =>
      prev.map((p) =>
        aceitos.some((a) => a.anexo_id === p.anexo_id)
          ? { ...p, status: "uploading" }
          : p,
      ),
    );

    await Promise.all(
      aceitos.map(async (a) => {
        const { error } = await supabase.storage
          .from(BUCKET)
          .upload(a.path, a.file, {
            contentType: a.file.type,
            upsert: false,
          });
        setAnexos((prev) =>
          prev.map((p) =>
            p.anexo_id === a.anexo_id
              ? {
                  ...p,
                  status: error ? "erro" : "ok",
                  mensagem: error?.message,
                }
              : p,
          ),
        );
      }),
    );
  }

  async function removerAnexo(anexo_id: string) {
    const alvo = anexos.find((a) => a.anexo_id === anexo_id);
    if (!alvo) return;
    setAnexos((prev) => prev.filter((p) => p.anexo_id !== anexo_id));
    // Só remove do bucket se o upload chegou lá — "selecionado" e "rejeitado"
    // ainda não subiram nada; "uploading" tá em voo e pode não ter finalizado.
    if (alvo.status === "ok") {
      await supabase.storage.from(BUCKET).remove([alvo.path]);
    }
  }

  // ---- Valor da PP: R$ Unit. × QT × D/M ----
  // A PP é montada como a linha da planilha. Os três fatores são do GP —
  // nenhum é derivado do planejado, então o unitário pode ser o desconto
  // que o fornecedor deu. Nada limita o valor (02/09/2026): o teto por PP
  // saiu. Passar do planejado não impede gerar — no envio, pede o
  // responsável do job ou administrador, com confirmação.
  const unitNum = parseNumeroLocal(unitario);
  const qtdNum = parseNumeroLocal(quantidade);
  const dmNum = parseNumeroLocal(dm);
  const valorPP = valorDaPPPorUnidade(unitNum, qtdNum, dmNum);
  // Prévia de "Em PPs emitidas" com esta PP. A PP em edição ainda é
  // gerada, então não está na base — não há o que descontar.
  const previaEmPPs = Math.round((emPPsEmitidas + valorPP) * 100) / 100;
  const passaPlanejado = valorPP > 0 && passaDoPlanejado(previaEmPPs, valorPlanejado);
  /** Anexos já gravados que continuam (modo edição). */
  const anexosMantidos = (ppEditando?.anexos ?? []).filter(
    (a) => !removidos.has(a.id),
  );

  /** Refaz as parcelas mantendo as datas que já existem. */
  const montarParcelas = React.useCallback(
    (n: number, primeiraData: string, valor: number, atuais: ParcelaLocal[]) => {
      const valores = dividirEmParcelas(valor, n);
      const datas: string[] = [];
      let corrente = primeiraData;
      for (let i = 0; i < n; i++) {
        // A 1ª é sempre o "Prazo de pagamento". Da 2ª em diante mantém o
        // que o usuário já tinha ajustado; só as novas nascem de +1 mês.
        datas.push(i === 0 ? primeiraData : (atuais[i]?.data_vencimento ?? corrente));
        corrente = proximoVencimento(datas[i]);
      }
      return datas.map((data, i) => ({
        data_vencimento: data,
        valor: valores[i].toFixed(2).replace(".", ","),
      }));
    },
    [],
  );

  function mudarNumeroDeParcelas(bruto: string) {
    const n = Math.max(1, Math.min(36, Math.floor(Number(bruto) || 1)));
    if (n === 1) {
      setParcelas([]);
      return;
    }
    setParcelas(montarParcelas(n, prazoPagamento, valorPP, parcelas));
  }

  function mudarPrazo(iso: string) {
    setPrazoPagamento(iso);
    if (parcelas.length > 0) {
      // Mover a 1ª data reconstrói a escada: as seguintes acompanham.
      setParcelas(montarParcelas(parcelas.length, iso, valorPP, []));
    }
  }

  /** Valor da PP mudou: redivide as parcelas preservando as datas. */
  function redividirParcelas(valor: number) {
    if (parcelas.length === 0) return;
    const valores = dividirEmParcelas(valor, parcelas.length);
    setParcelas((prev) =>
      prev.map((p, i) => ({
        ...p,
        valor: valores[i].toFixed(2).replace(".", ","),
      })),
    );
  }

  // Um handler por campo do trio: cada um refaz a conta com o valor novo
  // do seu campo e os dois já digitados nos outros. `unitNum`/`qtdNum`/
  // `dmNum` são do render atual, então não há estado atrasado aqui.
  function mudarUnitario(bruto: string) {
    setUnitario(bruto);
    redividirParcelas(valorDaPPPorUnidade(parseNumeroLocal(bruto), qtdNum, dmNum));
  }

  function mudarQuantidade(bruto: string) {
    setQuantidade(bruto);
    redividirParcelas(valorDaPPPorUnidade(unitNum, parseNumeroLocal(bruto), dmNum));
  }

  function mudarDm(bruto: string) {
    setDm(bruto);
    redividirParcelas(valorDaPPPorUnidade(unitNum, qtdNum, parseNumeroLocal(bruto)));
  }

  /** O que vai para a action: PP sem parcelamento manda 1 parcela. */
  function parcelasParaEnvio(): Array<{ data_vencimento: string; valor: number }> {
    if (parcelas.length === 0) {
      return [{ data_vencimento: prazoPagamento, valor: valorPP }];
    }
    return parcelas.map((p) => ({
      data_vencimento: p.data_vencimento,
      valor: parseNumeroLocal(p.valor),
    }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!ppId || !itemRealizadoId) return;
    if (verbaProducao && !responsavelId) {
      setErro("Escolha um responsável.");
      return;
    }
    if (!verbaProducao && !fornecedorId) {
      setErro("Escolha um fornecedor.");
      return;
    }
    if (!empresaId) {
      setErro("Escolha uma empresa emissora.");
      return;
    }
    if (!prazoPagamento) {
      setErro("Prazo de pagamento é obrigatório.");
      return;
    }
    if (!servico.trim()) {
      setErro("Serviço é obrigatório.");
      return;
    }
    if (unitNum <= 0) {
      setErro("R$ Unit. deve ser um número positivo.");
      return;
    }
    if (qtdNum <= 0) {
      setErro("QT deve ser um número positivo.");
      return;
    }
    if (dmNum <= 0) {
      setErro("D/M deve ser um número positivo.");
      return;
    }
    if (valorPP <= 0) {
      setErro("O valor desta PP ficaria zerado. Confira R$ Unit., QT e D/M.");
      return;
    }
    const parcelasEnvio = parcelasParaEnvio();
    if (parcelasEnvio.some((p) => !p.data_vencimento)) {
      setErro("Toda parcela precisa de uma data de vencimento.");
      return;
    }
    if (!parcelasFecham(parcelasEnvio.map((p) => p.valor), valorPP)) {
      setErro(
        `A soma das parcelas precisa fechar com o valor da PP (${formatCurrency(valorPP, "BRL")}).`,
      );
      return;
    }
    // O anexo deixou de travar a geração (02/09/2026): a PP pode nascer
    // sem nota e ficar no job. Quem exige a NF é o envio ao financeiro,
    // no painel do item. Verba de Produção segue sem anexo nos dois
    // momentos — é adiantamento, e as notas entram na prestação de contas.
    const anexosOk = anexos.filter((a) => a.status === "ok");
    if (anexos.some((a) => a.status === "uploading" || a.status === "selecionado")) {
      setErro("Aguarde os uploads terminarem antes de continuar.");
      return;
    }

    // Lock síncrono contra double-submit (pending do useTransition ativa 1
    // render depois — clique duplo rápido passa pelo disabled=pending).
    if (submittingRef.current) return;
    submittingRef.current = true;

    startTransition(async () => {
      try {
        const dadosBase = {
          empresa_id: empresaId,
          prazo_pagamento: prazoPagamento,
          servico: servico.trim(),
          valor_unitario: unitNum,
          quantidade: qtdNum,
          dias_meses: dmNum,
          especificacoes: especificacoes.trim() || null,
          parcelas: parcelasEnvio,
        };
        const dados = verbaProducao
          ? {
              ...dadosBase,
              verba_producao: true as const,
              responsavel_verba_id: responsavelId,
              fornecedor_id: null,
            }
          : {
              ...dadosBase,
              verba_producao: false as const,
              fornecedor_id: fornecedorId,
              responsavel_verba_id: null,
            };
        const anexosParaAction = anexosOk.map((a) => ({
          anexo_id: a.anexo_id,
          path: a.path,
          nome_original: a.file.name,
          tamanho_bytes: a.file.size,
          mimetype: a.file.type as PPAnexoMimetype,
          // Número sem tipo não identifica nada — vai nulo junto.
          documento_tipo: a.documento.tipo,
          documento_numero: a.documento.tipo
            ? (a.documento.numero?.trim() || null)
            : null,
        }));
        const res = ppEditando
          ? await editarPedidoCompraGerada(
              ppId,
              dados,
              anexosParaAction,
              Array.from(removidos),
            )
          : await finalizarPedidoCompra(
              ppId,
              dados,
              anexosParaAction,
              itemRealizadoId,
            );

        if (!res.ok) {
          setErro(res.message);
          return;
        }

        // Sucesso: fecha drawer + toast + refresh imediato
        // router.refresh() PRECISA ficar fora do startTransition atual pra
        // ser priorizado corretamente pelo React scheduler — dentro dele o
        // re-render dos server components fica low-priority e demora.
        abortedRef.current = true;
        onSuccess?.(res.codigo, ppEditando ? "editada" : "gerada");
        onOpenChange(false);
      } finally {
        submittingRef.current = false;
      }
    });
  }

  // Detecta sucesso e dispara refresh FORA do startTransition principal
  // (via ref pra evitar dep instável no useEffect).
  React.useEffect(() => {
    if (!open) {
      // Se drawer fechou por sucesso (abortedRef=true), refresh a página
      // pra pegar a nova PP e os ícones Ver/Cancelar aparecerem na trilha.
      if (abortedRef.current) {
        router.refresh();
      }
    }
  }, [open, router]);

  if (!open || !itemRealizadoId) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="sm:max-w-2xl">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border">
          <DialogTitle>
            {editando
              ? `Editar Pedido de Produção · ${ppEditando.codigo}`
              : "Gerar Pedido de Produção"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="flex-1 space-y-4 p-6 overflow-y-auto">
            {erro && (
              <div className="flex items-start justify-between gap-2 rounded border border-california-red/40 bg-california-red/5 p-3 text-sm text-california-red">
                <span>{erro}</span>
                <button type="button" onClick={() => setErro(null)}>
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">Item</p>
              <p className="font-medium">{itemDescricao}</p>
              {/* Duas colunas, como no design de 02/09/2026: a referência
                  do item virou o PLANEJADO (era o orçado), e o "Máximo
                  aceito" deu lugar à prévia de "Em PPs emitidas" com esta
                  PP — sem teto, ela só avisa quando passa do planejado. */}
              <div className="mt-2 grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Planejado do item</p>
                  <p className="font-mono font-semibold">
                    {formatCurrency(valorPlanejado, "BRL")}
                  </p>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    {formatUnitario(unitarioPlanejado)} ×{" "}
                    {formatFator(quantidadePlanejada)} ×{" "}
                    {formatFator(dmPlanejado)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Em PPs emitidas</p>
                  <p
                    className={cn(
                      "font-mono font-semibold",
                      passaPlanejado && "text-california-red",
                    )}
                  >
                    {formatCurrency(previaEmPPs, "BRL")}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    com esta PP · sem teto por PP
                  </p>
                </div>
              </div>
            </div>

            {/* Fornecedor & Empresa */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Fornecedor & Empresa
              </h3>

              {/* Switch Verba de Produção */}
              <label className="flex cursor-pointer items-center gap-2.5">
                <button
                  type="button"
                  role="switch"
                  aria-checked={verbaProducao}
                  onClick={() => {
                    setVerbaProducao((v) => {
                      if (!v) setFornecedorId(""); // vai ligar: limpa fornecedor
                      else setResponsavelId("");   // vai desligar: limpa responsável
                      return !v;
                    });
                  }}
                  className={cn(
                    "relative inline-flex h-5 w-9 flex-none items-center rounded-full border-2 border-transparent transition-colors",
                    verbaProducao ? "bg-california-red" : "bg-muted-foreground/30",
                  )}
                >
                  <span
                    className={cn(
                      "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
                      verbaProducao ? "translate-x-4" : "translate-x-0",
                    )}
                  />
                </button>
                <span className="text-sm font-medium">Verba de Produção</span>
                {verbaProducao && (
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    Pago ao responsável interno
                  </span>
                )}
              </label>

              {/* Valor desta PP — as mesmas colunas do item na planilha.
                  Fica logo abaixo do switch porque primeiro se decide se é
                  verba de produção, depois quanto vale a PP: quando o prazo
                  de pagamento é escolhido, o dinheiro já está definido. */}
              <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
                <div className="flex items-baseline justify-between gap-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Valor desta PP
                  </h4>
                  <span className="text-[11px] text-muted-foreground">
                    mesmas colunas do item na planilha
                  </span>
                </div>

                <div className="grid grid-cols-[1.5fr_0.75fr_0.75fr] gap-2.5">
                  <div>
                    <label className="text-xs font-medium">R$ Unit. *</label>
                    <Input
                      value={unitario}
                      onChange={(e) => mudarUnitario(e.target.value)}
                      className="no-spinner text-right font-mono font-semibold"
                      inputMode="decimal"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium">QT *</label>
                    <Input
                      value={quantidade}
                      onChange={(e) => mudarQuantidade(e.target.value)}
                      className="no-spinner text-right font-mono font-semibold"
                      inputMode="decimal"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium">D/M *</label>
                    <Input
                      value={dm}
                      onChange={(e) => mudarDm(e.target.value)}
                      className="no-spinner text-right font-mono font-semibold"
                      inputMode="decimal"
                    />
                  </div>
                </div>

                <div className="flex items-end justify-between gap-4 border-t border-border pt-3">
                  <div>
                    <p className="text-[11px] text-muted-foreground">
                      Valor desta PP
                    </p>
                    <p className="font-mono text-[11px] text-muted-foreground">
                      {valorPP > 0
                        ? `${formatUnitario(unitNum)} × ${formatFator(qtdNum)} × ${formatFator(dmNum)}`
                        : "preencha os três campos"}
                    </p>
                  </div>
                  <span className="font-mono text-[22px] font-bold leading-none">
                    {valorPP > 0 ? formatCurrency(valorPP, "BRL") : "—"}
                  </span>
                </div>

                {/* O aviso mora aqui, ao vivo. Não barra: passar do
                    planejado muda quem pode ENVIAR, não se dá para gerar. */}
                {passaPlanejado && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-2.5">
                    <AlertTriangle className="mt-px h-3.5 w-3.5 flex-none text-amber-700" />
                    <span className="text-[11px] leading-relaxed text-amber-900">
                      Com esta PP o item passa do planejado. Ela é gerada do
                      mesmo jeito — o <strong>envio ao financeiro</strong>{" "}
                      pedirá confirmação do responsável do job ou de um
                      administrador.
                    </span>
                  </div>
                )}
              </div>

              {/* Fornecedor (modo normal) ou Responsável (modo verba) */}
              {verbaProducao ? (
                <div>
                  <label className="text-xs font-medium">Responsável *</label>
                  <Select value={responsavelId} onValueChange={setResponsavelId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Escolha um responsável" />
                    </SelectTrigger>
                    <SelectContent>
                      {responsaveis.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div>
                  <label className="text-xs font-medium">Fornecedor *</label>
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <Select value={fornecedorId} onValueChange={setFornecedorId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Escolha o fornecedor" />
                        </SelectTrigger>
                        <SelectContent>
                          {fornecedoresVisiveis.map((f) => (
                            <SelectItem key={f.id} value={f.id}>
                              {f.razao_social ?? f.nome}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {/* Cadastrar o fornecedor sem sair da PP: abre o
                        cadastro completo num dialog e volta com ele
                        selecionado (decisão 048). */}
                    <button
                      type="button"
                      onClick={() => setNovoFornecedorOpen(true)}
                      disabled={pending}
                      title="Cadastrar fornecedor"
                      aria-label="Cadastrar fornecedor"
                      className="inline-flex h-10 w-10 flex-none items-center justify-center rounded-lg border border-border bg-white text-california-red transition-colors hover:border-california-red/40 hover:bg-california-red/[0.06] disabled:opacity-50"
                    >
                      <Plus className="h-[17px] w-[17px]" />
                    </button>
                  </div>
                </div>
              )}

              <div>
                <label className="text-xs font-medium">Empresa emissora *</label>
                <Select value={empresaId} onValueChange={setEmpresaId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Escolha a empresa" />
                  </SelectTrigger>
                  <SelectContent>
                    {empresas.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.razao_social}
                        {e.principal ? " (principal)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Prazo e Parcelas dividem a linha: o prazo é o vencimento
                  da 1ª parcela, e o número ao lado diz em quantas vezes
                  o fornecedor recebe. */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium">Prazo de pagamento *</label>
                  <DatePicker
                    key={`prazo-${drawerKey}`}
                    name="prazo_pagamento"
                    defaultValue={prazoPagamento}
                    onDateChange={(date) => mudarPrazo(dateToIso(date))}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium">Parcelas</label>
                  <Input
                    value={String(Math.max(parcelas.length, 1))}
                    onChange={(e) => mudarNumeroDeParcelas(e.target.value)}
                    className="no-spinner"
                    inputMode="numeric"
                  />
                </div>
              </div>

              {parcelas.length > 1 && (
                <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
                  <p className="text-[11px] text-muted-foreground">
                    Vencimentos sugeridos de mês em mês e valores divididos
                    igualmente — os dois são editáveis. A soma tem que fechar
                    com o valor da PP.
                  </p>
                  {parcelas.map((p, i) => (
                    <div key={i} className="grid grid-cols-[28px_1fr_1fr] items-center gap-2">
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {i + 1}/{parcelas.length}
                      </span>
                      <DatePicker
                        key={`parcela-${drawerKey}-${i}`}
                        name={`parcela_${i}_vencimento`}
                        defaultValue={p.data_vencimento}
                        // A 1ª acompanha o Prazo de pagamento acima: mudar
                        // nos dois lugares deixaria os dois campos brigando.
                        disabled={i === 0}
                        onDateChange={(date) =>
                          setParcelas((prev) =>
                            prev.map((q, j) =>
                              j === i
                                ? { ...q, data_vencimento: dateToIso(date) }
                                : q,
                            ),
                          )
                        }
                      />
                      <Input
                        value={p.valor}
                        onChange={(e) =>
                          setParcelas((prev) =>
                            prev.map((q, j) =>
                              j === i ? { ...q, valor: e.target.value } : q,
                            ),
                          )
                        }
                        className="no-spinner text-right font-mono"
                        inputMode="decimal"
                      />
                    </div>
                  ))}
                  <div className="flex items-center justify-between border-t border-border pt-2 text-[11px]">
                    <span className="text-muted-foreground">Soma das parcelas</span>
                    <span
                      className={cn(
                        "font-mono font-semibold",
                        !parcelasFecham(
                          parcelas.map((p) => parseNumeroLocal(p.valor)),
                          valorPP,
                        ) && "text-california-red",
                      )}
                    >
                      {formatCurrency(
                        parcelas.reduce((s, p) => s + parseNumeroLocal(p.valor), 0),
                        "BRL",
                      )}{" "}
                      / {formatCurrency(valorPP, "BRL")}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Servico */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Serviço
              </h3>

              <div>
                <label className="text-xs font-medium">Descrição do serviço *</label>
                <Input
                  value={servico}
                  onChange={(e) => setServico(e.target.value)}
                  maxLength={500}
                />
              </div>

              {/* QT saiu daqui: era o mesmo número do bloco de valor, em
                  dois campos distantes um do outro. Serviço fica só com
                  descrição e especificações. */}
              <div>
                <label className="text-xs font-medium">Especificações (opcional)</label>
                <textarea
                  value={especificacoes}
                  onChange={(e) => setEspecificacoes(e.target.value)}
                  maxLength={2000}
                  rows={3}
                  className="w-full rounded border border-border p-2 text-sm"
                />
              </div>
            </div>

            {/* Anexos — opcional para gerar, obrigatório para enviar
                (02/09/2026). Verba de produção segue sem anexo. */}
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {verbaProducao
                  ? "Anexos (não exigidos na verba de produção)"
                  : "Anexos (opcional para gerar · obrigatório para enviar)"}
              </h3>
              <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                {verbaProducao
                  ? "Verba de produção é adiantamento: a PP sai antes de existir nota e as notas entram na prestação de contas."
                  : "A PP pode ser gerada sem anexo. O envio ao financeiro só libera com pelo menos uma NF anexada."}{" "}
                Máximo de 8 MB por arquivo, 25 MB no total.
              </p>

              {anexosMantidos.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center gap-2 rounded border border-border bg-white px-3 py-2 text-xs"
                >
                  <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="flex-1 truncate">{a.arquivo_nome_original}</span>
                  <span className="text-muted-foreground">
                    {(a.arquivo_tamanho_bytes / 1024).toFixed(0)} KB
                  </span>
                  <button
                    type="button"
                    title="Remover anexo"
                    aria-label={`Remover ${a.arquivo_nome_original}`}
                    onClick={() =>
                      setRemovidos((prev) => new Set(prev).add(a.id))
                    }
                    className="text-california-red hover:opacity-70"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}

              {uploadPrefix ? (
                <label className="flex cursor-pointer items-center gap-2 rounded border border-dashed border-border p-3 text-sm hover:border-california-red/40">
                  <Upload className="h-4 w-4" />
                  <span>Selecionar arquivos (PDF ou imagem)</span>
                  <input
                    type="file"
                    multiple
                    accept={PP_ANEXO_MIMETYPES_ACEITOS.join(",")}
                    onChange={(e) => onFileSelect(e.target.files)}
                    className="hidden"
                  />
                </label>
              ) : (
                <div className="flex items-center gap-2 rounded border border-dashed border-border bg-muted/40 p-3 text-sm text-muted-foreground cursor-not-allowed">
                  <Upload className="h-4 w-4" />
                  <span>Preparando... aguarde um instante</span>
                </div>
              )}

              {anexos.length > 0 && (
                <ul className="space-y-1">
                  {anexos.map((a) => {
                    const Icon = iconePorMime(a.file.type);
                    const cor =
                      a.status === "erro" || a.status === "rejeitado"
                        ? "border-california-red/40 bg-california-red/5"
                        : a.status === "ok"
                          ? "border-emerald-200 bg-emerald-50"
                          : "border-border bg-muted/30";
                    const label =
                      a.status === "selecionado"
                        ? "aguardando..."
                        : a.status === "uploading"
                          ? "enviando..."
                          : a.status === "ok"
                            ? "ok"
                            : a.status === "rejeitado"
                              ? `rejeitado: ${a.mensagem ?? "motivo desconhecido"}`
                              : (a.mensagem ?? "falha");
                    return (
                      <li
                        key={a.anexo_id}
                        className={cn(
                          "flex flex-col gap-1.5 rounded border p-2 text-xs",
                          cor,
                        )}
                      >
                        <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4" />
                        <span className="flex-1 truncate">{a.file.name}</span>
                        <span className="text-muted-foreground">
                          {(a.file.size / 1024).toFixed(0)} KB
                        </span>
                        <span
                          className={cn(
                            "text-xs",
                            a.status === "erro" || a.status === "rejeitado"
                              ? "text-california-red"
                              : "text-muted-foreground",
                          )}
                        >
                          {label}
                        </span>
                        <button
                          type="button"
                          onClick={() => removerAnexo(a.anexo_id)}
                          className="text-california-red hover:opacity-70"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                        </div>

                        {/* Que documento é este arquivo. Só depois do
                            upload: identificar algo que ainda pode ser
                            rejeitado seria trabalho jogado fora. */}
                        {a.status === "ok" && (
                          <DocumentoDoAnexoField
                            valor={a.documento}
                            descricaoArquivo={a.file.name}
                            onChange={(doc) =>
                              setAnexos((prev) =>
                                prev.map((p) =>
                                  p.anexo_id === a.anexo_id
                                    ? { ...p, documento: doc }
                                    : p,
                                ),
                              )
                            }
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-border">
            <span className="max-w-[280px] text-[11px] leading-snug text-muted-foreground">
              {editando
                ? "Salvar mantém a PP como gerada — ela segue no job até ser enviada."
                : "A PP é criada como gerada. O envio ao financeiro é uma ação separada, no painel do item."}
            </span>
            <span className="flex flex-none items-center gap-2">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                disabled={pending}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={
                  pending ||
                  !ppId ||
                  anexos.some((a) => a.status === "uploading") ||
                  (verbaProducao ? !responsavelId : !fornecedorId)
                }
                className="rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white hover:bg-california-red-hover disabled:opacity-50"
              >
                {pending
                  ? editando
                    ? "Salvando..."
                    : "Gerando..."
                  : editando
                    ? "Salvar alterações"
                    : "Gerar PP"}
              </button>
            </span>
          </div>
        </form>

        <NovoFornecedorDialog
          open={novoFornecedorOpen}
          onOpenChange={setNovoFornecedorOpen}
          onCriado={adotarFornecedor}
          onSelecionarExistente={adotarFornecedor}
        />
      </DrawerContent>
    </Dialog>
  );
}
