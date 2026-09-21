# 04 — Fluxo de geração do arquivo

Como um `.REM` sai do ERP, ponta a ponta. Documenta a fase 5 do módulo (biblioteca → server action → UI → download), fechada em 21/09/2026.

## Camadas

O código está separado em 3 camadas independentes. Cada uma tem responsabilidade única e pode ser refatorada sem tocar nas outras.

```
┌──────────────────────────────────────────────────────────┐
│  UI (remessa-cnab-dialog.tsx)                            │
│  Modal de multi-select + botão "Gerar e baixar"          │
│  Cliente-side. Dispara download do arquivo no browser.   │
└──────────────────────────────────────────────────────────┘
                          │ chama
                          ▼
┌──────────────────────────────────────────────────────────┐
│  Server Action (actions-cnab.ts)                         │
│  gerarRemessaCnab(input): valida, busca, monta, grava    │
│  Server-side. Fala com Supabase + biblioteca.            │
└──────────────────────────────────────────────────────────┘
                          │ chama
                          ▼
┌──────────────────────────────────────────────────────────┐
│  Biblioteca (lib/cnab/santander/)                        │
│  Funções puras. Recebe dados TypeScript, produz string.  │
│  Zero dependência de banco/HTTP. Testável isolada.       │
└──────────────────────────────────────────────────────────┘
```

## Camada 1 — Biblioteca de geração

Pasta: [`lib/cnab/santander/`](../../../lib/cnab/santander/).

### Arquivos

| Arquivo | Responsabilidade |
|---|---|
| [`campos.ts`](../../../lib/cnab/santander/campos.ts) | Helpers de formatação: `sanitizeAscii`, `padAlpha`, `padNumeric`, `formatDate` (DDMMAAAA), `formatMoneyV2`, `brancos`, `zeros`, `assert240` |
| [`tipos.ts`](../../../lib/cnab/santander/tipos.ts) | TypeScript interfaces desacopladas de banco: `EmpresaPagadora`, `ContaDebito`, `Pagamento` (union), `MetadadosArquivo`, `LoteInput` |
| [`gerador.ts`](../../../lib/cnab/santander/gerador.ts) | Funções que produzem string de 240 bytes por linha: `montarHeaderArquivo`, `montarHeaderLote`, `montarSegmentoA`, `montarSegmentoAPixChave`, `montarSegmentoB`, `montarSegmentoBPixChave`, `montarTrailerLote`, `montarTrailerArquivo`, `gerarArquivo` (fachada) |
| [`gerador.test.ts`](../../../lib/cnab/santander/gerador.test.ts) | 12 testes com fixture `PE000013.TXT` (arquivo real aceito pelo Santander) |

### Formas de pagamento cobertas

| Forma CNAB | Segmentos gerados |
|---|---|
| 01 — Crédito em CC Santander | A + B |
| 03 — TED | A + B (com finalidade obrigatória) |
| 05 — Poupança | A + B |
| 45 — PIX chave (CPF/CNPJ/email/telefone/aleatória) | A + B com forma de iniciação |
| 45 — PIX por dados bancários | A + B |

**Fora do escopo desta biblioteca** (entram em futuras iterações): Segmento J + J52 (boleto), J + J52-PIX (QR Code dinâmico), Segmento O (tributo com código de barras), Segmento I (OCT).

### Regras não-negociáveis do gerador

- **Cada linha tem exatamente 240 bytes.** `assert240` no fim de cada função — bug do gerador falha alto, nunca produz linha inválida em produção.
- **Sanitização ASCII no próprio gerador**, não no banco. O banco guarda "Antônio"; o gerador escreve "Antonio". Regra transversal do CLAUDE.md sobre pt-BR completo em UI continua valendo pra tudo mais.
- **Numérico**: à direita com zeros à esquerda. **Alfanumérico**: à esquerda com espaços à direita. **Sem exceção** — seção "Alinhamento dos Campos" do manual, pág. 3.
- **Data no formato DDMMAAAA** (não YYYY-MM-DD como o resto do sistema).
- **Valor em V2** (2 casas decimais implícitas, sem separador): R$ 4,00 → `000000000000400`.
- **Câmara de compensação** decidida pela forma: 000 (CC), 009 (PIX), 018 (TED CIP), 810 (TED STR pra Instituição Financeira).

### Como rodar os testes

```bash
npm run test:cnab
```

12 casos que validam:
- Helpers de formatação (padAlpha, padNumeric, formatDate, formatMoneyV2, sanitizeAscii)
- Header de Arquivo reproduzido byte a byte do `PE000013.TXT`
- Header de Lote (TED) idem
- Segmento A com TED
- Segmento B com endereço
- Trailer de lote com soma correta
- Trailer de arquivo com contagens

