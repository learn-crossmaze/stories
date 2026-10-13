// Home delivery: requests, dispatch (own staff, other couriers, courier apps
// such as Porter), the rider's run, returns at the branch (docs/DELIVERY.md).
import * as member from './member.js';
import * as orders from './orders.js';
import * as settings from './settings.js';
import { handleDeliveryWebhook as webhook } from './webhook.js';

/** Staff actions (circulation router). */
export const routes = {
  'deliveries-settings': settings.settings,
  'deliveries-saveSettings': settings.saveSettings,
  'deliveries-create': orders.create,
  'deliveries-list': orders.list,
  'deliveries-get': orders.get,
  'deliveries-mine': orders.mine,
  'deliveries-dispatch': orders.dispatch,
  'deliveries-quote': orders.quote,
  'deliveries-book': orders.book,
  'deliveries-sync': orders.sync,
  'deliveries-report': orders.report,
  'deliveries-receive': orders.receive,
  'deliveries-cancel': orders.cancel,
  'deliveries-recordFee': orders.recordFee,
};

/** Member self-service (members router). */
export const memberRoutes = {
  'me-requestDelivery': member.requestDelivery,
  'me-cancelDelivery': member.cancelByMember,
};

export const handleDeliveryWebhook = webhook;
