# [Título estratégico da entrega] (YYYY-MM-DD)

> Escreva 1 parágrafo que responde: **o que muda pro negócio depois dessa sessão?** Não descreva commits. Descreva o mundo antes e depois.

## O que muda pro negócio

Frase curta, sem jargão. Ex.: "O módulo de RH saiu do estado 'esqueleto com dados de teste' e virou cadastro operacional real." Quem lê aqui é você mesmo daqui 3 meses, ou o próximo agente que abrir a próxima sessão sem contexto nenhum.

## Estado atual (o que existe agora)

Retrato do sistema no fim da sessão, em linguagem de negócio. Números concretos ajudam.

- **Área X**: descrição do que está pronto, com métrica ("209 ativos com salário vigente", "117/209 com dados bancários").
- **Área Y**: idem.
- **Área Z**: o que virou usável de ponta a ponta.

Regra: se um número aparece aqui, ele deve continuar verdadeiro amanhã. Se não vai continuar, é decisão, não estado — vai pra seção abaixo.

## Decisões que vão importar amanhã

Coisas que não são óbvias lendo o código, e que vão morder alguém se esquecermos:

- **Decisão consciente que apagou/mudou algo**: por quê, e o que perdemos.
- **Bug conhecido ainda aberto**: qual é, quando reaparece, o que evitar.
- **Armadilha técnica que descobrimos**: padrão a seguir daqui pra frente.
- **Limite operacional**: "só 46/209 têm líder porque a maioria dos gestores não usa o ERP".

Não repetir aqui o que o commit já diz. Aqui vai o **contexto que o commit não carrega**.

## O que fica pra próxima sessão

Nome do próximo objetivo + contexto suficiente pra abrir a próxima sessão e começar sem re-perguntar.

- **Objetivo**: nome curto (ex.: "Gestão de Férias").
- **Por onde começar**: uma sugestão de primeiro passo (spec do módulo? regra de negócio? UX?).
- **O que já está pronto pra suportar**: peças do sistema que a próxima entrega vai encostar.

## Rastros técnicos (opcional, no rodapé)

Só se ajudar quem for auditar depois. Migrations aplicadas, commits relevantes. Formato solto — não é o coração do handoff.

```
YYYYMMDDHHMMSS_descricao.sql
```

Commits: `hash` — mensagem curta.
