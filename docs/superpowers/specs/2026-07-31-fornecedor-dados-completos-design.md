# Cadastro completo de fornecedor — endereço, dados bancários e PIX

**Data:** 2026-07-31
**Escopo:** expandir o cadastro de fornecedor para incluir endereço estruturado, dados bancários e chave PIX, de forma que o financeiro tenha tudo o que precisa para efetuar pagamentos sem sair do sistema.

---

## 1. Motivação

Hoje o form de fornecedor em `app/(app)/fornecedores/fornecedor-form.tsx` só coleta identificação básica (nome, razão social, CPF/CNPJ, e-mail, telefone, observações). Todo dado necessário para pagar o prestador (banco, agência, conta, chave PIX, endereço) fica no campo `observacoes` como texto solto, ou fora do sistema.

As imagens de referência (extratos de dados bancários e dados cadastrais de fornecedor) mostram o padrão que a Agência California usa hoje em documentos externos. A intenção é trazer esse padrão para dentro do ERP, com dado estruturado.

## 2. Decisões travadas na brainstorming

| Decisão | Escolha |
|---|---|
| Nº de contas bancárias por fornecedor | Uma só (colunas diretas em `fornecedores`, sem tabela auxiliar) |
| Modelo de endereço | Campos separados + auto-completar via ViaCEP |
| Titular da conta | Sempre = fornecedor (sem campos separados de titular) |
| Entrada do banco | Combobox com busca sobre lista hardcoded (FEBRABAN) |
| Fonte da lista de bancos | Hardcode em `lib/dados/bancos-febraban.ts` + script `scripts/atualizar-bancos-febraban.ts` para regenerar via BrasilAPI |
| Obrigatoriedade | Só no Zod (não `NOT NULL` no banco). Fornecedores existentes seguem válidos; badge "Dados incompletos" na lista. |
| Complemento de endereço | Opcional (mesmo com "tudo obrigatório") |
| Layout do form | Opção A — cards seccionados no mesmo scroll + botão de submit sticky |
| PIX duplicado | Sem UNIQUE no banco; warning suave no form quando outro fornecedor já tem a mesma chave |
| Banco tradicional vs PIX | Pelo menos um dos dois blocos completo (banco+agência+conta+tipo_conta OU pix_tipo+pix_chave) |

## 3. Modelagem do banco

Nova migration: `supabase/migrations/20260731000001_fornecedor_dados_completos.sql`.

### 3.1 Novas colunas em `fornecedores`

Todas nascem `NULL` (sem backfill, sem quebra de linhas existentes).

**Endereço:**
- `cep` text — CHECK `cep IS NULL OR cep ~ '^[0-9]{8}$'`
- `logradouro` text
- `numero` text (é texto: aceita "s/n", "1234-A")
- `complemento` text
- `bairro` text
- `cidade` text (livre — endereço de fornecedor pode ser qualquer cidade do BR; não usar FK para `cidades`, que é curada por tenant)
- `uf` char(2) — CHECK contra lista fechada de 27 UFs

**Dados bancários:**
- `banco_codigo` text — CHECK `banco_codigo IS NULL OR banco_codigo ~ '^[0-9]{3}$'`
- `banco_nome` text (redundante para exibição rápida; fonte-verdade é a lista hardcoded)
- `agencia` text — CHECK só dígitos, 3-5 chars
- `agencia_dv` text — CHECK 1 char, dígito ou X
- `conta` text — CHECK só dígitos, 4-12 chars
- `conta_dv` text — CHECK 1 char, dígito ou X
- `tipo_conta` novo enum `public.tipo_conta_bancaria` = `('corrente','poupanca','pagamento')`

**PIX:**
- `pix_tipo` novo enum `public.pix_tipo_chave` = `('cpf','cnpj','email','telefone','aleatoria')`
- `pix_chave` text — sem CHECK de formato no banco (o formato depende do `pix_tipo`; validação fica no Zod para não duplicar lógica)

