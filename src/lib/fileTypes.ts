// Which kinds of files can be added to the library, going by their names.
export type OfficeKind =
  | 'docx' | 'xlsx' | 'pptx' | 'odt' | 'ods' | 'odp' | 'rtf'
  | 'doc' | 'xls' | 'ppt'
  | 'text' | 'code' | 'markdown' | 'csv' | 'tsv' | 'image';

export const EXT: Record<string, OfficeKind> = {
  docx: 'docx', docm: 'docx', dotx: 'docx', dotm: 'docx',
  xlsx: 'xlsx', xlsm: 'xlsx', xltx: 'xlsx', xltm: 'xlsx',
  pptx: 'pptx', pptm: 'pptx', potx: 'pptx', potm: 'pptx', ppsx: 'pptx', ppsm: 'pptx',
  odt: 'odt', ott: 'odt', ods: 'ods', ots: 'ods', odp: 'odp', otp: 'odp', rtf: 'rtf',
  doc: 'doc', dot: 'doc', xls: 'xls', xlt: 'xls', ppt: 'ppt', pps: 'ppt', pot: 'ppt',
  txt: 'text', text: 'text', md: 'markdown', markdown: 'markdown', csv: 'csv', tsv: 'tsv', tab: 'tsv',
  log: 'code', json: 'code', xml: 'code', yaml: 'code', yml: 'code', ini: 'code', cfg: 'code', conf: 'code', tex: 'code', sql: 'code',
  py: 'code', js: 'code', ts: 'code', jsx: 'code', tsx: 'code', java: 'code', c: 'code', cpp: 'code', h: 'code', cs: 'code', go: 'code', rb: 'code', php: 'code', sh: 'code', css: 'code', swift: 'code', kt: 'code', rs: 'code',
  jpg: 'image', jpeg: 'image', png: 'image', webp: 'image', gif: 'image', bmp: 'image', avif: 'image',
};

/** The `accept` list for a file picker: PDFs and everything that can be turned into one. */
export const IMPORT_ACCEPT = ['application/pdf', '.pdf', 'application/epub+zip', '.epub', ...Object.keys(EXT).map((e) => `.${e}`), 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/avif'].join(',');
