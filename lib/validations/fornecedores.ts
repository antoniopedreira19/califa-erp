import { z } from "zod";
import { isValidCnpj, isValidCpf, onlyDigits } from "@/lib/utils";
import { problemaDaChavePix } from "@/lib/pix";
import { getBancoByCodigo } from "@/lib/dados/bancos-febraban";

/**
 * Schema de fornecedor (PF ou PJ).
 *
 * O que o cadastro EXIGE (decisões do Tiago em 09/09/2026, junto do
 * desenho novo do formulário — "Fornecedores - Novo Cadastro"):
 *
 *   1. **nome**, **documento** (CPF ou CNPJ), **e-mail** e **telefone**.
 *      Os três últimos eram exigidos só no cadastro rápido de dentro da
 *      PP (decisão 048) e agora valem para os dois caminhos: o documento
 *      é a chave que impede cadastro repetido, e e-mail e telefone são o
 *      que o financeiro usa para cobrar a nota.
 *   2. **Um bloco de pagamento completo**, banco OU PIX. Bloco começado e
 *      não terminado continua inválido, nos dois casos.
 *
 * O que ficou OPCIONAL: o **endereço** inteiro. Ele era obrigatório e
 * travava o cadastro de quem só tinha os dados de pagamento à mão; segue
 * validado quando preenchido (CEP com 8 dígitos, UF da lista), e o
 * formulário o mantém recolhido até alguém pedir.
 *
 * Módulo fiscal (02/10/2026): o **regime tributário** da pessoa jurídica
 * (normal, Simples ou MEI), opcional, com a data da consulta do CNPJ que o
 * deu e, no Simples, a declaração de optante (IN SRF 459). Pessoa física
 * não tem regime; a declaração só vale no Simples; a data da consulta só
 * acompanha um regime — o `transform` do fim acerta isso no servidor,
 * venha o que vier da tela.
 *
 * Decisão 142 (02/10/2026): a consulta do CNPJ vai inteira — o regime que
 * ela indicou, desde quando (Simples e MEI) e o dia —, valha ou não o
 * regime escolhido. E o arquivo da declaração: o caminho no bucket
 * `fornecedores`, que a action confere ser da pasta do tenant. Trocar o
 * regime não tira o arquivo do cadastro; só o ✕ do formulário tira.
 */

const UFS_BRASIL = [
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG",
  "PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO",
] as const;

const nullIfEmpty = (v: unknown) =>
  typeof v === "string" && v.trim().length === 0 ? null : v;

