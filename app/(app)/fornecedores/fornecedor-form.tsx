"use client";

/**
 * O cadastro de fornecedor — desenho "Fornecedores - Novo Cadastro"
 * (projeto Claude Design `69342d83`, implementado em 09/09/2026).
 *
 * O formulário é um só e serve três telas: a página de cadastro, a de
 * edição e o dialog do "+" de dentro da PP (decisão 048). O que mudou:
 *
 *   * **Um cartão, quatro seções**, cada uma com a sua explicação numa
 *     coluna à esquerda e o selo que diz se ela trava ou não o cadastro.
 *     Eram cinco cartões soltos, todos com o mesmo peso.
 *   * **Banco e PIX** com selo "preenchido" — eram abas; desde a decisão
 *     161 (09/10/2026) são dois blocos sempre à vista, porque a produção
 *     achava que só dava para cadastrar um dos dois.
 *   * **O endereço nasce recolhido** e não trava nada (decisão do Tiago,
 *     09/09/2026). Abre sozinho quando o fornecedor já tem endereço.
 *   * **O rodapé conta o que falta**, ao vivo, e o botão só acende quando
 *     não falta nada — as três decisões do Tiago no mesmo dia.
 *
 * O que NÃO mudou: as regras vivem em `lib/validations/fornecedores.ts` e
 * no servidor. O resumo do rodapé é a mesma conta feita na tela, para
 * dizer o que falta antes do clique; quem recusa de verdade é a action.
 *
 * Módulo fiscal (02/10/2026): a pessoa jurídica ganha o **regime
 * tributário** — Lucro Real ou Presumido, Simples Nacional ou MEI —, ao
 * lado da razão social. A consulta do CNPJ que o cadastro novo já faz
 * (BrasilAPI) preenche o regime pelos campos de opção pelo Simples e pelo
 * MEI, e a origem fica embaixo do campo; trocado à mão para outro, o texto
 * fica âmbar e diz o que a consulta indicou. No Simples entra a declaração
 * de optante (IN SRF 459, anexo I), e a nota azul diz o que o regime faz na
 * aprovação da PP. Regras em `lib/fiscal/regime-do-fornecedor.ts`.
 *
 * Decisão 142 (02/10/2026): a consulta fica gravada inteira — com o
 * "desde" da opção pelo Simples ou pelo MEI —, e o texto embaixo do regime
 * (inclusive o âmbar de "alterado manualmente") vale ao reabrir. No Simples,
 * ao lado da caixa da declaração, o **arquivo** dela
 * (`declaracao-simples.tsx`).
 *
 * 07/10/2026 (Tiago): a caixa e o arquivo da declaração saem do cadastro
 * rápido (o "+" da PP, do BV e o pop-up do veículo) e ficam só na página
 * do cadastro. A produção anexava a NF e o print da consulta do CNPJ no
 * lugar da declaração. O que o cadastro já tem continua indo no envio, pelo
 * estado, então editar pelo pop-up não apaga nada. E Lucro Real ou
 * Presumido perdeu a nota azul; a do Simples, que fala da declaração, sai
 * do cadastro rápido.
 *
 * Decisão 161 (09/10/2026): conta e PIX em dois blocos sempre à vista, e a
 * marcação "Sem conta nem PIX no cadastro" para o fornecedor que manda boleto
 * ou chave aleatória a cada PP. Marcada, os dois blocos ficam apagados, o
 * rodapé deixa de cobrar conta ou PIX e o salvar grava os dois vazios (o
 * servidor e a CHECK do banco repetem a regra).
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  Info,
  Landmark,
  Plus,
  Save,
  UserCheck,
  Zap,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MaskedInput } from "@/components/ui/masked-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PIX_TIPOS, PIX_AJUDA, chavePixParaExibir } from "@/lib/pix";
import { Combobox } from "@/components/ui/combobox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { BANCOS_FEBRABAN } from "@/lib/dados/bancos-febraban";
import { onlyDigits, cn } from "@/lib/utils";
import type {
  Fornecedor,
  TipoPessoa,
  PixTipoChave,
  RegimeTributarioFornecedor,
  UF,
} from "@/lib/types";
import { Checkbox } from "@/components/ui/checkbox";
import { hojeEmSaoPauloIso } from "@/lib/calculos/janelas-pagamento";
import {
  NOTA_DO_REGIME,
  REGIMES_DO_FORNECEDOR,
  ROTULO_DO_REGIME,
  consultaDaRespostaDoCnpj,
  consultaDoCadastro,
  consultaParaGravar,
  origemDoRegime,
  regimeDepoisDaConsulta,
  type ConsultaDoRegime,
} from "@/lib/fiscal/regime-do-fornecedor";
import {
  atualizarFornecedor,
  atualizarVeiculoFornecedor,
  criarFornecedor,
  criarFornecedorRapido,
  criarVeiculoFornecedor,
  buscarFornecedorPorDocumento,
  verificarPixDuplicado,
  type ActionResult,
  type FornecedorResumo,
} from "./actions";
import { CampoArquivoDaDeclaracao, useArquivoDaDeclaracao } from "./declaracao-simples";

const UFS: UF[] = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS",
  "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC",
  "SP", "SE", "TO",
];

const BANCO_ITEMS = BANCOS_FEBRABAN.map((b) => ({
  value: b.codigo,
  label: `${b.codigo} - ${b.nome}`,
}));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;


/** "nome, CNPJ e e-mail" — a lista do rodapé, com o "e" antes do último. */
function listar(itens: string[]): string {
  if (itens.length <= 1) return itens.join("");
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

// ---------------------------------------------------------------------------
// A chave PIX, que muda de campo conforme o tipo
// ---------------------------------------------------------------------------

interface PixChaveInputProps {
  tipo: PixTipoChave | "";
  /** Valor atual — vira `defaultValue` a cada remontagem por troca de tipo.
   *  O MaskedInput não aceita modo controlado (não expõe `onChange`), então
   *  é não controlado + `onDigitsChange`. */
  initialValue: string;
  onDigitsChange: (digits: string) => void;
  onRawChange: (raw: string) => void;
  /** Do pai, para o "Usar CPF/CNPJ do cadastro" conseguir escrever aqui. */
  maskRef: React.RefObject<HTMLInputElement>;
}

function PixChaveInput({
  tipo,
  initialValue,
  onDigitsChange,
  onRawChange,
  maskRef,
}: PixChaveInputProps) {
  const inputClass =
    "flex h-11 w-full rounded-lg border border-border bg-white px-3.5 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 hover:border-california-red/40 focus-visible:outline-none focus-visible:border-california-red focus-visible:ring-2 focus-visible:ring-california-red/15 disabled:cursor-not-allowed disabled:opacity-50 transition-colors";

  if (tipo === "") {
    return (
      <input
        type="text"
        disabled
        placeholder="Selecione o tipo de chave primeiro"
        className={inputClass}
      />
    );
  }

  if (tipo === "cpf" || tipo === "cnpj") {
    return (
      <MaskedInput
        mask={tipo}
        defaultValue={initialValue}
        onDigitsChange={onDigitsChange}
        ref={maskRef}
        placeholder={tipo === "cpf" ? "000.000.000-00" : "00.000.000/0000-00"}
      />
    );
  }

  if (tipo === "telefone") {
    return (
      <MaskedInput
        mask="telefone"
        defaultValue={initialValue}
        onDigitsChange={onDigitsChange}
        ref={maskRef}
        placeholder="(11) 99999-9999"
      />
    );
  }

  return (
    <input
      type={tipo === "email" ? "email" : "text"}
      defaultValue={initialValue}
      onChange={(e) => onRawChange(e.target.value)}
      placeholder={
        tipo === "email" ? "chave@fornecedor.com.br" : "Chave aleatória (EVP)"
      }
      className={inputClass}
    />
  );
}

// ---------------------------------------------------------------------------
// Peças do desenho: a seção com explicação à esquerda, e o campo com dica
// ---------------------------------------------------------------------------

function Secao({
  titulo,
  descricao,
  descricaoNoDialog,
  selo,
  emDialog,
  children,
}: {
  titulo: string;
  descricao: string;
  /** A mesma explicação, encurtada para caber na linha do título dentro do
   *  dialog. Ausente = a seção não mostra explicação ali. */
  descricaoNoDialog?: string;
  selo: "obrigatorio" | "opcional";
  emDialog: boolean;
  children: React.ReactNode;
}) {
  const seloEl = (
    <span
      className={cn(
        "inline-block flex-none rounded-full px-2 py-[3px] text-[10px] font-bold uppercase tracking-wider",
        selo === "obrigatorio"
          ? "bg-california-red/[0.08] text-[#c2404a]"
          : "bg-muted text-muted-foreground",
      )}
    >
      {selo === "obrigatorio" ? "Obrigatório" : "Opcional"}
    </span>
  );

  // No dialog o cartão tem 768px e divide espaço com a PP atrás: a coluna
  // de explicação da página não cabe, e o cabeçalho da seção vira uma
  // linha só — título, selo e a nota curta à direita (desenho de
  // "Fornecedores - Novo Cadastro na PP").
  if (emDialog) {
    return (
      <div className="flex flex-col gap-3.5 px-6 py-[22px]">
        <div className="flex flex-wrap items-baseline gap-2.5">
          <h3 className="text-[13.5px] font-bold tracking-tight">{titulo}</h3>
          {seloEl}
          {descricaoNoDialog && (
            <span className="min-w-[160px] flex-1 text-right text-[11.5px] leading-snug text-muted-foreground">
              {descricaoNoDialog}
            </span>
          )}
        </div>
        {children}
      </div>
    );
  }

  return (
    <div className="grid gap-6 px-7 py-7 md:grid-cols-[minmax(0,208px)_minmax(0,1fr)] md:gap-8">
      <div>
        <h3 className="text-[14.5px] font-bold tracking-tight">{titulo}</h3>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          {descricao}
        </p>
        <div className="mt-2.5">{seloEl}</div>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Um campo do formulário: rótulo à esquerda, dica ou ação à direita. */
function Campo({
  label,
  name,
  required,
  hint,
  acao,
  errors,
  className,
  children,
}: {
  label: string;
  name: string;
  required?: boolean;
  /** Texto curto à direita do rótulo ("Opcional", "para cobrar a nota"). */
  hint?: React.ReactNode;
  /** Um link no lugar da dica ("Usar CNPJ do cadastro"). */
  acao?: React.ReactNode;
  errors: Record<string, string[]>;
  className?: string;
  children: React.ReactNode;
}) {
  const msgs = errors[name];
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)} data-field={name}>
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={name} className="whitespace-nowrap text-[12.5px] font-semibold">
          {label}
          {required && <span className="ml-1 text-california-red">*</span>}
        </Label>
        {acao ??
          (hint ? (
            <span className="flex-none whitespace-nowrap text-[11px] text-muted-foreground">
              {hint}
            </span>
          ) : null)}
      </div>
      {children}
      {msgs?.map((msg, i) => (
        <p key={i} className="text-[11.5px] text-california-red">
          {msg}
        </p>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// O formulário
// ---------------------------------------------------------------------------

interface Props {
  fornecedor?: Fornecedor;
  /**
   * `pagina` (default) é o cadastro de sempre: rodapé fixo, Cancelar volta
   * para a lista, criar redireciona. `dialog` é o cadastro rápido de
   * dentro da PP (04/09/2026, decisão 048): Cancelar fecha o dialog e
   * criar devolve o registro para quem abriu selecionar no combo. Desde
   * 09/09/2026 os dois exigem os mesmos campos.
   */
  modo?: "pagina" | "dialog";
  /**
   * O tipo de pessoa CONTROLADO de fora. No dialog do cadastro rápido ele
   * mora no cabeçalho, ao lado do título (desenho "Fornecedores - Novo
   * Cadastro na PP"), porque ali o espaço é do dialog e não do formulário.
   * Sem estas duas props o formulário controla e desenha o próprio toggle.
   */
  tipoPessoa?: TipoPessoa;
  onTipoPessoaChange?: (tipo: TipoPessoa) => void;
  /** Nome já preenchido na abertura. Vem da busca do campo de fornecedor
   *  que não achou ninguém: "Cadastrar «Fulano»" abre com o nome pronto. */
  nomeInicial?: string;
  onCancelar?: () => void;
  onCriado?: (fornecedor: FornecedorResumo) => void;
  /** O documento já é de outro cadastro: em vez de criar, selecionar. */
  onSelecionarExistente?: (fornecedor: FornecedorResumo) => void;
  /** Edição salva. No dialog é o que fecha e devolve o controle para a PP
   *  (09/09/2026); na página o `router.refresh()` já basta. */
  onSalvo?: () => void;
  /** `veiculo`: o cadastro do veículo de mídia (decisões 147 e 150) — o
   *  mesmo formulário, com o pagamento opcional, gravado pelas actions do
   *  veículo. Na página, Cancelar e Criar voltam para Cadastros › Veículos. */
  variante?: "fornecedor" | "veiculo";
}

export function FornecedorForm({
  fornecedor,
  modo = "pagina",
  tipoPessoa: tipoPessoaDeFora,
  onTipoPessoaChange,
  nomeInicial,
  onCancelar,
  onCriado,
  onSelecionarExistente,
  onSalvo,
  variante = "fornecedor",
}: Props) {
  const router = useRouter();
  const isEdit = Boolean(fornecedor);
  const emDialog = modo === "dialog";
  const ehVeiculo = variante === "veiculo";

  /** Quem já tem o CPF/CNPJ digitado. Conferido ao sair do campo e de
   *  novo no servidor; enquanto estiver aqui, o formulário não grava. */
  const [duplicado, setDuplicado] = React.useState<FornecedorResumo | null>(
    null,
  );
  const [pending, startTransition] = React.useTransition();
  /** O "tem certeza?" da decisão 067: os dados de pagamento mudaram e
   *  este fornecedor tem PP no financeiro. Guarda o FormData para
   *  reenviar tal e qual depois do sim. */
  const [avisoPagamento, setAvisoPagamento] = React.useState<{
    formData: FormData;
    pps: number;
    codigos: string[];
  } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});

  const [tipoPessoaLocal, setTipoPessoaLocal] = React.useState<TipoPessoa>(
    fornecedor?.tipo_pessoa ?? "juridica",
  );
  /** Quem manda no tipo de pessoa: quem passou a prop, ou o próprio form. */
  const controladoDeFora = tipoPessoaDeFora !== undefined;
  const tipoPessoa = tipoPessoaDeFora ?? tipoPessoaLocal;
  const setTipoPessoa = React.useCallback(
    (tipo: TipoPessoa) => {
      setDuplicado(null);
      if (onTipoPessoaChange) onTipoPessoaChange(tipo);
      if (!controladoDeFora) setTipoPessoaLocal(tipo);
    },
    [controladoDeFora, onTipoPessoaChange],
  );
  const [bancoCodigo, setBancoCodigo] = React.useState<string | null>(
    fornecedor?.banco_codigo ?? null,
  );
  /** Controlado desde 18/09/2026, quando o `<select>` nativo saiu. O
   *  valor entra no envio pelo `formData.set` do `handleSubmit`. */
  const [tipoConta, setTipoConta] = React.useState<string>(
    fornecedor?.tipo_conta ?? "",
  );
  const [pixTipo, setPixTipo] = React.useState<PixTipoChave | "">(
    fornecedor?.pix_tipo ?? "",
  );
  const [pixChave, setPixChave] = React.useState<string>(
    fornecedor?.pix_chave ?? "",
  );
  const [pixWarning, setPixWarning] = React.useState<string | null>(null);

  /** Módulo fiscal: o regime tributário da pessoa jurídica. Controlado,
   *  como o tipo de conta: entra no envio pelo `formData.set` do
   *  `handleSubmit`. */
  const [regime, setRegime] = React.useState<RegimeTributarioFornecedor | null>(
    fornecedor?.regime_tributario ?? null,
  );
  /** O que a consulta do CNPJ disse do regime, e de qual CNPJ. Muda só com
   *  uma consulta nova; na edição, abre com a que o cadastro gravou. */
  const [consultaRegime, setConsultaRegime] = React.useState<ConsultaDoRegime | null>(
    () => consultaDoCadastro(fornecedor),
  );
  const [declaracaoRecebida, setDeclaracaoRecebida] = React.useState<boolean>(
    fornecedor?.declaracao_simples_recebida ?? false,
  );
  /** O arquivo da declaração de optante (decisão 142). Fica com o cadastro
   *  mesmo quando o regime deixa de ser Simples: só o ✕ o tira. */
  const declaracaoArquivo = useArquivoDaDeclaracao(
    fornecedor?.declaracao_simples_path ?? null,
  );

  /** Decisão 161: o fornecedor não tem conta nem PIX fixos — a cada PP ele
   *  manda boleto ou chave aleatória. */
  const [semDadosPagamento, setSemDadosPagamento] = React.useState<boolean>(
    fornecedor?.sem_dados_pagamento ?? false,
  );

  /** O endereço nasce recolhido, e já aberto em quem tem endereço. */
  const temEndereco = Boolean(
    fornecedor?.cep ||
      fornecedor?.logradouro ||
      fornecedor?.numero ||
      fornecedor?.bairro ||
      fornecedor?.cidade ||
      fornecedor?.uf,
  );
  const [enderecoAberto, setEnderecoAberto] = React.useState(temEndereco);

  // Refs do ViaCEP e do documento
  const cepRef = React.useRef<HTMLInputElement>(null);
  const logradouroRef = React.useRef<HTMLInputElement>(null);
  const bairroRef = React.useRef<HTMLInputElement>(null);
  const cidadeRef = React.useRef<HTMLInputElement>(null);
  /** A UF é o ÚNICO campo controlado deste formulário: o Combobox não
   *  existe em modo não controlado. O `name` continua emitindo um input
   *  escondido, então o `FormData` que lê o resto do form não muda
   *  (17/09/2026). */
  const [uf, setUf] = React.useState<string>(fornecedor?.uf ?? "");
  const cpfCnpjRef = React.useRef<HTMLInputElement>(null);
  const pixMaskRef = React.useRef<HTMLInputElement>(null);

  // Refs adicionais para o autocomplete via BrasilAPI (CNPJ)
  const nomeRef = React.useRef<HTMLInputElement>(null);
  const razaoSocialRef = React.useRef<HTMLInputElement>(null);
  const numeroRef = React.useRef<HTMLInputElement>(null);
  const complementoRef = React.useRef<HTMLInputElement>(null);

  // CEP é MaskedInput controlado internamente: para escrever nele via API
  // usamos o truque de mudar a `key` e remontar com um novo defaultValue.
  // Só remontamos quando o campo está vazio, então usuário não perde texto.
  const [cepInitialValue, setCepInitialValue] = React.useState<string>(
    fornecedor?.cep ?? "",
  );
  const [cepKey, setCepKey] = React.useState(0);

  const [cepLoading, setCepLoading] = React.useState(false);
  const [cepError, setCepError] = React.useState<string | null>(null);

  // BrasilAPI (CNPJ) — busca razão social e endereço na Receita Federal
  const [cnpjLoading, setCnpjLoading] = React.useState(false);
  const [cnpjError, setCnpjError] = React.useState<string | null>(null);
  const [cnpjWarning, setCnpjWarning] = React.useState<string | null>(null);

  /**
   * O que está digitado AGORA, para o rodapé contar o que falta.
   *
   * Os campos seguem não controlados (é o que o MaskedInput e o ViaCEP
   * exigem): a cada tecla o formulário inteiro é relido por `FormData`.
   * É uma leitura barata e evita duplicar cada campo num state.
   */
  /** Borda vermelha no gatilho do Select, como os Inputs já fazem. */
  const erroClasses = (name: string) =>
    fieldErrors[name]?.length
      ? "border-california-red ring-2 ring-california-red/15"
      : "";

  const formRef = React.useRef<HTMLFormElement>(null);
  const [campos, setCampos] = React.useState<Record<string, string>>({});
  const relerCampos = React.useCallback(() => {
    const f = formRef.current;
    if (!f) return;
    const lidos: Record<string, string> = {};
    new FormData(f).forEach((valor, chave) => {
      if (typeof valor === "string") lidos[chave] = valor;
    });
    setCampos(lidos);
  }, []);
  React.useEffect(() => {
    relerCampos();
  }, [relerCampos]);

  // ViaCEP
  async function handleCepBlur() {
    const cep = onlyDigits(cepRef.current?.value ?? "");
    if (cep.length !== 8) return;

    setCepLoading(true);
    setCepError(null);
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 3000);

    try {
      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`, {
        signal: ctrl.signal,
      });
      const data = await res.json();
      if (data.erro) {
        setCepError("CEP não encontrado, preencha manualmente.");
        return;
      }
      // Só preenche o que está vazio — respeita o que foi digitado à mão.
      if (logradouroRef.current && !logradouroRef.current.value)
        logradouroRef.current.value = data.logradouro ?? "";
      if (bairroRef.current && !bairroRef.current.value)
        bairroRef.current.value = data.bairro ?? "";
      if (cidadeRef.current && !cidadeRef.current.value)
        cidadeRef.current.value = data.localidade ?? "";
      if (data.uf) setUf((atual) => atual || String(data.uf).toUpperCase());
      relerCampos();
    } catch {
      setCepError("Não foi possível consultar o CEP, preencha manualmente.");
    } finally {
      clearTimeout(to);
      setCepLoading(false);
    }
  }

  // Documento repetido: pergunta ao servidor ao sair do campo, com o
  // tamanho certo para o tipo de pessoa. É a verificação que evita o
  // cadastro duplicado sem esperar o erro do índice único (04/09/2026).
  // Se for CNPJ novo e não duplicado, também dispara o autocomplete da
  // BrasilAPI para preencher razão social e endereço.
  async function handleDocumentoBlur() {
    const digits = onlyDigits(cpfCnpjRef.current?.value ?? "");
    const tamanho = tipoPessoa === "fisica" ? 11 : 14;
    if (digits.length !== tamanho) {
      setDuplicado(null);
      setCnpjError(null);
      setCnpjWarning(null);
      return;
    }
    const res = await buscarFornecedorPorDocumento(digits, fornecedor?.id);
    setDuplicado(res.existe ? res.fornecedor : null);

    // Só preenche via BrasilAPI para CNPJ novo (não duplicado, não edição).
    // CPF não tem consulta pública, então não faz sentido.
    if (tipoPessoa !== "juridica" || res.existe || isEdit) return;
    await preencherViaCnpj(digits);
  }

  // BrasilAPI: consulta o CNPJ na Receita Federal e preenche nome fantasia,
  // razão social, CEP e endereço. Regra "só campo vazio" respeita o que
  // já foi digitado à mão. Se a Receita retornar situação != ATIVA, avisa.
  async function preencherViaCnpj(cnpjDigits: string) {
    setCnpjLoading(true);
    setCnpjError(null);
    setCnpjWarning(null);
    const ctrl = new AbortController();
    // BrasilAPI bate na Receita, é mais lenta que ViaCEP (500ms a 2s típico).
    const to = setTimeout(() => ctrl.abort(), 6000);

    try {
      const r = await fetch(
        `https://brasilapi.com.br/api/cnpj/v1/${cnpjDigits}`,
        { signal: ctrl.signal },
      );
      if (r.status === 404) {
        setCnpjError("CNPJ não encontrado na Receita Federal.");
        return;
      }
      if (!r.ok) {
        setCnpjError(
          "Não foi possível consultar o CNPJ agora, preencha manualmente.",
        );
        return;
      }
      const data = await r.json();

      const situacao = String(
        data.descricao_situacao_cadastral ?? "",
      ).toUpperCase();
      if (situacao && situacao !== "ATIVA") {
        setCnpjWarning(
          `Situação na Receita: ${situacao}. Confirme antes de cadastrar.`,
        );
      }

      // Identificação
      if (nomeRef.current && !nomeRef.current.value) {
        nomeRef.current.value =
          data.nome_fantasia ?? data.razao_social ?? "";
      }
      if (razaoSocialRef.current && !razaoSocialRef.current.value) {
        razaoSocialRef.current.value = data.razao_social ?? "";
      }

      // Endereço — abre a seção recolhida quando temos dados a mostrar.
      const cepFromApi = onlyDigits(String(data.cep ?? ""));
      const temEnderecoAPI = Boolean(
        cepFromApi ||
          data.logradouro ||
          data.bairro ||
          data.municipio ||
          data.uf,
      );
      if (temEnderecoAPI) setEnderecoAberto(true);

      // CEP — MaskedInput controlado, remonta via key
      const cepAtual = onlyDigits(cepRef.current?.value ?? "");
      if (cepFromApi && !cepAtual) {
        setCepInitialValue(cepFromApi);
        setCepKey((k) => k + 1);
      }

      if (logradouroRef.current && !logradouroRef.current.value)
        logradouroRef.current.value = data.logradouro ?? "";
      if (numeroRef.current && !numeroRef.current.value)
        numeroRef.current.value = data.numero ?? "";
      if (complementoRef.current && !complementoRef.current.value)
        complementoRef.current.value = data.complemento ?? "";
      if (bairroRef.current && !bairroRef.current.value)
        bairroRef.current.value = data.bairro ?? "";
      if (cidadeRef.current && !cidadeRef.current.value)
        cidadeRef.current.value = data.municipio ?? "";
      if (data.uf) setUf((atual) => atual || String(data.uf).toUpperCase());

      // Módulo fiscal: o regime tributário sai da mesma consulta (opção pelo
      // Simples e pelo MEI, e desde quando). Entra no campo vazio ou no
      // lugar do que veio de uma consulta anterior; o escolhido à mão fica,
      // e o aviso âmbar diz o que a consulta indicou.
      const consulta = consultaDaRespostaDoCnpj(data, cnpjDigits, hojeEmSaoPauloIso());
      if (consulta) {
        setRegime((atual) => regimeDepoisDaConsulta(atual, consultaRegime, consulta.regime));
        setConsultaRegime(consulta);
      }

      relerCampos();
    } catch {
      setCnpjError(
        "Não foi possível consultar o CNPJ agora, preencha manualmente.",
      );
    } finally {
      clearTimeout(to);
      setCnpjLoading(false);
    }
  }

  /** O documento mudou: o aviso de repetido e o erro do servidor param de
   *  valer até a próxima conferência (que acontece ao sair do campo). */
  function limparAvisoDoDocumento() {
    if (duplicado) setDuplicado(null);
    if (fieldErrors.cpf_cnpj?.length) {
      setFieldErrors((antes) => ({ ...antes, cpf_cnpj: [] }));
    }
  }

  /** "115786468-2" digitado inteiro na conta (ou "1234-5" na agência): o
   *  número fica na caixa e o dígito vai para a casinha ao lado, se ela
   *  estiver vazia. Sem isso o servidor juntava tudo num número só e
   *  cobrava o dígito que a pessoa achava ter digitado (09/10/2026). */
  function separarDigito(
    e: React.FocusEvent<HTMLInputElement>,
    campoDv: "agencia_dv" | "conta_dv",
  ) {
    const partes = e.currentTarget.value.trim().match(/^(\d+)\s*[-–]\s*([0-9xX])$/);
    const dv = formRef.current?.elements.namedItem(campoDv);
    if (!partes || !(dv instanceof HTMLInputElement) || dv.value.trim()) return;
    e.currentTarget.value = partes[1];
    dv.value = partes[2].toUpperCase();
    relerCampos();
  }

  /** O erro do dígito aparece embaixo da caixa da agência ou da conta:
   *  a casinha do dígito não tem espaço próprio para a mensagem. */
  const errosComDigito = (campo: "agencia" | "conta") => ({
    [campo]: [
      ...(fieldErrors[campo] ?? []),
      ...(fieldErrors[`${campo}_dv`] ?? []),
    ],
  });

  /** "Usar CPF/CNPJ do cadastro" — escreve o documento na chave PIX. */
  function usarDocumentoNaChave() {
    const raw = cpfCnpjRef.current?.value ?? "";
    if (pixMaskRef.current) {
      const nativeSet = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      nativeSet?.call(pixMaskRef.current, raw);
      pixMaskRef.current.dispatchEvent(new Event("input", { bubbles: true }));
    }
    setPixChave(raw);
  }

  // PIX repetido, com folga para terminar de digitar
  React.useEffect(() => {
    if (!pixTipo || !pixChave) {
      setPixWarning(null);
      return;
    }

    const chaveNormalizada =
      pixTipo === "cpf" || pixTipo === "cnpj" || pixTipo === "telefone"
        ? onlyDigits(pixChave)
        : pixChave.trim().toLowerCase();
    if (!chaveNormalizada) {
      setPixWarning(null);
      return;
    }

    const t = setTimeout(async () => {
      const res = await verificarPixDuplicado(
        chaveNormalizada,
        pixTipo || null,
        fornecedor?.id,
      );
      setPixWarning(
        res.existe
          ? `Já existe fornecedor com esta chave PIX: "${res.nome}". Confirme se está correto.`
          : null,
      );
    }, 500);

    return () => clearTimeout(t);
  }, [pixTipo, pixChave, fornecedor?.id]);

  // Valor inicial do documento (zera quando o tipo de pessoa muda)
  const initialDoc =
    fornecedor?.cpf_cnpj && fornecedor.tipo_pessoa === tipoPessoa
      ? fornecedor.cpf_cnpj
      : "";

  // -------------------------------------------------------------------------
  // O que falta — a conta do rodapé
  // -------------------------------------------------------------------------
  const ehPj = tipoPessoa === "juridica";
  const digitosDoc = onlyDigits(campos.cpf_cnpj ?? "");
  const docOk = digitosDoc.length === (ehPj ? 14 : 11);
  const docComeçado = digitosDoc.length > 0;
  const nomeOk = (campos.nome ?? "").trim().length >= 2;
  const emailOk = EMAIL_RE.test((campos.email ?? "").trim());
  const digitosTel = onlyDigits(campos.telefone ?? "");
  const telOk = digitosTel.length === 10 || digitosTel.length === 11;
  const bancoOk = Boolean(
    bancoCodigo &&
      (campos.agencia ?? "").trim() &&
      (campos.conta ?? "").trim() &&
      (campos.conta_dv ?? "").trim() &&
      tipoConta.trim(),
  );
  const pixOk = Boolean(pixTipo && pixChave.trim());

  const pendencias: string[] = [];
  if (!nomeOk) pendencias.push(ehPj ? "nome fantasia" : "nome");
  if (!docOk) pendencias.push(ehPj ? "CNPJ" : "CPF");
  if (!emailOk) pendencias.push("e-mail");
  if (!telOk) pendencias.push("telefone");
  // Conta começada e incompleta: o servidor recusa mesmo com o PIX
  // preenchido. Em 09/10/2026 o rodapé dizia "Pronto para criar", o GP
  // salvava e voltava "Dígito da conta obrigatório" sem lugar na tela.
  const faltaNaConta: string[] = [];
  if (!bancoCodigo) faltaNaConta.push("banco");
  if (!(campos.agencia ?? "").trim()) faltaNaConta.push("agência");
  if (!(campos.conta ?? "").trim()) faltaNaConta.push("conta");
  if (!(campos.conta_dv ?? "").trim()) faltaNaConta.push("dígito da conta");
  if (!tipoConta.trim()) faltaNaConta.push("tipo de conta");
  const contaComecada =
    !semDadosPagamento &&
    faltaNaConta.length > 0 &&
    Boolean(
      bancoCodigo ||
        (campos.agencia ?? "").trim() ||
        (campos.agencia_dv ?? "").trim() ||
        (campos.conta ?? "").trim() ||
        (campos.conta_dv ?? "").trim() ||
        tipoConta.trim(),
    );
  if (contaComecada) pendencias.push(...faltaNaConta);
  // O veículo de mídia nasce sem conta (decisão 147).
  else if (!ehVeiculo && !bancoOk && !pixOk && !semDadosPagamento)
    pendencias.push("conta bancária ou chave PIX (ou marque “Sem conta nem PIX”)");
  /** Algo digitado na conta ou no PIX: com a marcação, sai no salvar. */
  const temAlgumDadoDePagamento = Boolean(
    bancoCodigo ||
      (campos.agencia ?? "").trim() ||
      (campos.conta ?? "").trim() ||
      pixTipo ||
      pixChave.trim(),
  );

  const travadoPorDuplicado = Boolean(duplicado) && !isEdit;
  const pronto = pendencias.length === 0 && !travadoPorDuplicado;

  const textoValidacao = travadoPorDuplicado
    ? `Este ${ehPj ? "CNPJ" : "CPF"} já tem cadastro — não dá para criar outro.`
    : pronto
      ? isEdit
        ? "Tudo preenchido. Salve para gravar as alterações."
        : ehVeiculo
          ? "Pronto para criar. Pagamento, endereço e observações podem ser completados depois."
          : "Pronto para criar. Endereço e observações podem ser completados depois."
      : `Falta ${listar(pendencias)}.`;

  // Módulo fiscal: de onde veio o regime à vista, para o texto embaixo do
  // campo. A consulta só vale para o CNPJ que foi consultado.
  const cnpjAtual = onlyDigits(campos.cpf_cnpj ?? initialDoc);
  const origemRegime = ehPj ? origemDoRegime(regime, consultaRegime, cnpjAtual) : null;

  /** Grava e trata a resposta. Separado do `onSubmit` porque o "tem
   *  certeza?" dos dados de pagamento (decisão 067) reenvia o MESMO
   *  FormData com o flag ligado — e a essa altura o `<form>` do evento já
   *  não está mais ao alcance. */
  function gravar(formData: FormData, confirmarPagamento: boolean) {
    // O arquivo da declaração que vai junto passa a ser do cadastro já: a
    // página de cadastro redireciona e o formulário fecha sem voltar aqui.
    const arquivoIndo = declaracaoArquivo.gravando(
      formData.get("declaracao_simples_path")?.toString() || null,
    );
    startTransition(async () => {
      const res: ActionResult | undefined = await (ehVeiculo
        ? isEdit
          ? atualizarVeiculoFornecedor(fornecedor!.id, formData, confirmarPagamento)
          : // Pela página de Cadastros a action redireciona para a lista.
            criarVeiculoFornecedor(formData, emDialog ? "midia" : "cadastro")
        : isEdit
          ? atualizarFornecedor(fornecedor!.id, formData, confirmarPagamento)
          : emDialog
            ? criarFornecedorRapido(formData)
            : criarFornecedor(formData)
      ).catch(() => ({
        ok: false as const,
        message: "Não foi possível salvar. Tente novamente.",
      }));

      // `criarFornecedor` gravou e redirecionou para a lista: a promessa
      // da action volta vazia, e a página já está saindo.
      if (!res) return;

      if (!res.ok) {
        arquivoIndo.naoGravou();
        if (res.pedeConfirmacaoPagamento) {
          setAvisoPagamento({ formData, ...res.pedeConfirmacaoPagamento });
          return;
        }
        // Erro de campo sem lugar na tela entra no aviso, para nunca sobrar
        // "Verifique os campos destacados" sem nada destacado (09/10/2026).
        const semLugar = Object.entries(res.fieldErrors ?? {})
          .filter(
            ([campo, msgs]) =>
              msgs?.length && !document.querySelector(`[data-field="${campo}"]`),
          )
          .flatMap(([, msgs]) => msgs ?? []);
        setError([res.message, ...semLugar].join(" "));
        if (res.fieldErrors) setFieldErrors(res.fieldErrors);
        if (res.duplicado) setDuplicado(res.duplicado);
        const firstField = res.fieldErrors ? Object.keys(res.fieldErrors)[0] : null;
        if (firstField) {
          const el = document.querySelector<HTMLElement>(`[data-field="${firstField}"]`);
          el?.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        return;
      }
      setAvisoPagamento(null);
      if (isEdit) {
        router.refresh();
        onSalvo?.();
        return;
      }
      if (emDialog && res.fornecedor) onCriado?.(res.fornecedor);
    });
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Mesmo cuidado do `ClienteForm`: o React propaga o submit pela
    // ÁRVORE, e o portal do Radix não a interrompe. Hoje o
    // `NovoFornecedorDialog` do "Gerar PP" é renderizado depois do
    // `</form>` da PP e escapa por sorte — mudar isso de lugar bastaria
    // para o cadastro do fornecedor passar a emitir a PP junto.
    e.stopPropagation();
    // O arquivo da declaração ainda subindo: o botão está travado, e o
    // Enter num campo também não grava.
    if (declaracaoArquivo.enviando) return;
    setError(null);
    setFieldErrors({});

    const formData = new FormData(e.currentTarget);
    formData.set("tipo_pessoa", tipoPessoa);
    formData.set("banco_codigo", bancoCodigo ?? "");
    formData.set("tipo_conta", tipoConta);
    formData.set("pix_tipo", pixTipo);
    formData.set("pix_chave", pixChave);
    // Decisão 161: marcado, conta e PIX vão vazios (o servidor zera de novo).
    formData.set("sem_dados_pagamento", semDadosPagamento ? "true" : "false");
    if (semDadosPagamento) {
      for (const campo of [
        "banco_codigo", "agencia", "agencia_dv", "conta", "conta_dv", "tipo_conta", "pix_tipo", "pix_chave",
      ]) {
        formData.set(campo, "");
      }
    }
    formData.set("cpf_cnpj", onlyDigits(formData.get("cpf_cnpj")?.toString() ?? ""));
    formData.set("telefone", onlyDigits(formData.get("telefone")?.toString() ?? ""));
    formData.set("cep", onlyDigits(formData.get("cep")?.toString() ?? ""));
    // Módulo fiscal: o regime vai com o resto do cadastro; pessoa física não
    // tem. A consulta do CNPJ vai inteira (decisão 142) — a deste CNPJ,
    // valha ou não o regime escolhido —, e a declaração de optante só no
    // Simples (o servidor confere de novo). O arquivo da declaração vai
    // sempre: trocar o regime não o tira do cadastro, só o ✕.
    formData.set("regime_tributario", ehPj ? regime ?? "" : "");
    const consulta = consultaParaGravar(
      ehPj ? consultaRegime : null,
      formData.get("cpf_cnpj")?.toString() ?? "",
    );
    formData.set("regime_consulta", consulta.regime_consulta ?? "");
    formData.set("regime_desde", consulta.regime_desde ?? "");
    formData.set("regime_consultado_em", consulta.regime_consultado_em ?? "");
    formData.set(
      "declaracao_simples_recebida",
      ehPj && regime === "simples" && declaracaoRecebida ? "true" : "false",
    );
    formData.set("declaracao_simples_path", declaracaoArquivo.path ?? "");

    if (duplicado && !isEdit) {
      setError(
        `Este documento já pertence a "${duplicado.razao_social ?? duplicado.nome}". Selecione o cadastro existente em vez de criar outro.`,
      );
      setFieldErrors({ cpf_cnpj: ["Documento já cadastrado."] });
      return;
    }

    gravar(formData, false);
  }

  /** O aviso de documento repetido, com a saída: usar o que já existe. */
  const avisoDuplicado = duplicado && !isEdit && (
    <div
      className="flex flex-col items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11.5px] text-amber-800"
      data-field="cpf_cnpj_duplicado"
    >
      <span className="flex items-start gap-1.5 leading-relaxed">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" />
        <span>
          {ehPj ? "CNPJ" : "CPF"} já cadastrado como{" "}
          <strong>{duplicado.razao_social ?? duplicado.nome}</strong>
          {duplicado.status === "inativo"
            ? " — fornecedor inativo. Reative-o em Fornecedores para poder selecioná-lo."
            : ". Use o cadastro existente em vez de criar outro."}
        </span>
      </span>
      {onSelecionarExistente && duplicado.status === "ativo" ? (
        <button
          type="button"
          onClick={() => onSelecionarExistente(duplicado)}
          className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-2.5 py-1 text-[11.5px] font-semibold text-amber-900 hover:bg-amber-100"
        >
          <UserCheck className="h-3.5 w-3.5" />
          Usar este cadastro
        </button>
      ) : emDialog ? null : (
        // Dentro de PP, BV, conta a pagar ou desembolso o cadastro não sai
        // da tela (decisão 108, D5): o inativo fica só com o aviso, e quem
        // cuida dos cadastros reativa. Abrir o cadastro é coisa da página.
        <Link
          href={`/fornecedores/${duplicado.id}`}
          prefetch={false}
          className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-2.5 py-1 text-[11.5px] font-semibold text-amber-900 hover:bg-amber-100"
        >
          <UserCheck className="h-3.5 w-3.5" />
          Abrir cadastro existente
        </Link>
      )}
    </div>
  );

  /** Um bloco do pagamento — conta ou PIX —, sempre à vista, com o selo de
   *  preenchido no cabeçalho (decisão 161). Com "Sem conta nem PIX", apaga. */
  const blocoDePagamento = (
    Icone: typeof Landmark,
    rotulo: string,
    completo: boolean,
    conteudo: React.ReactNode,
  ) => (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-white transition-opacity",
        semDadosPagamento && "pointer-events-none opacity-45",
      )}
      aria-disabled={semDadosPagamento || undefined}
    >
      <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
        <Icone className="h-[15px] w-[15px] flex-none text-muted-foreground" />
        <span className="text-[13.5px] font-semibold">{rotulo}</span>
        {completo && !semDadosPagamento && (
          <span className="ml-auto inline-flex items-center rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-emerald-700">
            preenchido
          </span>
        )}
      </div>
      <div className="p-4">{conteudo}</div>
    </div>
  );

  return (
    <div
      className={cn(
        "flex flex-col",
        emDialog ? "min-h-0 flex-1" : "gap-4 pb-24",
      )}
    >
      {/* O tipo de pessoa manda nos rótulos do formulário inteiro (Nome
          fantasia/Nome, CNPJ/CPF), e por isso fica fora do cartão. No
          dialog quem o desenha é o cabeçalho, e aqui ele some. */}
      <div
        className={cn(
          "flex flex-col items-start gap-1.5 sm:items-end",
          controladoDeFora && "hidden",
        )}
      >
        <span className="text-[12.5px] font-semibold">Tipo de pessoa</span>
        <div className="inline-flex gap-[3px] rounded-[10px] border border-border bg-white p-[3px]">
          {(["juridica", "fisica"] as const).map((tp) => (
            <button
              type="button"
              key={tp}
              onClick={() => setTipoPessoa(tp)}
              className={cn(
                "rounded-lg px-3.5 py-2 text-[13px] font-semibold transition-colors",
                tipoPessoa === tp
                  ? "bg-california-red text-white shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tp === "juridica" ? "Pessoa Jurídica" : "Pessoa Física"}
            </button>
          ))}
        </div>
      </div>

      <form
        ref={formRef}
        onSubmit={handleSubmit}
        onInput={relerCampos}
        onChange={relerCampos}
        className={cn(
          "flex flex-col",
          emDialog ? "min-h-0 flex-1" : "gap-4",
        )}
      >
        {/* No dialog só ESTE bloco rola: o cabeçalho é do dialog e o
            rodapé fica colado no pé, sempre à vista. */}
        <div
          className={cn(
            "rounded-2xl bg-white",
            emDialog
              ? "min-h-0 flex-1 overflow-y-auto rounded-none border-0"
              : "overflow-hidden border border-border shadow-soft",
          )}
        >
          {/* ---------------------------------------------------------- */}
          {/* Identificação                                               */}
          {/* ---------------------------------------------------------- */}
          <Secao
            titulo="Identificação"
            descricao={
              ehVeiculo
                ? "Como o veículo aparece nas linhas do plano de mídia e nos PIs. O CPF/CNPJ é a chave que impede cadastro repetido."
                : "Como o fornecedor aparece nos itens do orçamento e nas PPs. O CPF/CNPJ é a chave que impede cadastro repetido."
            }
            selo="obrigatorio"
            emDialog={emDialog}
          >
            <div className="grid grid-cols-12 gap-4">
              <Campo
                label={ehPj ? "Nome fantasia" : "Nome"}
                name="nome"
                required
                errors={fieldErrors}
                className="col-span-12 sm:col-span-7"
              >
                <Input
                  name="nome"
                  defaultValue={fornecedor?.nome ?? nomeInicial ?? ""}
                  ref={nomeRef}
                  placeholder="Ex.: Cenografia Vértice"
                  autoFocus
                />
              </Campo>

              <Campo
                label={ehPj ? "CNPJ" : "CPF"}
                name="cpf_cnpj"
                required
                hint={
                  duplicado && !isEdit
                    ? "já cadastrado"
                    : ehPj
                      ? "buscamos na Receita ao sair do campo"
                      : "identifica o fornecedor"
                }
                errors={fieldErrors}
                className="col-span-12 sm:col-span-5"
              >
                <div className="relative">
                  <MaskedInput
                    key={tipoPessoa}
                    mask={ehPj ? "cnpj" : "cpf"}
                    name="cpf_cnpj"
                    defaultValue={initialDoc}
                    ref={cpfCnpjRef}
                    onBlur={handleDocumentoBlur}
                    // Corrigir o documento tem de apagar o aviso na hora: com
                    // o botão travado pelo duplicado, esperar o blur deixaria
                    // quem está digitando sem saída aparente.
                    onInput={limparAvisoDoDocumento}
                    className={cn(
                      duplicado &&
                        !isEdit &&
                        "border-amber-300 ring-[3px] ring-amber-500/10",
                    )}
                  />
                  {cnpjLoading && (
                    <span className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin rounded-full border-2 border-california-red/30 border-t-california-red" />
                  )}
                </div>
                {avisoDuplicado}
                {/* O tamanho errado se avisa na hora; o dígito
                    verificador quem confere é o servidor. */}
                {docComeçado && !docOk && !duplicado && (
                  <p className="text-[11.5px] text-california-red">
                    {ehPj
                      ? "CNPJ deve ter 14 dígitos."
                      : "CPF deve ter 11 dígitos."}
                  </p>
                )}
                {cnpjError && (
                  <p className="text-[11.5px] text-muted-foreground">
                    {cnpjError}
                  </p>
                )}
                {cnpjWarning && (
                  <p className="text-[11.5px] text-amber-700">{cnpjWarning}</p>
                )}
              </Campo>

              {ehPj && (
                <Campo
                  label="Razão social"
                  name="razao_social"
                  hint="Opcional"
                  errors={fieldErrors}
                  // Módulo fiscal: divide a linha com o regime tributário
                  // (era col-span-12).
                  className="col-span-12 sm:col-span-7"
                >
                  <Input
                    name="razao_social"
                    defaultValue={fornecedor?.razao_social ?? ""}
                    ref={razaoSocialRef}
                    placeholder="Nome jurídico, como na nota fiscal"
                  />
                </Campo>
              )}

              {/* Módulo fiscal: o regime tributário, logo abaixo do CNPJ de
                  onde ele vem. Preenchido pela consulta do CNPJ e editável;
                  a origem fica embaixo da lista. Só pessoa jurídica. */}
              {ehPj && (
                <Campo
                  label="Regime tributário"
                  name="regime_tributario"
                  errors={fieldErrors}
                  className="col-span-12 sm:col-span-5"
                >
                  <Select
                    value={regime ?? ""}
                    onValueChange={(v) => setRegime(v as RegimeTributarioFornecedor)}
                  >
                    <SelectTrigger
                      id="regime_tributario"
                      aria-label="Regime tributário"
                      className={erroClasses("regime_tributario")}
                    >
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {REGIMES_DO_FORNECEDOR.map((r) => (
                        <SelectItem key={r} value={r}>
                          {ROTULO_DO_REGIME[r]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {origemRegime && (
                    <span
                      className={cn(
                        "text-[11px] leading-snug",
                        origemRegime.alterado ? "text-amber-700" : "text-muted-foreground",
                      )}
                    >
                      {origemRegime.texto}
                    </span>
                  )}
                </Campo>
              )}

              {/* Módulo fiscal: no Simples, a declaração de optante e o
                  arquivo dela (decisão 142). A caixa fica na altura do
                  botão do arquivo. Fora do Simples os dois somem, mas o
                  arquivo continua com o cadastro. Só na página: o cadastro
                  rápido não mostra os dois (Tiago, 07/10/2026), e o que o
                  cadastro tem segue no envio pelo estado. */}
              {ehPj && regime === "simples" && !emDialog && (
                <>
                  <label className="col-span-12 flex cursor-pointer items-center gap-2.5 self-end sm:col-span-7 sm:h-11">
                    <Checkbox
                      id="declaracao_simples_recebida"
                      checked={declaracaoRecebida}
                      onCheckedChange={(c) => setDeclaracaoRecebida(c === true)}
                    />
                    <span className="text-[12.5px] font-semibold">
                      Declaração de optante recebida (IN SRF 459, anexo I)
                    </span>
                  </label>
                  <CampoArquivoDaDeclaracao
                    arquivo={declaracaoArquivo}
                    disabled={pending}
                    errosDoServidor={fieldErrors.declaracao_simples_path}
                    className="col-span-12 min-w-0 sm:col-span-5"
                  />
                </>
              )}

              {/* Módulo fiscal: o que o regime faz com as retenções e o
                  crédito, na aprovação da PP. Fora do pop-up rápido do
                  veículo (Tiago, 07/10/2026, decisão 150). Lucro Real ou
                  Presumido não tem nota, e a do Simples, que fala da
                  declaração, sai do cadastro rápido junto com ela (Tiago,
                  07/10/2026). */}
              {ehPj &&
                regime &&
                NOTA_DO_REGIME[regime] &&
                !(emDialog && (ehVeiculo || regime === "simples")) && (
                <div className="col-span-12 flex gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-sky-900">
                  <span className="mt-0.5 shrink-0">
                    <Info className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0">{NOTA_DO_REGIME[regime]}</div>
                </div>
              )}

              <Campo
                label="E-mail"
                name="email"
                required
                hint="para cobrar a nota"
                errors={fieldErrors}
                className="col-span-12 sm:col-span-7"
              >
                <Input
                  name="email"
                  type="email"
                  defaultValue={fornecedor?.email ?? ""}
                  placeholder="contato@fornecedor.com.br"
                />
              </Campo>

              <Campo
                label="Telefone"
                name="telefone"
                required
                errors={fieldErrors}
                className="col-span-12 sm:col-span-5"
              >
                <MaskedInput
                  mask="telefone"
                  name="telefone"
                  defaultValue={fornecedor?.telefone ?? ""}
                />
              </Campo>
            </div>
          </Secao>

          <div className="h-px bg-border" />

          {/* ---------------------------------------------------------- */}
          {/* Pagamento                                                   */}
          {/* ---------------------------------------------------------- */}
          <Secao
            titulo="Pagamento"
            descricao={
              ehVeiculo
                ? "Opcional por enquanto: vai ser exigido para gerar a PP do repasse, nas linhas A · Repasse."
                : "Cadastre conta e PIX sempre que houver; uma das duas já basta. Sem nenhuma, marque “Sem conta nem PIX”."
            }
            descricaoNoDialog={
              ehVeiculo
                ? "Opcional por enquanto: vai ser exigido para gerar a PP do repasse, nas linhas A · Repasse."
                : "Cadastre as duas sempre que houver. Uma delas já basta."
            }
            selo={ehVeiculo ? "opcional" : "obrigatorio"}
            emDialog={emDialog}
          >
            <div className="flex flex-col gap-3">
              {blocoDePagamento(
                Landmark,
                "Conta bancária",
                bancoOk,
                <div className="grid grid-cols-12 gap-4">
                <Campo
                  label="Banco"
                  name="banco_codigo"
                  errors={fieldErrors}
                  className="col-span-12"
                >
                  <Combobox
                    items={BANCO_ITEMS}
                    value={bancoCodigo}
                    onChange={(v) => {
                      setBancoCodigo(v);
                      relerCampos();
                    }}
                    placeholder="Buscar por nome ou código"
                    name="banco_codigo"
                  />
                </Campo>

                <Campo
                  label="Agência"
                  name="agencia"
                  errors={errosComDigito("agencia")}
                  className="col-span-6 sm:col-span-4"
                >
                  <div className={cn(
                      "flex h-11 items-center overflow-hidden rounded-lg border border-border bg-white transition-colors focus-within:border-california-red focus-within:ring-2 focus-within:ring-california-red/15 hover:border-california-red/40",
                      erroClasses("agencia") || erroClasses("agencia_dv"),
                    )}>
                    <input
                      name="agencia"
                      inputMode="numeric"
                      // Folga para o "-dígito", que sai daqui ao sair do campo.
                      maxLength={7}
                      onBlur={(e) => separarDigito(e, "agencia_dv")}
                      defaultValue={fornecedor?.agencia ?? ""}
                      placeholder="0000"
                      className="h-full min-w-0 flex-1 border-0 bg-transparent px-3.5 text-sm tabular-nums outline-none placeholder:text-muted-foreground/60"
                    />
                    <span className="text-sm text-muted-foreground/40">/</span>
                    <input
                      name="agencia_dv"
                      data-field="agencia_dv"
                      maxLength={1}
                      defaultValue={fornecedor?.agencia_dv ?? ""}
                      placeholder="0"
                      aria-label="Dígito da agência"
                      className="h-full w-9 border-0 bg-transparent px-2 text-center text-sm outline-none placeholder:text-muted-foreground/60"
                    />
                  </div>
                </Campo>

                <Campo
                  label="Conta"
                  name="conta"
                  errors={errosComDigito("conta")}
                  className="col-span-6 sm:col-span-4"
                >
                  <div className={cn(
                      "flex h-11 items-center overflow-hidden rounded-lg border border-border bg-white transition-colors focus-within:border-california-red focus-within:ring-2 focus-within:ring-california-red/15 hover:border-california-red/40",
                      erroClasses("conta") || erroClasses("conta_dv"),
                    )}>
                    <input
                      name="conta"
                      inputMode="numeric"
                      // Folga para o "-dígito", que sai daqui ao sair do campo.
                      maxLength={14}
                      onBlur={(e) => separarDigito(e, "conta_dv")}
                      defaultValue={fornecedor?.conta ?? ""}
                      placeholder="00000000"
                      className="h-full min-w-0 flex-1 border-0 bg-transparent px-3.5 text-sm tabular-nums outline-none placeholder:text-muted-foreground/60"
                    />
                    <span className="text-sm text-muted-foreground/40">/</span>
                    <input
                      name="conta_dv"
                      data-field="conta_dv"
                      maxLength={1}
                      defaultValue={fornecedor?.conta_dv ?? ""}
                      placeholder="0"
                      aria-label="Dígito da conta"
                      className="h-full w-9 border-0 bg-transparent px-2 text-center text-sm outline-none placeholder:text-muted-foreground/60"
                    />
                  </div>
                </Campo>

                <Campo
                  label="Tipo de conta"
                  name="tipo_conta"
                  errors={fieldErrors}
                  className="col-span-12 sm:col-span-4"
                >
                  {/* Idem: lista do sistema. O valor vai ao servidor pelo
                      `formData.set` do envio, como o resto dos campos
                      controlados deste formulário. */}
                  <Select value={tipoConta} onValueChange={setTipoConta}>
                    <SelectTrigger
                      id="tipo_conta"
                      aria-label="Tipo de conta"
                      className={erroClasses("tipo_conta")}
                    >
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="corrente">Conta corrente</SelectItem>
                      <SelectItem value="poupanca">Conta poupança</SelectItem>
                      <SelectItem value="pagamento">Conta de pagamento</SelectItem>
                    </SelectContent>
                  </Select>
                </Campo>
              </div>
              )}
              {blocoDePagamento(
                Zap,
                "Chave PIX",
                pixOk,
                <div className="grid grid-cols-12 gap-4">
                <Campo
                  label="Tipo de chave"
                  name="pix_tipo"
                  errors={fieldErrors}
                  className="col-span-12 sm:col-span-4"
                >
                  {/* Lista do sistema, não o `<select>` nativo: dentro do
                      dialog de cadastro rápido (o "+" da PP) o menu do
                      sistema operacional brigava com o foco do Radix e a
                      produção não conseguia escolher o tipo — relato de
                      18/09/2026. */}
                  <Select
                    value={pixTipo}
                    onValueChange={(v) => {
                      setPixTipo(v as PixTipoChave);
                      setPixChave("");
                      setPixWarning(null);
                    }}
                  >
                    <SelectTrigger
                      id="pix_tipo"
                      aria-label="Tipo de chave PIX"
                      className={erroClasses("pix_tipo")}
                    >
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {PIX_TIPOS.map((t) => (
                        <SelectItem key={t.valor} value={t.valor}>
                          {t.rotulo}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Campo>

                <Campo
                  label="Chave"
                  name="pix_chave"
                  errors={fieldErrors}
                  className="col-span-12 sm:col-span-8"
                  acao={
                    (pixTipo === "cpf" || pixTipo === "cnpj") && (
                      <button
                        type="button"
                        onClick={usarDocumentoNaChave}
                        className="flex-none whitespace-nowrap text-[11.5px] text-california-red hover:underline"
                      >
                        Usar {pixTipo === "cpf" ? "CPF" : "CNPJ"} do cadastro
                      </button>
                    )
                  }
                >
                  <PixChaveInput
                    key={pixTipo}
                    tipo={pixTipo}
                    initialValue={chavePixParaExibir(pixTipo, pixChave)}
                    onDigitsChange={setPixChave}
                    onRawChange={setPixChave}
                    maskRef={pixMaskRef}
                  />
                  {/* O alvo do formato, por tipo: o arquivo de pagamento
                      (CNAB) leva a chave exatamente como o DICT a guarda,
                      então quem digita precisa saber o que vai ser gravado
                      (18/09/2026). */}
                  {pixTipo && (
                    <span className="text-[11.5px] leading-snug text-muted-foreground">
                      {PIX_AJUDA[pixTipo]}
                    </span>
                  )}
                  {pixWarning && (
                    <div className="mt-0.5 flex items-start gap-1.5 text-[11.5px] text-amber-700">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{pixWarning}</span>
                    </div>
                  )}
                </Campo>
              </div>
              )}
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-dashed border-border bg-white px-4 py-3 hover:border-california-red/40">
                <Checkbox
                  checked={semDadosPagamento}
                  onCheckedChange={(v) => setSemDadosPagamento(v === true)}
                  className="mt-0.5"
                  aria-label="Sem conta nem PIX no cadastro"
                />
                <span className="flex flex-col gap-0.5">
                  <span className="text-[13px] font-semibold">Sem conta nem PIX no cadastro</span>
                  <span className="text-[11.5px] leading-snug text-muted-foreground">
                    A cada PP, ele manda boleto ou chave aleatória.
                  </span>
                </span>
              </label>
              {semDadosPagamento && temAlgumDadoDePagamento && (
                <div className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] text-amber-800">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" />
                  <span>Ao salvar, a conta e a chave PIX digitadas saem do cadastro.</span>
                </div>
              )}
            </div>
          </Secao>

          <div className="h-px bg-border" />

          {/* ---------------------------------------------------------- */}
          {/* Endereço — recolhido até alguém pedir                       */}
          {/* ---------------------------------------------------------- */}
          <Secao
            titulo="Endereço"
            descricao="Usado na nota fiscal. Nada aqui bloqueia o cadastro."
            descricaoNoDialog="Usado na nota fiscal. Nada aqui é obrigatório."
            selo="opcional"
            emDialog={emDialog}
          >
            {!enderecoAberto && (
              <button
                type="button"
                onClick={() => setEnderecoAberto(true)}
                className="flex w-full items-center gap-2.5 rounded-[10px] border border-dashed border-border bg-muted/20 px-4 py-3.5 text-left text-[13px] font-semibold transition-colors hover:border-california-red/45 hover:bg-white"
              >
                <Plus className="h-[15px] w-[15px] flex-none text-california-red" />
                Informar endereço
                <span className="font-normal text-muted-foreground">
                  — pode ficar para depois
                </span>
              </button>
            )}

            {/* Escondido, e não desmontado: recolher não pode apagar o
                que já foi digitado. */}
            <div className={cn("flex flex-col gap-3.5", !enderecoAberto && "hidden")}>
              <div className="grid grid-cols-12 gap-4">
                <Campo
                  label="CEP"
                  name="cep"
                  errors={fieldErrors}
                  className="col-span-12 sm:col-span-4"
                >
                  <div className="relative">
                    <MaskedInput
                      key={`cep-${cepKey}`}
                      mask="cep"
                      name="cep"
                      defaultValue={cepInitialValue}
                      onBlur={handleCepBlur}
                      ref={cepRef}
                    />
                    {cepLoading && (
                      <span className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin rounded-full border-2 border-california-red/30 border-t-california-red" />
                    )}
                  </div>
                  <span className="text-[11px] leading-snug text-muted-foreground">
                    {cepError ??
                      "Preenchemos rua, bairro, cidade e UF pelo CEP."}
                  </span>
                </Campo>

                <Campo
                  label="Logradouro"
                  name="logradouro"
                  errors={fieldErrors}
                  className="col-span-12 sm:col-span-8"
                >
                  <Input
                    name="logradouro"
                    defaultValue={fornecedor?.logradouro ?? ""}
                    ref={logradouroRef}
                    placeholder="Rua, avenida, estrada…"
                  />
                </Campo>

                <Campo
                  label="Número"
                  name="numero"
                  errors={fieldErrors}
                  className="col-span-4 sm:col-span-2"
                >
                  <Input
                    name="numero"
                    defaultValue={fornecedor?.numero ?? ""}
                    ref={numeroRef}
                    placeholder="123"
                  />
                </Campo>

                <Campo
                  label="Complemento"
                  name="complemento"
                  errors={fieldErrors}
                  className="col-span-8 sm:col-span-5"
                >
                  <Input
                    name="complemento"
                    defaultValue={fornecedor?.complemento ?? ""}
                    ref={complementoRef}
                    placeholder="Sala, bloco, andar…"
                  />
                </Campo>

                <Campo
                  label="Bairro"
                  name="bairro"
                  errors={fieldErrors}
                  className="col-span-12 sm:col-span-5"
                >
                  <Input
                    name="bairro"
                    defaultValue={fornecedor?.bairro ?? ""}
                    ref={bairroRef}
                  />
                </Campo>

                <Campo
                  label="Cidade"
                  name="cidade"
                  errors={fieldErrors}
                  className="col-span-9"
                >
                  <Input
                    name="cidade"
                    defaultValue={fornecedor?.cidade ?? ""}
                    ref={cidadeRef}
                  />
                </Campo>

                <Campo
                  label="UF"
                  name="uf"
                  errors={fieldErrors}
                  className="col-span-3"
                >
                  <Combobox
                    id="uf"
                    name="uf"
                    items={UFS.map((u) => ({ value: u, label: u }))}
                    value={uf || null}
                    onChange={(v) => setUf(v ?? "")}
                    placeholder="—"
                    buscaPlaceholder="UF"
                    limpavel
                    className="h-11 border-border px-3"
                  />
                </Campo>
              </div>

              <button
                type="button"
                onClick={() => setEnderecoAberto(false)}
                className="self-start whitespace-nowrap text-[11.5px] text-muted-foreground underline hover:text-foreground"
              >
                Recolher endereço
              </button>
            </div>
          </Secao>

          <div className="h-px bg-border" />

          {/* ---------------------------------------------------------- */}
          {/* Observações                                                 */}
          {/* ---------------------------------------------------------- */}
          <Secao
            titulo="Observações"
            descricao="Especialidade, prazo habitual, quem indicou."
            descricaoNoDialog="Especialidade, prazo habitual, quem indicou."
            selo="opcional"
            emDialog={emDialog}
          >
            <Textarea
              name="observacoes"
              defaultValue={fornecedor?.observacoes ?? ""}
              rows={4}
              placeholder="Ex.: cenografia de grande porte, fatura em 30 dias, indicação da regional SP."
            />
          </Secao>
        </div>

        {error && (
          <div
            className={cn(
              "flex items-start gap-2 border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red",
              emDialog ? "flex-none border-x-0 border-b-0" : "rounded-xl",
            )}
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* ------------------------------------------------------------ */}
        {/* Rodapé: o que falta, e os dois botões                         */}
        {/* ------------------------------------------------------------ */}
        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-4 border border-border px-5 py-3.5",
            emDialog
              ? "flex-none rounded-none border-x-0 border-b-0 bg-muted/30"
              : "sticky bottom-0 rounded-t-2xl border-b-0 bg-white/95 shadow-[0_-4px_16px_-8px_rgba(0,0,0,.12)] backdrop-blur",
          )}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            {pronto ? (
              <CheckCircle2 className="h-4 w-4 flex-none text-emerald-700" />
            ) : (
              <Info className="h-4 w-4 flex-none text-muted-foreground" />
            )}
            <span
              className={cn(
                "text-[12.5px] leading-snug",
                pronto ? "text-emerald-700" : "text-muted-foreground",
              )}
            >
              {textoValidacao}
            </span>
          </div>

          {/* `ml-auto`: com a mensagem longa ("Pronto para criar: …") a
              linha quebra, e os botões ficariam à esquerda. */}
          <div className="ml-auto flex flex-none items-center gap-2.5">
            {emDialog ? (
              <button
                type="button"
                onClick={onCancelar}
                disabled={pending}
                className="rounded-lg border border-border bg-white px-[18px] py-2.5 text-[13.5px] font-semibold text-foreground transition-colors hover:bg-accent disabled:opacity-60"
              >
                Cancelar
              </button>
            ) : (
              <Link
                href={ehVeiculo ? "/cadastros/veiculos" : "/fornecedores"}
                prefetch={false}
                className="rounded-lg border border-border bg-white px-[18px] py-2.5 text-[13.5px] font-semibold text-foreground transition-colors hover:bg-accent"
              >
                Cancelar
              </Link>
            )}
            <button
              type="submit"
              // Com o arquivo da declaração subindo, espera: gravar antes
              // deixaria o arquivo fora do cadastro.
              disabled={pending || !pronto || Boolean(declaracaoArquivo.enviando)}
              title={pronto ? undefined : textoValidacao}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg bg-california-red px-[18px] py-2.5 text-[13.5px] font-semibold text-white transition-all",
                pronto && !pending && !declaracaoArquivo.enviando
                  ? "shadow-brand hover:bg-california-red-hover"
                  : "cursor-not-allowed opacity-45",
              )}
            >
              {pending ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Salvando…
                </>
              ) : (
                <>
                  {emDialog && !isEdit ? (
                    <Check className="h-[15px] w-[15px]" />
                  ) : (
                    <Save className="h-[15px] w-[15px]" />
                  )}
                  {isEdit
                    ? "Salvar alterações"
                    : emDialog
                      ? "Criar e selecionar"
                      : ehVeiculo
                        ? "Criar veículo"
                        : "Criar fornecedor"}
                </>
              )}
            </button>
          </div>
        </div>
      </form>

      {/* Trocar a conta de quem já tem PP no financeiro (decisão 067).
          A PP de lá paga pela foto que guardou — o aviso existe porque
          quem edita costuma achar que está consertando aquela PP. */}
      <ConfirmDialog
        open={avisoPagamento !== null}
        onOpenChange={(aberto) => {
          if (!aberto) setAvisoPagamento(null);
        }}
        title="Salvar os dados de pagamento novos?"
        description={
          avisoPagamento && (
            <>
              {avisoPagamento.pps === 1 ? (
                <>
                  A PP{" "}
                  <strong className="text-foreground">
                    {avisoPagamento.codigos[0]}
                  </strong>{" "}
                  já está no financeiro
                </>
              ) : (
                <>
                  <strong className="text-foreground">
                    {avisoPagamento.pps} PPs
                  </strong>{" "}
                  deste fornecedor já estão no financeiro (
                  {avisoPagamento.codigos.join(", ")}
                  {avisoPagamento.pps > avisoPagamento.codigos.length && " …"})
                </>
              )}{" "}
              e {avisoPagamento.pps === 1 ? "vai" : "vão"} ser{" "}
              {avisoPagamento.pps === 1 ? "paga" : "pagas"} pela conta que{" "}
              {avisoPagamento.pps === 1 ? "guardou" : "guardaram"} no envio —
              a alteração não chega até {avisoPagamento.pps === 1 ? "ela" : "elas"}.
              O cadastro novo vale para as <strong>próximas</strong> PPs.
              <br />
              <br />
              Se o pagamento de uma PP que já está lá é que está errado, o
              caminho é cancelá-la e emitir outra.
            </>
          )
        }
        confirmLabel="Salvar mesmo assim"
        cancelLabel="Voltar"
        pending={pending}
        onConfirm={() => {
          if (avisoPagamento) gravar(avisoPagamento.formData, true);
        }}
      />
    </div>
  );
}
