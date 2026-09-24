# RH · Import dos 193 colaboradores do quadro real da Kika (2026-09-24)

> Quadro real de colaboradores foi carregado no banco. Duas migrations aditivas (`socio` no enum de contratação, `data_nascimento`/`area` no colaborador; CHECK de CPF/CNPJ relaxada pra aceitar CPF em PJ) e um script versionado (`scripts/importar-colaboradores.ts`) que lê o CSV da Kika e gera SQL de INSERT. 193 colaboradores, 193 salários vigentes, 193 alocações (26 com rateio de empresa), 4 empresas usadas (California, CCH, Hitlab, Ventura), 20 sem CPF (pendência derivada — UI ainda não mostra).

## O que entrou

### Banco (2 migrations aditivas)

**`20260923140001_rh_socio_e_campos_pessoais`**
- Adiciona `socio` ao enum `tipo_contratacao` (CEO, Diretor Criação — não são PJ nem CLT no sentido tradicional).
- Adiciona `colaboradores.data_nascimento date` (nullable) e `colaboradores.area text` (nullable). O CSV da Kika trás as duas colunas — modelo antigo não tinha.
- Comment em cada coluna explicando nullability.

**`20260923150001_rh_cpf_cnpj_flexivel`**
- Relaxa `chk_colaboradores_cpf_cnpj_formato`: aceita CPF (11 dígitos) OU CNPJ (14) em QUALQUER tipo, incluindo `pj` e `socio`.
- Motivo: a coluna do CSV é CPF da pessoa (mesmo pros PJs), não CNPJ da razão social. Tratar CPF-em-PJ como erro bloqueava 30+ inserções.

### Script

**`scripts/importar-colaboradores.ts`**
- Lê `docs/modulos/rh/COLABORADORES-PRIMEIROINPUT.csv` (194 linhas → 193 imports; Paula Letícia B. Sereno é pulada, quase todo o registro tá vazio).
- Normalizações aplicadas:
  - Nome com parênteses tem o `(...)` removido — `"Andre (Deco)"` vira `"Andre"`.
  - CPF só dígitos; se não bater 11, vai como `null` (pendência).
  - Salário `"R$ 15.000,00"` → `15000.00`.
  - Data `DD/MM/YYYY` → ISO.
  - Tipo: `Híbrido` → `clt_recibo`; `Sócio` → `socio`; `PJ`/`CLT`/`MEI`/`Estágio` → enum direto.
  - Regional `"Tudo"` → `usa_rateio_empresa=true, regional_id=null`.
  - Hardcoded: Maria Isabel dos Santos vai pra CCH+Doca (dado errado no CSV apontava California).
- Emite SQL em stdout com trio `colaborador + salario + alocação` por linha, pronto pra colar num `execute_sql`.
- Constants no topo: `TENANT_ID` (Agência California), `CREATED_BY` (Antonio Pedreira), UUIDs de empresas e regionais.

### Aplicação

- SQL gerado foi dividido em 5 partes de 33-40 registros e aplicado via 5 `execute_sql` (limite de tamanho do MCP).
- Verificação final:
  ```
  total_colaboradores: 193
  total_salarios:      193
  total_alocacoes:     193
  sem_cpf:              20
  empresas_usadas:       4
  com_rateio:           26
  ```

## Migrations aplicadas

```
20260923140001  rh_socio_e_campos_pessoais
20260923150001  rh_cpf_cnpj_flexivel
```

## Docs / ADRs relacionados

- [`docs/handoffs/2026-09-23-rh-alocacao-com-rateio-regional.md`](2026-09-23-rh-alocacao-com-rateio-regional.md) — sessão anterior, é o motor da alocação que este import consome.
- [`docs/modulos/rh/30-proximos-passos.md`](../modulos/rh/30-proximos-passos.md) — P1.1 do backlog é destravada por este handoff.
- Sem ADR próprio — o import é execução, não decisão de modelo. As duas mudanças de schema estão explicadas no header das próprias migrations.

## Commits relevantes

- `ae4d0cb` — feat(rh): importa os 193 colaboradores do quadro real da Kika (2 migrations + script + import completo)

## Pontos de atenção pra próxima sessão

- **20 colaboradores sem CPF hoje.** A UI ainda não mostra essa pendência. Precisa aparecer:
  - Na lista `/rh/colaboradores` (badge/coluna avisando "CPF pendente"?).
  - No detalhe do colaborador (banner? Ícone no card de dados pessoais?).
  - Provavelmente também bloquear geração de folha ou pelo menos avisar antes de aprovar.
- **CSV `docs/modulos/rh/COLABORADORES-PRIMEIROINPUT.csv` está gitignored** (contém PII/CPFs reais). O script consegue rodar de novo se o CSV existir localmente; num ambiente novo, precisa colocar o arquivo antes de rodar.
- **Script é one-shot.** Foi pensado pra este import inicial. Se for necessário um segundo import (novos colaboradores em lote), avaliar se vale evoluir pro fluxo definitivo P1.1 (upload de planilha via UI) em vez de refazer o script.
- **Nenhum colaborador foi alocado em "Empresa Teste".** O Antonio (test colaborador do RH-045) foi apagado antes do import — se precisar de fluxo de teste ponta a ponta, criar colaborador manualmente ou reintroduzir seed.
- **Alocações com `usa_rateio_empresa=true` (26 casos)** dependem de rateio configurado no ano da folha. California e CCH têm 2023..2026 configurados. Hitlab e Ventura NÃO têm — se algum colaborador dessas 2 for marcado como "Tudo" no futuro, folha vai cair em `pulados_sem_rateio`. Hoje isso não acontece porque no import Hitlab e Ventura foram sempre regional específica.
- **Migrations foram aplicadas via MCP antes de existirem como arquivo.** Já corrigido neste commit — os dois `.sql` estão em `supabase/migrations/` com o mesmo conteúdo do que rodou. Se algum dev fizer `supabase db reset`, aplica idêntico.
- **`docs/modulos/rh/03-modelo-de-dados.md` continua stale** (herdado). Precisa mencionar `socio` no enum, `data_nascimento`, `area` e o CHECK novo do CPF.
