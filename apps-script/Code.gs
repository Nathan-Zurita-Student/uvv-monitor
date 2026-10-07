/**
 * UVV Monitor — Web App do bot no Telegram.
 *
 * As funções abaixo apenas repassam para o pacote gerado em Bot.gs (npm run build:gas), que
 * contém o bot inteiro (botões, painel, lembretes). O restante do arquivo atende os botões
 * de link de mensagens antigas.
 */

/** Webhook do Telegram (callback_query e mensagens). */
function doPost(e) {
  return UVVBot.doPost(e);
}

/** Acionador de tempo a cada 5 minutos: envia os lembretes pedidos no Telegram. */
function processReminders() {
  return UVVBot.processReminders();
}

/** Ativa resumos independentes às 12h, 17h e 20h; mantém o acionador de cinco minutos como reserva. */
function setupDailyDigests() {
  const exists = ScriptApp.getProjectTriggers().some(
    (trigger) => trigger.getHandlerFunction() === 'processReminders',
  );
  if (!exists) ScriptApp.newTrigger('processReminders').timeBased().everyMinutes(5).create();
  const result = UVVBot.setupDailyDigests();
  console.log(result);
  return result;
}

function dailyDigestInfo() {
  const result = UVVBot.dailyDigestInfo();
  console.log(result);
  return result;
}

function sendDailyDigestTest() {
  const result = UVVBot.sendDailyDigestTest();
  console.log(result);
  return result;
}

/**
 * Registra o webhook do Telegram na URL /exec publicada (propriedade WEB_APP_URL). No editor,
 * ScriptApp.getService().getUrl() devolve a URL de teste /dev, que exige login do Google.
 */
function setupWebhook() {
  const properties = getRequiredProperties_();
  const url = PropertiesService.getScriptProperties().getProperty('WEB_APP_URL') || '';
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) {
    throw new Error('Defina a propriedade WEB_APP_URL com a URL /exec do App da Web publicado.');
  }
  telegramCall_(properties.botToken, 'setWebhook', {
    url: `${url}?secret=${encodeURIComponent(properties.webhookSecret)}`,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: false,
    max_connections: 5,
  });
  return webhookInfo();
}

function deleteWebhook() {
  return UVVBot.deleteWebhook();
}

/** Envia o painel ao Telegram (teste rápido depois de publicar). */
function sendPanel() {
  return UVVBot.sendPanel();
}

/**
 * Relê a planilha e renova a cópia em cache usada pelos botões. O monitor já faz isso ao fim de
 * cada coleta; rode à mão depois de editar a planilha.
 */
function refreshCache() {
  const result = UVVBot.refreshCache();
  console.log(result);
  return result;
}

/** Diagnóstico da conversa GPT sem revelar a chave nem consumir créditos. */
function conversationInfo() {
  const result = UVVBot.conversationInfo();
  console.log(result);
  return result;
}

function webhookInfo() {
  const result = UVVBot.webhookInfo();
  console.log(result);
  return result;
}

// --- Botões de link de mensagens antigas (antes dos botões internos do Telegram) ---

const TASK_STATUS_BY_CALLBACK = Object.freeze({
  not_started: 'TODO',
  in_progress: 'IN_PROGRESS',
  completed: 'DONE',
  waiting: 'WAITING',
});

const CALLBACK_BY_TASK_STATUS = Object.freeze({
  TODO: 'not_started',
  IN_PROGRESS: 'in_progress',
  DONE: 'completed',
  WAITING: 'waiting',
});

// Mantenha igual a taskStatusLabels em src/telegram/format.ts.
const STATUS_LABELS = Object.freeze({
  TODO: '⏳ Não iniciado',
  IN_PROGRESS: '🔄 Em andamento',
  DONE: '✅ Concluído',
  WAITING: '⏸️ Aguardando',
  NEEDS_CONFIRMATION: '⚠️ Precisa confirmar',
  IGNORED: '🙈 Ignorado',
});

const STATUS_PLACEHOLDER = '{{STATUS}}';

/** Texto do cartão: usa o modelo HTML salvo pelo monitor ou, em mensagens antigas, o formato simples. */
function taskMessageBody_(taskMessage, item, status) {
  const template = taskMessage && taskMessage.data.renderedText;
  if (template) {
    return {
      text: String(template)
        .split(STATUS_PLACEHOLDER)
        .join(STATUS_LABELS[status] || status),
      parse_mode: 'HTML',
    };
  }
  return { text: buildTaskText_(item, status) };
}

