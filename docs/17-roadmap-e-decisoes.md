---
title: Roadmap e decisões
section: Referência
description: O que entra no MVP, o que fica para depois e por quê.
---

# Roadmap e decisões

## Escopo atual (0.1)

**Implementado:**

- Node.js ES Modules, integração Express e adaptador `node:http`.
- SSR com interpolação escapada, `if`/`unless`/`each`, layouts por blocos,
  includes e componentes server-side.
- Linguagem de expressão restrita (AST, sem `eval`).
- Runtime opcional: delegação de eventos, `f-show`, `f-model`, `f-bind`,
  `f-class`, `f-confirm`, `f-on`, `f-ref`.
- Formulários tradicionais e aprimoramento AJAX opt-in com atualização de região.
- CSRF, sessões em cookie assinado, headers de segurança, rate limit.
- Componentes de UI (`ui:button`, `ui:field`, `ui:modal`, `ui:toast`,
  `ui:badge`, `ui:empty-state`, `ui:pagination`, `ui:spinner`) e módulos
  cliente (modal, toast).
- Análise de templates (`flash.analyze()`) e suíte de testes com `node:test`.
- Aplicação de exemplo completa e site de documentação.

**Fora do escopo inicial:**

- Virtual DOM e hidratação universal.
- SSR com streaming.
- Compilador de templates para módulos JS (hoje: interpretador de AST).
- Estado global reativo no cliente.
- Roteador client-side obrigatório.
- CRUD automático com acesso ao banco.
- ORM, sistema de autenticação e sistema de CSS próprios.
- Marketplace de plugins e suporte a múltiplos runtimes.

## Fases

| Fase | Objetivo | Estado |
| --- | --- | --- |
| 0 | prova de conceito (SSR + escape) | concluída |
| 1 | núcleo SSR (parser, blocos, layouts, componentes) | concluída |
| 2 | runtime mínimo (delegação, diretivas, ações) | concluída |
| 3 | formulários e HTML parcial (CSRF, alvos, erros) | concluída |
| 4 | componentes administrativos | concluída |
| 5 | build e otimização (manifesto, análise) | parcial |
| 6 | estabilização (docs, migração, auditoria) | em andamento |

## Decisões tomadas

### Sem `eval` nem `new Function`

Templates e diretivas são interpretados a partir de uma AST construída por um
parser próprio. Custo: sem expressões arbitrárias de JavaScript. Ganho: CSP
estrita, auditoria simples, zero execução dinâmica.

### Sem Virtual DOM

Atualizações são direcionadas (`f-target`) e o DOM é real. Se benchmarks
mostrarem gargalo, otimizamos o caminho específico antes de introduzir
reconciliação.

### Componentes recebem apenas props

Componentes **não** herdam o escopo da página. Isso evita acoplamento oculto e
torna o componente testável isoladamente. Para casos compartilhados, passe
props explicitamente.

### Erro de template com arquivo e linha

Sempre. Diagnóstico ruim custa mais caro que qualquer otimização.

### Modo estrito em desenvolvimento

Identificadores desconhecidos e leitura em `null` falham em dev. Condições
(`#if`, `#each`) são tolerantes; componentes também. Em produção, valores
ausentes renderizam vazio.

## Decisões abertas

1. Sintaxe alternativa para blocos (tags HTML em vez de `{{#if}}`)?
2. Formato da resposta parcial: cabeçalho (atual) x `Content-Type` dedicado?
3. Como registrar módulos de componentes no build de forma automática?
4. Compilar AST para módulos estáticos em vez de interpretar?
5. Estado inicial do cliente serializado pelo servidor (sem duplicar dados)?
6. Estratégia oficial de CSS/design tokens além do `flash.css` opcional?

Cada decisão deve vir acompanhada de protótipo e testes — não de preferência.

## Critérios de sucesso

O FLASH será considerado bem-sucedido se, em aplicações reais, demonstrar:

- menos código repetitivo na aplicação;
- HTML funcional antes do JavaScript;
- JavaScript menor ou comparável em páginas equivalentes;
- segurança auditável;
- facilidade de depuração e testes;
- manutenção viável por uma equipe pequena.

A métrica principal não é o tamanho do framework: é o custo total de construir,
testar, operar e manter a aplicação.

## Regra de ouro

> **Se uma abstração não reduzir a complexidade total da aplicação, ela não deve
> entrar no FLASH.**