### 3.2 Enums

```sql
do $$
begin
  if not exists (select 1 from pg_type where typname = 'tipo_conta_bancaria') then
    create type public.tipo_conta_bancaria as enum ('corrente','poupanca','pagamento');
  end if;
  if not exists (select 1 from pg_type where typname = 'pix_tipo_chave') then
    create type public.pix_tipo_chave as enum ('cpf','cnpj','email','telefone','aleatoria');
  end if;
end$$;
```

### 3.3 Sem UNIQUE em `pix_chave`

Não haverá `UNIQUE (tenant_id, pix_chave)`. Duplicidade é tratada por warning no form (ver seção 5.5).

### 3.4 Sem novos GRANTs / policies

RLS e GRANTs de `fornecedores` já cobrem `SELECT/INSERT/UPDATE` para `authenticated` (migration `20260722000001`). Adicionar colunas não muda nada aí. Confirmar isso em revisão da migration.

### 3.5 Sem novos índices

Nenhuma coluna nova é filtro de query hoje. Índices adicionais só quando surgir consulta real.

## 4. Frontend — organização do form

### 4.1 Layout (Opção A aprovada)

Cinco seções em cards separados, mesmo scroll. Botão de submit fica sticky no rodapé (`sticky bottom-0`) durante o scroll, para o operador não precisar rolar até o fim para salvar.

```
┌─ Identificação ─────────────────────────────────┐
│ [PJ|PF]  Nome fantasia*  Razão social           │
│ CNPJ*    E-mail*  Telefone*                     │
└─────────────────────────────────────────────────┘

┌─ Endereço ──────────────────────────────────────┐
│ CEP*         [busca no ViaCEP ao sair]          │
│ Logradouro*                        Número*      │
│ Complemento    Bairro*                          │
│ Cidade*                            UF*          │
└─────────────────────────────────────────────────┘

┌─ Dados bancários (banco tradicional OU PIX) ────┐
│ Banco* [combobox]                               │
│ Agência*  DV   Conta*  DV*    Tipo de conta*    │
└─────────────────────────────────────────────────┘

┌─ PIX ───────────────────────────────────────────┐
│ Tipo de chave*    Chave PIX*                    │
└─────────────────────────────────────────────────┘

┌─ Observações ───────────────────────────────────┐
│ [textarea grande]                               │
└─────────────────────────────────────────────────┘

           [Cancelar]  [Criar/Salvar fornecedor]  ← sticky
```

Cada seção é um `<section>` com header (`<h3>`) dentro do card branco atual. Erros de validação rolam a página até o primeiro campo com erro via `element.scrollIntoView({ behavior: "smooth", block: "center" })`.

### 4.2 Comportamento PF/PJ

Toggle no topo continua funcionando como hoje:
- PF: esconde "Razão social", label vira "CPF" e "Nome" (não "Nome fantasia").
- PJ: mostra tudo.

Todos os outros campos (endereço, banco, PIX) aparecem para PF e PJ.

### 4.3 Endereço + ViaCEP

- Máscara de CEP `00000-000` no `MaskedInput` (adicionar novo tipo `cep`).
- `onBlur` do CEP: se tem 8 dígitos, dispara `fetch('https://viacep.com.br/ws/{cep}/json/')` com `AbortController` (timeout 3s).
- Spinner pequeno no canto do campo enquanto carrega.
- Sucesso: preenche `logradouro`, `bairro`, `cidade`, `uf` — apenas se estiverem vazios (não sobrescreve edição do usuário).
- Falha (`{erro: true}`, timeout, network): mensagem sutil abaixo do CEP "CEP não encontrado, preencha manualmente". Nunca bloqueia submit.
- Se CEP é apagado, não limpa os campos preenchidos.

### 4.4 Combobox de banco