function doGet(event) {
  if (!event || !event.parameter || !event.parameter.item) {
    return ContentService.createTextOutput('UVV Monitor: ações do Telegram ativas.');
  }
  try {
    return handleTaskActionPage_(event);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return actionResultPage_(
      'Não consegui atualizar',
      'O link pode ter expirado. Volte ao Telegram e use os botões da mensagem mais recente.',
      false,
    );
  }
}

function handleTaskActionPage_(event) {
  const properties = getRequiredProperties_();
  const itemId = String(event.parameter.item || '').toUpperCase();
  const callbackStatus = String(event.parameter.status || '').toLowerCase();
  const token = String(event.parameter.token || '');
  const status = TASK_STATUS_BY_CALLBACK[callbackStatus];
  if (!/^UVV-[A-Z0-9]{4,10}$/.test(itemId) || !status || token.length < 20) {
    return actionResultPage_('Link inválido', 'Use os botões da mensagem mais recente.', false);
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const spreadsheet = SpreadsheetApp.openById(properties.sheetId);
    const taskMessage = findRecord_(spreadsheet, 'telegram_task_messages', 'itemId', itemId);
    if (!taskMessage || String(taskMessage.data.actionToken || '') !== token) {
      return actionResultPage_(
        'Este botão expirou',
        'Volte ao Telegram e use a mensagem de prioridades mais recente.',
        false,
      );
    }
    const item = findRecord_(spreadsheet, 'detected_items', 'id', itemId);
    if (!item) return actionResultPage_('Tarefa não encontrada', `Não encontrei ${itemId}.`, false);

    updateRecordField_(item, 'status', status);
    const now = new Date().toISOString();
    upsertRecord_(spreadsheet, 'user_task_status', 'itemId', {
      itemId,
      status,
      updatedAt: now,
      source: 'TELEGRAM',
    });
    upsertRecord_(spreadsheet, 'telegram_task_messages', 'itemId', {
      itemId,
      chatId: taskMessage.data.chatId,
      messageId: taskMessage.data.messageId,
      lastRenderedStatus: status,
      updatedAt: now,
      actionToken: token,
    });

    const actionBaseUrl = ScriptApp.getService().getUrl();
    try {
      telegramCall_(
        properties.botToken,
        'editMessageText',
        Object.assign(
          {
            chat_id: String(taskMessage.data.chatId),
            message_id: Number(taskMessage.data.messageId),
            disable_web_page_preview: true,
            reply_markup: {
              inline_keyboard: buildTaskActionKeyboard_(
                actionBaseUrl,
                itemId,
                token,
                status,
                item.data.sourceUrl,
                item.data.source,
              ),
            },
          },
          taskMessageBody_(taskMessage, item.data, status),
        ),
      );
    } catch (error) {
      // Repetir o mesmo botão é uma operação válida e idempotente.
      if (!/message is not modified/i.test(String(error && error.message))) throw error;
    }
    return actionResultPage_(
      'Andamento atualizado',
      `${item.data.title} agora está como ${STATUS_LABELS[status]}. Você já pode fechar esta página.`,
      true,
    );
  } finally {
    lock.releaseLock();
  }
}

function actionResultPage_(title, message, success) {
  const color = success ? '#137333' : '#b3261e';
  return HtmlService.createHtmlOutput(
    `<!doctype html><html lang="pt-BR"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml_(title)}</title></head><body style="font-family:Arial,sans-serif;background:#f6f8fc;margin:0;padding:32px"><main style="max-width:560px;margin:40px auto;background:white;padding:28px;border-radius:18px;box-shadow:0 4px 24px #0002"><h1 style="color:${color};font-size:24px">${escapeHtml_(title)}</h1><p style="font-size:17px;line-height:1.5">${escapeHtml_(message)}</p><p style="color:#5f6368">UVV Monitor</p></main></body></html>`,
  ).setTitle(title);
}

