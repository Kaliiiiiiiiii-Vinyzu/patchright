import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Project, ScriptKind, SyntaxKind, type Node } from "ts-morph";

export type PatchedSymbolKind =
  | "class"
  | "method"
  | "property"
  | "function"
  | "parameter"
  | "protocol_param"
  | "protocol_property";

export type PatchedSymbolRecord = {
  symbol: string;
  kind: PatchedSymbolKind;
  playwrightFile: string;
  patchFile: string;
  patchFileLineStart: number | null;
  patchFileLineEnd: number | null;
  playwrightFileLineStart: number | null;
  playwrightFileLineEnd: number | null;
};

type ExtractOptions = {
  newVersionTag?: string;
  githubToken?: string;
};

type ParsedArgs = {
  outputPath: string | null;
  newVersionTag: string | null;
};

type ExtractEvent = {
  callName: string;
  value: string;
  index: number;
  lineStart: number;
  lineEnd: number;
};

const ROOT_DIR = process.cwd();
const DRIVER_PATCHES_DIR = path.join(ROOT_DIR, "driver_patches");

const SOURCE_FILE_CALLS = new Set(["getSourceFileOrThrow", "addSourceFileAtPath"]);
const SYMBOL_CALL_TO_KIND = new Map<string, PatchedSymbolKind>([
  ["getClassOrThrow", "class"],
  ["getClass", "class"],
  ["getMethodOrThrow", "method"],
  ["getMethod", "method"],
  ["getPropertyOrThrow", "property"],
  ["getProperty", "property"],
  ["getFunctionOrThrow", "function"],
  ["getFunction", "function"],
  ["getParameterOrThrow", "parameter"],
  ["getParameter", "parameter"],
]);

