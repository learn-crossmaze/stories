// Staff HRMS: employee records, lifecycle and HR settings (hr router, docs/HRMS.md).
import * as attendance from './attendance.js';
import * as documents from './documents.js';
import * as employees from './employees.js';
import * as schedule from './schedule.js';
import * as settings from './settings.js';

export const routes = {
  'employees-create': employees.create,
  'employees-update': employees.update,
  'employees-transition': employees.transition,
  'employees-checkItem': employees.checkItem,
  'employees-setPrivate': employees.setPrivate,
  'employees-setBank': employees.setBank,
  'employees-revealBank': employees.revealBank,
  'employees-linkAccount': employees.linkAccount,
  'employees-backfill': employees.backfill,
  'designations-create': settings.createDesignation,
  'designations-rename': settings.renameDesignation,
  'designations-archive': settings.archiveDesignation,
  'hr-setChecklists': settings.setChecklists,
  'documents-upload': documents.upload,
  'documents-review': documents.review,
  'documents-remove': documents.remove,
  'documents-open': documents.open,
  'documentTypes-save': documents.saveType,
  'documentTypes-archive': documents.archiveType,
  'shifts-save': schedule.saveShift,
  'shifts-archive': schedule.archiveShift,
  'holidays-save': schedule.saveHoliday,
  'holidays-remove': schedule.removeHoliday,
  'attendance-assignShift': schedule.assignShift,
  'attendance-punch': attendance.punch,
  'attendance-adjust': attendance.adjust,
  'attendance-requestCorrection': attendance.requestCorrection,
  'attendance-decideCorrection': attendance.decideCorrection,
  'attendance-finalize': attendance.finalize,
  'attendance-reopen': attendance.reopen,
};

export const expireDocuments = documents.expireSweep;
