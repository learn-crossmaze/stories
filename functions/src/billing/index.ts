// Plans, subscriptions, counter and online payments, the deposit ledger (billing router).
import * as deposits from './deposits.js';
import * as online from './online.js';
import * as plans from './plans.js';
import * as refunds from './refunds.js';
import * as subscriptions from './subscriptions.js';
import * as sweep from './sweep.js';

export const routes = {
  'plans-create': plans.create,
  'plans-update': plans.update,
  'plans-archive': plans.archive,
  'subscriptions-create': subscriptions.create,
  'subscriptions-cancelPending': subscriptions.cancelPending,
  'subscriptions-upgradeQuote': subscriptions.upgradeQuoteForStaff,
  'subscriptions-upgrade': subscriptions.upgrade,
  'payments-recordOffline': subscriptions.recordOfflinePayment,
  'payments-createRequest': online.createRequest,
  'payments-checkRequest': online.checkRequest,
  'payments-cancelRequest': online.cancelRequest,
  'payments-refund': refunds.refundPayment,
  'payments-checkRefund': refunds.checkRefund,
  'deposits-proposeAdjustment': deposits.proposeAdjustment,
  'deposits-decide': deposits.decideAdjustment,
  'deposits-startSettlement': deposits.startSettlement,
  'deposits-refund': deposits.refund,
};

export const expireSubscriptions = sweep.expireSweep;
export const handleRazorpayWebhook = online.handleWebhook;