Se algum campo do arquivo real gerado divergir do fixture, um dos testes falha alto.

## Camada 2 — Server Action

Arquivo: [`app/(app)/financeiro/contas-a-pagar/actions-cnab.ts`](../../../app/(app)/financeiro/contas-a-pagar/actions-cnab.ts).

### Assinatura

```typescript
export async function gerarRemessaCnab(
  input: GerarRemessaCnabInput,
): Promise<GerarRemessaCnabResult>;

interface GerarRemessaCnabInput {
  contaBancariaId: string;
  itens: Array<{
    origemTipo: "pp" | "avulsa" | "folha" | "recorrente" | "desembolso";
    origemId: string;
  }>;
  dataPagamento: string; // YYYY-MM-DD
}
```

Retorno de sucesso inclui: `remessaId`, `sequencial`, `nomeArquivo` (`PE000013.REM`), `conteudoBase64` (pra download), `qtdItens`, `valorTotal`, `itensRejeitados[]`.

### Fluxo interno

1. **Valida sessão + permissão** (`financeiro.contas_pagar`)
2. **Busca conta bancária** e verifica que tem convênio + agência + conta + DV
3. **Busca empresa contábil** dessa conta (razão social, CNPJ, endereço fiscal)
4. **Pra cada item da lista**:
   - Resolve origem (`pp` → `pedidos_compra_parcelas`; `avulsa`/`folha`/`recorrente` → `contas_avulsas`; `desembolso` → `desembolsos_parcelas`)
   - Verifica que está aprovado, não pago, natureza=saída
   - Descobre destinatário: **colaborador_id > fornecedor_id > cliente_id**
   - Busca dados bancários do destinatário
   - Escolhe forma de pagamento:
     - Se tem `pix_chave` → PIX chave (forma 45)
     - Senão se tem banco+agência+conta+DV → banco Santander (033) vira crédito conta (01), outro banco vira TED (03)
     - Senão → item rejeitado com motivo
5. **Se nenhum item elegível**, retorna erro com lista de rejeitados
6. **Aloca sequencial atomicamente** via RPC `alocar_sequencial_cnab` (SECURITY DEFINER + UPDATE...RETURNING serializam concorrência)
7. **Agrupa por forma de lançamento** (1 lote por forma)
8. **Chama `gerarArquivo`** da biblioteca
9. **SHA256 do conteúdo** (dedup + auditoria)
10. **INSERT em `cnab_remessas`** + N `cnab_remessas_itens`
11. **Audit event** `cnab.remessa_gerada`
12. **Retorna Base64** pro browser baixar

### RPC de alocação atômica

Arquivo: [`20260921220001_rpc_alocar_sequencial_cnab.sql`](../../../supabase/migrations/20260921220001_rpc_alocar_sequencial_cnab.sql).

```sql
create function public.alocar_sequencial_cnab(
  p_conta_bancaria_id uuid,
  p_tenant_id uuid
) returns integer
```

- `SECURITY DEFINER` — permite UPDATE mesmo pra quem só tem permissão de leitura na tabela (gate real está na server action)
- Um único `UPDATE ... RETURNING` — Postgres bloqueia a linha até commit, dois clientes concorrentes serializam naturalmente
- Se `sequencial_arquivo IS NULL`, começa em 11 (evita faixa de teste 1-10 do banco, Nota G010)

### Onde os dados são gravados

**`cnab_remessas`** (uma linha por arquivo):
- `sequencial_arquivo`, `hash_arquivo` (SHA256), `qtd_itens`, `valor_total`, `status='gerado'`, `gerado_por`
- `path_storage=null` no MVP — o arquivo hoje só existe no download. Storage entra na fase 6.

**`cnab_remessas_itens`** (n linhas, uma por título incluído):
- `origem_tipo` + `origem_id` (rastreia qual PP/avulsa/folha/desembolso foi pago)
- `forma_pagamento` (`boleto`/`pix`/`transferencia`)
- `destinatario_tipo` + `destinatario_id` (fornecedor/colaborador/cliente)
- `valor`, `data_pagamento`
- `numero_documento_banco` (nosso número atribuído pelo gerador)
- `ocorrencia_retorno` — null no MVP; preenchido na fase 2 do módulo quando o `.RET` for processado

## Camada 3 — UI

Arquivo: [`remessa-cnab-dialog.tsx`](../../../app/(app)/financeiro/contas-a-pagar/remessa-cnab-dialog.tsx).

### Onde vive