const TARGET_CALL_REGEX = /\b(getSourceFileOrThrow|addSourceFileAtPath|getClassOrThrow|getClass|getMethodOrThrow|getMethod|getPropertyOrThrow|getProperty|getFunctionOrThrow|getFunction|getParameterOrThrow|getParameter)\(\s*(["'`])([^"'`]+)\2\s*\)/g;

const PROTOCOL_SYMBOLS: PatchedSymbolRecord[] = [
  {
    symbol: "Frame.evaluateExpression.parameters.isolatedContext",
    kind: "protocol_param",
    playwrightFile: "packages/protocol/src/protocol.yml",
    patchFile: "patchright_driver_patch.ts",
    patchFileLineStart: null,
    patchFileLineEnd: null,
    playwrightFileLineStart: null,
    playwrightFileLineEnd: null,
  },
  {
    symbol: "Frame.evaluateExpressionHandle.parameters.isolatedContext",
    kind: "protocol_param",
    playwrightFile: "packages/protocol/src/protocol.yml",
    patchFile: "patchright_driver_patch.ts",
    patchFileLineStart: null,
    patchFileLineEnd: null,
    playwrightFileLineStart: null,
    playwrightFileLineEnd: null,
  },
  {
    symbol: "JSHandle.evaluateExpression.parameters.isolatedContext",
    kind: "protocol_param",
    playwrightFile: "packages/protocol/src/protocol.yml",
    patchFile: "patchright_driver_patch.ts",
    patchFileLineStart: null,
    patchFileLineEnd: null,
    playwrightFileLineStart: null,
    playwrightFileLineEnd: null,
  },
  {
    symbol: "JSHandle.evaluateExpressionHandle.parameters.isolatedContext",
    kind: "protocol_param",
    playwrightFile: "packages/protocol/src/protocol.yml",
    patchFile: "patchright_driver_patch.ts",
    patchFileLineStart: null,
    patchFileLineEnd: null,
    playwrightFileLineStart: null,
    playwrightFileLineEnd: null,
  },
  {
    symbol: "Worker.evaluateExpression.parameters.isolatedContext",
    kind: "protocol_param",
    playwrightFile: "packages/protocol/src/protocol.yml",
    patchFile: "patchright_driver_patch.ts",
    patchFileLineStart: null,
    patchFileLineEnd: null,
    playwrightFileLineStart: null,
    playwrightFileLineEnd: null,
  },
  {
    symbol: "Worker.evaluateExpressionHandle.parameters.isolatedContext",
    kind: "protocol_param",
    playwrightFile: "packages/protocol/src/protocol.yml",
    patchFile: "patchright_driver_patch.ts",
    patchFileLineStart: null,
    patchFileLineEnd: null,
    playwrightFileLineStart: null,
    playwrightFileLineEnd: null,
  },
  {
    symbol: "Frame.evalOnSelectorAll.parameters.isolatedContext",
    kind: "protocol_param",
    playwrightFile: "packages/protocol/src/protocol.yml",
    patchFile: "patchright_driver_patch.ts",
    patchFileLineStart: null,
    patchFileLineEnd: null,
    playwrightFileLineStart: null,
    playwrightFileLineEnd: null,
  },
  {
    symbol: "ContextOptions.properties.focusControl",
    kind: "protocol_property",
    playwrightFile: "packages/protocol/src/protocol.yml",
    patchFile: "patchright_driver_patch.ts",
    patchFileLineStart: null,
    patchFileLineEnd: null,
    playwrightFileLineStart: null,
    playwrightFileLineEnd: null,
  },
];

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = { outputPath: null, newVersionTag: null };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if ((arg === "--output" || arg === "-o") && argv[i + 1]) {
      args.outputPath = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--new-version" && argv[i + 1]) {
      const version = argv[i + 1];
      args.newVersionTag = version.startsWith("v") ? version : `v${version}`;
      i += 1;
    }
  }
  return args;
}

function toRelativePosix(filePath: string): string {
  const rel = path.relative(ROOT_DIR, filePath);
  return rel.split(path.sep).join("/");
}

function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

function lineFromIndex(lineStarts: number[], index: number): number {
  let low = 0;
  let high = lineStarts.length - 1;
  let answer = 0;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (lineStarts[mid] <= index) {
      answer = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return answer + 1;
}

function lineRangeForIndex(lineStarts: number[], startIndex: number, length: number): { start: number; end: number } {
  const start = lineFromIndex(lineStarts, startIndex);
  const endIndex = Math.max(startIndex, startIndex + Math.max(0, length - 1));
  const end = lineFromIndex(lineStarts, endIndex);
  return { start, end };
}

function buildSourceFile(project: Project, filePath: string, text: string) {
  const extension = path.extname(filePath).toLowerCase();
  const scriptKind = extension === ".ts" || extension === ".tsx"
    ? ScriptKind.TS
    : extension === ".js" || extension === ".jsx"
      ? ScriptKind.JS
      : ScriptKind.TS;

  const virtualPath = `/virtual/${filePath.replaceAll("/", "_")}`;
  const existing = project.getSourceFile(virtualPath);
  if (existing) existing.delete();
  return project.createSourceFile(virtualPath, text, { scriptKind, overwrite: true });
}

function findNodesByKindAndSymbol(sourceFile: ReturnType<Project["createSourceFile"]> | null, kind: PatchedSymbolKind, symbol: string): Node[] {
  if (!sourceFile) return [];

  if (kind === "class") return sourceFile.getClasses().filter((node) => node.getName() === symbol);
  if (kind === "function") return sourceFile.getFunctions().filter((node) => node.getName() === symbol);

  if (kind === "method") {
    return sourceFile.getDescendantsOfKind(SyntaxKind.MethodDeclaration).filter((node) => node.getName() === symbol);
  }

  if (kind === "property") {
    return sourceFile.getDescendantsOfKind(SyntaxKind.PropertyDeclaration).filter((node) => node.getName() === symbol);
  }

  if (kind === "parameter") {
    return sourceFile.getDescendantsOfKind(SyntaxKind.Parameter).filter((node) => node.getName() === symbol);
  }

  return [];
}

function getSymbolBodyRange(node: Node): { start: number; end: number } {
  if (node.getKind() === SyntaxKind.MethodDeclaration) {
    const methodNode = node.asKindOrThrow(SyntaxKind.MethodDeclaration);
    const body = methodNode.getBody();
    if (body) return { start: methodNode.getStartLineNumber(), end: body.getEndLineNumber() };
    return { start: methodNode.getStartLineNumber(), end: methodNode.getEndLineNumber() };
  }

  if (node.getKind() === SyntaxKind.FunctionDeclaration) {
    const fnNode = node.asKindOrThrow(SyntaxKind.FunctionDeclaration);
    const body = fnNode.getBody();
    if (body) return { start: fnNode.getStartLineNumber(), end: body.getEndLineNumber() };
    return { start: fnNode.getStartLineNumber(), end: fnNode.getEndLineNumber() };
  }

  if (node.getKind() === SyntaxKind.ClassDeclaration) {
    const classNode = node.asKindOrThrow(SyntaxKind.ClassDeclaration);
    return { start: classNode.getStartLineNumber(), end: classNode.getEndLineNumber() };
  }

  return { start: node.getStartLineNumber(), end: node.getEndLineNumber() };
}

async function fetchRawFile(tag: string, filePath: string, token: string): Promise<string | null> {
  const url = `https://raw.githubusercontent.com/microsoft/playwright/${tag}/${filePath}`;
  const response = await fetch(url, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "User-Agent": "patchright-extract-patched-symbols",
    },
  });

  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Failed to fetch ${filePath} at ${tag}: HTTP ${response.status}`);
  return response.text();
}

export async function extractPatchedSymbols(options: ExtractOptions = {}): Promise<PatchedSymbolRecord[]> {
  const entries = await fs.readdir(DRIVER_PATCHES_DIR, { withFileTypes: true });

  const patchFiles = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.endsWith(".ts"))
    .filter((name) => name !== "index.ts");

  const records: PatchedSymbolRecord[] = [];

  for (const patchFile of patchFiles) {
    const absolutePatchPath = path.join(DRIVER_PATCHES_DIR, patchFile);
    const content = await fs.readFile(absolutePatchPath, "utf8");
    const lineStarts = computeLineStarts(content);

    const events: ExtractEvent[] = [];
    for (const match of content.matchAll(TARGET_CALL_REGEX)) {
      const callName = match[1];
      const value = match[3];
      const index = match.index ?? 0;
      const range = lineRangeForIndex(lineStarts, index, match[0].length);
      events.push({ callName, value, index, lineStart: range.start, lineEnd: range.end });
    }

    events.sort((a, b) => a.index - b.index);

    let currentPlaywrightFile: string | null = null;
    for (const event of events) {
      if (SOURCE_FILE_CALLS.has(event.callName)) {
        currentPlaywrightFile = event.value;
        continue;
      }

      const kind = SYMBOL_CALL_TO_KIND.get(event.callName);
      if (!kind || !currentPlaywrightFile) continue;

      records.push({
        symbol: event.value,
        kind,
        playwrightFile: currentPlaywrightFile,
        patchFile,
        patchFileLineStart: event.lineStart,
        patchFileLineEnd: event.lineEnd,
        playwrightFileLineStart: null,
        playwrightFileLineEnd: null,
      });
    }
  }

  records.push(...PROTOCOL_SYMBOLS);

  const deduped: PatchedSymbolRecord[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    const key = `${record.symbol}::${record.kind}::${record.playwrightFile}::${record.patchFile}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(record);
  }

  deduped.sort((a, b) => {
    if (a.playwrightFile !== b.playwrightFile) return a.playwrightFile.localeCompare(b.playwrightFile);
    if (a.patchFile !== b.patchFile) return a.patchFile.localeCompare(b.patchFile);
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    return a.symbol.localeCompare(b.symbol);
  });

  if (options.newVersionTag) {
    const project = new Project({ useInMemoryFileSystem: true });
    const token = options.githubToken ?? "";
    const fileTexts = new Map<string, string | null>();
    const uniqueFiles = [...new Set(deduped.map((record) => record.playwrightFile))];

    for (const playwrightFile of uniqueFiles) {
      if (playwrightFile === "packages/protocol/src/protocol.yml") {
        fileTexts.set(playwrightFile, null);
        continue;
      }
      fileTexts.set(playwrightFile, await fetchRawFile(options.newVersionTag, playwrightFile, token));
    }

    for (const record of deduped) {
      if (record.kind === "protocol_param" || record.kind === "protocol_property") continue;
      const text = fileTexts.get(record.playwrightFile);
      if (!text) continue;

      const sourceFile = buildSourceFile(project, record.playwrightFile, text);
      const nodes = findNodesByKindAndSymbol(sourceFile, record.kind, record.symbol);
      const node = nodes[0];
      if (!node) continue;

      const range = getSymbolBodyRange(node);
      record.playwrightFileLineStart = range.start;
      record.playwrightFileLineEnd = range.end;
    }
  }

  return deduped;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const symbols = await extractPatchedSymbols({
    newVersionTag: args.newVersionTag ?? undefined,
    githubToken: process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "",
  });
  const json = `${JSON.stringify(symbols, null, 2)}\n`;

  if (args.outputPath) {
    const absOut = path.resolve(ROOT_DIR, args.outputPath);
    await fs.mkdir(path.dirname(absOut), { recursive: true });
    await fs.writeFile(absOut, json, "utf8");
    console.log(`Wrote ${symbols.length} symbol records to ${toRelativePosix(absOut)}`);
    return;
  }

  process.stdout.write(json);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
