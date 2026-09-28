// Shared catalogue: titles and reference data, owned by head office (catalogue router).
import { setBookNumbering } from '../organization/numbering.js';
import * as books from './books.js';
import * as covers from './covers.js';
import * as lookup from './lookup.js';

export const routes = {
  'books-create': books.create,
  'books-update': books.update,
  'books-archive': books.archive,
  'books-restore': books.restore,
  'books-delete': books.remove,
  'books-usage': books.usage,
  'books-setNumbering': setBookNumbering,
  'books-setCover': covers.setCover,
  'books-lookup': lookup.lookup,
  'authors-create': books.authors.create,
  'authors-rename': books.authors.rename,
  'authors-archive': books.authors.archive,
  'publishers-create': books.publishers.create,
  'publishers-rename': books.publishers.rename,
  'publishers-archive': books.publishers.archive,
  'categories-create': books.categories.create,
  'categories-rename': books.categories.rename,
  'categories-archive': books.categories.archive,
};