export const fornecedorSchema = z
  .object({
    // === campos existentes ===
    tipo_pessoa: z.enum(["fisica", "juridica"]),
    nome: z.string().trim().min(2, "Informe o nome (mín. 2 caracteres).").max(200),
    razao_social: z.preprocess(nullIfEmpty, z.string().trim().max(200).nullable().optional()),
    // Os três obrigatórios desde 09/09/2026 — o tamanho e o dígito
    // verificador do documento continuam sendo conferidos no superRefine,
    // contra o tipo de pessoa.
    cpf_cnpj: z.preprocess(
      (v) => (typeof v === "string" ? onlyDigits(v) : v),
      z.string().min(1, "Documento obrigatório."),
    ),
    email: z
      .string({ required_error: "E-mail obrigatório." })
      .trim()
      .min(1, "E-mail obrigatório.")
      .max(200)
      .refine(
        (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
        "E-mail inválido.",
      ),
    telefone: z.preprocess(
      (v) => (typeof v === "string" ? onlyDigits(v) : v),
      z.string().min(1, "Telefone obrigatório."),
    ).refine(
      (v) => v.length === 10 || v.length === 11,
      "Telefone deve ter 10 ou 11 dígitos.",
    ),
    observacoes: z.preprocess(nullIfEmpty, z.string().trim().max(2000).nullable().optional()),

    // === endereço (opcional desde 09/09/2026; formato ainda vale) ===
    // As seis colunas já eram `null`-áveis no banco: o que travava o
    // cadastro era só esta validação.
    cep: z.preprocess(
      (v) => (typeof v === "string" ? onlyDigits(v) : v),
      z.string().nullable().optional().transform((v) => (v ? v : null)),
    ).refine((v) => v == null || /^[0-9]{8}$/.test(v), "CEP deve ter 8 dígitos."),
    logradouro: z.preprocess(nullIfEmpty, z.string().trim().max(200).nullable().optional()),
    numero: z.preprocess(nullIfEmpty, z.string().trim().max(20).nullable().optional()),
    complemento: z.preprocess(nullIfEmpty, z.string().trim().max(100).nullable().optional()),
    bairro: z.preprocess(nullIfEmpty, z.string().trim().max(100).nullable().optional()),
    cidade: z.preprocess(nullIfEmpty, z.string().trim().max(100).nullable().optional()),
    uf: z.preprocess(
      nullIfEmpty,
      z.enum(UFS_BRASIL, { errorMap: () => ({ message: "UF inválida." }) })
        .nullable()
        .optional(),
    ),

    // === banco (todos opcionais individualmente; coerência no superRefine) ===
    banco_codigo: z.preprocess(nullIfEmpty, z.string().nullable().optional()),
    agencia: z.preprocess(
      (v) => (typeof v === "string" ? onlyDigits(v) : v),
      z.string().nullable().optional().transform((v) => (v ? v : null)),
    ),
    // Os dois dígitos vão em maiúscula ("x" vira "X"): é o que a CHECK do
    // banco aceita e o que o gerador da remessa espera.
    agencia_dv: z.preprocess(
      nullIfEmpty,
      z.string().trim().max(1).toUpperCase().nullable().optional(),
    ),
    conta: z.preprocess(
      (v) => (typeof v === "string" ? onlyDigits(v) : v),
      z.string().nullable().optional().transform((v) => (v ? v : null)),
    ),
    conta_dv: z.preprocess(
      nullIfEmpty,
      z.string().trim().max(1).toUpperCase().nullable().optional(),
    ),
    // `nullIfEmpty` nos dois enums (04/09/2026): o <select> vazio manda "",
    // e o enum recusava com "Invalid enum value" — o bloco não preenchido
    // (banco sem PIX, ou PIX sem banco) nunca passava pela validação.
    tipo_conta: z.preprocess(
      nullIfEmpty,
      z.enum(["corrente", "poupanca", "pagamento"]).nullable().optional(),
    ),

    // === PIX (opcional individualmente; coerência no superRefine) ===
    pix_tipo: z.preprocess(
      nullIfEmpty,
      z.enum(["cpf", "cnpj", "email", "telefone", "aleatoria"]).nullable().optional(),
    ),
    pix_chave: z.preprocess(nullIfEmpty, z.string().nullable().optional()),

    // === módulo fiscal (02/10/2026): regime tributário da pessoa jurídica ===
    regime_tributario: z.preprocess(
      nullIfEmpty,
      z.enum(["normal", "simples", "mei"], {
        errorMap: () => ({ message: "Regime tributário inválido." }),
      })
        .nullable()
        .optional(),
    ),
    regime_consultado_em: z.preprocess(
      nullIfEmpty,
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Data da consulta do CNPJ inválida.")
        .nullable()
        .optional(),
    ),
    // Decisão 142: o que a consulta do CNPJ indicou, e desde quando.
    regime_consulta: z.preprocess(
      nullIfEmpty,
      z.enum(["normal", "simples", "mei"], {
        errorMap: () => ({ message: "Regime indicado pela consulta do CNPJ inválido." }),
      })
        .nullable()
        .optional(),
    ),
    regime_desde: z.preprocess(
      nullIfEmpty,
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Data de opção pelo Simples ou pelo MEI inválida.")
        .nullable()
        .optional(),
    ),
    // O formulário manda "true"/"false"; ausente vale como não recebida.
    declaracao_simples_recebida: z.preprocess(
      (v) => v === true || v === "true",
      z.boolean(),
    ),
    // O arquivo da declaração (decisão 142): "" tira o arquivo; AUSENTE não
    // mexe nele (`undefined` some do update) — quem não manda o campo não
    // tira o arquivo de ninguém.
    declaracao_simples_path: z.preprocess(
      (v) => (v === null || v === undefined ? undefined : nullIfEmpty(v)),
      z.string().trim().min(1).max(500).nullable().optional(),
    ),
  })
  .superRefine((data, ctx) => {
    // --- Documento do fornecedor (CPF/CNPJ) ---
    if (data.cpf_cnpj) {
      if (data.tipo_pessoa === "fisica") {
        if (data.cpf_cnpj.length !== 11 || !isValidCpf(data.cpf_cnpj)) {
          ctx.addIssue({ code: "custom", path: ["cpf_cnpj"], message: "CPF inválido." });
        }
      } else {
        if (data.cpf_cnpj.length !== 14 || !isValidCnpj(data.cpf_cnpj)) {
          ctx.addIssue({ code: "custom", path: ["cpf_cnpj"], message: "CNPJ inválido." });
        }
      }
    }

    // --- Banco tradicional: se qualquer campo, todos os obrigatórios ---
    const bancoParcial =
      data.banco_codigo || data.agencia || data.agencia_dv || data.conta || data.conta_dv || data.tipo_conta;
    const bancoCompleto =
      data.banco_codigo && data.agencia && data.conta && data.conta_dv && data.tipo_conta;

    if (bancoParcial && !bancoCompleto) {
      if (!data.banco_codigo) ctx.addIssue({ code: "custom", path: ["banco_codigo"], message: "Selecione o banco." });
      if (!data.agencia)      ctx.addIssue({ code: "custom", path: ["agencia"],      message: "Agência obrigatória." });
      if (!data.conta)        ctx.addIssue({ code: "custom", path: ["conta"],        message: "Conta obrigatória." });
      if (!data.conta_dv)     ctx.addIssue({ code: "custom", path: ["conta_dv"],     message: "Dígito da conta obrigatório." });
      if (!data.tipo_conta)   ctx.addIssue({ code: "custom", path: ["tipo_conta"],   message: "Tipo de conta obrigatório." });
    }
    if (data.banco_codigo && !getBancoByCodigo(data.banco_codigo)) {
      ctx.addIssue({ code: "custom", path: ["banco_codigo"], message: "Banco inválido." });
    }
    if (data.agencia && !/^[0-9]{3,5}$/.test(data.agencia)) {
      ctx.addIssue({ code: "custom", path: ["agencia"], message: "Agência deve ter 3 a 5 dígitos." });
    }
    if (data.agencia_dv && !/^[0-9X]$/.test(data.agencia_dv)) {
      ctx.addIssue({ code: "custom", path: ["agencia_dv"], message: "Dígito da agência inválido." });
    }
    if (data.conta && !/^[0-9]{4,12}$/.test(data.conta)) {
      ctx.addIssue({ code: "custom", path: ["conta"], message: "Conta deve ter 4 a 12 dígitos." });
    }
    if (data.conta_dv && !/^[0-9X]$/.test(data.conta_dv)) {
      ctx.addIssue({ code: "custom", path: ["conta_dv"], message: "Dígito da conta inválido." });
    }

    // --- PIX: se qualquer campo, os dois; e chave coerente com o tipo ---
    const pixParcial = data.pix_tipo || data.pix_chave;
    const pixCompleto = data.pix_tipo && data.pix_chave;

    if (pixParcial && !pixCompleto) {
      if (!data.pix_tipo)  ctx.addIssue({ code: "custom", path: ["pix_tipo"],  message: "Tipo de chave obrigatório." });
      if (!data.pix_chave) ctx.addIssue({ code: "custom", path: ["pix_chave"], message: "Chave PIX obrigatória." });
    }

    // A chave tem de sair no arquivo de remessa do jeito que o banco
    // aceita — a régua é a mesma do cadastro de colaborador e da geração
    // da remessa (`problemaDaChavePix`, 23/09/2026).
    if (data.pix_tipo && data.pix_chave) {
      const problema = problemaDaChavePix(data.pix_tipo, data.pix_chave);
      if (problema)
        ctx.addIssue({ code: "custom", path: ["pix_chave"], message: problema });
    }

    // --- Regra final: pelo menos um bloco de pagamento completo ---
    // Só dispara quando nenhum bloco foi sequer iniciado. Quando o usuário
    // começou mas não terminou um bloco, os erros de campo parcial já guiam.
    if (!bancoParcial && !pixParcial) {
      ctx.addIssue({
        code: "custom",
        path: ["banco_codigo"],
        message: "Preencha os dados bancários OU o PIX (pelo menos um).",
      });
    }
  })
  .transform((data) => {
    // Módulo fiscal: pessoa física não tem regime; a consulta do CNPJ só
    // acompanha um regime; a declaração de optante só vale no Simples
    // (marcada e depois trocada de regime, não fica gravada).
    const regime = data.tipo_pessoa === "juridica" ? data.regime_tributario ?? null : null;
    // Decisão 142: a consulta vai inteira — o regime indicado, o dia e, no
    // Simples e no MEI, desde quando — ou não vai. Vale com o regime
    // escolhido sendo o indicado ou não: é o que mantém o aviso de
    // "alterado manualmente" depois de salvar.
    const indicou = regime && data.regime_consultado_em ? data.regime_consulta ?? null : null;
    return {
      ...data,
      regime_tributario: regime,
      regime_consulta: indicou,
      regime_consultado_em: indicou ? data.regime_consultado_em ?? null : null,
      regime_desde: indicou === "simples" || indicou === "mei" ? data.regime_desde ?? null : null,
      declaracao_simples_recebida: regime === "simples" && data.declaracao_simples_recebida,
      // O arquivo fica com o cadastro mesmo fora do Simples: trocar o
      // regime não o tira; só o ✕ do formulário tira.
      declaracao_simples_path: data.declaracao_simples_path,
    };
  });

export type FornecedorInput = z.infer<typeof fornecedorSchema>;

/**
 * O cadastro rápido de dentro da PP (04/09/2026, decisão 048).
 *
 * Ele existia para exigir três campos a mais que o cadastro pela página:
 * documento, e-mail e telefone. Desde 09/09/2026 esses três são
 * obrigatórios no schema base, e os dois caminhos passaram a ter a mesma
 * régua — o alias continua exportado porque é o nome que as actions do
 * cadastro rápido usam, e porque ele diz de onde a exigência veio.
 */
export const fornecedorCompletoSchema = fornecedorSchema;
