---
title: Introdução
section: Começando
description: O que é o FLASH, quais problemas ele resolve e quando não usá-lo.
---

# Introdução

**FLASH** (_Fast Lightweight Application Server-rendered HTML_) é um framework
full-stack **HTML-first** para aplicações orientadas a dados: sistemas
administrativos, CRUDs, painéis, CRM, ERP, PDV e SaaS.

> **Escreva menos. Entregue HTML. Envie só o JavaScript necessário.**

A aplicação é descrita principalmente em HTML. O servidor resolve rotas, carrega
dados, executa regras de negócio, renderiza templates e entrega **HTML pronto**.
No navegador, um runtime pequeno e opcional adiciona interações locais.

## O problema que o FLASH resolve

Construir um CRUD simples em uma SPA costuma custar: roteador no cliente, camada
de estado, chamadas de API para cada tela, formulários duplicados (cliente e
servidor) e uma tela em branco enquanto o JavaScript carrega. O FLASH troca isso
por:

| Preocupação | No FLASH |
| --- | --- |
| Renderização | acontece no servidor, na primeira resposta |
| Dados | carregados pelo controller e passados ao template |
| Formulários | HTML nativo, com aprimoramento opcional |
| Validação | autoridade única no servidor |
| Interatividade local | diretivas declarativas (`f-*`) |
| Atualização de tela | troca de uma região por HTML parcial |
| JavaScript enviado | apenas o runtime + os módulos que a página usa |

## Princípios

1. **HTML primeiro.** Estrutura e semântica ficam no HTML.
2. **Servidor como renderizador inicial.** A primeira resposta é conteúdo útil.
3. **JavaScript sob demanda.** Nada de runtime obrigatório.
4. **Progressive enhancement.** A interface funciona sem JavaScript quando viável.
5. **DOM real.** Atualizações direcionadas; sem Virtual DOM.
6. **Poucas abstrações.** Diretivas pequenas, explícitas e consistentes.
7. **Regras de negócio no servidor.** O cliente nunca é autoridade.
8. **Escape por padrão.** Toda interpolação é escapada por contexto.
9. **Sem `eval`.** Expressões são interpretadas a partir de uma AST restrita.
10. **Simplicidade verificável.** Cada recurso justifica seu custo.

## Como o FLASH se compara

| Abordagem | Ponto forte | Custo |
| --- | --- | --- |
| HTML + Express manual | controle total | repetição de renderização e interação |
| Templates server-side tradicionais | simplicidade | interatividade exige código extra |
| HTMX + Alpine | progressive enhancement | ecossistema e convenções separados |
| React/Vue SPA | interfaces muito complexas | mais JavaScript e infraestrutura |
| **FLASH** | HTML-first com runtime seletivo | ecossistema próprio |

## Quando **não** usar

- Jogos, WebGL, editores gráficos complexos.
- Aplicações com estado local intenso e altamente distribuído.
- Produtos que dependem profundamente do ecossistema React/Vue.
- Offline-first com sincronização bidirecional sofisticada.

Nesses casos, use JavaScript convencional ao lado do FLASH — o framework não
exige que toda a aplicação seja escrita nele.

## O que você ganha no dia a dia

```html
<!-- O template é o contrato da tela -->
<h1>Clientes</h1>

<table>
  <tbody>
    {{#each clients.items as client}}
      <tr>
        <td>{{ client.name }}</td>
        <td>{{ client.email }}</td>
        <td><a href="/clients/{{ client.id }}/edit">Editar</a></td>
      </tr>
    {{else}}
      <tr><td colspan="3">Nenhum cliente encontrado.</td></tr>
    {{/each}}
  </tbody>
</table>
```

```js
// O controller só coordena: dados → template
flash.get('/clients', async (ctx) => {
  const clients = await clientService.list({ search: ctx.query.q });

  return ctx.render('clients/index', { title: 'Clientes', clients });
});
```

Sem estado global no cliente, sem endpoint JSON intermediário, sem hidratação.

## Próximos passos

- [Instalação](/docs/instalacao) — coloque uma aplicação no ar em minutos.
- [Guia rápido](/docs/guia-rapido) — um CRUD completo, passo a passo.
- [Templates](/docs/templates) — a sintaxe em detalhe.
