// Issue, return, exchange, reservations and transfers (circulation router).
import * as circulation from './circulation.js';
import * as reservations from './reservations.js';
import * as transfers from './transfers.js';

export const routes = {
  'circulation-issue': circulation.issue,
  'circulation-return': circulation.returnCopies,
  'circulation-exchange': circulation.exchange,
  'circulation-declareLost': circulation.declareLost,
  'reservations-place': reservations.place,
  'reservations-cancel': reservations.cancel,
  'transfers-create': transfers.create,
  'transfers-dispatch': transfers.dispatch,
  'transfers-receive': transfers.receive,
  'transfers-cancel': transfers.cancel,
};

export const expireHolds = reservations.expireHoldsSweep;
