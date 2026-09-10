"use client";

/**
 * O cadastro de cliente — desenho "Clientes - Novo Cadastro" (projeto
 * Claude Design `69342d83`, implementado em 09/09/2026).
 *
 * O formulário é um só e serve as duas telas: a de cadastro e a de
 * edição. Decisão do Tiago em 09/09/2026 — "devem se tratar do mesmo
 * formulário com os mesmos campos, apenas um cria inicialmente e o outro
 * realiza qualquer edição que seja necessária", igual ao de fornecedor.
 *
 * O que mudou:
 *
 *   * **Marcas e portais entram no mesmo envio.** Era o buraco principal:
 *     só dava para cadastrá-los DEPOIS de o cliente existir, em cartões
 *     separados na tela de edição. Agora o cliente nasce pronto para
 *     abrir projeto.
 *   * **Um cartão, cinco seções**, cada uma com a explicação numa coluna
 *     à esquerda e o selo que diz se ela trava o cadastro.
 *   * **O código se sugere sozinho** a partir do nome fantasia, até
 *     alguém digitar por cima. Só na criação: na edição o código já é
 *     prefixo de projeto e job, e não se mexe sozinho.
 *   * **CNPJ e código conferidos ao vivo** contra quem já existe, para o
 *     aviso chegar antes de a pessoa preencher o resto.
 *   * **E-mail e telefone aceitam mais de um** (`emails_extras` /
 *     `telefones_extras`, migration de 09/09/2026).
 *   * **O rodapé conta o que falta**, e o botão só acende quando não
 *     falta nada.
 *
 * O que NÃO mudou: as regras vivem em `lib/validations/clientes.ts` e no
 * servidor. A conta do rodapé é a mesma feita na tela, para dizer o que
 * falta antes do clique; quem recusa de verdade é a action.
 *
 * `Secao` e `Campo` são cópias locais das do formulário de fornecedor, de
 * propósito: extrair para um componente comum obrigaria a editar
 * `fornecedor-form.tsx`, que é de outra frente de trabalho.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  Lock,
  Plus,
  RotateCcw,
  Save,
  UserCheck,
  X,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MaskedInput } from "@/components/ui/masked-input";
import { cn, onlyDigits } from "@/lib/utils";
import { HONORARIOS_PADRAO_FALLBACK } from "@/lib/validations/clientes";
import type { Cliente, ClienteProduto, ClientePortal } from "@/lib/types";
import {
  atualizarCliente,
  buscarClientePorCnpj,
  buscarClientePorCodigo,
  criarCliente,
  type ActionResult,
  type ClienteResumo,
} from "./actions";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** "nome fantasia, código e CNPJ" — a lista do rodapé, com o "e" antes
 *  do último. */