Novo componente `components/ui/combobox.tsx`:
- API genérica: `<Combobox items={{value, label}[]} value onChange placeholder />`.
- Popover + Input com filtro `includes` case-insensitive sobre `label`.
- Sem virtualização por enquanto — 200 itens renderizam em <16ms; adicionar `react-window` se der problema.
- Segue a regra do memory (Radix gotcha): `side="bottom" avoidCollisions={false}` e largura fixa.
- Sem dependência nova (`cmdk` fica para o dia que aparecer uso pra combobox em ≥3 lugares).

Uso no form:
```tsx
<Combobox
  items={BANCOS_FEBRABAN.map(b => ({ value: b.codigo, label: `${b.codigo} - ${b.nome}` }))}
  value={bancoCodigo}
  onChange={setBancoCodigo}
  placeholder="Selecione o banco"
/>
```

### 4.5 PIX

- `pix_tipo` é um `<select>` (só 5 opções, não precisa combobox).
- Ao mudar o tipo:
  - `cpf` / `cnpj`: se `fornecedor.cpf_cnpj` está preenchido, mostra botão "Usar do cadastro" que copia o valor. Máscara CPF/CNPJ ativa.
  - `telefone`: máscara telefone.
  - `email`: input normal com `type="email"`.
  - `aleatoria`: input livre, 32-36 chars.
- Ao terminar de digitar a chave (debounce 500ms), consulta `verificarPixDuplicado(chave)` (server action leve, ver 5.5) — se retorna nome de outro fornecedor, mostra warning amarelo.

## 5. Validação e camada server

### 5.1 Zod schema (`lib/validations/fornecedores.ts`)

Expandir o schema existente. Novos campos com validação individual + `superRefine` cruzando blocos:

```ts
// pseudocódigo simplificado
const fornecedorSchema = z.object({
  // ...campos existentes...
  cep: z.string().transform(onlyDigits).refine(v => /^[0-9]{8}$/.test(v), "CEP inválido"),
  logradouro: z.string().trim().min(1, "Logradouro obrigatório"),
  numero: z.string().trim().min(1, "Número obrigatório"),
  complemento: z.string().trim().max(100).optional().transform(nullIfEmpty),
  bairro: z.string().trim().min(1, "Bairro obrigatório"),
  cidade: z.string().trim().min(1, "Cidade obrigatória"),
  uf: z.enum(UFS_BRASIL),

  banco_codigo: z.string().optional().transform(nullIfEmpty),
  agencia: z.string().optional().transform(v => v ? onlyDigits(v) : null),
  agencia_dv: z.string().optional().transform(nullIfEmpty),
  conta: z.string().optional().transform(v => v ? onlyDigits(v) : null),
  conta_dv: z.string().optional().transform(nullIfEmpty),
  tipo_conta: z.enum(['corrente','poupanca','pagamento']).optional().nullable(),

  pix_tipo: z.enum(['cpf','cnpj','email','telefone','aleatoria']).optional().nullable(),
  pix_chave: z.string().optional().transform(nullIfEmpty),
}).superRefine((data, ctx) => {
  // Regra "banco tradicional OU PIX"
  const temBanco = !!(data.banco_codigo && data.agencia && data.conta && data.conta_dv && data.tipo_conta);
  const temPix = !!(data.pix_tipo && data.pix_chave);
  if (!temBanco && !temPix) {
    ctx.addIssue({ code: 'custom', path: ['banco_codigo'],
      message: "Preencha os dados bancários completos OU o PIX (pelo menos um)." });
  }

  // Se banco parcialmente preenchido, tudo do bloco deve estar
  if (data.banco_codigo || data.agencia || data.conta) {
    ['banco_codigo','agencia','conta','conta_dv','tipo_conta'].forEach(campo => {
      if (!data[campo]) ctx.addIssue({ code: 'custom', path: [campo],
        message: "Preencha todos os campos bancários ou nenhum." });
    });
    // banco_codigo deve existir na lista
    if (data.banco_codigo && !getBancoByCodigo(data.banco_codigo)) {
      ctx.addIssue({ code: 'custom', path: ['banco_codigo'],
        message: "Banco inválido." });
    }
  }

  // Se PIX parcialmente preenchido, os dois campos devem estar
  if (data.pix_tipo || data.pix_chave) {
    if (!data.pix_tipo) ctx.addIssue({ code: 'custom', path: ['pix_tipo'], message: "Tipo obrigatório." });
    if (!data.pix_chave) ctx.addIssue({ code: 'custom', path: ['pix_chave'], message: "Chave obrigatória." });

    // Formato da chave coerente com o tipo
    if (data.pix_tipo === 'cpf' && !isValidCpf(onlyDigits(data.pix_chave)))
      ctx.addIssue({ code: 'custom', path: ['pix_chave'], message: "CPF inválido." });
    // ...idem para cnpj, email, telefone, aleatoria...
  }
});
```

