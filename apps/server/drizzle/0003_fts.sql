CREATE VIRTUAL TABLE `oracles_fts` USING fts5(
  name, type_line, oracle_text,
  content='oracles', content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2',
  prefix='2 3 4'
);
