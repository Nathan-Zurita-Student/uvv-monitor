# Ações gratuitas do Telegram

Este Google Apps Script recebe os cliques dos botões como links seguros. O monitor principal continua no GitHub Actions; o Web App trata somente a atualização de andamento.

## Publicação

1. Execute `npm run sheets:setup` para criar a aba `telegram_task_messages`.
2. Acesse [script.google.com](https://script.google.com), crie um projeto e copie `Code.gs` e `appsscript.json` desta pasta.
3. Em **Configurações do projeto → Propriedades do script**, crie:
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`
   - `GOOGLE_SHEET_ID`
   - `TELEGRAM_WEBHOOK_SECRET` — use uma sequência aleatória longa, com pelo menos 32 caracteres.
4. Em **Implantar → Nova implantação → App da Web**:
   - executar como você;
   - acesso: qualquer pessoa.
5. Autorize somente Sheets e conexões externas.
6. No `.env` local e nos GitHub Secrets, mantenha `TELEGRAM_WEBHOOK_ENABLED=false`.
7. Defina `TELEGRAM_ACTIONS_WEB_APP_URL` com a URL pública terminada em `/exec`.
8. Execute o monitor para gerar novas mensagens com tokens de ação.

## Atualização

Quando `Code.gs` mudar, cole o novo conteúdo no editor do Apps Script, salve e use
**Implantar → Gerenciar implantações → ✏️ Editar → Versão: Nova versão → Implantar**. Editar a
implantação existente mantém a mesma URL `/exec`, então nenhum secret precisa mudar.

Desde a versão com cartões em HTML, o monitor salva o texto de cada cartão na coluna
`renderedText` da aba `telegram_task_messages`. O Web App reaproveita esse modelo ao trocar o
andamento, preservando o layout. Mensagens antigas, sem modelo, continuam no formato simples.

As funções `setupWebhook` e `deleteWebhook` permanecem apenas para compatibilidade. O fluxo recomendado não registra webhook, pois o Content Service do Apps Script responde por redirecionamento.

Nunca coloque os valores das propriedades no repositório.
