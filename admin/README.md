# Incentiva+ — Painel Administrativo (demonstração)

Protótipo navegável e funcional do painel administrativo da plataforma de incentivo de vendas Incentiva+.

- `backend/` — NestJS + TypeORM + **SQLite** (`backend/data.sqlite`), mesma stack do `~/sistema-pg`
- `frontend/` — React + TypeScript + Vite + Tailwind + Radix (componentes no padrão shadcn), Lucide, Recharts, React Router.
  O design e os componentes (`Layout`, `kit.tsx`, `ui/*`) foram copiados do `~/sistema-pg` e recoloridos com a identidade Incentiva+ (#020F14 / #071E24 / #00E6A0).

> **Ambiente de demonstração.** Todos os dados são fictícios e as operações gravam apenas no SQLite local.
> Não há integração com sistemas reais. A senha é única de demonstração, mas o MFA (app autenticador/TOTP) é real.

## Rodar

Requer Node 20+.

```bash
cd backend && npm install && npm run start:dev    # API em http://localhost:3333/api
cd frontend && npm install && npm run dev         # painel em http://localhost:5174 (proxy /api → :3333)
```

No primeiro boot o banco é criado e populado (cerca de 3 s): 10.000 usuários, 35 distribuidoras, 50 equipes, 5 campanhas,
regras de pontuação, cerca de 11 mil vendas pontuadas de jan. a set./2026 e conteúdos de exemplo.

**Login:** todos os usuários usam a senha `demo123`. Depois da senha vem o **MFA**: no primeiro acesso aparece um QR code
para cadastrar no Google Authenticator (ou outro app autenticador); nos próximos, só o código de 6 dígitos.
A política (quais perfis são obrigados) fica em Configurações → Segurança e vale para o admin e para o app.
Celular perdido: Usuários → ações do usuário → **Redefinir MFA**.

| Usuário | Perfis | Escopo |
|---|---|---|
| `admin@incentiva.demo` | Super Admin | toda a organização |
| `cliente@incentiva.demo` | Admin do Cliente | toda a organização |
| `gerente1@incentiva.demo` | Gerente + Ponto Focal | a própria distribuidora (Distribuidora Central) |
| `gerente40@incentiva.demo` | Gerente | só a própria equipe |
| `vendedor1@incentiva.demo` | Vendedor | só os próprios dados (quase nenhum menu no admin) |

**Restaurar dados fictícios:** menu do usuário (canto superior direito) → *Restaurar dados fictícios*. Só o Super Admin vê essa opção.
Também dá para apagar `backend/data.sqlite` e reiniciar o backend.

Testes: `cd backend && npm test` (motor de pontos, validação da importação, visibilidade de menus).

## Arquitetura

```
backend/src
  main.ts               módulo, rotas e seed no primeiro boot
  entities.ts           tabelas (TypeORM, synchronize)
  auth.ts               login de demonstração, guard global, @Perm(...), escopos
  points.ts             motor de pontos (puro, testado)
  seed.ts               dados fictícios determinísticos
  imports.controller.ts importação de vendas + worker assíncrono
  menus.controller.ts   menus dinâmicos, operações em massa, modelos, pré-visualização
  people.controller.ts  usuários, distribuidoras, equipes
  campaigns.controller.ts campanhas, metas, regras versionadas, extrato e ajustes
  dashboard.controller.ts dashboard e relatórios
  records.controller.ts módulos de conteúdo (registro genérico por "kind")
  admin.controller.ts   perfis/permissões, auditoria, sessões, lookups, reset da demo
frontend/src
  shared/components     Layout (sidebar com grupos, recolhível, gaveta no mobile), kit (tabelas, filtros, modais...)
  shared/lib            api (fetch + auth + helpers), nav (menu do painel)
  pages/<módulo>        uma pasta por módulo
```

### Decisões importantes

- **Autorização no backend.** Toda rota exige login e declara a permissão (`@Perm('SALES_APPROVE')`). O guard recarrega
  usuário, sessão e perfis a cada requisição: bloquear um usuário, revogar uma sessão ou tirar uma permissão vale na hora.
  Esconder um menu é só conveniência, não segurança.
- **Múltiplos perfis por usuário.** As permissões se somam e vale o maior escopo (`own < team < distributors < organization`).
- **Importação idempotente.** Cada venda tem uma chave única `distribuidora:documento:item`. Reenviar ou reprocessar um lote nunca
  duplica pontos. Uma venda corrigida gera nova versão da venda e um lançamento de **ajuste** ou **estorno** pela diferença.
  O original é preservado e o histórico registra quem fez a operação.
- **Extrato só cresce.** Lançamentos nunca são editados nem apagados. Correções são novos lançamentos vinculados.
- **Regras versionadas.** Editar uma regra cria uma nova versão. Os pontos já creditados guardam a versão usada e não mudam.
- **Menus em escala.** Seleção múltipla e operações em massa: uma operação (e uma linha de auditoria) para N menus.
- **Auditoria.** Toda mutação grava `audit_logs` com o autor, a entidade afetada e os valores anteriores e novos.
- **Módulos secundários** (notícias, banners, treinamentos, quiz, missões, prêmios, chamados...) usam um registro genérico
  (`records`: kind + dados JSON) e uma tela genérica configurável. Trocar por tabelas próprias quando precisar de consultas por campo.

## O que é simulado

- Senha única de demonstração para todos os usuários do seed.
- O processamento de lotes é assíncrono dentro do próprio backend (fila em tabela e um worker com `setInterval`), com pausas
  para os estados ficarem visíveis na tela.
- O progresso de treinamentos por vendedor, equipe e distribuidora é derivado de números do seed.
- O chatbot responde a partir de intenções pré-definidas. A transferência para atendimento humano cria um chamado de verdade.
- A exportação gera CSV no navegador a partir dos dados da API.
