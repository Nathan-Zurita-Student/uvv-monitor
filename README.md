# uvv-monitor

Assistente acadêmico pessoal, automatizado e orientado a estado para o Portal do Aluno UVV,
Gmail, Google Calendar, Google Sheets e Telegram. O objetivo é executar três vezes por dia no
GitHub Actions, sem depender de API paga de IA.

> Status atual: fundação, autenticação e primeiros coletores read-only do Portal (fases 1–6 em
> andamento). A página pública e a área autenticada foram inspecionadas em 30/09/2026. Mensagens,
> turmas, histórico de atendimento, calendário de atividades e quadro regular já são coletados.
> Detalhes completos de mensagens/posts e persistência/deduplicação ainda serão implementados.

## Arquitetura planejada

```text
src/
  cli/               comandos locais e entrypoints
  config/            validação segura do ambiente
  models/            entidades e estados de domínio
  portal/            navegador, login e coletores read-only
  gmail/             coleta via Gmail API
  calendar/          leitura, deduplicação e criação em DRY_RUN
  telegram/          getUpdates, comandos e notificações
  persistence/       Google Sheets e repositórios
  prioritization/    urgência, resumos e check-ins
  scheduler/         janelas e timezone America/Sao_Paulo
  utils/             logs, hash, datas e normalização
tests/
```

O Portal é sempre somente leitura. Nenhuma sessão, cookie, senha ou `storageState` é persistido.
Falhas produzem apenas screenshot e metadados locais em `artifacts/`, que está no `.gitignore`.

## Requisitos atuais

- Node.js 22 ou 24
- npm
- Chromium do Playwright

## Instalação

```bash
npm ci
npx playwright install chromium
```

Copie `.env.example` para `.env` fora do controle de versão e preencha apenas localmente. Comece
sempre com `DRY_RUN=true`.

## Verificar a base

```bash
npm run check
```

## Validar o login real

Para verificar publicamente a disponibilidade do Portal e os seletores observados, sem credenciais:

```bash
npm run portal:inspect
```

Defina `UVV_USERNAME` e `UVV_PASSWORD` no ambiente e execute:

```bash
npm run portal:check
```

O comando abre Chromium headless, verifica se a sessão está válida, efetua login quando necessário
e exige evidência da área autenticada. Credenciais nunca são registradas. Se CAPTCHA ou MFA for
detectado, o comando falha de forma explícita; ele não tenta burlar o mecanismo.

## Coleta read-only atual do Portal

Depois de validar o login:

```bash
npm run portal:collect
```

O resultado detalhado é salvo localmente em `artifacts/diagnostics/latest-portal-items.json`. Esse
diretório é privado e ignorado pelo Git. Cada área é isolada: se uma fonte falhar, as demais ainda
são processadas. O calendário de atividades usa a API autenticada observada no Portal; a grade
regular vem de `/Aluno/QuadroDeHorarios/` e é marcada somente como contexto.

## Variáveis

| Variável               | Finalidade                   | Fase                 |
| ---------------------- | ---------------------------- | -------------------- |
| `UVV_USERNAME`         | matrícula do Portal          | atual                |
| `UVV_PASSWORD`         | senha do Portal              | atual                |
| `DRY_RUN`              | impede escritas externas     | atual, padrão `true` |
| `TZ`                   | deve ser `America/Sao_Paulo` | atual                |
| `PORTAL_TIMEOUT_MS`    | timeout de 5–120 s           | atual                |
| `TELEGRAM_BOT_TOKEN`   | Bot API                      | posterior            |
| `TELEGRAM_CHAT_ID`     | chat autorizado              | posterior            |
| `GOOGLE_CLIENT_ID`     | OAuth Google                 | posterior            |
| `GOOGLE_CLIENT_SECRET` | OAuth Google                 | posterior            |
| `GOOGLE_REFRESH_TOKEN` | acesso offline               | posterior            |
| `GOOGLE_SHEET_ID`      | persistência                 | posterior            |

## Segurança e limitações

- Nunca faça commit de `.env`, tokens, cookies, screenshots ou estado autenticado.
- O robô não envia atividades, responde fóruns ou altera dados no Portal.
- CAPTCHA/MFA exige intervenção humana; o Portal será marcado como não verificado.
- A UVV pode mudar o formulário. Nesse caso, rode `npm run portal:check`, consulte o diagnóstico
  privado em `artifacts/diagnostics` e atualize seletores com base no DOM real.
- A documentação completa de Telegram, Google OAuth, GitHub Secrets e GitHub Actions será incluída
  quando as respectivas fases forem implementadas, após o login real estar confirmado.