function listar(itens: string[]): string {
  if (itens.length <= 1) return itens.join("");
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

/** Nome de cliente seguido de ponto final — sem duplicar o ponto de quem
 *  já termina em abreviação ("ARENA SERRA DOURADA S.A."). */
function comPontoFinal(nome: string): string {
  return nome.endsWith(".") ? nome : `${nome}.`;
}

/** Chave estável de linha. O índice não serve: remover a linha do meio
 *  faria o React reaproveitar o input errado, e os campos com máscara
 *  guardam o próprio texto. */
let seqUid = 0;
function novoUid(): string {
  seqUid += 1;
  return `linha-${seqUid}`;
}

interface LinhaContato {
  uid: string;
  valor: string;
}

interface LinhaMarca {
  uid: string;
  /** Presente = marca que já existe no banco. */
  id?: string;
  codigo?: string;
  nome: string;
  ativo: boolean;
}

interface LinhaPortal {
  uid: string;
  id?: string;
  nome: string;
  url: string;
  ativo: boolean;
}

// ---------------------------------------------------------------------------
// Peças do desenho: a seção com explicação à esquerda, e o campo com dica
// ---------------------------------------------------------------------------

function Secao({
  titulo,
  descricao,
  selo,
  children,
}: {
  titulo: string;
  descricao: React.ReactNode;
  selo: string;
  children: React.ReactNode;
}) {
  const obrigatorio = selo === "Obrigatório";
  return (
    <div className="grid gap-6 px-7 py-7 md:grid-cols-[minmax(0,208px)_minmax(0,1fr)] md:gap-8">
      <div>
        <h3 className="text-[14.5px] font-bold tracking-tight">{titulo}</h3>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          {descricao}
        </p>
        <span
          className={cn(
            "mt-2.5 inline-block rounded-full px-2 py-[3px] text-[10.5px] font-bold uppercase tracking-wider",
            obrigatorio
              ? "bg-california-red/[0.08] text-[#c2404a]"
              : "bg-muted text-muted-foreground",
          )}
        >
          {selo}
        </span>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Campo({
  label,
  name,
  required,
  hint,
  errors,
  className,
  children,
}: {
  label: string;
  name: string;
  required?: boolean;
  hint?: React.ReactNode;
  errors: Record<string, string[]>;
  className?: string;
  children: React.ReactNode;
}) {
  const msgs = errors[name];
  return (
    <div
      className={cn("flex min-w-0 flex-col gap-1.5", className)}
      data-field={name}
    >
      <div className="flex items-baseline justify-between gap-2">
        <Label
          htmlFor={name}
          className="whitespace-nowrap text-[12.5px] font-semibold"
        >
          {label}
          {required && <span className="ml-1 text-california-red">*</span>}
        </Label>
        {hint ? (
          <span className="flex-none whitespace-nowrap text-[11px] text-muted-foreground">
            {hint}
          </span>
        ) : null}
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

/** O "X" das listas. Em linha que já existe no banco ele inativa, e o
 *  botão vira "Reativar" — marca e portal nunca são apagados. */
function BotaoLinha({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="inline-flex h-[34px] w-[34px] flex-none items-center justify-center rounded-lg border border-border bg-white text-muted-foreground transition-colors hover:border-california-red/45 hover:text-california-red"
    >
      {children}
    </button>
  );
}

const BOTAO_ADICIONAR =
  "inline-flex items-center gap-2 self-start whitespace-nowrap rounded-[9px] border border-dashed border-[#dedcd7] bg-[#fcfcfb] px-3.5 py-2.5 text-[12.5px] font-semibold text-foreground transition-colors hover:border-california-red/45 hover:bg-white";

const LINK_ADICIONAR =
  "inline-flex items-center gap-1.5 self-start whitespace-nowrap border-0 bg-transparent p-0 text-[11.5px] font-semibold text-california-red transition-colors hover:underline";

// ---------------------------------------------------------------------------
// O formulário
// ---------------------------------------------------------------------------

interface Props {
  cliente?: Cliente;
  /** Todas as marcas do cliente, inclusive a padrão e as inativas. */
  marcas?: ClienteProduto[];
  portais?: ClientePortal[];
}

export function ClienteForm({ cliente, marcas = [], portais = [] }: Props) {
  const router = useRouter();
  const isEdit = Boolean(cliente);

  const marcaPrincipalSalva = marcas.find((m) => m.padrao) ?? null;

  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<
    Record<string, string[]>
  >({});

  // --- Identificação -------------------------------------------------------
  const [nome, setNome] = React.useState(cliente?.nome_fantasia ?? "");
  const [codigo, setCodigo] = React.useState(cliente?.codigo_curto ?? "");
  /** Na edição o código já existe: nunca se sugere sozinho por cima. */
  const [codigoEditado, setCodigoEditado] = React.useState(isEdit);
  const [cnpj, setCnpj] = React.useState(onlyDigits(cliente?.cnpj ?? ""));
  const [email, setEmail] = React.useState(cliente?.email ?? "");
  const [telefone, setTelefone] = React.useState(
    onlyDigits(cliente?.telefone ?? ""),
  );

  const [emailsExtras, setEmailsExtras] = React.useState<LinhaContato[]>(() =>
    (cliente?.emails_extras ?? []).map((v) => ({ uid: novoUid(), valor: v })),
  );
  const [telefonesExtras, setTelefonesExtras] = React.useState<LinhaContato[]>(
    () =>
      (cliente?.telefones_extras ?? []).map((v) => ({
        uid: novoUid(),
        valor: v,
      })),
  );

  // --- Marcas e portais ----------------------------------------------------
  const [linhasMarca, setLinhasMarca] = React.useState<LinhaMarca[]>(() =>
    marcas
      .filter((m) => !m.padrao)
      .map((m) => ({
        uid: novoUid(),
        id: m.id,
        codigo: m.codigo,
        nome: m.nome,
        ativo: m.ativo,
      })),
  );
  const [linhasPortal, setLinhasPortal] = React.useState<LinhaPortal[]>(() =>
    portais.map((p) => ({
      uid: novoUid(),
      id: p.id,
      nome: p.nome,
      url: p.url,
      ativo: p.ativo,
    })),
  );

  const [honorarios, setHonorarios] = React.useState(
    String(cliente?.percentual_honorarios_padrao ?? HONORARIOS_PADRAO_FALLBACK),
  );

  // --- Quem já usa este CNPJ / este código ---------------------------------
  const [cnpjDuplicado, setCnpjDuplicado] =
    React.useState<ClienteResumo | null>(null);
  const [codigoDuplicado, setCodigoDuplicado] =
    React.useState<ClienteResumo | null>(null);

  /**
   * O código sugerido acompanha o nome fantasia enquanto ninguém digitar
   * por cima: só letras, seis primeiras, maiúsculas — o desenho.
   */
  const codigoSugerido = codigoEditado
    ? codigo
    : nome
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^A-Za-z]/g, "")
        .slice(0, 6)
        .toUpperCase();

  async function conferirCnpj(digits: string) {
    if (digits.length !== 14) {
      setCnpjDuplicado(null);
      return;
    }
    const res = await buscarClientePorCnpj(digits, cliente?.id);
    setCnpjDuplicado(res.existe ? res.cliente : null);
  }

  async function conferirCodigo(valor: string) {
    const limpo = valor.trim();
    if (limpo === "") {
      setCodigoDuplicado(null);
      return;
    }
    const res = await buscarClientePorCodigo(limpo, cliente?.id);
    setCodigoDuplicado(res.existe ? res.cliente : null);
  }

  /** O código sugerido nunca passa pelo blur de um campo que a pessoa não
   *  tocou — então é aqui que ele é conferido. */
  React.useEffect(() => {
    if (codigoEditado) return;
    const t = setTimeout(() => void conferirCodigo(codigoSugerido), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codigoSugerido, codigoEditado]);

  // --- O que falta — a conta do rodapé -------------------------------------
  const nomeOk = nome.trim().length >= 2;
  const codigoOk = codigoSugerido.trim() !== "";
  const cnpjOk = cnpj.length === 14;
  const honNumero = Number(honorarios.replace(",", "."));
  const honOk =
    honorarios.trim() !== "" &&
    Number.isFinite(honNumero) &&
    honNumero >= 0 &&
    honNumero <= 100;

  const pendencias: string[] = [];
  if (!nomeOk) pendencias.push("nome fantasia");
  if (!codigoOk) pendencias.push("código");
  if (!cnpjOk) pendencias.push("CNPJ");
  if (!honOk) pendencias.push("honorários");

  // E-mail e telefone são opcionais (decisão do Tiago, 09/09/2026: 155 dos
  // 157 clientes não tinham e-mail). Mas o que for preenchido tem de
  // valer.
  const emailPrincipalInvalido =
    email.trim() !== "" && !EMAIL_RE.test(email.trim());
  const telefonePrincipalInvalido =
    telefone !== "" && telefone.length !== 10 && telefone.length !== 11;
  const emailExtraInvalido = emailsExtras.some(
    (l) => l.valor.trim() !== "" && !EMAIL_RE.test(l.valor.trim()),
  );
  const telefoneExtraInvalido = telefonesExtras.some((l) => {
    const d = onlyDigits(l.valor);
    return d !== "" && d.length !== 10 && d.length !== 11;
  });

  // Linha de portal pela metade não pode chegar ao submit: o
  // `portalLinhaSchema` exige nome E url começando em http(s)://.
  const erroPortal = (() => {
    for (const p of linhasPortal) {
      const n = p.nome.trim();
      const u = p.url.trim();
      if (!n && !u) continue;
      if (!n) return "Falta o nome de um dos portais.";
      if (!u) return `Falta o link do portal ${n}.`;
      if (!/^https?:\/\//i.test(u)) {
        return `O link do portal ${n} precisa começar com http:// ou https://.`;
      }
    }
    return null;
  })();

  const travadoPorCnpj = Boolean(cnpjDuplicado);
  const travadoPorCodigo = Boolean(codigoDuplicado);

  const pronto =
    pendencias.length === 0 &&
    !travadoPorCnpj &&
    !travadoPorCodigo &&
    !emailPrincipalInvalido &&
    !telefonePrincipalInvalido &&
    !emailExtraInvalido &&
    !telefoneExtraInvalido &&
    !erroPortal;

  const marcasNovas = linhasMarca.filter(
    (m) => m.nome.trim() !== "" && !m.id && m.ativo,
  ).length;

  const textoValidacao = travadoPorCnpj
    ? "Este CNPJ já tem cadastro — não dá para criar outro."
    : travadoPorCodigo
      ? `Este código já é de ${comPontoFinal(codigoDuplicado!.nome_fantasia)}`
      : pendencias.length > 0
        ? `Falta ${listar(pendencias)}.`
        : emailPrincipalInvalido || emailExtraInvalido
          ? "Confira o e-mail — o formato não está válido."
          : telefonePrincipalInvalido || telefoneExtraInvalido
            ? "Confira o telefone — precisa ter 10 ou 11 dígitos."
            : erroPortal
              ? erroPortal
              : isEdit
                ? "Tudo preenchido. Salve para gravar as alterações."
                : marcasNovas > 0
                  ? `Pronto para criar o cliente com ${marcasNovas} ${marcasNovas === 1 ? "marca extra" : "marcas extras"} além da principal.`
                  : "Pronto para criar. A marca principal é criada junto, com o nome fantasia.";

  const rotuloSalvar = isEdit
    ? "Salvar alterações"
    : marcasNovas > 0
      ? `Criar cliente e ${marcasNovas} ${marcasNovas === 1 ? "marca" : "marcas"}`
      : "Criar cliente";

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    const formData = new FormData(e.currentTarget);
    formData.set("nome_fantasia", nome);
    formData.set("codigo_curto", codigoSugerido.trim());
    formData.set("cnpj", cnpj);
    formData.set("email", email);
    formData.set("telefone", telefone);
    formData.set("percentual_honorarios_padrao", honorarios);

    formData.set(
      "emails_extras",
      JSON.stringify(emailsExtras.map((l) => l.valor)),
    );
    formData.set(
      "telefones_extras",
      JSON.stringify(telefonesExtras.map((l) => onlyDigits(l.valor))),
    );
    formData.set(
      "marcas",
      JSON.stringify(
        linhasMarca.map((m) => ({ id: m.id, nome: m.nome, ativo: m.ativo })),
      ),
    );
    formData.set(
      "portais",
      JSON.stringify(
        linhasPortal.map((p) => ({
          id: p.id,
          nome: p.nome,
          url: p.url,
          ativo: p.ativo,
        })),
      ),
    );

    startTransition(async () => {
      const res: ActionResult = isEdit
        ? await atualizarCliente(cliente!.id, formData)
        : await criarCliente(formData);

      if (!res.ok) {
        setError(res.message);
        if (res.fieldErrors) setFieldErrors(res.fieldErrors);
        return;
      }
      // criar já redireciona no server; atualizar dá refresh.
      if (isEdit) router.refresh();
    });
  }

  const nomeMarcaPrincipal = nome.trim() || "Defina o nome fantasia acima";

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 pb-24">
      <div className="overflow-hidden rounded-2xl border border-border bg-white shadow-soft">
        {/* ---------------------------------------------------------- */}
        {/* Identificação                                               */}
        {/* ---------------------------------------------------------- */}
        <Secao
          titulo="Identificação"
          descricao="Como o cliente aparece nas listas, nos projetos e no código dos jobs."
          selo="Obrigatório"
        >
          <div className="grid grid-cols-12 gap-4">
            <Campo
              label="Nome fantasia"
              name="nome_fantasia"
              required
              errors={fieldErrors}
              className="col-span-12 sm:col-span-7"
            >
              <Input
                id="nome_fantasia"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Ex.: Ambev"
                autoFocus
                maxLength={200}
              />
            </Campo>

            <Campo
              label="Código"
              name="codigo_curto"
              required
              hint="único por cliente"
              errors={fieldErrors}
              className="col-span-12 sm:col-span-5"
            >
              <Input
                id="codigo_curto"
                value={codigoSugerido}
                onChange={(e) => {
                  setCodigo(e.target.value);
                  setCodigoEditado(true);
                  setCodigoDuplicado(null);
                }}
                onBlur={(e) => void conferirCodigo(e.target.value)}
                placeholder="Ex.: AMBEV"
                maxLength={50}
                className={cn(
                  "tracking-[0.02em]",
                  codigoDuplicado &&
                    "border-[#f2cd8a] ring-2 ring-amber-500/[0.12]",
                )}
              />
              <span
                className={cn(
                  "text-[11px] leading-relaxed",
                  codigoDuplicado ? "text-[#92400e]" : "text-muted-foreground",
                )}
              >
                {codigoDuplicado
                  ? "Este código já é de outro cliente — troque para salvar."
                  : "Vira o prefixo dos códigos de projeto e job."}
              </span>
            </Campo>

            <Campo
              label="Razão social"
              name="razao_social"
              hint="Opcional"
              errors={fieldErrors}
              className="col-span-12 sm:col-span-7"
            >
              <Input
                id="razao_social"
                name="razao_social"
                defaultValue={cliente?.razao_social ?? ""}
                placeholder="Nome jurídico, como na nota fiscal"
                maxLength={200}
              />
            </Campo>

            <Campo
              label="CNPJ"
              name="cnpj"
              required
              hint={cnpjDuplicado ? "já cadastrado" : undefined}
              errors={fieldErrors}
              className="col-span-12 sm:col-span-5"
            >
              <MaskedInput
                mask="cnpj"
                id="cnpj"
                defaultValue={cliente?.cnpj ?? ""}
                onDigitsChange={(d) => {
                  setCnpj(d);
                  // Digitar limpa o aviso na hora — com o botão travado,
                  // esperar o blur deixaria quem está corrigindo sem saída
                  // aparente. Mesma escolha da decisão 065, e vale também
                  // para quem cola outro CNPJ por cima do que está lá.
                  setCnpjDuplicado(null);
                }}
                onBlur={() => void conferirCnpj(cnpj)}
                className={cn(
                  "tabular-nums",
                  cnpjDuplicado &&
                    "border-[#f2cd8a] ring-2 ring-amber-500/[0.12]",
                )}
              />
              {cnpjDuplicado && (
                <div className="flex flex-col items-start gap-2 rounded-[9px] border border-[#fde3b0] bg-[#fffbeb] px-[11px] py-[9px]">
                  <span className="flex gap-[7px] text-[11.5px] leading-relaxed text-[#92400e]">
                    <AlertTriangle className="mt-px h-3.5 w-3.5 flex-none text-[#b45309]" />
                    <span>
                      CNPJ já cadastrado como{" "}
                      <strong>{cnpjDuplicado.nome_fantasia}</strong>
                      {cnpjDuplicado.nome_fantasia.endsWith(".") ? "" : "."} Use
                      o cadastro existente em vez de criar outro.
                    </span>
                  </span>
                  <Link
                    href={`/clientes/${cnpjDuplicado.id}`}
                    prefetch={false}
                    className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-[7px] border border-[#f2cd8a] bg-white px-[9px] py-[5px] text-[11.5px] font-semibold text-[#7c3d0a] transition-colors hover:bg-[#fef3c7]"
                  >
                    <UserCheck className="h-[13px] w-[13px]" />
                    Abrir cadastro existente
                  </Link>
                </div>
              )}
            </Campo>

            {/* E-mail principal + os adicionais */}
            <Campo
              label="E-mail"
              name="email"
              hint="Opcional"
              errors={fieldErrors}
              className="col-span-12 sm:col-span-7"
            >
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="contato@empresa.com"
                maxLength={200}
                className={cn(
                  emailPrincipalInvalido &&
                    "border-california-red ring-2 ring-california-red/[0.12]",
                )}
              />
              {emailsExtras.map((linha) => {
                const invalido =
                  linha.valor.trim() !== "" && !EMAIL_RE.test(linha.valor.trim());
                return (
                  <div key={linha.uid} className="flex items-center gap-2">
                    <Input
                      type="email"
                      value={linha.valor}
                      onChange={(e) =>
                        setEmailsExtras((atual) =>
                          atual.map((l) =>
                            l.uid === linha.uid
                              ? { ...l, valor: e.target.value }
                              : l,
                          ),
                        )
                      }
                      placeholder="Outro e-mail"
                      maxLength={200}
                      className={cn(
                        "min-w-0 flex-1",
                        invalido &&
                          "border-california-red ring-2 ring-california-red/[0.12]",
                      )}
                    />
                    <BotaoLinha
                      title="Remover e-mail"
                      onClick={() =>
                        setEmailsExtras((atual) =>
                          atual.filter((l) => l.uid !== linha.uid),
                        )
                      }
                    >
                      <X className="h-3.5 w-3.5" />
                    </BotaoLinha>
                  </div>
                );
              })}
              <button
                type="button"
                onClick={() =>
                  setEmailsExtras((atual) =>
                    atual.concat({ uid: novoUid(), valor: "" }),
                  )
                }
                className={LINK_ADICIONAR}
              >
                <Plus className="h-3 w-3" />
                Adicionar e-mail
              </button>
            </Campo>

            {/* Telefone principal + os adicionais */}
            <Campo
              label="Telefone"
              name="telefone"
              hint="Opcional"
              errors={fieldErrors}
              className="col-span-12 sm:col-span-5"
            >
              <MaskedInput
                mask="telefone"
                id="telefone"
                defaultValue={cliente?.telefone ?? ""}
                onDigitsChange={setTelefone}
                className={cn(
                  "tabular-nums",
                  telefonePrincipalInvalido &&
                    "border-california-red ring-2 ring-california-red/[0.12]",
                )}
              />
              {telefonesExtras.map((linha) => {
                const d = onlyDigits(linha.valor);
                const invalido = d !== "" && d.length !== 10 && d.length !== 11;
                return (
                  <div key={linha.uid} className="flex items-center gap-2">
                    <MaskedInput
                      mask="telefone"
                      defaultValue={linha.valor}
                      onDigitsChange={(digits) =>
                        setTelefonesExtras((atual) =>
                          atual.map((l) =>
                            l.uid === linha.uid ? { ...l, valor: digits } : l,
                          ),
                        )
                      }
                      placeholder="Outro telefone"
                      className={cn(
                        "min-w-0 flex-1 tabular-nums",
                        invalido &&
                          "border-california-red ring-2 ring-california-red/[0.12]",
                      )}
                    />
                    <BotaoLinha
                      title="Remover telefone"
                      onClick={() =>
                        setTelefonesExtras((atual) =>
                          atual.filter((l) => l.uid !== linha.uid),
                        )
                      }
                    >
                      <X className="h-3.5 w-3.5" />
                    </BotaoLinha>
                  </div>
                );
              })}
              <button
                type="button"
                onClick={() =>
                  setTelefonesExtras((atual) =>
                    atual.concat({ uid: novoUid(), valor: "" }),
                  )
                }
                className={LINK_ADICIONAR}
              >
                <Plus className="h-3 w-3" />
                Adicionar telefone
              </button>
            </Campo>
          </div>
        </Secao>

        <div className="h-px bg-border" />

        {/* ---------------------------------------------------------- */}
        {/* Marcas                                                      */}
        {/* ---------------------------------------------------------- */}
        <Secao
          titulo="Marcas"
          descricao={
            <>
              Cada marca vira uma opção no campo <strong>Marca</strong> do
              projeto.
            </>
          }
          selo="A principal é automática"
        >
          <div className="flex flex-col gap-2.5">
            {/* A principal: nasce com o cliente e acompanha o nome fantasia.
                O trigger `trg_cliente_produtos_padrao` a protege no banco. */}
            <div className="flex items-center gap-3 rounded-[10px] border border-border bg-[#FBFAF8] px-[13px] py-[11px]">
              <span className="flex-none rounded-md border border-border bg-white px-[7px] py-[3px] font-mono text-[11px] font-semibold tracking-[0.03em] text-muted-foreground">
                {marcaPrincipalSalva?.codigo ?? "PRD-01"}
              </span>
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-sm font-semibold",
                  nome.trim() ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {nomeMarcaPrincipal}
              </span>
              <span className="flex flex-none items-center gap-1.5 text-[11px] text-muted-foreground">
                <Lock className="h-3 w-3" />
                acompanha o nome fantasia
              </span>
            </div>

            {linhasMarca.map((linha, i) => (
              <div key={linha.uid} className="flex items-center gap-2.5">
                <span
                  className={cn(
                    "flex-none rounded-md border border-border bg-white px-[7px] py-[3px] font-mono text-[11px] font-semibold tracking-[0.03em]",
                    linha.ativo
                      ? "text-muted-foreground"
                      : "text-muted-foreground/60",
                  )}
                >
                  {linha.codigo ?? (isEdit ? "nova" : `PRD-${String(i + 2).padStart(2, "0")}`)}
                </span>
                <Input
                  value={linha.nome}
                  onChange={(e) =>
                    setLinhasMarca((atual) =>
                      atual.map((l) =>
                        l.uid === linha.uid ? { ...l, nome: e.target.value } : l,
                      ),
                    )
                  }
                  disabled={!linha.ativo}
                  placeholder="Nome da marca — ex.: Brahma"
                  maxLength={120}
                  className={cn(
                    "min-w-0 flex-1",
                    !linha.ativo && "bg-muted/40 text-muted-foreground",
                  )}
                />
                {linha.ativo ? (
                  <BotaoLinha
                    title={
                      linha.id
                        ? "Inativar marca — ela some do dropdown de novos projetos, mas continua nos jobs que já a usam"
                        : "Remover marca"
                    }
                    onClick={() =>
                      setLinhasMarca((atual) =>
                        linha.id
                          ? atual.map((l) =>
                              l.uid === linha.uid ? { ...l, ativo: false } : l,
                            )
                          : atual.filter((l) => l.uid !== linha.uid),
                      )
                    }
                  >
                    <X className="h-3.5 w-3.5" />
                  </BotaoLinha>
                ) : (
                  <BotaoLinha
                    title="Reativar marca"
                    onClick={() =>
                      setLinhasMarca((atual) =>
                        atual.map((l) =>
                          l.uid === linha.uid ? { ...l, ativo: true } : l,
                        ),
                      )
                    }
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </BotaoLinha>
                )}
              </div>
            ))}

            <button
              type="button"
              onClick={() =>
                setLinhasMarca((atual) =>
                  atual.concat({ uid: novoUid(), nome: "", ativo: true }),
                )
              }
              className={BOTAO_ADICIONAR}
            >
              <Plus className="h-3.5 w-3.5 text-california-red" />
              Adicionar marca
            </button>
          </div>
        </Secao>

        <div className="h-px bg-border" />

        {/* ---------------------------------------------------------- */}
        {/* Portais de fornecedor                                       */}
        {/* ---------------------------------------------------------- */}
        <Secao
          titulo="Portais de fornecedor"
          descricao="Onde a nota deste cliente é lançada. Aparecem no envio do job para faturamento — um cliente pode ter mais de um."
          selo="Opcional"
        >
          <div className="flex flex-col gap-2.5">
            {linhasPortal.map((linha) => (
              <div
                key={linha.uid}
                className="grid grid-cols-[minmax(0,5fr)_minmax(0,7fr)_34px] items-center gap-2.5"
              >
                <Input
                  value={linha.nome}
                  onChange={(e) =>
                    setLinhasPortal((atual) =>
                      atual.map((l) =>
                        l.uid === linha.uid ? { ...l, nome: e.target.value } : l,
                      ),
                    )
                  }
                  disabled={!linha.ativo}
                  placeholder="Nome — ex.: Coupa"
                  maxLength={80}
                  className={cn(
                    !linha.ativo && "bg-muted/40 text-muted-foreground",
                  )}
                />
                <Input
                  value={linha.url}
                  onChange={(e) =>
                    setLinhasPortal((atual) =>
                      atual.map((l) =>
                        l.uid === linha.uid ? { ...l, url: e.target.value } : l,
                      ),
                    )
                  }
                  disabled={!linha.ativo}
                  placeholder="https://…"
                  maxLength={500}
                  className={cn(
                    !linha.ativo && "bg-muted/40 text-muted-foreground",
                  )}
                />
                {linha.ativo ? (
                  <BotaoLinha
                    title={
                      linha.id
                        ? "Inativar portal — some do envio de novos jobs, mas os envios já feitos continuam apontando para ele"
                        : "Remover portal"
                    }
                    onClick={() =>
                      setLinhasPortal((atual) =>
                        linha.id
                          ? atual.map((l) =>
                              l.uid === linha.uid ? { ...l, ativo: false } : l,
                            )
                          : atual.filter((l) => l.uid !== linha.uid),
                      )
                    }
                  >
                    <X className="h-3.5 w-3.5" />
                  </BotaoLinha>
                ) : (
                  <BotaoLinha
                    title="Reativar portal"
                    onClick={() =>
                      setLinhasPortal((atual) =>
                        atual.map((l) =>
                          l.uid === linha.uid ? { ...l, ativo: true } : l,
                        ),
                      )
                    }
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </BotaoLinha>
                )}
              </div>
            ))}

            <button
              type="button"
              onClick={() =>
                setLinhasPortal((atual) =>
                  atual.concat({
                    uid: novoUid(),
                    nome: "",
                    url: "",
                    ativo: true,
                  }),
                )
              }
              className={BOTAO_ADICIONAR}
            >
              <Plus className="h-3.5 w-3.5 text-california-red" />
              Adicionar portal
            </button>
          </div>
        </Secao>

        <div className="h-px bg-border" />

        {/* ---------------------------------------------------------- */}
        {/* Honorários                                                  */}
        {/* ---------------------------------------------------------- */}
        <Secao
          titulo="Honorários"
          descricao="Toda versão de orçamento deste cliente nasce com o percentual já preenchido e travado."
          selo="Obrigatório"
        >
          <div className="grid grid-cols-12 gap-4">
            <Campo
              label="Percentual padrão"
              name="percentual_honorarios_padrao"
              required
              errors={fieldErrors}
              className="col-span-12 sm:col-span-4"
            >
              <div className="flex h-11 items-center overflow-hidden rounded-lg border border-border bg-white transition-colors focus-within:border-california-red focus-within:ring-2 focus-within:ring-california-red/15 hover:border-california-red/40">
                <input
                  id="percentual_honorarios_padrao"
                  inputMode="decimal"
                  value={honorarios}
                  onChange={(e) => setHonorarios(e.target.value)}
                  className="h-full min-w-0 flex-1 border-0 bg-transparent py-2 pl-3.5 pr-1 text-sm tabular-nums text-foreground outline-none"
                />
                <span className="flex-none border-l border-border px-3 text-[13px] leading-[42px] text-muted-foreground">
                  %
                </span>
              </div>
              <span className="text-[11px] leading-relaxed text-muted-foreground">
                Alterar aqui não muda orçamentos que já existem.
              </span>
            </Campo>
          </div>
        </Secao>

        <div className="h-px bg-border" />

        {/* ---------------------------------------------------------- */}
        {/* Observações                                                 */}
        {/* ---------------------------------------------------------- */}
        <Secao
          titulo="Observações"
          descricao="Contato-chave, particularidades da conta, o que a equipe precisa saber."
          selo="Opcional"
        >
          <Textarea
            name="observacoes"
            defaultValue={cliente?.observacoes ?? ""}
            rows={4}
            placeholder="Ex.: aprovações passam pelo jurídico; faturamento sempre no dia 25."
          />
        </Secao>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ------------------------------------------------------------ */}
      {/* Rodapé: o que falta, e os dois botões                         */}
      {/* ------------------------------------------------------------ */}
      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-4 rounded-t-2xl border border-b-0 border-border bg-white/95 px-5 py-3.5 shadow-[0_-4px_16px_-8px_rgba(0,0,0,.12)] backdrop-blur">
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

        <div className="flex flex-none items-center gap-2.5">
          <Link
            href="/clientes"
            prefetch={false}
            className="rounded-lg border border-border bg-white px-[18px] py-2.5 text-[13.5px] font-semibold text-foreground transition-colors hover:bg-accent"
          >
            Cancelar
          </Link>
          <button
            type="submit"
            disabled={pending || !pronto}
            title={pronto ? undefined : textoValidacao}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg bg-california-red px-[18px] py-2.5 text-[13.5px] font-semibold text-white transition-all",
              pronto && !pending
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
                <Save className="h-[15px] w-[15px]" />
                {rotuloSalvar}
              </>
            )}
          </button>
        </div>
      </div>
    </form>
  );
}
