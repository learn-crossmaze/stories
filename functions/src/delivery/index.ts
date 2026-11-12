// Home delivery: requests, dispatch (own staff, other couriers, courier apps
// such as Porter), the rider's run, returns at the branch (docs/DELIVERY.md).
import * as courier from './courierBooking.js';
import * as fees from './fees.js';
import * as member from './member.js';
import * as lists from './orderQueries.js';
import * as orders from './orders.js';
import * as settings from './settings.js';
import { handleDeliveryWebhook as webhook } from './webhook.js';

/** Staff actions (circulation router). */
export const routes = {
  'deliveries-settings': settings.settings,
  'deliveries-saveSettings': settings.saveSettings,
  'deliveries-create': orders.create,
  'deliveries-list': lists.list,
  'deliveries-counts': lists.counts,
  'deliveries-get': lists.get,
  'deliveries-mine': lists.mine,
  'deliveries-dispatch': orders.dispatch,
  'deliveries-quote': courier.quote,
  'deliveries-book': courier.book,
  'deliveries-sync': courier.sync,
  'deliveries-report': orders.report,
  'deliveries-receive': orders.receive,
  'deliveries-cancel': orders.cancel,
  'deliveries-recordFee': fees.recordFee,
};

/** Member self-service (members router). */
export const memberRoutes = {
  'me-requestDelivery': member.requestDelivery,
  'me-cancelDelivery': member.cancelByMember,
};

export const handleDeliveryWebhook = webhook;