Aba **Títulos a Pagar** de `/financeiro/contas-a-pagar`, na toolbar superior, ao lado de "+ Lançamento Avulso". Botão outline vermelho ("Exportar remessa Santander"). Só aparece se o filtro de status **não** for "Pagos" (não faz sentido exportar título já baixado).

Passagem de props: `page.tsx` (server) monta o `<ExportarRemessaCnabDialog />` já com os dados prontos e passa como `React.ReactNode` via `exportarRemessaBotao` prop opcional em `TitulosPagarList`. `TitulosPagarList` não sabe dos dados; só renderiza no lugar.

### Estados possíveis

- **Botão desabilitado** com tooltip explicativo:
  - "Sem permissão" (perfil não é admin/financeiro)
  - "Nenhuma conta Santander configurada" (nenhuma conta com convênio preenchido)
  - "Nenhum título a pagar disponível" (lista vazia)
- **Modal aberto sem título selecionado**: botão "Gerar e baixar" desabilitado
- **Modal aberto com pelo menos um selecionado**: rodapé mostra qtd + total, botão habilitado
- **Sucesso**: bloco verde com nome do arquivo, sequencial, qtd, valor. Rejeitados (se houver) aparecem em bloco âmbar separado
- **Erro**: bloco vermelho com mensagem específica

### Modal (não drawer)

`DialogContent` do projeto com `max-w-5xl` (~1024px) — cabe uma tabela confortável com colunas Destinatário / Descrição / Forma / Valor. `max-h-[88vh]` + `overflow-y-auto` embutidos.

Trocado de drawer lateral pra modal centralizado após feedback de UX: tabela de múltiplos títulos ficava apertada em ~500px.

### Fluxo do usuário

1. Escolhe **conta de débito** no dropdown (só lista Santander com convênio configurado)
2. Escolhe **data de pagamento** (aplica pra todos os itens do arquivo)
3. Vê a lista de títulos elegíveis com selo:
   - **PIX** (verde): tem chave PIX cadastrada
   - **Banco** (azul): tem banco+agência+conta+DV
   - **Sem dados** (cinza, desabilitado): não pode ser marcado
4. Marca com **checkbox por linha** ou **"Marcar todos"** / **"Desmarcar"**
5. Vê o total selecionado no rodapé
6. Clica **"Gerar e baixar"** → server action → download `.REM` no browser

### Como o browser baixa

```typescript
function baixarBase64ComoArquivo(base64: string, nome: string) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: "text/plain;charset=us-ascii" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
```

- Base64 vem do server action (evita passar bytes brutos pelo JSON do response)
- MIME `text/plain;charset=us-ascii` — CNAB é ASCII puro
- Nome sugerido: `PE000013.REM` (PE + sequencial em 6 dígitos + .REM)

## Origem "folha" separada de "avulso"

Adicionado depois da fase 5.3 principal (feedback de UX).

Quando a folha é aprovada, [`aprovarLinhaFolha`](../../../app/(app)/financeiro/contas-a-pagar/actions-folhas.ts) materializa `contas_avulsas` com `folha_id` preenchido. Antes essas linhas apareciam como origem "AVULSO" na coluna — semanticamente errado.

Correção:
- `vw_a_pagar`: CASE de 3 braços (`folha_id IS NOT NULL then 'folha'` ANTES do `recorrente_id`).
- `OrigemTitulo` type ganha `"folha"`.
- Chip novo "Folhas" no filtro de origens, com contador.
- Badge da coluna Origem: **rosa** (`border-rose-200 bg-rose-50 text-rose-700`) — separa visualmente do violeta do "AVULSO".
- `cnab_remessas_itens.chk_origem_tipo` relaxado pra aceitar `'folha'` como valor válido.
- Server action grava `origem_tipo='folha'` direto (removido downcast pra `'avulsa'` que era pré-CHECK).

Ver [ADR 005](02-decisoes.md#adr-005) em decisões.

## Referências

- Fixture do arquivo real aceito pelo Santander: [`lib/cnab/santander/gerador.test.ts`](../../../lib/cnab/santander/gerador.test.ts) usa dados extraídos do `PE000013.TXT`
- Manual CNAB 240 Santander v11.7 (junho/2026) — referência em [`00-descoberta.md §2`](00-descoberta.md#2-o-que-o-santander-exige-leitura-do-manual-cnab-240-v117-junho2026)
- Decisões que amarram fase 5: [ADR 001](02-decisoes.md#adr-001), [ADR 002](02-decisoes.md#adr-002), [ADR 003](02-decisoes.md#adr-003), [ADR 004](02-decisoes.md#adr-004), [ADR 005](02-decisoes.md#adr-005)