### 5.2 Server action (`app/(app)/fornecedores/actions.ts`)

- `criarFornecedor` e `atualizarFornecedor` já existem. Estender para receber os novos campos.
- Antes do insert/update, derivar `banco_nome` do `banco_codigo` via helper: `input.banco_nome = getBancoByCodigo(input.banco_codigo)?.nome ?? null`. Se `banco_codigo` está preenchido mas o helper retorna `null`, retorna `ActionResult` de erro (defesa em profundidade — o Zod já pegou, mas se lista dessincronizar de client, o server trava).
- Normalização de PIX antes de gravar:
  - `cpf`, `cnpj`, `telefone` → `onlyDigits`.
  - `email` → `.trim().toLowerCase()`.
  - `aleatoria` → `.trim().toLowerCase()` (UUID sem case).
- `log_audit_event` continua sendo chamado (regra do projeto).

### 5.3 Lista de bancos (`lib/dados/bancos-febraban.ts`)

```ts
// Snapshot FEBRABAN em 2026-07-31 — regenerar via `npm run atualizar:bancos`
export const BANCOS_FEBRABAN = [
  { codigo: "001", nome: "Banco do Brasil S.A." },
  { codigo: "033", nome: "Banco Santander (Brasil) S.A." },
  { codigo: "104", nome: "Caixa Econômica Federal" },
  { codigo: "237", nome: "Banco Bradesco S.A." },
  { codigo: "260", nome: "Nu Pagamentos S.A." },
  { codigo: "341", nome: "Itaú Unibanco S.A." },
  // ... ~200 entradas
] as const;

export function getBancoByCodigo(codigo: string) {
  return BANCOS_FEBRABAN.find(b => b.codigo === codigo) ?? null;
}
```

### 5.4 Script de atualização (`scripts/atualizar-bancos-febraban.ts`)

Script Node standalone:
- `fetch('https://brasilapi.com.br/api/banks/v1')`.
- Filtra os que têm `code` (número) e `name`, formata `codigo` com 3 dígitos (`String(code).padStart(3,'0')`).
- Ordena por `codigo`.
- Reescreve `lib/dados/bancos-febraban.ts` com o novo array + comentário `// Snapshot FEBRABAN em YYYY-MM-DD`.
- Roda com `tsx scripts/atualizar-bancos-febraban.ts` — adicionar `"atualizar:bancos": "tsx scripts/atualizar-bancos-febraban.ts"` no `package.json`.

Verificar se `tsx` já está no `devDependencies`; se não, decidir entre adicionar `tsx` ou usar `node --loader ts-node/esm`. Preferência: `tsx` (mais simples, já é padrão de scripts Node/TS em 2026).

### 5.5 Warning de PIX duplicado

Nova server action leve: `verificarPixDuplicado(chave: string, excludeId?: string)`.
- Query: `select id, nome from fornecedores where tenant_id = ? and pix_chave = ? and (id != ? or ? is null) and status = 'ativo' limit 1`.
- Retorna `{ existe: true, nome, id } | { existe: false }`.
- Chamada do form com debounce 500ms após terminar de digitar.
- UI: alerta amarelo abaixo do campo — `⚠ Já existe fornecedor com esta chave PIX: "João Silva Filmes". Confirme se está correto.` Não bloqueia submit.

