// WhatsApp messages: per-branch connection, templates, sending (docs/WHATSAPP.md).
import * as outbox from './outbox.js';
import * as settings from './settings.js';

export const routes = {
  'whatsapp-overview': settings.overview,
  'whatsapp-saveConnection': settings.saveConnection,
  'whatsapp-saveTemplate': settings.saveTemplate,
  'whatsapp-submitTemplate': settings.submitTemplate,
  'whatsapp-syncTemplates': settings.syncTemplates,
  'whatsapp-sendTest': settings.sendTest,
  'whatsapp-log': settings.log,
};

export const sendWhatsApp = outbox.sendQueued;
export const handleWhatsAppWebhook = outbox.handleWebhook;
