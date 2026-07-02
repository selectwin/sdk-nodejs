// Generate Stripe-style typed namespaces from the generated core.
//
// Reads each src/generated/apis/*Api.ts, finds its public methods + their request
// interfaces, derives a friendly alias, and emits src/namespaces.ts — one wrapper
// class per resource. Methods DELEGATE to the generated ones via `Parameters<>` /
// `ReturnType<>` (exact types, auto-sync on regen), and are FLATTENED when the
// request shape is exactly `{body}`, `{id}` or `{id, body}`:
//
//   create(body, init?)        // POST body only
//   retrieve(id, init?)        // single id
//   update(id, body, init?)    // id + body
//
// Anything else (lists with query params, multi-id sub-resources, optional extras)
// keeps the safe object form `(...args)`. `.raw` always exposes the full API.
//
// Run: npm run gen:namespaces   (after `npm run sync:core`)
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const apisDir = path.join(repoRoot, 'src', 'generated', 'apis');

const LEADING_VERB_ALIAS = { get: 'retrieve' };
const PRIMITIVE = /^(string|number|boolean|Date|any|unknown|void)$/;

const splitCamel = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(' ').filter(Boolean);
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
const singular = (w) => w.replace(/s$/i, '');

function deriveAlias(method, nounWords) {
  const words = splitCamel(method);
  if (words.length === 0) return method;
  const verb = LEADING_VERB_ALIAS[words[0].toLowerCase()] ?? words[0];
  const nounSet = new Set(nounWords.flatMap((w) => [w.toLowerCase(), singular(w).toLowerCase()]));
  const rest = words
    .slice(1)
    .filter((w) => !nounSet.has(w.toLowerCase()) && !nounSet.has(singular(w).toLowerCase()));
  return verb + rest.map(cap).join('');
}

/** All non-`Raw` public methods with their request type name + return type. */
function extractMethods(src) {
  const methods = [];
  const re = /^\s{2,4}async\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)\s*:\s*Promise<(.+)>\s*\{/gm;
  let m;
  while ((m = re.exec(src))) {
    const name = m[1];
    if (name.endsWith('Raw') || methods.some((x) => x.name === name)) continue;
    // first param: `requestParameters: <Type>` (may have ` = {}`)
    const pm = /^\s*requestParameters\s*:\s*([A-Za-z0-9_]+)/.exec(m[2]);
    methods.push({ name, reqType: pm ? pm[1] : null, returnType: m[3].trim() });
  }
  return methods;
}

/** True when the (Promise-unwrapped) return type is a bare array (not a page envelope). */
const isArrayReturn = (rt) => !!rt && (/\[\]$/.test(rt) || /^(Array|ReadonlyArray)\s*</.test(rt));

/** Parse `export interface <name> { ... }` into [{ name, optional, type }]. */
function parseInterface(src, name) {
  const start = src.indexOf(`export interface ${name} {`);
  if (start === -1) return null;
  const open = src.indexOf('{', start);
  const close = src.indexOf('\n}', open);
  if (close === -1) return null;
  const body = src.slice(open + 1, close);
  const props = [];
  for (const line of body.split('\n')) {
    const pm = /^\s*([a-zA-Z0-9_]+)(\?)?\s*:\s*(.+?);?\s*$/.exec(line);
    if (pm) props.push({ name: pm[1], optional: !!pm[2], type: pm[3].trim() });
  }
  return props;
}

const isId = (p) => !p.optional && p.type === 'string' && /Id$/.test(p.name);
const isBody = (p) => !p.optional && /^[A-Z][A-Za-z0-9]*$/.test(p.type) && !PRIMITIVE.test(p.type);

/** Decide the flattening pattern from the request interface's properties. */
function classify(props, returnType) {
  if (!props) return { kind: 'passthrough' };
  const required = props.filter((p) => !p.optional);
  // Top-level paginated list: offset+limit, no required path/body params, and a
  // page-envelope return (NOT a bare `X[]` — some "listall" endpoints return arrays).
  const hasOffset = props.some((p) => p.name === 'offset');
  const hasLimit = props.some((p) => p.name === 'limit');
  if (hasOffset && hasLimit && required.length === 0 && !isArrayReturn(returnType))
    return { kind: 'list' };
  const ids = required.filter(isId);
  const bodies = required.filter((p) => !isId(p) && isBody(p));
  if (props.length === 1 && ids.length === 1) return { kind: 'id', id: ids[0].name };
  if (props.length === 1 && bodies.length === 1) return { kind: 'body', body: bodies[0].name };
  if (props.length === 2 && ids.length === 1 && bodies.length === 1 && required.length === 2)
    return { kind: 'idBody', id: ids[0].name, body: bodies[0].name };
  return { kind: 'passthrough' };
}