## 6. Lista de fornecedores — badge de incompleto

Em `app/(app)/fornecedores/fornecedores-list.tsx`, adicionar badge cinza ao lado do nome quando o fornecedor não tem dados suficientes para pagamento: `cep IS NULL OR (banco_codigo IS NULL AND pix_chave IS NULL)`.

Badge: `<Badge variant="outline" className="text-amber-700 border-amber-300">Dados incompletos</Badge>`.

Isso serve como sinal visual para o operador ir completando cadastros antigos ao longo do tempo. Sem obrigar backfill.

## 7. Edge cases tratados

1. **CEP genérico (retorna sem logradouro):** ViaCEP às vezes retorna só cidade/UF. Form aceita — usuário digita logradouro manualmente.
2. **Cidade retornada pelo ViaCEP com formatação estranha:** confia no ViaCEP; usuário pode editar.
3. **PJ que só tem PIX:** cobre pela regra "banco OU PIX" (seção 5.1).
4. **Fornecedor antigo (sem dados novos):** fica no banco com colunas novas `NULL`. Badge "Dados incompletos" na lista. Ao editar, form exige dados completos.
5. **Combobox com banco inválido via API direta:** Zod refina contra a lista; server ainda revalida via `getBancoByCodigo`.
6. **PIX aleatória com hífen ou sem:** normalização remove hífens e faz lowercase antes de gravar.
7. **ViaCEP fora do ar:** timeout de 3s, mensagem de fallback, submit não é bloqueado.

## 8. Fora de escopo

- Múltiplas contas bancárias por fornecedor (fica pra quando surgir demanda real).
- Titular da conta diferente do fornecedor (mesma justificativa).
- Cadastro em massa de fornecedores por planilha.
- Integração com API bancária para validar agência/conta (custa e não agrega no MVP).
- Consulta CNPJ na Receita Federal para autocompletar razão social/endereço (útil, mas fase futura).
- Backfill dos fornecedores existentes.

## 9. Arquivos afetados

**Novos:**
- `supabase/migrations/20260731000001_fornecedor_dados_completos.sql`
- `lib/dados/bancos-febraban.ts`
- `scripts/atualizar-bancos-febraban.ts`
- `components/ui/combobox.tsx`

**Modificados:**
- `lib/validations/fornecedores.ts` (novos campos + `superRefine` das regras)
- `lib/types.ts` (tipo `Fornecedor` ganha os novos campos; novos tipos `TipoContaBancaria`, `PixTipoChave`)
- `app/(app)/fornecedores/fornecedor-form.tsx` (seções, ViaCEP, combobox, PIX)
- `app/(app)/fornecedores/actions.ts` (novos campos no insert/update; nova action `verificarPixDuplicado`; normalização)
- `app/(app)/fornecedores/fornecedores-list.tsx` (badge "Dados incompletos")
- `components/ui/masked-input.tsx` (novo tipo `cep`)
- `package.json` (script `atualizar:bancos`; possivelmente dep `tsx`)

## 10. Checklist de performance

Rodar o filtro final de `docs/PERFORMANCE.md` antes do commit:
- [ ] Server action `verificarPixDuplicado` usa `.limit(1)` e índice existente (`uniq_fornecedores_documento_por_tenant` não serve; considerar índice em `pix_chave` **só se aparecer lentidão real**).
- [ ] `Combobox` renderiza 200 itens sem virtualização — medir. Se >50ms, adicionar `react-window`.
- [ ] Nenhum `<Link>` novo em lista — nada a fazer aqui.
- [ ] Migration com GRANTs? Não precisa (`fornecedores` já tem, e são ALTER COLUMN, não novas tabelas). Confirmar.
- [ ] `force-dynamic` em `/fornecedores/novo` e `/fornecedores/[id]` — verificar se existe hoje; se sim, manter.