function escapeHtml_(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildTaskActionKeyboard_(baseUrl, itemId, token, selectedStatus, sourceUrl, source) {
  function statusButton(text, status) {
    const url = `${baseUrl}?item=${encodeURIComponent(itemId)}&status=${encodeURIComponent(
      CALLBACK_BY_TASK_STATUS[status],
    )}&token=${encodeURIComponent(token)}`;
    return { text: status === selectedStatus ? `${text} ✓` : text, url };
  }
  const keyboard = [
    [statusButton('⏳ Não comecei', 'TODO'), statusButton('🔄 Em andamento', 'IN_PROGRESS')],
    [statusButton('✅ Concluído', 'DONE'), statusButton('⏸️ Aguardando', 'WAITING')],
  ];
  if (/^https:\/\//i.test(String(sourceUrl || ''))) {
    keyboard.push([
      {
        text: source === 'PORTAL' ? '🔗 Abrir no Portal UVV' : '🔗 Abrir informação',
        url: sourceUrl,
      },
    ]);
  }
  return keyboard;
}

function buildTaskText_(item, status) {
  const lines = [`📌 ${item.title}`];
  if (item.discipline) lines.push(`🎓 ${item.discipline}`);
  const deadline = item.officialDeadline || item.officialDate;
  lines.push(
    deadline ? `📅 Prazo/data oficial: ${deadline}` : '📅 Prazo/data oficial: não informado',
  );
  if (item.urgency) lines.push(`⚠️ Prioridade: ${item.urgency}`);
  lines.push(`📊 Andamento: ${STATUS_LABELS[status] || status}`);
  if (/^https:\/\//i.test(String(item.sourceUrl || ''))) lines.push(`🔗 Link: ${item.sourceUrl}`);
  lines.push(`🆔 Código: ${item.id}`);
  return lines.join('\n');
}

function findRecord_(spreadsheet, sheetName, keyName, keyValue) {
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) throw new Error(`Aba ausente: ${sheetName}`);
  const values = sheet.getDataRange().getValues();
  if (values.length === 0) return null;
  const headers = values[0].map(String);
  const keyIndex = headers.indexOf(keyName);
  if (keyIndex < 0) throw new Error(`Coluna ausente: ${sheetName}.${keyName}`);
  for (let index = 1; index < values.length; index += 1) {
    if (String(values[index][keyIndex]) !== String(keyValue)) continue;
    const data = {};
    headers.forEach((header, column) => {
      data[header] = values[index][column];
    });
    return { sheet, row: index + 1, headers, data };
  }
  return null;
}

function updateRecordField_(record, field, value) {
  const column = record.headers.indexOf(field);
  if (column < 0) throw new Error(`Coluna ausente: ${field}`);
  record.sheet.getRange(record.row, column + 1).setValue(value);
  record.data[field] = value;
}

function upsertRecord_(spreadsheet, sheetName, keyName, data) {
  const existing = findRecord_(spreadsheet, sheetName, keyName, data[keyName]);
  const sheet = existing ? existing.sheet : spreadsheet.getSheetByName(sheetName);
  if (!sheet) throw new Error(`Aba ausente: ${sheetName}`);
  const headers = existing
    ? existing.headers
    : sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  // Preserva colunas não informadas (ex.: actionToken e renderedText) ao atualizar.
  const merged = Object.assign({}, existing ? existing.data : {}, data);
  const row = headers.map((header) => (merged[header] === undefined ? '' : merged[header]));
  if (existing) sheet.getRange(existing.row, 1, 1, headers.length).setValues([row]);
  else sheet.appendRow(row);
}

function telegramCall_(botToken, method, payload) {
  const response = UrlFetchApp.fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  const body = JSON.parse(response.getContentText());
  if (response.getResponseCode() >= 400 || !body.ok) {
    throw new Error(
      `Telegram rejeitou ${method}: ${body.description || response.getResponseCode()}`,
    );
  }
  return body.result;
}

function getRequiredProperties_() {
  const properties = PropertiesService.getScriptProperties();
  const result = {
    botToken: properties.getProperty('TELEGRAM_BOT_TOKEN'),
    chatId: properties.getProperty('TELEGRAM_CHAT_ID'),
    sheetId: properties.getProperty('GOOGLE_SHEET_ID'),
    webhookSecret: properties.getProperty('TELEGRAM_WEBHOOK_SECRET'),
  };
  const missing = Object.keys(result).filter((key) => !result[key]);
  if (missing.length > 0) throw new Error(`Propriedades ausentes: ${missing.join(', ')}`);
  return result;
}
