# Bot do Telegram no Google Apps Script

O Web App do Apps Script é o webhook do bot: recebe cada toque em botão (`callback_query`) e cada
comando, atualiza a planilha e edita a própria mensagem na hora. Ele também envia os lembretes
pedidos no Telegram. A coleta continua no GitHub Actions.

## Arquivos

- `Code.gs`: funções de entrada (`doPost`, `processReminders`, `setupWebhook`, `webhookInfo`,
  `sendPanel`) e o atendimento dos botões de link de mensagens antigas (`doGet`).
- `Bot.gs`: gerado por `npm run build:gas` a partir de `src/bot` e `src/gas`. Não edite à mão.
- `appsscript.json`: fuso horário, runtime V8, escopos (planilha e requisições externas) e Web App.

## Primeira publicação

1. Execute `npm run sheets:setup` (ou o monitor) para criar as abas na planilha.
2. Em [script.google.com](https://script.google.com), crie um projeto com `Code.gs`, `Bot.gs` e
   `appsscript.json` desta pasta.
3. Em **Configurações do projeto → Propriedades do script**, crie:
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`
   - `GOOGLE_SHEET_ID`
   - `TELEGRAM_WEBHOOK_SECRET`: sequência aleatória longa, com pelo menos 32 caracteres.
   - `WEB_APP_URL`: a URL `/exec` do App da Web (passo 4). No editor, o Apps Script só conhece
     a URL de teste `/dev`, que exige login e não serve para o Telegram.
4. **Implantar → Nova implantação → App da Web**: executar como você, acesso: qualquer pessoa.
   Copie a URL `/exec` para a propriedade `WEB_APP_URL`.
5. Execute `setupWebhook` no editor. O resultado mostra a URL `/exec` com `secret=***`.
6. Em **Acionadores**, adicione `processReminders` baseado em tempo, a cada 5 minutos.
7. O monitor do GitHub Actions detecta o webhook sozinho (`getWebhookInfo`) e deixa de ler o
   Telegram por `getUpdates`; `TELEGRAM_WEBHOOK_ENABLED=true` só força esse comportamento.
8. Execute `sendPanel` para receber o painel e testar os botões.

## Atualização

Depois de mudar o código do bot:

1. `npm run build:gas` (o `npm run check` falha se `Bot.gs` estiver desatualizado). O arquivo é
   minificado por completo para ficar menor ao colar no editor.
2. Cole `Code.gs` e `Bot.gs` no editor e salve.
3. **Implantar → Gerenciar implantações → ✏️ Editar → Versão: Nova versão → Implantar**. Editar a
   implantação existente mantém a mesma URL `/exec`.

## Como o webhook responde

O `doPost` responde com `HtmlService`, que devolve HTTP 200 direto. O `ContentService` responde com
redirecionamento, e o Telegram trataria isso como falha e reenviaria o update. Mesmo assim, cada
`update_id` é registrado no cache por 6 horas, então uma entrega repetida não executa a ação de
novo. As ações também são idempotentes: tocar duas vezes em "Concluir" não muda nada.

Use `webhookInfo` para conferir a situação (`pending_update_count`, `last_error_message`).
`deleteWebhook` volta ao modo de reserva, em que o GitHub Actions lê os cliques por `getUpdates`.

Nunca coloque os valores das propriedades no repositório.
