// Members, guardians and member self-service (members router).
import * as me from './me.js';
import * as members from './members.js';

export const routes = {
  'members-register': members.register,
  'members-update': members.update,
  'members-setStatus': members.setStatus,
  'members-indexList': members.indexList,
  // Member self-service (ownership-checked).
  'me-overview': me.overview,
  'me-joinOptions': me.joinOptions,
  'me-join': me.join,
  'me-addChild': me.addChild,
  'me-subscribe': me.subscribe,
  'me-cancelPending': me.cancelPending,
  'me-pay': me.pay,
  'me-checkPayment': me.checkPayment,
  'me-reserve': me.reserve,
  'me-cancelReservation': me.cancelReservationByMember,
};
