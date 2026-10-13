// vite.config.ts reads files while building; this is all it needs of Node's types.
declare module 'node:fs' {
  export function readdirSync(path: string): string[];
  export function readFileSync(path: string, encoding: 'utf8'): string;
}
