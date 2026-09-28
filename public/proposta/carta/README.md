# Imagens da Carta Proposta

Este diretório recebe os slides da apresentação institucional da California
que aparecem em `/proposta/[token]`.

## Arquivos esperados

A landing procura os arquivos abaixo. Se algum não existir, o componente mostra
um placeholder discreto no lugar (funciona sem quebrar).

| Nome | Conteúdo | Estado |
|---|---|---|
| `Slide1.JPG` | Capa — CARTA PROPOSTA + placeholder do nome | ✓ |
| `Slide2.JPG` | Estamos por todo o país (8 escritórios, 6 regionais...) | ✓ |
| `Slide3.JPG` | Boas-vindas à Califa + dados genéricos | ✓ |
| `Slide4.JPG` | Benefícios (SulAmérica, Wellhub, Central PSI) | ✓ |
| `Slide5.JPG` | Documentação necessária (PJ + CLT) | ✓ |
| `Slide6.JPG` | Planos SulAmérica/Bradesco/Wellhub | ✓ |
| `Slide7.JPG` | Xêro! + contato Time de Cultura & Talento | ✓ |

## Como funciona

- Os slides institucionais (2, 4, 5, 6, 7) são **estáticos** — mesmo conteúdo
  pra qualquer candidato.
- Os slides 1 e 3 têm placeholders no PPT ("NOME E SOBRENOME", "XX/XX/XX",
  "R$ 0.000,00", etc.) que **não são substituídos**.
- Os **dados reais do candidato** (nome, cargo, salário, regime, data)
  aparecem num **card destacado no topo da página**, antes dos slides — assim
  o candidato vê os dados dele com destaque e depois passa pela apresentação
  institucional.

## Como atualizar os slides

Se a Kika quiser mudar visual/conteúdo:

1. Edita o arquivo no Keynote/PPT original.
2. Exporta cada slide como JPG.
3. Sobrescreve os arquivos aqui (`Slide1.JPG` a `Slide7.JPG`).
4. Commita e faz push. Deploy do Vercel atualiza automático em ~1 min.

Não precisa mexer em código pra mudar layout da carta.

## Dimensões recomendadas

- Formato: JPG.
- Proporção: 16:9 (padrão de apresentação).
- Largura mínima: 1600px pra ficar boa em telas retina.
- Tamanho: comprimir com [Squoosh](https://squoosh.app/) antes de subir.
  Cada slide idealmente abaixo de 200 KB.