function emitMethod(cls, op, alias, shape) {
  const P = `Parameters<${cls}['${op}']>`;
  const R = `ReturnType<${cls}['${op}']>`;
  const doc = `  /** \`${op}\` */`;
  switch (shape.kind) {
    case 'list': {
      const Page = `Awaited<${R}>`;
      const Item = `NonNullable<${Page}['data']>[number]`;
      return `  /** \`${op}\` — auto-paginating: \`await\` for the first page, or \`for await\` to iterate every item. */\n  ${alias}(params?: ${P}[0], init?: ${P}[1]): AutoPager<${Item}, ${Page}> {\n    return new AutoPager((p) => this.api.${op}(p as ${P}[0], init), (params ?? {}) as PaginateParams);\n  }`;
    }
    case 'body':
      return `${doc}\n  ${alias}(body: NonNullable<${P}[0]>['${shape.body}'], init?: ${P}[1]): ${R} {\n    return this.api.${op}({ ${shape.body}: body }, init);\n  }`;
    case 'id':
      return `${doc}\n  ${alias}(id: string, init?: ${P}[1]): ${R} {\n    return this.api.${op}({ ${shape.id}: id }, init);\n  }`;
    case 'idBody':
      return `${doc}\n  ${alias}(id: string, body: NonNullable<${P}[0]>['${shape.body}'], init?: ${P}[1]): ${R} {\n    return this.api.${op}({ ${shape.id}: id, ${shape.body}: body }, init);\n  }`;
    default:
      return `${doc}\n  ${alias}(...args: ${P}): ${R} {\n    return this.api.${op}(...args);\n  }`;
  }
}

const files = readdirSync(apisDir).filter((f) => f.endsWith('Api.ts') && f !== 'index.ts');
const classes = [];
const importNames = [];
let totalAliases = 0;
let flattened = 0;
let usesAutoPager = false;

for (const file of files.sort()) {
  const className = file.replace(/\.ts$/, '');
  const src = readFileSync(path.join(apisDir, file), 'utf8');
  const methods = extractMethods(src);
  if (methods.length === 0) continue;

  const nounWords = splitCamel(className.replace(/Api$/, ''));
  const used = new Map();
  const emitted = [];
  for (const { name, reqType, returnType } of methods) {
    let alias = deriveAlias(name, nounWords);
    if (used.has(alias) && used.get(alias) !== name) {
      console.warn(`  ! alias collision in ${className}: "${alias}" — keeping raw name "${name}"`);
      alias = name;
    }
    used.set(alias, name);
    const shape = classify(reqType ? parseInterface(src, reqType) : null, returnType);
    if (shape.kind !== 'passthrough') flattened++;
    if (shape.kind === 'list') usesAutoPager = true;
    emitted.push(emitMethod(className, name, alias, shape));
  }

  importNames.push(className);
  const nsName = className.replace(/Api$/, 'Namespace');
  classes.push(
    `export class ${nsName} {\n` +
      `  constructor(private readonly api: ${className}) {}\n\n` +
      `${emitted.join('\n\n')}\n\n` +
      `  /** Escape hatch: the underlying generated API (all \`operationId\` methods). */\n` +
      `  get raw(): ${className} {\n    return this.api;\n  }\n}`,
  );
  totalAliases += emitted.length;
  console.log(`  ${className}: ${emitted.length} aliases`);
}

const header =
  `/* eslint-disable */\n` +
  `// GENERATED by scripts/gen-namespaces.mjs — DO NOT EDIT.\n` +
  `// Stripe-style typed wrappers delegating to the generated core.\n` +
  `// Regenerate after \`npm run sync:core\` with \`npm run gen:namespaces\`.\n\n` +
  `import {\n${importNames.map((n) => `  ${n},`).join('\n')}\n} from './generated/apis';\n` +
  (usesAutoPager ? `import { AutoPager, type PaginateParams } from './pagination';\n` : '') +
  `\n`;

writeFileSync(path.join(repoRoot, 'src', 'namespaces.ts'), header + classes.join('\n\n') + '\n', 'utf8');
console.log(
  `Wrote src/namespaces.ts — ${classes.length} namespaces, ${totalAliases} aliases (${flattened} flattened).`,
);
